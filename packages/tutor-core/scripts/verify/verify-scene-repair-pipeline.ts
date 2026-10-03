/**
 * Early repair in planSceneDocumentWithRepair, on a fake clock.
 *
 * Every request is scripted to answer (or hang until aborted) at a virtual
 * time, so the assertions read as a timeline: when each repair batch started,
 * which candidate seeded it, what was aborted, and when the search returned.
 */
import assert from "node:assert/strict";
import {
  planSceneDocumentWithRepair,
  type SceneCandidateValidation,
} from "../../src/planners/scenePlannerV2";

type Call = {
  index: number;
  atMs: number;
  phase: string;
  lane: string;
  deadlineMs: number;
  seed: string | null;
  aborted: boolean;
  abortedAtMs: number | null;
};
/**
 * Answer `doc` at virtual `atMs` (its own timer callback), answer nothing
 * (`doc: null`), hang until aborted, or answer in the same macrotask as the
 * request (`atMs: "now"`), so two such answers land together.
 */
type Reply = { atMs: number | "now"; doc: Record<string, unknown> | null } | "hang";

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

const flush = async () => {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
};

async function settle<T>(operation: Promise<T>): Promise<{ value: T; atMs: number }> {
  let done = false;
  let value!: T;
  void operation.then((result) => {
    done = true;
    value = result;
  });
  for (let step = 0; step < 500; step += 1) {
    await flush();
    if (done) return { value, atMs: now };
    const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    assert(next, "the search left no timer but did not return");
    now = next[1].at;
    timers.delete(next[0]);
    next[1].run();
  }
  throw new Error("the search did not settle");
}

function harness(script: (call: Call) => Reply) {
  const calls: Call[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    const prompt = body.messages.at(-1)?.content ?? "";
    const seedMatch = prompt.match(/PREVIOUS STRUCTURE\n.*?"tag":"([^"]+)"/);
    const call: Call = {
      index: calls.length,
      atMs: now,
      phase: headers.get("x-scene-planner-phase") ?? "",
      lane: headers.get("x-scene-planner-lane") ?? "",
      deadlineMs: Number(headers.get("x-planner-deadline-ms")),
      seed: seedMatch?.[1] ?? null,
      aborted: false,
      abortedAtMs: null,
    };
    calls.push(call);
    const reply = script(call);
    return new Promise((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        call.aborted = true;
        call.abortedAtMs = now;
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
      if (reply === "hang") return;
      const answer = () => {
        if (call.aborted) return;
        resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => reply.doc
            ? { choices: [{ message: { content: JSON.stringify(reply.doc) } }] }
            : { choices: [{ message: { content: "" } }] },
        } as unknown as Response);
      };
      if (reply.atMs === "now") answer();
      else setTimeout(answer, reply.atMs - now);
    });
  }) as typeof fetch;
  return calls;
}

/** Candidate docs carry a tag and how many fatal errors validation reports. */
const doc = (tag: string, fatal: number) => ({ schemaVersion: "scene-document/v2", tag, fatal });
const validate = (candidate: Record<string, unknown>): SceneCandidateValidation<string> => {
  const fatal = Number(candidate.fatal);
  return fatal === 0
    ? { valid: true, errors: [], value: String(candidate.tag), qualityScore: 1 }
    : {
        valid: false,
        errors: Array.from({ length: fatal }, (_, index) => ({
          code: `fatal_${index}`,
          message: "geometry failed",
          severity: "fatal" as const,
        })),
      };
};
const options = (timeoutMs = 60_000) => ({ proxyUrl: "http://planner.test", timeoutMs });
const tags = (result: { candidates: Array<{ response: { document: Record<string, unknown> } }> } | null) =>
  result?.candidates.map((candidate) => candidate.response.document.tag) ?? [];

let passed = 0;
async function scenario(name: string, run: () => Promise<void>) {
  now = 0;
  timers.clear();
  await run();
  passed += 1;
  console.log(`verify-scene-repair-pipeline: ${name}`);
}

