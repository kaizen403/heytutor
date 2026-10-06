import assert from "node:assert/strict";
import { applySectionFormulaAuthority, buildSolverAuthorityProjection, compileSceneDocument, LocalDeterministicSolverProvider, verifyTurnPlanAgainstSolver, validateProblemIR, type TurnPlanV3 } from "@heytutor/scene-engine";
import { IncrementalTagParser, parseDrawingCommands, serializeSegmentCommands, unwrapMathMarkup, type TutorSegment } from "@heytutor/drawing";
import { requestedNameCases, namedProblemFor } from "../../../../packages/scene-engine/scripts/verify/verify-w1-section-fullir";
import { refreshSolverAuthorityForPlan } from "../../features/tutor-session/lib/turn/refreshSolverAuthority";
import { buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { storedTurnSourceIssues, sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { mathToSpeech } from "../../../../packages/tutor-core/src/tts/speechNotation";
import type { StoredTurn } from "../../lib/boards/boardsClient";

async function main(): Promise<void> {
let checks = 0;
for (const [input, expected] of [
  [String.raw`\frac{3}{2}^2`, "(3/2)^2"],
  [String.raw`\frac{1}{\frac{2}{3}}`, "(1/((2/3)))"],
  [String.raw`\frac{1+2}{3+4}^2`, "((1+2)/(3+4))^2"],
  [String.raw`-\frac{3}{2}^2`, "-(3/2)^2"],
  [String.raw`\frac{-3}{2}^2`, "(-3/2)^2"],
  [String.raw`1/\frac{3}{2}`, "1/(3/2)"],
  [String.raw`\frac{\frac{3}{2}^2}{2}`, "(((3/2)^2)/2)"],
  [String.raw`\frac{3}{2}x`, "(3/2)x"],
] as const) {
  assert.equal(unwrapMathMarkup(input), expected); checks++;
  const row = parseDrawingCommands(`[WRITE:\\(${input}\\),90,145]`).commands.find((command) => command.type === "WRITE");
  assert.equal(row?.text, expected); checks++;
  const segments: TutorSegment[] = [];
  const stream = new IncrementalTagParser({ onSegmentReady: (segment) => segments.push(segment) });
  const response = String.raw`[STEP] Math. [WRITE:\(${input}\),90,145][/STEP]`;
  for (let i = 0; i < response.length; i += 3) stream.push(response.slice(i, i + 3));
  stream.flush();
  const commands = segments.flatMap((segment) => segment.commands ?? [segment.command]);
  assert.equal(commands.find((command) => command?.type === "WRITE")?.text, expected);
  assert.equal(mathToSpeech(input), mathToSpeech(expected)); checks += 2;
}

const c = requestedNameCases[0]!;
const question = c.question;
const rawPlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], derived: [{ id: "x_Q", symbol: "x_Q", value: 4, provenance: "derived", sourceText: "x_Q = 4" }], unknowns: [{ id: "x_Q", symbol: "x_Q" }], qualitativeClaims: [], assumptions: [], lawIds: [] };
const problem = namedProblemFor(c, "Q");
problem.expressions.push({ id: "wrong_formulation", valueType: "scalar", root: { kind: "number", value: 4 }, evidenceFactIds: ["given"] });
problem.solveRequests.push({ id: "solve_x", kind: "evaluate", expressionId: "wrong_formulation", resultBinding: { turnPlanQuantityId: "x_Q", symbol: "x_Q", evidenceFactIds: ["requested"] } });
assert(validateProblemIR(problem, question).valid); checks++;
const solverResult = await new LocalDeterministicSolverProvider().solve(problem);
const audit = verifyTurnPlanAgainstSolver(problem, solverResult, rawPlan, question);
assert.equal(audit.status, "verified"); checks++;
const oldAuthority = { problemIR: problem, solverResult, audit, projection: buildSolverAuthorityProjection(problem, solverResult, audit), rawContent: "", elapsedMs: 0 };
assert(oldAuthority.projection); checks++;
const corrected = applySectionFormulaAuthority(question, rawPlan)!.plan;
assert.equal(corrected.derived.find((value) => value.id === "x_Q")?.value, 7); checks++;
const finalAuthority = refreshSolverAuthorityForPlan(oldAuthority, corrected, question);
assert.equal(finalAuthority.audit.status, "contradiction");
assert.equal(finalAuthority.projection, null);
checks += 2;
assert.equal(refreshSolverAuthorityForPlan(oldAuthority, { ...corrected, unknowns: [] }, question).audit.status, "contradiction"); checks++;
const prompt = buildTurnTeachingPrompt({ question, diagramPromptAddon: null, turnPlan: corrected, solverProjection: finalAuthority.projection, codeLesson: null, isDsa: false, familiarity: "normal", fastMode: false });
assert(!prompt.systemPrompt.includes('"approximate":4')); checks++;
const withdrawn = structuredClone(corrected); withdrawn.derived = []; withdrawn.unknowns = [];
assert.equal(refreshSolverAuthorityForPlan(oldAuthority, withdrawn, question).projection, null); checks++;
const unchanged = refreshSolverAuthorityForPlan(oldAuthority, rawPlan, question);
assert.equal(unchanged.audit.status, "verified"); assert(unchanged.projection); checks += 2;

const supportedProblem = namedProblemFor(c, "Q");
const plan = applySectionFormulaAuthority(question, { ...rawPlan, derived: [], unknowns: [] })!.plan;
const selection = selectVerifiedRepresentation({ question, problemIR: supportedProblem, turnPlan: plan });
assert.equal(selection.tier, "exact_verified"); checks++;
const presentation = buildVerifiedDiagramPresentation(selection.sceneDocument, selection.renderScene, { figureFamily: selection.family });
const turn: StoredTurn = { id: "publication_test", orderIndex: 0, question, rawResponse: "", speedMultiplier: 1, traceId: null, sceneDocument: selection.sceneDocument, sceneEngineVersion: null, validationReport: null, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", representationTier: selection.tier, turnPlan: plan }, segments: [{ id: "intro", orderIndex: 0, narration: "Verified figure", spokenText: "Verified figure", command: serializeSegmentCommands(presentation.diagram.commands.map((command) => ({ ...command, charPosition: 0, narrationBefore: "" })), { trustedDiagramGeometry: true }), audioUrl: null, durationMs: 700, timings: null }] };
assert(restoreVerifiedPresentationFromTurn(turn));
assert.equal(sourceCheckedStoredTurn(turn), turn);
assert(buildReplayTimeline([turn]).cues.some((cue) => cue.trustedDiagramGeometry)); checks += 3;
const result = selection.sceneDocument.constructions.find((construction) => construction.operator === "section_point")!.outputs[0]!;
for (const reversed of [false, true]) {
  for (const [text, valid] of [["AQ:QB=2:1", true], ["AQ:QB=1:2", false], ["BQ:QA=1:2", true], ["BQ:QA=2:1", false], ["AP:PB=2:1", false], [reversed ? "t=-1" : "t=2", true], [reversed ? "t=2" : "t=-1", false]] as const) {
    for (const hops of [1, 2]) {
      const document = structuredClone(selection.sceneDocument);
      const section = document.constructions.find((construction) => construction.operator === "section_point")!;
      if (reversed) {
        [section.inputs.a, section.inputs.b] = [section.inputs.b, section.inputs.a];
        section.inputs.m = 1; section.inputs.n = 2;
      }
      let target = result;
      for (let hop = 0; hop < hops; hop++) {
        const next = `ratio_caption_${hop}`;
        document.entities.push({ id: next, kind: "label", role: "computed caption", label: "computed" });
        document.constructions.push({ id: `make_${next}`, operator: "label", inputs: { target, text: "computed" }, outputs: [next] });
        document.requiredEntityIds.push(next); document.revealGroups[0]!.entityIds.push(next); target = next;
      }
      document.annotations.push({ id: "named_ratio", kind: "callout", targetIds: [target], text });
      const message = `${reversed ? "reversed" : "forward"} ${hops}-hop ${text}`;
      const compiled = compileSceneDocument(document);
      assert.equal(compiled.ok, valid, `${message}: ${JSON.stringify(compiled.report.issues)}`);
      const copy = structuredClone(turn); copy.sceneDocument = document;
      assert.equal(storedTurnSourceIssues(document, copy).some((issue) => issue.severity === "fatal"), !valid, message);
      assert.equal(restoreVerifiedPresentationFromTurn(copy) !== null, valid, message);
      assert.equal(sourceCheckedStoredTurn(copy).visualStatus === "retry_required", !valid, message);
      assert.equal(buildReplayTimeline([copy]).cues.some((cue) => cue.trustedDiagramGeometry), valid, message); checks += 5;
      for (const tier of ["exact_verified", "qualitative_verified", "question_representation"] as const) {
        assert.equal(Boolean(sceneSaveAdmissionFailure({ document, question, turnPlan: null, tier })), !valid, message); checks++;
      }
    }
  }
}
for (const hops of [1, 2]) {
  for (const channel of ["label", "callout", "quantity", "constructed", "entity"] as const) {
    for (const [text, valid] of [["x=7", true], ["x=99", false], ["Q=(7,8)", true], ["R=(7,8)", false], ["Q=(4,5)", false]] as const) {
      if (channel === "quantity" && !text.startsWith("x=")) continue;
      const document = structuredClone(selection.sceneDocument);
      let target = result;
      for (let hop = 0; hop < hops; hop++) {
        const next = `descendant_${hop}`;
        document.entities.push({ id: next, kind: "label", role: "computed caption", label: "computed" });
        document.constructions.push({ id: `make_${next}`, operator: "label", inputs: { target, text: "computed" }, outputs: [next] });
        document.requiredEntityIds.push(next); document.revealGroups[0]!.entityIds.push(next);
        target = next;
      }
      if (channel === "quantity") {
        document.quantities.push({ id: "descendant_value", symbol: "x", value: valid ? 7 : 99 });
        document.annotations.push({ id: "descendant_claim", kind: "label", targetIds: [target], quantityId: "descendant_value" });
      } else if (channel === "constructed") {
        document.constructions.find((construction) => construction.outputs.includes(target))!.inputs.text = text;
        if (valid) document.entities.find((entity) => entity.id === target)!.label = text;
      } else if (channel === "entity") {
        document.entities.find((entity) => entity.id === target)!.label = text;
        if (valid) document.constructions.find((construction) => construction.outputs.includes(target))!.inputs.text = text;
      }
      else document.annotations.push({ id: "descendant_claim", kind: channel, targetIds: [target], text });
      const message = `${hops}-hop ${channel} ${text}`;
      const compiled = compileSceneDocument(document);
      assert.equal(compiled.ok, valid, `${message}: ${JSON.stringify(compiled.report.issues)}`); checks++;
      const copy = structuredClone(turn); copy.sceneDocument = document;
      assert.equal(storedTurnSourceIssues(document, copy).some((issue) => issue.severity === "fatal"), !valid, message);
      assert.equal(restoreVerifiedPresentationFromTurn(copy) !== null, valid, message);
      assert.equal(sourceCheckedStoredTurn(copy).visualStatus === "retry_required", !valid, message);
      assert.equal(buildReplayTimeline([copy]).cues.some((cue) => cue.trustedDiagramGeometry), valid, message); checks += 4;
      for (const tier of ["exact_verified", "qualitative_verified", "question_representation"] as const) {
        assert.equal(Boolean(sceneSaveAdmissionFailure({ document, question, turnPlan: null, tier })), !valid, `${message}: ${tier}`); checks++;
      }
    }
  }
}
for (const mutation of ["name", "coordinate", "endpoint", "ratio", "mode"] as const) {
  const copy: StoredTurn = JSON.parse(JSON.stringify(turn));
  const document = structuredClone(selection.sceneDocument);
  const section = document.constructions.find((construction) => construction.operator === "section_point")!;
  if (mutation === "name") {
    document.entities.find((entity) => entity.id === result)!.label = "R";
    document.annotations.find((annotation) => annotation.targetIds.includes(result))!.text = "R=(7,8)";
  } else if (mutation === "coordinate") document.annotations.find((annotation) => annotation.targetIds.includes(result))!.text = "Q=(4,5)";
  else if (mutation === "endpoint") document.entities.find((entity) => entity.label === "A")!.label = "Z";
  else if (mutation === "ratio") section.inputs.m = 3;
  else section.inputs.mode = "internal";
  copy.sceneDocument = document;
  assert(storedTurnSourceIssues(document, copy).some((issue) => issue.severity === "fatal"), mutation);
  assert.equal(restoreVerifiedPresentationFromTurn(copy), null, mutation);
  assert.equal(sourceCheckedStoredTurn(copy).visualStatus, "retry_required", mutation);
  assert(!buildReplayTimeline([copy]).cues.some((cue) => cue.trustedDiagramGeometry || cue.commands.some((command) => command.type === "LABEL")), mutation);
  for (const tier of ["exact_verified", "qualitative_verified", "question_representation"] as const) {
    assert(sceneSaveAdmissionFailure({ document, question, turnPlan: null, tier }), `${mutation}: ${tier}`);
  }
  checks += 7;
}
const persisted = await canonicalizeTurnSceneMetadata({ question, sceneDocument: selection.sceneDocument, visualStatus: "validated", segments: [], sceneArtifacts: { schemaVersion: "scene-artifacts/v3", representationTier: selection.tier, problemIR: problem, solverResult, turnPlan: corrected } });
assert(!persisted.ok, "save rejects the same final solver contradiction as live selection"); checks++;
console.log(`verify-publication-authority-and-restore: ${checks} checks passed`);

}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
