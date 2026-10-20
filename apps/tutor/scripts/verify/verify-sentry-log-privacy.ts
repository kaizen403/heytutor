import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as Sentry from "@sentry/nextjs";
import * as realPrivacy from "../../lib/obs/sentryPrivacy";
import * as telemetry from "../../lib/obs/failedTurnTelemetry";
import { SENTRY_TUNNEL_PATH } from "../../lib/obs/sentryTunnel";

const root = resolve(import.meta.dirname, "../..");
let checks = 0;
function check(condition: unknown, message: string): asserts condition { assert(condition, message); checks++; }
function load<T>(source: string, dependencies: Record<string, unknown>, consoleFixture = console): T {
  const compiledModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: compiledModule.exports, module: compiledModule, console: consoleFixture,
    process: { env: {} }, require: (name: string) => { assert(name in dependencies, `unexpected dependency ${name}`); return dependencies[name]; },
  }, { filename: source });
  return compiledModule.exports as T;
}
const privacy = process.env.SENTRY_LOG_PRIVACY_MUTATION_SOURCE ? load<typeof realPrivacy>(process.env.SENTRY_LOG_PRIVACY_MUTATION_SOURCE, {
  "./failedTurnTelemetry": telemetry, "./sentryTunnel": { SENTRY_TUNNEL_PATH },
}) : realPrivacy;
const privateText = "SYNTHETIC_PRIVATE_QUESTION fixture@example.test synthetic-board-id";
check(privacy.sentryBeforeSendLog({ message: privateText }) === null, "unknown freeform console content never reaches Sentry logs");
const clean = privacy.sentryBeforeSendLog({ message: "[sentry] failed-turn recovery unavailable; events remain queued", attributes: { user: { text: privateText }, question: privateText }, arbitrary: privateText });
check(clean !== null && !JSON.stringify(clean).includes(privateText), "approved operational messages discard arbitrary top-level and nested data");
const http = privacy.sentryBeforeSendLog({ message: `[http] GET /api/boards/synthetic-board-id/turns/synthetic-turn-id?token=secret 403 12ms token=raw` });
check(http?.message === "[http] GET /api/boards/:boardId/turns/:turnId 403 12ms", "HTTP routes replace identities and drop query/trailing text entirely");
check(privacy.sentryBeforeSendLog({ message: `[http] GET /api/${privateText.replaceAll(" ", "_")} 200 12ms` }) === null, "unknown request routes cannot carry arbitrary path text");
for (let i = 0; i < 2000; i++) {
  const sentinel = `${privateText}_${i}`;
  const output = privacy.sentryBeforeSendLog({ message: "[turn-save-rejected] arbitrary trailing content", attributes: {
    "sentry.message.parameter.0": { code: i % 2 ? "trace_mismatch" : sentinel, status: i % 2 ? 409 : sentinel, entryPoint: i % 2 ? "checkpoint_put" : sentinel, boardId: sentinel, nested: [sentinel] },
    [sentinel]: { nested: sentinel },
  }, nested: { student: sentinel } });
  check(output !== null && !JSON.stringify(output).includes(sentinel), "nested identity/question fuzz is absent from approved logs");
}

for (const message of ["[sentry] failed-turn recovery unavailable; events remain queued", "[sentry] failed-turn delivery unavailable; events remain queued", "[objects] cleanup worker failed; durable jobs remain queued"]) {
  const input: realPrivacy.SentryLogEvent = { message, attributes: { "sentry.message.parameter.0": { worker: privateText, error_code: "database_schema", suppressed: 14, question: privateText } } };
  const log = privacy.sentryBeforeSendLog(input);
  check(log?.attributes?.error_code === "database_schema" && log.attributes.suppressed === 14, "bounded worker error diagnostics survive without supplied identity");
  check(!JSON.stringify(log).includes(privateText), "worker enum is derived from the fixed message");
}
const fakeEntryPoint = privacy.sentryBeforeSendLog({ message: "[turn-save-rejected]", attributes: { entryPoint: { toString: () => "checkpoint_put", question: privateText } } });
check(!JSON.stringify(fakeEntryPoint).includes(privateText), "non-string enum lookalikes cannot carry nested content");
const eventEnvelope: Parameters<typeof privacy.scrubSentryLogEnvelope>[0] = [{ event_id: "e".repeat(32), sent_at: "2026-10-21T00:00:00Z" }, [[{ type: "event" }, { message: "unchanged exception control" }]]];
const eventBefore = JSON.stringify(eventEnvelope); privacy.scrubSentryLogEnvelope(eventEnvelope);
check(JSON.stringify(eventEnvelope) === eventBefore, "non-log exception and client-report envelopes remain untouched");

