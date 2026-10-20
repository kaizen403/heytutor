/** A source-given label keeps the same phase through canonical save and JSON reopen. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { validateTurnPlanV3 } from "@heytutor/scene-engine";
import * as drawing from "@heytutor/drawing";
import { selectProductionScene, type ProductionSceneSelectionInput } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { completeStoredTurnDiagram } from "../../features/tutor-session/lib/replay/completeReplayDiagram";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import fixture from "./fixtures/recorded-electrolysis-given-replay.json";

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const results: Array<{ id: string; passed: boolean; error?: string }> = [];
async function check(id: string, test: () => void | Promise<void>): Promise<void> {
  try { await test(); results.push({ id, passed: true }); }
  catch (error) { results.push({ id, passed: false, error: error instanceof Error ? error.stack : String(error) }); }
}
const recorded = fixture.input as unknown as ProductionSceneSelectionInput;
const originalSolver = fixture.input.solverAuthority.solverResult;
const label = (commands: readonly Pick<drawing.VerifiedDiagramCommand, "type" | "semanticRef" | "text">[], entityId: string, text?: string) => commands.some(command =>
  command.type === "LABEL" && command.semanticRef?.entityId === entityId && (text === undefined || command.text === text));

async function roundTrip(input: ProductionSceneSelectionInput, solverResult: unknown, currentText: string) {
  const before = JSON.stringify(input);
  const accepted = validateTurnPlanV3(input.turnPlan, input.question);
  assert.ok(accepted.plan, JSON.stringify(accepted.issues));
  const turnPlan = accepted.plan;
  const decision = selectProductionScene({ ...input, turnPlan });
  const r = decision.representation;
  assert.ok(r, decision.reason);
  assert.equal(r.sceneDocument.source.question, input.question);
  const p = buildVerifiedDiagramPresentation(r.sceneDocument, r.renderScene, {
    originalQuestion: input.question, turnPlan, figureFamily: r.family,
  });
  const opening = p.introSegments.flatMap(drawing.getSegmentCommands);
  assert.ok(label(opening, fixture.currentEntityId, currentText), "the actual source-given current is visible in the opening");
  assert.ok(!label(opening, fixture.answerEntityId), "the computed mass waits for teaching");
  assert.ok(p.diagram.deferredAnnotations?.some(entry => label(entry.commands, fixture.answerEntityId)), "the computed answer remains deferred rather than omitted");
  const turn = {
    id: "canonical-given-replay", orderIndex: 0, question: input.question, rawResponse: "", speedMultiplier: 1,
    traceId: null, sceneDocument: r.sceneDocument, sceneEngineVersion: null,
    validationReport: r.validationReport ?? null, visualStatus: "validated" as const,
    status: "complete" as const, kind: "lesson" as const, segments: [], sceneArtifacts: null,
  };
  const completed = [...opening];
  await completeStoredTurnDiagram({ turn, diagram: p.diagram, executeCommand: async command => { completed.push(command); }, shouldCancel: () => false });
  const artifacts = {
    schemaVersion: "scene-artifacts/v3", turnPlan, problemIR: input.problemIR, solverResult,
    representationTier: r.tier, nonMetric: r.nonMetric, candidates: [], figureSource: r.figureSource, diagramResultStatus: "ready",
  };
  const saved = await canonicalizeTurnSceneMetadata({
    question: input.question, sceneDocument: r.sceneDocument, visualStatus: "validated", sceneArtifacts: artifacts, segments: [],
  });
  assert.ok(saved.ok, JSON.stringify(saved));
  const value = saved.value;
  const stored = plain({ ...turn, ...value, segments: value.segments.map(segment => ({
    ...segment, id: `s${segment.orderIndex}`, audioUrl: null, durationMs: segment.durationMs ?? null, timings: null,
    command: drawing.serializeSegmentCommands(drawing.parseStoredSegmentCommands(segment.command), {
      trustedDiagramGeometry: drawing.isStoredCommandTrustedGeometry(segment.command),
    }),
  })) });
  const checked = sourceCheckedStoredTurn(stored);
  assert.equal(checked.visualStatus, "validated");
  const restored = restoreVerifiedPresentationFromTurn(checked);
  assert.ok(restored);
  const reopenedOpening = buildReplayTimeline([checked]).cues.flatMap(cue => cue.commands);
  assert.deepEqual(plain(reopenedOpening), plain(opening), "every opening command and its ordered phase must survive canonical save");
  assert.deepEqual(plain(restored.introSegments.flatMap(drawing.getSegmentCommands)), plain(opening), "restore and canonical save use the same accepted source authority");
  assert.ok(label(reopenedOpening, fixture.currentEntityId, currentText), "JSON reopen must retain the source-given current");
  assert.ok(!label(reopenedOpening, fixture.answerEntityId), "JSON reopen cannot promote a derived answer");
  const reopened = [...reopenedOpening];
  await completeStoredTurnDiagram({ turn: checked, diagram: restored.diagram, executeCommand: async command => { reopened.push(command); }, shouldCancel: () => false });
  assert.deepEqual(plain(reopened), plain(completed), "all ordered final commands survive JSON reopen; no multiset or phase waiver");
  assert.ok(label(reopened, fixture.answerEntityId), "the mass answer appears on healthy completion");
  assert.equal(JSON.stringify(input), before, "the original selector input remains unchanged");
  return { input, turnPlan, r, p, artifacts };
}

async function main(): Promise<void> {
  let real: Awaited<ReturnType<typeof roundTrip>> | undefined;
  await check("recorded-Cu-current-and-full-reopen", async () => { real = await roundTrip(plain(recorded), originalSolver, fixture.currentText); });
  const question = recorded.question.replace("2.0 A", "3.0 A").replace("30 minutes", "15 minutes");
  const sourcePlan = plain(fixture.input.turnPlan);
  sourcePlan.question = question;
  sourcePlan.givens = sourcePlan.givens.map(given => given.id === "I"
    ? { ...given, value: 3, sourceText: "current of 3.0 A" }
    : given.id === "t" ? { ...given, value: 15, sourceText: "for 15 minutes" } : given);
  // A transfer has its own source givens; never reuse the old solved values or
  // manufacture new ProblemIR/solver evidence for a different question.
  sourcePlan.unknowns = [];
  sourcePlan.derived = [];
  sourcePlan.qualitativeClaims = [];
  await check("changed-current-time-source-transfer", async () => {
    const transfer = validateTurnPlanV3(sourcePlan, question);
    assert.ok(transfer.plan, JSON.stringify(transfer.issues));
    await roundTrip({ ...plain(recorded), question, turnPlan: transfer.plan, problemIR: null, solverAuthority: null }, null, "I=3 A");
  });

  const accepted = validateTurnPlanV3(recorded.turnPlan, recorded.question).plan;
  assert.ok(accepted);
  const representation = real?.r ?? selectProductionScene({ ...plain(recorded), turnPlan: accepted }).representation;
  assert.ok(representation, "the positive source figure is required for independent promotion controls");
  await check("no-plan-does-not-promote-a-numeric-given", () => {
    const p = buildVerifiedDiagramPresentation(representation.sceneDocument, representation.renderScene, { originalQuestion: recorded.question });
    assert.ok(!label(p.introSegments.flatMap(drawing.getSegmentCommands), fixture.currentEntityId));
    assert.ok(p.diagram.commands.some(command => command.semanticRef?.entityId === fixture.currentEntityId), "absence of promotion never removes the verified current");
  });
  await check("explicit-answer-outranks-source-given-promotion", () => {
    const document = structuredClone(representation.sceneDocument);
    document.source = { ...document.source, answerLabelEntityIds: [fixture.currentEntityId] };
    const p = buildVerifiedDiagramPresentation(document, representation.renderScene, { originalQuestion: recorded.question, turnPlan: accepted });
    assert.ok(!label(p.introSegments.flatMap(drawing.getSegmentCommands), fixture.currentEntityId));
    assert.ok(p.diagram.deferredAnnotations?.some(entry => label(entry.commands, fixture.currentEntityId)));
  });
  await check("false-plan-current-cannot-create-or-promote-ink", () => {
    const changed = plain(accepted);
    changed.givens = changed.givens.map(given => given.id === "I" ? { ...given, value: 999 } : given);
    const p = buildVerifiedDiagramPresentation(representation.sceneDocument, representation.renderScene, { originalQuestion: recorded.question, turnPlan: changed });
    assert.ok(!label(p.introSegments.flatMap(drawing.getSegmentCommands), fixture.currentEntityId));
    assert.ok(!p.diagram.commands.some(command => command.text === "I=999 A"));
  });
  await check("source-solver-rejects-a-false-derived-answer", async () => {
    const changed = plain(accepted);
    changed.derived = changed.derived.map(quantity => quantity.id === "m" ? { ...quantity, value: 2 } : quantity);
    const saved = await canonicalizeTurnSceneMetadata({
      question: recorded.question, sceneDocument: representation.sceneDocument, visualStatus: "validated", segments: [],
      sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: changed, problemIR: recorded.problemIR,
        solverResult: originalSolver, representationTier: representation.tier, nonMetric: representation.nonMetric,
        candidates: [], figureSource: representation.figureSource, diagramResultStatus: "ready" },
    });
    assert.equal(saved.ok, false, "existing source and solver authority still reject the forged result");
  });
  const report = { scope: "Real recorded Cu row and a source-given transfer through public selection, presentation, canonical save and JSON reopen; offline modules only.",
    passed: results.filter(row => row.passed).length, failed: results.filter(row => !row.passed).length, results };
  const out = process.argv.indexOf("--out");
  if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  for (const row of results.filter(row => !row.passed)) console.error(`FAIL ${row.id}: ${row.error}`);
  console.log(`verify-canonical-given-replay: ${report.passed} passed, ${report.failed} failed`);
  if (report.failed) process.exitCode = 1;
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
