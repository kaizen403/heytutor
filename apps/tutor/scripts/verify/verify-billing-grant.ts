import { TTS_CHARS_PER_LESSON } from "../../lib/billing/catalog";
import {
  authorizePaidCreditTrace,
  beginTurnForActor,
  createInUseRelease,
  holdGrantUntilStreamEnds,
  releaseInUseWhenClientLeaves,
} from "../../lib/billing/gate";
import {
  STALE_IN_USE_MS,
  attachTraceToGrant,
  consumeTtsChars,
  consumeUsdMillicents,
  createLessonGrant,
  ensureBypassGrant,
  markGrantInUse,
  recoverGrantForPaidCall,
  requireGrantForTrace,
  resetTurnGrantsForTests,
  setGrantNowForTests,
  shouldSkipTtsForUsage,
  touchGrantInUse,
} from "../../lib/billing/grant";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
resetTurnGrantsForTests();
const minted = createLessonGrant({ userId: "u1", traceId: "lesson-1" });
assert(minted.ok && minted.grant.ttsCharsRemaining === TTS_CHARS_PER_LESSON, "new grant has the TTS budget");

const same = requireGrantForTrace("u1", "lesson-1");
assert(same.ok, "the lesson trace reuses the grant");

for (let i = 0; i < 12; i++) {
  const attached = attachTraceToGrant("u1", `doubt-${i}`);
  assert(attached.ok, `doubt ${i} reuses the grant`);
}

const budget = consumeTtsChars(minted.grant, TTS_CHARS_PER_LESSON);
assert(budget.allowed && budget.remaining === 0, "exact budget is allowed");
const skipped = consumeTtsChars(minted.grant, 10);
assert(!skipped.allowed, "past the TTS ceiling skips ElevenLabs");

markGrantInUse(minted.grant, 1);
const concurrent = createLessonGrant({ userId: "u1", traceId: "lesson-2" });
assert(!concurrent.ok && concurrent.reason === "concurrent_limit", "a second in-flight lesson is refused");
markGrantInUse(minted.grant, -1);
const sequential = createLessonGrant({ userId: "u1", traceId: "lesson-2" });
assert(sequential.ok, "a finished lesson can be replaced");

resetTurnGrantsForTests();
const stuck = createLessonGrant({ userId: "u-abort", traceId: "lesson-a" });
assert(stuck.ok, "the abandoned lesson has a grant");
markGrantInUse(stuck.grant, 1, "lesson-a");
const releaseStuck = createInUseRelease(stuck.grant, "lesson-a");
const clientLeft = new AbortController();
releaseInUseWhenClientLeaves(clientLeft.signal, releaseStuck);
assert(
  !createLessonGrant({ userId: "u-abort", traceId: "lesson-b" }).ok,
  "an open chat still blocks the retry before the browser disconnects",
);
clientLeft.abort();
releaseStuck();
assert(
  createLessonGrant({ userId: "u-abort", traceId: "lesson-b" }).ok,
  "a client abort frees the lesson even when the stream never cancels",
);

resetTurnGrantsForTests();
const paired = createLessonGrant({ userId: "u-paired", traceId: "lesson-a" });
assert(paired.ok, "two chats share one grant");
markGrantInUse(paired.grant, 1, "lesson-a");
markGrantInUse(paired.grant, 1, "lesson-a");
const releaseOne = createInUseRelease(paired.grant, "lesson-a");
const oneLeft = new AbortController();
releaseInUseWhenClientLeaves(oneLeft.signal, releaseOne);
oneLeft.abort();
releaseOne();
assert(paired.grant.inUse === 1, "one aborted chat must not clear a second in-flight chat");
assert(
  !createLessonGrant({ userId: "u-paired", traceId: "lesson-b" }).ok,
  "the chat that is still open still blocks the retry",
);

