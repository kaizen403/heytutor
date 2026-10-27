/**
 * Probe an OpenAI compatible relay (`LLM_PROVIDER=openai_compat`) before any
 * lab round: which parameters each upstream accepts, whether token caps hold,
 * whether the real turn planner prompt still returns a plan our parser takes,
 * and how a teaching stream starts and ends.
 *
 *   node --env-file=.env.local --import tsx scripts/latency/compat-probe.ts \
 *     --out ../../.context/compat-probe.json
 *
 * A relay can balance one model across several upstreams, so every check runs
 * `--repeat` times (default 3) and is reported per upstream. About 40 small
 * calls; the turn plans are the only large ones.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  parseTurnPlanV3Content,
  TURN_PLAN_V3_PROMPT,
} from "../../../../packages/tutor-core/src/planners/turnPlannerV3";
import { providerChatBody, relayUpstreamKind, resolveLlmEndpoint } from "../../lib/llm/llmProvider";
import { resolvePlannerMaxTokens } from "../../lib/llm/plannerTransport";
import { parseProviderUsage } from "../../lib/obs/providerUsage";

const value = (flag: string, fallback: string) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
};
const repeat = Math.max(1, Number.parseInt(value("--repeat", "3"), 10) || 3);
const out = value("--out", "");

const endpoint = resolveLlmEndpoint({ ...process.env, OPENAI_COMPAT_FALLBACK: "off" });
if (endpoint.provider !== "openai_compat" || !endpoint.apiKey || !endpoint.deployment) {
  console.error("compat probe needs LLM_PROVIDER=openai_compat with OPENAI_COMPAT_BASE_URL, OPENAI_COMPAT_API_KEY and OPENAI_COMPAT_MODEL");
  process.exit(2);
}
const model = endpoint.deployment;

interface Call {
  check: string;
  status: number;
  upstream: string;
  ms: number;
  usage: ReturnType<typeof parseProviderUsage>;
  content: string;
  error?: string;
}

async function call(check: string, body: Record<string, unknown>): Promise<Call> {
  const started = Date.now();
  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${endpoint.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model, ...body }),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await response.text();
    const ms = Date.now() - started;
    let parsed: { id?: unknown; usage?: unknown; choices?: { message?: { content?: string } }[]; error?: { message?: string } } = {};
    try { parsed = JSON.parse(text); } catch { /* reported below */ }
    return {
      check, status: response.status, upstream: relayUpstreamKind(parsed.id), ms,
      usage: parseProviderUsage(parsed.usage), content: parsed.choices?.[0]?.message?.content ?? "",
      ...(response.ok ? {} : { error: (parsed.error?.message ?? text).slice(0, 200) }),
    };
  } catch (error) {
    return { check, status: 0, upstream: "unknown", ms: Date.now() - started, usage: { known: false }, content: "", error: String(error).slice(0, 200) };
  }
}

const say = [{ role: "user", content: "Say ok" }];
const poem = [{ role: "user", content: "Write a 60 word poem about rain." }];

/** Raw parameters: what the relay accepts, per upstream. */
const parameterChecks: [string, Record<string, unknown>][] = [
  ["temperature 0", { messages: say, temperature: 0 }],
  ["max_tokens", { messages: say, max_tokens: 64 }],
  ...["none", "minimal", "low", "medium", "high"].map((effort) =>
    [`reasoning_effort ${effort}`, { messages: say, reasoning_effort: effort }] as [string, Record<string, unknown>]),
  ["thinking disabled", { messages: say, thinking: { type: "disabled" } }],
  ["perf_metrics_in_response", { messages: say, perf_metrics_in_response: true }],
  ["n 2", { messages: say, n: 2 }],
  ["json_schema strict", { messages: [{ role: "user", content: "Is 7 prime?" }], response_format: { type: "json_schema", json_schema: {
    name: "answer", strict: true, schema: { type: "object", properties: { prime: { type: "boolean" } }, required: ["prime"], additionalProperties: false },
  } } }],
];

/** Caps: a reply that ignores them makes spend reservations an estimate only. */
const capChecks: [string, Record<string, unknown>][] = [
  ["max_tokens 16 on a poem", { messages: poem, max_tokens: 16 }],
  ["max_completion_tokens 16 on a poem", { messages: poem, max_completion_tokens: 16, reasoning_effort: "low" }],
];

const PLAN_QUESTIONS = [
  "A 5 kg block slides down a 30 degree incline with coefficient of friction 0.2. Find its acceleration.",
  "Solve the simultaneous equations 2x + 3y = 12 and x - y = 1.",
  "A ball is thrown horizontally at 12 m/s from a cliff 45 m high. How far from the base does it land? Take g = 10.",
];

