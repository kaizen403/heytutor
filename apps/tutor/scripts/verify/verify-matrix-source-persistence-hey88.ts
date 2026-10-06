import assert from "node:assert/strict";
import { compileSceneDocument, validateMatrixSourceBinding, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { getSegmentCommands, parseStoredSegmentCommands, serializeSegmentCommands, isStoredCommandTrustedGeometry } from "@heytutor/drawing";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";

let checks = 0;
const check = (condition: unknown, message: string): void => { checks++; assert.ok(condition, message); };
function fixture(entries: number[][], claimedType?: string, question = `A=${JSON.stringify(entries)}. Show A.`) {
  const givens = entries.flatMap((row, i) => row.map((value, j) => ({ id: `a${i + 1}${j + 1}`, symbol: `a${i + 1}${j + 1}`, value, unit: "dimensionless", provenance: "given" as const, sourceText: question })));
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens, unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
  const document: SceneDocument = {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source matrix" }, source: { question, representationTier: "exact_verified", nonMetric: false },
    quantities: givens.map(({ id, value, unit }) => ({ id, value, unit })), entities: [{ id: "A", kind: "matrix_array", label: "A", role: "source matrix" }],
    constructions: [{ id: "make_A", operator: "matrix_array", inputs: { entries, origin: [0, 0], displayScale: 1, ...(claimedType ? { claimedType } : {}) }, outputs: ["A"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["A"], revealGroups: [{ id: "matrices", entityIds: ["A"], dependsOn: [], narrationCue: "Here is the given array." }], teachingTimeline: [],
  };
  return { document, plan, question };
}
function submitted(sample: ReturnType<typeof fixture>) {
  return { question: sample.question, sceneDocument: sample.document, visualStatus: "validated" as const, sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: sample.plan, representationTier: "exact_verified", nonMetric: false, candidates: [], diagramResultStatus: "ready" }, segments: [
    { orderIndex: 0, narration: "Write the calculation.", spokenText: "Write the calculation.", command: { type: "WRITE", params: [90, 145, 28], text: "1+0=1", charPosition: 0, narrationBefore: "Write the calculation." } },
    { orderIndex: 1, narration: "Notice the verified matrix.", spokenText: "Notice the verified matrix.", command: { type: "FOCUS", params: [], text: "A", charPosition: 0, narrationBefore: "Notice the verified matrix." } },
  ] };
}
async function main(): Promise<void> {
  for (const [name, entries, type] of [
    ["rectangular", [[1, 2, 3], [4, 5, 6]], "rectangular"], ["square", [[1, 2], [3, 4]], "square"], ["row", [[1, 2, 3]], "row"], ["column", [[1], [2], [3]], "column"],
    ["zero", [[0, 0, 0], [0, 0, 0], [0, 0, 0]], "zero"], ["identity", [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "identity"], ["diagonal", [[2, 0, 0], [0, 3, 0], [0, 0, 4]], "diagonal"],
    ["symmetric", [[1, 2], [2, 3]], "symmetric"], ["skew", [[0, -2], [2, 0]], "skew_symmetric"], ["1x1", [[0]], "zero"],
    ["six-by-six", Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => i === j ? 1 : 0)), "identity"],
    ["precision", [[0.1234567890123, 1e-300], [-0.000000000123, 0]], "square"],
  ] as const) {
    const sample = fixture(entries.map((row) => [...row]), type);
    const compiled = compileSceneDocument(sample.document);
    check(compiled.ok && compiled.renderScene, `${name}: source public compile`);
    const cells = compiled.renderScene!.primitives.filter((primitive) => primitive.provenance?.matrixCell);
    const expected = entries.flatMap((row, i) => row.map((_, j) => `A_${i}_${j}`));
    check(cells.length === expected.length && expected.every((id) => cells.some((primitive) => primitive.id === id)), `${name}: all compiler cell identities`);
    check(cells.every((primitive) => primitive.labelPlacement === "absolute" && Number(primitive.provenance?.fontPx) >= 12), `${name}: engine-owned fixed readable cell bounds`);
    const presentation = buildVerifiedDiagramPresentation(sample.document, compiled.renderScene!);
    const transported = presentation.diagram.commands.filter((command) => command.type === "LABEL" && expected.includes(command.semanticRef?.primitiveId ?? ""));
    check(transported.length === expected.length && new Set(transported.map((command) => command.semanticRef?.primitiveId)).size === expected.length, `${name}: repeated values never deduplicate cells`);
    const intro = presentation.introSegments.flatMap(getSegmentCommands);
    check(expected.every((id) => intro.some((command) => command.type === "LABEL" && command.semanticRef?.primitiveId === id)), `${name}: cells visible in generic intro`);
    const canonical = await canonicalizeTurnSceneMetadata(submitted(sample));
    check(canonical.ok, `${name}: actual server canonicalization ${canonical.ok ? "" : canonical.error}`);
    if (!canonical.ok) throw new Error(canonical.error);
    const turn: StoredTurn = { ...canonical.value, id: name, orderIndex: 0, question: sample.question, rawResponse: "", speedMultiplier: 1, traceId: null,
      segments: canonical.value.segments.map((segment) => ({ id: `segment-${segment.orderIndex}`, orderIndex: segment.orderIndex, narration: segment.narration, spokenText: segment.spokenText, command: serializeSegmentCommands(parseStoredSegmentCommands(segment.command), { trustedDiagramGeometry: isStoredCommandTrustedGeometry(segment.command) }), audioUrl: null, durationMs: segment.durationMs ?? null, timings: null })),
    };
    check(sourceCheckedStoredTurn(turn) === turn, `${name}: actual stored reader admits source`);
    const restored = restoreVerifiedPresentationFromTurn(turn);
    check(restored?.diagram.commands.filter((command) => command.type === "LABEL" && expected.includes(command.semanticRef?.primitiveId ?? "")).length === expected.length, `${name}: restoration retains all cells`);
    const replay = buildReplayTimeline([turn]);
    check(replay.cues.some((cue) => cue.commands.some((command) => command.type === "WRITE")) && replay.cues.some((cue) => cue.commands.some((command) => command.type === "FOCUS" && command.text === "A")), `${name}: replay keeps WRITE and verified FOCUS`);
    check(replay.cues.flatMap((cue) => cue.commands).filter((command) => command.type === "LABEL").length >= expected.length, `${name}: saved replay retains cell ink`);
    for (const mutation of ["entry", "source", "plan"] as const) {
      const corrupt = structuredClone(turn);
      if (mutation === "entry") (corrupt.sceneDocument as SceneDocument).constructions[0]!.inputs.entries = [[9]];
      if (mutation === "source") corrupt.question += " Instead show 2A, not A.";
      if (mutation === "plan") (corrupt.sceneArtifacts as { turnPlan: TurnPlanV3 }).turnPlan.givens[0]!.value = 9;
      check(sourceCheckedStoredTurn(corrupt).visualStatus === "retry_required", `${name}/${mutation}: stored source rejected`);
      check(restoreVerifiedPresentationFromTurn(corrupt) === null, `${name}/${mutation}: restore cannot emit unbound geometry`);
      check(buildReplayTimeline([corrupt]).cues.every((cue) => !cue.trustedDiagramGeometry), `${name}/${mutation}: saved replay cannot trust geometry`);
    }
    const altered = submitted(sample); (altered.sceneArtifacts.turnPlan.givens[0]!).value = 9;
    check(!(await canonicalizeTurnSceneMetadata(altered)).ok, `${name}: server refuses stale plan`);
  }
  const derived = fixture([[1, 2], [3, 4]], undefined, "A=[[1,2],[3,4]], B=[[2,0],[0,2]]. C=A+B. Show C.");
  derived.document.entities.push({ id: "B", kind: "matrix_array", label: "B", role: "source matrix" }, { id: "C", kind: "matrix_array", label: "C", role: "derived result" });
  derived.document.constructions.push({ id: "make_B", operator: "matrix_array", inputs: { entries: [[2, 0], [0, 2]], origin: [0, 0], displayScale: 1 }, outputs: ["B"] }, { id: "make_C", operator: "matrix_add", inputs: { left: "A", right: "B", origin: [0, 0], displayScale: 1 }, outputs: ["C"] });
  derived.document.requiredEntityIds.push("B", "C"); derived.document.revealGroups[0]!.entityIds.push("B", "C");
  derived.plan.derived = [{ id: "c11", symbol: "c11", value: 3, unit: "dimensionless", provenance: "derived", sourceText: derived.question }];
  derived.plan.qualitativeClaims = [{ id: "typeC", claim: "C is a square matrix", expected: true, relatedQuantityIds: [] }];
  check(validateMatrixSourceBinding(derived.document, derived.question, derived.plan).length === 0, "correct derived scalar and result type have independent source witnesses");
  const stale = structuredClone(derived.plan); stale.derived[0]!.value = 9;
  check(validateMatrixSourceBinding(derived.document, derived.question, stale).some((issue) => issue.severity === "fatal"), "stale derived scalar cannot pair with correct diagram");
  const mixed = structuredClone(derived.document); mixed.entities[0]!.provenance = { matrixCell: null, transient: true };
  const mixedCompile = compileSceneDocument(mixed); check(mixedCompile.ok && mixedCompile.renderScene, "model cell markers cannot erase generated source content");
  check(mixedCompile.renderScene!.primitives.filter((primitive) => primitive.provenance?.matrixCell).length === 12, "source and result cell metadata remain engine owned");
  const mixedIntro = buildVerifiedDiagramPresentation(mixed, mixedCompile.renderScene!).introSegments.flatMap(getSegmentCommands);
  check(mixedIntro.filter((command) => command.type === "LABEL" && command.semanticRef?.primitiveId?.startsWith("A_")).length === 4, "transient/annotation metadata cannot defer mandatory source cells");
  const overlaps = compileSceneDocument(derived.document); check(overlaps.ok && overlaps.renderScene, "coincident nonmetric model origins are source-preservingly packed");
  check(overlaps.renderScene!.primitives.filter((primitive) => primitive.provenance?.matrixCell).length === 12, "packing retains all cells, no partial candidate");
  const bad = structuredClone(derived.document); const add = bad.constructions.at(-1)!; add.inputs.left = "B"; add.inputs.right = "A";
  check(!compileSceneDocument(bad).ok, "commutative numeric coincidence cannot erase source operand order");
  console.log(`HEY88 matrix source/presentation/canonical/read/restore/replay gate passed (${checks} controls); in-memory only, not authenticated storage, speech, native cohort or topic acceptance`);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
