import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { withPrismaPoolLimits } from "../../lib/db/databaseUrl";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

const sessionRoutes: Array<[string, string]> = [
  ["app/api/chat/route.ts", "requireLessonGrant"],
  ["app/api/dsa-teaching-policy/route.ts", "requireLessonGrant"],
  ["app/api/visual-need/route.ts", "requireLessonGrant"],
  ["lib/tts/handleTtsRequest.ts", "requireLessonGrant"],
  ["app/api/tts/ws-ticket/route.ts", "requireSpendActor"],
  ["app/api/stt/route.ts", "requireLessonCredits"],
  ["app/api/extract-question/route.ts", "requireLessonCredits"],
  ["app/api/board-name/route.ts", "requireSpendActor"],
  ["app/api/boards/[boardId]/notes-chat/route.ts", "requireNotesAccess"],
];

for (const [file, gate] of sessionRoutes) {
  const source = read(file);
  assert(!source.includes("getUserId("), `${file} must not spend against htutor_uid via getUserId`);
  assert(source.includes(gate), `${file} must call ${gate}`);
}

const chat = read("app/api/chat/route.ts");
assert(chat.includes("recordLlmSpend"), "chat must track llm_tokens after usage");
const tts = read("lib/tts/handleTtsRequest.ts");
assert(tts.includes("consumeTtsChars"), "HTTP TTS must decrement the grant budget");
assert(tts.includes("ttsSkippedResponse"), "HTTP TTS must skip ElevenLabs at the budget");
const ws = read("server.ts");
assert(ws.includes("readWsTicket"), "WS TTS must auth from the session ticket");
assert(ws.includes("isAuthDisabled"), "WS must not take htutor_uid when auth is on");
assert(ws.includes("tts_budget"), "WS TTS must skip when the grant budget is gone");
assert(ws.includes("if (!grant)"), "WS TTS must destroy the socket when the grant is missing");
assert(!ws.includes("autumn is off, continuing"), "WS TTS must not synthesize without a grant");
assert(ws.includes("TTS_WS_IDLE_MS"), "WS TTS must idle-timeout the relay");
assert(ws.includes("ttsWsCharsWithinCeiling"), "WS TTS must cap characters per connection");
assert(ws.includes("tryAcquireTtsWsConnection"), "WS TTS must cap concurrent sockets per user");
const ttsClient = readFileSync(
  resolve(root, "../../packages/tutor-core/src/tts/streamingSpeechClient.ts"),
  "utf8",
);
assert(
  ttsClient.includes('payload.type === "skip"'),
  "a relay skip must fail the WS job so HTTP/speech can start the lecture",
);
assert(
  ttsClient.includes("websocket ticket unavailable"),
  "auth-on production must not open a doomed TTS socket without a ticket",
);
assert(
  ttsClient.includes("NEXT_PUBLIC_AUTH_DISABLED"),
  "the TTS client must treat tickets as required unless AUTH_DISABLED is explicit",
);
assert(
  ttsClient.includes('fetch(resolveApiUrl("/api/tts/ws-ticket")'),
  "the TTS client must mint a WS ticket",
);
assert(
  !ttsClient.includes("if (!isCrossOriginWebSocket())"),
  "same-origin AUTH_REQUIRED production must still send the TTS ticket or the relay destroys the lecture socket",
);
assert(
  read("lib/db/prisma.ts").includes("globalForPrisma.prisma = prisma"),
  "prisma must stay on globalThis in production so Neon is not opened per chunk",
);
assert(
  read("lib/db/prisma.ts").includes("withPrismaPoolLimits"),
  "Neon URLs must get connection_limit/pool_timeout so hung queries fail closed",
);

const beginTurn = read("app/api/billing/begin-turn/route.ts");
assert(beginTurn.includes("beginTurnFromRequest"), "begin-turn must run the grant + Autumn gate");
assert(beginTurn.includes("remainingPct"), "begin-turn returns remainingPct");
assert(read("app/api/billing/webhook/route.ts").includes("verifyAutumnWebhookSignature"), "webhook verifies signatures");
assert(read("app/api/billing/webhook/route.ts").includes("addPeriodBonusUsd"), "webhook top-up adds USD bonus");
assert(read("app/api/billing/checkout/route.ts").includes("attachCheckoutPlan"), "checkout route exists");
assert(read("app/api/billing/top-up/route.ts").includes("attachTopUp"), "top-up route exists");
assert(read("app/api/billing/portal/route.ts").includes("openBillingPortal"), "portal route exists");
assert(read("app/api/billing/entitlement/route.ts").includes("remainingPct"), "entitlement returns remainingPct");
assert(!read("lib/billing/gate.ts").includes("trackFeature"), "begin-turn must not track Autumn lessons");
assert(read("lib/billing/track.ts").includes("addPeriodSpend"), "LLM/TTS add estimated USD to the period ledger");
assert(read("lib/billing/gate.ts").includes("recoverGrantForPaidCall"), "paid routes remint a lost grant while USD remains");
assert(read("lib/billing/grant.ts").includes("heytutorTurnGrants"), "grants survive Next.js route recompile");

const handler = read("features/tutor-session/hooks/turn/useQuestionHandler.ts");
assert(handler.includes("beginTurn("), "the live turn must request a grant before planners");

const lab = read("scripts/lecture-lab/run.ts");
assert(lab.includes("applyLectureLabHeaders"), "lecture-lab must send the shared-secret header");
assert(
  read("scripts/lecture-lab/labAuth.ts").includes("LECTURE_LAB_TOKEN"),
  "lecture-lab must read LECTURE_LAB_TOKEN instead of a literal 1",
);

const signedIn = read("lib/auth/signedInUser.ts");
assert(signedIn.includes("attachFreePlan"), "first login attaches Free");
assert(read("lib/billing/actor.ts").includes("requireSessionUserId"), "spend identity is the Auth.js session");
assert(read("lib/billing/actor.ts").includes("embed is read-only"), "embed referers must not spend");

const langfuse = read("lib/obs/langfuse.ts");
assert(
  langfuse.includes("calculateLlmCostDetails(usageDetails, { model: model ?? turn.model })"),
  "Langfuse must cost generations with the actual model, not a flat Fireworks table",
);
assert(
  langfuse.includes("calculateTtsCostDetails(characters, { model, provider })"),
  "Langfuse TTS cost must follow the ElevenLabs model, not a flat Flash rate",
);
assert(
  read("app/api/admin/run-cost/route.ts").includes("fetchRunCostForSessions"),
  "admin run-cost must query Langfuse observations",
);
assert(
  read("app/api/boards/[boardId]/notes-chat/route.ts").includes("include_usage: true"),
  "notes-chat must send Fireworks usage to Langfuse",
);

const pooled = withPrismaPoolLimits("postgresql://u:p@host/db?sslmode=require");
assert(pooled.includes("connection_limit=5"), "pooled URL sets connection_limit");
assert(pooled.includes("pool_timeout=10"), "pooled URL sets pool_timeout");
assert(
  withPrismaPoolLimits("postgresql://u:p@host/db?connection_limit=3").includes("connection_limit=3"),
  "an existing connection_limit must not be overwritten",
);

console.log("✓ paid routes require session grants; Autumn checkout/webhook/begin-turn are wired");
