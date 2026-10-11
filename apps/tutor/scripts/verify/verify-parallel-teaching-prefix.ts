import assert from "node:assert/strict";
import { acceptParallelPrefix, parallelPrefixPrompt, parallelContinuationHistory } from "../lecture-lab/parallelTeachingPrefix";
import { createParallelPrefixController } from "../lecture-lab/parallelTeachingController";

const question = "For x squared minus 3x plus 2, explain how to determine the real roots.";
const response = "[STEP]The real roots are the inputs where the quadratic equals zero. Checking the discriminant first tells us whether real solutions are possible, before choosing a method to find them.[/STEP]";
const gate = { enabled: true, speculative: false, blocked: false, scenePlanned: true };
let checks = 0;

async function main() {
  const accepted = acceptParallelPrefix(response, question);
  assert(accepted.accepted); checks++;
  for (const raw of [
    "Okay, let's take this question one step at a time.",
    "[STEP]Okay, let's take this question one step at a time.[/STEP]",
    "[STEP]We will draw the figure to prove this, then read the roots from it.[/STEP]",
    "[STEP]For the quadratic we will plot a graph so the real roots are visible, and use that to solve the question.[/STEP]",
    "[STEP]As you can see, the diagram already proves exactly where the roots occur.[/STEP]",
    ...["FOCUS:root", "WRITE:x=2,20,20", "DRAW:line:400,100,900,100", "ANNOTATE:root|answer", "TYPE:root", "FRAME:1"].map(command => response.replace("[/STEP]", `[${command}][/STEP]`)),
    response + "[STEP]A second explanation cannot enter early playback.[/STEP]",
    response + " [FOCUS:unverified]",
    response.replace("[/STEP]", ""),
    response.replace("The real roots", "The answer is 99. The real roots"),
    "[STEP]This is an extremely important question which we shall now carefully solve together with a clear and helpful method.[/STEP]",
  ]) { assert.equal(acceptParallelPrefix(raw, question).accepted, false); checks++; }
  const prompt = parallelPrefixPrompt();
  for (const expected of [/PENDING_FIGURE_PREFIX/, /one complete/, /not yet been selected or verified/, /original question/, /No WRITE/]) {
    assert.match(prompt, expected); checks++;
  }
  assert.deepEqual(parallelContinuationHistory(question, null), []); checks++;
  assert.deepEqual(parallelContinuationHistory(question, accepted), [{ user: question, assistant: response }]); checks++;

  function deferred() {
    let resolve!: (raw: string) => void;
    const promise = new Promise<string>(done => { resolve = done; });
    return { resolve, promise };
  }
  for (const guard of [{ enabled: false }, { speculative: true }, { blocked: true }, { scenePlanned: false }]) {
    let calls = 0;
    const control = createParallelPrefixController({ enabled: true, question, request: async () => { calls++; return response; } });
    control.start({ ...gate, ...guard }); await control.settled();
    assert.equal(calls, 0); assert.equal(control.finishScene(), null); checks++;
  }
  const disabled = createParallelPrefixController({ enabled: false, question, request: async () => { throw new Error("disabled must not call"); } });
  disabled.start(gate); await disabled.settled(); assert.equal(disabled.snapshot().started, false); checks++;

  const held = deferred();
  let calls = 0;
  let played = 0;
  const signalRef: { current: AbortSignal | null } = { current: null };
  const control = createParallelPrefixController({ enabled: true, question,
    request: async signal => { calls++; signalRef.current = signal; return held.promise; },
    onAccepted: () => { played++; },
  });
  control.start(gate); control.start(gate); assert.equal(calls, 1); checks++;
  assert.equal(control.finishScene(), null); assert.equal(signalRef.current?.aborted, true); checks++;
  held.resolve(response); await control.settled();
  assert.equal(played, 0); assert.equal(control.finishScene(), null); checks++;

  const ready = createParallelPrefixController({ enabled: true, question, request: async () => response, onAccepted: () => { played++; } });
  ready.start(gate); await ready.settled(); assert.equal(played, 1); assert.equal(ready.finishScene()?.raw, response); checks++;
  for (const request of [async () => "[STEP]Here is the figure we will draw next.[/STEP]", async () => { throw new Error("upstream failure"); }]) {
    const failed = createParallelPrefixController({ enabled: true, question, request, onAccepted: () => { throw new Error("must not be played"); } });
    failed.start(gate); await failed.settled(); assert.equal(failed.finishScene(), null); checks++;
  }
  const syncError = createParallelPrefixController({ enabled: true, question, request: () => { throw new Error("synchronous port error"); } });
  assert.doesNotThrow(() => syncError.start(gate)); await syncError.settled(); assert.equal(syncError.finishScene(), null); checks++;
  const abort = new AbortController(); const late = deferred(); let stalePlayed = false;
  const stopped = createParallelPrefixController({ enabled: true, question, signal: abort.signal, request: () => late.promise, onAccepted: () => { stalePlayed = true; } });
  stopped.start(gate); abort.abort(); late.resolve(response); await stopped.settled();
  assert.equal(stalePlayed, false); assert.equal(stopped.finishScene(), null); checks++;
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  const stale = createParallelPrefixController({ enabled: true, question, signal: alreadyAborted.signal, request: async () => { throw new Error("already aborted must not call"); } });
  stale.start(gate); assert.equal(stale.snapshot().started, false); checks++;
  const callbackError = createParallelPrefixController({ enabled: true, question, request: async () => response, onAccepted: () => { throw new Error("observer failure"); } });
  callbackError.start(gate); await callbackError.settled(); assert(callbackError.finishScene()?.accepted); checks++;
  console.log(`parallel-teaching-prefix: ${checks} checks PASS (structural admission, not semantic proof)`);
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
