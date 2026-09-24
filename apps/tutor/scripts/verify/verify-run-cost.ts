import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sessionObservationsPath } from "../../lib/obs/langfuseQuery";
import {
  aggregateRunCost,
  formatUsd,
  isTtsObservation,
  LECTURE_COST_FOLLOW_MS,
  lectureCostNeedsFetch,
  sumSessionCosts,
  type CostObservation,
} from "../../lib/obs/runCost";
import { calculateLlmCostDetails, calculateTtsCostDetails } from "../../lib/obs/usageCost";
import {
  DEFAULT_FIREWORKS_FAST_MODEL,
  DEFAULT_PROBLEM_IR_MODEL,
} from "../../lib/llm/fireworksModels";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const observations: CostObservation[] = [
  {
    name: "thinking",
    type: "SPAN",
    sessionId: "board-a",
    traceId: "trace-1",
  },
  {
    name: "turn-plan-v3",
    type: "GENERATION",
    sessionId: "board-a",
    traceId: "trace-1",
    model: DEFAULT_FIREWORKS_FAST_MODEL,
    usage: { input: 4_000, output: 800, total: 4_800, unit: "TOKENS" },
  },
  {
    name: "problem-ir-v1",
    type: "GENERATION",
    sessionId: "board-a",
    traceId: "trace-1",
    model: DEFAULT_PROBLEM_IR_MODEL,
    usage: { input: 3_000, output: 500, total: 3_500, unit: "TOKENS" },
  },
  {
    name: "fireworks-llm",
    type: "GENERATION",
    sessionId: "board-a",
    traceId: "trace-1",
    model: DEFAULT_FIREWORKS_FAST_MODEL,
    usage: { input: 10_000, output: 2_000, total: 12_000, unit: "TOKENS" },
  },
  {
    name: "tts-segment",
    type: "GENERATION",
    sessionId: "board-a",
    traceId: "trace-1",
    model: "eleven_multilingual_v2",
    usageDetails: { characters: 2_000 },
  },
  {
    name: "tts-segment",
    type: "GENERATION",
    sessionId: "board-b",
    traceId: "trace-2",
    model: "eleven_flash_v2_5",
    usage: { input: 1_000, output: 0, total: 1_000, unit: "CHARACTERS" },
  },
];

assert(isTtsObservation(observations[4]!), "usageDetails.characters is TTS");
assert(isTtsObservation(observations[5]!), "CHARACTERS unit is TTS");
assert(!isTtsObservation(observations[3]!), "teaching tokens are not TTS");

const report = aggregateRunCost(observations);
const plan = calculateLlmCostDetails(
  { input: 4_000, output: 800 },
  { model: DEFAULT_FIREWORKS_FAST_MODEL },
).total ?? 0;
const ir = calculateLlmCostDetails(
  { input: 3_000, output: 500 },
  { model: DEFAULT_PROBLEM_IR_MODEL },
).total ?? 0;
const teach = calculateLlmCostDetails(
  { input: 10_000, output: 2_000 },
  { model: DEFAULT_FIREWORKS_FAST_MODEL },
).total ?? 0;
const voiceMulti = calculateTtsCostDetails(2_000, { model: "eleven_multilingual_v2" }).total ?? 0;
const voiceFlash = calculateTtsCostDetails(1_000, { model: "eleven_flash_v2_5" }).total ?? 0;

assert(report.totals.traces === 2, `expected 2 traces, got ${report.totals.traces}`);
assert(report.totals.llmObservations === 3, "client spans must not count as LLM usage");
assert(report.totals.ttsObservations === 2, "both TTS segments must count");
assert(report.totals.inputTokens === 17_000, `input tokens ${report.totals.inputTokens}`);
assert(report.totals.outputTokens === 3_300, `output tokens ${report.totals.outputTokens}`);
assert(report.totals.characters === 3_000, `characters ${report.totals.characters}`);
assert(report.totals.llmUsd === plan + ir + teach, `LLM usd ${report.totals.llmUsd} vs ${plan + ir + teach}`);
assert(report.totals.ttsUsd === voiceMulti + voiceFlash, `TTS usd ${report.totals.ttsUsd}`);
assert(
  report.totals.totalUsd === report.totals.llmUsd + report.totals.ttsUsd,
  "total must be AI + voice",
);
assert(voiceMulti === 0.2, "2k multilingual chars are $0.20 on the API table");
assert(voiceFlash === 0.05, "1k Flash chars are $0.05 on the API table");
assert(report.bySession.length === 2, "each board is its own session row");
assert(report.byKind.some((row) => row.name === "fireworks-llm" && row.stream === "llm"), "teaching kind");
assert(report.byKind.some((row) => row.name === "tts-segment" && row.stream === "tts"), "voice kind");
const observationsPath = sessionObservationsPath(
  ["board-a", "board-b"],
  "cursor-1",
  Date.parse("2026-09-24T00:00:00.000Z"),
);
assert(observationsPath.startsWith("/api/public/v2/observations?"), "board costs must use the v2 observations read");
assert(observationsPath.includes("stringOptions"), "many boards share one session filter");
assert(observationsPath.includes("board-a") && observationsPath.includes("board-b"), "the filter lists every board");
assert(!observationsPath.includes("/api/public/traces"), "board costs must not call the rate-limited traces list");
assert(formatUsd(0) === "$0", "zero formats");
assert(formatUsd(1.234) === "$1.23", "dollars use two places");

