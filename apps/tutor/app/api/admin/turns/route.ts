import { requireAdminRequest } from "@/lib/auth/requireAdmin";
import { listTurns } from "@/lib/admin/turnsQueries";
import type { TurnsOutcomeFilter } from "@/lib/admin/types";

export const dynamic = "force-dynamic";

const OUTCOMES: readonly TurnsOutcomeFilter[] = ["all", "validated", "failed"];

function parsePositiveInt(value: string | null): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: Request): Promise<Response> {
  const denied = await requireAdminRequest();
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const outcomeParam = params.get("outcome");
  const outcome = OUTCOMES.includes(outcomeParam as TurnsOutcomeFilter)
    ? (outcomeParam as TurnsOutcomeFilter)
    : undefined;

  try {
    const payload = await listTurns({
      outcome,
      userId: params.get("userId") ?? undefined,
      boardId: params.get("boardId") ?? undefined,
      query: params.get("query") ?? undefined,
      days: parsePositiveInt(params.get("days")),
      page: parsePositiveInt(params.get("page")),
      pageSize: parsePositiveInt(params.get("pageSize")),
    });
    return Response.json(payload);
  } catch (error) {
    console.error("[admin] turns query failed", error);
    return Response.json({ error: "turns_failed" }, { status: 500 });
  }
}
