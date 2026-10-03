import { strict as assert } from "node:assert";
import { planAndSolveProblemV1 } from "../../src/planners/problemPlannerV1";
import type { ProblemIR, TurnPlanV3 } from "@heytutor/scene-engine";

const question = "Find the value of 2 + 3.";
const turnPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question,
  givens: [],
  unknowns: [{ id: "sum", symbol: "S" }],
  derived: [{
    id: "sum",
    symbol: "S",
    value: 5,
    provenance: "derived",
    sourceText: "S = 2 + 3 = 5",
  }],
  qualitativeClaims: [],
  lawIds: ["addition"],
  assumptions: [],
  visualRequirement: "optional",
};

const problem: ProblemIR = {
  schemaVersion: "problem-ir/v1",
  id: "additionCase",
  question,
  facts: [{
    id: "requestSum",
    kind: "requested",
    statement: question,
    evidence: { source: "question", start: 0, end: question.length, quote: question },
  }],
  entities: [],
  expressions: [{
    id: "sumExpression",
    valueType: "scalar",
    root: {
      kind: "binary",
      operator: "+",
      left: { kind: "number", value: 2 },
      right: { kind: "number", value: 3 },
    },
    evidenceFactIds: ["requestSum"],
  }],
  constraints: [],
  representationIntents: [],
  solveRequests: [{
    id: "solveSum",
    kind: "evaluate",
    expressionId: "sumExpression",
    resultBinding: {
      turnPlanQuantityId: "sum",
      symbol: "S",
      evidenceFactIds: ["requestSum"],
    },
  }],
};

let requestObserved = false;
const fetchImpl: typeof fetch = async (_input, init) => {
  requestObserved = true;
  const headers = new Headers(init?.headers);
  assert.equal(headers.get("x-problem-ir-version"), "1");
  const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
  assert.ok(body.messages[1]?.content.includes(JSON.stringify(turnPlan)));
  return Response.json(
    { choices: [{ message: { content: JSON.stringify(problem) } }] },
    { headers: { "x-heytutor-trace-id": "trace-problem-v1" } },
  );
};

const verified = await planAndSolveProblemV1(question, turnPlan, {
  proxyUrl: "http://localhost/api/chat",
  timeoutMs: 2_000,
  fetchImpl,
});
assert.equal(requestObserved, true);
assert.equal(verified?.audit.status, "verified");
assert.equal(verified?.solverResult.values[0]?.approximate, 5);
assert.equal(verified?.traceId, "trace-problem-v1");
assert.ok(verified?.projection);

const contradictoryPlan = structuredClone(turnPlan);
contradictoryPlan.derived[0]!.value = 6;
const contradictory = await planAndSolveProblemV1(question, contradictoryPlan, {
  proxyUrl: "http://localhost/api/chat",
  timeoutMs: 2_000,
  fetchImpl: async () => Response.json({
    choices: [{ message: { content: JSON.stringify(problem) } }],
  }),
});
assert.equal(contradictory?.audit.status, "contradiction");
assert.equal(contradictory?.projection, null);

const substitutedQuestion = structuredClone(problem);
substitutedQuestion.question = "Find the value of 9 + 9.";
const rejected = await planAndSolveProblemV1(question, turnPlan, {
  proxyUrl: "http://localhost/api/chat",
  timeoutMs: 2_000,
  fetchImpl: async () => Response.json({
    choices: [{ message: { content: JSON.stringify(substitutedQuestion) } }],
  }),
});
assert.equal(rejected, null);

const controller = new AbortController();
controller.abort();
const cancelled = await planAndSolveProblemV1(question, turnPlan, {
  proxyUrl: "http://localhost/api/chat",
  timeoutMs: 2_000,
  signal: controller.signal,
  fetchImpl: async (_input, init) => {
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return new Response(null, { status: 500 });
  },
});
assert.equal(cancelled, null);

