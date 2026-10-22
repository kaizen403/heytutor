import { requireAdminRequest } from "@/lib/auth/requireAdmin";
import { prisma } from "@/lib/db/prisma";
import { parseCoverageWindow } from "@/lib/admin/coverage";
import { loadProductionCoverage } from "@/lib/admin/coverageQueries";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request): Promise<Response> {
  const denied = await requireAdminRequest();
  if (denied) return denied;
  let window;
  try {
    window = parseCoverageWindow(new URL(request.url).searchParams);
  } catch {
    return Response.json({ error: "invalid_coverage_window" }, { status: 400, headers });
  }
  try {
    return Response.json(await loadProductionCoverage(prisma, window), { headers });
  } catch {
    // Never log a query exception, artifact, diagnostic string or row payload.
    console.error("[admin] coverage_query_failed");
    return Response.json({ error: "coverage_failed" }, { status: 500, headers });
  }
}