try {
  await scenario("an invalid candidate is repaired while the other is still pending", async () => {
    const calls = harness((call) => {
      if (call.phase === "plan") {
        return call.lane === "primary" ? { atMs: 1_000, doc: doc("A", 3) } : { atMs: 20_000, doc: doc("B", 4) };
      }
      // Round 1 (seeded by A) fails at 3s; round 2 is valid at 5s, its alternate
      // would answer at 6s, after the grace closes.
      return call.seed === "A"
        ? { atMs: 3_000, doc: doc(`A-r${call.lane}`, call.lane === "primary" ? 2 : 5) }
        : call.lane === "primary"
          ? { atMs: 5_000, doc: doc("R2-primary", 0) }
          : { atMs: 6_000, doc: doc("R2-alternate", 1) };
    });
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, options()));
    const repairs = calls.filter((call) => call.phase === "repair");
    assert.equal(repairs[0]?.atMs, 1_000, "round 1 must start when A is evaluated, not when B answers");
    assert.equal(repairs[0]?.seed, "A");
    assert.equal(repairs[2]?.atMs, 3_000, "round 2 starts as soon as round 1 settles");
    assert.equal(repairs[2]?.seed, "A-rprimary", "round 2 is seeded by the best candidate not yet repaired");
    assert.equal(repairs.length, 4, "the repair call ceiling stays at two rounds of two");
    assert.equal(atMs, 5_750, "a valid repair ends the search after the 750ms grace");
    assert(calls.find((call) => call.phase === "plan" && call.lane === "alternate")?.aborted,
      "the pending initial candidate is aborted once the grace closes");
    assert(result?.validation.valid && result.response.document.tag === "R2-primary");
    assert.equal(result?.repaired, true);
    assert.equal(result?.repairRounds, 2);
    assert.deepEqual(tags(result), ["A", "A-rprimary", "A-ralternate", "R2-primary"],
      "the aborted alternate never enters the candidate record");
    assert.equal(result?.candidates.filter((candidate) => candidate.selected).length, 1);
  });

  await scenario("rounds are capped at two and selection spans every evaluated candidate", async () => {
    const calls = harness((call) => {
      if (call.phase === "plan") {
        return call.lane === "primary" ? { atMs: 1_000, doc: doc("A", 4) } : { atMs: 2_000, doc: doc("B", 1) };
      }
      return { atMs: call.atMs + 2_000, doc: doc(`rep-${call.index}`, 6) };
    });
    const { value: result } = await settle(planSceneDocumentWithRepair("q", validate, options()));
    const repairs = calls.filter((call) => call.phase === "repair");
    assert.equal(repairs.length, 4, "two rounds of two repairs, never more");
    assert.equal(repairs[0]?.seed, "A", "round 1 starts on A before B arrives");
    assert.equal(repairs[2]?.seed, "B", "round 2 takes B, the best candidate that has not seeded a round");
    assert.equal(repairs[2]?.atMs, 3_000, "only one round is in flight at a time");
    assert.equal(result?.repairRounds, 2);
    assert.equal(result?.validation.valid, false);
    assert.equal(result?.response.document.tag, "B", "the fewest fatal errors win across all evaluated candidates");
    assert.equal(result?.repaired, false, "the selected candidate is an initial plan");
    assert.equal(result?.candidates.length, 6);
  });

  await scenario("a valid initial candidate ends the search and aborts in-flight repairs", async () => {
    const calls = harness((call) => {
      if (call.phase === "plan") {
        return call.lane === "primary" ? { atMs: 1_000, doc: doc("A", 2) } : { atMs: 2_000, doc: doc("B", 0) };
      }
      return { atMs: 10_000, doc: doc(`rep-${call.lane}`, 0) };
    });
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, options()));
    const repairs = calls.filter((call) => call.phase === "repair");
    assert.equal(repairs.length, 2, "no second round after a valid candidate");
    assert(repairs.every((call) => call.aborted && call.abortedAtMs === 2_750), "losing repairs abort when the grace closes");
    assert.equal(atMs, 2_750);
    assert.equal(result?.response.document.tag, "B");
    assert.equal(result?.repaired, false);
  });

  await scenario("candidates that land together are compared before a repair starts", async () => {
    const calls = harness((call) => call.phase === "plan"
      ? { atMs: "now", doc: call.lane === "primary" ? doc("A", 1) : doc("B", 0) }
      : { atMs: 2_000, doc: doc("rep", 0) });
    const { value: result } = await settle(planSceneDocumentWithRepair("q", validate, options()));
    assert.equal(calls.filter((call) => call.phase === "repair").length, 0,
      "an invalid candidate is not repaired when a valid one arrived in the same macrotask");
    assert.equal(result?.response.document.tag, "B");
  });

  await scenario("the overall deadline holds while an early repair is in flight", async () => {
    const calls = harness((call) => call.phase === "plan" && call.lane === "primary"
      ? { atMs: 1_000, doc: doc("A", 2) }
      : "hang");
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, options(8_000)));
    const repairs = calls.filter((call) => call.phase === "repair");
    assert.equal(repairs.length, 2);
    assert(repairs.every((call) => call.deadlineMs === 7_000), "repairs receive the remaining budget at launch");
    assert(atMs <= 8_000, `the search must return by its deadline, returned at ${atMs}`);
    assert(calls.filter((call) => call !== calls[0]).every((call) => call.aborted), "everything pending is aborted at the deadline");
    assert.equal(result?.validation.valid, false);
    assert.equal(result?.response.document.tag, "A");
  });

  await scenario("initial plans that return nothing fall back to one serial plan, then repair it", async () => {
    const calls = harness((call) => {
      if (call.phase === "plan") {
        return call.index < 2 ? { atMs: 1_000, doc: null } : { atMs: 4_000, doc: doc("F", 2) };
      }
      return { atMs: call.atMs + 1_000, doc: doc(`rep-${call.lane}`, call.lane === "primary" ? 0 : 3) };
    });
    const { value: result } = await settle(planSceneDocumentWithRepair("q", validate, options()));
    assert.equal(calls.filter((call) => call.phase === "plan").length, 3, "one fallback plan after two empty answers");
    assert.equal(calls[2]?.atMs, 1_000);
    assert.equal(calls[2]?.deadlineMs, 59_000, "the fallback plan gets the rest of the budget");
    assert.equal(calls.filter((call) => call.phase === "repair")[0]?.seed, "F");
    assert(result?.validation.valid && result.response.document.tag === "rep-primary");
  });

  await scenario("a caller abort stops the search and every request", async () => {
    const calls = harness((call) => call.phase === "plan" && call.lane === "primary"
      ? { atMs: 1_000, doc: doc("A", 2) }
      : "hang");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 3_000);
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, {
      ...options(),
      signal: controller.signal,
    }));
    assert.equal(atMs, 3_000);
    assert(calls.slice(1).every((call) => call.aborted));
    assert.equal(result?.validation.valid, false);
  });

  console.log(`verify-scene-repair-pipeline: ${passed} scenarios passed`);
} finally {
  Date.now = originalDateNow;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  globalThis.fetch = originalFetch;
}
