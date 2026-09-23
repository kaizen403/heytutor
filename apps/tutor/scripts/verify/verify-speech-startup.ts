import assert from "node:assert/strict";
import { requireSpeechStart } from "../../features/tutor-session/lib/turn/speechStartup";
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
  console.log("verified silent speech reaches the turn failure policy");
}
void main();
