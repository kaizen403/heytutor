/**
 * Video 3 lane 1 (20 Oct 2026): planner candidate order and turn plan retry.
 *
 * 1. A valid scene candidate whose source.question restates the asked
 *    question is refused at final selection. It must rank below an exact one
 *    and must not open the grace window that cancels the exact sibling
 *    (v3 p1e1-t1: the restated lane arrived 0.5 s first and won).
 * 2. The corrected turn plan retry carries the validator's issues and gets a
 *    minimum budget when there is something to fix (v3 p3e1-t1: 5.2 s, aborted).
 * 3. Salvage keeps only givens whose value and unit the question states, plus
 *    law ids; no derived value, unknown or claim survives. It fails closed
 *    (3c): a given is kept only when it is the lane's one quantity of its
 *    dimension, the question's one number of that dimension is its value, and
 *    nothing marks a value as relative. Every review probe drops.
 *
 * Mock transport only; no model calls.
 */
import assert from "node:assert/strict";
import {
  compareSceneCandidates,
  normalizeSceneSourceQuestion,
  planSceneDocumentWithRepair,
  revalidateScenePlanWithRepairResult,
  sceneSourceQuestionMatches,
  type SceneCandidateValidation,
} from "../../src/planners/scenePlannerV2";
import {
  planTurnV3,
  questionStatesQuantity,
  salvageRejectedTurnPlanV3,
  TURN_PLAN_RETRY_MIN_MS,
  type RejectedTurnPlanV3,
} from "../../src/planners/turnPlannerV3";

const nativeFetch = globalThis.fetch;
const json = (content: unknown) => new Response(JSON.stringify({
  choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
}), { status: 200, headers: { "content-type": "application/json" } });
const sleep = (ms: number, signal?: AbortSignal | null) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(new DOMException("aborted", "AbortError"));
  }, { once: true });
});

const asked = "A train 120 m long runs at 20 m/s. How long does it take to pass a 180 m platform?";
const restated = "A 120 m train at 20 m/s passes a 180 m platform. Find the time.";

// --- 1. exact source first, and no grace window from a restatement ---------
{
  // The normalisation is the one final selection uses.
  assert.equal(normalizeSceneSourceQuestion("  Speed  x² − 3 × 2 "), "speed x^2 - 3 * 2");
  // π reads as pi, as main's normalizeQuestion did: a scene whose source
  // spells "pi" for an asked "π" is the same question (PR #249 review).
  assert.equal(normalizeSceneSourceQuestion("Area under y = sin x from 0 to π"), "area under y = sin x from 0 to pi");
  assert.ok(sceneSourceQuestionMatches({ source: { question: "Area under y = sin x from 0 to pi" } }, "Area under y = sin x from 0 to π"),
    "a scene planned for the pi spelling matches the asked π question");
  assert.ok(sceneSourceQuestionMatches({ source: { question: `  ${asked.toUpperCase()} ` } }, asked));
  assert.ok(!sceneSourceQuestionMatches({ source: { question: restated } }, asked));
  assert.ok(!sceneSourceQuestionMatches({ source: {} }, asked), "a missing source question is not an exact match");

  const validation = (qualityScore: number): SceneCandidateValidation => ({ valid: true, errors: [], qualityScore });
  const exact = { response: { document: { source: { question: asked } } }, validation: validation(500) };
  const restatement = { response: { document: { source: { question: restated } } }, validation: validation(1) };
  const invalid = { response: { document: { source: { question: asked } } }, validation: { valid: false, errors: [] } };
  assert.ok(compareSceneCandidates(asked, exact, restatement) < 0, "an exact source outranks a better scored restatement");
  assert.ok(compareSceneCandidates(asked, restatement, invalid) < 0, "validity still comes first");
  assert.ok(compareSceneCandidates(undefined, exact, restatement) > 0, "without a question the old score order holds");

  // The restated lane answers first and valid; the exact lane answers 1.2 s
  // later, past the 750 ms grace window a valid candidate opens.
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const lane = new Headers(init?.headers).get("x-scene-planner-lane");
    if (lane === "primary") return json({ schemaVersion: "scene-document/v2", lane, source: { question: restated } });
    await sleep(1_200, init?.signal);
    return json({ schemaVersion: "scene-document/v2", lane, source: { question: asked } });
  };
  const scores: Record<string, number> = { primary: 10, alternate: 90 };
  const validate = (document: Record<string, unknown>): SceneCandidateValidation<string> =>
    ({ valid: true, errors: [], qualityScore: scores[String(document.lane)] ?? 0, value: String(document.lane) });
  const result = await planSceneDocumentWithRepair(asked, validate, { proxyUrl: "http://planner.test", timeoutMs: 5_000 });
  assert.ok(result, "the search returns a result");
  assert.equal(calls, 2);
  assert.equal(result.candidates.length, 2, "the restated candidate did not cancel the exact lane");
  assert.equal(result.validation.value, "alternate", "the exact source candidate is selected over a better scored restatement");
  const restatedCandidate = result.candidates.find((candidate) => candidate.validation.value === "primary")!;
  assert.equal((restatedCandidate.response.document.source as Record<string, unknown>).question, restated,
    "a restatement is never rewritten to the asked question");
  assert.equal(result.question, asked);

  // Revalidation (after authority) keeps the same order.
  const revalidated = await revalidateScenePlanWithRepairResult(result, validate);
  assert.equal(revalidated.validation.value, "alternate", "revalidation ranks the exact source first");

  // An exact valid candidate still opens the grace window: a slow sibling is cancelled.
  globalThis.fetch = async (_input, init) => {
    const lane = new Headers(init?.headers).get("x-scene-planner-lane");
    if (lane === "primary") return json({ schemaVersion: "scene-document/v2", lane });
    await sleep(4_000, init?.signal);
    return json({ schemaVersion: "scene-document/v2", lane });
  };
  const startedAt = Date.now();
  const early = await planSceneDocumentWithRepair(asked, validate, { proxyUrl: "http://planner.test", timeoutMs: 6_000 });
  assert.equal(early?.candidates.length, 1);
  assert.ok(Date.now() - startedAt < 2_500, "an exact valid candidate is still accepted without waiting for a straggler");
  globalThis.fetch = nativeFetch;
}

