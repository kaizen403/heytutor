/** Aggregate Langfuse generation observations into AI + ElevenLabs run cost. */

import {
  calculateLlmCostDetails,
  calculateTtsCostDetails,
  resolveLlmRates,
  roundUsd,
  TTS_RATE_DEFAULTS,
  type LlmRateLane,
  type TtsRateLane,
} from "./usageCost";

export interface CostObservation {
  id?: string | null;
  traceId?: string | null;
  sessionId?: string | null;
  name?: string | null;
  model?: string | null;
  providedModelName?: string | null;
  type?: string | null;
  usage?: {
    input?: number | null;
    output?: number | null;
    total?: number | null;
    unit?: string | null;
  } | null;
  usageDetails?: Record<string, number> | null;
  metadata?: Record<string, unknown> | null;
}

export interface RunCostKindRow {
  name: string;
  stream: "llm" | "tts";
  observations: number;
  inputTokens: number;
  outputTokens: number;
  characters: number;
  usd: number;
  models: string[];
}

export interface RunCostSessionRow {
  sessionId: string;
  traces: number;
  observations: number;
  inputTokens: number;
  outputTokens: number;
  characters: number;
  llmUsd: number;
  ttsUsd: number;
  totalUsd: number;
}

export interface RunCostTotals {
  traces: number;
  observations: number;
  llmObservations: number;
  ttsObservations: number;
  inputTokens: number;
  outputTokens: number;
  characters: number;
  llmUsd: number;
  ttsUsd: number;
  totalUsd: number;
}

export interface RunCostReport {
  totals: RunCostTotals;
  byKind: RunCostKindRow[];
  bySession: RunCostSessionRow[];
}

