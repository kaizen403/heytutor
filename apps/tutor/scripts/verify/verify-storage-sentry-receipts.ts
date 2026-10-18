import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../../lib/boards/storageAccounting.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiledModule = { exports: {} as { storageAccountingFingerprint(snapshot: unknown): string } };
vm.runInNewContext(source, { module: compiledModule, exports: compiledModule.exports, require: (name: string) => {
  if (name === "node:crypto") return { createHash };
  if (["@/lib/object-store/keys", "@/lib/object-store/mediaUrl", "@/lib/object-store/s3"].includes(name)) return {};
  throw new Error(`Unexpected storage dependency: ${name}`);
} });
const fingerprint = compiledModule.exports.storageAccountingFingerprint;
const snapshot = { userId: "synthetic-owner", storage: { reservedBytes: 0n, pendingTurns: 0 }, notes: [], jobs: [], boards: [],
  turns: [{ id: "synthetic-turn", question: "Synthetic retained lesson", rawResponse: "Synthetic teaching", sceneArtifacts: { failureTelemetry: { failed: true } },
    segments: [{ narration: "Synthetic saved paragraph" }], sentryEventId: null, sentryFailureEvent: null, sentryReportedAt: null, sentryNextAttemptAt: null }] };
const initial = fingerprint(snapshot);
const receiptChanged = structuredClone(snapshot);
Object.assign(receiptChanged.turns[0]!, { sentryEventId: "a".repeat(32), sentryFailureEvent: { extra: { segment_count: 1 } },
  sentryReportedAt: new Date(), sentryNextAttemptAt: new Date() });
assert.equal(fingerprint(receiptChanged), initial, "queueing, leasing and delivery cannot invalidate storage measurement");
for (const change of [
  (value: typeof snapshot) => { value.turns[0]!.rawResponse += " more teaching"; },
  (value: typeof snapshot) => { value.turns[0]!.sceneArtifacts.failureTelemetry.failed = false; },
  (value: typeof snapshot) => { value.turns[0]!.segments[0]!.narration += " changed"; },
]) {
  const changed = structuredClone(snapshot); change(changed);
  assert.notEqual(fingerprint(changed), initial, "retained lesson changes must invalidate concurrent measurements");
}
console.log("Sentry outbox receipts preserve storage snapshot concurrency; lesson edits still invalidate it");
