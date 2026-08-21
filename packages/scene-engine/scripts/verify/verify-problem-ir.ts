import { strict as assert } from "node:assert";
import {
  PROBLEM_IR_VERSION,
  validateProblemIR,
  type ExpressionNodeIR,
  type ProblemIR,
  type QuestionSourceEvidence,
} from "../../src/ir/problemIR";
import {
  LocalDeterministicSolverProvider,
  SOLVER_RESULT_VERSION,
  solveWithDeadline,
  validateSolverResult,
  type SolverProvider,
} from "../../src/ir/solver";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateSceneDocument } from "../../src/document/validation";
import { verifyTurnPlanAgainstSolver } from "../../src/ir/solverAuthority";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import type { SceneDocument } from "../../src/types";

const question = "A curve y=x^2 and the line y=4 enclose a region. Sketch the region, then find its area using integration.";

function evidence(quote: string): QuestionSourceEvidence {
  const start = question.indexOf(quote);
  if (start < 0) throw new Error(`missing fixture quote: ${quote}`);
  return { source: "question", start, end: start + quote.length, quote };
}

const x: ExpressionNodeIR = { kind: "variable", name: "x" };
const xSquared: ExpressionNodeIR = { kind: "binary", operator: "^", left: x, right: { kind: "number", value: 2 } };
const four: ExpressionNodeIR = { kind: "number", value: 4 };

const problem: ProblemIR = {
  schemaVersion: PROBLEM_IR_VERSION,
  id: "calculusArea",
  question,
  facts: [
    { id: "curveFact", kind: "given", statement: "The curve is y=x^2.", evidence: evidence("y=x^2") },
    { id: "lineFact", kind: "given", statement: "The line is y=4.", evidence: evidence("y=4") },
    { id: "areaFact", kind: "requested", statement: "Find the enclosed area using integration.", evidence: evidence("find its area using integration") },
    { id: "sketchFact", kind: "requested", statement: "Sketch the enclosed region.", evidence: evidence("Sketch the region") },
  ],
  entities: [
    { id: "parabola", kind: "curve", label: "y=x^2", evidenceFactIds: ["curveFact"] },
    { id: "ceiling", kind: "line", label: "y=4", evidenceFactIds: ["lineFact"] },
    { id: "region", kind: "region", evidenceFactIds: ["curveFact", "lineFact", "sketchFact"] },
  ],
  expressions: [
    { id: "curveExpression", valueType: "function", root: xSquared, evidenceFactIds: ["curveFact"] },
    { id: "lineExpression", valueType: "function", root: four, evidenceFactIds: ["lineFact"] },
    {
      id: "intersectionExpression",
      valueType: "function",
      root: { kind: "binary", operator: "-", left: xSquared, right: four },
      evidenceFactIds: ["curveFact", "lineFact"],
    },
    {
      id: "areaExpression",
      valueType: "function",
      root: { kind: "binary", operator: "-", left: four, right: xSquared },
      evidenceFactIds: ["curveFact", "lineFact", "areaFact"],
    },
    { id: "constantExpression", valueType: "scalar", root: { kind: "binary", operator: "/", left: { kind: "number", value: 8 }, right: { kind: "number", value: 2 } }, evidenceFactIds: ["lineFact"] },
  ],
  constraints: [
    { id: "curveMeetsLine", kind: "equation", leftExpressionId: "curveExpression", rightExpressionId: "lineExpression", evidenceFactIds: ["curveFact", "lineFact"] },
  ],
  representationIntents: [
    { id: "drawRegion", kind: "bounded_region", entityIds: ["parabola", "ceiling", "region"], evidenceFactIds: ["curveFact", "lineFact", "sketchFact"] },
  ],
  solveRequests: [
    { id: "findRoots", kind: "roots", expressionId: "intersectionExpression", variable: "x", domain: { min: -10, max: 10 } },
    { id: "findIntersections", kind: "intersections", leftExpressionId: "curveExpression", rightExpressionId: "lineExpression", variable: "x", domain: { min: -10, max: 10 } },
    {
      id: "findArea",
      kind: "definite_integral",
      expressionId: "areaExpression",
      variable: "x",
      lower: -2,
      upper: 2,
      resultBinding: {
        turnPlanQuantityId: "area",
        symbol: "A",
        unit: "square units",
        evidenceFactIds: ["areaFact"],
      },
    },
    { id: "evaluateConstant", kind: "evaluate", expressionId: "constantExpression" },
  ],
};

