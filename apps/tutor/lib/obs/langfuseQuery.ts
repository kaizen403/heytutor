import { isLangfuseConfigured } from "./langfuse";
import {
  aggregateRunCost,
  parseCostObservation,
  type CostObservation,
  type RunCostReport,
} from "./runCost";

const QUERY_TIMEOUT_MS = 8_000;
const MAX_SESSIONS = 40;
const MAX_TRACES_PER_SESSION = 20;
const TRACE_FETCH_CONCURRENCY = 4;

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

async function langfuseGet(credentials: LangfuseCredentials, path: string): Promise<unknown> {
  const response = await fetch(`${credentials.host}${path}`, {
    headers: {
      Authorization: authHeader(credentials),
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`langfuse ${response.status}`);
  }
  return response.json();
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

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function fetchSessionTraceIds(
  credentials: LangfuseCredentials,
  sessionId: string,
): Promise<string[]> {
  const path = `/api/public/traces?sessionId=${encodeURIComponent(sessionId)}&limit=${MAX_TRACES_PER_SESSION}`;
  const payload = await langfuseGet(credentials, path);
  return readTraceIds(payload).slice(0, MAX_TRACES_PER_SESSION);
}

async function fetchTraceObservations(
  credentials: LangfuseCredentials,
  traceId: string,
  sessionId: string,
): Promise<CostObservation[]> {
  try {
    const details = await langfuseGet(credentials, `/api/public/traces/${encodeURIComponent(traceId)}`);
    const fromDetails = readObservations(details, sessionId);
    if (fromDetails.length > 0) {
      return fromDetails.map((observation) => ({
        ...observation,
        traceId: observation.traceId ?? traceId,
        sessionId: observation.sessionId ?? sessionId,
      }));
    }
  } catch {
    // Fall through to the observations list.
  }

  const payload = await langfuseGet(
    credentials,
    `/api/public/observations?traceId=${encodeURIComponent(traceId)}&limit=100`,
  );
  return readObservations(payload, sessionId).map((observation) => ({
    ...observation,
    traceId: observation.traceId ?? traceId,
    sessionId: observation.sessionId ?? sessionId,
  }));
}

function readTotalPages(payload: unknown): number {
  if (!isRecord(payload) || !isRecord(payload.meta)) return 1;
  const totalPages = asPositiveInt(payload.meta.totalPages) ?? asPositiveInt(payload.meta.pageCount);
  return totalPages ?? 1;
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

export async function fetchRunCostForTraces(traceIds: string[]): Promise<{
  configured: boolean;
  byTraceId: Record<string, { llmUsd: number; ttsUsd: number; totalUsd: number }>;
  error?: string;
}> {
  const unique = [...new Set(traceIds.map((id) => id.trim()).filter(Boolean))].slice(0, MAX_SESSIONS);
  const credentials = readLangfuseQueryCredentials();
  if (!credentials) {
    return { configured: false, byTraceId: {} };
  }
  if (unique.length === 0) {
    return { configured: true, byTraceId: {} };
  }

  try {
    const batches = await mapPool(unique, TRACE_FETCH_CONCURRENCY, async (traceId) => {
      const observations = await fetchTraceObservations(credentials, traceId, traceId);
      return observations.map((observation) => ({
        ...observation,
        sessionId: traceId,
        traceId,
      }));
    });
    const report = aggregateRunCost(batches.flat());
    const byTraceId: Record<string, { llmUsd: number; ttsUsd: number; totalUsd: number }> = {};
    for (const row of report.bySession) {
      byTraceId[row.sessionId] = {
        llmUsd: row.llmUsd,
        ttsUsd: row.ttsUsd,
        totalUsd: row.totalUsd,
      };
    }
    return { configured: true, byTraceId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "langfuse_unavailable";
    console.warn("[langfuse] trace-cost query failed", message);
    return { configured: true, byTraceId: {}, error: "langfuse_unavailable" };
  }
}

const WINDOW_PAGE_SIZE = 100;
const WINDOW_MAX_PAGES = 3;

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

  const maxPages = Math.max(1, Math.min(input.maxPages ?? WINDOW_MAX_PAGES, 8));
  try {
    const observations: CostObservation[] = [];
    let truncated = false;
    for (let page = 1; page <= maxPages; page += 1) {
      const params = new URLSearchParams({
        type: "GENERATION",
        limit: String(WINDOW_PAGE_SIZE),
        page: String(page),
        fromStartTime: input.from.toISOString(),
        toStartTime: input.to.toISOString(),
      });
      const payload = await langfuseGet(credentials, `/api/public/observations?${params.toString()}`);
      observations.push(...readObservations(payload, "window"));
      const totalPages = readTotalPages(payload);
      if (page >= totalPages) {
        truncated = false;
        break;
      }
      if (page === maxPages) {
        truncated = true;
      }
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
    const traceJobs = unique.map((sessionId) => ({ sessionId }));
    const tracesBySession = await mapPool(traceJobs, TRACE_FETCH_CONCURRENCY, async ({ sessionId }) => ({
      sessionId,
      traceIds: await fetchSessionTraceIds(credentials, sessionId),
    }));

    const observationJobs = tracesBySession.flatMap(({ sessionId, traceIds }) =>
      traceIds.map((traceId) => ({ sessionId, traceId })),
    );
    const batches = await mapPool(observationJobs, TRACE_FETCH_CONCURRENCY, ({ sessionId, traceId }) =>
      fetchTraceObservations(credentials, traceId, sessionId),
    );
    return { configured: true, report: aggregateRunCost(batches.flat()) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "langfuse_unavailable";
    console.warn("[langfuse] run-cost query failed", message);
    return { configured: true, report: aggregateRunCost([]), error: "langfuse_unavailable" };
  }
}
