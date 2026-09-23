import type { SpeechProvider } from "../tts/providerConfig";
import { randomUUID } from "crypto";
import {
  Langfuse,
  type LangfuseGenerationClient,
  type LangfuseSpanClient,
  type LangfuseTraceClient,
} from "langfuse";
import { resolveFireworksModel } from "@/lib/llm/fireworksModels";
import {
  calculateLlmCostDetails,
  calculateTtsCostDetails,
  type CostDetails,
} from "./usageCost";

let client: Langfuse | null | undefined;

export function isLangfuseConfigured(): boolean {
  const flag = process.env.LANGFUSE_ENABLED;
  if (flag === "false" || flag === "0") {
    return false;
  }

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const baseUrl = process.env.LANGFUSE_HOST ?? process.env.LANGFUSE_BASE_URL;

  return Boolean(publicKey && secretKey && baseUrl);
}

function isLangfuseEnabled(): boolean {
  return isLangfuseConfigured();
}

function getClient(): Langfuse | null {
  if (client !== undefined) {
    return client;
  }

  if (!isLangfuseEnabled()) {
    client = null;
    return client;
  }

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY!;
  const secretKey = process.env.LANGFUSE_SECRET_KEY!;
  const baseUrl = process.env.LANGFUSE_HOST ?? process.env.LANGFUSE_BASE_URL!;

  client = new Langfuse({
    publicKey,
    secretKey,
    baseUrl,
    requestTimeout: 3000,
    flushInterval: 0,
    flushAt: 1000,
  });
  return client;
}

export function genTraceId(): string {
  return randomUUID();
}

function buildTraceTags(extra?: string[]): string[] {
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
  return [`env:${env}`, ...(extra ?? [])];
}

export interface TurnTrace {
  traceId: string;
  trace: LangfuseTraceClient | null;
  generation: LangfuseGenerationClient | null;
  model: string;
}

export interface StartTurnTraceParams {
  sessionId?: string;
  /** Parent-trace input: the student question. Omit when attaching so a planner prompt cannot replace it. */
  input?: string;
  /** Observation input: the prompt this generation actually sent. */
  generationInput?: string;
  traceId?: string;
  mock?: boolean;
  model?: string;
  name?: string;
  generationName?: string;
}

export function startTurnTrace({
  sessionId,
  input,
  generationInput,
  traceId = genTraceId(),
  mock = false,
  model,
  name = "tutor-turn",
  generationName = "fireworks-llm",
}: StartTurnTraceParams): TurnTrace | null {
  const lf = getClient();

  if (!lf) {
    return null;
  }

  const serverModel =
    model ?? resolveFireworksModel();

  const trace = lf.trace({
    id: traceId,
    name,
    sessionId,
    ...(input ? { input } : {}),
    tags: buildTraceTags(mock ? ["mock"] : undefined),
  });

  const generation = trace.generation({
    name: generationName,
    model: serverModel,
    input: generationInput ?? input,
  });

  return { traceId, trace, generation, model: serverModel };
}

export interface EndLlmGenerationParams {
  output: string;
  usageDetails?: {
    input?: number;
    output?: number;
    total?: number;
    cachedInput?: number;
  };
  metadata?: Record<string, unknown>;
  mock?: boolean;
  /** Actual upstream model when it differs from the generation's start model. */
  model?: string;
  /**
   * Planner/continuation generations must not replace the parent lesson text
   * or overwrite `llm_cost_usd` with a single-call slice.
   */
  updateTrace?: boolean;
  level?: TurnEventLevel;
}

function zeroCostDetails(): CostDetails {
  return { input: 0, output: 0, total: 0 };
}

export function endLlmGeneration(
  turn: TurnTrace | null,
  {
    output,
    usageDetails,
    metadata,
    mock = false,
    model,
    updateTrace = true,
    level,
  }: EndLlmGenerationParams,
): void {
  if (!turn?.generation) {
    return;
  }

  if (model && model !== turn.model) {
    turn.generation.update({ model });
    turn.model = model;
  }

  const costDetails = mock
    ? zeroCostDetails()
    : usageDetails
      ? calculateLlmCostDetails(usageDetails, { model: model ?? turn.model })
      : undefined;

  const generationMetadata = {
    ...metadata,
    ...(costDetails ? { pricing_source: mock ? "mock" : "env" } : {}),
  };

  turn.generation.end({
    output,
    usageDetails,
    metadata: generationMetadata,
    costDetails,
    ...(level ? { level } : {}),
  });

  if (!updateTrace) {
    return;
  }

  turn.trace?.update({
    output,
    metadata:
      costDetails && !mock
        ? {
            llm_cost_usd: costDetails.total,
            llm_input_tokens: usageDetails?.input,
            llm_output_tokens: usageDetails?.output,
            llm_model: turn.model,
          }
        : undefined,
  });
}

