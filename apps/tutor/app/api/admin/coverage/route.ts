import { requireAdminRequest } from "@/lib/auth/requireAdmin";
import { prisma } from "@/lib/db/prisma";
import { parseCoverageWindow } from "@/lib/admin/coverage";
import { loadProductionCoverage } from "@/lib/admin/coverageQueries";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

// One slot per process, including duplicate route chunks. The shared pool is 5
// connections; a second coverage scan must not hold another one for 15s.
const coverageSlot = globalThis as unknown as { coverageReads?: number };
const coverageReads = () => coverageSlot.coverageReads ?? 0;

export async function GET(request: Request): Promise<Response> {
  const denied = await requireAdminRequest();
  if (denied) return denied;
  let window;
  try {
    window = parseCoverageWindow(new URL(request.url).searchParams);
  } catch {
    return Response.json({ error: "invalid_coverage_window" }, { status: 400, headers });
  }
  if (coverageReads() > 0) return Response.json({ error: "coverage_busy" }, { status: 429, headers });
  coverageSlot.coverageReads = coverageReads() + 1;
  try {
    return Response.json(await loadProductionCoverage(prisma, window), { headers });
  } catch {
    // Never log a query exception, artifact, diagnostic string or row payload.
    console.error("[admin] coverage_query_failed");
    return Response.json({ error: "coverage_failed" }, { status: 500, headers });
  } finally {
    coverageSlot.coverageReads = coverageReads() - 1;
  }
}
