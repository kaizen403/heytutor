import { requireAdminRequest } from "@/lib/auth/requireAdmin";
import { userDetail } from "@/lib/admin/userDetailQueries";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ userId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const denied = await requireAdminRequest();
  if (denied) return denied;

  const { userId } = await context.params;
  if (!userId.trim()) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const payload = await userDetail(userId.trim());
    if (!payload) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return Response.json(payload);
  } catch (error) {
    console.error("[admin] user detail query failed", error);
    return Response.json({ error: "user_detail_failed" }, { status: 500 });
  }
}