export const EMPTY_RUN_COST: RunCostReport = {
  totals: {
    traces: 0,
    observations: 0,
    llmObservations: 0,
    ttsObservations: 0,
    inputTokens: 0,
    outputTokens: 0,
    characters: 0,
    llmUsd: 0,
    ttsUsd: 0,
    totalUsd: 0,
  },
  byKind: [],
  bySession: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function observationModel(observation: CostObservation): string | undefined {
  const model = observation.model || observation.providedModelName;
  return model ? model : undefined;
}

function usageUnit(observation: CostObservation): string {
  return (observation.usage?.unit ?? "").toLowerCase();
}

export function isTtsObservation(observation: CostObservation): boolean {
  if (observation.name === "tts-segment") return true;
  if (typeof observation.usageDetails?.characters === "number") return true;
  const unit = usageUnit(observation);
  return unit.includes("char");
}

function readTokenUsage(observation: CostObservation): { input: number; output: number } {
  const details = observation.usageDetails ?? {};
  const input =
    asFiniteNumber(observation.usage?.input) ??
    asFiniteNumber(details.input) ??
    asFiniteNumber(details.prompt_tokens) ??
    0;
  const output =
    asFiniteNumber(observation.usage?.output) ??
    asFiniteNumber(details.output) ??
    asFiniteNumber(details.completion_tokens) ??
    0;
  return { input, output };
}

function readCharacterUsage(observation: CostObservation): number {
  const details = observation.usageDetails ?? {};
  const fromDetails = asFiniteNumber(details.characters);
  if (fromDetails !== undefined) return fromDetails;
  if (usageUnit(observation).includes("char")) {
    return (
      asFiniteNumber(observation.usage?.total) ??
      asFiniteNumber(observation.usage?.input) ??
      0
    );
  }
  return 0;
}

export function observationKindName(observation: CostObservation): string {
  const name = observation.name?.trim();
  return name && name.length > 0 ? name : "other";
}

function emptyKind(name: string, stream: "llm" | "tts"): RunCostKindRow {
  return {
    name,
    stream,
    observations: 0,
    inputTokens: 0,
    outputTokens: 0,
    characters: 0,
    usd: 0,
    models: [],
  };
}

function emptySession(sessionId: string): RunCostSessionRow {
  return {
    sessionId,
    traces: 0,
    observations: 0,
    inputTokens: 0,
    outputTokens: 0,
    characters: 0,
    llmUsd: 0,
    ttsUsd: 0,
    totalUsd: 0,
  };
}

function rememberModel(row: RunCostKindRow, model: string | undefined): void {
  if (!model || row.models.includes(model)) return;
  row.models.push(model);
}

export function aggregateRunCost(observations: CostObservation[]): RunCostReport {
  if (observations.length === 0) {
    return EMPTY_RUN_COST;
  }

  const kinds = new Map<string, RunCostKindRow>();
  const sessions = new Map<string, RunCostSessionRow>();
  const traces = new Set<string>();
  const sessionTraces = new Map<string, Set<string>>();

  let inputTokens = 0;
  let outputTokens = 0;
  let characters = 0;
  let llmUsd = 0;
  let ttsUsd = 0;
  let llmObservations = 0;
  let ttsObservations = 0;

  for (const observation of observations) {
    const type = (observation.type ?? "GENERATION").toUpperCase();
    if (type && type !== "GENERATION") {
      continue;
    }

    const model = observationModel(observation);
    const kindName = observationKindName(observation);
    const sessionId = observation.sessionId || "unknown";
    const traceId = observation.traceId || undefined;
    if (traceId) traces.add(traceId);

    let session = sessions.get(sessionId);
    if (!session) {
      session = emptySession(sessionId);
      sessions.set(sessionId, session);
    }
    session.observations += 1;
    if (traceId) {
      let set = sessionTraces.get(sessionId);
      if (!set) {
        set = new Set();
        sessionTraces.set(sessionId, set);
      }
      set.add(traceId);
    }

    if (isTtsObservation(observation)) {
      const chars = readCharacterUsage(observation);
      if (chars <= 0) {
        continue;
      }
      const usd = calculateTtsCostDetails(chars, { model }).total ?? 0;
      let kind = kinds.get(kindName);
      if (!kind) {
        kind = emptyKind(kindName, "tts");
        kinds.set(kindName, kind);
      }
      kind.observations += 1;
      kind.characters += chars;
      kind.usd = roundUsd(kind.usd + usd);
      rememberModel(kind, model);
      session.characters += chars;
      session.ttsUsd = roundUsd(session.ttsUsd + usd);
      characters += chars;
      ttsUsd = roundUsd(ttsUsd + usd);
      ttsObservations += 1;
      continue;
    }

    const tokens = readTokenUsage(observation);
    if (tokens.input <= 0 && tokens.output <= 0) {
      continue;
    }
    const usd = calculateLlmCostDetails(tokens, { model }).total ?? 0;
    let kind = kinds.get(kindName);
    if (!kind) {
      kind = emptyKind(kindName, "llm");
      kinds.set(kindName, kind);
    }
    kind.observations += 1;
    kind.inputTokens += tokens.input;
    kind.outputTokens += tokens.output;
    kind.usd = roundUsd(kind.usd + usd);
    rememberModel(kind, model);
    session.inputTokens += tokens.input;
    session.outputTokens += tokens.output;
    session.llmUsd = roundUsd(session.llmUsd + usd);
    inputTokens += tokens.input;
    outputTokens += tokens.output;
    llmUsd = roundUsd(llmUsd + usd);
    llmObservations += 1;
  }

  const bySession = [...sessions.values()]
    .map((row) => ({
      ...row,
      traces: sessionTraces.get(row.sessionId)?.size ?? 0,
      totalUsd: roundUsd(row.llmUsd + row.ttsUsd),
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd);

  const byKind = [...kinds.values()].sort((a, b) => b.usd - a.usd);

  return {
    totals: {
      traces: traces.size,
      observations: llmObservations + ttsObservations,
      llmObservations,
      ttsObservations,
      inputTokens,
      outputTokens,
      characters,
      llmUsd,
      ttsUsd,
      totalUsd: roundUsd(llmUsd + ttsUsd),
    },
    byKind,
    bySession,
  };
}

export function parseCostObservation(value: unknown, sessionId?: string): CostObservation | null {
  if (!isRecord(value)) return null;
  const usage = isRecord(value.usage)
    ? {
        input: asFiniteNumber(value.usage.input) ?? null,
        output: asFiniteNumber(value.usage.output) ?? null,
        total: asFiniteNumber(value.usage.total) ?? null,
        unit: typeof value.usage.unit === "string" ? value.usage.unit : null,
      }
    : null;
  const usageDetails = isRecord(value.usageDetails)
    ? Object.fromEntries(
        Object.entries(value.usageDetails).flatMap(([key, entry]) => {
          const amount = asFiniteNumber(entry);
          return amount === undefined ? [] : [[key, amount]];
        }),
      )
    : null;
  const metadata = isRecord(value.metadata) ? value.metadata : null;
  const name = typeof value.name === "string" ? value.name : null;
  const model =
    typeof value.model === "string"
      ? value.model
      : typeof value.providedModelName === "string"
        ? value.providedModelName
        : null;
  return {
    id: typeof value.id === "string" ? value.id : null,
    traceId: typeof value.traceId === "string" ? value.traceId : null,
    sessionId:
      (typeof value.sessionId === "string" ? value.sessionId : null) ?? sessionId ?? null,
    name,
    model,
    providedModelName: typeof value.providedModelName === "string" ? value.providedModelName : null,
    type: typeof value.type === "string" ? value.type : null,
    usage,
    usageDetails,
    metadata,
  };
}

export function snapshotPricing(): {
  llm: Array<{ lane: LlmRateLane; inputUsdPer1M: number; outputUsdPer1M: number }>;
  tts: Array<{ lane: TtsRateLane; usdPer1kChars: number }>;
} {
  const models: Array<[LlmRateLane, string]> = [
    ["kimi-k3-fast", "accounts/fireworks/routers/kimi-k3-fast"],
    ["kimi-k3", "accounts/fireworks/models/kimi-k3"],
    ["deepseek-flash", "accounts/fireworks/models/deepseek-v4p1-flash"],
    ["qwen-vision", "accounts/fireworks/models/qwen3p7-plus"],
  ];
  return {
    llm: models.map(([, model]) => {
      const rates = resolveLlmRates(model);
      return { lane: rates.lane, inputUsdPer1M: rates.inputUsdPer1M, outputUsdPer1M: rates.outputUsdPer1M };
    }),
    tts: [
      {
        lane: "flash",
        usdPer1kChars: calculateTtsCostDetails(1000, { model: "eleven_flash_v2_5" }).total ?? TTS_RATE_DEFAULTS.flash,
      },
      {
        lane: "multilingual",
        usdPer1kChars:
          calculateTtsCostDetails(1000, { model: "eleven_multilingual_v2" }).total ?? TTS_RATE_DEFAULTS.multilingual,
      },
    ],
  };
}

export interface RunCostApiPayload {
  configured: boolean;
  report: RunCostReport;
  pricing: ReturnType<typeof snapshotPricing>;
  fetchedAt: string;
  error?: string;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

export function formatTokenCount(value: number): string {
  if (value < 1000) return String(Math.round(value));
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
  return `${Math.round(value / 1000)}k`;
}

export function formatCharCount(value: number): string {
  if (value < 1000) return String(Math.round(value));
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
  return `${Math.round(value / 1000)}k`;
}
