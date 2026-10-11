import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ReconciliationOptions {
  write: boolean;
  userId?: string;
  limit: number;
  help: boolean;
}

export function parseReconciliationArgs(args: readonly string[]): ReconciliationOptions {
  const options: ReconciliationOptions = { write: false, limit: 1000, help: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--write") options.write = true;
    else if (arg === "--help") options.help = true;
    else if (arg === "--user-id") {
      const value = args[++index];
      if (!value || value.startsWith("--") || value.length > 128) throw new Error("invalid account filter");
      options.userId = value;
    } else if (arg === "--limit") {
      const value = args[++index];
      if (!value || !/^\d+$/.test(value)) throw new Error("invalid scan limit");
      options.limit = Number(value);
      if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 10_000) throw new Error("invalid scan limit");
    } else throw new Error("unknown reconciliation option");
  }
  return options;
}

interface ReportablePlan {
  beforeBytes: bigint;
  afterBytes: bigint;
  releasedBytes: bigint;
  legacyTurns: number;
  missingObjects: number;
  unresolvedReferences: number;
  measuredAudioBytes: bigint;
  orphanAudioBytes: bigint;
  orphanObjects: number;
  turnUpdates: readonly unknown[];
  noteUpdates: readonly { storageBytes: bigint }[];
  expiredEmptyJobs: readonly unknown[];
}

interface ReconciliationDependencies<Snapshot, Plan extends ReportablePlan> {
  listAccounts(options: ReconciliationOptions): Promise<{ ids: string[]; hasMore: boolean }>;
  inspectAccount(userId: string): Promise<{ snapshot: Snapshot; plan: Plan }>;
  applyAccount(snapshot: Snapshot, plan: Plan): Promise<boolean>;
}

/** This runner returns aggregates only; identities, source snapshots and errors never enter its report. */
export async function runStorageReconciliation<Snapshot, Plan extends ReportablePlan>(
  options: ReconciliationOptions,
  dependencies: ReconciliationDependencies<Snapshot, Plan>,
) {
  const accounts = await dependencies.listAccounts(options);
  const summary = {
    mode: options.write ? "write" : "dry-run",
    accountsScanned: 0,
    accountsMeasured: 0,
    accountsNeedingCorrection: 0,
    accountsUnchanged: 0,
    accountsUnresolved: 0,
    accountsApplied: 0,
    accountsChangedDuringApply: 0,
    accountsApplyFailed: 0,
    legacyTurnsMeasured: 0,
    turnsToUpdate: 0,
    notesToUpdate: 0,
    orphanObjects: 0,
    missingObjects: 0,
    unresolvedReferences: 0,
    expiredEmptyJobsToRelease: 0,
    reservedBytesBefore: "0",
    proposedReservedBytesAfter: "0",
    proposedReleaseBytes: "0",
    proposedIncreaseBytes: "0",
    measuredAudioBytes: "0",
    orphanAudioBytes: "0",
    legacyNoteBytesToCharge: "0",
    hasMoreAccounts: accounts.hasMore,
  };
  let beforeBytes = 0n, afterBytes = 0n, releaseBytes = 0n, increaseBytes = 0n, audioBytes = 0n, orphanBytes = 0n, noteBytes = 0n;
  for (const userId of accounts.ids) {
    summary.accountsScanned++;
    let inspection: { snapshot: Snapshot; plan: Plan };
    try { inspection = await dependencies.inspectAccount(userId); }
    catch { summary.accountsUnresolved++; continue; }
    const { snapshot, plan } = inspection;
    if (plan.unresolvedReferences > 0) {
      summary.accountsUnresolved++;
      summary.unresolvedReferences += plan.unresolvedReferences;
      continue;
    }
    summary.accountsMeasured++;
    beforeBytes += plan.beforeBytes;
    afterBytes += plan.afterBytes;
    releaseBytes += plan.releasedBytes;
    increaseBytes += plan.afterBytes > plan.beforeBytes ? plan.afterBytes - plan.beforeBytes : 0n;
    audioBytes += plan.measuredAudioBytes;
    orphanBytes += plan.orphanAudioBytes;
    noteBytes += plan.noteUpdates.reduce((sum, note) => sum + note.storageBytes, 0n);
    summary.legacyTurnsMeasured += plan.legacyTurns;
    summary.turnsToUpdate += plan.turnUpdates.length;
    summary.notesToUpdate += plan.noteUpdates.length;
    summary.orphanObjects += plan.orphanObjects;
    summary.missingObjects += plan.missingObjects;
    summary.expiredEmptyJobsToRelease += plan.expiredEmptyJobs.length;
    const changed = plan.beforeBytes !== plan.afterBytes || plan.turnUpdates.length > 0 || plan.noteUpdates.length > 0 || plan.expiredEmptyJobs.length > 0;
    if (!changed) { summary.accountsUnchanged++; continue; }
    summary.accountsNeedingCorrection++;
    if (!options.write) continue;
    try {
      if (await dependencies.applyAccount(snapshot, plan)) summary.accountsApplied++;
      else summary.accountsChangedDuringApply++;
    } catch { summary.accountsApplyFailed++; }
  }
  summary.reservedBytesBefore = String(beforeBytes);
  summary.proposedReservedBytesAfter = String(afterBytes);
  summary.proposedReleaseBytes = String(releaseBytes);
  summary.proposedIncreaseBytes = String(increaseBytes);
  summary.measuredAudioBytes = String(audioBytes);
  summary.orphanAudioBytes = String(orphanBytes);
  summary.legacyNoteBytesToCharge = String(noteBytes);
  return summary;
}

