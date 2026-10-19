import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  parseReconciliationArgs,
  runStorageReconciliation,
} from "../live/reconcile-storage";

async function main() {
  const options = parseReconciliationArgs([]);
  assert.equal(options.write, false, "reconciliation must report without an explicit write flag");
  let applications = 0;
  const summary = await runStorageReconciliation(options, {
    listAccounts: async () => ({ ids: ["private-account-identity"], hasMore: false }),
    inspectAccount: async () => ({
      snapshot: { question: "private stored question", secret: "private-object-key" },
      plan: {
        beforeBytes: 1_817_182_208n,
        afterBytes: 18_000_000n,
        releasedBytes: 1_799_182_208n,
        legacyTurns: 20,
        missingObjects: 1,
        unresolvedReferences: 0,
        measuredAudioBytes: 17_500_000n,
        orphanAudioBytes: 0n, orphanObjects: 0,
        turnUpdates: [{ id: "private-turn-id" }],
        noteUpdates: [],
        expiredEmptyJobs: [],
      },
    }),
    applyAccount: async () => { applications++; return true; },
  });
  assert.equal(applications, 0, "the default run must never invoke the write adapter");
  assert.equal(summary.mode, "dry-run");
  assert.equal(summary.accountsScanned, 1);
  assert.equal(summary.accountsNeedingCorrection, 1);
  assert.equal(summary.proposedReleaseBytes, "1799182208");
  assert.equal(summary.accountsApplied, 0);
  const printed = JSON.stringify(summary);
  assert(!printed.includes("private"), "the report must contain counts and byte totals, never identities or stored content");
  console.log("PASS storage reconciliation defaults to report-only and prints aggregate counts/bytes only");

  assert.equal(parseReconciliationArgs(["--write"]).write, true, "only the explicit flag enables future owner-approved writes");
  for (const args of [["--write=false"], ["--apply"], ["--limit", "0"], ["--limit", "10001"], ["--user-id"], ["--user-id", "--write"]]) {
    assert.throws(() => parseReconciliationArgs(args), "ambiguous or invalid flags must fail before opening a database connection");
  }
  assert.deepEqual(parseReconciliationArgs(["--limit", "25", "--user-id", "private-account-identity"]), {
    write: false, limit: 25, userId: "private-account-identity", help: false,
  });
  console.log("PASS write flag is explicit and invalid/filter/limit arguments are bounded");

  const unresolved = await runStorageReconciliation(options, {
    listAccounts: async () => ({ ids: ["private-account-identity"], hasMore: true }),
    inspectAccount: async () => { throw new Error("private-account-identity private secret provider error"); },
    applyAccount: async () => { applications++; return true; },
  });
  assert.equal(unresolved.accountsScanned, 1);
  assert.equal(unresolved.accountsUnresolved, 1);
  assert.equal(unresolved.accountsMeasured, 0, "unknown measurements must not count as zero-byte measured accounts");
  assert.equal(unresolved.proposedReleaseBytes, "0");
  assert.equal(unresolved.hasMoreAccounts, true, "a bounded scan must announce incomplete account coverage");
  assert.equal(applications, 0);
  assert(!JSON.stringify(unresolved).includes("private"), "provider/database failures cannot expose account data");
  console.log("PASS unresolved accounts stay unchanged and partial coverage is reported without private error text");

  const unknownReference = await runStorageReconciliation(options, {
    listAccounts: async () => ({ ids: ["private-account-identity"], hasMore: false }),
    inspectAccount: async () => ({
      snapshot: {},
      plan: {
        beforeBytes: 8_388_608n, afterBytes: 0n, releasedBytes: 8_388_608n,
        legacyTurns: 1, missingObjects: 0, unresolvedReferences: 1,
        measuredAudioBytes: 0n, orphanAudioBytes: 0n, orphanObjects: 0, turnUpdates: [{}], noteUpdates: [], expiredEmptyJobs: [],
      },
    }),
    applyAccount: async () => { applications++; return true; },
  });
  assert.equal(unknownReference.accountsUnresolved, 1, "an unresolved reference must not be proposed as free storage");
  assert.equal(unknownReference.accountsMeasured, 0);
  assert.equal(unknownReference.proposedReleaseBytes, "0");
  assert.equal(applications, 0);
  console.log("PASS even an incomplete returned plan cannot report unknown media as released storage");

  const notesOnly = await runStorageReconciliation(options, {
    listAccounts: async () => ({ ids: ["private-account-identity"], hasMore: false }),
    inspectAccount: async () => ({ snapshot: {}, plan: {
      beforeBytes: 100n, afterBytes: 100n, releasedBytes: 0n,
      legacyTurns: 0, missingObjects: 0, unresolvedReferences: 0, measuredAudioBytes: 0n, orphanAudioBytes: 0n, orphanObjects: 0,
      turnUpdates: [], noteUpdates: [{ id: "private-note-id", storageBytes: 11n }], expiredEmptyJobs: [],
    } }),
    applyAccount: async () => { applications++; return true; },
  });
  assert.equal(notesOnly.notesToUpdate, 1, "legacy note corrections must be visible in the aggregate dry-run report");
  assert.equal(notesOnly.accountsNeedingCorrection, 1, "a note receipt correction is a change even if the aggregate balance is unchanged");
  assert.equal(applications, 0);
  assert(!JSON.stringify(notesOnly).includes("private"));
  console.log("PASS legacy note receipt corrections are reported without printing note identity or content");

  const script = resolve(import.meta.dirname, "../live/reconcile-storage.ts");
  const safeEnvironment = { ...process.env, DATABASE_URL: "" };
  const help = spawnSync(process.execPath, ["--import", "tsx", script, "--help"], { env: safeEnvironment, encoding: "utf8" });
  assert.equal(help.status, 0, "help must work without a database connection or loaded credentials");
  assert(help.stdout.includes("Default: dry run"));
  const missingDatabase = spawnSync(process.execPath, ["--import", "tsx", script], { env: safeEnvironment, encoding: "utf8" });
  assert.equal(missingDatabase.status, 1, "a run without an explicit database must stop before creating a client");
  const invalid = spawnSync(process.execPath, ["--import", "tsx", script, "--user-id", "private-account-identity", "--bad-private-key"], { env: safeEnvironment, encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert(!`${invalid.stdout}${invalid.stderr}`.includes("private"), "invalid flags cannot echo the account filter or raw arguments");
  console.log("PASS executable validates arguments and explicit database configuration before connecting");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