// --- 2. retry feedback and minimum budget ----------------------------------
const question = "A man walks east at 8 m/s while rain falls vertically at 6 m/s. Find the speed of the rain relative to him.";
const rejectedPlan = {
  schemaVersion: "turn-plan/v3", question,
  givens: [
    { id: "vr", symbol: "v_r", value: 6, unit: "m/s", sourceText: "rain falls vertically at 6 m/s", provenance: "given" },
    { id: "vm", symbol: "v_m", value: 8, unit: "m/s", sourceText: "man walks east at 8 m/s", provenance: "given" },
    { id: "invented", symbol: "g", value: 9.8, unit: "m/s^2", sourceText: "g = 9.8", provenance: "given" },
  ],
  unknowns: [{ id: "vrel", symbol: "v_rel", unit: "m/s" }],
  derived: [{ id: "vrel", symbol: "v_rel", value: 10, unit: "m/s", sourceText: "sqrt(6^2+8^2)=10", provenance: "derived", dependsOn: ["vr", "vm"] }],
  // The validator refuses a claim that states another value than the quantity it cites.
  qualitativeClaims: [{ id: "c1", claim: "The rain appears to fall at 12 m/s.", expected: "12 m/s", relatedQuantityIds: ["vrel"] }],
  lawIds: ["relative_velocity", "pythagorean_theorem"],
  assumptions: [], visualRequirement: "required",
};
{
  const originalClock = Date.now;
  let clock = 1_000_000;
  Date.now = () => clock;
  try {
    const bodies: Array<{ deadline: string | null; kind: string; user: string }> = [];
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      bodies.push({
        deadline: new Headers(init?.headers).get("x-planner-deadline-ms"),
        kind: new Headers(init?.headers).get("x-turn-planner-lane") ?? "",
        user: body.messages.at(-1)?.content ?? "",
      });
      // The two initial lanes spend 14.8 s of a 20 s budget (p3e1-t1 left 5.2 s).
      if (bodies.length === 2) clock += 14_800;
      return json(rejectedPlan);
    };
    const rejected: RejectedTurnPlanV3[] = [];
    const result = await planTurnV3(question, {
      proxyUrl: "http://planner.test", timeoutMs: 20_000,
      onRejectedPlan: (plan) => rejected.push(plan),
    });
    assert.equal(result, null, "a plan the validator refuses is never admitted");
    assert.equal(bodies.length, 3, "two lanes and one corrected retry");
    const retry = bodies[2]!;
    assert.equal(Number(retry.deadline), TURN_PLAN_RETRY_MIN_MS, "the retry gets the minimum budget, not the 5.2 s left over");
    assert.match(retry.user, /REJECTED BY THE DETERMINISTIC VALIDATOR/);
    assert.match(retry.user, /qualitativeClaims\[0\] \(c1\)\.claim \(claim_quantity_mismatch\): measured claim 12 m\/s/,
      "the retry names the failing path, its id and the validator message");
    assert.ok(!bodies[0]!.user.includes("REJECTED BY"), "initial lanes are unchanged");
    assert.equal(rejected.length, 3, "every refused plan reaches the salvage observer");
    assert.ok(rejected.every((entry) => entry.issues.length > 0));

    // Lanes that only failed transport give the retry nothing to fix: no floor.
    bodies.length = 0;
    clock = 1_000_000;
    globalThis.fetch = async (_input, init) => {
      bodies.push({ deadline: new Headers(init?.headers).get("x-planner-deadline-ms"), kind: "", user: "" });
      if (bodies.length === 2) clock += 14_800;
      return new Response("unavailable", { status: 503 });
    };
    assert.equal(await planTurnV3(question, { proxyUrl: "http://planner.test", timeoutMs: 20_000 }), null);
    assert.equal(bodies.length, 3);
    assert.equal(Number(bodies[2]!.deadline), 5_200, "without validator issues the retry keeps the leftover budget");

    // An expired budget still skips the retry.
    bodies.length = 0;
    clock = 1_000_000;
    globalThis.fetch = async () => {
      bodies.push({ deadline: null, kind: "", user: "" });
      if (bodies.length === 2) clock += 20_000;
      return json(rejectedPlan);
    };
    assert.equal(await planTurnV3(question, { proxyUrl: "http://planner.test", timeoutMs: 20_000 }), null);
    assert.equal(bodies.length, 2, "no retry after the budget expired");
  } finally {
    Date.now = originalClock;
    globalThis.fetch = nativeFetch;
  }
}

