/** Execute the stock lab's actual final-selection lines, then replay its JSON artifact offline. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  FIGURE_SOURCES, buildSolverAuthorityProjection, verifyTurnPlanAgainstSolver,
  validateProblemIR, validateSolverResult, validateTurnPlanV3,
  type ProblemIR, type SolverResult,
} from "@heytutor/scene-engine";
import { createFallbackTurnPlanV3, inferSceneCapabilities } from "@heytutor/tutor-core";
import { selectProductionScene, type ProductionSceneSelectionInput } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import type { LectureRun } from "../lecture-lab/lecturePipeline";

const source = readFileSync(new URL("../lecture-lab/lecturePipeline.ts", import.meta.url), "utf8");
const start = source.indexOf("    const sceneSelectionInput:");
const oldStart = source.indexOf("    const sceneSelection = selectProductionScene({");
const end = source.indexOf("    const selected = sceneSelection.representation;");
assert(end > 0 && (start > 0 || oldStart > 0), "actual stock final-selection call must be located");
const lines = source.slice(start > 0 ? start : oldStart, end);
const execute = new Function("question", "turnPlan", "problemAuthority", "sceneCapabilities", "result", "fastRepresentation",
  "planning", "solverAuthorityBlocked", "REQUIRED_DIAGRAM_RETRY_ENABLED", "FIGURE_SOURCES", "diagramStrategyAllowsFigureSource",
  "selectProductionScene", "problemAuthorityPromise", "run",
  ts.transpileModule(lines, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + "\nreturn {run,sceneSelection};");

const question = "Draw the Lewis structure of the H2O molecule with 2 O-H bonds, 0 pi bonds, 2 oxygen lone pairs and a bond angle of 104.5 degrees.";
const plan = { ...createFallbackTurnPlanV3(question),
  givens: [{ id: "bonds", symbol: "bonds", value: 2, provenance: "given" as const, sourceText: "2 O-H bonds" },
    { id: "pi", symbol: "pi bonds", value: 0, provenance: "given" as const, sourceText: "0 pi bonds" },
    { id: "angle", symbol: "angle", value: 104.5, unit: "deg", provenance: "given" as const, sourceText: "104.5 degrees" }],
  derived: [{ id: "bondElectrons", symbol: "bond electrons", value: 4, provenance: "derived" as const,
    sourceText: "2 * 2 = 4", dependsOn: ["bonds"] }],
  qualitativeClaims: [{ id: "lonePairs", claim: "Oxygen has 2 lone pairs", expected: true,
    relatedEntityHints: ["O"], relatedQuantityIds: ["bonds"] }],
};
assert(validateTurnPlanV3(plan, question).valid, "the complete synthetic plan must validate");
const evidence = (quote: string) => ({ source: "question" as const, quote, start: question.indexOf(quote), end: question.indexOf(quote) + quote.length });
const problemIR: ProblemIR = {
  schemaVersion: "problem-ir/v1", id: "water", question,
  facts: [{ id: "species", kind: "given", statement: "The subject is the H2O molecule.", evidence: evidence("H2O molecule") },
    { id: "draw", kind: "requested", statement: "Draw its Lewis structure.", evidence: evidence("Draw the Lewis structure") }],
  entities: [{ id: "molecule", kind: "body", label: "the H2O molecule", evidenceFactIds: ["species"] }],
  expressions: [], constraints: [], solveRequests: [],
  representationIntents: [{ id: "figure", kind: "conceptual", entityIds: ["molecule"], evidenceFactIds: ["draw", "species"] }],
};
assert(validateProblemIR(problemIR, question).valid, "the complete synthetic ProblemIR must validate");
const solverResult: SolverResult = { schemaVersion: "solver-result/v1", problemId: "water", providerId: "local-deterministic/v1",
  status: "solved", values: [], proofs: [], issues: [] };
assert(validateSolverResult(solverResult, problemIR).valid);
const audit = verifyTurnPlanAgainstSolver(problemIR, solverResult, plan, question);
const authority = { problemIR, solverResult, audit, projection: buildSolverAuthorityProjection(problemIR, solverResult, audit) };
type Replay = NonNullable<LectureRun["figureReplayInputs"]>;
function capture(withAuthority: boolean, attempted: boolean, extra: Partial<ProductionSceneSelectionInput> = {}): {
  run: { figureReplayInputs: Replay | null }; sceneSelection: ReturnType<typeof selectProductionScene>;
} {
  const run = { figureReplayInputs: null };
  return execute(question, plan, withAuthority ? authority : null,
    inferSceneCapabilities(question, { turnPlan: plan, problemIR: withAuthority ? problemIR : null }),
    extra.candidateValidation ? { validation: extra.candidateValidation } : null, extra.fastRepresentation ?? null,
    { figureSource: "planner", gate: { diagramStrategy: { strategy: extra.policy?.preferPlanner ? "strict" : "current" } } },
    false, true, FIGURE_SOURCES,
    (_strategy: unknown, figureSource: typeof FIGURE_SOURCES[number]) => extra.policy?.allowedFigureSources?.includes(figureSource) ?? true,
    selectProductionScene, attempted ? Promise.resolve(null) : null, run);
}
const full = capture(true, true);
assert(full.run.figureReplayInputs, "stock artifact must retain full selection inputs instead of only run.plan summaries");
const serialized = JSON.parse(JSON.stringify(full.run));
const retained = serialized.figureReplayInputs;
assert.equal(retained.schemaVersion, "lecture-figure-replay-inputs/v1");
assert.deepEqual(retained.selection.turnPlan, plan);
assert.deepEqual(retained.selection.problemIR, problemIR);
assert.deepEqual(retained.authority.solverResult, solverResult);
assert.deepEqual(retained.authority.audit, authority.audit);
assert.deepEqual(retained.authority.projection, authority.projection);
assert.equal(retained.authorityAttempted, true);
assert(validateTurnPlanV3(retained.selection.turnPlan, question).valid);
assert(validateProblemIR(retained.selection.problemIR, question).valid);
assert(validateSolverResult(retained.authority.solverResult, retained.selection.problemIR).valid);
assert.deepEqual(selectProductionScene(retained.selection), full.sceneSelection, "JSON-restored inputs reproduce the final decision exactly");
const withoutIR = selectProductionScene({ ...retained.selection, problemIR: null } satisfies ProductionSceneSelectionInput);
assert(withoutIR.representation && !full.sceneSelection.representation,
  "the full IR must preserve the chemistry obligation refusal that a null-IR replay loses");
const representation = withoutIR.representation;
const candidateValidation = { valid: true, errors: [], value: {
  document: representation.sceneDocument, renderScene: representation.renderScene, report: representation.validationReport,
} };
const strictPolicy = { preferPlanner: true, allowedFigureSources: ["planner", "text_only", "verified_recovery"] as const };
const populated = capture(false, false, { candidateValidation, fastRepresentation: representation, policy: strictPolicy });
assert(populated.run.figureReplayInputs);
assert.deepEqual(populated.run.figureReplayInputs.selection.candidateValidation, candidateValidation);
assert.deepEqual(populated.run.figureReplayInputs.selection.fastRepresentation, representation);
assert.deepEqual(populated.run.figureReplayInputs.selection.policy, strictPolicy);
const populatedJSON = JSON.parse(JSON.stringify(populated.run)).figureReplayInputs;
assert.deepEqual(populatedJSON.selection, JSON.parse(JSON.stringify(populated.run.figureReplayInputs.selection)));
assert.deepEqual(JSON.parse(JSON.stringify(selectProductionScene(populatedJSON.selection))), JSON.parse(JSON.stringify(populated.sceneSelection)));
plan.qualitativeClaims[0]!.relatedEntityHints!.push("mutated");
problemIR.entities[0]!.label = "mutated";
assert.notDeepEqual(full.run.figureReplayInputs.selection.turnPlan, plan, "capture is isolated from later plan mutation");
assert.notDeepEqual(full.run.figureReplayInputs.selection.problemIR, problemIR, "capture is isolated from later IR mutation");
for (const attempted of [false, true]) {
  const empty = JSON.parse(JSON.stringify(capture(false, attempted).run)).figureReplayInputs;
  assert.equal(empty.authority, null);
  assert.equal(empty.selection.problemIR, null);
  assert.equal(empty.authorityAttempted, attempted);
}
// Execute the actual run initializer so removing explicit early-failure null turns this red.
const syntax = ts.createSourceFile("lecturePipeline.ts", source, ts.ScriptTarget.Latest, true);
const initializers: string[] = [];
function findInitializer(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.name.getText(syntax) === "run" && node.type?.getText(syntax) === "LectureRun") {
    assert(node.initializer);
    initializers.push(node.initializer.getText(syntax));
  }
  ts.forEachChild(node, findInitializer);
}
findInitializer(syntax);
assert.equal(initializers.length, 1);
const initialize = new Function("options", "question", "familiarity", "startedAt", "stages", "dsaClassification", "createPlannerEvidence",
  ts.transpileModule(`const run = ${initializers[0]}; return run;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
assert.equal(initialize({}, question, "normal", 0, {}, { isDsa: false }, () => ({})).figureReplayInputs, null);
console.log("verify-lecture-replay-inputs: complete plan/IR, actual replay/policy/candidate/fast/projection, isolation and initialization passed");