const validated = validateProblemIR(structuredClone(problem));
assert.equal(validated.valid, true, JSON.stringify(validated.issues));
assert.ok(validated.problem);

const provider = new LocalDeterministicSolverProvider();
const result = await provider.solve(structuredClone(problem));
assert.equal(result.status, "solved", JSON.stringify(result.issues));
assert.equal(result.schemaVersion, SOLVER_RESULT_VERSION);
assert.equal(validateSolverResult(result, problem).valid, true);

const roots = result.values.find((value) => value.requestId === "findRoots");
assert.deepEqual(roots?.approximate, [-2, 2]);
assert.deepEqual(roots?.exact, [
  { kind: "integer", value: "-2" },
  { kind: "integer", value: "2" },
]);

const intersections = result.values.find((value) => value.requestId === "findIntersections");
assert.deepEqual(intersections?.approximate, [-2, 2]);

const area = result.values.find((value) => value.requestId === "findArea");
assert.equal(area?.exact && !Array.isArray(area.exact) ? area.exact.value : undefined, "32/3");
assert.ok(typeof area?.approximate === "number" && Math.abs(area.approximate - 32 / 3) < 1e-12);

const constant = result.values.find((value) => value.requestId === "evaluateConstant");
assert.equal(constant?.exact && !Array.isArray(constant.exact) ? constant.exact.value : undefined, "4");

const areaTurnPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question,
  givens: [],
  unknowns: [{ id: "area", symbol: "A", unit: "square units" }],
  derived: [{
    id: "area",
    symbol: "A",
    value: 32 / 3,
    unit: "square units",
    provenance: "derived",
    sourceText: "A = 32/3 square units",
  }],
  qualitativeClaims: [],
  lawIds: ["definite-integral"],
  assumptions: [],
  visualRequirement: "required",
};
assert.equal(verifyTurnPlanAgainstSolver(problem, result, areaTurnPlan, question).status, "verified");
const contradictoryPlan = structuredClone(areaTurnPlan);
contradictoryPlan.derived[0]!.value = 999;
assert.equal(verifyTurnPlanAgainstSolver(problem, result, contradictoryPlan, question).status, "contradiction");
const wrongUnitPlan = structuredClone(areaTurnPlan);
wrongUnitPlan.unknowns[0]!.unit = "cm";
wrongUnitPlan.derived[0]!.unit = "cm";
assert.ok(verifyTurnPlanAgainstSolver(problem, result, wrongUnitPlan, question).issues.some((issue) => issue.code === "unit_mismatch"));
const unboundProblem = structuredClone(problem);
const unboundArea = unboundProblem.solveRequests.find((request) => request.id === "findArea");
if (!unboundArea) throw new Error("missing area request");
delete unboundArea.resultBinding;
assert.equal(verifyTurnPlanAgainstSolver(unboundProblem, result, areaTurnPlan, question).status, "incomplete");
assert.ok(validateProblemIR(problem, "a different question").issues.some((issue) => issue.code === "question_mismatch"));

