import { IMMUTABLE_ASSET_HEADERS, loadReferencePictureRecord } from "@/lib/reference-picture/pictureStore";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const record = await loadReferencePictureRecord(id);
  if (!record) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(record, { headers: IMMUTABLE_ASSET_HEADERS });
}
