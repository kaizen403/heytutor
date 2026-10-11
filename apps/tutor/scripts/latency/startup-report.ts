/**
 * Ask to first voice, stage by stage.
 *
 * Reads turn telemetry back out of Langfuse (the client marks and spans that
 * `lib/obs/turnTelemetry.ts` sends) or out of a lecture-lab round, and prints
 * one table per turn: when each stage started after the Ask click, how long it
 * took, whether it ran into its deadline, and which retries or hedges fired.
 * Several turns also get p50 and p90 per stage.
 *
 *   LANGFUSE_HOST=… LANGFUSE_PUBLIC_KEY=… LANGFUSE_SECRET_KEY=… \
 *     pnpm --filter @heytutor/tutor exec tsx scripts/latency/startup-report.ts <traceId> [<traceId> …]
 *   … startup-report.ts --since 2026-10-01T00:00:00Z [--limit 50]
 *   … startup-report.ts --lab .lecture-lab/round-01
 *
 * Trace ids are the ids Langfuse shows; the server scopes the client's id by
 * user before it lands there. Nothing here prints question text.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  PROBLEM_AUTHORITY_DEADLINE_MS,
  SCENE_PLANNER_DEADLINE_MS,
  TURN_PLAN_DEADLINE_MS,
} from "../../features/tutor-session/lib/scene/diagramGeneration";

export interface StageRow {
  name: string;
  /** Milliseconds after the Ask click the stage began; null when unknown. */
  startMs: number | null;
  durationMs: number | null;
  capMs: number | null;
  hitCap: boolean;
}

export interface TurnLatency {
  id: string;
  source: "langfuse" | "lab";
  /** How the Ask origin was found; `earliest-event` means no startup-ask mark. */
  origin: "startup-ask" | "earliest-event" | "lab";
  askToFirstAudibleMs: number | null;
  stages: StageRow[];
  /** Retry, hedge and recovery events, with counts. */
  retries: string[];
}

/** The deadline each stage races. A stage at or past it was cut off. */
export const STAGE_CAPS_MS: Readonly<Record<string, number>> = {
  planner: SCENE_PLANNER_DEADLINE_MS,
  "scene-planner": SCENE_PLANNER_DEADLINE_MS,
  "turn-plan": TURN_PLAN_DEADLINE_MS,
  "problem-ir": PROBLEM_AUTHORITY_DEADLINE_MS,
};

/** Slack under the cap that still counts as hitting it (timer jitter). */
const CAP_SLACK_MS = 250;

/** Startup spans, in pipeline order. */
const SPAN_STAGES = [
  "thinking",
  "websocket-connect",
  "planner",
  "turn-plan",
  "problem-ir",
  "deterministic-figure",
  "scene-planner",
  "revalidate",
] as const;

/** Startup marks: a point in time after Ask, no duration of their own. */
const MARK_STAGES = [
  "scene-speculative-start",
  "scene-speculative-abort",
  "teaching-request",
  "teaching-hedge-start",
  "teaching-first-token",
  "teaching-hedge-winner",
  "teaching-first-step",
  "early-lesson-opening-queued",
  "figure-outcome-decision",
  "figure-committed",
  "verified-scene-intro-queued",
  "tts-first-byte",
  "first-audible",
] as const;

const RETRY_PATTERN = /retry|hedge|recovery|repair|continuation/i;

