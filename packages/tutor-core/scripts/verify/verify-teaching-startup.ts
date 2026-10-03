import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { streamLLMResponse, type StreamLLMResponseParams } from "../../src/llm/llmAPI";
import { HEYTUTOR_SESSION_ID_HEADER, HEYTUTOR_TRACE_ID_HEADER } from "../../src/llm/traceHeaders";

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const activeTimers = new Set<ReturnType<typeof setTimeout>>();
const scheduledDeadlines: number[] = [];
const encoder = new TextEncoder();
const params: StreamLLMResponseParams = {
  systemPrompt: "Teach the verified lesson.",
  userPrompt: "Explain projectile motion.",
  conversationHistory: [],
  proxyUrl: "http://teaching.test/api/chat",
  firstContentTimeoutMs: 35,
};

Object.defineProperty(globalThis, "setTimeout", {
  configurable: true,
  writable: true,
  value: (callback: () => void, delay: number) => {
    const timer = originalSetTimeout(() => {
      activeTimers.delete(timer);
      callback();
    }, delay);
    activeTimers.add(timer);
    scheduledDeadlines.push(delay);
    return timer;
  },
});
Object.defineProperty(globalThis, "clearTimeout", {
  configurable: true,
  writable: true,
  value: (timer: ReturnType<typeof setTimeout>) => {
    activeTimers.delete(timer);
    originalClearTimeout(timer);
  },
});

function sleep(ms: number) {
  return new Promise<void>((resolve) => originalSetTimeout(resolve, ms));
}

