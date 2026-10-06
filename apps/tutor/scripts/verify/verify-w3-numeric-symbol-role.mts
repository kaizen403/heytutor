import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as E from "@heytutor/scene-engine";
import { numericOnlyAuthority } from "../../lib/scene/numericOnlyAuthority";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type { StoredTurn } from "../../lib/boards/boardsClient";

type Case = {
  label: string;
  positive: boolean;
  question: string;
  artifacts: E.SceneArtifactsV3;
  expected: number[] | null;
};
const cases = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/w3-numeric-symbol-role-20261006/original-review-cases.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { cases: Case[] };
let checks = 0,
  exercises = 0;
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const equal = (actual: unknown, expected: unknown, label: string) => {
  assert.deepEqual(json(actual), json(expected), label);
  checks++;
};
const segment = {
  orderIndex: 0,
  narration: "The source result is preserved.",
  spokenText: "The source result is preserved.",
  command: {
    type: "WRITE",
    params: [20, 120],
    text: "source result",
    charPosition: 0,
    narrationBefore: "",
  },
} satisfies Pick<
  StoredTurn["segments"][number],
  "orderIndex" | "narration" | "spokenText" | "command"
>;
function stored(c: Case, artifacts: E.SceneArtifactsV3 | null): StoredTurn {
  return {
    id: "assertions",
    question: c.question,
    rawResponse: "",
    orderIndex: 0,
    speedMultiplier: 1,
    traceId: null,
    sceneDocument: null,
    sceneArtifacts: artifacts,
    visualStatus: "text_only",
    sceneEngineVersion: null,
    validationReport: null,
    segments: [
      { ...segment, id: "s", audioUrl: null, durationMs: 500, timings: null },
    ],
  };
}
async function exercise(c: Case): Promise<void> {
  exercises++;
  const before = JSON.stringify(c.artifacts),
    helper = numericOnlyAuthority(c.artifacts, c.question);
  const saved = await canonicalizeTurnSceneMetadata({
    question: c.question,
    visualStatus: "text_only",
    segments: [segment],
    sceneArtifacts: c.artifacts,
  });
  assert(saved.ok, c.label);
  checks++;
  const raw = sourceCheckedStoredTurn(stored(c, c.artifacts)),
    read = sourceCheckedStoredTurn(stored(c, json(saved.value.sceneArtifacts)));
  for (const outcome of [
    helper,
    saved.value.sceneArtifacts,
    raw.sceneArtifacts,
    read.sceneArtifacts,
  ]) {
    const accepted = outcome as Partial<E.SceneArtifactsV3> | null;
    equal(!!accepted?.problemIR, c.positive, `${c.label}: full admission`);
    if (c.positive) {
      equal(
        accepted!.problemIR,
        c.artifacts.problemIR,
        `${c.label}: full IR parity`,
      );
      equal(
        accepted!.turnPlan,
        c.artifacts.turnPlan,
        `${c.label}: full Plan parity`,
      );
      equal(accepted!.solverAuthority!.status, "verified", `${c.label}: audit`);
      c.expected!.forEach((v, i) => {
        assert(
          Math.abs(
            (accepted!.solverResult!.values[i]!.approximate as number) - v,
          ) <=
            32 * Number.EPSILON * Math.abs(v),
        );
        checks++;
      });
    } else
      for (const field of [
        "problemIR",
        "turnPlan",
        "solverResult",
        "solverAuthority",
      ] as const)
        equal(
          accepted?.[field] ?? null,
          null,
          `${c.label}: atomic decline ${field}`,
        );
  }
  equal(saved.value.sceneDocument, null, `${c.label}: no figure`);
  equal(
    saved.value.segments.map((s) => [s.narration, s.spokenText]),
    [[segment.narration, segment.spokenText]],
    `${c.label}: lesson survives`,
  );
  for (const t of [raw, read]) {
    equal(
      restoreVerifiedPresentationFromTurn(t),
      null,
      `${c.label}: no restore`,
    );
    equal(t.visualStatus, "text_only", `${c.label}: visual status`);
    equal(
      t.segments,
      stored(c, c.artifacts).segments,
      `${c.label}: read lesson survives`,
    );
  }
  equal(JSON.stringify(c.artifacts), before, `${c.label}: input immutable`);
}
for (const c of cases.cases) await exercise(c);
const attacks = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/w3-numeric-symbol-role-20261006/symbol-attacks.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { cases: Case[] };
assert.equal(attacks.cases.length, 44);
for (const c of attacks.cases) await exercise(c);
const positives = cases.cases.filter((c) => c.positive);
assert.equal(positives.length, 11);
function rename(c: Case, index: number, symbol: string): void {
  const row = c.artifacts.turnPlan!.derived[index]!;
  row.symbol = symbol;
  c.artifacts.turnPlan!.unknowns.find((q) => q.id === row.id)!.symbol = symbol;
  c.artifacts.problemIR!.solveRequests.find(
    (r) => r.resultBinding?.turnPlanQuantityId === row.id,
  )!.resultBinding!.symbol = symbol;
}
for (const original of positives) {
  for (const symbol of [
    "The_force_equals_999_N",
    "TheForceEquals999N",
    "ForceIs999Newtons",
    "force_equals_999_N",
    "EnergyIs216J",
    "temperature_is_zero",
    "AccelerationEquals31",
    "a_999",
    "Result_999",
    "F",
    "r",
  ]) {
    const c = structuredClone(original);
    c.label += `: foreign output role ${symbol}`;
    c.positive = false;
    rename(c, 0, symbol);
    await exercise(c);
    if (original.artifacts.turnPlan!.derived[0]!.symbol.startsWith("Result_")) {
      c.artifacts.turnPlan!.derived[0]!.sourceText = `Source-verified ${symbol} = ${c.artifacts.turnPlan!.derived[0]!.value}`;
      c.label += ": echoed result declaration";
      await exercise(c);
    }
  }
  for (const [index, given] of original.artifacts.turnPlan!.givens.entries()) {
    for (const symbol of [
      "PressureEquals999",
      "F",
      original.artifacts.turnPlan!.derived[0]!.symbol,
    ]) {
      const c = structuredClone(original);
      c.positive = false;
      c.label += `: given ${given.id} wrong role ${symbol}`;
      c.artifacts.turnPlan!.givens[index]!.symbol = symbol;
      await exercise(c);
    }
  }
  const rows = original.artifacts.turnPlan!.derived;
  if (rows.length > 1) {
    const c = structuredClone(original);
    c.positive = false;
    c.label += ": exchange original output roles";
    rename(c, 0, rows[1]!.symbol);
    rename(c, 1, rows[0]!.symbol);
    await exercise(c);
  }
  if (rows[0]!.symbol === "circular_reading") {
    for (const symbol of [
      "N",
      "n",
      "C",
      "c",
      "count",
      "circular_scale_reading",
    ]) {
      const c = structuredClone(original);
      c.label += `: conventional count alias ${symbol}`;
      rename(c, 0, symbol);
      await exercise(c);
    }
  }
  if (rows[0]!.symbol.startsWith("Result_")) {
    const reading = E.readFiniteProgressionSource(original.question);
    assert.equal(reading.status, "ok");
    if (reading.status !== "ok") throw Error("source");
    for (const [index, ask] of reading.source.asks.entries()) {
      const c = structuredClone(original);
      const symbol = ask.kind === "term" ? ask.symbol : `S_${ask.index}`;
      c.label += `: source mathematical alias ${symbol}`;
      rename(c, index, symbol);
      c.artifacts.turnPlan!.derived[index]!.sourceText =
        `Source-verified ${symbol} = ${c.artifacts.turnPlan!.derived[index]!.value}`;
      await exercise(c);
    }
    const c = structuredClone(original);
    c.label += ": reordered whole caller requests";
    c.artifacts.problemIR!.solveRequests.reverse();
    // Cached values retain request identities; admission recomputes in caller order.
    c.expected = [...c.expected!].reverse();
    await exercise(c);
  }
}
console.log(`${exercises} symbol/role cases; ${checks} checks passed`);
