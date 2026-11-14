/**
 * Every aborted planner request names why it stopped, and a turn-plan lane
 * that fails starts the one retry without waiting for its slower peer.
 */
import assert from "node:assert/strict";
import { plannerAbort, plannerAbortReason } from "../../src/llm/plannerAbort";
import { PLANNER_REQUEST_ID_HEADER } from "../../src/llm/traceHeaders";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRequestId = (value: unknown) => typeof value === "string" && UUID.test(value);
import {
  planSceneDocumentWithRepair,
  type SceneCandidateValidation,
  type ScenePlannerRequestOutcome,
} from "../../src/planners/scenePlannerV2";
import { planTurnV3, type TurnPlanRequestOutcome } from "../../src/planners/turnPlannerV3";

const BASE = 1_900_000_000_000;
let now = 0;
let sequence = 0;
const timers = new Map<number, { at: number; run: () => void }>();
const originalDateNow = Date.now;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const originalFetch = globalThis.fetch;
Date.now = () => BASE + now;
globalThis.setTimeout = ((run: () => void, delay = 0) => {
  sequence += 1;
  timers.set(sequence, { at: now + Math.max(0, delay), run });
  return sequence;
}) as unknown as typeof setTimeout;
globalThis.clearTimeout = ((id: number) => {
  timers.delete(id);
}) as unknown as typeof clearTimeout;

async function drain() {
  for (let tick = 0; tick < 60; tick += 1) await Promise.resolve();
}

async function settle<T>(operation: Promise<T>): Promise<{ value: T; atMs: number }> {
  let done = false;
  let value!: T;
  let failure: unknown;
  void operation.then((result) => { done = true; value = result; }, (error: unknown) => { done = true; failure = error; });
  for (let step = 0; step < 500; step += 1) {
    await drain();
    if (done) {
      if (failure) throw failure;
      return { value, atMs: now };
    }
    const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    assert(next, "the planner must settle on the fake clock");
    now = next[1].at;
    timers.delete(next[0]);
    next[1].run();
  }
  throw new Error("the planner exceeded the fake-clock step limit");
}

/** Run the remaining timers so aborted requests report their outcomes. */
async function flush() {
  for (let step = 0; step < 50; step += 1) {
    await drain();
    const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    if (!next) return;
    now = next[1].at;
    timers.delete(next[0]);
    next[1].run();
  }
}

type Call = { atMs: number; lane: string; retry: boolean; phase: string; requestId: string | null; abortedAtMs: number | null };
type Reply = { atMs: number; content: string } | "hang";

function harness(script: (call: Call) => Reply): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      atMs: now,
      lane: headers.get("x-turn-planner-lane") ?? headers.get("x-scene-planner-lane") ?? "",
      phase: headers.get("x-scene-planner-phase") ?? headers.get("x-turn-plan-phase") ?? "",
      retry: String(init?.body).includes("Return a complete corrected plan"),
      requestId: headers.get(PLANNER_REQUEST_ID_HEADER),
      abortedAtMs: null,
    };
    calls.push(call);
    const reply = script(call);
    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      const abort = () => { call.abortedAtMs = now; reject(signal?.reason ?? new DOMException("aborted", "AbortError")); };
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (reply === "hang") return;
      setTimeout(() => {
        if (call.abortedAtMs !== null) return;
        resolve(new Response(JSON.stringify({ choices: [{ message: { content: reply.content } }] })));
      }, reply.atMs - now);
    });
  }) as typeof fetch;
  return calls;
}

const question = "Explain a public test concept.";
const plan = {
  schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [],
  qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "none",
};
const validPlan = JSON.stringify(plan);
const invalidPlan = JSON.stringify({ ...plan, unknowns: [{ id: "x", symbol: "x" }] });

const scene = (tag: string) => JSON.stringify({
  schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source-grounded scene" }, tag,
});
const validate = (): SceneCandidateValidation<string> => ({ valid: true, errors: [], value: "scene", qualityScore: 1 });

let passed = 0;
async function scenario(name: string, run: () => Promise<void>) {
  now = 0;
  timers.clear();
  await run();
  passed += 1;
  console.log(`verify-planner-abort-reasons: ${name}`);
}