interface ObservationLike {
  name?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  metadata?: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function timeMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Explicit cap flags a stage may report in its metadata. */
function metadataSaysCapped(metadata: Record<string, unknown>): boolean {
  for (const key of ["timed_out", "timeout", "capped", "deadline_hit", "hit_cap"]) {
    if (metadata[key] === true) return true;
  }
  for (const key of ["outcome", "reason", "status", "phase"]) {
    const value = metadata[key];
    if (typeof value === "string" && /timeout|timed_out|deadline/i.test(value)) return true;
  }
  return false;
}

function stageRow(
  name: string,
  startMs: number | null,
  durationMs: number | null,
  metadata: Record<string, unknown> = {},
): StageRow {
  const capMs = STAGE_CAPS_MS[name] ?? null;
  const overCap = capMs !== null && durationMs !== null && durationMs >= capMs - CAP_SLACK_MS;
  return {
    name,
    startMs: startMs === null ? null : Math.round(startMs),
    durationMs: durationMs === null ? null : Math.round(durationMs),
    capMs,
    hitCap: overCap || metadataSaysCapped(metadata),
  };
}

function countRetries(names: string[], hedgeWinner: string | null): string[] {
  const counts = new Map<string, number>();
  for (const name of names) {
    if (RETRY_PATTERN.test(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) =>
    `${name} x${count}${name === "teaching-hedge-winner" && hedgeWinner ? ` (${hedgeWinner})` : ""}`,
  );
}

/**
 * One Langfuse trace (`GET /api/public/traces/{id}`) to a turn. Null when the
 * trace carries no startup telemetry at all (a TTS-only or admin trace).
 */
export function parseLangfuseTrace(trace: { id?: unknown; observations?: unknown }): TurnLatency | null {
  const observations = (Array.isArray(trace.observations) ? trace.observations : []) as ObservationLike[];
  const byName = new Map<string, ObservationLike[]>();
  for (const observation of observations) {
    if (typeof observation.name !== "string") continue;
    const list = byName.get(observation.name) ?? [];
    list.push(observation);
    byName.set(observation.name, list);
  }
  const first = (name: string): ObservationLike | null => {
    const list = byName.get(name);
    if (!list?.length) return null;
    return [...list].sort((a, b) => (timeMs(a.startTime) ?? 0) - (timeMs(b.startTime) ?? 0))[0]!;
  };

  const known = [...SPAN_STAGES, ...MARK_STAGES, "startup-ask"].some((name) => byName.has(name));
  if (!known) return null;

  const startupAsk = first("startup-ask");
  const askMeta = record(startupAsk?.metadata);
  const askMarkAt = timeMs(startupAsk?.startTime);
  const preTelemetryMs = num(askMeta.pre_telemetry_ms);
  let originAt: number;
  let origin: TurnLatency["origin"];
  if (askMarkAt !== null && preTelemetryMs !== null) {
    originAt = askMarkAt - preTelemetryMs;
    origin = "startup-ask";
  } else {
    const starts = observations.map((observation) => timeMs(observation.startTime)).filter((ms): ms is number => ms !== null);
    originAt = starts.length > 0 ? Math.min(...starts) : 0;
    origin = "earliest-event";
  }

  const stages: StageRow[] = [];
  if (startupAsk) {
    for (const [field, name] of [
      ["queued_for_board_ms", "queued-for-board"],
      ["board_commit_ms", "board-commit"],
      ["begin_turn_ms", "begin-turn"],
      ["board_epoch_ms", "board-epoch"],
      ["pre_telemetry_ms", "pre-telemetry"],
    ] as const) {
      const value = num(askMeta[field]);
      if (value !== null) stages.push(stageRow(name, null, value));
    }
  }
  for (const name of SPAN_STAGES) {
    const span = first(name);
    if (!span) continue;
    const start = timeMs(span.startTime);
    const end = timeMs(span.endTime);
    stages.push(stageRow(
      name,
      start === null ? null : start - originAt,
      start !== null && end !== null ? end - start : null,
      record(span.metadata),
    ));
  }
  for (const name of MARK_STAGES) {
    const mark = first(name);
    if (!mark) continue;
    const at = timeMs(mark.startTime);
    const metadata = record(mark.metadata);
    // First byte reports its own request to bytes span; the rest are points.
    const duration = name === "tts-first-byte" ? num(metadata.since_request_ms) : null;
    stages.push(stageRow(name, at === null ? null : at - originAt, duration, metadata));
  }

  const firstAudible = first("first-audible");
  const audibleMeta = record(firstAudible?.metadata);
  const audibleAt = timeMs(firstAudible?.startTime);
  const askToFirstAudibleMs = audibleMeta.muted === true ? null : num(audibleMeta.since_ask_ms) ??
    (audibleAt !== null && origin === "startup-ask" ? Math.round(audibleAt - originAt) : null);

  const winner = record(first("teaching-hedge-winner")?.metadata).winner;
  return {
    id: typeof trace.id === "string" ? trace.id : "unknown",
    source: "langfuse",
    origin,
    askToFirstAudibleMs,
    stages,
    retries: countRetries(
      observations.map((observation) => (typeof observation.name === "string" ? observation.name : "")),
      typeof winner === "string" ? winner : null,
    ),
  };
}

/**
 * A lecture-lab `runs/*.json` record. `timings.stages` is optional and may be
 * a map of stage to milliseconds (or to `{ ms | durationMs, startMs, capped }`)
 * or a list of `{ name, ms | durationMs, startMs, capped }`.
 */
export function parseLabRun(run: unknown, fallbackId = "run"): TurnLatency | null {
  const body = record(run);
  const timings = record(body.timings);
  if (Object.keys(timings).length === 0) return null;
  const stages: StageRow[] = [];
  for (const [field, name] of [["planMs", "plan"], ["teachMs", "teach"], ["totalMs", "total"]] as const) {
    const value = num(timings[field]);
    if (value !== null) stages.push(stageRow(name, null, value));
  }
  const rawStages = timings.stages;
  const entries: Array<[string, unknown]> = Array.isArray(rawStages)
    ? rawStages.map((entry) => [String(record(entry).name ?? "stage"), entry])
    : Object.entries(record(rawStages));
  let askToFirstAudibleMs = num(timings.firstAudibleMs) ?? num(timings.askToFirstAudibleMs);
  for (const [name, value] of entries) {
    const entry = record(value);
    const duration = num(value) ?? num(entry.ms) ?? num(entry.durationMs);
    const start = num(entry.startMs) ?? num(entry.sinceAskMs);
    if (name === "first-audible" || name === "firstAudible") {
      askToFirstAudibleMs = askToFirstAudibleMs ?? start ?? duration;
    }
    const capped = entry.capped === true || entry.hitCap === true || entry.timedOut === true;
    stages.push(stageRow(name, start, duration, capped ? { capped: true } : {}));
  }
  const retryNames = Array.isArray(timings.retries)
    ? timings.retries.filter((name): name is string => typeof name === "string")
    : [];
  return {
    id: typeof body.probeId === "string" ? body.probeId : fallbackId,
    source: "lab",
    origin: "lab",
    askToFirstAudibleMs,
    stages,
    retries: countRetries(entries.map(([name]) => name).concat(retryNames), null),
  };
}

export function readLabRound(dir: string): TurnLatency[] {
  const runsDir = join(resolve(process.cwd(), dir), "runs");
  return readdirSync(runsDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .flatMap((file) => {
      const parsed = parseLabRun(JSON.parse(readFileSync(join(runsDir, file), "utf8")), file.replace(/\.json$/, ""));
      return parsed ? [parsed] : [];
    });
}

/** Nearest rank: the smallest value with at least `p` of the sample at or below it. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

export interface StageSummary {
  name: string;
  count: number;
  p50: number | null;
  p90: number | null;
  capHits: number;
}

export function summarizeTurns(turns: TurnLatency[]): { askToFirstAudible: StageSummary; stages: StageSummary[] } {
  const audible = turns.map((turn) => turn.askToFirstAudibleMs).filter((ms): ms is number => ms !== null);
  const order: string[] = [];
  const values = new Map<string, number[]>();
  const caps = new Map<string, number>();
  for (const turn of turns) {
    for (const stage of turn.stages) {
      if (!values.has(stage.name)) {
        order.push(stage.name);
        values.set(stage.name, []);
      }
      // A mark's offset after Ask is its number; a span's is its duration.
      const value = stage.durationMs ?? stage.startMs;
      if (value !== null) values.get(stage.name)!.push(value);
      if (stage.hitCap) caps.set(stage.name, (caps.get(stage.name) ?? 0) + 1);
    }
  }
  return {
    askToFirstAudible: {
      name: "ask-to-first-audible",
      count: audible.length,
      p50: percentile(audible, 50),
      p90: percentile(audible, 90),
      capHits: 0,
    },
    stages: order.map((name) => {
      const sample = values.get(name)!;
      return {
        name,
        count: sample.length,
        p50: percentile(sample, 50),
        p90: percentile(sample, 90),
        capHits: caps.get(name) ?? 0,
      };
    }),
  };
}

const cell = (value: number | null) => (value === null ? "." : String(value));

export function formatTurn(turn: TurnLatency): string {
  const lines = [
    `turn ${turn.id} (${turn.source}, origin ${turn.origin})  ask to first audible: ${turn.askToFirstAudibleMs === null ? "n/a" : `${turn.askToFirstAudibleMs} ms`}`,
    `  ${"stage".padEnd(26)}${"start".padStart(9)}${"duration".padStart(10)}${"cap".padStart(9)}  capped`,
  ];
  for (const stage of turn.stages) {
    lines.push(
      `  ${stage.name.padEnd(26)}${cell(stage.startMs).padStart(9)}${cell(stage.durationMs).padStart(10)}${cell(stage.capMs).padStart(9)}  ${stage.hitCap ? "YES" : ""}`,
    );
  }
  lines.push(`  retries and hedges: ${turn.retries.length > 0 ? turn.retries.join(", ") : "none"}`);
  return lines.join("\n");
}

export function formatSummary(turns: TurnLatency[]): string {
  const summary = summarizeTurns(turns);
  const row = (stage: StageSummary) =>
    `  ${stage.name.padEnd(26)}${String(stage.count).padStart(6)}${cell(stage.p50).padStart(9)}${cell(stage.p90).padStart(9)}${String(stage.capHits).padStart(8)}`;
  return [
    `summary over ${turns.length} turn(s), milliseconds (spans: duration; marks: time after Ask)`,
    `  ${"stage".padEnd(26)}${"n".padStart(6)}${"p50".padStart(9)}${"p90".padStart(9)}${"capped".padStart(8)}`,
    row(summary.askToFirstAudible),
    ...summary.stages.map(row),
  ].join("\n");
}

export interface ReportArgs {
  traceIds: string[];
  since: string | null;
  lab: string | null;
  limit: number;
}

export function parseArgs(argv: string[]): ReportArgs {
  const args: ReportArgs = { traceIds: [], since: null, lab: null, limit: 50 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--since") args.since = argv[++index] ?? null;
    else if (arg === "--lab") args.lab = argv[++index] ?? null;
    else if (arg === "--limit") args.limit = Math.max(1, Number(argv[++index]) || 50);
    else if (!arg.startsWith("--")) args.traceIds.push(arg);
  }
  if (args.since !== null && !Number.isFinite(Date.parse(args.since))) {
    throw new Error(`--since needs an ISO timestamp, got ${args.since}`);
  }
  return args;
}

interface LangfuseConfig {
  host: string;
  authorization: string;
}

function langfuseConfig(env: NodeJS.ProcessEnv): LangfuseConfig {
  const host = (env.LANGFUSE_HOST ?? env.LANGFUSE_BASEURL ?? "").replace(/\/+$/, "");
  const publicKey = env.LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LANGFUSE_SECRET_KEY;
  if (!host || !publicKey || !secretKey) {
    throw new Error("Set LANGFUSE_HOST, LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY");
  }
  return {
    host,
    authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`,
  };
}

async function langfuseGet(config: LangfuseConfig, path: string): Promise<unknown> {
  const response = await fetch(`${config.host}${path}`, {
    headers: { authorization: config.authorization, accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Langfuse ${response.status} for ${path.split("?")[0]}`);
  return response.json();
}

async function traceIdsSince(config: LangfuseConfig, since: string, limit: number): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; ids.length < limit; page++) {
    const body = record(await langfuseGet(
      config,
      `/api/public/traces?fromTimestamp=${encodeURIComponent(new Date(since).toISOString())}&limit=50&page=${page}`,
    ));
    const data = Array.isArray(body.data) ? body.data : [];
    for (const trace of data) {
      const id = record(trace).id;
      if (typeof id === "string") ids.push(id);
    }
    const totalPages = num(record(body.meta).totalPages) ?? page;
    if (data.length === 0 || page >= totalPages) break;
  }
  return ids.slice(0, limit);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let turns: TurnLatency[];
  if (args.lab) {
    turns = readLabRound(args.lab);
  } else {
    if (args.traceIds.length === 0 && !args.since) {
      throw new Error("Usage: startup-report.ts <traceId…> | --since <ISO> [--limit N] | --lab <round dir>");
    }
    const config = langfuseConfig(process.env);
    const ids = args.traceIds.length > 0 ? args.traceIds : await traceIdsSince(config, args.since!, args.limit);
    turns = [];
    for (const id of ids) {
      const parsed = parseLangfuseTrace(record(await langfuseGet(config, `/api/public/traces/${encodeURIComponent(id)}`)));
      if (parsed) turns.push(parsed);
    }
  }
  for (const turn of turns) console.log(`${formatTurn(turn)}\n`);
  if (turns.length === 0) console.log("no turns with startup telemetry");
  else console.log(formatSummary(turns));
}

if (process.argv[1]?.endsWith("startup-report.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
