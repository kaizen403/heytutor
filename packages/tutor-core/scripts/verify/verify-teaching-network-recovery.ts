import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { streamLLMResponse, TeachingTransportError, type StreamLLMResponseParams } from "../../src/llm/llmAPI";

const originalFetch = globalThis.fetch;
const encoder = new TextEncoder();
const expectedText = "[STEP] Recovered teaching.";
const sse = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
const success = () => new Response(sse(expectedText), { headers: { "x-heytutor-trace-id": "private-test-trace" } });
const rows: Record<string, unknown>[] = [];
let failed = 0;
const params: StreamLLMResponseParams = {
  systemPrompt: "private transport test",
  userPrompt: "private transport test",
  conversationHistory: [],
  proxyUrl: "https://transport.invalid/api/chat",
  firstContentTimeoutMs: 1_000,
  hedge: { afterMs: 500 },
};

async function run(name: string, body: () => Promise<void>) {
  try { await body(); rows.push({ name, verdict: "PASS" }); }
  catch (error) {
    failed += 1;
    rows.push({ name, verdict: "FAIL", error: error instanceof Error ? error.message : String(error) });
  } finally { globalThis.fetch = originalFetch; }
}

async function until(predicate: () => boolean) {
  for (let turn = 0; turn < 32 && !predicate(); turn++) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert(predicate(), "the controlled network event must be admitted");
}

/** Dispatch deadlines explicitly: no load-sensitive wall-clock assertions. */
async function withTimers(body: (timers: {
  scheduled: number[];
  fire: (delay: number) => void;
  remaining: () => number;
}) => Promise<void>) {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const active = new Map<ReturnType<typeof setTimeout>, { callback: () => void; delay: number }>();
  const scheduled: number[] = [];
  Object.defineProperty(globalThis, "setTimeout", { configurable: true, writable: true,
    value: (callback: () => void, delay: number) => {
      const handle = originalSetTimeout(() => undefined, 2_147_483_647);
      originalClearTimeout(handle);
      active.set(handle, { callback, delay });
      scheduled.push(delay);
      return handle;
    },
  });
  Object.defineProperty(globalThis, "clearTimeout", { configurable: true, writable: true,
    value: (handle: ReturnType<typeof setTimeout>) => { active.delete(handle); originalClearTimeout(handle); },
  });
  try {
    await body({ scheduled, remaining: () => active.size, fire: delay => {
      const entry = [...active].find(([, timer]) => timer.delay === delay);
      assert(entry, `expected the original ${delay}ms deadline`);
      active.delete(entry[0]);
      entry[1].callback();
    } });
    assert.equal(active.size, 0, "every owned deadline is cleared after settlement");
  } finally {
    Object.defineProperty(globalThis, "setTimeout", { configurable: true, writable: true, value: originalSetTimeout });
    Object.defineProperty(globalThis, "clearTimeout", { configurable: true, writable: true, value: originalClearTimeout });
  }
}

for (const phase of ["fetch", "read"] as const) {
  await run(`configured-${phase}-failure-before-content-recovers`, async () => {
    const failure = new TypeError(`private ${phase} network failure`);
    const requests: RequestInit[] = [];
    globalThis.fetch = async (_url, init) => {
      requests.push(init ?? {});
      if (requests.length === 1) {
        if (phase === "fetch") throw failure;
        return new Response(new ReadableStream({ start(controller) { controller.error(failure); } }));
      }
      return success();
    };
    const deltas: string[] = [];
    const started = performance.now();
    let result: Awaited<ReturnType<typeof streamLLMResponse>> | undefined;
    let error: unknown;
    try { result = await streamLLMResponse(params, chunk => deltas.push(chunk)); }
    catch (cause) { error = cause; }
    rows.push({ name: `${phase}-observation`, requests: requests.length, text: result?.text ?? null,
      errorType: error instanceof Error ? error.name : null, elapsedMs: Math.round(performance.now() - started) });
    assert.equal(requests.length, 2, "the already-configured hedge should open on early network failure");
    assert.equal(error, undefined);
    assert.equal(result?.text, expectedText);
    assert.equal(deltas.join(""), expectedText);
    assert.equal(requests[0]?.body, requests[1]?.body, "same teaching request body");
    assert.equal(new Headers(requests[1]?.headers).get("x-heytutor-teaching-hedge"), "1");
    assert.equal(new Headers(requests[1]?.headers).get("x-heytutor-startup-retry"), null);
    assert.equal(result?.streamStats?.hedge?.winner, "hedge");
  });
}

