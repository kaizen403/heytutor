import assert from "node:assert/strict";
import { validateTurnPlanV3 } from "@heytutor/scene-engine";
import { planTurnV3 } from "../../src/planners/turnPlannerV3";

const question = "Derive the formula for the range of a projectile on level ground, and show why 45° gives the maximum range.";
const originalFetch = globalThis.fetch;
const plan = {
  schemaVersion: "turn-plan/v3",
  question,
  givens: [
    { id: "speed", symbol: "u", value: "initial speed", provenance: "given" },
    { id: "angle", symbol: "theta", value: "launch angle", provenance: "given" },
  ],
  unknowns: [{ id: "range", symbol: "R", unit: "m" }, { id: "maximum_angle", symbol: "theta_max", unit: "deg" }],
  derived: [
    { id: "range_formula", symbol: "R", value: "u^2 * sin(2 * theta) / g", unit: "m", provenance: "derived", sourceText: "Combine horizontal and vertical motion." },
    { id: "maximum_angle", symbol: "theta_max", value: 45, unit: "deg", provenance: "derived" },
  ],
  qualitativeClaims: [{ id: "level_ground", claim: "Launch and landing are at the same height", expected: true }],
  lawIds: ["constant-acceleration", "double-angle-identity"],
  assumptions: ["Air resistance is negligible"],
  visualRequirement: "optional",
};

async function request(raw: unknown, submittedQuestion = question) {
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify(raw) } }] });
  return planTurnV3(submittedQuestion, { proxyUrl: "https://planner.test", timeoutMs: 1000 });
}

try {
  const response = await request(plan);
  assert(response, "a formula derivation must retain a usable teaching plan");
  assert.equal(validateTurnPlanV3(response.turnPlan, question).valid, true);
  assert.equal(response.turnPlan.givens.length, 0, "symbolic parameters must not become numeric givens");
  assert.equal(response.turnPlan.derived.length, 1, "a formula must not become a numeric answer");
  assert.equal(response.turnPlan.derived[0]?.value, 45);
  assert(response.turnPlan.qualitativeClaims.some((claim) =>
    claim.expected === "u^2 * sin(2 * theta) / g" && claim.relatedQuantityIds?.includes("range")),
  "the symbolic result must remain linked to its requested unknown");

  const numericQuestion = "A projectile launches at 20 m/s and 30 degrees. Find its range.";
  assert.equal(await request({ ...plan, question: numericQuestion }, numericQuestion), null,
    "a numeric solve must not accept a symbolic formula instead of its answer");

  const mixedQuestion = "Derive the formula for projectile range and find the range for a speed of 20 m/s.";
  assert.equal(await request({
    ...plan,
    question: mixedQuestion,
    givens: [{ id: "speed", symbol: "u", value: 20, unit: "m/s", provenance: "given" }],
  }, mixedQuestion), null, "a formula request must not bypass a missing numeric answer");

  assert.equal(await request({ ...plan, derived: [{ ...plan.derived[0], value: "not calculated" }] }), null,
    "an unresolved placeholder must not become a symbolic answer");
  assert.equal(await request({ ...plan, unknowns: [...plan.unknowns, { id: "electric_charge", symbol: "q", unit: "C" }] }), null,
    "an unrelated missing unknown must still reject the plan");
  console.log("verify-symbolic-turn-plan: derivations retain formulas as claims without weakening numeric results");
} finally {
  globalThis.fetch = originalFetch;
}
