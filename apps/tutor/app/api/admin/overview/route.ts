import { requireAdminRequest } from "@/lib/auth/requireAdmin";
import { fetchOverview } from "@/lib/admin/overviewQueries";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const denied = await requireAdminRequest();
  if (denied) return denied;

  try {
    const payload = await fetchOverview();
    return Response.json(payload);
  } catch (error) {
    console.error("[admin] overview query failed", error);
    return Response.json({ error: "overview_failed" }, { status: 500 });
  }
}