const exactRootValues = roots?.approximate;
assert.ok(Array.isArray(exactRootValues) && exactRootValues.length === 2);
const [leftRoot, rightRoot] = exactRootValues;
assert.equal(typeof leftRoot, "number");
assert.equal(typeof rightRoot, "number");
const exactScene: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "render the solver-verified bounded region" },
  source: {
    question,
    problemId: problem.id,
    solverProviderId: result.providerId,
    representationTier: "exact_verified",
  },
  quantities: [{
    id: "verified_area",
    value: area?.approximate,
    exact: area?.exact,
    unit: "square units",
    provenance: "solver-result/v1",
  }],
  entities: [
    { id: "axes", kind: "axes", role: "coordinate axes" },
    { id: "parabola_curve", kind: "polyline", role: "lower boundary", label: "y=x^2" },
    { id: "line_curve", kind: "polyline", role: "upper boundary", label: "y=4" },
    { id: "bounded_region", kind: "polygon", role: "verified enclosed region" },
    { id: "slice", kind: "segment", role: "representative integration slice" },
    { id: "left_intersection", kind: "point", role: "verified intersection", label: "(-2,4)" },
    { id: "right_intersection", kind: "point", role: "verified intersection", label: "(2,4)" },
  ],
  constructions: [
    { id: "make_axes", operator: "axes", inputs: { xMin: -3, xMax: 3, yMin: -1, yMax: 5 }, outputs: ["axes"] },
    { id: "make_parabola", operator: "function_curve", inputs: { expression: "x^2", variable: "x", xMin: leftRoot, xMax: rightRoot, samples: 65 }, outputs: ["parabola_curve"] },
    { id: "make_line", operator: "function_curve", inputs: { expression: "4", variable: "x", xMin: leftRoot, xMax: rightRoot, samples: 65 }, outputs: ["line_curve"] },
    { id: "make_region", operator: "function_region", inputs: { upper: "line_curve", lower: "parabola_curve", xMin: leftRoot, xMax: rightRoot, samples: 65 }, outputs: ["bounded_region"] },
    { id: "make_slice", operator: "representative_slice", inputs: { upper: "line_curve", lower: "parabola_curve", atX: 0 }, outputs: ["slice"] },
    { id: "make_left_intersection", operator: "point", inputs: { x: leftRoot, y: 4 }, outputs: ["left_intersection"] },
    { id: "make_right_intersection", operator: "point", inputs: { x: rightRoot, y: 4 }, outputs: ["right_intersection"] },
  ],
  relations: [],
  assertions: [
    { id: "left_on_parabola", predicate: "function_value", entities: ["parabola_curve"], expected: { x: leftRoot, y: 4 }, severity: "fatal" },
    { id: "right_on_parabola", predicate: "function_value", entities: ["parabola_curve"], expected: { x: rightRoot, y: 4 }, severity: "fatal" },
    { id: "left_on_line", predicate: "function_value", entities: ["line_curve"], expected: { x: leftRoot, y: 4 }, severity: "fatal" },
    { id: "right_on_line", predicate: "function_value", entities: ["line_curve"], expected: { x: rightRoot, y: 4 }, severity: "fatal" },
  ],
  annotations: [],
  requiredEntityIds: ["axes", "parabola_curve", "line_curve", "bounded_region", "slice", "left_intersection", "right_intersection"],
  revealGroups: [
    { id: "curves", entityIds: ["axes", "parabola_curve", "line_curve"], dependsOn: [], narrationCue: "Sketch the two stated boundaries." },
    { id: "region", entityIds: ["bounded_region", "left_intersection", "right_intersection", "slice"], dependsOn: ["curves"], narrationCue: "Reveal the verified intersections, enclosed region, and representative slice." },
  ],
  teachingTimeline: [
    { id: "reveal_curves", action: "reveal", targetId: "curves", dependsOn: [], narrationIntent: "First sketch the parabola and horizontal line." },
    { id: "reveal_region", action: "reveal", targetId: "region", dependsOn: ["reveal_curves"], narrationIntent: "Their solver-verified intersections bound the shaded integration region." },
  ],
};
const exactSceneValidation = validateSceneDocument(exactScene);
assert.ok(exactSceneValidation.document, JSON.stringify(exactSceneValidation.report.issues));
const exactSceneCompile = compileSceneDocument(exactSceneValidation.document);
assert.equal(exactSceneCompile.ok, true, JSON.stringify(exactSceneCompile.report.issues));
assert.equal(
  exactSceneCompile.renderScene?.primitives.find((primitive) => primitive.entityId === "bounded_region")?.points.length,
  130,
  "the verified region must sample both 65-point boundaries",
);
assert.equal(
  exactSceneCompile.renderScene?.primitives.filter((primitive) =>
    primitive.entityId === "left_intersection" || primitive.entityId === "right_intersection").length,
  4,
  "both verified intersections and their labels must render",
);