const cachedReport = aggregateRunCost([
  {
    name: "fireworks-llm",
    type: "GENERATION",
    model: DEFAULT_FIREWORKS_FAST_MODEL,
    usage: { input: 1_000_000, output: 0, total: 1_000_000, unit: "TOKENS" },
    usageDetails: { cachedInput: 1_000_000 },
  },
]);
assert(cachedReport.totals.cachedInputTokens === 1_000_000, "cache hits must be counted separately");
assert(cachedReport.totals.llmUsd === 0.45, "a full Kimi Fast cache hit is $0.45 / 1M");

const unknownReport = aggregateRunCost([
  {
    name: "fireworks-llm",
    type: "GENERATION",
    model: DEFAULT_FIREWORKS_FAST_MODEL,
  },
]);
assert(unknownReport.totals.unknownUsage === 1, "a generation with no usage is unknown");
const notesWithJev = aggregateRunCost([
  {
    name: "notes-chat-llm",
    type: "GENERATION",
    model: DEFAULT_FIREWORKS_FAST_MODEL,
    usage: { input: 8_000, output: 600, total: 8_600, unit: "TOKENS" },
    metadata: { jev_input_tokens: 2_000 },
  },
  {
    name: "tts-segment",
    type: "GENERATION",
    model: "sonic-3.6",
    metadata: { provider: "cartesia" },
    usageDetails: { characters: 1_000 },
  },
]);
const notesAi = calculateLlmCostDetails(
  { input: 8_000, output: 600 },
  { model: DEFAULT_FIREWORKS_FAST_MODEL },
).total ?? 0;
const jevAi = calculateLlmCostDetails({ input: 2_000, output: 0 }, { model: "typesafe-ai/jev" }).total ?? 0;
assert(notesWithJev.totals.llmUsd === notesAi + jevAi, "notes cost must add Jev input, not the Kimi Fast rate");
assert(notesWithJev.totals.ttsUsd === 0.05, "1k Sonic characters are $0.05");
assert(
  notesWithJev.byKind.some((row) => row.name === "jev-evaluation" && row.usd === jevAi),
  "Jev is its own cost row",
);
const jevRow = aggregateRunCost([
  {
    name: "jev-evaluation",
    type: "GENERATION",
    model: "typesafe-ai/jev",
    usage: { input: 2_000, output: 0, total: 2_000, unit: "TOKENS" },
    metadata: { jev_input_tokens: 2_000 },
  },
]);
assert(jevRow.totals.llmUsd === jevAi, "a Jev generation must not also bill its metadata");

assert(unknownReport.totals.llmUsd === 0, "unknown usage must not be given a made-up token price");
assert(unknownReport.totals.llmObservations === 0, "unknown usage is not a measured generation");

const summed = sumSessionCosts(report.bySession);
assert(summed.llmUsd === report.totals.llmUsd, "topic chips sum AI cost across boards");
assert(summed.ttsUsd === report.totals.ttsUsd, "topic chips sum voice cost across boards");
assert(summed.totalUsd === report.totals.totalUsd, "topic chips sum AI + voice");
assert(sumSessionCosts([]).totalUsd === 0, "empty board list sums to zero");

const root = resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

