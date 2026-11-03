import { requireAdminRequest } from "@/lib/auth/requireAdmin";
import { applyAdminCommunityAction } from "@/lib/admin/communityQueries";
import { readBoundedJson, RequestBodyError } from "@/lib/http/requestBody";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ boardId: string }>;
}

/** Hide or show a board on Community, feature it, or clear its reports. */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const denied = await requireAdminRequest();
  if (denied) return denied;
  const { boardId } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = await readBoundedJson(request, 4 * 1024);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "invalid json" },
      { status: error instanceof RequestBodyError ? error.status : 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const action = {
    ...(typeof body.hidden === "boolean" ? { hidden: body.hidden } : {}),
    ...(typeof body.featured === "boolean" ? { featured: body.featured } : {}),
    ...(body.clearReports === true ? { clearReports: true } : {}),
  };
  if (Object.keys(action).length === 0) {
    return Response.json({ error: "nothing to change" }, { status: 400 });
  }
  if (!(await applyAdminCommunityAction(boardId, action))) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