resetTurnGrantsForTests();
let staleNow = Date.now();
setGrantNowForTests(() => staleNow);
const leaked = createLessonGrant({ userId: "u-stale", traceId: "lesson-a" });
assert(leaked.ok, "the leaked lesson has a grant");
markGrantInUse(leaked.grant, 1, "lesson-a");
assert(
  !createLessonGrant({ userId: "u-stale", traceId: "lesson-b" }).ok,
  "a fresh in-use grant still blocks a concurrent lesson",
);
staleNow += STALE_IN_USE_MS + 1;
assert(
  createLessonGrant({ userId: "u-stale", traceId: "lesson-b" }).ok,
  "a remount that never fired request.signal must not 429 the retry",
);

resetTurnGrantsForTests();
staleNow = Date.now();
setGrantNowForTests(() => staleNow);
const live = createLessonGrant({ userId: "u-live", traceId: "lesson-a" });
assert(live.ok, "the live lesson has a grant");
markGrantInUse(live.grant, 1, "lesson-a");
staleNow += STALE_IN_USE_MS - 1000;
touchGrantInUse(live.grant);
staleNow += 2000;
assert(
  !createLessonGrant({ userId: "u-live", traceId: "lesson-b" }).ok,
  "a streaming lesson still blocks while its chunks keep arriving",
);
resetTurnGrantsForTests();
const staffActor = {
  userId: "staff-user",
  email: "staff@example.test",
  staff: true,
  lectureLab: false,
  skipAutumn: true,
  skipGates: true,
};
const [firstStaffTurn, secondStaffTurn] = await Promise.all([
  beginTurnForActor(staffActor, { traceId: "staff-1", kind: "lesson" }),
  beginTurnForActor(staffActor, { traceId: "staff-2", kind: "lesson" }),
]);
assert(!(firstStaffTurn instanceof Response), "staff's first lesson starts without external billing");
assert(!(secondStaffTurn instanceof Response), "staff's second lesson starts before the first paid call");
assert(secondStaffTurn.grant === firstStaffTurn.grant, "concurrent staff begins do not replace the shared grant");
assert(secondStaffTurn.grant.allowedTraceIds.has("staff-1"), "the first trace survives an immediate second begin-turn");
markGrantInUse(firstStaffTurn.grant, 1);
for (let i = 3; i <= 5; i += 1) {
  const turn = await beginTurnForActor(staffActor, { traceId: `staff-${i}`, kind: "lesson" });
  assert(!(turn instanceof Response), `staff lesson ${i} runs while the same account is busy`);
  assert(turn.grant === firstStaffTurn.grant, "parallel staff lessons share the existing grant");
  assert(turn.grant.allowedTraceIds.has(`staff-${i}`), "each staff trace is authorized for paid routes");
}
assert(firstStaffTurn.grant.inUse === 1, "parallel begin-turn does not clear in-flight work");
assert(firstStaffTurn.grant.allowedTraceIds.has("staff-1"), "the original staff trace remains authorized");
const sixthStaffTurn = await beginTurnForActor(staffActor, { traceId: "staff-6", kind: "lesson" });
assert(sixthStaffTurn instanceof Response && sixthStaffTurn.status === 429,
  "a sixth simultaneous staff lesson is rejected before its first paid call");
assert(!firstStaffTurn.grant.allowedTraceIds.has("staff-6"), "denied staff trace is not authorized");
assert(ensureBypassGrant({ userId: "staff-user", traceId: "staff-direct-6" }) === null,
  "a sixth direct staff paid call cannot bypass the begin-turn cap");
const unboundDoubt = await beginTurnForActor(staffActor, { traceId: "unbound-doubt", kind: "doubt" });
assert(unboundDoubt instanceof Response && unboundDoubt.status === 429,
  "an unbound follow-on cannot evade a full five-lesson reservation");
const inventedParent = await beginTurnForActor(staffActor, { traceId: "invented-doubt", kind: "doubt", parentTraceId: "fake-lesson" });
assert(inventedParent instanceof Response && inventedParent.status === 429,
  "a forged parent trace cannot evade the staff lesson cap");
const staffDoubt = await beginTurnForActor(staffActor, { traceId: "staff-1-doubt", kind: "doubt", parentTraceId: "staff-1" });
assert(!(staffDoubt instanceof Response), "a follow-up to a running staff lesson is allowed at the five-lesson cap");
assert(ensureBypassGrant({ userId: "staff-user", traceId: "staff-1-doubt" }) !== null,
  "the follow-up's direct paid call reuses the grant without taking a sixth lesson slot");
