/**
 * Two live defects #183 left in the figure intro, replayed on recorded
 * planner documents (no model, audio, database or network calls).
 *
 * 1. A battery's polarity mark is an annotation, not an entity. When the cue
 *    named it strongly, the intro tried to phrase it as a part and threw, so
 *    the Wheatstone bridge, two-loop and internal-resistance lessons failed
 *    live and on restore. Every one must build, keep all of its ink, and still
 *    draw each label after the part it labels.
 * 2. The live intro letters a source given ("x = -2") with the turn plan. The
 *    server rebuilt the saved intro without the plan, so replay, export and
 *    Continue lost that label. The saved intro must match the live one, a plan
 *    that does not validate must keep every value deferred, and no solved value
 *    may reach a saved intro.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  compileSceneDocument,
  validateSceneDocument,
  validateTurnPlanV3,
  type SceneDocument,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { normalizeSceneDocumentModelOutput, parseScenePlannerResponseJson } from "@heytutor/tutor-core";
import {
  getSegmentCommands,
  parseStoredSegmentCommands,
  remainingDeferredAnnotations,
  serializeSegmentCommands,
  type DrawCommand,
  type TutorSegment,
  type VerifiedDiagramPresentation,
} from "@heytutor/drawing";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { restoreVerifiedDiagramFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import type { StoredTurn } from "../../lib/boards/boardsClient";

interface RecordedRow { key: string; question: string; raw: string; turnPlan?: unknown }
const fixture = JSON.parse(readFileSync(new URL("./fixtures/presentation-integrity-183.json", import.meta.url), "utf8")) as {
  polarityCircuits: RecordedRow[];
  givenLabelRows: RecordedRow[];
};

let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks += 1;
  assert(condition, message);
}

function compiled(row: RecordedRow) {
  const candidate = parseScenePlannerResponseJson(row.raw);
  check(candidate, `${row.key}: the recorded planner response parses`);
  const document = validateSceneDocument(normalizeSceneDocumentModelOutput(candidate, row.question)).document as SceneDocument | undefined;
  check(document, `${row.key}: the recorded document validates`);
  const result = compileSceneDocument(document);
  check(result.ok && result.renderScene, `${row.key}: the recorded document compiles`);
  return { document, renderScene: result.renderScene };
}

const introCommands = (segments: TutorSegment[]): DrawCommand[] => segments.flatMap((segment) => getSegmentCommands(segment));
const primitiveOf = (command: { semanticRef?: { primitiveId?: string } }): string => command.semanticRef?.primitiveId ?? "";
const labelTexts = (commands: DrawCommand[]): string[] =>
  commands.filter((command) => command.type === "LABEL").map((command) => String((command as { text?: string }).text ?? ""));

// ── 1. Polarity annotations on circuits ────────────────────────────────────
let polarityMarksOrdered = 0;
for (const row of fixture.polarityCircuits) {
  const { document, renderScene } = compiled(row);
  const entityIds = new Set(document.entities.map((entity) => entity.id));
  const polarity = document.annotations.filter((annotation) => annotation.kind === "polarity");
  check(polarity.length > 0 && polarity.every((annotation) => !entityIds.has(annotation.id)),
    `${row.key}: the fixture carries a polarity annotation that is not an entity`);
  const plans: Array<[string, { turnPlan?: Pick<TurnPlanV3, "givens" | "derived"> }]> = [
    ["no plan", {}],
    ["empty plan", { turnPlan: { givens: [], derived: [] } }],
  ];
  for (const language of [undefined, "hinglish"] as const) for (const [planName, planOption] of plans) {
    const name = `${row.key} (${language ?? "english"}, ${planName})`;
    let presentation: VerifiedDiagramPresentation;
    try {
      presentation = buildVerifiedDiagramPresentation(document, renderScene, { ...planOption, ...(language ? { narrationLanguage: language } : {}) });
    } catch (error) {
      throw new Error(`${name}: a figure whose cue names a polarity annotation must build, not throw: ${String(error)}`);
    }
    const intro = introCommands(presentation.introSegments);
    const deferred = (presentation.diagram.deferredAnnotations ?? []).flatMap((entry) => entry.commands);
    check(intro.length > 0, `${name}: the intro draws the circuit`);
    // Every mark of the verified figure is drawn exactly once: in the intro,
    // or withheld for teaching. Nothing is lost and nothing is drawn twice.
    const all = presentation.diagram.commands.map(primitiveOf).sort();
    const shown = [...intro.map(primitiveOf), ...deferred.map(primitiveOf)].sort();
    check(JSON.stringify(shown) === JSON.stringify(all), `${name}: intro and deferred ink together are the whole figure, once each`);
    // A label is lettered after its part's own ink, never before it.
    const firstInk = new Map<string, number>();
    intro.forEach((command, index) => {
      const entityId = command.semanticRef?.entityId;
      if (entityId && command.type !== "LABEL" && !firstInk.has(entityId)) firstInk.set(entityId, index);
    });
    intro.forEach((command, index) => {
      const entityId = command.semanticRef?.entityId;
      if (command.type !== "LABEL" || !entityId || !firstInk.has(entityId)) return;
      check(firstInk.get(entityId)! < index, `${name}: label ${primitiveOf(command)} is lettered after its part`);
    });
    // A polarity mark in the intro follows the ink of the source it marks
    // (its first target; "A +; C −" may sit by A before C is drawn).
    for (const annotation of polarity) {
      const at = intro.findIndex((command) => primitiveOf(command).startsWith(`${annotation.id}_`) || primitiveOf(command) === annotation.id);
      const source = annotation.targetIds?.[0];
      const sourceAt = source === undefined ? undefined : firstInk.get(source);
      if (at < 0 || sourceAt === undefined) continue;
      check(sourceAt < at, `${name}: ${annotation.id} is drawn after the ${source} it marks`);
      polarityMarksOrdered += 1;
    }
    const narration = presentation.introSegments.map((segment) => segment.narration).join(" ");
    check(!/\bundefined\b/.test(narration), `${name}: the intro narration names real parts`);
    for (const annotation of polarity) {
      check(!narration.includes(annotation.id), `${name}: the annotation id ${annotation.id} is never spoken`);
    }
  }
}

check(polarityMarksOrdered > 0, "at least one polarity mark is drawn in an intro, so its order is actually checked");

// ── 2. Saved intro keeps the live intro's given labels ─────────────────────
const SOLVED_POINT = /^\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)$/;

type Tier = "exact_verified" | "qualitative_verified" | "question_representation";

/** The tiers the live lesson could have saved this document under. */
function savableTiers(document: SceneDocument): Tier[] {
  const declared = document.source.representationTier as string | undefined;
  if (declared === "exact_verified" || declared === "qualitative_verified" || declared === "question_representation") return [declared];
  if (declared === "exact") return ["exact_verified"];
  return ["qualitative_verified", "exact_verified"];
}

