/**
 * A begin-turn body that is parsed after a newer lesson owns the meter must
 * not change remainingPct, plan, or reset. The lesson that still owns the
 * turn still applies its own 402 or 200 body.
 *
 * Evidence class: the real billingClient.beginTurn. Global fetch is replaced
 * with a stub that returns a Response and is restored before exit. The stub
 * accepts only POST /api/billing/begin-turn and never delegates to the
 * network, so Autumn, ElevenLabs, Fireworks, and other providers are not
 * called.
 *
 * This is not verify-billing-failure-exit.ts. That script extracts
 * useQuestionHandler source and runs a fake beginTurn. It does not execute
 * this client, and its fake beginTurn does not write the usage meter.
 */
import assert from "node:assert/strict";
import { beginTurn } from "../../lib/billing/billingClient";
import { getEntitlementSnapshot, setEntitlementSnapshot } from "../../lib/billing/entitlementState";

const BASELINE_REMAINING = 40;
const BASELINE_PLAN = "free";
const BASELINE_RESET = 1_700_000_000_000;
const NEWER_REMAINING = 72;
const NEWER_PLAN = "plus";
const NEWER_RESET = 1_800_000_000_000;
const CURRENT_SUCCESS_REMAINING = 55;
const CURRENT_SUCCESS_PLAN = "plus";
const CURRENT_SUCCESS_RESET = 1_750_000_000_000;
const CURRENT_SUCCESS_TTS = 900;
const STALE_SUCCESS_REMAINING = 15;
const STALE_SUCCESS_PLAN = "free";
const STALE_SUCCESS_RESET = 1_600_000_000_000;
const STALE_SUCCESS_TTS = 40;
const REFUSAL_REMAINING = 0;

type Meter = {
  planId: string;
  remainingPct: number | null;
  nextResetAt: number | null;
};

type Case = {
  name: string;
  status: 402 | 200;
  superseded: boolean;
  traceId: string;
  body: Record<string, unknown>;
  meter: Meter;
  returnedRemaining: number;
  returnedPlan?: string;
  returnedReset?: number | null;
  returnedTts?: number;
};

const CASES: Case[] = [
  {
    name: "402 current",
    status: 402,
    superseded: false,
    traceId: "current-refusal",
    body: { code: "out_of_credits", remainingPct: REFUSAL_REMAINING },
    meter: { planId: BASELINE_PLAN, remainingPct: REFUSAL_REMAINING, nextResetAt: BASELINE_RESET },
    returnedRemaining: REFUSAL_REMAINING,
  },
  {
    name: "402 superseded",
    status: 402,
    superseded: true,
    traceId: "stale-refusal",
    body: { code: "out_of_credits", remainingPct: REFUSAL_REMAINING },
    meter: { planId: NEWER_PLAN, remainingPct: NEWER_REMAINING, nextResetAt: NEWER_RESET },
    returnedRemaining: REFUSAL_REMAINING,
  },
  {
    name: "200 current",
    status: 200,
    superseded: false,
    traceId: "current-success",
    body: {
      remainingPct: CURRENT_SUCCESS_REMAINING,
      planId: CURRENT_SUCCESS_PLAN,
      nextResetAt: CURRENT_SUCCESS_RESET,
      ttsCharsRemaining: CURRENT_SUCCESS_TTS,
    },
    meter: {
      planId: CURRENT_SUCCESS_PLAN,
      remainingPct: CURRENT_SUCCESS_REMAINING,
      nextResetAt: CURRENT_SUCCESS_RESET,
    },
    returnedRemaining: CURRENT_SUCCESS_REMAINING,
    returnedPlan: CURRENT_SUCCESS_PLAN,
    returnedReset: CURRENT_SUCCESS_RESET,
    returnedTts: CURRENT_SUCCESS_TTS,
  },
  {
    name: "200 superseded",
    status: 200,
    superseded: true,
    traceId: "stale-success",
    body: {
      remainingPct: STALE_SUCCESS_REMAINING,
      planId: STALE_SUCCESS_PLAN,
      nextResetAt: STALE_SUCCESS_RESET,
      ttsCharsRemaining: STALE_SUCCESS_TTS,
    },
    meter: { planId: NEWER_PLAN, remainingPct: NEWER_REMAINING, nextResetAt: NEWER_RESET },
    returnedRemaining: STALE_SUCCESS_REMAINING,
    returnedPlan: STALE_SUCCESS_PLAN,
    returnedReset: STALE_SUCCESS_RESET,
    returnedTts: STALE_SUCCESS_TTS,
  },
];