const unknownFields: realPrivacy.SentryLogEvent = { message: "[turn-save-rejected]", attributes: { code: privateText, status: privateText, entryPoint: privateText } };
const unknownOutput = privacy.sentryBeforeSendLog(unknownFields);
check(unknownOutput?.attributes?.code === "unknown" && unknownOutput.attributes.status === "unknown" && unknownOutput.attributes.entryPoint === "unknown", "unknown save enums and status use fixed unknown values");
const clientReport: Parameters<typeof privacy.scrubSentryLogEnvelope>[0] = [{}, [[{ type: "client_report" }, { timestamp: 1, discarded_events: [{ reason: "before_send", category: "log_item", quantity: 1 }] }]]];
const reportBefore = JSON.stringify(clientReport); privacy.scrubSentryLogEnvelope(clientReport);
check(JSON.stringify(clientReport) === reportBefore, "SDK client-report protocol remains untouched");

const warnings: unknown[][] = [];
const producer = load<{ rejectTurnSave: (...args: unknown[]) => unknown }>(process.env.SENTRY_LOG_PRODUCER_MUTATION_SOURCE ?? resolve(root, "lib/boards/turnSaveRejection.ts"), {
  "next/server": { NextResponse: { json: (body: unknown, options: unknown) => ({ body, options }) } },
}, { ...console, warn: (...args: unknown[]) => warnings.push(args) });
const response = producer.rejectTurnSave("trace_mismatch", privateText, 409, { boardId: "a".repeat(32), turnId: "b".repeat(32), traceId: "c".repeat(32), entryPoint: "checkpoint_put" }, { serverCount: 2 });
check(!JSON.stringify(warnings).includes("a".repeat(32)) && !JSON.stringify(warnings).includes("b".repeat(32)) && !JSON.stringify(warnings).includes("c".repeat(32)), "save rejection console producer never emits correlation identities");
check(JSON.stringify(response).includes(privateText) && JSON.stringify(response).includes('"serverCount":2'), "save rejection HTTP response and recovery fields remain unchanged");

async function main() {
  const sent: unknown[] = [];
  const client = new Sentry.NodeClient({
    dsn: "https://synthetic@example.ingest.sentry.io/1", stackParser: Sentry.defaultStackParser,
    integrations: [privacy.sentryLogPrivacyIntegration()],
    beforeSendLog: privacy.sentryBeforeSendLog,
    dataCollection: privacy.sentryDataCollection(),
    transport: () => ({ send: async envelope => { sent.push(JSON.parse(JSON.stringify(envelope))); return { statusCode: 200 }; }, flush: async () => true }),
  });
  client.init();
  const scope = new Sentry.Scope();
  scope.setClient(client);
  scope.setPropagationContext({ ...scope.getPropagationContext(), traceId: "d".repeat(32) });
  scope.setAttribute("question", privateText);
  scope.setAttribute("user.id", privateText);
  scope.setAttribute("unexpected.nested", privateText);
  Sentry.withScope(scope, () => {
    Sentry.logger.warn("[sentry] failed-turn recovery unavailable; events remain queued", { error_code: "database_schema", suppressed: 14, arbitrary: { nested: privateText } });
    Sentry.logger.warn("[turn-save-rejected]", { code: "trace_mismatch", status: 409, entryPoint: "checkpoint_put", boardId: privateText });
    Sentry.logger.warn(privateText);
  });
  check(await client.flush(2000), "actual installed SDK flushes into fake in-process transport");
  const wire = JSON.stringify(sent);
  check(!wire.includes(privateText), "final serialized SDK envelope removes scope attributes reinserted after beforeSendLog");
  check(wire.includes("failed-turn recovery unavailable") && wire.includes("trace_mismatch"), "known worker and save rejection diagnostics survive actual serialization");
  check(wire.includes('"timestamp"') && wire.includes('"level"') && wire.includes('"trace_id":"' + "d".repeat(32)), "SDK timestamp/level/generated trace protocol fields survive");
  check(wire.includes("database_schema") && wire.includes('"suppressed"'), "bounded worker diagnostics survive actual final serialization");
  await client.close();
  console.log(`Sentry log privacy: ${checks} checks passed, 2000 nested synthetic cases and real SDK fake transport; no network`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