async function saveAndRestore(row: RecordedRow, document: SceneDocument, live: VerifiedDiagramPresentation, tier: Tier, savedPlan: unknown) {
  const saved = await canonicalizeTurnSceneMetadata({
    question: row.question,
    sceneDocument: document,
    visualStatus: "validated",
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3",
      representationTier: tier,
      nonMetric: tier !== "exact_verified",
      diagramResultStatus: "ready",
      turnPlan: savedPlan,
    },
    segments: [...live.introSegments, { narration: "Teaching.", command: null } as TutorSegment].map((segment, orderIndex) => ({
      orderIndex,
      narration: segment.narration,
      spokenText: segment.narration,
      command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: segment.verifiedDiagramIntro === true }),
    })),
  } as Parameters<typeof canonicalizeTurnSceneMetadata>[0]);
  if (!saved.ok) return { saved, savedIntro: [] as string[], replayFlush: [] as string[] };
  const savedIntro = labelTexts(saved.value.segments.flatMap((segment) => segment.command ? parseStoredSegmentCommands(segment.command) : []));
  const restored = restoreVerifiedDiagramFromTurn({ ...saved.value, question: row.question } as unknown as StoredTurn);
  check(restored, `${row.key}: the saved turn restores its figure`);
  const replayFlush = remainingDeferredAnnotations(restored).filter((command) => command.type === "LABEL").map((command) => String(command.text ?? ""));
  return { saved, savedIntro, replayFlush };
}