function plannerBody(question: string): Record<string, unknown> {
  // The body the chat route builds for a primary turn plan, then the relay translation.
  return providerChatBody({
    messages: [{ role: "system", content: TURN_PLAN_V3_PROMPT }, { role: "user", content: `QUESTION\n${question}` }],
    n: 1,
    temperature: 0,
    thinking: { type: "disabled" },
    max_tokens: resolvePlannerMaxTokens({ semanticSceneV2: false, turnPlanV3: true, plannerPhase: "plan", plannerLane: "primary", fastMode: false }),
    stream: false,
    response_format: { type: "json_object" },
  }, endpoint);
}

async function teachingStream(): Promise<Record<string, unknown>> {
  const body = providerChatBody({
    messages: [{ role: "user", content: "Explain Newton's second law to a 15 year old in about 120 words." }],
    n: 1, temperature: 0.3, stream: true, stream_options: { include_usage: true },
    thinking: { type: "disabled" }, max_tokens: 3600,
  }, endpoint);
  const started = Date.now();
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${endpoint.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, ...body }),
    signal: AbortSignal.timeout(120_000),
  });
  let firstContentMs: number | null = null;
  let text = "";
  let usage: unknown;
  let done = false;
  let upstream = "unknown";
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += chunk.value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.trim().startsWith("data:") ? line.trim().slice(5).trim() : "";
      if (!data) continue;
      if (data === "[DONE]") { done = true; continue; }
      const event = JSON.parse(data) as { id?: unknown; usage?: unknown; choices?: { delta?: { content?: string } }[] };
      if (upstream === "unknown") upstream = relayUpstreamKind(event.id);
      if (event.usage) usage = event.usage;
      const piece = event.choices?.[0]?.delta?.content ?? "";
      if (piece && firstContentMs === null) firstContentMs = Date.now() - started;
      text += piece;
    }
  }
  return { status: response.status, upstream, firstContentMs, totalMs: Date.now() - started, words: text.split(/\s+/).filter(Boolean).length, done, usage: parseProviderUsage(usage) };
}

function summarize(calls: Call[]) {
  const byCheck = new Map<string, Call[]>();
  for (const row of calls) byCheck.set(row.check, [...(byCheck.get(row.check) ?? []), row]);
  return [...byCheck].map(([check, rows]) => ({
    check,
    results: rows.map((row) => `${row.upstream}:${row.status}`).join(" "),
    medianMs: rows.map((row) => row.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
    outputTokens: rows.map((row) => row.usage.output ?? "?").join(" "),
    inputTokens: rows.map((row) => row.usage.input ?? "?").join(" "),
    error: rows.find((row) => row.error)?.error ?? "",
  }));
}

async function main() {
  console.log(`relay ${new URL(endpoint.url).host}, model ${model}, ${repeat} runs per check`);
  const runs = (checks: [string, Record<string, unknown>][]) =>
    Promise.all(checks.flatMap(([check, body]) => Array.from({ length: repeat }, () => call(check, body))));
  const parameters = await runs(parameterChecks);
  console.table(summarize(parameters));
  const caps = await runs(capChecks);
  console.table(summarize(caps));

  const plans = await Promise.all(PLAN_QUESTIONS.flatMap((question) => Array.from({ length: repeat }, async () => {
    const row = await call(`plan: ${question.slice(0, 40)}`, plannerBody(question));
    let json = false;
    try { JSON.parse(row.content); json = true; } catch { /* not JSON */ }
    const plan = row.content ? parseTurnPlanV3Content(row.content, question) : null;
    return { ...row, json, planValid: plan !== null, contentChars: row.content.length };
  })));
  console.table(plans.map(({ check, status, upstream, ms, json, planValid, contentChars, usage }) =>
    ({ check, status, upstream, ms, json, planValid, contentChars, input: usage.input, cached: usage.cachedInput, output: usage.output })));

  const streams = [];
  for (let i = 0; i < repeat; i += 1) streams.push(await teachingStream());
  console.table(streams.map((row) => ({ ...row, usage: JSON.stringify(row.usage) })));

  const valid = plans.filter((row) => row.planValid).length;
  console.log(`turn plans valid ${valid}/${plans.length}`);
  if (out) {
    const path = resolve(out);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), host: new URL(endpoint.url).host, model, repeat,
      parameters, caps, plans: plans.map(({ content, ...row }) => ({ ...row, contentHead: content.slice(0, 300) })), streams }, null, 2));
    console.log(`wrote ${path}`);
  }
}

void main();