const childDoubt = await beginTurnForActor(staffActor, { traceId: "staff-1-child", kind: "resume", parentTraceId: "staff-1-doubt" });
assert(!(childDoubt instanceof Response), "a resume can follow a bound doubt without taking a slot");
assert(ensureBypassGrant({ userId: "staff-user", traceId: "staff-1-child" }) !== null,
  "a bound resume's paid chat is authorized at the cap");
assert(!(await beginTurnForActor(staffActor, { traceId: "staff-5", kind: "lesson" }) instanceof Response),
  "an existing staff trace may begin again at the cap");
markGrantInUse(firstStaffTurn.grant, 1, "staff-1");
markGrantInUse(firstStaffTurn.grant, 1, "staff-1");
markGrantInUse(firstStaffTurn.grant, -1, "staff-1");
assert((await beginTurnForActor(staffActor, { traceId: "staff-6", kind: "lesson" }) instanceof Response),
  "one completed request does not release a trace with a second request still running");
markGrantInUse(firstStaffTurn.grant, -1, "staff-1");
assert(!(await beginTurnForActor(staffActor, { traceId: "staff-6", kind: "lesson" }) instanceof Response),
  "once a staff trace finishes, its slot admits another lesson");
markGrantInUse(firstStaffTurn.grant, 1, "staff-6");
const pendingStream = new ReadableStream<Uint8Array>({
  pull(controller) {
    controller.enqueue(new Uint8Array([1]));
  },
});
const heldStream = holdGrantUntilStreamEnds(firstStaffTurn.grant, "staff-6", pendingStream);
const heldReader = heldStream.getReader();
assert(!(await heldReader.read()).done, "staff chat returns a streaming first chunk");
assert((await beginTurnForActor(staffActor, { traceId: "staff-7", kind: "lesson" }) instanceof Response),
  "the streaming staff trace still occupies its slot after HTTP headers return");
await heldReader.cancel();
assert(!(await beginTurnForActor(staffActor, { traceId: "staff-7", kind: "lesson" }) instanceof Response),
  "cancelling a stream releases its staff trace slot");
markGrantInUse(firstStaffTurn.grant, 1, "staff-7");
const completeStream = holdGrantUntilStreamEnds(firstStaffTurn.grant, "staff-7", new ReadableStream<Uint8Array>({
  start(controller) { controller.close(); },
}));
assert((await completeStream.getReader().read()).done, "completed streaming response reaches EOF");
assert(ensureBypassGrant({ userId: "staff-user", traceId: "staff-direct-8" }) !== null,
  "completed staff chat stream also frees its trace slot for a direct paid call");
assert(!createLessonGrant({ userId: "staff-user", traceId: "ordinary", skipGates: false }).ok,
  "an ordinary call cannot take over a busy privileged grant");
markGrantInUse(firstStaffTurn.grant, -1);

resetTurnGrantsForTests();
for (let i = 1; i <= 5; i++) {
  assert(!(await beginTurnForActor(staffActor, { traceId: `reserved-${i}`, kind: "lesson" }) instanceof Response),
    "five recording slots are reserved before paid calls");
}
const bound = await beginTurnForActor(staffActor, {
  traceId: "bound-doubt", kind: "doubt", parentTraceId: "reserved-1",
});
assert(!(bound instanceof Response), "bound doubt joins the original recording");
markGrantInUse(bound.grant, 1, "reserved-1");
markGrantInUse(bound.grant, 1, "bound-doubt");
markGrantInUse(bound.grant, -1, "reserved-1");
assert((await beginTurnForActor(staffActor, { traceId: "sixth-during-doubt", kind: "lesson" }) instanceof Response),
  "a child stream holds its parent reservation when original chat EOF arrives first");
markGrantInUse(bound.grant, -1, "bound-doubt");
assert(!(await beginTurnForActor(staffActor, { traceId: "sixth-after-doubt", kind: "lesson" }) instanceof Response),
  "the last child stream releases its parent's slot");

