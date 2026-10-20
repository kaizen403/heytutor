import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { validateLinearSourcePlan } from "../../src/compile/linearSourceAgreement";
import { buildLinearSourceDocument, readLinearSourceSetAliases } from "../../src/compile/linearRegionSource";
import { compileSceneDocument } from "../../src/compile/compiler";

const original = JSON.parse(readFileSync(new URL("./fixtures/linear-region-scalar-recordings.json", import.meta.url), "utf8"))
  .find((row: { probeId: string }) => row.probeId.includes("separated-boolean-union")) as { question: string; turnPlan: TurnPlanV3 };
const source = buildLinearSourceDocument(original.question);
assert(source && compileSceneDocument(source).ok, "Original complete set source must independently compile");
let checks = 0;
for (const provenance of ["given", "intermediate", "unknown"] as const) for (const value of [99, -1]) {
  const plan = structuredClone(original.turnPlan);
  plan.unknowns = plan.unknowns.filter(quantity => quantity.id !== "s");
  if (provenance === "given") plan.givens.push({ id: "s", symbol: "S", value, provenance: "given", sourceText: `S=${value}` });
  else {
    plan.derived.push({ id: "s", symbol: "S", value, provenance: "derived" });
    if (provenance === "unknown") plan.unknowns.push({ id: "s", symbol: "S" });
  }
  const before = JSON.stringify(plan);
  const issues = validateLinearSourcePlan(original.question, plan);
  console.log(JSON.stringify({ provenance, value, issues }));
  assert(issues.some(issue => issue.severity === "fatal"), "Original whole solution-set S never becomes a finite scalar through planner provenance");
  assert.equal(JSON.stringify(plan), before); checks += 2;
}
assert.deepEqual(validateLinearSourcePlan(original.question, original.turnPlan), [], "Symbolic S and finite source boundaries remain admissible"); checks++;
for (const [question, alias, value] of [
  ["For real x, draw the solution set T of x>=2 on a number line.", "T", 2],
  ["For real x, draw the solution set Answers of x>=2 and x<=2 on a number line.", "Answers", 2],
  ["For real x, draw the solution set S of x>=2 and x<2 on a number line.", "S", 0],
  ["For real x, let I={x:x>=1} and J={x:x<4}. Draw K=I intersect J on a number line.", "K", 1],
  ["For real x, let I={x:x>=1} and J={x:x<4}. Draw K=I intersect J on a number line.", "I", 1],
  ["Let I = [-1, 3] and J = (2, 5]. Draw I intersection J on a number line.", "I", 3],
] as const) {
  assert(buildLinearSourceDocument(question), "Complete source must independently support this variant");
  assert(readLinearSourceSetAliases(question).has(alias));
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], unknowns: [{ id: "s", symbol: alias }], derived: [{ id: "s", symbol: alias, value, provenance: "derived" }], qualitativeClaims: [], lawIds: [], assumptions: [] };
  assert(validateLinearSourcePlan(question, plan).some(issue => issue.code === "linear_source_plan_set_scalar"));
  plan.derived[0]!.symbol = "boundary"; plan.unknowns[0]!.symbol = "boundary";
  assert.deepEqual(validateLinearSourcePlan(question, plan), [], "This guard does not impose new boundary-role requirements"); checks += 4;
}
const raw = { givens: [], derived: [], unknowns: [{ symbol: "S", value: -1 }] };
assert(validateLinearSourcePlan(original.question, raw).some(issue => issue.code === "linear_source_plan_set_scalar")); checks++;
assert.equal(readLinearSourceSetAliases("Draw the solution set of x>=2 on a number line.").size, 0, "Prose 'of' never invents a set alias"); checks++;
assert.deepEqual(validateLinearSourcePlan("For real x, graph x>=2 on a number line.", { givens: [{ symbol: "S", value: 99 }] }), [], "A planner-only alias is outside this source-proved guard"); checks++;
const intervalQuestion = "Let A = [-3, 1) and B = (1, 4]. Represent A union B on a number line and state whether 1 belongs to it.";
for (const [symbol, value, sourceText, accepted] of [
  ["A", -3, "A = [-3, 1); left endpoint -3 is included.", true],
  ["B", 4, "B = (1, 4]; right endpoint 4 is included.", true],
  ["A", -3, "A = [-3, 1); lower bound -3.", true],
  ["B", 4, "B = (1, 4]; upper bound 4.", true],
  ["A", 99, "A = [-3, 1); left endpoint -3 is included.", false],
  ["A", -3, "A = [-3, 1); left endpoint -3 is excluded.", false],
  ["A", -3, "A = [-3, 1); right endpoint -3 is included.", false],
  ["A", -3, "A = [-3, 1)", false],
  ["A", -3, "A=-3", false],
] as const) {
  const issues = validateLinearSourcePlan(intervalQuestion, { givens: [{ symbol, value, sourceText }] });
  assert.equal(issues.length === 0, accepted, sourceText); checks++;
}
const ray = "Let S = [2, infinity). Draw S on a number line.";
assert(buildLinearSourceDocument(ray));
assert(validateLinearSourcePlan(ray, { givens: [{ symbol: "S", value: 2, sourceText: "S = [2, infinity)" }] }).some(issue => issue.severity === "fatal"), "A sole finite endpoint is not an endpoint role without explicit provenance"); checks += 2;
assert.deepEqual(validateLinearSourcePlan(ray, { givens: [{ symbol: "S", value: 2, sourceText: "S = [2, infinity); left endpoint 2 is included." }] }), []); checks++;
const unicodeRay = "Let S = [2, ∞). Draw S on a number line.";
assert.deepEqual(validateLinearSourcePlan(unicodeRay, { givens: [{ symbol: "S", value: 2, sourceText: "S = [2, ∞); left endpoint 2 is included." }] }), []); checks++;
for (const [question, symbol, sourceText, value, permitted] of [
  [intervalQuestion, "A", "A = [-3, 1); left endpoint -3 is included.", -3 + 5e-10, false],
  [intervalQuestion, "A", "A = [-3, 1); left endpoint -3 is included.", -3 + 2 ** -51, true],
  ["Let S = [0, 1]. Draw S on a number line.", "S", "S = [0, 1]; left endpoint 0 is included.", 1e-20, false],
  ["Let S = [1e-8, 1]. Draw S on a number line.", "S", "S = [1e-8, 1]; left endpoint 1e-8 is included.", 0, false],
] as const) {
  assert(buildLinearSourceDocument(question));
  assert.equal(validateLinearSourcePlan(question, { givens: [{ symbol, sourceText, value }] }).length === 0, permitted, "Certified source endpoints use machine-relative agreement with zero/nonzero distinction"); checks += 2;
}
console.log(`linear source set-role gate: ${checks} checks`);
