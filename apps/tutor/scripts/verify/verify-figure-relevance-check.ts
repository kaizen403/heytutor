import assert from "node:assert/strict";
import {
  buildFigureCheckSummary,
  parseFigureCheckAnswer,
  VisionSpendCap,
  type FigureCheckResult,
} from "../lecture-lab/figureRelevanceCheck";

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
