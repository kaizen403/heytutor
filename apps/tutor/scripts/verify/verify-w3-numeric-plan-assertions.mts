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
      "./fixtures/w3-numeric-plan-assertions-20261006/original-review-cases.json",
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

const positives = cases.cases.filter((c) => c.positive);
assert.equal(positives.length, 11);
assert.equal(cases.cases.filter((c) => !c.positive).length, 30);
checks += 2;
const profileControls = [positives[0]!, ...positives.slice(4, 10)];
for (const original of positives.filter((c) =>
  c.artifacts.turnPlan!.derived[0]!.symbol.startsWith("Result_"),
)) {
  for (const withText of [false, true]) {
    const c = structuredClone(original);
    c.positive = false;
    c.label += `: foreign bound symbol${withText ? " in result text" : ""}`;
    const row = c.artifacts.turnPlan!.derived[0]!,
      symbol = "The force equals 999 N.";
    row.symbol = symbol;
    c.artifacts.turnPlan!.unknowns.find((r) => r.id === row.id)!.symbol =
      symbol;
    const request = c.artifacts.problemIR!.solveRequests.find(
      (r) =>
        r.kind === "evaluate" && r.resultBinding?.turnPlanQuantityId === row.id,
    )!;
    if (request.kind !== "evaluate" || !request.resultBinding)
      throw Error("binding");
    request.resultBinding.symbol = symbol;
    if (withText) row.sourceText = `Source-verified ${symbol} = ${row.value}`;
    await exercise(c);
  }
}
// All recognized fields are exercised on full original Plans. Optional field
// errors cannot be erased by normalization or justified by a correct result.
for (const original of profileControls) {
  const bad = async (
    label: string,
    mutate: (plan: Record<string, unknown>) => void,
  ) => {
    const c = structuredClone(original);
    c.positive = false;
    c.label = `${original.label}: ${label}`;
    mutate(c.artifacts.turnPlan as unknown as Record<string, unknown>);
    await exercise(c);
  };
  for (const [key, value] of [
    ["schemaVersion", 3],
    ["question", {}],
    ["visualRequirement", {}],
    ["givens", {}],
    ["derived", null],
    ["unknowns", false],
    ["qualitativeClaims", {}],
    ["lawIds", [9]],
    ["assumptions", [{}]],
    ["teachingSequenceHints", 9],
    ["teachingSequenceHints", [{}]],
    ["teachingSequenceHints", [""]],
  ] as Array<[string, unknown]>)
    await bad(`maltyped Plan ${key}`, (p) => (p[key] = value));
  for (const list of ["givens", "derived"] as const) {
    if (!original.artifacts.turnPlan![list].length) continue;
    for (const [key, value] of [
      ["id", 9],
      ["symbol", {}],
      ["value", "3"],
      ["unit", 9],
      ["unit", null],
      ["sign", {}],
      ["sourceText", 9],
      ["sourceText", {}],
      ["sourceText", null],
      ["sourceText", true],
      ["sourceText", []],
      ["sourceText", ""],
      ["provenance", {}],
      ["dependsOn", 9],
      ["dependsOn", [{}]],
      ["uncertainty", {}],
      ["uncertainty", "0"],
      ["uncertainty", null],
      ["uncertainty", -1],
    ] as Array<[string, unknown]>)
      await bad(
        `maltyped ${list}.${key}`,
        (p) => ((p[list] as Record<string, unknown>[])[0]![key] = value),
      );
    await bad(
      `${list}: foreign text`,
      (p) =>
        ((p[list] as Record<string, unknown>[])[0]!.sourceText =
          "The force equals 999 N."),
    );
    await bad(
      `${list}: dangling dependency`,
      (p) => ((p[list] as Record<string, unknown>[])[0]!.dependsOn = ["force"]),
    );
  }
  await bad(
    "unknown unit object",
    (p) =>
      ((p.unknowns as Record<string, unknown>[])[0]!.unit = { claim: "force" }),
  );
  for (const [key, value] of [
    ["id", 9],
    ["claim", {}],
    ["expected", {}],
    ["expected", null],
    ["expected", []],
    ["relatedQuantityIds", 9],
    ["relatedQuantityIds", [{}]],
    ["relatedEntityHints", 9],
    ["relatedEntityHints", [{}]],
  ] as Array<[string, unknown]>)
    await bad(`maltyped claim.${key}`, (p) => {
      p.qualitativeClaims = [
        {
          id: "claim",
          claim: "coefficient_positive",
          expected: true,
          relatedQuantityIds: [original.artifacts.turnPlan!.derived[0]!.id],
          [key]: value,
        },
      ];
    });
  for (const [label, mutate] of [
    ["foreign law", (p: E.TurnPlanV3) => p.lawIds.push("newtons_second_law")],
    [
      "foreign hint",
      (p: E.TurnPlanV3) =>
        (p.teachingSequenceHints = ["The force equals 999 N."]),
    ],
    [
      "foreign assumption",
      (p: E.TurnPlanV3) => p.assumptions.push("The force equals 999 N."),
    ],
    [
      "foreign claim entity hint",
      (p: E.TurnPlanV3) =>
        p.qualitativeClaims.push({
          id: "foreign",
          claim: "coefficient_positive",
          expected: true,
          relatedQuantityIds: [p.derived[0]!.id],
          relatedEntityHints: ["force999"],
        }),
    ],
    [
      "duplicate dependencies",
      (p: E.TurnPlanV3) =>
        (p.derived[0]!.dependsOn = [
          p.givens[0]?.id ?? p.derived[0]!.id,
          p.givens[0]?.id ?? p.derived[0]!.id,
        ]),
    ],
    [
      "incomplete dependencies",
      (p: E.TurnPlanV3) => (p.derived[0]!.dependsOn = [p.derived[0]!.id]),
    ],
  ] as Array<[string, (p: E.TurnPlanV3) => void]>)
    await bad(label, (p) => mutate(p as unknown as E.TurnPlanV3));
}