const calculusQuestion = "A curve y=x^2 and the line y=4 enclose a region. Sketch the region, then find its area using integration.";
const calculusPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question: calculusQuestion,
  givens: [{ id: "g2", symbol: "y", value: 4, unit: "none", provenance: "given" }],
  unknowns: [{ id: "u1", symbol: "A", unit: "square units" }],
  derived: [{
    id: "u1",
    symbol: "A",
    value: 32 / 3,
    unit: "square units",
    provenance: "derived",
    sourceText: "A = 32 / 3",
  }],
  qualitativeClaims: [],
  lawIds: ["definite_integral_for_area_between_curves"],
  assumptions: [],
  visualRequirement: "required",
};
const modelDriftProblem = {
  schemaVersion: "problem-ir/v1",
  id: "curveLineArea",
  question: calculusQuestion,
  facts: [
    {
      id: "f1",
      kind: "given",
      statement: "Curve y = x^2",
      evidence: { source: "question", start: 2, end: 12, quote: "curve y=x^2" },
    },
    {
      id: "f2",
      kind: "given",
      statement: "Line y = 4",
      evidence: { source: "question", start: 17, end: 23, quote: "line y=4" },
    },
    {
      id: "f3",
      kind: "given",
      statement: "The curves enclose a region",
      evidence: {
        source: "question",
        start: 2,
        end: 38,
        quote: "curve y=x^2 and the line y=4 enclose a region",
      },
    },
    {
      id: "f5",
      kind: "requested",
      statement: "Find the area",
      evidence: { source: "question", start: 63, end: 91, quote: "find its area using integration" },
    },
    {
      id: "f6",
      kind: "assumption",
      statement: "Integrate with respect to x",
      evidence: { source: "turnPlan", start: 0, end: 0, quote: "" },
    },
  ],
  entities: [
    { id: "e1", kind: "curve", evidenceFactIds: ["f1"] },
    { id: "e2", kind: "line", evidenceFactIds: ["f2"] },
    { id: "e3", kind: "region", evidenceFactIds: ["f3", "f6"] },
  ],
  expressions: [
    {
      id: "ex1",
      valueType: "function",
      root: {
        kind: "binary",
        op: "^",
        left: { kind: "variable", name: "x" },
        right: { kind: "number", value: 2 },
      },
      evidenceFactIds: ["f1"],
    },
    {
      id: "ex2",
      valueType: "scalar",
      root: { kind: "number", value: 4 },
      evidenceFactIds: ["f2"],
    },
    {
      id: "ex3",
      valueType: "function",
      root: {
        kind: "binary",
        op: "-",
        left: { kind: "number", value: 4 },
        right: {
          kind: "binary",
          op: "^",
          left: { kind: "variable", name: "x" },
          right: { kind: "number", value: 2 },
        },
      },
      evidenceFactIds: ["f3", "f6"],
    },
    {
      id: "ex6",
      valueType: "scalar",
      root: { kind: "number", value: 32 / 3 },
      evidenceFactIds: ["d2"],
    },
  ],
  constraints: [],
  representationIntents: [{
    id: "ri1",
    kind: "graph",
    entityIds: ["e1", "e2", "e3"],
    evidenceFactIds: ["f3"],
  }],
  solveRequests: [
    {
      id: "sr1",
      kind: "roots",
      expressions: [{ id: "ex1" }, { id: "ex2" }],
    },
    {
      id: "sr2",
      kind: "definite_integral",
      integrand: { id: "ex3" },
      variable: "x",
      lowerBound: { kind: "unary", op: "-", operand: { kind: "number", value: 2 } },
      upperBound: { kind: "number", value: 2 },
      resultBinding: {
        turnPlanQuantityId: "u1",
        symbol: "A",
        unit: "square units",
        evidenceFactIds: ["f5", "f6"],
      },
    },
  ],
};
const normalizedCalculus = await planAndSolveProblemV1(calculusQuestion, calculusPlan, {
  proxyUrl: "http://localhost/api/chat",
  timeoutMs: 2_000,
  fetchImpl: async () => Response.json({
    choices: [{ message: { content: JSON.stringify(modelDriftProblem) } }],
  }),
});
assert.equal(normalizedCalculus?.audit.status, "verified");
assert.equal(normalizedCalculus?.problemIR.solveRequests.length, 1);
assert.equal(normalizedCalculus?.problemIR.solveRequests[0]?.kind, "definite_integral");
assert.equal(normalizedCalculus?.problemIR.facts.some((fact) => fact.id === "f6"), false);
assert.equal(normalizedCalculus?.problemIR.facts[0]?.evidence.end, 13);
assert.ok(Math.abs(Number(normalizedCalculus?.solverResult.values[0]?.approximate) - 32 / 3) < 1e-12);