const swappedExactScene = structuredClone(exactScene);
const swappedRegion = swappedExactScene.constructions.find((construction) => construction.id === "make_region");
if (!swappedRegion) throw new Error("missing exact region fixture");
[swappedRegion.inputs.upper, swappedRegion.inputs.lower] = [swappedRegion.inputs.lower, swappedRegion.inputs.upper];
assert.ok(
  validateSceneDocument(swappedExactScene).report.issues.some((issue) => issue.code === "invalid_function_region_order"),
  "swapped exact region boundaries must be rejected before compilation",
);

const missingArrays = validateProblemIR({ schemaVersion: PROBLEM_IR_VERSION, id: "bad", question });
assert.equal(missingArrays.valid, false);
assert.ok(missingArrays.issues.some((issue) => issue.code === "missing_array"));

const ungrounded = structuredClone(problem);
ungrounded.facts[0]!.evidence.quote = "y=x^3";
assert.ok(validateProblemIR(ungrounded).issues.some((issue) => issue.code === "ungrounded_fact"));

const unknownEvidence = structuredClone(problem);
unknownEvidence.expressions[0]!.evidenceFactIds = ["inventedFact"];
assert.ok(validateProblemIR(unknownEvidence).issues.some((issue) => issue.code === "unknown_reference"));

const adversarial = structuredClone(problem) as unknown as Record<string, unknown>;
const adversarialExpressions = adversarial.expressions as Array<Record<string, unknown>>;
adversarialExpressions[0]!.root = { kind: "call", function: "constructor", argument: { kind: "number", value: 1 } };
assert.ok(validateProblemIR(adversarial).issues.some((issue) => issue.code === "invalid_expression_tree"));

const injectedVariable = structuredClone(problem) as unknown as Record<string, unknown>;
const injectedExpressions = injectedVariable.expressions as Array<Record<string, unknown>>;
injectedExpressions[0]!.root = { kind: "variable", name: "globalThis.process" };
assert.ok(validateProblemIR(injectedVariable).issues.some((issue) => issue.code === "invalid_expression_tree"));

const oversizedDomain = structuredClone(problem);
const rootsRequest = oversizedDomain.solveRequests[0];
if (rootsRequest?.kind !== "roots") throw new Error("invalid fixture");
rootsRequest.domain = { min: -1e12, max: 1e12 };
assert.ok(validateProblemIR(oversizedDomain).issues.some((issue) => issue.code === "invalid_domain"));

const forgedResult = structuredClone(result);
forgedResult.proofs[0]!.residual = forgedResult.proofs[0]!.tolerance + 1;
assert.ok(validateSolverResult(forgedResult, problem).issues.some((issue) => issue.code === "invalid_residual"));

const contradictoryExactResult = structuredClone(result);
const contradictoryArea = contradictoryExactResult.values.find((value) => value.requestId === "findArea");
if (!contradictoryArea) throw new Error("missing area fixture result");
contradictoryArea.exact = { kind: "integer", value: "999" };
assert.ok(validateSolverResult(contradictoryExactResult, problem).issues.some((issue) => issue.code === "exact_approximate_mismatch"));