// Supported optional semantics are retained wholesale, including explicit
// empty hints (there is no verified view/entity to resolve a nonempty hint).
for (const original of profileControls) {
  const c = structuredClone(original);
  c.label += ": full known-field semantics";
  const plan = c.artifacts.turnPlan!,
    count = plan.visualRequirement === "none",
    bin = plan.derived[0]!.symbol === "C";
  plan.teachingSequenceHints = [];
  for (const row of [...plan.givens, ...plan.derived]) {
    row.sign = row.value > 0 ? "positive" : row.value < 0 ? "negative" : "zero";
    // Explicit zero uncertainty on pi results is refused by the existing UCM
    // exact-scalar comparison (roundoff); keep that limitation visible below.
    if (!count && !c.question.includes("period")) row.uncertainty = 0;
  }
  plan.givens.forEach((row) => (row.dependsOn = []));
  if (bin) {
    const reading = E.readFiniteBinomialProgram(c.question);
    assert.equal(reading.status, "ok");
    if (
      reading.status !== "ok" ||
      reading.source.root.kind !== "binary" ||
      reading.source.root.right.kind !== "number"
    )
      throw Error("exponent");
    plan.givens.push({
      id: "exponent",
      symbol: "n",
      value: reading.source.root.right.value,
      unit: "1",
      provenance: "given",
      sourceText: reading.source.expressionSource,
      sign: "positive",
      uncertainty: 0,
      dependsOn: [],
    });
    plan.assumptions = ["finite polynomial expansion"];
    plan.qualitativeClaims = [
      {
        id: "sign",
        claim: "coefficient_positive",
        expected: true,
        relatedQuantityIds: [plan.derived[0]!.id],
        relatedEntityHints: [],
      },
    ];
  } else if (count)
    plan.qualitativeClaims = [
      {
        id: "count",
        claim: "circular_divisions",
        expected: 31,
        relatedQuantityIds: [plan.derived[0]!.id],
        relatedEntityHints: [],
      },
    ];
  plan.derived.forEach((row) => {
    row.dependsOn = plan.givens.map((g) => g.id);
    if (!count) row.sourceText = `Source-verified ${row.symbol} = ${row.value}`;
  });
  // Existing circular reader owns the complete symbolic source chains, including pi.
  if (plan.lawIds.includes("uniform_circular_motion")) {
    const pi = c.question.includes("period");
    plan.derived[0]!.sourceText = pi
      ? "omega = 2*pi/T = 1*pi rad/s"
      : "omega = v/r = 3 rad/s";
    plan.derived[1]!.sourceText = pi
      ? "a_c = omega^2*r = 0.03*pi^2 m/s^2"
      : "a_c = v^2/r = 0.27 m/s^2";
    plan.assumptions = ["uniform circular motion at constant speed"];
    plan.qualitativeClaims = [
      {
        id: "tangent",
        claim: "velocity is tangent to the circle",
        expected: true,
        relatedQuantityIds: [],
        relatedEntityHints: [],
      },
    ];
  }
  await exercise(c);
  if (plan.lawIds.includes("uniform_circular_motion")) {
    const link = structuredClone(c);
    link.positive = false;
    link.label += ": unresolved claim association";
    link.artifacts.turnPlan!.qualitativeClaims[0]!.relatedQuantityIds = [
      plan.derived[1]!.id,
    ];
    await exercise(link);
    const pair = structuredClone(c);
    pair.positive = false;
    pair.label += ": unresolved claim/expected prose join";
    pair.artifacts.turnPlan!.qualitativeClaims[0]!.expected =
      "speed is constant";
    await exercise(pair);
  }
  if (c.question.includes("period")) {
    const uncertain = structuredClone(c);
    uncertain.label += ": existing explicit-zero uncertainty limit";
    uncertain.positive = false;
    uncertain.artifacts.turnPlan!.derived.forEach(
      (row) => (row.uncertainty = 0),
    );
    await exercise(uncertain);
    const bare = structuredClone(c);
    bare.label += ": existing bare-pi text limit";
    bare.positive = false;
    bare.artifacts.turnPlan!.derived[0]!.sourceText =
      "omega = 2*pi/T = pi rad/s";
    await exercise(bare);
  }
  // A proved prefix must not confer authority on a foreign suffix, even when
  // the final scalar, exact result and every other field remain correct.
  const suffix = structuredClone(c);
  suffix.positive = false;
  suffix.label += ": foreign suffix";
  suffix.artifacts.turnPlan!.derived[0]!.sourceText +=
    "; The force equals 999 N.";
  await exercise(suffix);
}
const rational = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/w3-numeric-plan-assertions-20261006/rational-full-plan.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Case;
// C(3,2)*(1/2)^(3-2) = 3/2; computed independently of the expression reader.
equal(rational.expected, [3 * 0.5], "independent rational coefficient oracle");
rational.artifacts.solverResult =
  await new E.LocalDeterministicSolverProvider().solve(
    rational.artifacts.problemIR!,
  );
await exercise(rational);
const rationalWrong = structuredClone(rational);
rationalWrong.positive = false;
rationalWrong.label += ": wrong exact text";
rationalWrong.artifacts.turnPlan!.derived[0]!.sourceText =
  "Source-verified C = 3/4";
await exercise(rationalWrong);
console.log(
  `PASS ${checks} checks / ${exercises} complete-original numeric Plan admission cases`,
);
