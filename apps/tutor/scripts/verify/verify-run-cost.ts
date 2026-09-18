import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  aggregateRunCost,
  formatUsd,
  isTtsObservation,
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
assert(formatUsd(0) === "$0", "zero formats");
assert(formatUsd(1.234) === "$1.23", "dollars use two places");

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
  read("lib/obs/langfuse.ts").includes("calculateTtsCostDetails(characters, { model })"),
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
  read("app/api/extract-question/route.ts").includes('generationName: "qwen-vision"'),
  "photo OCR must land on a Langfuse generation",
);

console.log("✓ admin run-cost aggregates Langfuse LLM tokens and ElevenLabs characters");
