/** Required scenes retain a valid decline while already-started peers finish. */
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
  body: string;
  abortedAtMs: number | null;
  answeredAtMs: number | null;
};
type Reply = { atMs: number; doc: Record<string, unknown> | null } | "hang";

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

async function settle<T>(operation: Promise<T>): Promise<{ value: T; atMs: number }> {
  let done = false;
  let value!: T;
  let failure: unknown;
  void operation.then((result) => {
    done = true;
    value = result;
  }, (error: unknown) => {
    done = true;
    failure = error;
  });
  for (let step = 0; step < 500; step += 1) {
    for (let tick = 0; tick < 40; tick += 1) await Promise.resolve();
    if (done) {
      if (failure) throw failure;
      return { value, atMs: now };
    }
    const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    assert(next, "the planner must settle without an external clock or service");
    now = next[1].at;
    timers.delete(next[0]);
    next[1].run();
  }
  throw new Error("the planner exceeded the fake-clock step limit");
}

function harness(script: (call: Call) => Reply): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      index: calls.length,
      atMs: now,
      phase: headers.get("x-scene-planner-phase") ?? "",
      lane: headers.get("x-scene-planner-lane") ?? "",
      deadlineMs: Number(headers.get("x-planner-deadline-ms")),
      body: String(init?.body),
      abortedAtMs: null,
      answeredAtMs: null,
    };
    calls.push(call);
    const reply = script(call);
    return new Promise((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        call.abortedAtMs = now;
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
      if (reply === "hang") return;
      setTimeout(() => {
        if (call.abortedAtMs !== null) return;
        call.answeredAtMs = now;
        resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ choices: [{ message: { content: reply.doc ? JSON.stringify(reply.doc) : "" } }] }),
        } as Response);
      }, reply.atMs - now);
    });
  }) as typeof fetch;
  return calls;
}

const scene = (tag: string, valid = true) => ({
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "source-grounded scene" },
  tag,
  valid,
});
const decline = (tag = "decline", shorthand = false) => ({
  ...scene(tag),
  visualDecision: shorthand ? "text_only" : { mode: "text_only", reason: "cannot construct a supported scene" },
});
// Only the transport and clock are fake: validation remains the caller's
// authority, including its existing preference for a drawable scene (1) over
// a valid empty decline (5000). Invalid geometry can never beat either.
const validate = (candidate: Record<string, unknown>): SceneCandidateValidation<string> =>
  candidate.valid === true
    ? {
        valid: true,
        errors: [],
        value: String(candidate.tag),
        qualityScore: candidate.visualDecision === "text_only" ||
          (typeof candidate.visualDecision === "object" && candidate.visualDecision !== null &&
            "mode" in candidate.visualDecision && candidate.visualDecision.mode === "text_only") ? 5_000 : 1,
      }
    : { valid: false, errors: [{ code: "invalid_geometry", message: "invalid geometry", severity: "fatal" }] };

const options = (timeoutMs = 60_000) => ({
  proxyUrl: "http://planner.test",
  timeoutMs,
  waitForRequiredScenePeers: true,
});

let passed = 0;
async function scenario(name: string, run: () => Promise<void>) {
  now = 0;
  timers.clear();
  await run();
  passed += 1;
  console.log(`verify-required-scene-peer-drain: ${name}`);
}