function streamedResponse(onCancel?: () => void | Promise<void>) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancels = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(next) { controller = next; },
    cancel() { cancels++; return onCancel?.(); },
  }), {
    headers: {
      "content-type": "text/event-stream",
      "x-heytutor-trace-id": "teaching-trace",
    },
  });
  return {
    response,
    get cancels() { return cancels; },
    raw(text: string) { controller.enqueue(encoder.encode(text)); },
    delta(delta: object) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`));
    },
    close() { controller.close(); },
    fail(error: Error) { controller.error(error); },
  };
}

function stubResponse(response: Response) {
  let requestSignal: AbortSignal | null | undefined;
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (_url, init) => {
    requestInit = init;
    requestSignal = init?.signal;
    return response;
  };
  return {
    get signal() { return requestSignal; },
    get init() { return requestInit; },
  };
}

function assertClean(response?: Response, external?: AbortSignal) {
  assert.equal(activeTimers.size, 0, "every settled request must clear its startup timer");
  if (response?.body) assert.equal(response.body.locked, false, "the response reader must be released");
  if (external) {
    assert.equal(getEventListeners(external, "abort").length, 0, "the external abort listener must be removed");
  }
}

try {
  {
    const external = new AbortController();
    const stream = streamedResponse();
    const request = stubResponse(stream.response);
    const traces: string[] = [];
    stream.delta({ role: "assistant", content: "" });
    stream.raw(": keep-alive\n\ndata: {malformed}\n\n");
    const started = performance.now();
    const result = await streamLLMResponse({
      ...params,
      signal: external.signal,
      onTraceId: (id) => traces.push(id),
    });
    assert.equal(result.text, "");
    assert.equal(result.streamStats?.firstContentTimedOut, true);
    assert.equal(result.streamStats?.ttftContentMs, null);
    assert.equal(result.streamStats?.reasoningChars, 0);
    assert(performance.now() - started < 500, "headers and an otherwise silent body must have a bounded startup");
    assert.equal(result.traceId, "teaching-trace");
    assert.deepEqual(traces, ["teaching-trace"]);
    assert.notEqual(request.signal, external.signal, "the request must own its controller");
    assert.equal(request.signal?.aborted, true, "expiry must abort the paid network request");
    assert.equal(external.signal.aborted, false, "expiry cannot stop the whole turn");
    assert.equal(stream.cancels, 1, "a mock body ignoring AbortSignal must still be cancelled");
    assertClean(stream.response, external.signal);
  }

  {
    let produced = 0;
    let floodTimer: ReturnType<typeof setTimeout> | undefined;
    const stream = streamedResponse(() => originalClearTimeout(floodTimer));
    const request = stubResponse(stream.response);
    const deltas: string[] = [];
    const before = scheduledDeadlines.length;
    const flood = () => {
      produced++;
      stream.delta({ reasoning_content: "Hidden reasoning. ".repeat(100) });
      floodTimer = originalSetTimeout(flood, 3);
    };
    flood();
    try {
      const result = await streamLLMResponse(params, (delta) => deltas.push(delta));
      assert(produced > 1, "the test must flood the stream with multiple reasoning events");
      assert.equal(result.text, "");
      assert.equal(result.streamStats?.firstContentTimedOut, true);
      assert.equal(result.streamStats?.reasoningChars, produced * "Hidden reasoning. ".repeat(100).length);
      assert.notEqual(result.streamStats?.ttftReasoningMs, null);
      assert.equal(result.streamStats?.ttftContentMs, null);
      assert.equal(result.streamStats?.contentChars, 0);
      assert.deepEqual(deltas, [], "reasoning must never reach onDelta");
      assert.equal(scheduledDeadlines.length - before, 1, "reasoning tokens must not reset the startup timer");
      assert.equal(request.signal?.aborted, true);
      assert.equal(stream.cancels, 1);
      assertClean(stream.response);
      const stoppedAt = produced;
      await sleep(15);
      assert.equal(produced, stoppedAt, "reader cancellation must stop the reasoning producer");
    } finally { originalClearTimeout(floodTimer); }
  }

  {
    const stream = streamedResponse();
    stubResponse(stream.response);
    const deltas: string[] = [];
    stream.delta({ content: " \n\t" });
    const result = await streamLLMResponse(params, (delta) => deltas.push(delta));
    assert.equal(result.text, " \n\t", "whitespace content must retain its original parsing behavior");
    assert.deepEqual(deltas, [" \n\t"]);
    assert.equal(result.streamStats?.contentChars, 3);
    assert.equal(result.streamStats?.ttftContentMs, null, "whitespace is not usable first content");
    assert.equal(result.streamStats?.firstContentTimedOut, true);
    assertClean(stream.response);
  }

  for (const prefix of ["[STEP]", "[STEP][WRITE:"]) {
    const stream = streamedResponse();
    const request = stubResponse(stream.response);
    stream.delta({ content: prefix });
    const result = await streamLLMResponse(params);
    assert.equal(result.text, prefix);
    assert.equal(result.streamStats?.firstContentTimedOut, true, "tag-only protocol prefixes cannot disarm the default deadline");
    assert.equal(result.streamStats?.ttftContentMs, null);
    assert.equal(request.signal?.aborted, true);
    assert.equal(stream.cancels, 1);
    assertClean(stream.response);
  }

  {
    const stream = streamedResponse();
    const request = stubResponse(stream.response);
    stream.delta({ content: "[STEP]An incomplete teaching sentence" });
    const deltas: string[] = [];
    const result = await streamLLMResponse({ ...params, hasUsableContent: () => false }, (delta) => deltas.push(delta));
    assert.equal(result.text, deltas.join(""), "partial content must remain available to the caller for diagnostics");
    assert(result.text.length > 0);
    assert.equal(result.streamStats?.firstContentTimedOut, true, "partial narration is recoverable starvation until the caller accepts a usable step");
    assert.equal(result.streamStats?.ttftContentMs, null);
    assert.equal(request.signal?.aborted, true);
    assert.equal(stream.cancels, 1);
    assertClean(stream.response);
  }

  {
    const stream = streamedResponse();
    const request = stubResponse(stream.response);
    let ready = false;
    let parsed = "";
    const completion = streamLLMResponse({ ...params, hasUsableContent: () => ready }, (delta) => {
      parsed += delta;
      if (parsed.includes("[/STEP]")) {
        assert.equal(activeTimers.size, 1, "the parser must run before the content predicate disarms the deadline");
        ready = true;
      }
    });
    stream.delta({ content: "[STEP]Partial narration" });
    await sleep(0);
    assert.equal(activeTimers.size, 1, "raw partial content cannot bypass the caller's usable-step predicate");
    stream.delta({ content: " becomes a usable teaching step.[/STEP]" });
    await sleep(0);
    assert.equal(activeTimers.size, 0, "accepting a real step must promptly remove the deadline");
    await sleep(60);
    assert.equal(request.signal?.aborted, false);
    stream.close();
    const result = await completion;
    assert.equal(result.text, parsed);
    assert.equal(result.streamStats?.firstContentTimedOut, false);
    assert.notEqual(result.streamStats?.ttftContentMs, null);
    assertClean(stream.response);
  }

  {
    const stream = streamedResponse();
    stubResponse(stream.response);
    stream.delta({ content: "[STEP]The retry also stalls mid-sentence" });
    await assert.rejects(streamLLMResponse({ ...params, noReasoning: true, hasUsableContent: () => false }), {
      message: "The lesson did not start in time, even after retrying. Please try asking again.",
    });
    assert.equal(stream.cancels, 1);
    assertClean(stream.response);
  }

  {
    const external = new AbortController();
    const stream = streamedResponse();
    const request = stubResponse(stream.response);
    const completion = streamLLMResponse({
      ...params, firstContentTimeoutMs: 20, hasUsableContent: () => true, signal: external.signal,
    });
    await sleep(0);
    assert.equal(activeTimers.size, 0, "an already-started lesson continuation must not arm a startup deadline");
    await sleep(60);
    assert.equal(request.signal?.aborted, false, "delayed continuation content must not be silently truncated");
    stream.delta({ content: "[STEP]The ongoing lesson continues after a long generation gap.[/STEP]" });
    stream.close();
    const result = await completion;
    assert.equal(result.text, "[STEP]The ongoing lesson continues after a long generation gap.[/STEP]");
    assert.equal(result.streamStats?.firstContentTimedOut, false);
    assert((result.streamStats?.durationMs ?? 0) >= 55);
    assertClean(stream.response, external.signal);
  }

  for (const codeLesson of [false, true]) {
    const external = new AbortController();
    const stream = streamedResponse();
    const request = stubResponse(stream.response);
    const deltas: string[] = [];
    const before = scheduledDeadlines.length;
    stream.delta({ content: "[STEP]Let’s work through it. " });
    const completion = streamLLMResponse({
      ...params,
      firstContentTimeoutMs: undefined,
      codeLesson,
      noReasoning: true,
      signal: external.signal,
      sessionId: "board-1",
      traceId: "turn-1",
      hasAuthoritativePlan: true,
      fastMode: false,
    }, (delta) => deltas.push(delta));
    await sleep(0);
    assert.equal(scheduledDeadlines[before], 15_000, "the default first-content deadline must be 15 seconds");
    assert.equal(activeTimers.size, 0, "usable content must remove the timer before the lesson finishes");
    const headers = new Headers(request.init?.headers);
    assert.equal(headers.get("x-heytutor-reasoning-retry"), "1");
    assert.equal(headers.get("x-heytutor-teaching-pass"), codeLesson ? "code-lesson" : "planned");
    assert.equal(headers.get("x-heytutor-code-lesson"), codeLesson ? "1" : null);
    assert.equal(headers.get(HEYTUTOR_SESSION_ID_HEADER), "board-1");
    assert.equal(headers.get(HEYTUTOR_TRACE_ID_HEADER), "turn-1");
    assert.equal(JSON.parse(String(request.init?.body)).max_tokens, 12000);
    stream.raw("data: {malformed}\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"The full");
    await sleep(75);
    assert.equal(request.signal?.aborted, false, "long normal and code lessons must not be truncated");
    stream.raw(" lesson finishes.\"}}]}\r\n\r\ndata: [DONE]\n\n");
    const result = await completion;
    assert.equal(result.text, "[STEP]Let’s work through it. The full lesson finishes.");
    assert.equal(deltas.join(""), result.text, "onDelta must retain every parsed content chunk");
    assert.notEqual(result.streamStats?.ttftContentMs, null);
    assert.equal(result.streamStats?.contentChars, result.text.length);
    assert.equal(result.streamStats?.firstContentTimedOut, false);
    assert((result.streamStats?.durationMs ?? 0) >= 70);
    assert.equal(stream.cancels, 1, "[DONE] must still cancel the upstream body");
    assertClean(stream.response, external.signal);
  }

  {
    const stream = streamedResponse();
    const request = stubResponse(stream.response);
    stream.delta({ content: "[STEP]Content starts immediately. " });
    const completion = streamLLMResponse({ ...params, firstContentTimeoutMs: 20 });
    await sleep(0);
    assert.equal(activeTimers.size, 0);
    await sleep(60);
    assert.equal(request.signal?.aborted, false, "content must survive beyond the injected startup deadline");
    stream.delta({ content: "The late ending is preserved." });
    stream.close();
    const result = await completion;
    assert.equal(result.text, "[STEP]Content starts immediately. The late ending is preserved.");
    assert.equal(result.streamStats?.firstContentTimedOut, false);
    assertClean(stream.response);
  }

  for (const initialContent of ["", "[STEP]A partial lesson."]) {
    const external = new AbortController();
    const stream = streamedResponse();
    const request = stubResponse(stream.response);
    if (initialContent) stream.delta({ content: initialContent });
    const completion = streamLLMResponse({ ...params, signal: external.signal, noReasoning: true });
    await sleep(0);
    const stop = new DOMException("Student pressed Stop", "AbortError");
    external.abort(stop);
    const result = await completion;
    assert.equal(result.text, initialContent, "Stop during a body read must preserve the existing partial result");
    assert.equal(result.streamStats?.firstContentTimedOut, false, "Stop is not a recoverable startup expiry");
    assert.equal(request.signal?.reason, stop, "Stop's abort reason must reach the owned fetch");
    assert.equal(stream.cancels, 1, "Stop must cancel a reader even when mock fetch ignores its signal");
    assertClean(stream.response, external.signal);
  }

  {
    const external = new AbortController();
    const stream = streamedResponse();
    stubResponse(stream.response);
    stream.raw(
      'data: {"choices":[{"delta":{"content":"First lesson chunk."}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"Must not arrive after Stop."}}]}\n\n',
    );
    const deltas: string[] = [];
    const result = await streamLLMResponse({ ...params, signal: external.signal }, (delta) => {
      deltas.push(delta);
      external.abort();
    });
    assert.deepEqual(deltas, ["First lesson chunk."], "Stop during onDelta must suppress queued content callbacks");
    assert.equal(result.text, "First lesson chunk.");
    assert.equal(result.streamStats?.firstContentTimedOut, false);
    assertClean(stream.response, external.signal);
  }

  {
    const external = new AbortController();
    const stalled = streamedResponse();
    const sibling = streamedResponse();
    const signals = new Map<string, AbortSignal | null | undefined>();
    globalThis.fetch = async (url, init) => {
      signals.set(String(url), init?.signal);
      return String(url) === "http://teaching.test/stalled" ? stalled.response : sibling.response;
    };
    sibling.delta({ content: "The sibling lesson has started." });
    const pendingSibling = streamLLMResponse({
      ...params, signal: external.signal, proxyUrl: "http://teaching.test/sibling",
    });
    const result = await streamLLMResponse({
      ...params, signal: external.signal, proxyUrl: "http://teaching.test/stalled",
    });
    assert.equal(result.streamStats?.firstContentTimedOut, true);
    assert.equal(signals.get("http://teaching.test/stalled")?.aborted, true);
    assert.equal(signals.get("http://teaching.test/sibling")?.aborted, false, "expiry must not abort a sibling request");
    assert.equal(external.signal.aborted, false);
    sibling.delta({ content: " It finishes after the other request expires." });
    sibling.close();
    const siblingResult = await pendingSibling;
    assert.equal(siblingResult.text, "The sibling lesson has started. It finishes after the other request expires.");
    assert.equal(siblingResult.streamStats?.firstContentTimedOut, false);
    assertClean(stalled.response, external.signal);
    assertClean(sibling.response);
  }

  for (const preAborted of [false, true]) {
    const external = new AbortController();
    const stop = new DOMException("Student pressed Stop before headers", "AbortError");
    let requestSignal: AbortSignal | null | undefined;
    globalThis.fetch = (_url, init) => {
      requestSignal = init?.signal;
      assert(requestSignal);
      const signal = requestSignal;
      return new Promise<Response>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };
    if (preAborted) external.abort(stop);
    const completion = streamLLMResponse({ ...params, signal: external.signal, noReasoning: true });
    if (!preAborted) external.abort(stop);
    await assert.rejects(completion, (error) => error === stop, "external fetch AbortErrors must propagate unchanged");
    assert.notEqual(requestSignal, external.signal);
    assertClean(undefined, external.signal);
  }

  {
    const external = new AbortController();
    globalThis.fetch = (_url, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      assert(signal);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const result = await streamLLMResponse({ ...params, signal: external.signal });
    assert.equal(result.streamStats?.firstContentTimedOut, true, "waiting for response headers consumes the same deadline");
    assert.equal(result.traceId, null);
    assert.equal(external.signal.aborted, false);
    assertClean(undefined, external.signal);
  }

  for (const done of [false, true]) {
    const stream = streamedResponse(() => new Promise<void>(() => {}));
    const request = stubResponse(stream.response);
    if (done) stream.raw("data: [DONE]\n\n");
    const result = await streamLLMResponse(params);
    assert.equal(result.streamStats?.firstContentTimedOut, !done, "a stalled cancel acknowledgement must not strand a result");
    assert.equal(request.signal?.aborted, !done);
    assert.equal(stream.cancels, 1);
    assertClean(stream.response);
  }

  {
    const external = new AbortController();
    const stream = streamedResponse();
    const request = stubResponse(stream.response);
    await assert.rejects(
      streamLLMResponse({ ...params, signal: external.signal, noReasoning: true }),
      { message: "The lesson did not start in time, even after retrying. Please try asking again." },
      "a second expiry must fail clearly instead of returning a silent empty lesson",
    );
    assert.equal(request.signal?.aborted, true);
    assert.equal(external.signal.aborted, false);
    assert.equal(stream.cancels, 1);
    assertClean(stream.response, external.signal);
  }

  {
    const stream = streamedResponse();
    stubResponse(stream.response);
    stream.delta({ reasoning_content: "Only reasoning, but a completed response." });
    stream.close();
    const result = await streamLLMResponse(params);
    assert.equal(result.text, "");
    assert.equal(result.streamStats?.firstContentTimedOut, false, "normal empty completion must retain the existing retry path");
    assert.equal(result.streamStats?.reasoningChars, 41);
    assertClean(stream.response);
  }

  {
    const stream = streamedResponse();
    stubResponse(stream.response);
    stream.raw('data: {"choices":[{"delta":{"content":"A final line without a newline."}}]}');
    stream.close();
    const result = await streamLLMResponse(params);
    assert.equal(result.text, "A final line without a newline.", "EOF must still flush buffered SSE data");
    assert.equal(result.streamStats?.firstContentTimedOut, false);
    assertClean(stream.response);
  }

  {
    const stream = streamedResponse();
    stubResponse(stream.response);
    const failure = new Error("network stream failed");
    stream.fail(failure);
    await assert.rejects(streamLLMResponse(params), (error) => error === failure);
    assertClean(stream.response);
  }

  {
    const stream = streamedResponse();
    stubResponse(stream.response);
    stream.delta({ content: "[STEP]Usable lesson content." });
    const failure = new Error("onDelta consumer failed");
    await assert.rejects(streamLLMResponse(params, () => { throw failure; }), (error) => error === failure);
    assert.equal(stream.cancels, 1, "consumer errors must not strand the paid response body");
    assertClean(stream.response);
  }

  for (const response of [new Response("provider rejected", { status: 502 }), new Response(null)]) {
    stubResponse(response);
    await assert.rejects(streamLLMResponse(params), {
      message: response.ok ? "LLM proxy returned no response body." : "LLM proxy error (502): provider rejected",
    });
    if (!response.ok) assert.equal(response.bodyUsed, true, "proxy error text must still be consumed");
    assertClean();
  }

  // Hedged startup: a silent first request is raced by a reasoning-off copy.
  const hedgeParams: StreamLLMResponseParams = { ...params, firstContentTimeoutMs: 150, hedge: { afterMs: 25 } };
  const stubResponses = (...responses: Array<Response | (() => Promise<Response>)>) => {
    const calls: Array<{ signal: AbortSignal | null | undefined; headers: Headers; body: string }> = [];
    globalThis.fetch = async (_url, init) => {
      const next = responses[calls.length];
      calls.push({ signal: init?.signal, headers: new Headers(init?.headers), body: String(init?.body) });
      assert(next, "no request beyond the primary and one hedge may open");
      return typeof next === "function" ? next() : next;
    };
    return calls;
  };
  const hedgeEvents = () => {
    const log: string[] = [];
    return {
      log,
      callbacks: {
        onRequestStart: (event: { attempt: string }) => log.push(`request:${event.attempt}`),
        onHedgeStart: (event: { afterMs: number }) => {
          assert(event.afterMs >= 25, "the hedge must wait for its threshold");
          log.push("hedge-start");
        },
        onHedgeWinner: (event: { winner: string; firstContentTokenMs: number }) => {
          assert(event.firstContentTokenMs >= 0);
          log.push(`winner:${event.winner}`);
        },
      },
    };
  };

  {
    // Primary speaks before the threshold: no hedge ever opens.
    const external = new AbortController();
    const primary = streamedResponse();
    const calls = stubResponses(primary.response);
    const events = hedgeEvents();
    const deltas: string[] = [];
    primary.delta({ content: "[STEP]The primary starts at once.[/STEP]" });
    const completion = streamLLMResponse({ ...hedgeParams, ...events.callbacks, signal: external.signal }, (delta) => deltas.push(delta));
    await sleep(0);
    assert.equal(activeTimers.size, 0, "a primary content token must clear the hedge timer");
    await sleep(60);
    primary.close();
    const result = await completion;
    assert.equal(calls.length, 1, "a fast primary must never open a hedge");
    assert.equal(calls[0]!.headers.get("x-heytutor-teaching-hedge"), null);
    assert.equal(calls[0]!.headers.get("x-heytutor-reasoning-retry"), null, "the primary keeps the caller's reasoning setting");
    assert.deepEqual(events.log, ["request:primary"], "no hedge start or winner event without a hedge");
    assert.equal(result.text, "[STEP]The primary starts at once.[/STEP]");
    assert.equal(deltas.join(""), result.text);
    assert.equal(result.streamStats?.attempt, "primary");
    assert.equal(result.streamStats?.hedge?.startedAfterMs, null);
    assert.equal(result.streamStats?.hedge?.winner, "primary");
    assertClean(primary.response, external.signal);
  }

  {
    // Primary only reasons; the hedge speaks first and wins.
    const external = new AbortController();
    const primary = streamedResponse();
    const hedgeStream = streamedResponse();
    const calls = stubResponses(primary.response, hedgeStream.response);
    const events = hedgeEvents();
    const deltas: string[] = [];
    let ready = false;
    primary.delta({ reasoning_content: "Thinking at length." });
    primary.delta({ content: " \n" });
    const completion = streamLLMResponse({
      ...hedgeParams, ...events.callbacks, signal: external.signal, sessionId: "board-1", traceId: "turn-1",
      hasUsableContent: () => ready,
    }, (delta) => {
      deltas.push(delta);
      if (deltas.join("").includes("[/STEP]")) ready = true;
    });
    await sleep(10);
    assert.equal(calls.length, 1, "the hedge must wait for its threshold");
    assert.deepEqual(deltas, [], "whitespace is not a content token and cannot pick a winner");
    await sleep(40);
    assert.equal(calls.length, 2, "a silent primary must be hedged once");
    const [primaryCall, hedgeCall] = calls;
    assert.equal(hedgeCall!.headers.get("x-heytutor-teaching-hedge"), "1");
    assert.equal(hedgeCall!.headers.get("x-heytutor-reasoning-retry"), "1", "the hedge must ask for reasoning off");
    assert.equal(hedgeCall!.headers.get(HEYTUTOR_SESSION_ID_HEADER), "board-1");
    assert.equal(hedgeCall!.headers.get(HEYTUTOR_TRACE_ID_HEADER), "turn-1");
    assert.equal(hedgeCall!.body, primaryCall!.body, "the hedge must send the same body");
    assert.notEqual(hedgeCall!.signal, primaryCall!.signal, "each request must own its controller");
    assert.equal(primaryCall!.signal?.aborted, false, "starting a hedge must not abort the primary");
    assert.deepEqual(events.log, ["request:primary", "hedge-start", "request:hedge"]);
    hedgeStream.delta({ content: "\n" });
    hedgeStream.delta({ content: "[STEP]The hedge speaks first.[/STEP]" });
    await sleep(0);
    assert.equal(primaryCall!.signal?.aborted, true, "the loser must be aborted the moment a winner speaks");
    assert.equal(primary.cancels, 1, "the loser's paid body must be cancelled");
    assert.equal(activeTimers.size, 0, "a usable hedge step must clear the deadline");
    assert.deepEqual(deltas, ["\n", "[STEP]The hedge speaks first.[/STEP]"], "only the winner's deltas, held whitespace first, may reach onDelta");
    hedgeStream.delta({ content: " More teaching." });
    hedgeStream.close();
    const result = await completion;
    assert.equal(result.text, "\n[STEP]The hedge speaks first.[/STEP] More teaching.");
    assert.equal(deltas.join(""), result.text, "nothing may be delivered twice");
    assert.equal(result.streamStats?.attempt, "hedge");
    assert.equal(result.streamStats?.firstContentTimedOut, false);
    assert.equal(result.streamStats?.reasoningChars, 0, "the winner's stats are returned");
    assert.equal(result.streamStats?.hedge?.winner, "hedge");
    const [primaryStats, hedgeStats] = result.streamStats?.hedge?.attempts ?? [];
    assert.equal(primaryStats?.outcome, "aborted");
    assert.equal(primaryStats?.reasoningChars, "Thinking at length.".length);
    assert.equal(primaryStats?.firstContentTokenMs, null);
    assert.equal(hedgeStats?.outcome, "completed");
    assert((hedgeStats?.startedAfterMs ?? 0) >= 25);
    assert.notEqual(hedgeStats?.firstContentTokenMs, null);
    assert.notEqual(result.streamStats?.ttftContentMs, null);
    assert.deepEqual(events.log, ["request:primary", "hedge-start", "request:hedge", "winner:hedge"]);
    assertClean(primary.response, external.signal);
    assertClean(hedgeStream.response);
  }

  {
    // The primary speaks after the hedge opened: the hedge is aborted.
    const primary = streamedResponse();
    const hedgeStream = streamedResponse();
    const calls = stubResponses(primary.response, hedgeStream.response);
    const events = hedgeEvents();
    const deltas: string[] = [];
    primary.delta({ reasoning_content: "Slow thought." });
    const completion = streamLLMResponse({ ...hedgeParams, ...events.callbacks }, (delta) => deltas.push(delta));
    await sleep(45);
    assert.equal(calls.length, 2);
    hedgeStream.delta({ reasoning_content: "The hedge should not be reasoning, but it is." });
    primary.delta({ content: "[STEP]The primary wins after all.[/STEP]" });
    await sleep(0);
    assert.equal(calls[1]!.signal?.aborted, true, "a losing hedge must be aborted immediately");
    assert.equal(hedgeStream.cancels, 1);
    assert.equal(calls[0]!.signal?.aborted, false);
    primary.close();
    const result = await completion;
    assert.equal(result.text, "[STEP]The primary wins after all.[/STEP]");
    assert.deepEqual(deltas, [result.text]);
    assert.equal(result.streamStats?.attempt, "primary");
    assert.equal(result.streamStats?.reasoningChars, "Slow thought.".length);
    assert.equal(result.streamStats?.hedge?.winner, "primary");
    assert.equal(result.streamStats?.hedge?.attempts[1]?.outcome, "aborted");
    assert.deepEqual(events.log, ["request:primary", "hedge-start", "request:hedge", "winner:primary"]);
    assertClean(primary.response);
    assertClean(hedgeStream.response);
  }

  for (const failure of ["http", "network"] as const) {
    // The hedge fails outright: the primary continues untouched.
    const primary = streamedResponse();
    const calls = stubResponses(
      primary.response,
      failure === "http"
        ? new Response("busy", { status: 503 })
        : () => Promise.reject(new TypeError("hedge network failed")),
    );
    const deltas: string[] = [];
    const completion = streamLLMResponse(hedgeParams, (delta) => deltas.push(delta));
    await sleep(45);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]!.signal?.aborted, false, `a ${failure} hedge failure must not touch the primary`);
    primary.delta({ content: "[STEP]The primary carries on.[/STEP]" });
    primary.close();
    const result = await completion;
    assert.equal(result.text, "[STEP]The primary carries on.[/STEP]");
    assert.deepEqual(deltas, [result.text]);
    assert.equal(result.streamStats?.attempt, "primary");
    assert.equal(result.streamStats?.hedge?.attempts[1]?.outcome, "failed");
    assertClean(primary.response);
  }

  for (const callerNoReasoning of [false, true]) {
    // Both only reason: the deadline from the primary's start still applies.
    const primary = streamedResponse();
    const hedgeStream = streamedResponse();
    const calls = stubResponses(primary.response, hedgeStream.response);
    const deltas: string[] = [];
    primary.delta({ reasoning_content: "Primary thinking." });
    const started = performance.now();
    const completion = streamLLMResponse({ ...hedgeParams, noReasoning: callerNoReasoning }, (delta) => deltas.push(delta));
    await sleep(45);
    hedgeStream.delta({ reasoning_content: "Hedge thinking too." });
    if (callerNoReasoning) {
      await assert.rejects(completion, { message: "The lesson did not start in time, even after retrying. Please try asking again." });
    } else {
      const result = await completion;
      assert.equal(result.text, "");
      assert.equal(result.streamStats?.firstContentTimedOut, true, "a double stall must reach the existing retry path");
      assert.equal(result.streamStats?.attempt, "primary");
      assert.equal(result.streamStats?.reasoningChars, "Primary thinking.".length);
      assert.equal(result.streamStats?.hedge?.winner, null);
    }
    assert(performance.now() - started < 400, "the hedge must not extend the startup deadline");
    assert.equal(calls.length, 2, "a stalled hedge is never hedged again");
    assert.equal(calls[0]!.signal?.aborted, true);
    assert.equal(calls[1]!.signal?.aborted, true);
    assert.equal(primary.cancels, 1);
    assert.equal(hedgeStream.cancels, 1);
    assert.deepEqual(deltas, []);
    assertClean(primary.response);
    assertClean(hedgeStream.response);
  }

  {
    // The hedge wins with a partial step: the deadline still runs from the primary's start.
    const primary = streamedResponse();
    const hedgeStream = streamedResponse();
    const calls = stubResponses(primary.response, hedgeStream.response);
    const started = performance.now();
    const completion = streamLLMResponse({ ...hedgeParams, hasUsableContent: () => false });
    await sleep(45);
    hedgeStream.delta({ content: "[STEP]An unfinished hedge sentence" });
    const result = await completion;
    const elapsed = performance.now() - started;
    assert(elapsed >= 140 && elapsed < 140 + 25 + 100, "the winner's deadline is the primary's deadline, not a fresh one");
    assert.equal(result.streamStats?.firstContentTimedOut, true);
    assert.equal(result.streamStats?.attempt, "hedge");
    assert.equal(result.text, "[STEP]An unfinished hedge sentence");
    assert.equal(calls[0]!.signal?.aborted, true);
    assert.equal(calls[1]!.signal?.aborted, true);
    assertClean(primary.response);
    assertClean(hedgeStream.response);
  }

  for (const order of ["primary-ends-first", "hedge-ends-first"] as const) {
    // Both finish without speaking: today's reasoning-only result is returned.
    const primary = streamedResponse();
    const hedgeStream = streamedResponse();
    stubResponses(primary.response, hedgeStream.response);
    primary.delta({ reasoning_content: "Only reasoning." });
    const completion = streamLLMResponse(hedgeParams);
    await sleep(45);
    if (order === "primary-ends-first") {
      primary.close();
      await sleep(5);
      hedgeStream.close();
    } else {
      hedgeStream.close();
      await sleep(5);
      primary.close();
    }
    const result = await completion;
    assert.equal(result.text, "");
    assert.equal(result.streamStats?.firstContentTimedOut, false);
    assert.equal(result.streamStats?.attempt, "primary");
    assert.equal(result.streamStats?.reasoningChars, "Only reasoning.".length, "reasoning-only must still trigger the caller's retry");
    assertClean(primary.response);
    assertClean(hedgeStream.response);
  }

  {
    // The primary finishes reasoning-only before the threshold: no hedge.
    const primary = streamedResponse();
    const calls = stubResponses(primary.response);
    primary.delta({ reasoning_content: "Quick empty thought." });
    primary.close();
    const result = await streamLLMResponse(hedgeParams);
    assert.equal(calls.length, 1);
    assert.equal(result.text, "");
    assert.equal(result.streamStats?.reasoningChars, "Quick empty thought.".length);
    await sleep(40);
    assert.equal(calls.length, 1, "a settled call must never open a late hedge");
    assertClean(primary.response);
  }

  {
    // Stop while both requests are open aborts both.
    const external = new AbortController();
    const primary = streamedResponse();
    const hedgeStream = streamedResponse();
    const calls = stubResponses(primary.response, hedgeStream.response);
    const events = hedgeEvents();
    const deltas: string[] = [];
    const completion = streamLLMResponse({ ...hedgeParams, ...events.callbacks, signal: external.signal }, (delta) => deltas.push(delta));
    await sleep(45);
    assert.equal(calls.length, 2);
    const stop = new DOMException("Student pressed Stop mid-hedge", "AbortError");
    external.abort(stop);
    const result = await completion;
    assert.equal(calls[0]!.signal?.reason, stop, "Stop must reach the primary");
    assert.equal(calls[1]!.signal?.reason, stop, "Stop must reach the hedge");
    assert.equal(primary.cancels, 1);
    assert.equal(hedgeStream.cancels, 1);
    assert.equal(result.text, "");
    assert.equal(result.streamStats?.firstContentTimedOut, false, "Stop is not a startup expiry");
    assert.deepEqual(deltas, []);
    assert(!events.log.some((entry) => entry.startsWith("winner:")), "Stop picks no winner");
    assertClean(primary.response, external.signal);
    assertClean(hedgeStream.response);
  }

  {
    // Stop before the threshold: no hedge ever opens.
    const external = new AbortController();
    const primary = streamedResponse();
    const calls = stubResponses(primary.response);
    const completion = streamLLMResponse({ ...hedgeParams, signal: external.signal });
    await sleep(5);
    external.abort();
    await completion;
    await sleep(40);
    assert.equal(calls.length, 1, "Stop must cancel the pending hedge");
    assertClean(primary.response, external.signal);
  }

  {
    // Both speak in the same tick: exactly one wins and nothing is doubled.
    const primary = streamedResponse();
    const hedgeStream = streamedResponse();
    stubResponses(primary.response, hedgeStream.response);
    const deltas: string[] = [];
    const completion = streamLLMResponse(hedgeParams, (delta) => deltas.push(delta));
    await sleep(45);
    hedgeStream.raw(
      'data: {"choices":[{"delta":{"content":"[STEP]Hedge words."}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":" Hedge ending.[/STEP]"}}]}\n\n',
    );
    primary.raw(
      'data: {"choices":[{"delta":{"content":"[STEP]Primary words."}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":" Primary ending.[/STEP]"}}]}\n\n',
    );
    await sleep(5);
    try { primary.close(); } catch { /* cancelled loser */ }
    try { hedgeStream.close(); } catch { /* cancelled loser */ }
    const result = await completion;
    const joined = deltas.join("");
    assert.equal(joined, result.text, "the parser must receive exactly the returned text");
    assert(
      joined === "[STEP]Hedge words. Hedge ending.[/STEP]" || joined === "[STEP]Primary words. Primary ending.[/STEP]",
      `a single request's words only: ${joined}`,
    );
    assert.equal(result.streamStats?.hedge?.winner, joined.includes("Hedge") ? "hedge" : "primary");
    assertClean(primary.response);
    assertClean(hedgeStream.response);
  }

  {
    // The hedge wins, then its own stream errors: the error surfaces as it does today.
    const primary = streamedResponse();
    const hedgeStream = streamedResponse();
    const calls = stubResponses(primary.response, hedgeStream.response);
    const deltas: string[] = [];
    const completion = streamLLMResponse(hedgeParams, (delta) => deltas.push(delta));
    await sleep(45);
    hedgeStream.delta({ content: "[STEP]The hedge starts" });
    await sleep(0);
    assert.equal(calls[0]!.signal?.aborted, true);
    const failure = new Error("hedge stream dropped");
    hedgeStream.fail(failure);
    await assert.rejects(completion, (error) => error === failure, "a winner's stream error must reach the caller");
    assert.deepEqual(deltas, ["[STEP]The hedge starts"]);
    assertClean(primary.response);
    assertClean(hedgeStream.response);
  }

  for (const hedgeOutcome of ["wins", "times-out"] as const) {
    // The primary fails with a 500 after the hedge opened: the hedge still decides.
    const hedgeStream = streamedResponse();
    const calls = stubResponses(
      () => new Promise<Response>((resolve) => originalSetTimeout(() => resolve(new Response("upstream failed", { status: 500 })), 40)),
      hedgeStream.response,
    );
    const deltas: string[] = [];
    const completion = streamLLMResponse(hedgeParams, (delta) => deltas.push(delta));
    await sleep(60);
    assert.equal(calls.length, 2, "the hedge opens before the primary's 500 arrives");
    if (hedgeOutcome === "wins") {
      hedgeStream.delta({ content: "[STEP]The hedge carries the lesson.[/STEP]" });
      hedgeStream.close();
      const result = await completion;
      assert.equal(result.text, "[STEP]The hedge carries the lesson.[/STEP]");
      assert.deepEqual(deltas, [result.text]);
      assert.equal(result.streamStats?.attempt, "hedge");
      assert.equal(result.streamStats?.hedge?.attempts[0]?.outcome, "failed");
    } else {
      const result = await completion;
      assert.equal(result.streamStats?.firstContentTimedOut, true, "a failed primary and a silent hedge reach today's retry path");
      assert.equal(result.text, "");
      assert.equal(calls[1]!.signal?.aborted, true);
      assert.equal(hedgeStream.cancels, 1);
    }
    assertClean(hedgeStream.response);
  }

  {
    // Stop while both requests are still waiting for headers.
    const external = new AbortController();
    const stop = new DOMException("Student pressed Stop before either answered", "AbortError");
    const signals: AbortSignal[] = [];
    globalThis.fetch = (_url, init) => {
      const requestSignal = init?.signal;
      assert(requestSignal);
      signals.push(requestSignal);
      return new Promise<Response>(() => {});
    };
    const completion = streamLLMResponse({ ...hedgeParams, signal: external.signal });
    await sleep(45);
    assert.equal(signals.length, 2);
    external.abort(stop);
    await assert.rejects(completion, (error) => error === stop, "Stop before headers must reject as it does today");
    assert(signals.every((requestSignal) => requestSignal.reason === stop), "Stop must reach both requests");
    assertClean(undefined, external.signal);
  }

  {
    // The primary completes reasoning-only while the hedge is pending: the call waits for the hedge.
    const primary = streamedResponse();
    const hedgeStream = streamedResponse();
    stubResponses(primary.response, hedgeStream.response);
    let settledEarly = false;
    const deltas: string[] = [];
    const completion = streamLLMResponse(hedgeParams, (delta) => deltas.push(delta));
    void completion.then(() => { settledEarly = true; }, () => { settledEarly = true; });
    await sleep(45);
    primary.delta({ reasoning_content: "Only thinking, then done." });
    primary.close();
    await sleep(10);
    assert.equal(settledEarly, false, "a pending hedge must still be given its chance");
    hedgeStream.delta({ content: "[STEP]The hedge answers.[/STEP]" });
    hedgeStream.close();
    const result = await completion;
    assert.equal(result.text, "[STEP]The hedge answers.[/STEP]");
    assert.deepEqual(deltas, [result.text]);
    assert.equal(result.streamStats?.attempt, "hedge");
    assert.equal(result.streamStats?.hedge?.attempts[0]?.outcome, "completed");
    assertClean(primary.response);
    assertClean(hedgeStream.response);
  }

  for (const hedged of [false, true]) {
    // Throwing observer callbacks can neither kill nor hang a request.
    const primary = streamedResponse();
    const hedgeStream = streamedResponse();
    const calls = stubResponses(primary.response, hedgeStream.response);
    const thrown: string[] = [];
    const fail = (name: string) => () => { thrown.push(name); throw new Error(`${name} observer failed`); };
    const deltas: string[] = [];
    const completion = streamLLMResponse({
      ...(hedged ? hedgeParams : params),
      onRequestStart: fail("request"),
      onHedgeStart: fail("hedge-start"),
      onHedgeWinner: fail("winner"),
    }, (delta) => deltas.push(delta));
    const speaker = hedged ? hedgeStream : primary;
    if (hedged) {
      await sleep(45);
      assert.equal(calls.length, 2, "a throwing observer must not stop the hedge from opening");
    }
    speaker.delta({ content: "[STEP]Observers failed, the lesson did not.[/STEP]" });
    speaker.close();
    const result = await completion;
    assert.equal(result.text, "[STEP]Observers failed, the lesson did not.[/STEP]");
    assert.deepEqual(deltas, [result.text]);
    assert.deepEqual(thrown, hedged ? ["request", "hedge-start", "request", "winner"] : ["request"]);
    assert.equal(result.streamStats?.attempt, hedged ? "hedge" : "primary");
    assertClean(primary.response);
    if (hedged) assertClean(hedgeStream.response);
  }
} finally {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  for (const timer of activeTimers) originalClearTimeout(timer);
}

console.log("verify-teaching-startup: bounded first usable content, owned cancellation, retry expiry, parsing, hedged startup, and cleanup verified");
