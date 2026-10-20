import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCoverageWindow } from "../../lib/admin/coverage";

export function parseProductionCoverageArgs(args: readonly string[]) {
  const params = new URLSearchParams();
  if (args.length === 1 && args[0] === "--help") return { help: true as const };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if ((flag !== "--from" && flag !== "--to") || !value || params.has(flag.slice(2))) {
      throw new Error("invalid_coverage_arguments");
    }
    params.set(flag.slice(2), value);
  }
  return { help: false as const, window: parseCoverageWindow(params) };
}

async function main() {
  const options = parseProductionCoverageArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: tsx scripts/live/production-coverage.ts [--from YYYY-MM-DD --to YYYY-MM-DD]");
    console.log("UTC start inclusive, end exclusive; default last 7 UTC dates, max 366 days. Explicit DATABASE_URL required. READ ONLY, totals only; no write option.");
    return;
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("coverage_database_required");
  const [{ PrismaClient }, { withPrismaPoolLimits }, { loadProductionCoverage }] = await Promise.all([
    import("@prisma/client"), import("../../lib/db/databaseUrl"), import("../../lib/admin/coverageQueries"),
  ]);
  const db = new PrismaClient({ log: [], datasources: { db: { url: withPrismaPoolLimits(url) } } });
  try { console.log(JSON.stringify(await loadProductionCoverage(db, options.window), null, 2)); }
  finally { await db.$disconnect(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error("Coverage report failed. Check UTC dates and database access; no credentials or lesson data were printed.");
    process.exitCode = 1;
  });
}
