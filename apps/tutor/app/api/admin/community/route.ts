import { requireAdminRequest } from "@/lib/auth/requireAdmin";
import { listAdminCommunityBoards, parseAdminCommunityFilter } from "@/lib/admin/communityQueries";

export const dynamic = "force-dynamic";

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export async function GET(request: Request): Promise<Response> {
  const denied = await requireAdminRequest();
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  try {
    return Response.json(await listAdminCommunityBoards({
      filter: parseAdminCommunityFilter(params.get("filter")),
      query: params.get("query") ?? "",
      page: parsePositiveInt(params.get("page"), 1, 10_000),
      pageSize: parsePositiveInt(params.get("pageSize"), 25, 100),
    }));
  } catch (error) {
    console.error("[admin] community query failed", error);
    return Response.json({ error: "community query failed" }, { status: 500 });
  }
}