for (const control of ["unconfigured", "http-401", "http-403", "trace-callback", "delta-callback", "usable-callback", "after-content", "after-prefix", "after-whitespace", "generic-fetch", "generic-read"] as const) {
  await run(`${control}-never-opens-another-request`, async () => {
    const failure = control.startsWith("generic-") ? new Error(`private ${control} failure`) : new TypeError(`private ${control} failure`);
    let calls = 0;
    let predicateCalls = 0;
    const deltas: string[] = [];
    globalThis.fetch = async () => {
      calls += 1;
      if (calls > 1) return success();
      if (control === "unconfigured" || control === "generic-fetch") throw failure;
      if (control === "http-401" || control === "http-403") return new Response("private denied", { status: control === "http-401" ? 401 : 403 });
      if (control === "generic-read") return new Response(new ReadableStream({ start(controller) { controller.error(failure); } }));
      if (control === "after-content" || control === "after-prefix" || control === "after-whitespace") {
        let read = false;
        return new Response(new ReadableStream({ async pull(controller) {
          if (!read) {
            read = true;
            const text = control === "after-content" ? "already heard" : control === "after-prefix" ? "[STEP]" : " ";
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
          } else {
            await new Promise<void>(resolve => setImmediate(resolve));
            controller.error(failure);
          }
        } }));
      }
      return success();
    };
    let error: unknown;
    try {
      await streamLLMResponse({ ...params,
        hedge: control === "unconfigured" ? undefined : params.hedge,
        onTraceId: control === "trace-callback" ? () => { throw failure; } : undefined,
        hasUsableContent: control === "usable-callback" ? () => {
          if (predicateCalls++ > 0) throw failure;
          return false;
        } : undefined,
      }, chunk => {
        deltas.push(chunk);
        if (control === "delta-callback") throw failure;
      });
    } catch (cause) { error = cause; }
    assert.equal(calls, 1);
    if (control === "http-401" || control === "http-403") assert.match(String(error), new RegExp(`LLM proxy error \\(${control.slice(5)}\\)`));
    else if (control === "unconfigured" || control === "after-content" || control === "after-prefix" || control === "after-whitespace") {
      assert(error instanceof TeachingTransportError, "only actual fetch/read failures are typed");
      assert.equal(error.cause, failure);
      assert.equal(error.phase, control === "unconfigured" ? "fetch" : "read");
    } else assert.equal(error, failure, "callback errors keep their original identity");
    if (control === "after-content") assert.equal(deltas.join(""), "already heard");
  });
}

await run("early-failure-uses-existing-deadline-and-two-call-cap", () => withTimers(async timers => {
  const external = new AbortController();
  const requests: RequestInit[] = [];
  let hedgeCancelled = false;
  const stream = new Response(new ReadableStream({ cancel() { hedgeCancelled = true; } }));
  globalThis.fetch = async (_url, init) => {
    requests.push(init ?? {});
    if (requests.length === 1) throw new TypeError("private early network failure");
    return stream;
  };
  const pending = streamLLMResponse({ ...params, signal: external.signal });
  void pending.catch(() => undefined);
  await until(() => requests.length === 2 && stream.body?.locked === true);
  assert.deepEqual(timers.scheduled, [1_000, 500], "early recovery cannot reset or add to the original deadlines");
  assert.equal(timers.remaining(), 1, "the unopened hedge timer is retired");
  timers.fire(1_000);
  const result = await pending;
  assert.equal(result.streamStats?.firstContentTimedOut, true);
  assert.equal(result.text, "");
  assert.equal(requests.length, 2, "deadline expiry cannot open a third request");
  assert(requests.every(request => request.signal?.aborted));
  assert.equal(external.signal.aborted, false);
  assert.equal(getEventListeners(external.signal, "abort").length, 0);
  assert.equal(hedgeCancelled, true);
  assert.equal(stream.body?.locked, false);
}));

await run("two-network-failures-do-not-open-a-third-attempt", () => withTimers(async () => {
  const failure = new TypeError("private first network failure");
  let calls = 0;
  const events: string[] = [];
  globalThis.fetch = async () => {
    calls += 1;
    throw calls === 1 ? failure : new TypeError("private second network failure");
  };
  await assert.rejects(streamLLMResponse({ ...params, onRequestStart: event => events.push(event.attempt),
    onHedgeStart: () => events.push("hedge-open") }), error => error instanceof TeachingTransportError && error.cause === failure);
  assert.equal(calls, 2);
  assert.equal(events.filter(event => event === "hedge-open").length, 1);
  assert.equal(events.filter(event => event === "primary").length, 1);
  assert.equal(events.filter(event => event === "hedge").length, 1);
}));

await run("already-open-hedge-remains-the-only-recovery", () => withTimers(async timers => {
  let primaryController!: ReadableStreamDefaultController<Uint8Array>;
  let hedgeController!: ReadableStreamDefaultController<Uint8Array>;
  const primary = new Response(new ReadableStream({ start(controller) { primaryController = controller; } }));
  const hedge = new Response(new ReadableStream({ start(controller) { hedgeController = controller; } }));
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? primary : hedge;
  const pending = streamLLMResponse(params);
  await until(() => primary.body?.locked === true);
  timers.fire(500);
  await until(() => hedge.body?.locked === true);
  primaryController.error(new TypeError("private primary drops while hedge exists"));
  hedgeController.enqueue(encoder.encode(sse(expectedText)));
  const result = await pending;
  assert.equal(calls, 2);
  assert.equal(result.text, expectedText);
  assert.equal(result.streamStats?.hedge?.winner, "hedge");
  assert.equal(primary.body?.locked, false);
  assert.equal(hedge.body?.locked, false);
}));

for (const reason of [new DOMException("private Stop", "AbortError"), new DOMException("private superseded", "AbortError")]) {
  await run(`${reason.message}-never-opens-another-request`, async () => {
    const controller = new AbortController();
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls += 1;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(reason), { once: true });
      });
    };
    const pending = streamLLMResponse({ ...params, signal: controller.signal });
    controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
    assert.equal(calls, 1);
  });
}

console.log(JSON.stringify(rows, null, 2));
assert.equal(failed, 0, `${failed} transport recovery regression(s)`);
