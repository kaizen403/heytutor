import { requireAdminRequest } from "@/lib/auth/requireAdmin";
import { fetchRunCostForSessions } from "@/lib/obs/langfuseQuery";
import {
  snapshotPricing,
  type RunCostApiPayload,
} from "@/lib/obs/runCost";

export const dynamic = "force-dynamic";

const MAX_SESSION_IDS = 40;

export type RunCostResponse = RunCostApiPayload;

function parseSessionIds(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const raw = (body as { sessionIds?: unknown }).sessionIds;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())
    .slice(0, MAX_SESSION_IDS);
}

export async function POST(request: Request): Promise<Response> {
  const denied = await requireAdminRequest();
  if (denied) return denied;

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const sessionIds = parseSessionIds(body);
  const result = await fetchRunCostForSessions(sessionIds);
  const payload: RunCostApiPayload = {
    configured: result.configured,
    report: result.report,
    pricing: snapshotPricing(),
    fetchedAt: new Date().toISOString(),
    error: result.error,
  };
  return Response.json(payload);
}