// --- 3. salvage --------------------------------------------------------------
{
  assert.ok(questionStatesQuantity("rain falls at 6 m/s.", 6, "m/s"));
  assert.ok(questionStatesQuantity("appears at 60° to the vertical", 60, "deg"));
  assert.ok(questionStatesQuantity("at 60 degrees", 60, "degree"));
  assert.ok(questionStatesQuantity("cycling at 5 km/h", 5, "km/h"));
  assert.ok(questionStatesQuantity("a = -2 m/s² for 3 s", -2, "m/s^2"));
  assert.ok(!questionStatesQuantity("rain falls at 6 m/s", 6, "km/h"), "the unit must match");
  assert.ok(!questionStatesQuantity("a 20 cm rod", 0.2, "m"), "no rescaling");
  assert.ok(!questionStatesQuantity("v2 = 4 m/s", 2, "m/s"), "a subscript digit is not a stated value");
  assert.ok(!questionStatesQuantity("6 ms delay", 6, "m"), "a longer unit word is not this unit");

  // Salvage keeps only givens it can prove unambiguous (3c): the lane's one
  // quantity of its dimension, the question's one number of that dimension.
  const issues = [{ code: "claim_quantity_mismatch", path: "qualitativeClaims[0].claim", message: "measured claim 12 m/s disagrees" }];
  const thrown = "A ball is thrown at 20 m/s at 30° above the horizontal from a cliff 45 m high. Find its time of flight.";
  const ballPlan = {
    schemaVersion: "turn-plan/v3", question: thrown,
    givens: [
      { id: "u", symbol: "u", value: 20, unit: "m/s", sourceText: "thrown at 20 m/s", provenance: "given" },
      { id: "theta", symbol: "theta", value: 30, unit: "deg", sourceText: "30° above the horizontal", provenance: "given" },
      { id: "h", symbol: "h", value: 45, unit: "m", sourceText: "a cliff 45 m high", provenance: "given" },
      { id: "invented", symbol: "g", value: 9.8, unit: "m/s^2", sourceText: "g = 9.8", provenance: "given" },
    ],
    unknowns: [{ id: "T", symbol: "T", unit: "s" }],
    derived: [{ id: "T", symbol: "T", value: 4.3, unit: "s", sourceText: "h = -u sin(theta) T + g T^2/2", provenance: "derived", dependsOn: ["u", "theta", "h"] }],
    qualitativeClaims: [{ id: "c1", claim: "The ball lands after 12 s.", expected: "12 s", relatedQuantityIds: ["T"] }],
    lawIds: ["projectile_motion", "kinematics"],
    assumptions: [], visualRequirement: "required",
  };
  const salvaged = salvageRejectedTurnPlanV3(thrown, [{ lane: "primary", requestKind: "initial", plan: ballPlan, issues }]);
  assert.ok(salvaged, "question-stated givens are salvaged");
  assert.deepEqual(salvaged.givens.map((given) => [given.id, given.value, given.unit]), [["u", 20, "m/s"], ["theta", 30, "deg"], ["h", 45, "m"]],
    "a value the question does not state (g = 9.8) is dropped");
  assert.deepEqual(salvaged.derived, [], "no derived value survives");
  assert.deepEqual(salvaged.unknowns, []);
  assert.deepEqual(salvaged.qualitativeClaims, [], "no claim survives");
  assert.deepEqual(salvaged.lawIds, ["projectile_motion", "kinematics"], "law ids are kept");
  assert.equal(salvaged.question, thrown);

  // Mutation: a changed value, a changed unit, or a derived value relabelled
  // as given is not stated by the question and does not survive.
  const mutated = {
    ...ballPlan,
    givens: [
      { ...ballPlan.givens[0]!, value: 21 },
      { ...ballPlan.givens[1]!, unit: "rad" },
      { id: "T2", symbol: "T", value: 4.3, unit: "s", sourceText: "solved", provenance: "given" },
    ],
  };
  assert.equal(salvageRejectedTurnPlanV3(thrown, [{ lane: "primary", requestKind: "initial", plan: mutated, issues }]), null,
    "with no question-stated given there is nothing to salvage");
  // The best rejected plan is the one with the most stated givens.
  const best = salvageRejectedTurnPlanV3(thrown, [
    { lane: "primary", requestKind: "initial", plan: mutated, issues },
    { lane: "alternate", requestKind: "initial", plan: ballPlan, issues },
  ]);
  assert.deepEqual(best?.givens.map((given) => given.id), ["u", "theta", "h"]);
}
// --- 3b. salvage keeps no wrong unit, flagged given or swapped role ----------
{
  // A unit must end where the stated one ends.
  assert.ok(!questionStatesQuantity("a car moves at 20 m/s", 20, "m"), "(20, m) is not stated by 20 m/s");
  assert.ok(!questionStatesQuantity("a cyclist rides at 4 km/h", 4, "km"), "(4, km) is not stated by 4 km/h");
  assert.ok(!questionStatesQuantity("a car moves at 20 m s^-1", 20, "m"), "(20, m) is not stated by 20 m s^-1");
  assert.ok(!questionStatesQuantity("a car moves at 20 m·s⁻¹", 20, "m"), "(20, m) is not stated by 20 m·s⁻¹");
  assert.ok(!questionStatesQuantity("an area of 20 m² is", 20, "m"), "(20, m) is not stated by 20 m²");
  assert.ok(questionStatesQuantity("a car moves at 20 m s^-1", 20, "m/s"), "a spaced power spelling still states m/s");
  assert.ok(questionStatesQuantity("a river 400 m wide flows", 400, "m"), "a unit followed by a word is stated");
  assert.ok(questionStatesQuantity("the rod is 20 m.", 20, "m"), "a unit at a sentence end is stated");
  // A unitless given is a bare number.
  assert.ok(!questionStatesQuantity("a car moves at 20 m/s", 20), "a unitless 20 is not the 20 of 20 m/s");
  assert.ok(!questionStatesQuantity("a 4 kg block", 4), "a unitless 4 is not the 4 of 4 kg");
  assert.ok(!questionStatesQuantity("rain at 60° to the vertical", 60), "a unitless 60 is not the 60 of 60°");
  assert.ok(questionStatesQuantity("a glass of refractive index 1.5 and 3 identical slabs", 1.5), "a bare number is stated");
  assert.ok(questionStatesQuantity("a glass of refractive index 1.5 and 3 identical slabs", 3), "a count before a noun is stated");

  const thrown = "A ball is thrown at 20 m/s at 30° above the horizontal. Find its range.";
  const u = { id: "u", symbol: "u", value: 20, unit: "m/s", sourceText: "thrown at 20 m/s", provenance: "given" };
  const theta = { id: "theta", symbol: "theta", value: 30, unit: "deg", sourceText: "30° above the horizontal", provenance: "given" };
  const plan = (givens: Array<Record<string, unknown>>) => ({ ...rejectedPlan, question: thrown, givens, unknowns: [], derived: [] });
  const ids = (lanes: Array<Array<Record<string, unknown>>>, issues: Array<{ code: string; path: string; message: string }> = []) =>
    salvageRejectedTurnPlanV3(thrown, lanes.map((givens, index) => ({ lane: index === 0 ? "primary" : "alternate", requestKind: "initial", plan: plan(givens), issues })))
      ?.givens.map((given) => given.id) ?? null;
  // Wrong unit prefixes: the plan's (20, m) is not the question's 20 m/s.
  assert.deepEqual(ids([[{ ...u, unit: "m" }, theta]]), ["theta"], "a given whose unit is a prefix of the stated unit is dropped");
  assert.deepEqual(ids([[{ id: "n", symbol: "n", value: 20, sourceText: "20", provenance: "given" }, theta]]), ["theta"],
    "a unitless given never matches a number followed by a unit");

  // A given the rejection's issues name is dropped.
  assert.deepEqual(ids([[u, theta]], [{ code: "given_role_mismatch", path: "givens[1].value", message: "theta is from the vertical" }]), ["u"],
    "a given named in the rejection's issue paths is dropped");
  assert.equal(ids([[u, theta]], [{ code: "x", path: "givens[0]", message: "x" }, { code: "y", path: "givens[1].value", message: "y" }]),
    null, "with every stated given flagged there is nothing to salvage");

  // Swapped roles across lanes: the same symbols carry each other's values; neither survives.
  assert.equal(ids([[u, theta], [{ ...u, value: 30, unit: "deg" }, { ...theta, value: 20, unit: "m/s" }]]), null,
    "values the rejected lanes bind to different symbols are dropped");
  // Lanes that agree keep both; a lane naming one more symbol is not a swap.
  assert.deepEqual(ids([[u, theta], [u, theta, { id: "h", symbol: "h", value: 9, unit: "m", provenance: "given" }]]), ["u", "theta"], "agreeing lanes keep their givens");
  // A lane that only respells a symbol (u and u_0 for one 20 m/s) is no swap.
  assert.deepEqual(ids([[u, theta], [{ ...u, symbol: "u_0" }, theta]]), ["u", "theta"], "a respelled symbol with the same value is no swap");
}

