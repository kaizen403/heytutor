import { requireAdminRequest } from "@/lib/auth/requireAdmin";
import { prisma } from "@/lib/db/prisma";
import { parsePicturesPeriod } from "@/lib/admin/pictures";
import { loadPicturesReport } from "@/lib/admin/picturesQueries";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

// One slot per process, as the coverage route: the shared pool is 5
// connections and this report holds one for a read only transaction.
const picturesSlot = globalThis as unknown as { picturesReads?: number };
const picturesReads = () => picturesSlot.picturesReads ?? 0;

export async function GET(request: Request): Promise<Response> {
  const denied = await requireAdminRequest();
  if (denied) return denied;
  let window;
  try {
    window = parsePicturesPeriod(new URL(request.url).searchParams);
  } catch {
    return Response.json({ error: "invalid_pictures_period" }, { status: 400, headers });
  }
  if (picturesReads() > 0) return Response.json({ error: "pictures_busy" }, { status: 429, headers });
  picturesSlot.picturesReads = picturesReads() + 1;
  try {
    return Response.json(await loadPicturesReport(prisma, window), { headers });
  } catch {
    // Never log a query exception or row payload: the table rows carry student questions.
    console.error("[admin] pictures_query_failed");
    return Response.json({ error: "pictures_failed" }, { status: 500, headers });
  } finally {
    picturesSlot.picturesReads = picturesReads() - 1;
  }
}
