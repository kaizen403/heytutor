import assert from "node:assert/strict";
import {
  combineDiagramEvalRows,
  parseDiagramEvalJsonl,
  type DiagramEvalRow,
} from "../lecture-lab/diagramEval";
import { parseOptions, selectResumeProbes, assertLabOutputReusable, plannerRequestWorstCaseUsd, restoredDiagramPng } from "../lecture-lab/run";
import { currentJudgeSummary, priorSubsetJudgeSummary } from "../lecture-lab/judging";

/** Pure, synthetic regression fixtures: importing run.ts does not run its CLI. */
const failures: string[] = [];
function check(name: string, verify: () => void): void {
  try {
    verify();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function fixture(id: string): DiagramEvalRow {
  return {
    id,
    topic_id: "physics|test|synthetic",
    subject: "physics",
    difficulty: "easy",
    question: "Explain a synthetic regression fixture.",
    source: { kind: "authored", ref: "runner-regression-test" },
    figure_need: "none",
    figure_kind: "none",
    must_show: [],
    must_label: [],
    must_not_show: [],
    trap: "no_figure_needed",
    notes: "Synthetic; contains no student data.",
  };
}

check("one evaluation input rejects filename-colliding distinct IDs", () => {
  assert.throws(
    () => parseDiagramEvalJsonl([fixture("a|b"), fixture("a/b")].map((row) => JSON.stringify(row)).join("\n")),
    /collision|filename|artifact|slug/i,
  );
});

check("separate evaluation inputs reject filename-colliding distinct IDs", () => {
  const left = parseDiagramEvalJsonl(JSON.stringify(fixture("a|b")));
  const right = parseDiagramEvalJsonl(JSON.stringify(fixture("a/b")));
  assert.throws(() => combineDiagramEvalRows([left, right]), /collision|filename|artifact|slug/i);
});

const provider = { provider: "azure", deployment: "gpt-6-1-sol" };
const probes = [{ id: "synthetic", question: "Synthetic question." }];
const saved = [{
  probeId: "synthetic",
  question: "Synthetic question.",
  arm: "current",
  providerConfig: provider,
  executionConfig: { figureOnly: true, scenePlannerLimitMs: 60_000 },
}];

check("resume cannot reuse figure-only rows for a narrated round", () => {
  const requested = parseOptions(["--eval", "synthetic.jsonl", "--figure-only=false", "--max-usd", "1"]);
  assert.equal(requested.figureOnly, false);
  assert.throws(
    () => selectResumeProbes(probes, saved, "current", provider, {
      figureOnly: requested.figureOnly,
      scenePlannerLimitMs: requested.scenePlannerLimitMs,
    }),
    /incompatible|execution|figure.only/i,
  );
});

check("identical execution settings can reuse a saved row", () => {
  assert.deepEqual(
    selectResumeProbes(probes, saved, "current", provider, {
      figureOnly: true,
      scenePlannerLimitMs: 60_000,
    }),
    [],
  );
});

check("checkpoint-only spend cannot be overwritten or ignored", () => {
  assert.throws(() => assertLabOutputReusable(true, 0, false), /paid|resume/i);
  assert.throws(() => assertLabOutputReusable(false, 1, true), /checkpoint/i);
  assert.doesNotThrow(() => assertLabOutputReusable(true, 0, true));
});

check("reservation honors the server output ceiling, not the smaller client cap", () => {
  const request = { body: JSON.stringify({ messages: [], max_tokens: 4000 }) };
  const cost = plannerRequestWorstCaseUsd(request, "gpt-6-1-sol", 8096);
  assert(cost >= 8096 * 10 / 1_000_000);
});

check("a relay's worst case reserves its hidden prompt; Azure does not", () => {
  const request = { body: JSON.stringify({ messages: [], max_tokens: 100 }) };
  const rates = { lane: "openai-compat" as const, inputUsdPer1M: 2, outputUsdPer1M: 10, cachedInputUsdPer1M: 0.1 };
  const relay = plannerRequestWorstCaseUsd(request, "gpt-6.1-sol", 0, undefined, { endpoint: { provider: "openai_compat" }, rates });
  const azure = plannerRequestWorstCaseUsd(request, "gpt-6.1-sol", 0, undefined, { endpoint: { provider: "azure" }, rates });
  // Same body translation and rates on both, so the difference is the hidden prompt.
  assert.equal(Math.round((relay - azure) * 1e6), 4500 * 2, "4,500 hidden prompt tokens at $2 per 1M");
});

check("reservation covers server-prepared multibyte input before dispatch", () => {
  const request = { body: JSON.stringify({ messages: [{ role: "user", content: "चित्र" }], max_tokens: 60 }) };
  const base = plannerRequestWorstCaseUsd(request, "accounts/fireworks/models/deepseek-v4p1-flash", 60);
  const expanded = plannerRequestWorstCaseUsd(request, "accounts/fireworks/models/deepseek-v4p1-flash", 60,
    { inputByteMultiplier: 2, addedInputBytes: 100_000 });
  assert(expanded > base + 0.02, "server catalogue/example additions cannot vanish from the conservative reservation");
  assert.throws(() => plannerRequestWorstCaseUsd(request, "accounts/fireworks/models/kimi-k3", 5200,
    { inputByteMultiplier: 0, addedInputBytes: -1 }), /bound|input|expansion/i);
});

check("Fireworks null deployment does not hide changed lane models or prices on resume", () => {
  const fireworks = { provider: "fireworks", deployment: null };
  const identity = { modelProfile: { models: { planner: "accounts/fireworks/models/kimi-k3" }, rates: { input: 3, output: 15 } },
    plannerOutputCap: 5200, inputBounds: { addedInputBytes: 1000 } };
  const rows = [{ ...saved[0]!, providerConfig: fireworks, executionConfig: identity }];
  assert.deepEqual(selectResumeProbes(probes, rows, "current", fireworks, identity), []);
  for (const changed of [
    { ...identity, modelProfile: { ...identity.modelProfile, models: { planner: "accounts/fireworks/routers/kimi-k3-fast" } } },
    { ...identity, modelProfile: { ...identity.modelProfile, rates: { input: 4, output: 15 } } },
    { ...identity, plannerOutputCap: 6000 },
    { ...identity, inputBounds: { addedInputBytes: 2000 } },
  ]) assert.throws(() => selectResumeProbes(probes, rows, "current", fireworks, changed), /incompatible/i);
});

check("a recovered PNG restores the path from the saved SVG", () => {
  assert.equal(restoredDiagramPng({ svg: "frames/synthetic.svg", png: null }, (path) => path === "frames/synthetic.png"), "frames/synthetic.png");
  assert.equal(restoredDiagramPng({ svg: "frames/synthetic.svg", png: "frames/synthetic.png" }, () => false), null);
});

check("partial resumed judging cannot be reported as completed totals", () => {
  const summary = { judge: { counts: {} }, judgingStatus: { unreviewedRows: 1 } };
  assert.equal(currentJudgeSummary(summary), undefined);
  assert.equal(currentJudgeSummary({ ...summary, judgingStatus: { unreviewedRows: 0 } }), summary.judge);
});

check("repeated resume preserves the previously reviewed subset totals", () => {
  const prior = { counts: { right: 1 } };
  assert.equal(priorSubsetJudgeSummary({ priorSubsetJudgeSummary: prior }, 1), prior);
  assert.equal(priorSubsetJudgeSummary({ judge: prior }, 1), prior);
  assert.equal(priorSubsetJudgeSummary({ priorSubsetJudgeSummary: prior }, 0), undefined);
});

if (failures.length > 0) {
  console.error(`Lab runner regressions: ${failures.length} failure(s). No model calls or real artifacts used.`);
  process.exitCode = 1;
} else {
  console.log("Lab runner regression checks passed (zero model calls).");
}
