import { PrismaClient } from "@prisma/client";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { failedTurnWhere } from "../../lib/admin/turnFilters";
import { LIVE_TURN_IDLE_MS } from "../../lib/boards/turnStatus";
import { queueFailedTurnSentry } from "../../lib/obs/failedTurnSentry";
import { buildFailedTurnSentryEvent } from "../../lib/obs/failedTurnTelemetry";

/** Owner-only backfill after deploying the migration. Dry runs cannot write. */
export async function queueHistoricalFailedTurns(
  db: PrismaClient,
  options: { apply: boolean; limit: number },
) {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new Error("limit must be an integer from 1 to 100");
  }
  const where = {
    AND: [failedTurnWhere(), { sentryEventId: null }, {
      OR: [
        { status: { not: "live" } },
        { status: "live", updatedAt: { lte: new Date(Date.now() - LIVE_TURN_IDLE_MS) } },
      ],
    }],
  };
  const snapshot = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const eligible = await tx.turn.count({ where });
    const rows = await tx.turn.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: options.limit,
      select: {
        id: true, status: true, kind: true, visualStatus: true, sceneArtifacts: true,
        updatedAt: true, sentryEventId: true, resumeState: true,
        segments: { select: { narration: true, spokenText: true } },
      },
    });
    return { eligible, rows };
  }, { timeout: 30_000 });

  const codes: Record<string, number> = {};
  for (const row of snapshot.rows) {
    const event = buildFailedTurnSentryEvent(row, {}, { historical: true, staleLive: row.status === "live" });
    if (event) codes[event.tags.code!] = (codes[event.tags.code!] ?? 0) + 1;
  }
  let queued = 0;
  if (options.apply) {
    // The read-only snapshot is separate. This transaction only queues safe events;
    // the worker sends them under its normal limit. It never captures student text.
    queued = await db.$transaction(async (tx) => {
      let count = 0;
      for (const row of snapshot.rows) {
        if (await queueFailedTurnSentry(tx, row, { historical: true, staleLive: row.status === "live" })) count++;
      }
      return count;
    }, { timeout: 60_000 });
  }
  return { mode: options.apply ? "apply" : "dry_run", eligible: snapshot.eligible,
    scanned: snapshot.rows.length, queued, codes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const valid = args.every(arg => arg === "--apply" || /^--limit=\d+$/.test(arg));
  const limit = Number(args.find(arg => arg.startsWith("--limit="))?.slice(8) ?? "25");
  const db = new PrismaClient({ log: [] });
  (async () => {
    try {
      if (!valid) throw new Error("unsupported option");
      console.log(JSON.stringify(await queueHistoricalFailedTurns(db, {
        apply: args.includes("--apply"), limit,
      })));
    } catch {
      console.error("Historical failed-turn queue failed. Check the migration, database access and --limit=1..100; row data was not printed.");
      process.exitCode = 1;
    } finally {
      await db.$disconnect();
    }
  })();
}
