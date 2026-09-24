import assert from "node:assert/strict";
import { requireSpeechStart, speakWithStartupRecovery, speechPlaybackOverdue, waitForSpeechStartup } from "../../features/tutor-session/lib/turn/speechStartup";
import { shouldAbandonTurn } from "../../features/tutor-session/lib/turn/turnFailurePolicy";

async function main() {
  let failures = 0;
  // Browser fallback reports onError then resolves. That must still reach
  // the queue as failure, otherwise forty silent segments appear successful.
  for (let beat = 0; beat < 2; beat++) {
    await assert.rejects(requireSpeechStart(Promise.resolve(), () => false), /voice could not start/);
    failures++;
  }
  assert(shouldAbandonTurn(failures), "repeated silent speech must stop the lesson");
  await requireSpeechStart(Promise.resolve(), () => true);
  await assert.rejects(requireSpeechStart(Promise.reject(new Error("transport failed")), () => false), /transport failed/);
  const never = new Promise<void>(() => {});
  assert.equal(await waitForSpeechStartup(never, never, 10), "timeout", "stalled speech must reach browser recovery quickly");
  assert.equal(await waitForSpeechStartup(Promise.resolve(), never, 10), "started");
  assert.equal(await waitForSpeechStartup(never, Promise.resolve(), 10), "settled");
  assert(speechPlaybackOverdue({ elapsedMs: 16_000, audioDurationMs: 8_729, playbackRate: 1, paused: false }), "a completed audio timeline must not hold a doubt indefinitely");
  assert(!speechPlaybackOverdue({ elapsedMs: 8_000, audioDurationMs: 8_729, playbackRate: 1, paused: false }));
  assert(!speechPlaybackOverdue({ elapsedMs: 30_000, audioDurationMs: 8_729, playbackRate: 1, paused: true }));
  let abandoned = 0;
  let recovered = 0;
  let audible = false;
  await requireSpeechStart(speakWithStartupRecovery({
    primary: () => never,
    fallback: async () => { recovered++; audible = true; },
    abandonPrimary: () => { abandoned++; },
    hasStarted: () => audible,
    canFallback: () => true,
    deadlineMs: 10,
  }), () => audible);
  assert.equal(abandoned, 1, "the stuck provider must be abandoned");
  assert.equal(recovered, 1, "the sentence must be spoken by the fallback");
  await speakWithStartupRecovery({
    primary: async (onStart) => { onStart(); },
    fallback: async () => { recovered++; },
    abandonPrimary: () => { abandoned++; },
    hasStarted: () => true,
    canFallback: () => true,
    deadlineMs: 10,
  });
  assert.equal(recovered, 1, "audible primary speech must stay on its own voice");
  console.log("verified silent speech reaches the turn failure policy");
}
void main();