try {
  await scenario("named aborts survive merged signals; unnamed ones are the caller's", async () => {
    const named = new AbortController();
    named.abort(plannerAbort("superseded"));
    assert.equal(plannerAbortReason(named.signal), "superseded");
    const caller = new AbortController();
    caller.abort();
    assert.equal(plannerAbortReason(caller.signal), "turn_cancelled");
    assert.equal(plannerAbortReason(new AbortController().signal), null);
    assert.ok(plannerAbort("deadline") instanceof DOMException && plannerAbort("deadline").name === "AbortError",
      "fetch rejects with the reason, so it must stay an AbortError");
  });

  await scenario("a failed lane starts the retry at once and its plan is used", async () => {
    const outcomes: TurnPlanRequestOutcome[] = [];
    const calls = harness((call) => call.retry ? { atMs: now + 4_000, content: validPlan }
      : call.lane === "alternate" ? { atMs: 3_000, content: invalidPlan } : "hang");
    const { value, atMs } = await settle(planTurnV3(question, {
      proxyUrl: "http://planner.test", timeoutMs: 20_000, onRequestOutcome: (outcome) => outcomes.push(outcome),
    }));
    assert.ok(value, "the retry's valid plan is admitted");
    assert.equal(calls.length, 3, "still one retry");
    assert.equal(calls[2]?.retry, true);
    assert.equal(calls[2]?.atMs, 3_000, "the retry starts when the alternate fails, not when the primary would have");
    assert.equal(atMs, 10_000, "the stalled primary keeps only the existing three-second peer grace");
    await flush();
    const primary = outcomes.find((outcome) => outcome.requestKind === "initial" && outcome.lane === "primary");
    assert.deepEqual([primary?.code, primary?.abortReason], ["cancelled", "superseded"]);
    assert.equal(outcomes.find((outcome) => outcome.code === "accepted")?.abortReason, undefined);
  });

  await scenario("a valid peer never waits on an early retry", async () => {
    const outcomes: TurnPlanRequestOutcome[] = [];
    const calls = harness((call) => call.retry ? "hang"
      : call.lane === "alternate" ? { atMs: 1_000, content: invalidPlan } : { atMs: 6_000, content: validPlan });
    const { value, atMs } = await settle(planTurnV3(question, {
      proxyUrl: "http://planner.test", timeoutMs: 20_000, onRequestOutcome: (outcome) => outcomes.push(outcome),
    }));
    assert.ok(value);
    assert.equal(atMs, 6_000, "the primary's valid plan returns as soon as it arrives");
    assert.equal(calls.length, 3);
    await flush();
    const retry = outcomes.find((outcome) => outcome.requestKind === "retry");
    assert.deepEqual([retry?.code, retry?.abortReason], ["cancelled", "superseded"]);
  });

  await scenario("turn-plan deadline and caller cancel are named", async () => {
    const timedOut: TurnPlanRequestOutcome[] = [];
    harness(() => "hang");
    assert.equal((await settle(planTurnV3(question, {
      proxyUrl: "http://planner.test", timeoutMs: 20_000, onRequestOutcome: (outcome) => timedOut.push(outcome),
    }))).value, null);
    await flush();
    assert.equal(timedOut.length, 2, "no retry is left time after both lanes hit the deadline");
    assert.ok(timedOut.every((outcome) => outcome.code === "timeout" && outcome.abortReason === "deadline"));

    now = 0;
    timers.clear();
    const cancelled: TurnPlanRequestOutcome[] = [];
    const controller = new AbortController();
    harness(() => "hang");
    setTimeout(() => controller.abort(), 2_000);
    assert.equal((await settle(planTurnV3(question, {
      proxyUrl: "http://planner.test", timeoutMs: 20_000, signal: controller.signal,
      onRequestOutcome: (outcome) => cancelled.push(outcome),
    }))).value, null);
    await flush();
    assert.ok(cancelled.length > 0 && cancelled.every((outcome) => outcome.code === "cancelled" && outcome.abortReason === "turn_cancelled"));
  });

  await scenario("a scene peer stopped after the winner's grace is superseded", async () => {
    const outcomes: ScenePlannerRequestOutcome[] = [];
    const calls = harness((call) => call.lane === "primary" ? { atMs: 9_000, content: scene("winner") } : "hang");
    const { value, atMs } = await settle(planSceneDocumentWithRepair("q", validate, {
      proxyUrl: "http://planner.test", timeoutMs: 60_000, onRequestOutcome: (outcome) => outcomes.push(outcome),
    }));
    assert.equal(value?.response.lane, "primary");
    assert.equal(atMs, 9_750);
    assert.equal(calls[1]?.abortedAtMs, 9_750);
    await flush();
    const alternate = outcomes.find((outcome) => outcome.lane === "alternate");
    assert.equal(alternate?.abortReason, "superseded");
    assert.equal(outcomes.find((outcome) => outcome.lane === "primary")?.abortReason, undefined);
    assert.ok(isRequestId(alternate?.requestId), "the outcome names the request it reports");
    assert.equal(calls.find((call) => call.lane === "alternate")?.requestId, alternate?.requestId,
      "the server keys its generation by the same id the client reports");
    assert.notEqual(calls[0]?.requestId, calls[1]?.requestId);
  });

  await scenario("every turn-plan request sends the id its outcome reports", async () => {
    const outcomes: TurnPlanRequestOutcome[] = [];
    const calls = harness((call) => call.lane === "primary" ? { atMs: 2_000, content: validPlan } : "hang");
    await settle(planTurnV3(question, {
      proxyUrl: "http://planner.test", timeoutMs: 20_000, onRequestOutcome: (outcome) => outcomes.push(outcome),
    }));
    await flush();
    assert.equal(outcomes.length, 2);
    assert.deepEqual(new Set(outcomes.map((outcome) => outcome.requestId)), new Set(calls.map((call) => call.requestId)));
    assert.ok(outcomes.every((outcome) => isRequestId(outcome.requestId)));
  });

  await scenario("scene deadline and caller cancel are named", async () => {
    const outcomes: ScenePlannerRequestOutcome[] = [];
    harness(() => "hang");
    await settle(planSceneDocumentWithRepair("q", validate, {
      proxyUrl: "http://planner.test", timeoutMs: 12_000, onRequestOutcome: (outcome) => outcomes.push(outcome),
    }));
    await flush();
    assert.ok(outcomes.length >= 2 && outcomes.every((outcome) => outcome.abortReason === "deadline"));

    now = 0;
    timers.clear();
    const cancelled: ScenePlannerRequestOutcome[] = [];
    const controller = new AbortController();
    harness(() => "hang");
    setTimeout(() => controller.abort(), 2_000);
    await settle(planSceneDocumentWithRepair("q", validate, {
      proxyUrl: "http://planner.test", timeoutMs: 60_000, signal: controller.signal,
      onRequestOutcome: (outcome) => cancelled.push(outcome),
    }));
    await flush();
    assert.ok(cancelled.length >= 2 && cancelled.every((outcome) => outcome.abortReason === "turn_cancelled"));
  });

  console.log(`verify-planner-abort-reasons: ${passed} scenarios passed`);
} finally {
  Date.now = originalDateNow;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  globalThis.fetch = originalFetch;
}