// --- 3c. salvage fails closed: no given whose owner only wording could tell --
{
  // PR #249: three reviews in a row fooled an owner rule that read English
  // wording to decide which quantity a stated value belongs to. Salvage now
  // keeps a given only when it is the lane's one quantity of its dimension,
  // the question states exactly one number of that dimension, that number is
  // the given's value, and nothing marks a stated value as relative.
  const claimIssue = [{ code: "claim_quantity_mismatch", path: "qualitativeClaims[0].claim", message: "measured claim disagrees" }];
  type Quantity = Record<string, unknown>;
  const q = (id: string, value: number, unit: string | undefined, sourceText?: string, symbol = `v_${id.replace(/^v/, "")}`): Quantity =>
    ({ id, symbol, value, ...(unit ? { unit } : {}), ...(sourceText ? { sourceText } : {}), provenance: "given" });
  const salvageOf = (asked: string, givens: Quantity[], rest: { unknowns?: Quantity[]; derived?: Quantity[] } = {}) =>
    salvageRejectedTurnPlanV3(asked, [{ lane: "primary", requestKind: "initial",
      plan: { ...rejectedPlan, question: asked, givens, unknowns: rest.unknowns ?? [], derived: rest.derived ?? [] }, issues: claimIssue }]);
  const keptOf = (asked: string, givens: Quantity[], rest?: { unknowns?: Quantity[]; derived?: Quantity[] }) =>
    salvageOf(asked, givens, rest)?.givens.map((given) => `${given.id}=${given.value}`) ?? [];

  // Every probe from the three reviews. Each names the givens that would be
  // a false label (a swapped value, or a relative value on an absolute
  // quantity); none of them may survive. The lanes carry no other quantity,
  // so the question side of the rule is what drops them.
  const umbrella = "Rain falls at 6 m/s, man walks at 8 m/s. How should he hold his umbrella?";
  const probes: Array<{ name: string; question: string; givens: Quantity[]; falseIds: string[] }> = [
    { name: "rain 6 m/s and man 8 m/s swapped, owner spans", question: umbrella,
      givens: [q("vr", 8, "m/s", "man walks at 8 m/s"), q("vm", 6, "m/s", "Rain falls at 6 m/s")], falseIds: ["vr", "vm"] },
    { name: "rain 6 m/s and man 8 m/s swapped, bare spans", question: umbrella,
      givens: [q("vr", 8, "m/s", "8 m/s"), q("vm", 6, "m/s", "6 m/s")], falseIds: ["vr", "vm"] },
    { name: "rain 6 m/s and man 8 m/s swapped, no spans", question: umbrella, givens: [q("vr", 8, "m/s"), q("vm", 6, "m/s")], falseIds: ["vr", "vm"] },
    { name: "rain 6 m/s and man 8 m/s swapped, ids name the other owner", question: umbrella,
      givens: [q("rain_speed", 8, "m/s", "man walks at 8 m/s", "v_{rain}"), q("man_speed", 6, "m/s", "Rain falls at 6 m/s", "v")], falseIds: ["rain_speed", "man_speed"] },
    { name: "river flows at 3 m/s, man \"rows at 4 m/s\" as v_r", question: "A river flows at 3 m/s and a man rows at 4 m/s. Find the time to cross.",
      givens: [q("vr", 4, "m/s", "rows at 4 m/s"), q("vm", 3, "m/s")], falseIds: ["vr", "vm"] },
    { name: "rain \"runs at 8 m/s\" as v_r", question: "Rain falls at 6 m/s and a man runs at 8 m/s. How should he hold his umbrella?",
      givens: [q("vr", 8, "m/s", "runs at 8 m/s"), q("vm", 6, "m/s")], falseIds: ["vr", "vm"] },
    ...[[q("vA", 15, "m/s", "15 m/s"), q("vB", 10, "m/s", "10 m/s")], [q("vA", 10, "m/s", "10 m/s"), q("vB", 15, "m/s", "15 m/s")]].map((givens, index) => ({
      name: `two trains at 10 m/s and 15 m/s respectively, ${index === 0 ? "swapped" : "correct"} lane`,
      question: "Two trains A and B move at 10 m/s and 15 m/s respectively. Find the velocity of A relative to B.",
      // Respectively binds by position, which only wording tells: neither lane keeps a speed.
      givens, falseIds: ["vA", "vB"] })),
    { name: "motorboat and man: the boat's speed as the man's", question: "A motorboat moves upstream at 10 m/s and a man on it walks towards the stern at 2 m/s. Find the man's velocity relative to the bank.",
      givens: [q("vm", 10, "m/s", "A motorboat moves upstream at 10 m/s"), q("vb", 2, "m/s", "a man on it walks towards the stern at 2 m/s")], falseIds: ["vm", "vb"] },
    { name: "swimmer and stream: the stream's speed as the swimmer's", question: "A swimmer swims at 2 m/s in still water and the stream flows at 1.5 m/s. Find the time to cross a 60 m wide river.",
      givens: [q("vs", 1.5, "m/s", "the stream flows at 1.5 m/s"), q("vw", 2, "m/s", "A swimmer swims at 2 m/s")], falseIds: ["vs", "vw"] },
    { name: "rain relative to the man 5 m/s with the man at 5 m/s", question: "A man walks east at 5 m/s, and the velocity of rain relative to the man is 5 m/s vertically downward. Find the actual velocity of the rain.",
      givens: [q("vr", 5, "m/s", "the velocity of rain relative to the man is 5 m/s"), q("vm", 5, "m/s", "A man walks east at 5 m/s")], falseIds: ["vr"] },
    { name: "rain relative to the man 5 m/s, stated alone", question: "The velocity of rain relative to a man walking east is 5 m/s, vertically downward. Find the actual velocity of the rain.",
      givens: [q("vr", 5, "m/s", "The velocity of rain relative to a man walking east is 5 m/s")], falseIds: ["vr"] },
    { name: "car B at 10 m/s relative to car A, beside car A", question: "Car A moves at 15 m/s. Car B moves at 10 m/s relative to car A. Find the ground velocity of B.",
      givens: [q("vA", 15, "m/s", "Car A moves at 15 m/s"), q("vB", 10, "m/s", "Car B moves at 10 m/s relative to car A")], falseIds: ["vB"] },
    { name: "car B at 10 m/s relative to car A, stated alone", question: "Car B moves at 10 m/s relative to car A, which is slowing down. Find the ground velocity of B.",
      givens: [q("vB", 10, "m/s", "Car B moves at 10 m/s")], falseIds: ["vB"] },
    { name: "boat at 4 m/s relative to the river as its ground speed", question: "A boat moves at 4 m/s relative to the river, which flows east. Find the boat's speed over the ground.",
      givens: [q("vb", 4, "m/s", "A boat moves at 4 m/s")], falseIds: ["vb"] },
    { name: "rain appears to him to fall at 6 m/s, beside the man's 8 m/s", question: "A man walks at 8 m/s. Rain appears to him to fall at 6 m/s. Find the actual speed of the rain.",
      givens: [q("vr", 6, "m/s", "Rain appears to him to fall at 6 m/s"), q("vm", 8, "m/s", "A man walks at 8 m/s")], falseIds: ["vr"] },
    { name: "rain appears to him to fall at 6 m/s, stated alone", question: "Rain appears to a running man to fall vertically at 6 m/s. Find the actual speed of the rain.",
      givens: [q("vr", 6, "m/s", "fall vertically at 6 m/s")], falseIds: ["vr"] },
    { name: "truck carrying sand: the truck's speed as the sand's", question: "A truck carrying sand moves at 10 m/s, and sand is thrown backwards from it at 4 m/s. Find the ground speed of the sand.",
      givens: [q("vs", 10, "m/s", "A truck carrying sand moves at 10 m/s"), q("vt", 4, "m/s", "sand is thrown backwards from it at 4 m/s")], falseIds: ["vs", "vt"] },
    { name: "rain falls at twice that speed", question: "A man walks at 4 m/s and rain falls at twice that speed. How should he hold his umbrella?",
      givens: [q("vr", 4, "m/s", "rain falls at twice that speed")], falseIds: ["vr"] },
    { name: "a man at point B walks at 8 m/s as boat B's speed", question: "Boat B is anchored in a river that flows at 6 m/s, and a man at point B walks at 8 m/s along the bank.",
      givens: [q("vB", 8, "m/s", "a man at point B walks at 8 m/s"), q("vr", 6, "m/s", "a river that flows at 6 m/s")], falseIds: ["vB", "vr"] },
  ];
  // Every unit spelling the reviews used: the question states two speeds in it.
  for (const [spelled, unit] of [
    ["km/hr", "km/h"], ["kmph", "km/h"], ["km h^-1", "km/h"], ["kilometres per hour", "km/h"], ["kilometers per hour", "km/h"],
    ["kmh", "km/h"], ["km hr-1", "km/h"], ["km/hrs", "km/h"],
    ["metres per second", "m/s"], ["m s^-1", "m/s"], ["m/sec", "m/s"], ["mps", "m/s"],
  ] as const) {
    const spoken = `Rain falls at 6 ${spelled} and a man walks at 8 ${spelled}. How should he hold his umbrella?`;
    probes.push(
      { name: `${spelled}: swapped in ${unit}`, question: spoken, givens: [q("vr", 8, unit), q("vm", 6, unit)], falseIds: ["vr", "vm"] },
      { name: `${spelled}: swapped in the question's spelling`, question: spoken, givens: [q("vr", 8, spelled), q("vm", 6, spelled)], falseIds: ["vr", "vm"] },
      { name: `${spelled}: swapped with owner spans`, question: spoken,
        givens: [q("vr", 8, spelled, `a man walks at 8 ${spelled}`), q("vm", 6, spelled, `Rain falls at 6 ${spelled}`)], falseIds: ["vr", "vm"] },
    );
  }
  // A speed in a spelling only the given uses still counts against a speed in m/s.
  probes.push({ name: "6 m/s beside 8 mps, lane binds the man to 6 m/s", question: "Rain falls at 6 m/s and a man walks at 8 mps. How should he hold his umbrella?",
    givens: [q("vm", 6, "m/s", "6 m/s"), q("vr", 8, "mps")], falseIds: ["vm", "vr"] });
  const falseKeeps = probes.flatMap((probe) => {
    const kept = salvageOf(probe.question, probe.givens)?.givens.map((given) => given.id) ?? [];
    const leaked = probe.falseIds.filter((id) => kept.includes(id));
    return leaked.length ? [`${probe.name}: kept ${leaked.join(", ")}`] : [];
  });
  assert.deepEqual(falseKeeps, [], `salvage kept a false given on ${falseKeeps.length} of ${probes.length} review probes:\n  ${falseKeeps.join("\n  ")}`);

  // No identical value exception: two stated speeds are two numbers, even when equal.
  assert.deepEqual(keptOf("Car A moves at 10 m/s and car B moves at 10 m/s in the same direction. Find their relative velocity.", [q("vA", 10, "m/s"), q("vB", 10, "m/s")]), [],
    "two equal stated speeds are still two numbers of that dimension");

  // Kept: a given that is unambiguous without reading wording. The lane's one
  // speed and one angle, each the question's one number of its dimension.
  const thrown = "A ball is thrown at 20 m/s at 30° above the horizontal. Find its range.";
  const ballGivens = [q("u", 20, "m/s", "thrown at 20 m/s", "u"), q("theta", 30, "deg", "30° above the horizontal", "theta")];
  const ballRest = { unknowns: [{ id: "R", symbol: "R", unit: "m" }], derived: [{ id: "R", symbol: "R", value: 35.3, unit: "m", sourceText: "u^2 sin(2 theta)/g", provenance: "derived" }] };
  assert.deepEqual(keptOf(thrown, ballGivens, ballRest), ["u=20", "theta=30"], "a single unambiguous speed and angle are kept");
  // Each condition on its own drops the given.
  assert.deepEqual(keptOf(thrown, ballGivens, { ...ballRest, unknowns: [...ballRest.unknowns, { id: "vx", symbol: "v_x", unit: "m/s" }] }), ["theta=30"],
    "(a) another quantity of its dimension in the lane, even an unknown, drops the speed");
  assert.deepEqual(keptOf(thrown, ballGivens, { ...ballRest, derived: [...ballRest.derived, { id: "vy", symbol: "v_y", value: 10, unit: "km/h", provenance: "derived" }] }), ["theta=30"],
    "(a) a derived quantity of its dimension in another unit drops the speed");
  assert.deepEqual(keptOf(thrown, [...ballGivens, q("w", 3, "m/s")], ballRest), ["theta=30"],
    "(a) an unstated given of its dimension still counts against the speed");
  assert.deepEqual(keptOf(thrown, ballGivens, { ...ballRest, unknowns: [...ballRest.unknowns, { id: "k", symbol: "k", unit: "furlongs" }] }), [],
    "(a) a lane quantity whose unit cannot be read is in doubt and drops every given");
  assert.deepEqual(keptOf("A ball is thrown at 20 m/s at 30° above the horizontal from a cart moving at 5 m/s. Find its range.", ballGivens, ballRest), ["theta=30"],
    "(b) a second stated speed drops the speed");
  assert.deepEqual(keptOf("A ball is thrown at 20 m/s at 30° above the horizontal from a cart moving at six m/s. Find its range.", ballGivens, ballRest), ["theta=30"],
    "(b) a speed written in words still counts");
  assert.deepEqual(keptOf("A ball is thrown at 20 m/s at 30° above the horizontal. Find its range.", [q("u", 20, "km/h", "20 km/h", "u"), ballGivens[1]!], ballRest), ["theta=30"],
    "(c) the question's one speed in another unit is not the given's value");
  assert.deepEqual(keptOf("A ball is thrown at 20 m/s relative to a cart at 30° above the horizontal. Find its range.", ballGivens, ballRest), [],
    "(d) a relative marker in the question drops every given");
  for (const marker of ["with respect to a cart", "w.r.t. a cart", "as seen from a cart", "faster than a cart"]) {
    assert.deepEqual(keptOf(`A ball is thrown at 20 m/s ${marker} at 30° above the horizontal. Find its range.`, ballGivens, ballRest), [], `(d) "${marker}" drops every given`);
  }
  assert.deepEqual(keptOf(thrown, [{ ...ballGivens[0]!, sourceText: "20 m/s relative to the cart" }, ballGivens[1]!], ballRest), ["theta=30"],
    "(d) a relative marker in the given's own sourceText drops it");
  // A unitless given is a bare number: kept alone, dropped beside another bare number.
  assert.deepEqual(keptOf("A glass slab has refractive index 1.5. Find the speed of light in it.", [q("n", 1.5, undefined, "refractive index 1.5", "n")]), ["n=1.5"]);
  assert.deepEqual(keptOf("A glass of refractive index 1.5 and 3 identical slabs are stacked.", [q("n", 1.5, undefined, "refractive index 1.5", "n")]), [],
    "two bare numbers make a unitless given ambiguous");

  // The recorded v3 salvage cases (fixtures/v3-planner-selection.json in apps/tutor;
  // .context/youtube-full/v3/lessons has no other turn whose every lane was
  // rejected). On 0180e8af4 the owner rule kept p3c-t1's v_r = 6 and v_m = 8
  // and p3e1-t1's theta_app = 60 (3 givens); fail closed keeps none: both
  // lanes carry a second quantity of each given's dimension, p3c-t1 states two
  // speeds, and p3e1-t1's angle "appears".
  const p3c = "Explain rain and umbrella problems for JEE using this example: rain falls vertically at 6 m/s and a man walks east at 8 m/s. How does the rain look to him, and how should he hold his umbrella?";
  const p3cKept = keptOf(p3c, [{ ...q("vr", 6, "m/s", "rain falls vertically at 6 m/s"), sign: "-" }, { ...q("vm", 8, "m/s", "man walks east at 8 m/s"), sign: "+" }], {
    unknowns: [{ id: "vrel", symbol: "v_rm", unit: "m/s" }, { id: "theta", symbol: "theta", unit: "deg" }],
    derived: [{ id: "vrel", symbol: "v_rm", value: 10, unit: "m/s", provenance: "derived" }, { id: "theta", symbol: "theta", value: 37, unit: "deg", provenance: "derived" }],
  });
  const p3e1 = "A girl cycling east at 5 km/h sees the rain falling vertically. At 20 km/h, the rain appears to fall at 60° to the vertical, hitting her from the front. Find the actual speed of the rain, the angle it makes with the vertical, and which side it is tilted toward.";
  const p3e1Kept = keptOf(p3e1, [q("v1", 5, "km/h", "cycling east at 5 km/h", "v_g1"), q("v2", 20, "km/h", "At 20 km/h", "v_g2"), q("a2", 60, "deg", "appears to fall at 60° to the vertical", "theta_app")], {
    unknowns: [{ id: "vr", symbol: "v_r", unit: "km/h" }, { id: "ang", symbol: "theta", unit: "deg" }, { id: "side", symbol: "tilt_side" }],
    derived: [{ id: "vx", symbol: "v_rx", value: 5, unit: "km/h", provenance: "derived" }, { id: "ang", symbol: "theta", value: 30, unit: "deg", provenance: "derived" }],
  });
  assert.deepEqual([p3cKept, p3e1Kept], [[], []], "the recorded salvage cases keep no given they cannot prove unambiguous");
  console.log(`  ${probes.length} review probes keep no false given; recorded v3 salvage keeps p3c-t1 2 -> ${p3cKept.length}, p3e1-t1 1 -> ${p3e1Kept.length} givens (0180e8af4 -> now; total 3 -> ${p3cKept.length + p3e1Kept.length})`);
}

console.log("verify-v3-planner-selection: exact-source ranking and grace, retry feedback and budget, and question-stated salvage hold");
