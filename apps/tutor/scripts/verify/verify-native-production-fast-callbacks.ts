import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { validateProblemIR, validateSolverResult, verifyTurnPlanAgainstSolver, type TurnPlanV3 } from "@heytutor/scene-engine";
import type { ProblemAuthorityV1Response } from "@heytutor/tutor-core";
import * as fallback from "../../features/tutor-session/lib/scene/representationFallback";
import * as production from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { runScenePlanningOverlap, type SceneGateCore, type SceneResultShape } from "../../features/tutor-session/lib/scene/planningOverlap";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = (relative: string) => ts.createSourceFile(relative, readFileSync(path.join(app, relative), "utf8"), ts.ScriptTarget.Latest, true);
const compile = (text: string) => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
type Figure = fallback.SelectedRepresentation;
type Gate = SceneGateCore & { sceneCapabilities: { families: string[] } };
type Fast = (plan: TurnPlanV3, authority: ProblemAuthorityV1Response | null, gate: Gate, phase: "prediction" | "selection") => Figure | null;
type Native = (plan: TurnPlanV3, authority: ProblemAuthorityV1Response | null, gate: Gate) => Figure | null;
type Selection = Pick<typeof production, "selectProductionFastRepresentation">;
let raw: Figure | null = null, rawCalls = 0;
const selectionFile = path.join(app, "features/tutor-session/lib/scene/productionSceneSelection.ts");
const selectorModule: { exports: Partial<Selection> } = { exports: {} };
const selectorRequire = createRequire(selectionFile);
new Function("require", "module", "exports", compile(readFileSync(selectionFile, "utf8")))(
  (id: string) => id === "./representationFallback"
    ? { ...fallback, selectFastVerifiedRepresentation: () => { rawCalls++; return raw; } }
    : selectorRequire(id), selectorModule, selectorModule.exports,
);
assert.equal(typeof selectorModule.exports.selectProductionFastRepresentation, "function");
const admittedFast = selectorModule.exports.selectProductionFastRepresentation!;

const helperSource = source("features/tutor-session/lib/turn/doubtFigurePlan.ts");
const helper = helperSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "selectFastFigure");
assert(helper);
const helperExports: Record<string, unknown> = {};
new Function("exports", "selectProductionFastRepresentation", compile(helper.getText(helperSource)))(helperExports, admittedFast);
assert.equal(typeof helperExports.selectFastFigure, "function");

function callbacks(relative: string, question: string, enabled: boolean, native: typeof production.selectProductionNativeSourceRepresentation,
  exclusions: { doubt?: boolean; resume?: boolean; photo?: boolean } = {}): { fast: Fast; native?: Native } {
  const sf = source(relative);
  let object: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "runScenePlanningOverlap" &&
      node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) object = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(sf); assert(object);
  const fast = object.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(sf) === "selectFast");
  const spread = object.properties.find(node => ts.isSpreadAssignment(node) && node.expression.getText(sf).includes("selectNative:"));
  assert(fast && ts.isPropertyAssignment(fast));
  assert(spread && ts.isSpreadAssignment(spread));
  const script = compile(`exports.fast = (${fast.initializer.getText(sf)}); exports.optional = ({...${spread.expression.getText(sf)}});`);
  const result: { fast?: Fast; optional?: { selectNative?: Native } } = {};
  const descriptor = { schema: "scientific-style-lecture/v1", paletteId: "teal", sampleHash: "a".repeat(64) };
  new Function("exports", "question", "selectProductionFastRepresentation", "selectFastFigure", "measureSceneSelection", "tel",
    "selectProductionNativeSourceRepresentation", "options", "billed", "doubt", "resume", "isPhotoQuestion", script)(
    result, question, admittedFast, helperExports.selectFastFigure,
    (_telemetry: unknown, _name: unknown, select: () => Figure | null) => select(), null, native,
    { scientificStyle: enabled ? descriptor : null }, enabled ? { scientificStyle: descriptor } : {},
    exclusions.doubt, exclusions.resume, () => exclusions.photo === true,
  );
  assert(result.fast);
  return { fast: result.fast, ...(result.optional?.selectNative ? { native: result.optional.selectNative } : {}) };
}

