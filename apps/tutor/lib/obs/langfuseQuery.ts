import { isLangfuseConfigured } from "./langfuse";
import { scopedTraceId, scopedSessionId } from "./traceOwnership";
import { prisma } from "../db/prisma";
import {
  aggregateRunCost,
  parseCostObservation,
  type CostObservation,
  type RunCostReport,
} from "./runCost";

const QUERY_TIMEOUT_MS = 8_000;
const MAX_SESSIONS = 40;
const MAX_TRACES_PER_SESSION = 20;
const MAX_LOG_TRACES = 100;
const LOG_TRACE_BATCH_SIZE = 25;
/** One v2 page. Forty lectures fit in a handful of these instead of one traces call each. */
const SESSION_OBSERVATION_LIMIT = 200;
const SESSION_OBSERVATION_PAGES = 15;
const SESSION_LOOKBACK_MS = 180 * 86_400_000;
const RATE_LIMIT_ATTEMPTS = 3;

interface LangfuseCredentials {
  publicKey: string;
  secretKey: string;
  host: string;
}

export function readLangfuseQueryCredentials(): LangfuseCredentials | null {
  if (!isLangfuseConfigured()) return null;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const host = process.env.LANGFUSE_HOST ?? process.env.LANGFUSE_BASE_URL;
  if (!publicKey || !secretKey || !host) return null;
  return { publicKey, secretKey, host: host.replace(/\/$/, "") };
}

function authHeader(credentials: LangfuseCredentials): string {
  return `Basic ${Buffer.from(`${credentials.publicKey}:${credentials.secretKey}`).toString("base64")}`;
}

function retryDelayMs(response: Response, attempt: number): number {
  const header = Number.parseFloat(response.headers.get("retry-after") ?? "");
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 3_000);
  return Math.min(1_000 * attempt, 3_000);
}

async function langfuseGet(credentials: LangfuseCredentials, path: string): Promise<unknown> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= RATE_LIMIT_ATTEMPTS; attempt += 1) {
    const response = await fetch(`${credentials.host}${path}`, {
      headers: {
        Authorization: authHeader(credentials),
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
    if (response.status === 429 && attempt < RATE_LIMIT_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response, attempt)));
      continue;
    }
    if (!response.ok) {
      lastStatus = response.status;
      throw new Error(`langfuse ${response.status}`);
    }
    return response.json();
  }
  throw new Error(`langfuse ${lastStatus || 429}`);
}

/**
 * High-volume read for playground boards. `GET /api/public/traces` is capped
 * at 15 calls, which blanks the cost chip once a syllabus has more recordings
 * than that. v2 observations accepts the whole batch in one filter.
 */
export function sessionObservationsPath(
  sessionIds: readonly string[],
  cursor?: string,
  nowMs: number = Date.now(),
): string {
  const filter = JSON.stringify([
    {
      type: "stringOptions",
      column: "sessionId",
      operator: "any of",
      value: [...sessionIds],
    },
  ]);
  const params = new URLSearchParams({
    fields: "core,basic,usage,metadata,model",
    limit: String(SESSION_OBSERVATION_LIMIT),
    type: "GENERATION",
    fromStartTime: new Date(nowMs - SESSION_LOOKBACK_MS).toISOString(),
    toStartTime: new Date(nowMs + 60_000).toISOString(),
    filter,
  });
  if (cursor) params.set("cursor", cursor);
  return `/api/public/v2/observations?${params.toString()}`;
}

function readCursor(payload: unknown): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.meta)) return undefined;
  const cursor = payload.meta.cursor;
  return typeof cursor === "string" && cursor.length > 0 ? cursor : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readTraceIds(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  const ids: string[] = [];
  for (const row of payload.data) {
    if (isRecord(row) && typeof row.id === "string") {
      ids.push(row.id);
    }
  }
  return ids;
}

function readObservations(payload: unknown, sessionId: string): CostObservation[] {
  const rows = isRecord(payload) && Array.isArray(payload.observations)
    ? payload.observations
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload)
        ? payload
        : [];
  const observations: CostObservation[] = [];
  for (const row of rows) {
    const parsed = parseCostObservation(row, sessionId);
    if (parsed) observations.push(parsed);
  }
  return observations;
}