export interface RecordTtsSpanParams {
  traceId?: string;
  sessionId?: string;
  characters: number;
  model: string;
  voiceId: string;
  provider?: SpeechProvider;
  transport: "http" | "ws" | "browser-fallback";
  latencyMs?: number;
}

export function recordTtsSpan({
  traceId,
  sessionId,
  characters,
  model,
  voiceId,
  provider,
  transport,
  latencyMs,
}: RecordTtsSpanParams): void {
  const lf = getClient();

  if (!lf || !traceId || characters <= 0) {
    return;
  }

  const trace = lf.trace({ id: traceId, sessionId });
  const generation = trace.generation({
    name: "tts-segment",
    model,
    metadata: {
      voice_id: voiceId,
      provider,
      transport,
      latency_ms: latencyMs,
    },
  });

  const costDetails =
    transport === "browser-fallback"
      ? { characters: 0, total: 0 }
      : calculateTtsCostDetails(characters, { model, provider });

  generation.end({
    usageDetails: { characters },
    costDetails,
    metadata: {
      voice_id: voiceId,
      provider,
      transport,
      latency_ms: latencyMs,
      tts_cost_usd: costDetails.total,
      pricing_source: transport === "browser-fallback" ? "free" : "env",
    },
  });
}

export type TurnEventLevel = "DEFAULT" | "DEBUG" | "WARNING" | "ERROR";

export interface TurnTelemetryEvent {
  name: string;
  startTime: string;
  endTime: string;
  metadata?: Record<string, unknown>;
  parentName?: string;
  level?: TurnEventLevel;
}

export interface RecordTurnEventsParams {
  traceId: string;
  sessionId?: string;
  events: TurnTelemetryEvent[];
}

export interface UpdateTurnTraceParams {
  traceId: string;
  sessionId?: string;
  metadata: Record<string, unknown>;
}

function createTimedSpan(
  parent: LangfuseTraceClient | LangfuseSpanClient,
  event: TurnTelemetryEvent,
): LangfuseSpanClient {
  const span = parent.span({
    name: event.name,
    startTime: new Date(event.startTime),
    endTime: new Date(event.endTime),
    metadata: event.metadata,
    level: event.level,
  });

  return span;
}

export function recordTurnEvents({
  traceId,
  sessionId,
  events,
}: RecordTurnEventsParams): void {
  const lf = getClient();

  if (!lf || !traceId || events.length === 0) {
    return;
  }

  const trace = lf.trace({ id: traceId, sessionId });
  const spanClients = new Map<string, LangfuseSpanClient>();

  const rootEvents = events.filter((event) => !event.parentName);
  const childEvents = events.filter((event) => event.parentName);

  for (const event of rootEvents) {
    const span = createTimedSpan(trace, event);
    spanClients.set(event.name, span);
  }

  for (const event of childEvents) {
    const parent = event.parentName ? spanClients.get(event.parentName) : undefined;

    if (parent) {
      const span = createTimedSpan(parent, event);
      spanClients.set(event.name, span);
      continue;
    }

    const span = createTimedSpan(trace, event);
    spanClients.set(event.name, span);
  }
}

export function updateTurnTrace({
  traceId,
  sessionId,
  metadata,
}: UpdateTurnTraceParams): void {
  const lf = getClient();

  if (!lf || !traceId) {
    return;
  }

  lf.trace({ id: traceId, sessionId }).update({ metadata });
}

export async function flush(): Promise<void> {
  await getClient()?.flushAsync();
}

const FLUSH_TIMEOUT_MS = 3000;

/** Flush Langfuse events without blocking the caller or throwing on network errors. */
export async function flushSafely(): Promise<void> {
  const lf = getClient();

  if (!lf) {
    return;
  }

  try {
    await Promise.race([
      lf.flushAsync(),
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error("langfuse flush timeout")), FLUSH_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "langfuse flush failed";
    console.warn("[langfuse]", message);
  }
}

export function flushInBackground(): void {
  void flushSafely();
}
