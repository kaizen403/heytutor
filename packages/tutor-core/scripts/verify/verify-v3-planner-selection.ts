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
 *    law ids; no derived value, unknown or claim survives.
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
    { id: "vm", symbol: "v_m", value: 8, unit: "m/s", sourceText: "walks east at 8 m/s", provenance: "given" },
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

  const issues = [{ code: "claim_quantity_mismatch", path: "qualitativeClaims[0].claim", message: "measured claim 12 m/s disagrees" }];
  const salvaged = salvageRejectedTurnPlanV3(question, [{ lane: "primary", requestKind: "initial", plan: rejectedPlan, issues }]);
  assert.ok(salvaged, "question-stated givens are salvaged");
  assert.deepEqual(salvaged.givens.map((given) => [given.id, given.value, given.unit]), [["vr", 6, "m/s"], ["vm", 8, "m/s"]],
    "a value the question does not state (g = 9.8) is dropped");
  assert.deepEqual(salvaged.derived, [], "no derived value survives");
  assert.deepEqual(salvaged.unknowns, []);
  assert.deepEqual(salvaged.qualitativeClaims, [], "no claim survives");
  assert.deepEqual(salvaged.lawIds, ["relative_velocity", "pythagorean_theorem"], "law ids are kept");
  assert.equal(salvaged.visualRequirement, "required");
  assert.equal(salvaged.question, question);

  // Mutation: a changed value, a changed unit, or a derived value relabelled
  // as given is not stated by the question and does not survive.
  const mutated = {
    ...rejectedPlan,
    givens: [
      { ...rejectedPlan.givens[0]!, value: 7 },
      { ...rejectedPlan.givens[1]!, unit: "km/h" },
      { id: "vrel", symbol: "v_rel", value: 10, unit: "m/s", sourceText: "sqrt(36+64)", provenance: "given" },
    ],
  };
  assert.equal(salvageRejectedTurnPlanV3(question, [{ lane: "primary", requestKind: "initial", plan: mutated, issues }]), null,
    "with no question-stated given there is nothing to salvage");
  // The best rejected plan is the one with the most stated givens.
  const best = salvageRejectedTurnPlanV3(question, [
    { lane: "primary", requestKind: "initial", plan: mutated, issues },
    { lane: "alternate", requestKind: "initial", plan: rejectedPlan, issues },
  ]);
  assert.deepEqual(best?.givens.map((given) => given.id), ["vr", "vm"]);
}

console.log("verify-v3-planner-selection: exact-source ranking and grace, retry feedback and budget, and question-stated salvage hold");
