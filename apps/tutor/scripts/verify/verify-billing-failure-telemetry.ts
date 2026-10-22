import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as ts from "typescript";
import * as Sentry from "@sentry/nextjs";
import * as telemetry from "../../lib/obs/failedTurnTelemetry";
import { sentryBeforeSend } from "../../lib/obs/sentryPrivacy";
import { lessonPageRecord } from "../../features/tutor-session/lib/turn/doubtTurn";
import { liveTurnScene } from "../../features/tutor-session/lib/turn/liveTurnSave";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

// Exercise the actual teaching catch assignment, not a duplicate classifier.
const source = readFileSync(new URL("../../features/tutor-session/hooks/turn/useQuestionHandler.ts", import.meta.url), "utf8");
const start = source.indexOf("const billing = parseBillingFailureFromUnknown(error);");
assert.ok(start > 0);
const stop = source.indexOf("let message =", start);
const assignment = ts.transpileModule(source.slice(start, stop), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const privateText = "Synthetic private question synthetic-student@example.test";
const cases = [
  [429, "concurrent_limit", "rate_limit"], [429, "rate_limited", "rate_limit"],
  [402, "out_of_credits", "budget_limit"], [402, "no_grant", "budget_limit"],
  [402, "retry_budget", "budget_limit"],
  [503, "autumn_unavailable", "provider_error"], [401, "unauthorized", "provider_error"],
] as const;

async function main() {
  const events: Sentry.ErrorEvent[] = [];
  const client = new Sentry.NodeClient({
    dsn: "https://synthetic@example.test/1", integrations: [], stackParser: Sentry.defaultStackParser,
    enableOpenTelemetrySetup: false, sendClientReports: false, beforeSend: sentryBeforeSend,
    transport: () => ({ send: async envelope => {
      for (const [header, payload] of envelope[1]) if (header.type === "event") events.push(JSON.parse(JSON.stringify(payload)) as Sentry.ErrorEvent);
      return { statusCode: 202 };
    }, flush: async () => true }),
  });
  client.init();
  for (const [status, billingCode, code] of cases) {
    const page = lessonPageRecord("synthetic-board", "Synthetic admission test");
    page.failureTelemetry = { subject: "chemistry" };
    vm.runInNewContext(assignment, { page, error: {}, parseBillingFailureFromUnknown: () => ({ status, code: billingCode, remaining: null }),
      TeachingTransportError: class extends Error {}, ...telemetry });
    const scene = liveTurnScene({ page, kind: "lesson", preview: "", opensPage: true, status: "stopped", textOnly: true });
    const canonical = await canonicalizeTurnSceneMetadata({ ...scene, question: "Synthetic admission test", segments: [] });
    assert.ok(canonical.ok, "the actual live checkpoint payload must survive server canonicalization");
    const stored = telemetry.readFailedTurnTelemetry(canonical.value.sceneArtifacts?.failureTelemetry);
    assert.equal(stored?.code, code, `HTTP ${status}/${billingCode} must retain the right failure class`);
    const event = telemetry.buildFailedTurnSentryEvent({ status: "stopped", visualStatus: canonical.value.visualStatus,
      sceneArtifacts: canonical.value.sceneArtifacts, segments: [],
    }, { NODE_ENV: "production", SENTRY_ENVIRONMENT: "production" })!;
    assert.equal(event.tags.billing_code, billingCode, "the persisted event must retain only an approved denial enum");
    const id = String(cases.indexOf(cases.find(item => item[1] === billingCode)!) + 1).padStart(32, "0");
    const scope = new Sentry.Scope();
    scope.setUser({ id: privateText, email: "synthetic-student@example.test" });
    scope.setExtra("question", privateText);
    const before = events.length;
    client.captureEvent({ ...event, event_id: id }, { event_id: id }, scope);
    await client.flush(1000);
    assert.equal(events.length, before + 1, "each failed turn emits exactly one SDK event");
    assert.equal(events.at(-1)?.tags?.billing_code, billingCode);
    assert.ok(!JSON.stringify(events.at(-1)).includes(privateText), "dirty scope content must not cross the final boundary");
    const hostile = sentryBeforeSend({ ...event, type: undefined, tags: { ...event.tags, billing_code: privateText } });
    assert.equal(hostile.tags?.billing_code, "unknown", "the final privacy allowlist independently rejects arbitrary billing codes");
  }
  assert.equal(telemetry.readFailedTurnTelemetry({ subject: "physics", billingCode: privateText })?.billingCode, undefined);
  await client.close();
  console.log("Billing telemetry: actual teaching catch → live checkpoint → server canonicalization → one clean SDK event; limits/outages distinguished");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
