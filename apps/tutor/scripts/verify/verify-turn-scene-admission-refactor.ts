/**
 * The validated branch of canonicalizeTurnSceneMetadata was moved into
 * admitStoredScene (lib/scene/sceneAdmission.ts) so lesson figures can be
 * admitted with the same code. This gate proves the move changed nothing:
 * a corpus built from every scene fixture under scripts/verify/fixtures/,
 * plus variants that reach each admission refusal, canonicalizes to the same
 * bytes as before the extraction (golden recorded on the old inline code).
 *
 * The corpus runs twice: the second pass reads admitStoredScene's memo, which
 * must hand back the same bytes as a fresh compile.
 *
 * Mutation (brief lane 4 table): change one failure code in sceneAdmission.ts
 * (scene_source_question_mismatch) and this gate goes red.
 *
 * Re-record (`--record`) only on a commit that does not touch sceneAdmission.ts,
 * after a scene engine change moves the corpus.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SCENE_ARTIFACTS_V3_VERSION, validateTurnPlanV3, type SceneDocument } from "@heytutor/scene-engine";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { checkpointSceneFixture } from "./fixtures/checkpointScene";
import { DOUBT_TITLE, LESSON_TURN_ID, doubtPageCheck, sceneMetadataOn, stored, teachingRow } from "./fixtures/doubtFigureScene";
import { composeDoubtFigureQuestion, doubtFigureArtifacts } from "../../lib/boards/doubtFigure";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";

const FIXTURES = resolve(__dirname, "fixtures");
const GOLDEN = resolve(FIXTURES, "turn-scene-admission-corpus.json");
const record = process.argv.includes("--record");

type Options = Parameters<typeof canonicalizeTurnSceneMetadata>[1];
interface Case { name: string; metadata: SubmittedTurnSceneMetadata; options?: Options }

function json(path: string): any {
  return JSON.parse(readFileSync(resolve(FIXTURES, path), "utf8"));
}

function tierOf(document: any): "exact_verified" | "qualitative_verified" | "question_representation" {
  const tier = document?.source?.representationTier;
  return tier === "qualitative_verified" || tier === "question_representation" ? tier : "exact_verified";
}

/** A validated save of a document with no recorded rows: the server inserts the intro. */
function fromDocument(question: string, document: unknown, turnPlan: unknown): SubmittedTurnSceneMetadata {
  const tier = tierOf(document);
  return {
    question,
    sceneDocument: structuredClone(document),
    visualStatus: "validated",
    sceneArtifacts: {
      schemaVersion: SCENE_ARTIFACTS_V3_VERSION,
      diagramResultStatus: "ready",
      representationTier: tier,
      nonMetric: tier !== "exact_verified",
      turnPlan: turnPlan ?? null,
    },
    segments: [],
  };
}

function withArtifacts(metadata: SubmittedTurnSceneMetadata, patch: Record<string, unknown>): SubmittedTurnSceneMetadata {
  return { ...structuredClone(metadata), sceneArtifacts: { ...(structuredClone(metadata.sceneArtifacts) as object), ...patch } };
}

function withDocument(metadata: SubmittedTurnSceneMetadata, edit: (document: any) => unknown): SubmittedTurnSceneMetadata {
  const clone = structuredClone(metadata);
  return { ...clone, sceneDocument: edit(clone.sceneDocument) };
}

