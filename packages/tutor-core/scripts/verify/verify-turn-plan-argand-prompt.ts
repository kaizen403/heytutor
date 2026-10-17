import { strict as assert } from "node:assert";
import { auditTurnPlanV3, planTurnV3, TURN_PLAN_V3_PROMPT, TURN_PLAN_V3_PROMPT_BASELINE_CHARS } from "../../src/planners/turnPlannerV3";
import type { TurnPlanV3 } from "@heytutor/scene-engine";

// Prompt delivery/contract gate, not a claim that a model or solver enforces
// Argand semantics. Every fetch is replaced; no network fallback is possible.
const originalFetch = globalThis.fetch;
const requests: Array<{ phase: string; lane: string; body: { max_tokens: number; messages: Array<{ role: string; content: string }> } }> = [];
const options = { proxyUrl: "https://argand.invalid/mock", timeoutMs: 1000 };
let answer: TurnPlanV3;
let invalidResponses = 0;
globalThis.fetch = async (input, init) => {
  assert.equal(String(input), options.proxyUrl);
  const headers = new Headers(init?.headers);
  requests.push({ phase: headers.get("x-turn-plan-phase")!, lane: headers.get("x-turn-planner-lane")!, body: JSON.parse(String(init?.body)) });
  const content = invalidResponses-- > 0 ? "invalid JSON" : JSON.stringify(answer);
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
};

function fixture(question: string, literal: string, w: [number, number], reference: [number, number]): TurnPlanV3 {
  const radius = 2, d = Math.hypot(...reference);
  const results: Array<[string, number]> = [["greatest distance", d + radius], ["least distance", d - radius],
    ["Re(z_max)", -radius * reference[0] / d], ["Im(z_max)", -radius * reference[1] / d],
    ["Re(z_min)", radius * reference[0] / d], ["Im(z_min)", radius * reference[1] / d]];
  return {
    schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
    givens: [{ id: "r", symbol: "r", value: radius, provenance: "given", sourceText: "|z| = 2" },
      { id: "wr", symbol: "literal Re(w)", value: w[0], provenance: "given", sourceText: literal },
      { id: "wi", symbol: "literal Im(w)", value: w[1], provenance: "given", sourceText: literal }],
    unknowns: results.map(([symbol], index) => ({ id: `u${index}`, symbol })),
    derived: [{ id: "ar", symbol: "reference point Re(a)", value: reference[0], provenance: "derived", dependsOn: ["wr"], sourceText: `Reference point from ${literal}; preserve the original expression.` },
      { id: "ai", symbol: "reference point Im(a)", value: reference[1], provenance: "derived", dependsOn: ["wi"], sourceText: `Reference point from ${literal}; preserve the original expression.` },
      ...results.map(([symbol, value], index) => ({ id: `u${index}`, symbol, value, provenance: "derived" as const, dependsOn: ["r", "ar", "ai"] }))],
    qualitativeClaims: [{ id: "reference", claim: "The distance reference is point a, distinct from a retained literal addend.", expected: true, relatedQuantityIds: ["ar", "ai"] }],
    lawIds: ["complex_modulus_distance", "triangle_inequality"], assumptions: [],
  };
}

let checks = 0;
try {
  for (const [literal, w, reference] of [
    ["|z + 6 − 8i|", [6, -8], [-6, 8]],
    ["|z + (6 - 8i)|", [6, -8], [-6, 8]],
    ["|z - (6 - 8i)|", [6, -8], [6, -8]],
    ["|z + (-6 + 8i)|", [-6, 8], [6, -8]],
    ["|z - (-6 + 8i)|", [-6, 8], [-6, 8]],
    ["|z − 6 + 8i|", [-6, 8], [6, -8]],
  ] as Array<[string, [number, number], [number, number]]>) {
    const question = `If |z| = 2, find the greatest and least values of ${literal} and the values of z where they occur.`;
    answer = fixture(question, literal, w, reference);
    const start = requests.length;
    const planned = await planTurnV3(question, options);
    assert(planned, "Complete mocked Argand plans must retain the existing parse contract");
    assert.deepEqual(planned.turnPlan.givens, answer.givens, "Literal algebra givens/sourceText must remain unchanged");
    assert.deepEqual(planned.turnPlan.derived.filter(q => q.id === "ar" || q.id === "ai"), answer.derived.filter(q => q.id === "ar" || q.id === "ai"), "Sign-derived reference roles/sourceText must remain derived");
    assert.equal(planned.turnPlan.question, question);
    assert.deepEqual(requests.slice(start).map(request => request.lane), ["primary", "alternate"]); checks += 5;
    const actual = planned.turnPlan.derived;
    assert.equal(actual.find(q => q.id === "u0")!.value, 12);
    assert.equal(actual.find(q => q.id === "u1")!.value, 8);
    assert.deepEqual(actual.filter(q => q.id === "u2" || q.id === "u3").map(q => q.value), [-reference[0] / 5, -reference[1] / 5]);
    assert.deepEqual(actual.filter(q => q.id === "u4" || q.id === "u5").map(q => q.value), [reference[0] / 5, reference[1] / 5]); checks += 4;
    for (const request of requests.slice(start)) {
      assert.equal(request.body.max_tokens, 2600, "No output cap increase");
      assert(request.body.messages[1]!.content.includes(`QUESTION\n${question}`), "The original literal must reach every lane unchanged");
      const prompt = request.body.messages[0]!.content;
      assert.match(prompt, /\|z-a\|.*distance.*reference a/, "Prompt must bind subtraction to reference a");
      assert.match(prompt, /\|z\+w\|.*-w/, "Prompt must bind addition to the negated reference");
      assert.match(prompt, /point\/centre.*reference role/, "A geometric reference needs a point role");
      assert.match(prompt, /literal w separately if needed, never as this reference/, "Retained literal components cannot become the geometric reference");
      assert.match(prompt, /computed sign changes are derived.*never invented quotes/, "No sign-flipped quoted-given fabrication"); checks += 7;
    }
  }
  answer = fixture("If |z| = 2, find the greatest and least values of |z + 6 − 8i| and the values of z where they occur.", "|z + 6 − 8i|", [6, -8], [-6, 8]);
  const beforeRepair = requests.length;
  invalidResponses = 2;
  const repaired = await planTurnV3(answer.question, options);
  assert(repaired);
  const repair = requests.slice(beforeRepair);
  assert.equal(repair.length, 3);
  assert(repair[2]!.body.messages[0]!.content.includes("|z+w|"));
  assert(repair[2]!.body.messages[1]!.content.includes("Return a complete corrected plan")); checks += 4;
  assert(await auditTurnPlanV3(answer.question, answer, options));
  const audit = requests.at(-1)!;
  assert.equal(audit.phase, "audit");
  assert.match(audit.body.messages[0]!.content, /\|z-a\|.*distance.*reference a/);
  assert.match(audit.body.messages[0]!.content, /\|z\+w\|.*-w/);
  assert(audit.body.messages[1]!.content.includes(answer.question)); checks += 5;
  assert(TURN_PLAN_V3_PROMPT.length <= TURN_PLAN_V3_PROMPT_BASELINE_CHARS + 150, "Existing prompt size cap must remain unchanged"); checks++;
  console.log(`Turn-plan Argand mock prompt gate: ${checks} checks, ${requests.length} mocked requests, 0 API calls; prompt ${TURN_PLAN_V3_PROMPT.length}/${TURN_PLAN_V3_PROMPT_BASELINE_CHARS + 150} chars`);
} finally {
  globalThis.fetch = originalFetch;
}