const missingProof = structuredClone(result);
missingProof.proofs = missingProof.proofs.filter((proof) => proof.requestId !== "findArea");
assert.ok(validateSolverResult(missingProof, problem).issues.some((issue) => issue.code === "missing_proof"));

const domainRestrictedProblem = structuredClone(problem);
const domainRestrictedRequest = domainRestrictedProblem.solveRequests.find((request) => request.id === "findRoots");
if (!domainRestrictedRequest || domainRestrictedRequest.kind !== "roots") throw new Error("missing roots request");
domainRestrictedRequest.domain = { min: 0, max: 10 };
const domainRestrictedResult = await provider.solve(domainRestrictedProblem);
const domainRestrictedRoots = domainRestrictedResult.values.find((value) => value.requestId === "findRoots");
assert.deepEqual(domainRestrictedRoots?.approximate, [2]);
assert.deepEqual(domainRestrictedRoots?.exact, [{ kind: "integer", value: "2" }]);

const oscillatoryQuestion = "Evaluate the definite integral of cos(4096*pi*x) from x=0 to x=1.";
const oscillatoryQuote = "cos(4096*pi*x)";
const oscillatoryStart = oscillatoryQuestion.indexOf(oscillatoryQuote);
if (oscillatoryStart < 0) throw new Error("missing oscillatory fixture quote");
const oscillatoryProblem: ProblemIR = {
  schemaVersion: PROBLEM_IR_VERSION,
  id: "oscillatoryIntegral",
  question: oscillatoryQuestion,
  facts: [{
    id: "integrandFact",
    kind: "given",
    statement: "The integrand is cos(4096*pi*x).",
    evidence: {
      source: "question",
      start: oscillatoryStart,
      end: oscillatoryStart + oscillatoryQuote.length,
      quote: oscillatoryQuote,
    },
  }],
  entities: [],
  expressions: [{
    id: "oscillatoryExpression",
    valueType: "function",
    root: {
      kind: "call",
      function: "cos",
      argument: {
        kind: "binary",
        operator: "*",
        left: {
          kind: "binary",
          operator: "*",
          left: { kind: "number", value: 4096 },
          right: { kind: "constant", name: "pi" },
        },
        right: { kind: "variable", name: "x" },
      },
    },
    evidenceFactIds: ["integrandFact"],
  }],
  constraints: [],
  representationIntents: [],
  solveRequests: [{
    id: "oscillatoryArea",
    kind: "definite_integral",
    expressionId: "oscillatoryExpression",
    variable: "x",
    lower: 0,
    upper: 1,
  }],
};
const oscillatoryResult = await provider.solve(oscillatoryProblem);
assert.equal(oscillatoryResult.status, "solved", JSON.stringify(oscillatoryResult.issues));
const oscillatoryArea = oscillatoryResult.values.find((value) => value.requestId === "oscillatoryArea");
assert.deepEqual(oscillatoryArea?.exact, { kind: "integer", value: "0" });
assert.equal(oscillatoryArea?.approximate, 0);

const nonzeroTrigProblem = structuredClone(oscillatoryProblem);
nonzeroTrigProblem.id = "nonzeroTrigIntegral";
nonzeroTrigProblem.question = "Evaluate the definite integral of sin(pi*x) from x=0 to x=1.";
nonzeroTrigProblem.facts[0] = {
  id: "integrandFact",
  kind: "given",
  statement: "The integrand is sin(pi*x).",
  evidence: {
    source: "question",
    start: nonzeroTrigProblem.question.indexOf("sin(pi*x)"),
    end: nonzeroTrigProblem.question.indexOf("sin(pi*x)") + "sin(pi*x)".length,
    quote: "sin(pi*x)",
  },
};
nonzeroTrigProblem.expressions[0]!.root = {
  kind: "call",
  function: "sin",
  argument: {
    kind: "binary",
    operator: "*",
    left: { kind: "constant", name: "pi" },
    right: { kind: "variable", name: "x" },
  },
};
const nonzeroTrigResult = await provider.solve(nonzeroTrigProblem);
assert.equal(nonzeroTrigResult.status, "solved", JSON.stringify(nonzeroTrigResult.issues));
const nonzeroTrigArea = nonzeroTrigResult.values.find((value) => value.requestId === "oscillatoryArea");
assert.deepEqual(nonzeroTrigArea?.exact, { kind: "symbolic", value: "(2)/(pi)" });
assert.ok(Math.abs(Number(nonzeroTrigArea?.approximate) - 2 / Math.PI) < 1e-12);
assert.ok(Number(nonzeroTrigArea?.errorBound) > 0);

