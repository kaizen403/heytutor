import assert from "node:assert/strict";
import { readMatrixProductSourceProgram } from "@heytutor/scene-engine";
import { matrixProductPlanningGuidance } from "../../src/planners/matrixProductGuidance";
import { planTurnV3 } from "../../src/planners/turnPlannerV3";

const question = "Let A = [[1/2, -2, 3], [4, 1/3, -1]] and B = [[2, 1], [-3, 1/2], [1, 4]]. Compute AB and BA.";
const parsed = readMatrixProductSourceProgram(question);
assert.ok(parsed, "the complete rectangular signed/fractional AB and BA source parses");
assert.equal(parsed.products.map(({ name }) => name).join(","), "AB,BA");
const guidance = matrixProductPlanningGuidance(question);
assert.ok(guidance.includes(question), "the original question is preserved exactly in guidance data");
const payloadText = guidance.split("\n").find((line) => line.startsWith("{"));
assert.ok(payloadText, "guidance carries structured source data");
const payload = JSON.parse(payloadText) as {
  matrices: Array<{ name: string; sourceQuote: string; inputCellIds: string[] }>;
  orderedProducts: Array<{ name: string; exactEntries: Array<Array<{ numerator: string; denominator: string }>> }>;
  turnPlan: {
    question: string;
    givens: Array<{ id: string; symbol: string; value: number; sourceText: string }>;
    unknowns: Array<{ id: string; symbol: string; unit?: string }>;
    derived: Array<{ id: string; symbol: string; value: number; dependsOn: string[]; sourceText: string }>;
    qualitativeClaims: unknown[];
    assumptions: unknown[];
    lawIds: unknown[];
    visualRequirement: string;
  };
};
assert.equal(payload.turnPlan.question, question);
assert.deepEqual(payload.matrices.map(({ name }) => name), ["A", "B"]);
assert.deepEqual(payload.matrices.map(({ sourceQuote }) => sourceQuote), ["A = [[1/2, -2, 3], [4, 1/3, -1]]", "B = [[2, 1], [-3, 1/2], [1, 4]]"]);
assert.equal(payload.turnPlan.givens.length, 12);
assert.deepEqual(payload.turnPlan.givens.map(({ id }) => id), payload.matrices.flatMap(({ inputCellIds }) => inputCellIds));
assert.deepEqual(payload.turnPlan.unknowns, [{ id: "AB", symbol: "AB", unit: "1" }, { id: "BA", symbol: "BA", unit: "1" }]);
assert.equal(payload.turnPlan.derived.length, 13);
assert.deepEqual(payload.orderedProducts.map(({ exactEntries }) => exactEntries.map((row) => row.map((entry) => entry.denominator === "1" ? entry.numerator : `${entry.numerator}/${entry.denominator}`))), [
  [["10", "23/2"], ["6", "1/6"]],
  [["5", "-11/3", "5"], ["1/2", "37/6", "-19/2"], ["33/2", "-2/3", "-1"]],
]);
const byId = new Map(payload.turnPlan.derived.map((row) => [row.id, row]));
assert.deepEqual(byId.get("AB11")?.dependsOn, ["A11", "A12", "A13", "B11", "B21", "B31"]);
assert.deepEqual(byId.get("BA32")?.dependsOn, ["B31", "B32", "A12", "A22"]);
assert.equal(new Set(payload.turnPlan.derived.flatMap(({ dependsOn }) => dependsOn)).size, 12);
assert.equal(payload.turnPlan.givens.every((row) => row.symbol === row.id && row.sourceText === payload.matrices.find(({ name }) => row.id.startsWith(name))?.sourceQuote), true);
assert.equal(payload.turnPlan.derived.every(({ dependsOn }) => new Set(dependsOn).size === dependsOn.length), true, "every output dependency list is deduplicated");
assert.deepEqual(payload.turnPlan.qualitativeClaims, []);
assert.deepEqual(payload.turnPlan.assumptions, []);
assert.deepEqual(payload.turnPlan.lawIds, []);
assert.equal(payload.turnPlan.visualRequirement, "optional");
assert.match(guidance, /expressions, constraints, representationIntents, and solveRequests empty/u);
assert.match(guidance, /Preserve every additional source ask/u);

const repeatedOperand = matrixProductPlanningGuidance("Let C = [[1, 2], [3, 4]]. Compute CC.");
const repeatedPayload = JSON.parse(repeatedOperand.split("\n").find((line) => line.startsWith("{"))!) as typeof payload;
assert.deepEqual(repeatedPayload.turnPlan.derived.find(({ id }) => id === "CC11")?.dependsOn, ["C11", "C12", "C21"]);

const determinantQuestion = `${question} Also determine det(A).`;
assert.equal(matrixProductPlanningGuidance(determinantQuestion), "", "an additional unsupported determinant ask declines the whole guidance");

const originalFetch = globalThis.fetch;
const requests: Array<{ lane: string | null; prompt: string }> = [];
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
  requests.push({ lane: headers.get("x-turn-planner-lane"), prompt: body.messages.find(({ role }) => role === "system")!.content });
  return new Response(JSON.stringify({ choices: [{ message: { content: "not a turn plan" } }] }), { status: 200 });
}) as typeof fetch;
try {
  await planTurnV3(question, { proxyUrl: "https://planner.invalid", timeoutMs: 100 });
} finally {
  globalThis.fetch = originalFetch;
}
assert.deepEqual(requests.map(({ lane }) => lane).sort(), ["alternate", "primary"]);
for (const request of requests) {
  assert.ok(request.prompt.includes("BOUNDED MATRIX PRODUCT SOURCE GUIDANCE"), `${request.lane} prompt includes matrix source guidance`);
  assert.ok(request.prompt.includes(question), `${request.lane} prompt contains the unchanged source question`);
}

console.log("matrix product planning guidance: passed source, product, dependency, decline, and both ordinary prompt-lane checks");