const refractionQuestion =
  "Light enters glass at 45 degrees with n = 1.5. Find the angle of refraction and draw both rays.";
const refractionPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question: refractionQuestion,
  givens: [
    { id: "incident_angle", symbol: "theta_i", value: 45, unit: "degree", provenance: "given" },
    { id: "glass_index", symbol: "n_2", value: 1.5, unit: "none", provenance: "given" },
  ],
  unknowns: [{ id: "refracted_angle", symbol: "theta_r", unit: "degree" }],
  derived: [{
    id: "refracted_angle",
    symbol: "theta_r",
    value: 28.125505702055708,
    unit: "degree",
    provenance: "derived",
    sourceText: "theta_r = asin(sin(45 degrees) / 1.5) = 28.1 degrees",
  }],
  qualitativeClaims: [{
    id: "toward_normal",
    claim: "The refracted ray bends toward the normal in glass.",
    expected: true,
  }],
  lawIds: ["snells_law"],
  assumptions: ["The incident medium is air with refractive index 1."],
  visualRequirement: "required",
};
const refractionModelProblem = {
  schemaVersion: "problem-ir/v1",
  id: "airGlassRefraction",
  question: refractionQuestion,
  facts: [
    {
      id: "f1",
      kind: "given",
      statement: "The incidence angle is 45 degrees.",
      evidence: { source: "question", start: 22, end: 32, quote: "45 degrees" },
    },
    {
      id: "f2",
      kind: "given",
      statement: "The glass refractive index is 1.5.",
      evidence: { source: "question", start: 38, end: 45, quote: "n = 1.5" },
    },
    {
      id: "f3",
      kind: "requested",
      statement: "Find the angle of refraction.",
      evidence: { source: "question", start: 47, end: 75, quote: "Find the angle of refraction" },
    },
  ],
  entities: [
    { id: "air", kind: "region", label: "air", evidenceFactIds: ["f1"] },
    { id: "glass", kind: "region", label: "glass", evidenceFactIds: ["f2"] },
    { id: "interface", kind: "line", label: "interface", evidenceFactIds: ["f1", "f2"] },
  ],
  expressions: [{
    id: "thetaR",
    valueType: "scalar",
    root: {
      kind: "binary",
      op: "*",
      left: {
        kind: "call",
        name: "asin",
        arg: {
          kind: "binary",
          op: "/",
          left: {
            kind: "call",
            name: "sin",
            arg: {
              kind: "binary",
              op: "*",
              left: { kind: "number", value: 45 },
              right: {
                kind: "binary",
                op: "/",
                left: { kind: "number", value: Math.PI },
                right: { kind: "number", value: 180 },
              },
            },
          },
          right: { kind: "number", value: 1.5 },
        },
      },
      right: {
        kind: "binary",
        op: "/",
        left: { kind: "number", value: 180 },
        right: { kind: "number", value: Math.PI },
      },
    },
    evidenceFactIds: ["f1", "f2", "f3"],
  }],
  constraints: [],
  representationIntents: [{
    id: "rayPath",
    kind: "apparatus",
    entityIds: ["air", "glass", "interface"],
    evidenceFactIds: ["f1", "f2"],
  }],
  solveRequests: [{
    id: "solveThetaR",
    kind: "evaluate",
    expressionId: "thetaR",
    resultBinding: {
      turnPlanQuantityId: "refracted_angle",
      symbol: "theta_r",
      unit: "degree",
      evidenceFactIds: ["f3"],
    },
  }],
};
const normalizedRefraction = await planAndSolveProblemV1(refractionQuestion, refractionPlan, {
  proxyUrl: "http://localhost/api/chat",
  timeoutMs: 2_000,
  fetchImpl: async () => Response.json({
    choices: [{ message: { content: JSON.stringify(refractionModelProblem) } }],
  }),
});
assert.equal(
  normalizedRefraction?.problemIR.solveRequests.length,
  1,
  JSON.stringify({
    expressions: normalizedRefraction?.problemIR.expressions,
    solveRequests: normalizedRefraction?.problemIR.solveRequests,
  }),
);
assert.equal(normalizedRefraction?.audit.status, "verified");
assert.ok(
  Math.abs(Number(normalizedRefraction?.solverResult.values[0]?.approximate) - 28.125505702055708) < 1e-9,
);

console.log("problem planner v1 verification passed");
