import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  buildFigureCheckSummary,
  parseFigureCheckAnswer,
  scheduleFigureCheckCases,
  resolveAnchorFigurePath,
  assertFigureCheckInputUnchanged,
  VisionSpendCap,
  figureCheckRuntime,
  prepareFigureCheckInput,
  type FigureCheckResult,
} from "../lecture-lab/figureRelevanceCheck";
const offlineRuntime = figureCheckRuntime(true, { provider: "azure", deployment: "gpt-6-1-sol", model: ["gpt-6-1-sol"] });
assert.equal(offlineRuntime.endpoint.apiKey, undefined);
assert.deepEqual(offlineRuntime.models, ["gpt-6-1-sol"], "offline rescoring uses saved deployment without credentials");
assert.throws(() => figureCheckRuntime(false, {}, offlineRuntime.endpoint), /configured Azure/);
const priorInput = { id: "row", question: "q", imageSha256: "abc" };
assertFigureCheckInputUnchanged(priorInput, { ...priorInput, referenceVerdict: "partial" });
assert.throws(() => assertFigureCheckInputUnchanged(priorInput, { ...priorInput, imageSha256: "def" }), /changed/);
assert.throws(() => assertFigureCheckInputUnchanged(priorInput, { ...priorInput, question: "different" }), /changed/);
const cropFixture = mkdtempSync(join(tmpdir(), "heytutor-retained-crop-"));
try {
  const source = join(cropFixture, "original.png");
  const retained = join(cropFixture, "legacy-sips.png");
  writeFileSync(source, "synthetic original bytes");
  writeFileSync(retained, "synthetic different-encoder bytes");
  const input = { id: "legacy", question: "q", source: "synthetic", subject: "maths",
    imagePath: source, referenceVerdict: "partial" as const };
  const prior = { ...input, imagePath: retained, imageSha256: createHash("sha256").update("synthetic different-encoder bytes").digest("hex") };
  const resumed = prepareFigureCheckInput(input, cropFixture, prior);
  assert.equal(resumed.imagePath, retained, "completed legacy predictions reuse their actual input, never a new encoder's PNG");
  assert.equal(resumed.imageSha256, prior.imageSha256);
  assert.equal(resumed.cropProvenance, "legacy_retained");
  assert.equal(resumed.sourceImageSha256, undefined, "legacy source identity cannot be invented retroactively");
  assert.throws(() => prepareFigureCheckInput({ ...input, question: "changed" }, cropFixture, prior), /changed/);
  assert.throws(() => prepareFigureCheckInput(input, cropFixture, { ...prior, sourceImageSha256: "changed" }), /source image changed/);
  writeFileSync(retained, "tampered");
  assert.throws(() => prepareFigureCheckInput(input, cropFixture, prior), /saved figure-check image changed/);
} finally { rmSync(cropFixture, { recursive: true, force: true }); }
assert.equal(resolveAnchorFigurePath("../data/diagram-eval/v1/anchor-images/card.png", "/repo"), "/repo/data/diagram-eval/v1/anchor-images/card.png");
assert.equal(resolveAnchorFigurePath("/private/card.png", "/repo"), "/private/card.png");

assert.deepEqual(parseFigureCheckAnswer('{"answer":"yes","reason":"It shows the requested circuit."}'), {
  answer: "yes",
  reason: "It shows the requested circuit.",
});
assert.deepEqual(parseFigureCheckAnswer("```json\n{\"answer\":\"no\",\"reason\":\"Wrong graph shape.\"}\n```"), {
  answer: "no",
  reason: "Wrong graph shape.",
});
assert.throws(
  () => parseFigureCheckAnswer('{"answer":"maybe","reason":"unclear"}'),
  /yes or no/,
);
assert.throws(
  () => parseFigureCheckAnswer('{"answer":"no","reason":"one two three four five six seven eight nine ten eleven twelve thirteen"}'),
  /12 words/,
);
const ordered = scheduleFigureCheckCases([
  { id: "a1", source: "a", subject: "physics" },
  { id: "a2", source: "a", subject: "physics" },
  { id: "b1", source: "b", subject: "physics" },
  { id: "m1", source: "a", subject: "maths" },
  { id: "anchor", source: "codex-reference-anchors", subject: "physics" },
]);
assert.deepEqual(ordered.map((row) => row.id), ["anchor", "a1", "b1", "m1", "a2"],
  "check anchors first, then interleave source/subject groups so a cap cannot consume only the first arm");

const cap = new VisionSpendCap(0.03);
assert.equal(cap.tryReserve(0.02), true);
assert.equal(cap.tryReserve(0.02), false, "in-flight reservations must count against the cap");
cap.settle(0.02, 0.005);
assert.equal(cap.tryReserve(0.02), true);
cap.settle(0.02, null);
assert.deepEqual(cap.snapshot(), {
  maxUsd: 0.03,
  chargedUsd: 0.025,
  reservedUsd: 0,
  stoppedForBudget: false,
  unknownUsageCalls: 1,
});
const resumedCap = new VisionSpendCap(0.03);
resumedCap.restoreCharge(0.02);
assert.equal(resumedCap.tryReserve(0.02), false, "resumed calls must retain earlier spend");

const results: FigureCheckResult[] = [
  {
    id: "wrong-blocked",
    source: "part12-current",
    subject: "physics",
    question: "q",
    imagePath: "a.png",
    referenceVerdict: "wrong",
    answer: "no",
    reason: "Wrong structure.",
    model: "vision",
    latencyMs: 10,
    usage: { input: 100, output: 10 },
    costUsd: 0.001,
  },
  {
    id: "wrong-missed",
    source: "part14a",
    subject: "maths",
    question: "q",
    imagePath: "b.png",
    referenceVerdict: "wrong",
    answer: "yes",
    reason: "Looks relevant.",
    model: "vision",
    latencyMs: 30,
    usage: { input: 100, output: 10 },
    costUsd: 0.001,
  },
  {
    id: "good-blocked",
    source: "codex-reference-anchors",
    subject: "chemistry",
    question: "q",
    imagePath: "c.png",
    referenceVerdict: "partial",
    answer: "no",
    reason: "Missing detail.",
    model: "vision",
    latencyMs: 20,
    usage: { input: 100, output: 10 },
    costUsd: 0.001,
  },
];
const summary = buildFigureCheckSummary(results, 1, false);
assert.deepEqual(summary.overall.wrong, { total: 2, blocked: 1, share: 0.5 });
assert.deepEqual(summary.overall.good, { total: 1, wronglyBlocked: 1, share: 1 });
assert.equal(summary.bySubject.physics?.wrong.blocked, 1);
assert.equal(summary.bySubject.maths?.wrong.blocked, 0);
assert.equal(summary.bySubject.chemistry?.good.wronglyBlocked, 1);
assert.deepEqual(summary.latencyMs, { p50: 20, p90: 30 });
assert.equal(summary.cost.totalUsd, 0.003);
assert.equal(summary.cost.perFigureUsd, 0.001);
assert.deepEqual(summary.misses.wrongNotBlocked.map((row) => row.id), ["wrong-missed"]);
assert.deepEqual(summary.misses.goodWronglyBlocked.map((row) => row.id), ["good-blocked"]);

console.log("figure relevance check verification passed");
