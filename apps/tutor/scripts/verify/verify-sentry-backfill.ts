import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as telemetry from "../../lib/obs/failedTurnTelemetry";
import * as runtime from "../../lib/obs/failedTurnRuntime";
import * as workerFailureLog from "../../lib/obs/workerFailureLog";
import * as privacy from "../../lib/obs/sentryPrivacy";
import * as turnStatus from "../../lib/boards/turnStatus";
import * as classification from "../../lib/obs/turnFailureClassification";
import * as billingErrors from "../../lib/billing/errors";
import type { queueFailedTurnSentry } from "../../lib/obs/failedTurnSentry";

function load<T>(file: string, dependencies: Record<string, unknown>, override?: string): T {
  const compiled = { exports: {} };
  const source = readFileSync(resolve(override ?? file), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, {
    module: compiled, exports: compiled.exports, Date, process: { env: {} },
    require: (name: string) => {
      assert(name in dependencies, `unexpected dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename: file });
  return compiled.exports as T;
}

const builder = process.env.SENTRY_BACKFILL_TEST_TELEMETRY_SOURCE ? load<typeof telemetry>(
  "lib/obs/failedTurnTelemetry.ts", {
    "../boards/turnStatus": turnStatus, "./turnFailureClassification": classification,
    "./failedTurnRuntime": runtime,
    "../billing/errors": billingErrors,
  }, process.env.SENTRY_BACKFILL_TEST_TELEMETRY_SOURCE,
) : telemetry;
const finalPrivacy = process.env.SENTRY_BACKFILL_TEST_PRIVACY_SOURCE ? load<typeof privacy>(
  "lib/obs/sentryPrivacy.ts", {
    "./failedTurnTelemetry": builder, "./sentryTunnel": { SENTRY_TUNNEL_PATH: "/monitoring" },
  }, process.env.SENTRY_BACKFILL_TEST_PRIVACY_SOURCE,
) : privacy;
const env = { NODE_ENV: "production", SENTRY_ENVIRONMENT: "production", SENTRY_RELEASE: "a".repeat(40) };
const now = new Date("2026-10-15T00:00:00.000Z");
const failed: telemetry.FailedTurnInput = {
  status: "complete", visualStatus: "text_only", updatedAt: now,
  sceneArtifacts: { degradation: { reason: "missing_capability" }, failureTelemetry: { subject: "physics" } },
  segments: [{ narration: "Synthetic teaching" }],
};
const historical = builder.buildFailedTurnSentryEvent(failed, env, { historical: true, now })!;
assert.equal(historical.tags.reporting_origin, "backfill", "backfills never match the live-alert filter");
assert.equal(historical.environment, "production", "environment describes the actual emitter");
assert.equal(historical.release, "unknown", "backfills do not inherit the new release");
assert.equal(builder.buildFailedTurnSentryEvent(failed, env, { now })!.tags.reporting_origin, "live");
assert.equal(finalPrivacy.scrubSentryEvent(structuredClone(historical)).tags.reporting_origin, "backfill");
const hostile = finalPrivacy.scrubSentryEvent({ ...structuredClone(historical), tags: {
  ...historical.tags, reporting_origin: "synthetic-private@example.test",
} });
assert.equal(hostile.tags.reporting_origin, "unknown", "the final scrub independently allowlists origin");
assert(!JSON.stringify(hostile).includes("synthetic-private"));

type Receipt = telemetry.FailedTurnInput & {
  id: string; sentryEventId: string | null; sentryFailureEvent: unknown; sentryReportedAt: Date | null;
};
const row: Receipt = { ...failed, id: "synthetic-turn", sentryEventId: null, sentryFailureEvent: null, sentryReportedAt: null };
const tx = { turn: {
  findFirst: async () => row,
  updateMany: async ({ data }: { data: Partial<Receipt> }) => { Object.assign(row, data); return { count: 1 }; },
} };
const reporter = load<{ queueFailedTurnSentry: typeof queueFailedTurnSentry }>("lib/obs/failedTurnSentry.ts", {
  "node:crypto": {}, "@prisma/client": { Prisma: { DbNull: null } }, "@sentry/nextjs": {},
  "../db/prisma": {}, "./sentryPrivacy": privacy, "./failedTurnTelemetry": builder,
  "../boards/turnStatus": turnStatus, "../admin/turnFilters": {}, "./failedTurnRuntime": runtime,
  "./workerFailureLog": workerFailureLog,
}, process.env.SENTRY_BACKFILL_TEST_REPORTER_SOURCE);
const queue = (historical?: boolean) => reporter.queueFailedTurnSentry(
  tx as unknown as Parameters<typeof queueFailedTurnSentry>[0], { ...row },
  { env, now, historical, eventId: "b".repeat(32) },
);
const payload = () => row.sentryFailureEvent as telemetry.FailedTurnSentryEvent;
async function verify(): Promise<void> {
  await queue(true);
  const timestamp = payload().timestamp;
  await queue();
  assert.equal(payload().tags.reporting_origin, "backfill", "ordinary saves cannot relabel pending backfills");
  row.visualStatus = "validated";
  await queue();
  assert.deepEqual(JSON.parse(JSON.stringify(row.sentryFailureEvent)), { timestamp, reporting_origin: "backfill" },
    "cancelled reservations retain only content-free identity metadata");
  row.visualStatus = "text_only";
  await queue();
  assert.equal(payload().tags.reporting_origin, "backfill", "resume/re-abandon cannot relabel backfills");
  assert.equal(payload().timestamp, timestamp);
  assert.equal(row.sentryEventId, "b".repeat(32));

  const runbook = readFileSync(resolve("../../docs/ops/failed-turn-sentry.md"), "utf8");
  assert.equal((runbook.match(/area:turn-failure environment:production reporting_origin:live/g) ?? []).length, 2,
    "both alert rules must positively select live events, excluding backfill and unknown origins");
  console.log("Sentry backfill isolation: origin privacy, refresh/cancel/resume stability and both live-only alerts pass; no network calls");
}
void verify().catch(error => { console.error(error); process.exitCode = 1; });