async function fetchSessionTraceIds(
  credentials: LangfuseCredentials,
  sessionId: string,
): Promise<string[]> {
  const path = `/api/public/traces?sessionId=${encodeURIComponent(sessionId)}&limit=${MAX_TRACES_PER_SESSION}`;
  const payload = await langfuseGet(credentials, path);
  return readTraceIds(payload).slice(0, MAX_TRACES_PER_SESSION);
}

export async function fetchRunCostForTraces(traceIds: string[], ownersByTraceId: ReadonlyMap<string, string> = new Map()): Promise<{
  configured: boolean;
  byTraceId: Record<string, { llmUsd: number; ttsUsd: number; totalUsd: number; observationTraceId?: string }>;
  error?: string;
}> {
  const unique = [...new Set(traceIds.map((id) => id.trim()).filter(Boolean))].slice(0, MAX_LOG_TRACES);
  const credentials = readLangfuseQueryCredentials();
  if (!credentials) {
    return { configured: false, byTraceId: {} };
  }
  if (unique.length === 0) {
    return { configured: true, byTraceId: {} };
  }

  try {
    // Batch the log page. Per-trace detail requests can hit the
    // vendor's rate limit, and a single missing trace used to blank every row.
    const candidates = new Map<string, string[]>();
    for (const traceId of unique) {
      const userId = ownersByTraceId.get(traceId);
      // Prefer the authenticated owner's namespace; historical raw ids remain
      // a read-only fallback for this trusted admin lookup.
      candidates.set(traceId, userId ? [scopedTraceId(userId, traceId), traceId] : [traceId]);
    }
    const observations: CostObservation[] = [];
    const pending: string[][] = [];
    for (let index = 0; index < unique.length; index += LOG_TRACE_BATCH_SIZE) {
      pending.push(unique.slice(index, index + LOG_TRACE_BATCH_SIZE));
    }
    let incomplete = false;
    while (pending.length > 0) {
      const batch = pending.shift()!;
      const filter = JSON.stringify([{
        type: "stringOptions", column: "traceId", operator: "any of",
        value: [...new Set(batch.flatMap(id => candidates.get(id)!))],
      }]);
      const batchObservations: CostObservation[] = [];
      let cursor: string | undefined;
      let complete = false;
      try {
        for (let page = 0; page < SESSION_OBSERVATION_PAGES; page += 1) {
          const params = new URLSearchParams({
            fields: "core,basic,usage,metadata,model",
            limit: String(SESSION_OBSERVATION_LIMIT), type: "GENERATION", filter,
          });
          if (cursor) params.set("cursor", cursor);
          const payload = await langfuseGet(credentials, `/api/public/v2/observations?${params.toString()}`);
          batchObservations.push(...readObservations(payload, "unknown"));
          const next = readCursor(payload);
          if (!next) {
            complete = true;
            break;
          }
          if (next === cursor) break;
          cursor = next;
        }
      } catch (error) {
        console.warn("[langfuse] trace-cost batch failed", error instanceof Error ? error.message : "langfuse_unavailable");
        incomplete = true;
        continue;
      }
      if (complete) {
        observations.push(...batchObservations);
      } else if (batch.length > 1) {
        // Retry smaller groups without retaining the partial parent, which
        // would double-count usage. Scoped and legacy ids stay together.
        const middle = Math.ceil(batch.length / 2);
        pending.push(batch.slice(0, middle), batch.slice(middle));
      } else {
        // An oversized or stalled trace must not hide other complete costs.
        incomplete = true;
      }
    }
    const present = new Set(observations.map(row => row.traceId));
    const clientTraceIds = new Map<string, string>();
    for (const [traceId, ids] of candidates) {
      const selected = ids.find(id => present.has(id));
      if (selected) clientTraceIds.set(selected, traceId);
    }
    const report = aggregateRunCost(observations.flatMap(observation => {
      const traceId = clientTraceIds.get(observation.traceId ?? "");
      return traceId ? [{ ...observation, sessionId: traceId }] : [];
    }));
    const byTraceId: Record<string, { llmUsd: number; ttsUsd: number; totalUsd: number; observationTraceId?: string }> = {};
    for (const row of report.bySession) {
      // A generation may be ingested before its usage. Its cost is unknown.
      if (row.inputTokens === 0 && row.outputTokens === 0 && row.characters === 0) continue;
      byTraceId[row.sessionId] = {
        llmUsd: row.llmUsd,
        ttsUsd: row.ttsUsd,
        totalUsd: row.totalUsd,
        observationTraceId: candidates.get(row.sessionId)?.find(id => present.has(id)),
      };
    }
    return { configured: true, byTraceId, ...(incomplete ? { error: "langfuse_unavailable" } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "langfuse_unavailable";
    console.warn("[langfuse] trace-cost query failed", message);
    return { configured: true, byTraceId: {}, error: "langfuse_unavailable" };
  }
}

const WINDOW_MAX_PAGES = 10;

/** v2 observations with a cursor: the legacy page-numbered list is rate limited far sooner. */
export function windowObservationsPath(from: Date, to: Date, cursor?: string): string {
  const params = new URLSearchParams({
    fields: "core,basic,usage,metadata,model",
    limit: String(SESSION_OBSERVATION_LIMIT),
    type: "GENERATION",
    fromStartTime: from.toISOString(),
    toStartTime: to.toISOString(),
  });
  if (cursor) params.set("cursor", cursor);
  return `/api/public/v2/observations?${params.toString()}`;
}

export async function fetchRunCostForWindow(input: {
  from: Date;
  to: Date;
  maxPages?: number;
}): Promise<{
  configured: boolean;
  report: RunCostReport;
  truncated: boolean;
  error?: string;
}> {
  const credentials = readLangfuseQueryCredentials();
  if (!credentials) {
    return { configured: false, report: aggregateRunCost([]), truncated: false };
  }

  const maxPages = Math.max(1, Math.min(input.maxPages ?? WINDOW_MAX_PAGES, SESSION_OBSERVATION_PAGES));
  try {
    const observations: CostObservation[] = [];
    let truncated = true;
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const payload = await langfuseGet(credentials, windowObservationsPath(input.from, input.to, cursor));
      observations.push(...readObservations(payload, "window"));
      const next = readCursor(payload);
      if (!next || next === cursor) {
        truncated = false;
        break;
      }
      cursor = next;
    }
    return { configured: true, report: aggregateRunCost(observations), truncated };
  } catch (error) {
    const message = error instanceof Error ? error.message : "langfuse_unavailable";
    console.warn("[langfuse] window-cost query failed", message);
    return {
      configured: true,
      report: aggregateRunCost([]),
      truncated: false,
      error: "langfuse_unavailable",
    };
  }
}

export async function fetchRunCostForSessions(sessionIds: string[]): Promise<{
  configured: boolean;
  report: RunCostReport;
  error?: string;
}> {
  const unique = [...new Set(sessionIds.map((id) => id.trim()).filter(Boolean))].slice(0, MAX_SESSIONS);
  const credentials = readLangfuseQueryCredentials();
  if (!credentials) {
    return { configured: false, report: aggregateRunCost([]) };
  }
  if (unique.length === 0) {
    return { configured: true, report: aggregateRunCost([]) };
  }

  try {
    const observations: CostObservation[] = [];
    const boards = await prisma.board.findMany({ where: { id: { in: unique } }, select: { id: true, userId: true } });
    const clientSessionIds = new Map(unique.map(id => [id, id]));
    for (const board of boards) clientSessionIds.set(scopedSessionId(board.userId, board.id), board.id);
    let cursor: string | undefined;
    for (let page = 0; page < SESSION_OBSERVATION_PAGES; page += 1) {
      const payload = await langfuseGet(credentials, sessionObservationsPath([...clientSessionIds.keys()], cursor));
      observations.push(...readObservations(payload, "unknown").map(observation => ({
        ...observation,
        sessionId: clientSessionIds.get(observation.sessionId ?? "") ?? observation.sessionId,
      })));
      const next = readCursor(payload);
      if (!next || next === cursor) break;
      cursor = next;
    }
    return { configured: true, report: aggregateRunCost(observations) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "langfuse_unavailable";
    console.warn("[langfuse] run-cost query failed", message);
    return { configured: true, report: aggregateRunCost([]), error: "langfuse_unavailable" };
  }
}