/** Each base, and variants reaching every refusal the admission owns. */
function variants(name: string, base: SubmittedTurnSceneMetadata, options?: Options): Case[] {
  const artifacts = base.sceneArtifacts as Record<string, any>;
  const tier = artifacts.representationTier;
  const otherTier = tier === "exact_verified" ? "qualitative_verified" : "exact_verified";
  const cases: Case[] = [
    { name, metadata: base, options },
    { name: `${name}/question-changed`, metadata: { ...structuredClone(base), question: `${base.question} Explain why.` }, options },
    { name: `${name}/tier-flipped`, metadata: withArtifacts(base, { representationTier: otherTier, nonMetric: otherTier !== "exact_verified" }), options },
    { name: `${name}/tier-unknown`, metadata: withArtifacts(base, { representationTier: "drawn" }), options },
    { name: `${name}/text-mode`, metadata: withDocument(base, (document) => ({ ...document, visualDecision: { ...document.visualDecision, mode: "text" } })), options },
    { name: `${name}/broken-document`, metadata: withDocument(base, (document) => ({ source: document.source })), options },
    { name: `${name}/metric-declared`, metadata: withDocument(base, (document) => ({ ...document, source: { ...document.source, nonMetric: false } })), options },
    { name: `${name}/declared-tier-other`, metadata: withDocument(base, (document) => ({ ...document, source: { ...document.source, representationTier: otherTier } })), options },
    { name: `${name}/plan-invalid`, metadata: withArtifacts(base, { turnPlan: { schemaVersion: "turn-plan/v3", question: base.question } }), options },
    { name: `${name}/plan-absent`, metadata: withArtifacts(base, { turnPlan: null }), options },
    { name: `${name}/plan-claims-other`, metadata: withArtifacts(base, {
      turnPlan: artifacts.turnPlan ? { ...artifacts.turnPlan, givens: [...(artifacts.turnPlan.givens ?? []), { id: "forged_given", symbol: "Q", value: 917, unit: "m", provenance: "given", sourceText: "917 m" }] } : null,
    }), options },
    { name: `${name}/document-forged-quantity`, metadata: withDocument(base, (document) => ({
      ...document,
      quantities: [...(document.quantities ?? []), { id: "forged_q", symbol: "Q", value: 917, unit: "m", provenance: "given", sourceText: "917 m", display: "917 m" }],
    })), options },
    { name: `${name}/hinglish`, metadata: { ...structuredClone(base), segments: base.segments.map((segment) => ({ ...segment, narration: `${segment.narration} यह देखो` })) }, options },
    { name: `${name}/dsa`, metadata: withDocument(base, (document) => ({ ...document, source: { ...document.source, synthesizedDsa: true } })), options },
  ];
  return cases;
}

async function corpus(): Promise<Case[]> {
  const cases: Case[] = [];
  const lesson = await checkpointSceneFixture();
  cases.push(...variants("checkpoint-number-line", lesson.metadata));
  cases.push(...variants("checkpoint-number-line/focus", {
    ...lesson.metadata,
    segments: [...lesson.metadata.segments, teachingRow(lesson.metadata.segments.length, "We start at two.", [{ type: "FOCUS", params: [], text: "start_value", charPosition: 0, narrationBefore: "" }])],
  }));

  // A doubt figure: the scene checks read the composed question.
  const lessonSaved = await canonicalizeTurnSceneMetadata(lesson.metadata);
  assert(lessonSaved.ok);
  const lessonTurn = stored(LESSON_TURN_ID, 0, lesson.question, lessonSaved.value, { opensOnClear: true, kind: "lesson" });
  const composed = composeDoubtFigureQuestion(lesson.question, DOUBT_TITLE);
  const doubt = {
    ...sceneMetadataOn(lesson.metadata, composed, { ...boardContinuationArtifacts(lesson.question), ...doubtFigureArtifacts(LESSON_TURN_ID) }, lesson.metadata.segments),
    question: DOUBT_TITLE,
  };
  cases.push(...variants("doubt-figure", doubt, { kind: "doubt", doubtFiguresEnabled: true, checkDoubtFigurePage: doubtPageCheck([lessonTurn]) }));

  for (const [index, capture] of (json("answer-label-captures.json").captures as any[]).entries()) {
    cases.push(...variants(`answer-label-captures/${index}`, {
      question: capture.question, sceneDocument: capture.sceneDocument, visualStatus: "validated",
      sceneArtifacts: capture.sceneArtifacts, segments: rows(capture.segments),
    }));
  }
  const circle = json("replay/circle-s3-turn.json").turn;
  cases.push(...variants("replay/circle-s3-turn", {
    question: circle.question, sceneDocument: circle.sceneDocument, visualStatus: "validated",
    sceneArtifacts: circle.sceneArtifacts,
    segments: rows(circle.segments),
  }));
  const pointLine = json("point-line/annotation-link-positive.json").submitted;
  cases.push(...variants("point-line/annotation-link-positive", { ...pointLine, segments: rows(pointLine.segments) }));

  const documents: Array<[string, any, unknown]> = [];
  const l20 = json("launch-l20-late-intro.json");
  documents.push(["launch-l20-late-intro", l20.sceneDocument, l20.turnPlan]);
  const ucm = json("w1-ucm-car-jsonb.json");
  documents.push(["w1-ucm-car-jsonb", ucm.sceneDocument, ucm.turnPlan]);
  documents.push(["launch-l02-primitive-tour", json("launch-l02-primitive-tour.json").sceneDocument, null]);
  documents.push(["focus-writing/m09", json("focus-writing/m09.json").sceneDocument, null]);
  documents.push(["youtube-pen/q15", json("youtube-pen/q15.json").sceneDocument, null]);
  for (const name of ["vt-graph-car-p4c-t5", "track-displacement-p1c-t1"]) {
    documents.push([`recorded-intro/${name}`, json(`recorded-intro/${name}.scene.json`), json(`recorded-intro/${name}.turn-plan.json`)]);
  }
  for (const [name, document, turnPlan] of documents) {
    const question = (document as SceneDocument).source.question as string;
    const plan = turnPlan && validateTurnPlanV3(turnPlan, question).plan ? turnPlan : null;
    cases.push(...variants(name, fromDocument(question, document, plan)));
  }
  return cases;
}

