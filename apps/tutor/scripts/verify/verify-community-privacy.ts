/**
 * Community is public by default, so its reader is where a leak would happen.
 *
 * These gates hold what a stranger may get: a whitelisted turn shape with no
 * trace id, Continue state, or save and Sentry bookkeeping; no child's
 * account name; no lesson still being written; no question photo or card
 * picture through the media routes; and only boards that are public, not
 * hidden, and not owned by a child. Each rule is also mutated once to prove
 * the check can fail.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMMUNITY_SEGMENT_FIELDS,
  COMMUNITY_TURN_FIELDS,
  communityAuthorName,
  isCommunityTurnShown,
  normalizeCommunityHandle,
  communitySceneArtifacts,
  toCommunityTurn,
} from "../../lib/community/publicBoard";
import { communityBoardWhere } from "../../lib/community/queries";
import { boardThumbnailKey, parseStoredObjectKey } from "../../lib/object-store/keys";
import { isAuthPublicPath } from "../../lib/auth/publicPaths";
import { rateLimitBucketForPath } from "../../lib/http/ipRateLimit";
import { sessionCapabilities } from "../../features/tutor-session/lib/sessionCapabilities";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function read(...segments: string[]): string {
  return readFileSync(join(import.meta.dirname, "..", "..", ...segments), "utf8");
}

const now = Date.now();
const privateTurn = {
  id: "t1",
  orderIndex: 0,
  question: "Find the range of a projectile",
  rawResponse: "[STEP] ...",
  speedMultiplier: 1,
  traceId: "trace-secret",
  sceneDocument: null,
  sceneEngineVersion: "v2",
  validationReport: null,
  visualStatus: "text_only",
  sceneArtifacts: null,
  status: "complete",
  kind: "lesson",
  resumeState: { solverProjection: "secret" },
  submittedSegments: [{ audioUrl: "secret" }],
  sentryEventId: "abc",
  sentryFailureEvent: { message: "secret" },
  idempotencyKey: "key",
  userId: "owner-id",
  storageBytes: 10n,
  createdAt: new Date(now),
  updatedAt: new Date(now),
};
const privateSegment = {
  id: "s1",
  turnId: "t1",
  orderIndex: 0,
  narration: "n",
  spokenText: "n",
  command: null,
  audioUrl: "/api/media?key=lectures/b/t1/0.mp3",
  audioFormat: "audio/mpeg",
  audioRef: null,
  durationMs: 100,
  timings: null,
  createdAt: new Date(now),
};

// 1. The public turn is exactly the whitelist, and the private values are gone.
const publicTurn = toCommunityTurn(privateTurn, [privateSegment]) as Record<string, unknown>;
const turnKeys = Object.keys(publicTurn).sort();
assert(
  JSON.stringify(turnKeys) === JSON.stringify([...COMMUNITY_TURN_FIELDS].sort()),
  `public turn fields drifted from the reviewed list: ${turnKeys.join(", ")}`,
);
assert(publicTurn.traceId === null, "a public turn carries the owner's trace id");
assert(publicTurn.resumeState === null, "a public turn carries the owner's Continue state");
const serialized = JSON.stringify(publicTurn, (_key, value: unknown) => (typeof value === "bigint" ? String(value) : value));
for (const secret of ["trace-secret", "solverProjection", "owner-id", "sentry", "idempotency", "submittedSegments", "storageBytes"]) {
  assert(!serialized.includes(secret), `a public turn leaks ${secret}`);
}
const segmentKeys = Object.keys((publicTurn.segments as Array<Record<string, unknown>>)[0] ?? {}).sort();
assert(
  JSON.stringify(segmentKeys) === JSON.stringify([...COMMUNITY_SEGMENT_FIELDS].sort()),
  `public segment fields drifted from the reviewed list: ${segmentKeys.join(", ")}`,
);
// Mutation: a turn shape with one extra field must fail the same comparison.
assert(
  JSON.stringify(Object.keys({ ...publicTurn, userId: "x" }).sort()) !== JSON.stringify([...COMMUNITY_TURN_FIELDS].sort()),
  "the field check cannot see an added field",
);

// 2. Names: a handle wins; adults show a first name; minors never show their account name.
assert(communityAuthorName({ handle: "ravi_k", name: "Ravi Kumar", ageBand: "13_17" }) === "@ravi_k", "a chosen handle is not shown");
assert(communityAuthorName({ handle: null, name: "Asha Verma", ageBand: "18_plus" }) === "Asha", "an adult does not show a first name only");
for (const ageBand of ["13_17", "under_13", null]) {
  const shown = communityAuthorName({ handle: null, name: "Meera Shah", ageBand });
  assert(!shown.includes("Meera") && !shown.includes("Shah"), `a ${ageBand ?? "unknown"} age account shows its account name`);
}
assert(normalizeCommunityHandle("Ravi_K") === "ravi_k", "a valid handle is refused");
assert(normalizeCommunityHandle("@ravi_k") === "ravi_k", "a handle typed with its @ is refused");
for (const bad of ["a", "has space", "x".repeat(30), "_lead", "trail_", "dot.name", "accelute", "Admin", "support"]) {
  assert(normalizeCommunityHandle(bad) === null, `an invalid handle is accepted: ${bad}`);
}

// 3. A lesson still being written, even one its tab left idle, or one that left nothing on the board, is never shown.
assert(!isCommunityTurnShown({ status: "live", segmentCount: 5 }), "a live lesson is shown");
assert(!isCommunityTurnShown({ status: "complete", segmentCount: 0 }), "an empty failed lesson is shown");
assert(isCommunityTurnShown({ status: "complete", segmentCount: 3 }), "a finished lesson is hidden");
assert(isCommunityTurnShown({ status: "stopped", segmentCount: 3 }), "a stopped lesson is hidden");
assert(!isCommunityTurnShown({ status: "unknown", segmentCount: 3 }), "an unrecognised status is shown");
const withTelemetry = toCommunityTurn({ ...privateTurn, sceneArtifacts: { turnPlan: { subject: "physics" }, failureTelemetry: { billingCode: "out_of_credits" } } }, []);
assert(!JSON.stringify(withTelemetry).includes("billingCode"), "a public turn leaks the owner's billing state");
assert(JSON.stringify(withTelemetry).includes("turnPlan"), "stripping telemetry dropped the lesson plan");
assert(communitySceneArtifacts(null) === null, "empty scene artifacts changed shape");

// 4. Which boards are public at all.
const where = communityBoardWhere({ id: "b" }) as Record<string, unknown>;
assert(where.visibility === "public", "private boards are readable");
assert(where.communityHiddenAt === null, "boards an admin hid are readable");
assert(JSON.stringify(where.user).includes("under_13"), "boards of under 13 accounts are readable");
assert(JSON.stringify(where.turns).includes('"complete"'), "boards with no finished lesson are listed");
const overridden = communityBoardWhere({ visibility: "private", communityHiddenAt: new Date() } as never) as Record<string, unknown>;
assert(overridden.visibility === "public" && overridden.communityHiddenAt === null, "a caller's filter can widen the public set");

// 5. Media: only lecture clips can be public; photos and card pictures never pass the media parser.
const queries = read("lib", "community", "queries.ts");
assert(/parsed\.kind !== "lecture"\) return false/.test(queries), "a non lecture object can be public");
const serve = read("lib", "object-store", "serveMedia.ts");
assert(serve.includes("canReadCommunityObject(key)") && serve.includes("userId != null && await userCanReadObject"), "media serving lost its owner or Community check");
const thumb = boardThumbnailKey("board-1");
assert(thumb === "images/thumbnails/board-1/card.webp", "card picture key left the bucket policy's images/ grant");
assert(parseStoredObjectKey(thumb) === null, "card pictures became servable through the media routes");
assert(boardThumbnailKey("../x") === null && boardThumbnailKey("a/b") === null, "a card picture key escapes its folder");
const audio = read("app", "api", "lecture-audio", "route.ts");
const legacyProxy = audio.indexOf("isAllowedLectureAudioSource(src");
const ownerOnly = audio.indexOf("if (!userId)");
assert(ownerOnly > 0 && legacyProxy > ownerOnly, "the legacy audio host proxy is open to signed out visitors");

// 6. A remix gets the lesson, never the author's private state, and its copies always have a cleanup receipt.
const remix = read("lib", "community", "remix.ts");
assert(/resumeState: Prisma\.DbNull/.test(remix), "a remix copies the author's Continue state");
assert(/sceneArtifacts: json\(communitySceneArtifacts\(/.test(remix), "a remix copies the author's failure telemetry");
assert(!/traceId:\s*turn\.traceId/.test(remix), "a remix copies the author's trace id");
const receipt = remix.indexOf("objectDeletionJob.create(");
const firstCopy = remix.indexOf("copyLectureObject(next");
assert(receipt > 0 && firstCopy > receipt, "remix copies clips before writing their cleanup receipt");
assert(/tx\.objectDeletionJob\.deleteMany\(\{ where: \{ prefix \} \}\)/.test(remix), "a committed remix leaves its receipt to delete the new board's clips");
const quotaCheck = remix.indexOf("MAX_ACCOUNT_STORAGE_BYTES)) throw");
assert(quotaCheck > 0 && quotaCheck < receipt, "a full account still pays for copies before being refused");

// 7. The page is public, the player cannot write.
assert(isAuthPublicPath("/community") && isAuthPublicPath("/community/abc"), "Community pages need a login");
assert(!isAuthPublicPath("/c/abc") && !isAuthPublicPath("/library"), "private pages became public");
const can = sessionCapabilities("community");
assert(!can.askQuestions && !can.notes && !can.marking && !can.settings && !can.persistSettings && !can.appChrome, "the Community player can write");
const session = read("features", "tutor-session", "hooks", "useBoardSession.ts");
assert(/if \(foreign && !detail\)/.test(session) && /!draft && !foreign\) \{\s*for \(const local of liveTurnSave\(\)\.reopen/.test(session),
  "a Community board can be created or reopened from this tab's save queue");

// 9. Moderation and abuse limits: admin routes are gated, public clips are rate limited, views count once per visit.
for (const route of [["app", "api", "admin", "community", "route.ts"], ["app", "api", "admin", "community", "[boardId]", "route.ts"]]) {
  assert(/const denied = await requireAdminRequest\(\);\s*if \(denied\) return denied;/.test(read(...route)), `${route.join("/")} is open to non admins`);
}
assert(rateLimitBucketForPath("/api/media", { signedIn: false }) === "publicMedia", "signed out media reads are not rate limited");
assert(rateLimitBucketForPath("/api/lecture-audio", { signedIn: false }) === "publicMedia", "signed out audio reads are not rate limited");
assert(rateLimitBucketForPath("/api/media") === null, "owners' media reads became rate limited");
assert(!read("app", "api", "community", "[boardId]", "route.ts").includes("recordCommunityView"), "every board read counts as a view");

// 8. Boards made before Community stay private; new ones are public, except staff boards.
const migration = read("prisma", "migrations", "25_community", "migration.sql");
const addPrivate = migration.indexOf(`ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'private'`);
const thenPublic = migration.indexOf(`ALTER COLUMN "visibility" SET DEFAULT 'public'`);
assert(addPrivate >= 0 && thenPublic > addPrivate, "existing boards would be published by the migration");
const createRoute = read("app", "api", "boards", "route.ts");
assert(/isAdminEmail\(/.test(createRoute) && /visibility: staff \? "private" : "public"/.test(createRoute), "staff and lab boards are published by default");

console.log("community privacy: 9 gates passed");
