import { MAX_DOUBTS_PER_CREDIT, TTS_CHARS_PER_LESSON } from "../../lib/billing/catalog";
import {
  attachTraceToGrant,
  consumeTtsChars,
  consumeUsdMillicents,
  createLessonGrant,
  markGrantInUse,
  requireGrantForTrace,
  resetTurnGrantsForTests,
  shouldSkipTtsForUsage,
} from "../../lib/billing/grant";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

resetTurnGrantsForTests();
const minted = createLessonGrant({ userId: "u1", traceId: "lesson-1" });
assert(minted.ok && minted.grant.ttsCharsRemaining === TTS_CHARS_PER_LESSON, "new grant has the TTS budget");

const same = requireGrantForTrace("u1", "lesson-1");
assert(same.ok, "the lesson trace reuses the grant");

for (let i = 0; i < MAX_DOUBTS_PER_CREDIT; i++) {
  const attached = attachTraceToGrant("u1", `doubt-${i}`);
  assert(attached.ok, `doubt ${i} reuses the grant`);
}
const overflow = attachTraceToGrant("u1", "doubt-overflow");
assert(!overflow.ok && overflow.reason === "doubt_limit", "the 9th extra trace is refused");

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

assert(!requireGrantForTrace("nobody", "x").ok, "missing grant is closed");

resetTurnGrantsForTests();
const lastTurn = createLessonGrant({ userId: "u2", traceId: "tiny", usdMillicents: 1 });
assert(lastTurn.ok && !shouldSkipTtsForUsage(lastTurn.grant), "tiny remaining still allows TTS");
consumeUsdMillicents(lastTurn.grant, 1);
assert(shouldSkipTtsForUsage(lastTurn.grant), "TTS skips when remaining USD hits 0");

resetTurnGrantsForTests();
console.log("✓ turn grants: reuse, doubt cap, TTS budget, concurrent fuse");
