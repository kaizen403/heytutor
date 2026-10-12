/** Real request contract; no models, private questions or source fixtures. */
import assert from "node:assert/strict";
import { planTurnV3, auditTurnPlanV3, TURN_PLAN_V3_PROMPT, TURN_PLAN_V3_PROMPT_BASELINE_CHARS, TURN_PLAN_V3_VISUAL_GROUNDING } from "../../src/planners/turnPlannerV3";
import { validateTurnPlanV3, type TurnPlanV3 } from "@heytutor/scene-engine";

const question = "Plot voltage against current from 0 to 3 A for a 12-ohm resistor with area A = 0.8 mm².";
const grounding = "Measured claim values, including coordinates, need matching relatedQuantityIds for givens or computed derived.";
const fixture: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
  givens: [
    { id: "area", symbol: "A", value: 0.8, unit: "mm²", provenance: "given" },
    { id: "resistance", symbol: "R", value: 12, unit: "Ω", provenance: "given" },
    { id: "minimum_current", symbol: "I_min", value: 0, unit: "A", provenance: "given" },
    { id: "maximum_current", symbol: "I_max", value: 3, unit: "A", provenance: "given" },
  ],
  unknowns: [{ id: "maximum_voltage", symbol: "V_max", unit: "V" }],
  derived: [
    { id: "maximum_voltage", symbol: "V_max", value: 36, unit: "V", provenance: "derived",
      sourceText: "V_max = I_max*R = 3*12 = 36 V", dependsOn: ["maximum_current", "resistance"] },
    { id: "minimum_voltage", symbol: "V_min", value: 0, unit: "V", provenance: "derived",
      sourceText: "V_min = I_min*R = 0*12 = 0 V", dependsOn: ["minimum_current", "resistance"] },
  ],
  qualitativeClaims: [{ id: "plot", claim: "The line goes from (0 A, 0 V) to (3 A, 36 V).", expected: true,
    relatedQuantityIds: ["minimum_current", "maximum_current", "minimum_voltage", "maximum_voltage"] }],
  lawIds: ["ohms_law"], assumptions: [],
};

assert(validateTurnPlanV3(fixture, question).valid, "independently computed endpoint quantities satisfy the existing claim checks");
const absent = structuredClone(fixture);
absent.derived = absent.derived.filter(q => q.id !== "minimum_voltage");
absent.qualitativeClaims[0]!.relatedQuantityIds = absent.qualitativeClaims[0]!.relatedQuantityIds!.filter(id => id !== "minimum_voltage");
assert(validateTurnPlanV3(absent, question).issues.some(x => x.code === "claim_quantity_mismatch"), "omitting coordinate authority still fails; no validator exemption");
const wrong = structuredClone(fixture);
wrong.qualitativeClaims[0]!.claim = "The line goes from (0 A, 1 V) to (3 A, 36 V).";
assert(validateTurnPlanV3(wrong, question).issues.some(x => x.code === "claim_quantity_mismatch"), "false coordinate still fails");

const original = globalThis.fetch;
const systems: string[] = [];
globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] };
  systems.push(body.messages.find(m => m.role === "system")!.content);
  return Response.json({ choices: [{ message: { content: JSON.stringify(fixture) } }] });
};
try {
  const planned = await planTurnV3(question, { proxyUrl: "http://local.invalid/api/chat", timeoutMs: 1000 });
  assert(planned, "a fully grounded fixture reaches the real plan parser");
  assert(await auditTurnPlanV3(question, fixture, { proxyUrl: "http://local.invalid/api/chat", timeoutMs: 1000 }));
} finally {
  globalThis.fetch = original;
}
assert.equal(systems.length, 3, "two actual initial lanes and the audit request were exercised");
for (const system of systems) {
  assert(system.includes(grounding), "every actual request requires grounded measured claim values");
  assert(!system.includes("Express coordinate labels, endpoints and repeated multiples from original givens instead of extra quantities"),
    "the request must not instruct the model to omit needed coordinate quantities");
}
assert(TURN_PLAN_V3_PROMPT.replace(`\n${TURN_PLAN_V3_VISUAL_GROUNDING}`, "").length <= TURN_PLAN_V3_PROMPT_BASELINE_CHARS + 150,
  "existing planner prompt growth cap is unchanged");
console.log("verify-turn-plan-claim-grounding: real initial/retry-base/audit requests, grounded and false coordinates, unchanged prompt budget pass");