async function main() {
  const options = parseReconciliationArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: tsx scripts/live/reconcile-storage.ts [--user-id ID] [--limit 1..10000] [--write]");
    console.log("Default: dry run. DATABASE_URL is required; only aggregate counts and bytes are reported.");
    console.log("--write applies verified accounting corrections under account/job locks; it never deletes stored content.");
    return;
  }
  if (!process.env.DATABASE_URL?.trim()) throw new Error("explicit DATABASE_URL required");
  const [{ Prisma, PrismaClient }, accounting, { withPrismaPoolLimits }] = await Promise.all([
    import("@prisma/client"),
    import("../../lib/boards/storageAccounting"),
    import("../../lib/db/databaseUrl"),
  ]);
  // Suppress Prisma error logs as they can include SQL parameters or account IDs.
  const database = new PrismaClient({
    log: [],
    datasources: { db: { url: withPrismaPoolLimits(process.env.DATABASE_URL.trim()) } },
  });
  let readOnlyTransactionsVerified = 0;
  const readOnly = <T>(read: (tx: import("@prisma/client").Prisma.TransactionClient) => Promise<T>) =>
    database.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const state = await tx.$queryRaw<Array<{ readOnly: string }>>`SELECT current_setting('transaction_read_only') AS "readOnly"`;
      if (state[0]?.readOnly !== "on") throw new Error("database did not enforce read-only snapshots");
      readOnlyTransactionsVerified++;
      return read(tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 });
  try {
    const summary = await runStorageReconciliation(options, {
      listAccounts: async () => readOnly(async tx => {
        const rows = await tx.user.findMany({
          where: options.userId ? { id: options.userId } : undefined,
          select: { id: true },
          orderBy: { id: "asc" },
          take: options.limit + 1,
        });
        return { ids: rows.slice(0, options.limit).map(row => row.id), hasMore: rows.length > options.limit };
      }),
      inspectAccount: async userId => {
        const snapshot = await readOnly(tx => accounting.readStorageAccountingSnapshot(tx, userId));
        const plan = await accounting.measureStorageAccounting(snapshot);
        return { snapshot, plan };
      },
      applyAccount: async (snapshot, plan) => database.$transaction(async tx => {
        const owned = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE id = ${snapshot.userId} FOR UPDATE`;
        if (!owned.length) return false;
        return accounting.applyStorageAccountingPlan(tx, snapshot, plan);
      }, { timeout: 60_000 }),
    });
    console.log(JSON.stringify({ ...summary, readOnlyTransactionsVerified }, null, 2));
    if (summary.accountsUnresolved || summary.accountsChangedDuringApply || summary.accountsApplyFailed || summary.hasMoreAccounts) process.exitCode = 2;
  } finally { await database.$disconnect(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error("Storage reconciliation could not complete. No account identifiers, content, or credentials were printed.");
    process.exitCode = 1;
  });
}
