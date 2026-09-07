import {
  createHttpTtsGate,
  MAX_CONCURRENT_HTTP_TTS,
  MAX_HTTP_PREFETCH,
  parseRetryAfterSec,
  ttsHttpRetryDelayMs,
} from "../../src/tts/httpTtsPolicy";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(MAX_HTTP_PREFETCH === 1, "HTTP prefetch must be the next sentence only");
assert(MAX_CONCURRENT_HTTP_TTS === 2, "HTTP TTS must stay at current + one prefetch");

assert(ttsHttpRetryDelayMs(200, 0) === null, "a 200 must not retry");
assert(ttsHttpRetryDelayMs(429, 0) === 400, "a 429 must retry once quickly");
assert(ttsHttpRetryDelayMs(429, 1) === null, "a 429 must not retry forever");
assert(ttsHttpRetryDelayMs(503, 0) === 400, "a 503 must retry once");
assert(
  ttsHttpRetryDelayMs(429, 0, 5) === 2_000,
  "Retry-After must be honoured but capped so the pen does not wait 5s",
);
assert(parseRetryAfterSec("1.5") === 1.5, "Retry-After seconds must parse");
assert(parseRetryAfterSec("nope") === undefined, "a junk Retry-After must be ignored");

const gate = createHttpTtsGate(1);
let firstReleased = false;
const first = gate.acquire().then(() => {
  assert(gate.inFlight === 1, "the first HTTP slot must be held");
});
await first;
const second = gate.acquire().then(() => {
  assert(firstReleased, "the second request must wait for the first slot");
  assert(gate.inFlight === 1, "only one HTTP TTS request may run at the limit");
});
firstReleased = true;
gate.release();
await second;
gate.release();
assert(gate.inFlight === 0, "releasing the last slot must clear the gate");

console.log("http tts policy verification passed");