async function verifySavedGivenLabels(): Promise<{ givenLabelsKept: number; saves: number; failClosedSaves: number; solvedPointsHeld: number }> {
  let givenLabelsKept = 0;
  let failClosedSaves = 0;
  let saves = 0;
  let solvedPointsHeld = 0;
  for (const row of fixture.givenLabelRows) {
    const { document, renderScene } = compiled(row);
    const plan = validateTurnPlanV3(row.turnPlan, row.question).plan;
    check(plan, `${row.key}: the recorded TurnPlan validates`);
    const live = buildVerifiedDiagramPresentation(document, renderScene, { turnPlan: plan });
    const unplanned = buildVerifiedDiagramPresentation(document, renderScene, {});
    const liveIntro = labelTexts(introCommands(live.introSegments));
    const unplannedIntro = new Set(labelTexts(introCommands(unplanned.introSegments)));
    const givenLabels = liveIntro.filter((text) => !unplannedIntro.has(text));
    check(givenLabels.length > 0, `${row.key}: the live intro letters a source given the plan proves`);
    for (const text of givenLabels) {
      check(row.question.replace(/\s+/g, "").includes(text.replace(/\s+/g, "")), `${row.key}: "${text}" is stated in the question`);
    }
    const everyLabel = [
      ...liveIntro,
      ...labelTexts(introCommands(unplanned.introSegments)),
      ...(unplanned.diagram.deferredAnnotations ?? []).flatMap((entry) => entry.commands)
        .filter((command) => command.type === "LABEL").map((command) => String(command.text ?? "")),
    ];
    // Labels bound to a derived quantity, by the same identity the
    // presenter reads: the annotation's quantity, else the primitive's entity.
    const derivedTexts = renderScene.primitives.filter((primitive) => {
      if (typeof primitive.text !== "string") return false;
      const annotationId = primitive.provenance?.annotationId;
      const annotation = document.annotations.find((entry) => entry.id === annotationId || entry.id === primitive.id);
      const binding = annotation?.quantityId ?? primitive.entityId;
      return plan.derived.some((derived) => derived.id === binding || derived.symbol === binding);
    }).map((primitive) => String(primitive.text));

    let savedTiers = 0;
    for (const tier of savableTiers(document)) {
      const name = `${row.key} [${tier}]`;
      const { saved, savedIntro, replayFlush } = await saveAndRestore(row, document, live, tier, row.turnPlan);
      if (!saved.ok) continue;
      savedTiers += 1;
      saves += 1;
      solvedPointsHeld += replayFlush.filter((text) => SOLVED_POINT.test(text.trim())).length;
      check(JSON.stringify([...savedIntro].sort()) === JSON.stringify([...liveIntro].sort()),
        `${name}: the saved intro letters what the live intro lettered (live ${JSON.stringify(liveIntro)}, saved ${JSON.stringify(savedIntro)})`);
      for (const text of everyLabel) {
        check(savedIntro.includes(text) || replayFlush.includes(text), `${name}: "${text}" is drawn on replay, in the intro or at the flush`);
      }
      // No solved value reaches a saved intro: a derived intersection waits.
      for (const text of savedIntro) {
        check(!SOLVED_POINT.test(text.trim()), `${name}: the solved point "${text}" is not in the saved intro`);
        check(!derivedTexts.includes(text), `${name}: the derived label "${text}" stays out of the saved intro`);
      }

      // Fail closed: a plan that does not validate against this question
      // proves nothing given. Either the save refuses it, or every given label
      // waits for the flush; none is lettered in the saved intro.
      const stale = { ...(row.turnPlan as Record<string, unknown>), question: `${row.question} (a different question)` };
      check(!validateTurnPlanV3(stale, row.question).plan, `${name}: the stale plan is rejected by the validator`);
      for (const [planName, savedPlan] of [["stale plan", stale], ["no plan", undefined]] as const) {
        const closed = await saveAndRestore(row, document, live, tier, savedPlan);
        if (!closed.saved.ok) continue;
        failClosedSaves += 1;
        for (const text of givenLabels) {
          check(!closed.savedIntro.includes(text), `${name} (${planName}): "${text}" is not lettered in the saved intro without a valid plan`);
          check(closed.replayFlush.includes(text), `${name} (${planName}): "${text}" is still drawn at the replay flush`);
        }
      }
    }
    check(savedTiers > 0, `${row.key}: the lesson saves under its tier`);
    givenLabelsKept += givenLabels.length;
  }
  check(failClosedSaves > 0, "at least one save without a valid plan is accepted, so fail closed is actually checked");
  check(solvedPointsHeld > 0, "a solved intersection is drawn in these figures, so holding it back is actually checked");
  return { givenLabelsKept, saves, failClosedSaves, solvedPointsHeld };
}

verifySavedGivenLabels().then(({ givenLabelsKept, saves, failClosedSaves, solvedPointsHeld }) => {
  console.log(`presentation integrity after #183 GREEN: ${checks} checks; ${fixture.polarityCircuits.length} polarity circuits build in English and Hinglish with all ink in order; ${fixture.givenLabelRows.length} recorded rows save ${givenLabelsKept} live given labels across ${saves} saves, fail closed in ${failClosedSaves} saves without a valid plan, and hold ${solvedPointsHeld} solved intersections for the replay flush, never the saved intro`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
