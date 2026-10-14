import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import vm from "node:vm";
import { gunzipSync } from "node:zlib";
import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import ts from "typescript";
import type { FailedTurnSentryEvent } from "../../lib/obs/failedTurnTelemetry";

const app = resolve(import.meta.dirname, "../..");
const receiptsDirectory = resolve(app, "../../.context/monitor");
const require = createRequire(import.meta.url);
const container = `heytutor-sentry-verify-${randomUUID().replaceAll("-", "")}`;
const databaseName = "heytutor_sentry_verify";
const fixtureEnvironment = { NODE_ENV: "production", SENTRY_ENVIRONMENT: "production", SENTRY_RELEASE: "a".repeat(40) };
const mutationMode = process.argv.includes("--mutation-exact-date");
assert(process.argv.slice(2).every(argument => argument === "--mutation-exact-date"), "unsupported verification option");

/** This gate owns one fresh local container; it never accepts a database URL. */
function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function exactDateMutation(source: string): string {
  const parsed = ts.createSourceFile("failedTurnSentry.ts", source, ts.ScriptTarget.Latest, true);
  let target: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "matchingTurn" &&
      node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      const property = (child: ts.Node): void => {
        if (ts.isPropertyAssignment(child) && child.name.getText(parsed) === "updatedAt") target = child.initializer;
        ts.forEachChild(child, property);
      };
      property(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert(target, "the mutation must target the actual persisted-turn timestamp comparison");
  assert.notEqual(target.getText(parsed), "turn.updatedAt", "the fixed consumer must differ from exact Date equality");
  return `${source.slice(0, target.getStart(parsed))}turn.updatedAt${source.slice(target.getEnd())}`;
}

async function main(): Promise<void> {
  let ownedContainer = false;
  let database: typeof import("../../lib/db/prisma").prisma | undefined;
  let ingest: ReturnType<typeof createServer> | undefined;
  const received: Sentry.ErrorEvent[] = [];
  const receipts: string[] = [];
  try {
    // Cached PG16 avoids registry/network dependencies. The anonymous volume
    // and randomly published loopback port belong solely to this container.
    docker(["run", "--detach", "--pull=never", "--name", container,
      "--label", "heytutor.verify=sentry-db", "--publish", "127.0.0.1::5432",
      "--env", "POSTGRES_USER=sentry_fixture", "--env", "POSTGRES_PASSWORD=sentry_fixture_only",
      "--env", `POSTGRES_DB=${databaseName}`, "postgres:16-alpine"]);
    ownedContainer = true;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { docker(["exec", container, "pg_isready", "--username=sentry_fixture", `--dbname=${databaseName}`]); ready = true; break; }
      catch { await new Promise(resolveWait => setTimeout(resolveWait, 250)); }
    }
    assert(ready, "the owned disposable Postgres must become ready");
    const mapping = docker(["port", container, "5432/tcp"]);
    assert.match(mapping, /^127\.0\.0\.1:\d+$/, "Postgres must bind exclusively to loopback");
    const databaseUrl = `postgresql://sentry_fixture:sentry_fixture_only@${mapping}/${databaseName}?connection_limit=3`;
    Object.assign(process.env, fixtureEnvironment);
    process.env.DATABASE_URL = databaseUrl;
    process.env.SENTRY_ENABLED = "1";
    process.env.SENTRY_RELEASE = fixtureEnvironment.SENTRY_RELEASE;
    process.env.SENTRY_ENVIRONMENT = fixtureEnvironment.SENTRY_ENVIRONMENT;

    ingest = createServer((request, response) => {
      const parts: Buffer[] = [];
      request.on("data", (part: Buffer) => parts.push(part));
      request.on("end", () => {
        const body = Buffer.concat(parts);
        const content = request.headers["content-encoding"] === "gzip" ? gunzipSync(body) : body;
        const lines = content.toString("utf8").split("\n");
        for (let index = 1; index + 1 < lines.length; index += 2) {
          const header = JSON.parse(lines[index]!) as { type?: string };
          if (header.type === "event") received.push(JSON.parse(lines[index + 1]!) as Sentry.ErrorEvent);
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    await new Promise<void>(resolveListen => ingest!.listen(0, "127.0.0.1", resolveListen));
    const ingestAddress = ingest.address();
    assert(ingestAddress && typeof ingestAddress === "object");
    process.env.SENTRY_DSN = `http://synthetic@127.0.0.1:${ingestAddress.port}/1`;

    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--skip-generate", "--schema", resolve(app, "prisma/schema.prisma")], {
      cwd: app, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8", timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    database = (await import("../../lib/db/prisma")).prisma;
    const db = database;
    const version = await db.$queryRaw<Array<{ version: number }>>`SELECT current_setting('server_version_num')::integer AS version`;
    assert(version[0] && version[0].version >= 160_000 && version[0].version < 170_000, "the actual server must be PostgreSQL 16");
    const reporter = await import("../../lib/obs/failedTurnSentry");
    const historical = await import("../live/queue-historical-failed-turns");
    const privacy = await import("../../lib/obs/sentryPrivacy");
    const telemetry = await import("../../lib/obs/failedTurnTelemetry");
    const runtime = await import("../../lib/obs/failedTurnRuntime");
    const turnStatus = await import("../../lib/boards/turnStatus");
    const turnFilters = await import("../../lib/admin/turnFilters");
    const source = readFileSync(resolve(app, "lib/obs/failedTurnSentry.ts"), "utf8");
    const loadMutantQueue = (): typeof reporter.queueFailedTurnSentry => {
      const code = ts.transpileModule(exactDateMutation(source), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      const dependencies: Record<string, unknown> = {
        "node:crypto": { randomUUID }, "@prisma/client": { Prisma }, "@sentry/nextjs": Sentry,
        "../db/prisma": { prisma: db }, "./sentryPrivacy": privacy, "./failedTurnTelemetry": telemetry,
        "./failedTurnRuntime": runtime,
        "../boards/turnStatus": turnStatus, "../admin/turnFilters": turnFilters,
      };
      const compiledModule: { exports: Partial<typeof reporter> } = { exports: {} };
      vm.runInNewContext(code, { exports: compiledModule.exports, module: compiledModule,
        require: (name: string) => { assert(name in dependencies, `unmapped mutation dependency: ${name}`); return dependencies[name]; },
        process: { env: fixtureEnvironment }, Date, console, setInterval, clearInterval,
      });
      assert(compiledModule.exports.queueFailedTurnSentry);
      return compiledModule.exports.queueFailedTurnSentry;
    };
    const queue = mutationMode ? loadMutantQueue() : reporter.queueFailedTurnSentry;
    const user = await db.user.create({ data: { id: `synthetic-sentry-db-${randomUUID()}` } });
    const board = await db.board.create({ data: { id: randomUUID(), userId: user.id } });
    let orderIndex = 0;
    const makeMicrosecondTurn = async () => {
      const turn = await db.turn.create({ data: {
        boardId: board.id, userId: user.id, orderIndex: orderIndex++, question: "Synthetic historical question",
        rawResponse: "Synthetic retained teaching", status: "complete", visualStatus: "retry_required",
        sceneArtifacts: { failureTelemetry: { subject: "physics", stage: "validation", code: "candidate_invalid" } },
        segments: { create: { orderIndex: 0, narration: "Synthetic retained teaching", spokenText: "Synthetic retained teaching" } },
      } });
      await db.$executeRaw`UPDATE turns SET updated_at = '2026-10-01 10:00:00.123456+00'::timestamptz WHERE id = ${turn.id}::uuid`;
      const row = await db.turn.findUniqueOrThrow({ where: { id: turn.id }, include: { segments: true } });
      const precision = await db.$queryRaw<Array<{ timestamp: string }>>`SELECT to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS.US') AS timestamp FROM turns WHERE id = ${turn.id}::uuid`;
      assert(precision[0]?.timestamp.endsWith("123456"), "the actual DB fixture must retain six fractional timestamp digits");
      assert.equal(row.updatedAt.getUTCMilliseconds(), 123, "Prisma's Date contains millisecond precision only");
      return row;
    };

    const first = await makeMicrosecondTurn();
    const eventId = await db.$transaction(tx => queue(tx, first, { historical: true, env: fixtureEnvironment }));
    assert(eventId, "microsecond historical row must reserve its Sentry event through actual Prisma CAS");
    const persisted = await db.turn.findUniqueOrThrow({ where: { id: first.id }, include: { segments: true } });
    assert.equal(persisted.updatedAt.getTime(), first.updatedAt.getTime(), "queue writes must preserve the original activity Date value");
    const persistedEvent = persisted.sentryFailureEvent as unknown as FailedTurnSentryEvent;
    const repeatedId = await db.$transaction(tx => queue(tx, persisted, { historical: true, env: fixtureEnvironment, now: new Date(Date.now() + 1_000) }));
    const repeated = await db.turn.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(repeatedId, eventId, "actual repeated saves reuse one event identity");
    assert.equal((repeated.sentryFailureEvent as unknown as FailedTurnSentryEvent).timestamp, persistedEvent.timestamp, "actual repeated saves retain the deduplication timestamp");
    receipts.push("PG16 microsecond historical timestamp queues through actual Prisma; repeated save preserves event identity, timestamp and activity Date");

    for (const changed of ["status", "visualStatus", "updatedAt"] as const) {
      const stale = await makeMicrosecondTurn();
      if (changed === "status") await db.turn.update({ where: { id: stale.id }, data: { status: "stopped", updatedAt: stale.updatedAt } });
      else if (changed === "visualStatus") await db.turn.update({ where: { id: stale.id }, data: { visualStatus: "validated", updatedAt: stale.updatedAt } });
      else await db.$executeRaw`UPDATE turns SET updated_at = updated_at + INTERVAL '1 millisecond' WHERE id = ${stale.id}::uuid`;
      assert.equal(await db.$transaction(tx => queue(tx, stale, { historical: true, env: fixtureEnvironment })), null, `stale ${changed} cannot queue a snapshot after a concurrent checkpoint`);
      assert.equal((await db.turn.findUniqueOrThrow({ where: { id: stale.id } })).sentryEventId, null);
      await db.turn.delete({ where: { id: stale.id } });
    }
    receipts.push("real database status, visual-status and timestamp CAS reject stale checkpoint snapshots");

    await makeMicrosecondTurn();
    const firstHistoricalApply = await historical.queueHistoricalFailedTurns(db, { apply: true, limit: 25 });
    assert.equal(firstHistoricalApply.eligible, 1); assert.equal(firstHistoricalApply.queued, 1);
    const secondHistoricalApply = await historical.queueHistoricalFailedTurns(db, { apply: true, limit: 25 });
    assert.equal(secondHistoricalApply.eligible, 0); assert.equal(secondHistoricalApply.queued, 0,
      "a second historical apply must not keep selecting an unqueueable microsecond row");
    await makeMicrosecondTurn();
    await makeMicrosecondTurn();
    const dry = await historical.queueHistoricalFailedTurns(db, { apply: false, limit: 1 });
    assert.deepEqual({ eligible: dry.eligible, scanned: dry.scanned, queued: dry.queued }, { eligible: 2, scanned: 1, queued: 0 });
    assert.equal(await db.turn.count({ where: { sentryEventId: { not: null } } }), 2, "read-only backfill preview cannot reserve an event");
    const apply = await historical.queueHistoricalFailedTurns(db, { apply: true, limit: 1 });
    assert.deepEqual({ eligible: apply.eligible, scanned: apply.scanned, queued: apply.queued }, { eligible: 2, scanned: 1, queued: 1 });
    const next = await historical.queueHistoricalFailedTurns(db, { apply: true, limit: 1 });
    assert.equal(next.eligible, 1); assert.equal(next.queued, 1);
    const done = await historical.queueHistoricalFailedTurns(db, { apply: true, limit: 1 });
    assert.equal(done.eligible, 0); assert.equal(done.scanned, 0); assert.equal(done.queued, 0);
    receipts.push("actual historical script reaches eligible zero on its second apply, executes read-only preview and honors one-row apply limits");

    const drained = await reporter.runFailedTurnSentryBatch({ now: new Date(Date.now() + 2_000) });
    assert.equal(drained.reported, 4); assert.equal(drained.pending, 0);
    assert.equal(received.length, 4, "actual NodeClient/loopback transport delivers exactly one event per queued turn");
    assert.equal(new Set(received.map(event => event.event_id)).size, 4);
    for (const event of received) {
      assert.equal(event.level, "warning");
      assert.deepEqual(event.fingerprint, ["turn-failure", "validation", "candidate_invalid", "physics"]);
      assert.equal(event.tags?.area, "turn-failure");
      assert.equal(event.tags?.environment, "production", "historical events belong to the configured runtime environment");
      assert(!JSON.stringify(event).includes("Synthetic"), "retained question and narration cannot reach the actual transport");
      assert(!JSON.stringify(event).includes(user.id) && !JSON.stringify(event).includes(board.id), "actual transport excludes persistent account and board identities");
    }
    const reports = await db.turn.findMany({ select: { sentryEventId: true, sentryReportedAt: true, sentryFailureEvent: true, updatedAt: true } });
    assert.deepEqual(new Set(received.map(event => event.event_id)), new Set(reports.map(row => row.sentryEventId)),
      "real SDK event identities must match the reservations used by admin links");
    assert(reports.every(row => row.sentryReportedAt && row.sentryFailureEvent === null));
    assert(reports.every(row => row.updatedAt.getTime() === first.updatedAt.getTime()), "lease and acknowledgement SQL cannot update lesson activity");
    assert.equal((await reporter.runFailedTurnSentryBatch({ now: new Date(Date.now() + 86_400_000) })).reported, 0);
    assert.equal(received.length, 4, "a repeated actual database drain cannot report any turn twice");
    receipts.push("real outbox lease/acknowledgement SQL and dedicated NodeClient deliver four clean events exactly once; subsequent drain stays empty");

    const mutationFixture = await makeMicrosecondTurn();
    const mutant = loadMutantQueue();
    let mutationFailure: unknown;
    try {
      assert(await db.$transaction(tx => mutant(tx, mutationFixture, { historical: true, env: fixtureEnvironment })),
        "microsecond historical row must reserve its Sentry event through actual Prisma CAS");
    } catch (error) { mutationFailure = error; }
    assert(mutationFailure instanceof assert.AssertionError && /microsecond historical row must reserve/.test(mutationFailure.message),
      "restoring exact Date equality must fail the same database invariant, not module setup");
    await db.turn.delete({ where: { id: mutationFixture.id } });
    receipts.push("exact-Date CAS source mutation turns the real-database microsecond invariant RED");
    const receipt = { gate: "sentry-db", status: "PASS", postgres: 16, receipts, productionActions: 0, providerCalls: 0 };
    mkdirSync(receiptsDirectory, { recursive: true });
    writeFileSync(resolve(receiptsDirectory, "sentry-db-gate.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify(receipt));
  } finally {
    await database?.$disconnect();
    if (ingest) await new Promise<void>(resolveClose => ingest!.close(() => resolveClose()));
    if (ownedContainer) docker(["rm", "--force", "--volumes", container]);
  }
}

void main().catch((error: unknown) => {
  // Fixtures are synthetic; avoid dumping ORM connection/configuration errors.
  console.error(error instanceof assert.AssertionError ? error.message : "Disposable Sentry database verification failed");
  process.exitCode = 1;
});
