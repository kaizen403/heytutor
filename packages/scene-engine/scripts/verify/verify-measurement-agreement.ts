import assert from "node:assert/strict";
import {
  validateSceneQuantityAgreement,
  validateTurnPlanV3,
  type TurnPlanV3,
} from "../../src/contracts/contractsV3";

const APIs = [{ name: "source", validateSceneQuantityAgreement, validateTurnPlanV3 }];
if (process.argv.includes("--compiled-boundary")) {
  const compiled = await import("../../dist/index.js");
  APIs.push({ name: "compiled", validateSceneQuantityAgreement: compiled.validateSceneQuantityAgreement, validateTurnPlanV3: compiled.validateTurnPlanV3 });
}
let checks = 0;
const planFor = (value: number, unit: string): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3",
  question: `A measured quantity has Q=${value} ${unit}.`,
  givens: [{ id: "measurement", symbol: "Q", value, unit, sign: value < 0 ? "negative" : value === 0 ? "zero" : "positive", provenance: "given", sourceText: `Q=${value} ${unit}` }],
  unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
});
const cases = [
  { name: "capacitance", value: 177, unit: "pF", equivalent: 0.177, equivalentUnit: "nF", wrong: 531 },
  { name: "current", value: 2, unit: "pA", equivalent: 0.002, equivalentUnit: "nA", wrong: 6 },
  { name: "signed charge", value: -3, unit: "pC", equivalent: -0.003, equivalentUnit: "nC", wrong: -9 },
  { name: "small length", value: 0.4, unit: "nm", equivalent: 4e-10, equivalentUnit: "m", wrong: 1.2 },
];
for (const api of APIs) {
  const quantity = (plan: TurnPlanV3, value: number, unit: string, accepted: boolean, foreignId = false) => {
    const issues = api.validateSceneQuantityAgreement([{ id: foreignId ? "another_measurement" : "measurement", value, unit }], plan);
    if (accepted) assert.deepEqual(issues, [], `${api.name}: correct quantity ${value} ${unit}`);
    else assert.ok(issues.some(issue => issue.code === (foreignId ? "scene_quantity_unverified" : "scene_quantity_mismatch")), `${api.name}: wrong quantity ${value} ${unit} must reject`);
    checks++;
  };
  const display = (plan: TurnPlanV3, text: string, accepted: boolean) => {
    const issues = api.validateSceneQuantityAgreement([], plan, [`Q=${text}`]);
    if (accepted) assert.deepEqual(issues, [], `${api.name}: correct or honestly rounded display ${text}`);
    else assert.ok(issues.some(issue => issue.code === "displayed_quantity_unverified"), `${api.name}: wrong display ${text} must reject`);
    checks++;
  };
  const claim = (plan: TurnPlanV3, text: string, accepted: boolean) => {
    const result = api.validateTurnPlanV3({ ...plan, qualitativeClaims: [{ id: "measurement_claim", claim: `Q=${text}`, expected: true, relatedQuantityIds: ["measurement"] }] }, plan.question);
    if (accepted) assert.equal(result.valid, true, `${api.name}: correct or honestly rounded claim ${text}: ${JSON.stringify(result.issues)}`);
    else assert.ok(result.issues.some(issue => issue.code === "claim_quantity_mismatch"), `${api.name}: wrong claim ${text} must reject`);
    checks++;
  };
  for (const row of cases) {
    const plan = planFor(row.value, row.unit);
    assert.equal(api.validateTurnPlanV3(plan, plan.question).valid, true, `${api.name}: valid ${row.name} given`);
    checks++;
    quantity(plan, row.value, row.unit, true);
    quantity(plan, row.equivalent, row.equivalentUnit, true);
    quantity(plan, row.equivalent, row.equivalentUnit, true, true);
    quantity(plan, row.wrong, row.unit, false);
    quantity(plan, row.wrong, row.unit, false, true);
    quantity(plan, -row.value, row.unit, false);
    quantity(plan, row.value * (1 + 5e-10), row.unit, true);
    quantity(plan, row.value * (1 + 1e-6), row.unit, false);
    display(plan, `${row.value} ${row.unit}`, true);
    display(plan, `${row.equivalent} ${row.equivalentUnit}`, true);
    display(plan, `${row.wrong} ${row.unit}`, false);
    display(plan, `${-row.value} ${row.unit}`, false);
    claim(plan, `${row.value} ${row.unit}`, true);
    claim(plan, `${row.equivalent} ${row.equivalentUnit}`, true);
    claim(plan, `${row.wrong} ${row.unit}`, false);
    claim(plan, `${-row.value} ${row.unit}`, false);
  }
  const zero = planFor(0, "pF");
  const tiny = planFor(0.1, "pF");
  quantity(zero, 0, "nF", true);
  quantity(zero, 0.1, "pF", false);
  quantity(tiny, 0, "pF", false);
  display(zero, "1 pF", false);
  display(planFor(1, "pF"), "0 pF", false);
  claim(zero, "1 pF", false);
  claim(planFor(1, "pF"), "0 pF", false);
  // Zero ink can honestly round a nonzero value within its written place.
  display(tiny, "0 pF", true);
  claim(tiny, "0 pF", true);
  const rounded = planFor(177.2, "pF");
  quantity(rounded, 177, "pF", false);
  display(rounded, "177 pF", true);
  claim(rounded, "177 pF", true);
  const recurring = planFor(32 / 3, "m");
  quantity(recurring, 10.666666666666668, "m", true);
  quantity(recurring, 10.667, "m", false);
  display(recurring, "10.667 m", true);
  claim(recurring, "10.667 m", true);
  display(planFor(177, "pF"), "177 pA", false);
  claim(planFor(177, "pF"), "531 pF", false);
  // Claims retain their existing three-figure truncation policy. Diagram
  // labels and stored quantities still require rounding/exact agreement.
  for (const sign of [1, -1]) {
    const truncated = planFor(sign * 177.7, "pF");
    quantity(truncated, sign * 177, "pF", false);
    display(truncated, `${sign * 177} pF`, false);
    claim(truncated, `${sign * 177} pF`, true);
    claim(planFor(sign * 178, "pF"), `${sign * 177} pF`, false);
    claim(planFor(sign * 176.4, "pF"), `${sign * 177} pF`, false);
    claim(planFor(sign * 17.7, "pF"), `${sign * 17} pF`, false);
  }
}
console.log(`measurement agreement: ${checks} checks passed across ${APIs.map(api => api.name).join(" + ")}; tiny values, signs, zero, cross-unit equality and authored rounding`);
