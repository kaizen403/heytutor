/**
 * Production 25 Oct 2026 (b97d2500): a lesson's continuation request failed on
 * the student's network before reaching the server, and the lesson ended as a
 * teaching transport_error with most of it untaught. A continuation whose fetch
 * failed with no response is now asked once more. Nothing of the failed request
 * was parsed or spoken, so the retry cannot repeat a word. Anything else (a
 * read failing mid-stream, the first request, a stop, a second failure) keeps
 * today's behaviour.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TeachingTransportError } from "@heytutor/tutor-core";
import { retryContinuationFetchOnce } from "../../features/tutor-session/lib/turn/segmentPlanning";

const fetchFailure = () => new TeachingTransportError("fetch", new TypeError("Failed to fetch"));
const readFailure = () => new TeachingTransportError("read", new TypeError("network error"));

async function attempts(errors: Array<Error | null>, options: { enabled: boolean; signal?: AbortSignal; abortDuringPause?: AbortController }) {
  let calls = 0, retries = 0;
  const run = async () => {
    const error = errors[calls++];
    if (error) throw error;
    return "taught";
  };
  const signal = options.signal ?? options.abortDuringPause?.signal ?? new AbortController().signal;
  const result = retryContinuationFetchOnce(run, {
    enabled: options.enabled, signal, delayMs: 50,
    onRetry: () => { retries++; if (options.abortDuringPause) setTimeout(() => options.abortDuringPause!.abort(), 5); },
  });
  try {
    return { value: await result, calls, retries };
  } catch (error) {
    return { error, calls, retries };
  }
}

async function main() {
  const retried = await attempts([fetchFailure(), null], { enabled: true });
  assert.equal(retried.value, "taught", "a continuation whose fetch failed is asked once more and teaches");
  assert.equal(retried.calls, 2, "exactly one retry");
  assert.equal(retried.retries, 1, "the retry is marked once");

  const twice = await attempts([fetchFailure(), fetchFailure(), null], { enabled: true });
  assert(twice.error instanceof TeachingTransportError && twice.calls === 2, "a second fetch failure is not retried again");

  const midStream = await attempts([readFailure(), null], { enabled: true });
  assert(midStream.error instanceof TeachingTransportError && midStream.calls === 1,
    "a read failing mid-stream is not retried: part of it may already be on the board");

  const first = await attempts([fetchFailure(), null], { enabled: false });
  assert(first.error instanceof TeachingTransportError && first.calls === 1, "a request that is not a continuation is not retried");

  const stopped = new AbortController();
  stopped.abort();
  const afterStop = await attempts([fetchFailure(), null], { enabled: true, signal: stopped.signal });
  assert(afterStop.error instanceof TeachingTransportError && afterStop.calls === 1, "a stopped turn is not retried");

  const stopDuringPause = await attempts([fetchFailure(), null], { enabled: true, abortDuringPause: new AbortController() });
  assert(stopDuringPause.error instanceof TeachingTransportError && stopDuringPause.calls === 1, "a stop during the pause ends the retry");

  const other = await attempts([new Error("http 500"), null], { enabled: true });
  assert(other.error instanceof Error && other.calls === 1, "an error that is not a transport failure is not retried");

  // The live teaching loop wraps its request, and only continuations retry.
  const hook = readFileSync(resolve(__dirname, "../../features/tutor-session/hooks/turn/useQuestionHandler.ts"), "utf8");
  assert(hook.includes("await retryContinuationFetchOnce(() => streamLLMResponse("), "the teaching request goes through the continuation retry");
  assert(hook.includes("enabled: isContinuation && !resumeInkRetry,"), "only a continuation (not the first request or the ink retry) is retried");

  console.log("verify-continuation-fetch-retry: a continuation whose fetch failed is retried once; mid-stream reads, first requests, stops and second failures are not");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