async function main() {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/native-coulomb-reachability.json", import.meta.url), "utf8")) as
    { question: string; turnPlan: TurnPlanV3; problemIR: unknown; solverResult: unknown };
  const question = fixture.question, plan = fixture.turnPlan;
  const problem = validateProblemIR(fixture.problemIR, question); assert(problem.valid && problem.problem);
  const solved = validateSolverResult(fixture.solverResult, problem.problem); assert(solved.valid && solved.result);
  const authority: ProblemAuthorityV1Response = { problemIR: problem.problem, solverResult: solved.result,
    audit: verifyTurnPlanAgainstSolver(problem.problem, solved.result, plan, question), projection: null, rawContent: "", elapsedMs: 0 };
  const verified = production.selectProductionNativeSourceRepresentation(question, plan, problem.problem);
  assert(verified);
  const valid: Figure = { ...verified, figureSource: "fast_family" };
  const otherPlan = structuredClone(plan);
  otherPlan.question = question.replace("5.00 MeV", "6.00 MeV");
  const energy = otherPlan.givens.find(quantity => quantity.id === "K"); assert(energy);
  energy.value = 6; energy.sourceText = energy.sourceText?.replace("5.00", "6.00");
  const result = otherPlan.derived.find(quantity => quantity.id === "rMin"); assert(result);
  result.value = 37.92; result.sourceText = result.sourceText?.replace("5.00", "6.00");
  otherPlan.qualitativeClaims = []; otherPlan.assumptions = [];
  const otherProblem = structuredClone(problem.problem); otherProblem.question = otherPlan.question;
  for (const fact of otherProblem.facts) fact.evidence.quote = fact.evidence.quote.replace("5.00", "6.00");
  const distance = otherProblem.expressions.find(expression => expression.id === "eDistance");
  assert(distance && distance.root.kind === "binary" && distance.root.right.kind === "number" && distance.root.right.value === 5);
  distance.root.right.value = 6;
  const differentSource = production.selectProductionNativeSourceRepresentation(otherPlan.question, otherPlan, otherProblem);
  assert(differentSource, "the rejected proposal is a genuinely compiled figure for a different numeric source");
  const rejected: Figure = { ...differentSource, figureSource: "fast_family" };
  let checks = 0;
  for (const file of ["features/tutor-session/hooks/turn/useQuestionHandler.ts", "scripts/lecture-lab/lecturePipeline.ts"]) {
    for (const scenario of ["rejected_enabled", "rejected_disabled", "valid_priority", "strict_disabled", "strict_enabled"] as const) {
      let nativeCalls = 0, modelCalls = 0;
      rawCalls = 0; raw = scenario === "valid_priority" ? valid : rejected;
      const enabled = scenario === "rejected_enabled" || scenario === "valid_priority" || scenario === "strict_enabled";
      const actual = callbacks(file, question, enabled, (...args) => { nativeCalls++; return production.selectProductionNativeSourceRepresentation(...args); });
      assert.equal(Boolean(actual.native), enabled);
      const outcome = await runScenePlanningOverlap<ProblemAuthorityV1Response, Gate, Figure, SceneResultShape>({
        turnPlan: plan, problemAuthority: Promise.resolve(authority), speculationAllowed: false,
        selectionOrder: scenario.startsWith("strict") ? "planner_first" : "current", plannerStartedAt: Date.now(), deadlineMs: 60_000,
        deriveGate: () => ({ shouldPlanExactScene: true, shouldAttemptLlmScene: true, families: [], archetypeId: null, request: {}, sceneCapabilities: { families: [] } }),
        applyAuthority: (turnPlan, retainedAuthority) => ({ turnPlan, authority: retainedAuthority }), fastFigureBlocked: () => false,
        selectFast: actual.fast,
        ...(actual.native ? { selectNative: actual.native } : {}),
        planScene: async () => { modelCalls++; return null; }, revalidate: async value => value,
      });
      if (scenario === "valid_priority") {
        assert.equal(outcome.fast, valid); assert.equal(nativeCalls, 0); assert.equal(modelCalls, 0); assert.equal(rawCalls, 1);
      } else if (enabled) {
        assert.equal(outcome.figureSource, "native_source"); assert.equal(nativeCalls, 1); assert.equal(modelCalls, 0);
        assert.equal(rawCalls, scenario === "strict_enabled" ? 0 : 1);
      } else {
        assert.equal(outcome.fast, null); assert.equal(nativeCalls, 0); assert.equal(modelCalls, 1);
        assert.equal(rawCalls, scenario === "strict_disabled" ? 0 : 1);
      }
      checks++;
    }
    const disabled = callbacks(file, question, false, production.selectProductionNativeSourceRepresentation);
    assert.equal(disabled.native, undefined, "native callback remains independently opt-in"); checks++;
  }
  for (const exclusion of [{ doubt: true }, { resume: true }, { photo: true }]) {
    assert.equal(callbacks("features/tutor-session/hooks/turn/useQuestionHandler.ts", question, true,
      production.selectProductionNativeSourceRepresentation, exclusion).native, undefined); checks++;
  }
  assert.equal(production.selectProductionScene({ question, turnPlan: plan, problemIR: problem.problem, fastRepresentation: verified,
    policy: { preferPlanner: true, allowedFigureSources: ["planner"] } }).representation, null);
  assert(production.selectProductionScene({ question, turnPlan: plan, problemIR: problem.problem, fastRepresentation: verified,
    policy: { preferPlanner: true, allowedFigureSources: ["planner", "native_source"] } }).representation); checks += 2;
  console.log(`native production fast callbacks: ${checks} actual live/lab callback, admission, priority, opt-in and strict controls pass; no network`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
