import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Run the real worker entry points, with only clock/DB/SDK boundaries replaced.
// No database, object-store or Sentry request can leave this test.
const app = new URL("../../", import.meta.url);
let now = 1_800_000_000_000;
const logs: unknown[][] = [];
const timers: Array<() => void> = [];
let recoveryPolls = 0, deliveryPolls = 0, cleanupPolls = 0;
let healthy = false;
class Clock extends Date {
  constructor(value?: string | number | Date) { super(value === undefined ? now : value instanceof Date ? value.getTime() : value); }
  static now() { return now; }
}
const privateBody = "Synthetic private question synthetic-student@example.test";
const db = {
  turn: { findMany: async () => { recoveryPolls++; if (!healthy) throw { code: "P1001", message: privateBody }; return []; } },
  $queryRaw: async () => { deliveryPolls++; if (!healthy) throw { code: "P1000", message: privateBody }; return []; },
};
const cleanupDb = {
  $queryRaw: async () => { cleanupPolls++; if (!healthy) throw { code: "P2021", message: privateBody }; return []; },
  abuseIdentity: { deleteMany: async () => ({ count: 0 }) }, ownedTrace: { deleteMany: async () => ({ count: 0 }) },
};
const cache = new Map<string, unknown>();
function load(file: string): unknown {
  if (cache.has(file)) return cache.get(file);
  const source = file === "lib/obs/workerFailureLog.ts" && process.env.WORKER_FAILURE_LOG_MUTATION_SOURCE
    ? new URL(`file://${process.env.WORKER_FAILURE_LOG_MUTATION_SOURCE}`) : new URL(file, app);
  const code = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  const stubs: Record<string, unknown> = {
    "node:crypto": { randomUUID: () => "synthetic-event" }, "@prisma/client": { Prisma: {} },
    "@sentry/nextjs": { NodeClient: class { init() {} }, defaultStackParser: () => [], makeNodeTransport: () => ({}) },
    "../db/prisma": { prisma: file.includes("deletionJobs") ? cleanupDb : db },
    "./sentryPrivacy": { sentryServerDsn: () => "https://synthetic@example.test/1", sentryDataCollection: () => ({}), sentryBeforeSend: (event: unknown) => event },
    "./failedTurnTelemetry": {}, "../boards/turnStatus": { LIVE_TURN_IDLE_MS: 60_000 }, "../admin/turnFilters": { failedTurnWhere: () => ({}) },
    "./failedTurnRuntime": { failedTurnDeliveryEnabled: () => true },
    "./s3": { deletePrefix: () => { throw new Error("No object-store requests allowed"); } },
  };
  vm.runInNewContext(code, {
    module: compiledModule, exports: compiledModule.exports, Date: Clock, process: { env: {} },
    console: { error: (...args: unknown[]) => logs.push(args) },
    setInterval: (tick: () => void) => { timers.push(tick); return { unref() {} }; }, clearInterval: () => undefined,
    require(id: string) {
      if (id === "./workerFailureLog" || id === "../obs/workerFailureLog") return load("lib/obs/workerFailureLog.ts");
      if (id in stubs) return stubs[id];
      throw new Error(`Unexpected worker fixture import: ${id}`);
    },
  }, { filename: file });
  cache.set(file, compiledModule.exports);
  return compiledModule.exports;
}
const drain = () => new Promise<void>(resolve => setImmediate(resolve));
async function main() {
  const sentry = load("lib/obs/failedTurnSentry.ts") as { startFailedTurnSentryWorker(): () => void };
  const cleanup = load("lib/object-store/deletionJobs.ts") as { startObjectDeletionWorker(): () => void };
  const stopSentry = sentry.startFailedTurnSentryWorker();
  const stopCleanup = cleanup.startObjectDeletionWorker();
  await drain();
  assert.equal(logs.length, 3);
  assert.deepEqual(logs.map(line => JSON.parse(JSON.stringify(line[1] ?? null))), [
    { worker: "failed_turn_recovery", error_code: "database_unavailable", suppressed: 0 },
    { worker: "object_cleanup", error_code: "database_schema", suppressed: 0 },
    { worker: "failed_turn_delivery", error_code: "database_auth", suppressed: 0 },
  ], "actual worker catches must preserve bounded error categories, without logging exception bodies");
  for (let tick = 1; tick <= 30; tick++) {
    now += 10_000;
    timers.forEach(callback => callback());
    await drain();
  }
  assert.equal(logs.length, 6, "repeated outages emit once per worker/code every five minutes");
  assert.equal(recoveryPolls, 31); assert.equal(deliveryPolls, 31); assert.equal(cleanupPolls, 31);
  for (const line of logs.slice(3)) assert.equal((line[1] as { suppressed: number }).suppressed, 29);
  assert.ok(!JSON.stringify(logs).includes(privateBody));
  healthy = true;
  now += 10_000; timers.forEach(callback => callback()); await drain();
  assert.equal(logs.length, 6, "healthy workers are quiet and continue polling after recovery");
  stopSentry(); stopCleanup();
  const polls = recoveryPolls + deliveryPolls + cleanupPolls;
  timers.forEach(callback => callback()); await drain();
  assert.equal(recoveryPolls + deliveryPolls + cleanupPolls, polls, "stopped workers stay stopped");
  const classify = (load("lib/obs/workerFailureLog.ts") as { workerErrorCode(error: unknown): string }).workerErrorCode;
  for (const [error, expected] of [
    [{ errorCode: "P1001" }, "database_unavailable"], [{ code: "P1000" }, "database_auth"],
    [{ code: "P2022" }, "database_schema"], [{ code: "P2024" }, "database_timeout"],
    [{ cause: { cause: { code: "P2034" } } }, "database_conflict"], [{ name: "NoSuchBucket" }, "object_store_unavailable"],
    [{ code: privateBody, message: "P1000" }, "unknown"], [{ code: "constructor" }, "unknown"], [null, "unknown"],
  ] as const) assert.equal(classify(error), expected);
  const cycle: { cause?: unknown } = {}; cycle.cause = cycle;
  assert.equal(classify(cycle), "unknown", "cyclic SDK causes cannot hang the worker");
  console.log("Worker failure logs: real catches classify safely, throttle storms, and preserve polling/recovery");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