function rows(segments: any[]): SubmittedTurnSceneMetadata["segments"] {
  return segments.map((segment) => ({
    orderIndex: segment.orderIndex, narration: segment.narration ?? "", spokenText: segment.spokenText ?? segment.narration ?? "",
    command: segment.command,
  }));
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function outcomes(cases: Case[]): Promise<Record<string, { ok: boolean; code: string | null; sha: string }>> {
  const result: Record<string, { ok: boolean; code: string | null; sha: string }> = {};
  for (const entry of cases) {
    const saved = await canonicalizeTurnSceneMetadata(structuredClone(entry.metadata), entry.options);
    assert(!(entry.name in result), `duplicate case ${entry.name}`);
    result[entry.name] = { ok: saved.ok, code: saved.ok ? null : (saved.code ?? null), sha: digest(saved) };
  }
  return result;
}

async function main(): Promise<void> {
  const cases = await corpus();
  const first = await outcomes(cases);
  const second = await outcomes(cases);
  assert.deepEqual(second, first, "a second pass (admission memo warm) gives the same bytes as the first");

  if (record) {
    writeFileSync(GOLDEN, `${JSON.stringify({ cases: first }, null, 2)}\n`);
    console.log(`recorded ${Object.keys(first).length} cases to ${GOLDEN}`);
    return;
  }
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")).cases as typeof first;
  assert.deepEqual(Object.keys(first).sort(), Object.keys(golden).sort(), "the corpus has the recorded cases");
  const changed = Object.keys(golden).filter((name) => JSON.stringify(first[name]) !== JSON.stringify(golden[name]));
  for (const name of changed) {
    console.error(`changed: ${name}: was ${JSON.stringify(golden[name])}, now ${JSON.stringify(first[name])}`);
  }
  assert.equal(changed.length, 0, `${changed.length} corpus cases changed since the extraction`);

  // The corpus must reach the admission's own refusals, or equality proves little.
  const codes = new Set(Object.values(golden).map((outcome) => outcome.code).filter(Boolean));
  const admitted = Object.values(golden).filter((outcome) => outcome.ok).length;
  for (const code of [
    "scene_document_invalid", "scene_turn_plan_invalid", "scene_source_question_mismatch", "scene_compile_failed",
    "scene_document_tier_mismatch", "scene_metric_geometry_outside_exact", "scene_admission_failed",
  ]) {
    assert(codes.has(code), `the corpus reaches ${code}`);
  }
  assert(admitted >= 10, `the corpus admits at least 10 scenes (got ${admitted})`);
  console.log(`turn scene admission refactor: ${cases.length} cases byte-identical (${admitted} admitted; codes ${[...codes].sort().join(", ")})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