resetTurnGrantsForTests();
const firstCompletedChat = await beginTurnForActor(staffActor, { traceId: "recording-before-audio", kind: "lesson" });
assert(!(firstCompletedChat instanceof Response), "recording begins before its chat stream");
markGrantInUse(firstCompletedChat.grant, 1, "recording-before-audio");
markGrantInUse(firstCompletedChat.grant, -1, "recording-before-audio");
const audioDoubt = await beginTurnForActor(staffActor, {
  traceId: "audio-doubt", kind: "doubt", parentTraceId: "recording-before-audio",
});
assert(!(audioDoubt instanceof Response),
  "a follow-on after the chat stream ends can reclaim a free recording slot");

assert(!requireGrantForTrace("nobody", "x").ok, "missing grant is closed");

resetTurnGrantsForTests();
const ordinaryActor = { ...staffActor, userId: "ordinary-user", staff: false, skipGates: false };
const ordinary = createLessonGrant({ userId: ordinaryActor.userId, traceId: "authorized", usdMillicents: 1 });
assert(ordinary.ok, "ordinary grant starts with available usage");
consumeUsdMillicents(ordinary.grant, 1);
for (const path of ["stt", "extract-question"]) {
  const request = (traceId?: string) => new Request(`https://example.test/api/${path}`, {
    headers: traceId ? { "x-heytutor-trace-id": traceId } : {},
  });
  const same = authorizePaidCreditTrace(request("authorized"), ordinaryActor, null, "free");
  assert(!(same instanceof Response) && same.grant === ordinary.grant,
    `${path} may finish its known trace when usage reaches zero`);
  for (const fresh of [request(), request("unknown")]) {
    const denied = authorizePaidCreditTrace(fresh, ordinaryActor, { remainingMillicents: 0, remainingPct: 0 }, "free");
    assert(denied instanceof Response && denied.status === 402,
      `${path} refuses missing and new trace headers after exhaustion`);
  }
  assert(!ordinary.grant.allowedTraceIds.has("unknown"), `${path} does not attach a denied trace`);
}
resetTurnGrantsForTests();
const stale = createLessonGrant({ userId: ordinaryActor.userId, traceId: "old", usdMillicents: 20 });
assert(stale.ok, "ordinary stale grant exists");
const stalePaid = authorizePaidCreditTrace(new Request("https://example.test/api/stt", {
  headers: { "x-heytutor-trace-id": "fresh" },
}), ordinaryActor, { remainingMillicents: 0, remainingPct: 0 }, "free");
assert(stalePaid instanceof Response && stalePaid.status === 402,
  "persisted exhaustion beats a stale positive grant on a new paid trace");
resetTurnGrantsForTests();
const privileged = createLessonGrant({ userId: ordinaryActor.userId, traceId: "privileged", skipGates: true });
assert(privileged.ok, "a staff grant remains in the map after entitlement changes");
assert(recoverGrantForPaidCall({
  userId: ordinaryActor.userId, traceId: "privileged", remainingMillicents: 100,
  planId: "free", skipGates: false,
}) === null, "an ordinary grant recovery must not inherit a privileged trace");
const mismatched = authorizePaidCreditTrace(new Request("https://example.test/api/extract-question", {
  headers: { "x-heytutor-trace-id": "privileged" },
}), ordinaryActor, null, "free");
assert(mismatched instanceof Response && mismatched.status !== 200,
  "ordinary actors cannot spend through a cached privileged grant, even on its known trace");

resetTurnGrantsForTests();
const lastTurn = createLessonGrant({ userId: "u2", traceId: "tiny", usdMillicents: 1 });
assert(lastTurn.ok && !shouldSkipTtsForUsage(lastTurn.grant), "tiny remaining still allows TTS");
consumeUsdMillicents(lastTurn.grant, 1);
assert(shouldSkipTtsForUsage(lastTurn.grant), "TTS skips when remaining USD hits 0");

resetTurnGrantsForTests();
console.log("✓ turn grants: reuse across doubts, TTS budget, concurrent fuse");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
