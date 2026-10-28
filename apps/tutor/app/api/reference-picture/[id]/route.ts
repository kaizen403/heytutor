import { IMMUTABLE_ASSET_HEADERS, loadReferencePictureRecord, RECORD_WITH_PARTS_HEADERS } from "@/lib/reference-picture/pictureStore";
import { resolveReferencePicturePartFocusEnabled } from "@/lib/scene/diagramStrategy.server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  // The store serves `parts` only with part focus on, so with it off this is the record exactly as before.
  const record = await loadReferencePictureRecord(id);
  if (!record) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(record, { headers: resolveReferencePicturePartFocusEnabled() ? RECORD_WITH_PARTS_HEADERS : IMMUTABLE_ASSET_HEADERS });
}
