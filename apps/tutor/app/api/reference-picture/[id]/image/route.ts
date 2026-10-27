import { IMMUTABLE_ASSET_HEADERS, loadReferencePictureImage } from "@/lib/reference-picture/pictureStore";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const image = await loadReferencePictureImage(id);
  if (!image || !/^image\/(png|jpeg|webp)$/.test(image.contentType)) return Response.json({ error: "not_found" }, { status: 404 });
  return new Response(new Uint8Array(image.bytes), { headers: { ...IMMUTABLE_ASSET_HEADERS, "content-type": image.contentType, "content-length": String(image.bytes.byteLength) } });
}