assert(
  read("features/admin/AdminPlayground.tsx").includes("RunCostBox"),
  "the playground must show the run cost box",
);
assert(
  read("features/admin/components/RunCostBox.tsx").includes("formatUsd(totals?.totalUsd"),
  "the box must show the combined AI + voice total",
);
assert(
  read("app/api/admin/run-cost/route.ts").includes("requireAdminRequest"),
  "run-cost is an admin route",
);
assert(
  read("app/api/admin/run-cost/route.ts").includes("fetchRunCostForSessions"),
  "run-cost must read Langfuse observations for the lecture boards",
);
assert(
  read("lib/obs/langfuse.ts").includes("calculateTtsCostDetails(characters, { model, provider })"),
  "TTS Langfuse spans must price the spoken model",
);
assert(
  !read("lib/obs/langfuse.ts").includes("disableTracing"),
  "a Langfuse flush timeout must not disable tracing for the process",
);
assert(
  read("app/api/boards/[boardId]/notes-chat/route.ts").includes("stream_options: { include_usage: true }"),
  "notes-chat must request Fireworks usage for Langfuse",
);
assert(
  read("app/api/boards/[boardId]/notes-chat/route.ts").includes("evaluation.provenance.model"),
  "notes-chat must bill Jev on the Jev rate, not the generator rate",
);
assert(
  read("app/api/extract-question/route.ts").includes('generationName: "qwen-vision"'),
  "photo OCR must land on a Langfuse generation",
);

const costChip = read("features/admin/components/CostChip.tsx");
assert(costChip.includes("cost.totalUsd <= 0"), "cost chips must hide $0 and unloaded totals");
assert(costChip.includes("group-hover/cost:visible"), "cost chips must show the AI/voice tooltip on hover");
assert(costChip.includes("group-focus-within/cost:visible"), "cost chips must show the AI/voice tooltip on focus");
assert(costChip.includes("AI") && costChip.includes("formatUsd(cost.llmUsd)"), "tooltip must show AI inference cost");
assert(costChip.includes("Voice") && costChip.includes("formatUsd(cost.ttsUsd)"), "tooltip must show voice inference cost");

const lectureCosts = read("features/admin/hooks/useLectureCosts.ts");
assert(lectureCosts.includes("BATCH_SIZE = 40"), "lecture costs must batch session ids");
assert(lectureCosts.includes("FAILURE_BACKOFF_MS"), "a failed Langfuse lookup must back off instead of retrying immediately");
assert(lectureCosts.includes("lectureCostNeedsFetch"), "a finished lecture must keep fetching until its cost lands");
assert(lectureCosts.includes("LECTURE_COST_FOLLOW_MS"), "the post-lecture cost check must stay open for several minutes");
const followUntil = 1_000 + LECTURE_COST_FOLLOW_MS;
assert(
  lectureCostNeedsFetch({ running: true, watched: true, priced: false, followUntilMs: null, nowMs: 1_000 }),
  "a running lecture keeps fetching",
);
assert(
  lectureCostNeedsFetch({ running: false, watched: true, priced: false, followUntilMs: followUntil, nowMs: followUntil - 1 }),
  "after a lecture ends the cost keeps loading until the traces land",
);
assert(
  lectureCostNeedsFetch({ running: false, watched: true, priced: true, followUntilMs: followUntil, nowMs: followUntil - 1 }),
  "a late trace can still raise the cost after the lecture ends",
);
assert(
  !lectureCostNeedsFetch({ running: false, watched: true, priced: true, followUntilMs: followUntil, nowMs: followUntil }),
  "a priced lecture stops refetching once the follow window closes",
);
assert(
  !lectureCostNeedsFetch({ running: false, watched: false, priced: true, followUntilMs: followUntil, nowMs: 1_000 }),
  "a lecture that already has a price is not polled again",
);

const topicRow = read("features/admin/components/TopicRow.tsx");
assert(topicRow.includes("<CostChip cost={topicCost}"), "each topic must show a summed cost chip");
assert(topicRow.includes("<CostChip cost={boardId ? costsByBoardId[boardId]"), "each recorded question must show a cost chip");
assert(topicRow.includes("isRecorded || isRunning"), "question cost chips sit with Watch/Notes");

assert(
  read("features/admin/AdminPlayground.tsx").includes("costsByBoardId={costsByBoardId}"),
  "playground must pass Langfuse costs into topic rows",
);
assert(
  read("features/admin/AdminPlayground.tsx").includes("useLectureCosts"),
  "recorded lecture costs must not depend only on the current run job list",
);
assert(
  read("features/admin/components/UnitSection.tsx").includes('expanded ? "overflow-visible"'),
  "expanded units must not clip cost tooltips",
);

console.log("✓ admin run-cost aggregates Langfuse LLM tokens and ElevenLabs characters");
