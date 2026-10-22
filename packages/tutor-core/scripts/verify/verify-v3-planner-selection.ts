/**
 * Video 3 lane 1 (20 Oct 2026): planner candidate order and turn plan retry.
 *
 * 1. A valid scene candidate whose source.question restates the asked
 *    question is refused at final selection. It must rank below an exact one
 *    and must not open the grace window that cancels the exact sibling
 *    (v3 p1e1-t1: the restated lane arrived 0.5 s first and won).
 * 2. The corrected turn plan retry carries the validator's issues and gets a
 *    minimum budget when there is something to fix (v3 p3e1-t1: 5.2 s, aborted).
 * 3. A turn whose lanes are all rejected gets main's fallback plan, with no
 *    givens; nothing from a rejected lane is kept.
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
  createFallbackTurnPlanV3,
  planTurnV3,
  TURN_PLAN_RETRY_MIN_MS,
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
    const result = await planTurnV3(question, { proxyUrl: "http://planner.test", timeoutMs: 20_000 });
    assert.equal(result, null, "a plan the validator refuses is never admitted");
    assert.equal(bodies.length, 3, "two lanes and one corrected retry");
    const retry = bodies[2]!;
    assert.equal(Number(retry.deadline), TURN_PLAN_RETRY_MIN_MS, "the retry gets the minimum budget, not the 5.2 s left over");
    assert.match(retry.user, /REJECTED BY THE DETERMINISTIC VALIDATOR/);
    assert.match(retry.user, /qualitativeClaims\[0\] \(c1\)\.claim \(claim_quantity_mismatch\): measured claim 12 m\/s/,
      "the retry names the failing path, its id and the validator message");
    assert.ok(!bodies[0]!.user.includes("REJECTED BY"), "initial lanes are unchanged");
    // 3. Every lane was rejected: the caller runs main's fallback plan, which has no givens.
    assert.deepEqual(createFallbackTurnPlanV3(question).givens, [], "every lane rejected yields main's fallback plan with no givens");

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

console.log("verify-v3-planner-selection: exact-source ranking and grace, retry feedback and budget, and the fallback when every lane is rejected hold");