try {
  await scenario("a delayed valid scene beats the early valid decline", async () => {
    const calls = harness((call) => call.lane === "primary"
      ? { atMs: 1_000, doc: decline() }
      : { atMs: 5_000, doc: scene("drawable") });
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, options()));
    assert.equal(result?.response.document.tag, "drawable", "a required scene peer must survive the decline's old grace");
    assert.equal(atMs, 5_000, "return immediately once every started peer is evaluated");
    assert.equal(calls[1]?.abortedAtMs, null);
    assert.equal(calls.length, 2);
    assert.equal(result?.candidates.length, 2);
    assert.equal(result?.candidates.filter((candidate) => candidate.selected).length, 1);
  });

  await scenario("an invalid peer cannot replace the valid decline or start repairs", async () => {
    const budget = { remaining: 6 };
    const calls = harness((call) => call.lane === "primary"
      ? { atMs: 1_000, doc: decline() }
      : { atMs: 5_000, doc: scene("invalid", false) });
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, {
      ...options(), requestBudget: budget,
    }));
    assert.equal(atMs, 5_000);
    assert.equal(result?.response.document.tag, "decline");
    assert.equal(result?.validation.valid, true);
    assert.equal(result?.candidates[1]?.validation.valid, false, "failed geometry remains visibly rejected");
    assert.equal(calls.length, 2, "a valid decline stops repair dispatch even when the peer is invalid");
    assert.equal(budget.remaining, 4);
  });

  await scenario("an empty peer cannot discard the decline or dispatch a fallback", async () => {
    const calls = harness((call) => call.lane === "primary"
      ? { atMs: 1_000, doc: decline() }
      : { atMs: 5_000, doc: null });
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, options()));
    assert.equal(atMs, 5_000);
    assert.equal(result?.response.document.tag, "decline");
    assert.equal(calls.length, 2);
  });

  await scenario("all valid declines finish when their last peer answers", async () => {
    const calls = harness((call) => call.lane === "primary"
      ? { atMs: 1_000, doc: decline("first") }
      : { atMs: 5_000, doc: decline("second") });
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, options()));
    assert.equal(atMs, 5_000);
    assert.equal(result?.response.document.tag, "first", "equal-quality declines keep the existing selection order");
    assert.equal(result?.candidates.length, 2);
    assert.equal(calls.length, 2);
  });

  await scenario("the shorthand text_only envelope also retains its peer", async () => {
    harness((call) => call.lane === "primary"
      ? { atMs: 1_000, doc: decline("shorthand", true) }
      : { atMs: 5_000, doc: scene("drawable") });
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, options()));
    assert.equal(atMs, 5_000);
    assert.equal(result?.response.document.tag, "drawable");
  });

  await scenario("a decline drains repairs already started but never launches another round", async () => {
    const budget = { remaining: 6 };
    const calls = harness((call) => {
      if (call.phase === "plan") return call.lane === "primary"
        ? { atMs: 1_000, doc: scene("seed", false) }
        : { atMs: 2_000, doc: decline() };
      return call.lane === "primary"
        ? { atMs: 3_000, doc: scene("failed-repair", false) }
        : { atMs: 5_000, doc: scene("drawable-repair") };
    });
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, {
      ...options(), requestBudget: budget,
    }));
    assert.equal(result?.response.document.tag, "drawable-repair");
    assert.equal(atMs, 5_000);
    assert.equal(result?.repairRounds, 1);
    assert.equal(result?.selectedFromRepair, true);
    assert.deepEqual(calls.map((call) => call.atMs), [0, 0, 1_000, 1_000]);
    assert.equal(budget.remaining, 2, "draining does not purchase a second repair batch");
  });

  await scenario("the first drawable scene still starts exactly the 750ms grace", async () => {
    const calls = harness((call) => {
      if (call.phase === "plan") return call.lane === "primary"
        ? { atMs: 1_000, doc: scene("seed", false) }
        : { atMs: 2_000, doc: decline() };
      return call.lane === "primary" ? { atMs: 4_000, doc: scene("drawable") } : "hang";
    });
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, options()));
    assert.equal(result?.response.document.tag, "drawable");
    assert.equal(atMs, 4_750);
    assert.equal(calls[3]?.abortedAtMs, 4_750, "a pending repair is cancelled at the scene's original grace");
    assert.equal(calls.length, 4);
  });

  await scenario("a drawable first response keeps the legacy grace", async () => {
    const calls = harness((call) => call.lane === "primary"
      ? { atMs: 1_000, doc: scene("drawable") }
      : { atMs: 5_000, doc: scene("later") });
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, options()));
    assert.equal(result?.response.document.tag, "drawable");
    assert.equal(atMs, 1_750);
    assert.equal(calls[1]?.abortedAtMs, 1_750);
  });

  await scenario("an invalid text-only candidate still permits normal repair", async () => {
    const calls = harness((call) => {
      if (call.phase === "plan") return call.lane === "primary"
        ? { atMs: 1_000, doc: { ...decline(), valid: false } }
        : "hang";
      return call.lane === "primary" ? { atMs: 2_000, doc: scene("repaired") } : "hang";
    });
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, options()));
    assert.equal(result?.response.document.tag, "repaired");
    assert.equal(atMs, 2_750);
    assert.equal(result?.repairRounds, 1);
    assert.equal(calls.length, 4);
  });

  await scenario("the outer deadline cancels a peer and preserves the valid decline", async () => {
    const calls = harness((call) => call.lane === "primary"
      ? { atMs: 1_000, doc: decline() } : "hang");
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, options(8_000)));
    assert.equal(atMs, 8_000);
    assert.equal(calls[1]?.abortedAtMs, 8_000);
    assert.deepEqual(calls.map((call) => call.deadlineMs), [8_000, 8_000]);
    assert.equal(result?.response.document.tag, "decline");
    assert.equal(calls.length, 2);
  });

  await scenario("initial peers keep their 30-second request cap", async () => {
    const calls = harness((call) => call.lane === "primary"
      ? { atMs: 1_000, doc: decline() } : "hang");
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, options()));
    assert.equal(atMs, 30_000, "draining ends at the request cap without consuming the full 60-second turn");
    assert.equal(calls[1]?.abortedAtMs, 30_000);
    assert.deepEqual(calls.map((call) => call.deadlineMs), [30_000, 30_000]);
    assert.equal(result?.response.document.tag, "decline");
    assert.equal(calls.length, 2);
  });

  await scenario("already-started repairs retain their own request deadlines", async () => {
    const calls = harness((call) => {
      if (call.phase === "plan") return call.lane === "primary"
        ? { atMs: 1_000, doc: scene("seed", false) }
        : { atMs: 2_000, doc: decline() };
      return "hang";
    });
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, options()));
    assert.equal(atMs, 31_000, "repair caps remain relative to their original launch");
    assert(calls.slice(2).every((call) => call.deadlineMs === 30_000 && call.abortedAtMs === 31_000));
    assert.equal(result?.response.document.tag, "decline");
    assert.equal(calls.length, 4);
  });

  await scenario("caller abort cancels a drained peer immediately", async () => {
    const calls = harness((call) => call.lane === "primary"
      ? { atMs: 1_000, doc: decline() } : "hang");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 3_000);
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, {
      ...options(), signal: controller.signal,
    }));
    assert.equal(atMs, 3_000);
    assert.equal(calls[1]?.abortedAtMs, 3_000);
    assert.equal(result?.response.document.tag, "decline");
    assert.equal(calls.length, 2);
  });

  let legacyRequestBytes: string[] | undefined;
  for (const enabled of [undefined, false]) {
    await scenario(`${enabled === undefined ? "the default" : "an explicit false option"} keeps legacy cancellation and request bytes`, async () => {
      const calls = harness((call) => call.lane === "primary"
        ? { atMs: 1_000, doc: decline() }
        : { atMs: 5_000, doc: scene("drawable") });
      const { waitForRequiredScenePeers: _enabled, ...legacyOptions } = options();
      assert.equal(_enabled, true, "remove the helper's opt-in before testing legacy defaults");
      const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, {
        ...legacyOptions,
        ...(enabled === undefined ? {} : { waitForRequiredScenePeers: enabled }),
      }));
      assert.equal(result?.response.document.tag, "decline");
      assert.equal(atMs, 1_750);
      assert.equal(calls[1]?.abortedAtMs, 1_750);
      assert.equal(calls.length, 2);
      const bodies = calls.map((call) => call.body);
      if (legacyRequestBytes) assert.deepEqual(bodies, legacyRequestBytes);
      else legacyRequestBytes = bodies;
    });
  }

  await scenario("the opt-in does not alter provider request bytes", async () => {
    const calls = harness((call) => call.lane === "primary"
      ? { atMs: 1_000, doc: decline() }
      : { atMs: 5_000, doc: scene("drawable") });
    await settle(planSceneDocumentWithRepair("q", validate, options()));
    assert.deepEqual(calls.map((call) => call.body), legacyRequestBytes);
  });

  await scenario("held candidates drain only after validation is accepted", async () => {
    const calls = harness((call) => call.lane === "primary"
      ? { atMs: 1_000, doc: decline() }
      : { atMs: 6_000, doc: scene("drawable") });
    const validatedAt: number[] = [];
    const release = new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 3_000));
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", (candidate) => {
      validatedAt.push(now);
      return validate(candidate);
    }, { ...options(), holdValidationUntil: release }));
    assert.deepEqual(validatedAt, [3_000, 6_000]);
    assert.equal(result?.response.document.tag, "drawable");
    assert.equal(atMs, 6_000);
    assert.equal(calls.length, 2);
  });

  await scenario("discarded speculative candidates never validate or repair", async () => {
    const calls = harness((call) => call.lane === "primary"
      ? { atMs: 1_000, doc: decline() } : "hang");
    let validations = 0;
    const release = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000));
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", (candidate) => {
      validations += 1;
      return validate(candidate);
    }, { ...options(), holdValidationUntil: release }));
    assert.equal(result, null);
    assert.equal(validations, 0);
    assert.equal(atMs, 3_000);
    assert.equal(calls[1]?.abortedAtMs, 3_000);
    assert.equal(calls.length, 2);
  });

  await scenario("shared request budget bounds concurrent searches while peers drain", async () => {
    const budget = { remaining: 3 };
    const calls = harness((call) => call.index === 1
      ? { atMs: 5_000, doc: scene("drawable") }
      : { atMs: 1_000, doc: decline(`decline-${call.index}`) });
    const { value: results, atMs } = await settle(Promise.all([
      planSceneDocumentWithRepair("q", validate, { ...options(), requestBudget: budget, maxConcurrentRequests: 2 }),
      planSceneDocumentWithRepair("q", validate, { ...options(), requestBudget: budget, maxConcurrentRequests: 2 }),
    ]));
    assert.deepEqual(results.map((result) => result?.response.document.tag), ["drawable", "decline-2"]);
    assert.equal(atMs, 5_000);
    assert.equal(calls.length, 3);
    assert.equal(budget.remaining, 0);
    assert(calls.every((call) => call.atMs === 0), "draining never dispatches an extra request");
  });

  await scenario("a concurrency limit does not turn a decline into another plan", async () => {
    const budget = { remaining: 6 };
    const calls = harness(() => ({ atMs: 1_000, doc: decline() }));
    const { value: result, atMs } = await settle(planSceneDocumentWithRepair("q", validate, {
      ...options(), requestBudget: budget, maxConcurrentRequests: 1,
    }));
    assert.equal(atMs, 1_000);
    assert.equal(result?.response.document.tag, "decline");
    assert.equal(calls.length, 1, "only peers already in flight may be drained");
    assert.equal(budget.remaining, 5);
  });

  console.log(`verify-required-scene-peer-drain: ${passed} scenarios passed`);
} finally {
  Date.now = originalDateNow;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  globalThis.fetch = originalFetch;
}