const tangentialQuestion = "Solve (sin(x)-0.1)^2 = 0 on 0 <= x <= pi.";
const tangentialQuote = "(sin(x)-0.1)^2";
const tangentialStart = tangentialQuestion.indexOf(tangentialQuote);
if (tangentialStart < 0) throw new Error("missing tangential fixture quote");
const tangentialProblem: ProblemIR = {
  schemaVersion: PROBLEM_IR_VERSION,
  id: "tangentialRoots",
  question: tangentialQuestion,
  facts: [{
    id: "equationFact",
    kind: "requested",
    statement: "Solve (sin(x)-0.1)^2 = 0.",
    evidence: {
      source: "question",
      start: tangentialStart,
      end: tangentialStart + tangentialQuote.length,
      quote: tangentialQuote,
    },
  }],
  entities: [],
  expressions: [{
    id: "tangentialExpression",
    valueType: "function",
    root: {
      kind: "binary",
      operator: "^",
      left: {
        kind: "binary",
        operator: "-",
        left: {
          kind: "call",
          function: "sin",
          argument: { kind: "variable", name: "x" },
        },
        right: { kind: "number", value: 0.1 },
      },
      right: { kind: "number", value: 2 },
    },
    evidenceFactIds: ["equationFact"],
  }],
  constraints: [],
  representationIntents: [],
  solveRequests: [{
    id: "findTangentialRoots",
    kind: "roots",
    expressionId: "tangentialExpression",
    variable: "x",
    domain: { min: 0, max: Math.PI },
  }],
};
const tangentialResult = await provider.solve(tangentialProblem);
assert.equal(tangentialResult.status, "solved", JSON.stringify(tangentialResult.issues));
const tangentialRoots = tangentialResult.values.find((value) => value.requestId === "findTangentialRoots");
assert.ok(Array.isArray(tangentialRoots?.approximate));
assert.equal(tangentialRoots?.approximate.length, 2);
assert.ok(Math.abs(tangentialRoots!.approximate[0]! - Math.asin(0.1)) < 1e-9);
assert.ok(Math.abs(tangentialRoots!.approximate[1]! - (Math.PI - Math.asin(0.1))) < 1e-9);
assert.deepEqual(tangentialRoots?.exact, [
  { kind: "symbolic", value: "asin(1/10)" },
  { kind: "symbolic", value: "pi-asin(1/10)" },
]);

const duplicateFamilyProblem = structuredClone(tangentialProblem);
duplicateFamilyProblem.id = "deduplicatedTrigFamilies";
duplicateFamilyProblem.question = "Solve sin(x)-1 = 0 on 0 <= x <= 1000.";
duplicateFamilyProblem.facts[0] = {
  id: "equationFact",
  kind: "requested",
  statement: "Solve sin(x)-1 = 0.",
  evidence: {
    source: "question",
    start: duplicateFamilyProblem.question.indexOf("sin(x)-1"),
    end: duplicateFamilyProblem.question.indexOf("sin(x)-1") + "sin(x)-1".length,
    quote: "sin(x)-1",
  },
};
duplicateFamilyProblem.expressions[0]!.root = {
  kind: "binary",
  operator: "-",
  left: {
    kind: "call",
    function: "sin",
    argument: { kind: "variable", name: "x" },
  },
  right: { kind: "number", value: 1 },
};
const duplicateFamilyRequest = duplicateFamilyProblem.solveRequests[0];
if (!duplicateFamilyRequest || duplicateFamilyRequest.kind !== "roots") throw new Error("missing duplicate-family roots request");
duplicateFamilyRequest.domain = { min: 0, max: 1000 };
const duplicateFamilyResult = await provider.solve(duplicateFamilyProblem);
assert.equal(duplicateFamilyResult.status, "solved", JSON.stringify(duplicateFamilyResult.issues));
const duplicateFamilyRoots = duplicateFamilyResult.values.find((value) => value.requestId === "findTangentialRoots");
assert.ok(Array.isArray(duplicateFamilyRoots?.approximate));
assert.equal(duplicateFamilyRoots.approximate.length, 159);

