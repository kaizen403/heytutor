import { IMMUTABLE_ASSET_HEADERS, loadReferencePicturePlan } from "@/lib/reference-picture/pictureStore";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const plan = await loadReferencePicturePlan(id);
  if (!plan) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(plan, { headers: IMMUTABLE_ASSET_HEADERS });
}
