import { requireAdminRequest } from "@/lib/auth/requireAdmin";
import { listUsersWithStats } from "@/lib/admin/usersQueries";
import type { UserSort } from "@/lib/admin/types";

export const dynamic = "force-dynamic";

const SORTS: readonly UserSort[] = [
  "recentActivity",
  "turns",
  "boards",
  "messages",
  "newest",
  "oldest",
];

function parsePositiveInt(value: string | null): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: Request): Promise<Response> {
  const denied = await requireAdminRequest();
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const sortParam = params.get("sort");
  const sort = SORTS.includes(sortParam as UserSort) ? (sortParam as UserSort) : undefined;

  try {
    const payload = await listUsersWithStats({
      query: params.get("query") ?? undefined,
      sort,
      page: parsePositiveInt(params.get("page")),
      pageSize: parsePositiveInt(params.get("pageSize")),
    });
    return Response.json(payload);
  } catch (error) {
    console.error("[admin] users query failed", error);
    return Response.json({ error: "users_failed" }, { status: 500 });
  }
}