const excessiveRootsProblem = structuredClone(tangentialProblem);
excessiveRootsProblem.id = "excessiveTrigRoots";
excessiveRootsProblem.question = "Solve sin(1000000000000*x) = 0 on 0 <= x <= 1.";
excessiveRootsProblem.facts[0] = {
  id: "equationFact",
  kind: "requested",
  statement: "Solve sin(1000000000000*x) = 0.",
  evidence: {
    source: "question",
    start: excessiveRootsProblem.question.indexOf("sin(1000000000000*x)"),
    end: excessiveRootsProblem.question.indexOf("sin(1000000000000*x)") + "sin(1000000000000*x)".length,
    quote: "sin(1000000000000*x)",
  },
};
excessiveRootsProblem.expressions[0]!.root = {
  kind: "call",
  function: "sin",
  argument: {
    kind: "binary",
    operator: "*",
    left: { kind: "number", value: 1e12 },
    right: { kind: "variable", name: "x" },
  },
};
const excessiveRootsRequest = excessiveRootsProblem.solveRequests[0];
if (!excessiveRootsRequest || excessiveRootsRequest.kind !== "roots") throw new Error("missing excessive roots request");
excessiveRootsRequest.domain = { min: 0, max: 1 };
const excessiveRootsResult = await provider.solve(excessiveRootsProblem);
assert.equal(excessiveRootsResult.status, "failed");
assert.ok(excessiveRootsResult.issues.some((issue) => issue.message.includes("root count exceeds")));

const greekProblem = structuredClone(problem);
const greekBinding = greekProblem.solveRequests.find((request) => request.id === "findArea");
if (!greekBinding || greekBinding.kind !== "definite_integral" || !greekBinding.resultBinding) {
  throw new Error("missing Greek symbol binding fixture");
}
greekBinding.resultBinding.turnPlanQuantityId = "phase";
greekBinding.resultBinding.symbol = "φ";
greekBinding.resultBinding.unit = "square units";
const greekPlan: TurnPlanV3 = {
  ...areaTurnPlan,
  unknowns: [{ id: "phase", symbol: "θ", unit: "square units" }],
  derived: [{
    id: "phase",
    symbol: "θ",
    value: 32 / 3,
    unit: "square units",
    provenance: "derived",
    sourceText: "θ = 32/3 square units",
  }],
};
assert.equal(
  verifyTurnPlanAgainstSolver(greekProblem, result, greekPlan, question).status,
  "contradiction",
  "Greek symbol mismatches must remain distinct during solver authority checks",
);

const invalidProblemResult = await provider.solve(adversarial);
assert.equal(invalidProblemResult.status, "failed");
assert.equal(invalidProblemResult.values.length, 0);

const hangingProvider: SolverProvider = {
  id: "hanging-test-provider",
  solve: async () => await new Promise(() => undefined),
};
const timedOut = await solveWithDeadline(hangingProvider, problem, 5);
assert.equal(timedOut.status, "failed");
assert.ok(timedOut.issues.some((issue) => issue.code === "deadline_exceeded"));

console.log("problem-ir and local deterministic solver verification passed");