function requestUrl(input: RequestInfo | URL): URL {
  const raw = input instanceof Request ? input.url : String(input);
  return new URL(raw, "http://tutor.local");
}

function jsonResponse(status: number, body: unknown, onRead: () => void): Response {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  let sent = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) return;
      sent = true;
      onRead();
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "content-type": "application/json" },
  });
}

function expectMeter(expected: Meter, label: string): void {
  const snapshot = getEntitlementSnapshot();
  assert.equal(snapshot?.remainingPct, expected.remainingPct, `${label} remainingPct`);
  assert.equal(snapshot?.planId, expected.planId, `${label} plan`);
  assert.equal(snapshot?.nextResetAt, expected.nextResetAt, `${label} reset`);
}

async function exercise(input: Case): Promise<void> {
  const generation = 4;
  const activeGeneration = { current: generation };
  const abortController = new AbortController();
  let bodyRead = false;
  const calls: string[] = [];
  setEntitlementSnapshot({
    planId: BASELINE_PLAN,
    remainingPct: BASELINE_REMAINING,
    nextResetAt: BASELINE_RESET,
    staff: false,
  });
  globalThis.fetch = async (url, init) => {
    const target = requestUrl(url);
    calls.push(`${target.origin}${target.pathname}`);
    assert.equal(
      /elevenlabs|fireworks|cartesia|autumn|openai|amazonaws/i.test(target.hostname),
      false,
      `provider host ${target.hostname}`,
    );
    assert.equal(target.pathname, "/api/billing/begin-turn", `unexpected path ${target.pathname}`);
    assert.equal(init?.method, "POST");
    const payload = JSON.parse(String(init?.body)) as { traceId?: string; kind?: string };
    assert.equal(payload.kind, "lesson");
    assert.equal(payload.traceId, input.traceId);
    return jsonResponse(input.status, input.body, () => {
      bodyRead = true;
      if (!input.superseded) return;
      activeGeneration.current = generation + 1;
      setEntitlementSnapshot({
        planId: NEWER_PLAN,
        remainingPct: NEWER_REMAINING,
        nextResetAt: NEWER_RESET,
        staff: false,
      });
    });
  };

  const result = await beginTurn({
    traceId: input.traceId,
    kind: "lesson",
    signal: abortController.signal,
    ownsTurn: () => generation === activeGeneration.current && !abortController.signal.aborted,
  });

  assert.equal(bodyRead, true, `${input.name} did not read the billing body`);
  assert.equal(calls.length, 1, `${input.name} fetch count`);
  assert.equal(abortController.signal.aborted, false, `${input.name} must keep the caller signal open`);
  if (input.status === 402) {
    assert.equal(result.ok, false, input.name);
    if (!result.ok) {
      assert.equal(result.status, 402, input.name);
      assert.equal(result.code, "out_of_credits", input.name);
      assert.equal(result.remaining, input.returnedRemaining, `${input.name} returned remaining`);
    }
  } else {
    assert.equal(result.ok, true, input.name);
    if (result.ok) {
      assert.equal(result.remainingPct, input.returnedRemaining, `${input.name} returned remaining`);
      assert.equal(result.planId, input.returnedPlan, `${input.name} returned plan`);
      assert.equal(result.nextResetAt, input.returnedReset, `${input.name} returned reset`);
      assert.equal(result.ttsCharsRemaining, input.returnedTts, `${input.name} returned tts`);
    }
  }
  expectMeter(input.meter, input.name);
}

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const failures: string[] = [];
  console.log(
    "evidence: real billingClient.beginTurn with stubbed fetch/Response. verify-billing-failure-exit.ts is a separate extracted-source harness and is not this run.",
  );
  try {
    for (const input of CASES) {
      try {
        await exercise(input);
        console.log(`pass ${input.name}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${input.name}: ${message}`);
        console.error(`FAIL ${input.name}: ${message}`);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    setEntitlementSnapshot(null);
  }
  if (globalThis.fetch !== originalFetch) {
    failures.push("fake fetch was not restored");
  }
  if (failures.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log("stale begin-turn usage: current lesson updates the meter; superseded lesson does not");
}

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : "Error";
  console.error(`FAIL verifier crashed (${name})`);
  process.exitCode = 1;
});
