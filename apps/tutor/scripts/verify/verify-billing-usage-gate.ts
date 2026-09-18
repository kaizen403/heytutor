import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PLAN_CATALOG, usdToMillicents } from "../../lib/billing/catalog";
import {
  consumeUsdMillicents,
  createLessonGrant,
  getTurnGrant,
  grantForFollowOnTurn,
  recoverGrantForPaidCall,
  releaseTurnGrant,
  requireGrantForTrace,
  resetTurnGrantsForTests,
  shouldSkipTtsForUsage,
} from "../../lib/billing/grant";
import { beginTurnAccess, paidCallAccess } from "../../lib/billing/usageGate";
import { calculateLlmCostDetails } from "../../lib/obs/usageCost";
import { DEFAULT_FIREWORKS_FAST_MODEL } from "../../lib/llm/fireworksModels";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const unusedFree = usdToMillicents(PLAN_CATALOG.free.includedUsdPerMonth);
assert(unusedFree === 3500, "Free monthly envelope is $3.50");

assert(
  beginTurnAccess({ remainingMillicents: unusedFree, grant: null, kind: "lesson", traceId: "q1" }) ===
    "allow",
  "fresh Free begin-turn must start the first question",
);
assert(
  beginTurnAccess({ remainingMillicents: 0, grant: null, kind: "lesson", traceId: "q1" }) ===
    "out_of_credits",
  "a truly empty envelope still 402s a new question",
);

assert(
  paidCallAccess({ remainingMillicents: unusedFree, grant: null }) === "allow",
  "planners/teaching must not 402 as out of usage when the grant map is empty but USD remains",
);
assert(
  paidCallAccess({ remainingMillicents: 0, grant: null }) === "out_of_credits",
  "paid calls without a grant 402 only when the envelope is already empty",
);

resetTurnGrantsForTests();
const minted = createLessonGrant({
  userId: "fresh-free",
  traceId: "question-1",
  planId: "free",
  usdMillicents: unusedFree,
});
assert(minted.ok, "begin-turn mints a grant");
consumeUsdMillicents(minted.grant, unusedFree);
assert(
  paidCallAccess({ remainingMillicents: 0, grant: minted.grant }) === "allow",
  "later planner/teaching/title calls on the same grant finish even after spend hits $0",
);
assert(shouldSkipTtsForUsage(minted.grant), "TTS still skips at 0 USD remaining");
assert(
  beginTurnAccess({
    remainingMillicents: 0,
    grant: minted.grant,
    kind: "lesson",
    traceId: "question-1",
  }) === "allow",
  "the in-flight first question may keep its grant after the envelope is spent",
);
assert(
  beginTurnAccess({
    remainingMillicents: 0,
    grant: minted.grant,
    kind: "lesson",
    traceId: "question-2",
  }) === "out_of_credits",
  "a later question after the envelope is spent is refused",
);

releaseTurnGrant("fresh-free");
assert(getTurnGrant("fresh-free") === null, "isolated Next route lost the in-memory grant");
const recovered = recoverGrantForPaidCall({
  userId: "fresh-free",
  traceId: "question-1",
  remainingMillicents: unusedFree,
  planId: "free",
});
assert(recovered !== null, "lost grant remints while monthly USD remains");
assert(requireGrantForTrace("fresh-free", "question-1").ok, "chat sees the reminted grant");

resetTurnGrantsForTests();
assert(
  recoverGrantForPaidCall({
    userId: "spent-free",
    traceId: "question-1",
    remainingMillicents: 0,
    planId: "free",
  }) === null,
  "do not remint a new question once remaining is already 0",
);

resetTurnGrantsForTests();
assert(
  beginTurnAccess({
    remainingMillicents: unusedFree,
    grant: null,
    kind: "doubt",
    traceId: "explain-this",
  }) === "allow",
  "Ask a doubt / Explain this with leftover usage is not an empty envelope",
);
const explainThis = grantForFollowOnTurn({
  userId: "idle-after-lecture",
  traceId: "explain-this",
  remainingMillicents: unusedFree,
  planId: "free",
});
assert(
  explainThis.ok,
  "Explain this must mint a grant when the lecture grant is gone but monthly USD remains",
);
assert(getTurnGrant("idle-after-lecture") !== null, "the minted doubt grant is in memory for /api/chat");

resetTurnGrantsForTests();
const emptyFollowOn = grantForFollowOnTurn({
  userId: "spent-idle",
  traceId: "explain-this",
  remainingMillicents: 0,
  planId: "free",
});
assert(
  !emptyFollowOn.ok && emptyFollowOn.reason === "out_of_credits",
  "Explain this with a truly empty envelope still 402s",
);

resetTurnGrantsForTests();
assert(
  createLessonGrant({ userId: "mid-lesson", traceId: "lesson-1", usdMillicents: unusedFree }).ok,
  "mid-lesson grant exists",
);
const attachedDoubt = grantForFollowOnTurn({
  userId: "mid-lesson",
  traceId: "explain-this",
  remainingMillicents: unusedFree,
  planId: "free",
});
assert(attachedDoubt.ok, "a mid-lesson Explain this reuses the lesson grant");
assert(
  getTurnGrant("mid-lesson")?.allowedTraceIds.has("explain-this") === true,
  "the doubt trace is on the same grant",
);

const typicalFast = calculateLlmCostDetails(
  { input: 20_000, output: 8_000 },
  { model: DEFAULT_FIREWORKS_FAST_MODEL },
);
const typicalMillicents = usdToMillicents(typicalFast.total ?? 0);
assert(typicalMillicents > 0, "a real Kimi Fast call posts some spend");
assert(
  typicalMillicents < unusedFree,
  "one Kimi Fast planner/teach call must not be billed as the whole $3.50 envelope",
);

const grantSource = readFileSync(resolve(import.meta.dirname, "../../lib/billing/grant.ts"), "utf8");
assert(
  grantSource.includes("globalThis") && grantSource.includes("heytutorTurnGrants"),
  "turn grants must live on globalThis so begin-turn and /api/chat share one Map",
);

const gateSource = readFileSync(resolve(import.meta.dirname, "../../lib/billing/gate.ts"), "utf8");
assert(gateSource.includes("recoverGrantForPaidCall"), "chat grant lookup must remint a lost grant");
assert(gateSource.includes("beginTurnAccess"), "begin-turn must reuse the in-flight grant at $0");
assert(
  gateSource.includes("grantForFollowOnTurn"),
  "Ask a doubt / Explain this must remint when the lecture grant is gone",
);

resetTurnGrantsForTests();
console.log("✓ first Free question is not out of usage; lost grants remint while USD remains");
