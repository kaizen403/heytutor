/**
 * A plan with mixed signs still has sizes the law fixes.
 *
 * The optics audit declined a plan whose signs cannot be read as one convention, and a decline is only a debug log, so a
 * false image distance went on to be stamped verified. With a single element and a real object, |v| and |m| follow from
 * |u|, |f| and the element the stem names, whatever convention was meant. So a size the law rules out now rejects the
 * lane, and a right plan with the same mixed signs stays accepted. Object and image distances named d_o and d_i are read
 * too. A second element, or an element the stem does not name, keeps declining. Every stem and number here is authored.
 *
 *   pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-optics-sign-mix.ts
 */
import assert from "node:assert/strict";
import {
  createFallbackTurnPlanV3,
  parseTurnPlanV3Content,
  planTurnV3,
  reconcileTurnPlanWithOpticsLaws,
  subjectFromRejectedTurnPlanOutcomes,
  type TurnPlanRequestOutcome,
} from "@heytutor/tutor-core";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

type Named = [id: string, value: number, unit?: string];
const given = ([id, value, unit]: Named) => ({ id, symbol: id, value, ...(unit ? { unit } : {}), provenance: "given", sourceText: `${id} = ${value}${unit ? ` ${unit}` : ""}` });
const derived = (from: string[]) => ([id, value, unit]: Named) => ({ id, symbol: id, value, ...(unit ? { unit } : {}), provenance: "derived", dependsOn: from, sourceText: `${id} = ${value}${unit ? ` ${unit}` : ""}` });
function plan(question: string, givens: Named[], results: Named[], lawIds: string[], assumptions: string[] = []): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", subject: "physics", question, visualRequirement: "required",
    givens: givens.map(given),
    unknowns: results.map(([id, , unit]) => ({ id, symbol: id, ...(unit ? { unit } : {}) })),
    derived: results.map(derived(givens.map(([id]) => id))),
    qualitativeClaims: [], lawIds, assumptions,
  } as unknown as TurnPlanV3;
}
const MIRROR = ["mirror formula"];
const LENS = ["thin lens formula"];
const CONCAVE_MIRROR = "A concave mirror has focal length 12 cm. An object stands 30 cm in front of it. Find the image.";
const CONVEX_MIRROR = "A convex mirror of focal length 12 cm has an object 30 cm in front of it. Find the image.";
const CONCAVE_LENS = "An object stands 48 cm from a concave lens of focal length 24 cm. Find the image.";
const CONVEX_LENS = "An object stands 40 cm from a convex lens of focal length 15 cm. Find the image.";
const BOTH = ["Cartesian sign convention for distances", "real is positive for the focal length"];

/** Each with the law's true sizes and a false pair. Truth: concave 20, 2/3. Convex 8.571, 2/7. Concave lens 16, 1/3. Convex lens 24, 3/5. */
const SIGN_MIXES: { name: string; question: string; givens: Named[]; v: string; right: Named[]; wrong: Named[]; laws: string[]; assumptions?: string[]; reason: RegExp }[] = [
  { name: "concave mirror, signs vote for both conventions", question: CONCAVE_MIRROR, givens: [["f", 12, "cm"], ["u", -30, "cm"]], v: "v", right: [["v", 20, "cm"], ["m", 0.6667]], wrong: [["v", 8.571, "cm"], ["m", 0.2857]], laws: MIRROR, reason: /mixes Cartesian/ },
  { name: "concave mirror, both conventions stated", question: CONCAVE_MIRROR, givens: [["f", -12, "cm"], ["u", -30, "cm"]], v: "v", right: [["v", -20, "cm"], ["m", -0.6667]], wrong: [["v", -8.571, "cm"], ["m", -0.2857]], laws: MIRROR, assumptions: BOTH, reason: /both Cartesian/ },
  { name: "convex mirror, signs vote for both conventions", question: CONVEX_MIRROR, givens: [["f", -12, "cm"], ["u", -30, "cm"]], v: "v", right: [["v", 8.571, "cm"], ["m", 0.2857]], wrong: [["v", 20, "cm"], ["m", 0.6667]], laws: MIRROR, reason: /mixes Cartesian/ },
  { name: "concave lens given a positive focal length", question: CONCAVE_LENS, givens: [["f", 24, "cm"], ["u", 48, "cm"]], v: "v", right: [["v", -16, "cm"], ["m", 0.3333]], wrong: [["v", -48, "cm"], ["m", 1]], laws: LENS, reason: /contradicts the stated lens type/ },
  { name: "concave lens, positive focal length, d_o and d_i", question: CONCAVE_LENS, givens: [["f", 24, "cm"], ["d_o", 48, "cm"]], v: "d_i", right: [["d_i", -16, "cm"], ["m", 0.3333]], wrong: [["d_i", -48, "cm"], ["m", 1]], laws: LENS, reason: /contradicts the stated lens type/ },
];

// Two elements, whatever joins them. Each plan holds the right final image, 100 cm, which a single element reading would call false.
const SECOND_ELEMENT = [
  "An object is 30 cm in front of a convex lens of focal length 10 cm. A convex lens of focal length 20 cm is 40 cm behind it. Find the final image.",
  "A convex lens of focal length 10 cm is followed by a convex lens of focal length 20 cm placed 40 cm behind it. An object is 30 cm in front. Find the final image.",
  "An object is 30 cm from lens A, a convex lens of focal length 10 cm. Lens B, a convex lens, is 40 cm beyond lens A. Find the final image.",
  "An object is 30 cm in front of a convex lens of focal length 10 cm. Behind it, 40 cm away, is a converging lens of focal length 20 cm. Find the final image.",
  "An object is 30 cm in front of a convex lens of focal length 10 cm, and a concave lens of focal length 20 cm is 40 cm behind it. Find the final image.",
  "Two convex lenses are 40 cm apart. An object is 30 cm in front of the convex lens of focal length 10 cm. Find the final image.",
  "An object is 30 cm in front of a convex lens of focal length 10 cm. Its image acts as the object for a convex lens of focal length 20 cm placed 40 cm away. Find the final image.",
  "An object is 30 cm in front of a convex lens of focal length 10 cm. The light then reaches a plane mirror 40 cm behind it. Find the final image.",
  "An object is 30 cm in front of a telescope objective, a convex lens of focal length 10 cm. An eyepiece of focal length 2 cm is 12 cm behind it. Find the final image.",
];

let checks = 0;
const failures: string[] = [];
const check = async (name: string, run: () => void | Promise<void>) => {
  checks += 1;
  try { await run(); } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`); }
};
const parse = (p: TurnPlanV3) => {
  const trace: { issues?: { code: string }[] } = {};
  return { plan: parseTurnPlanV3Content(JSON.stringify(p), p.question, trace as never), codes: (trace.issues ?? []).map((issue) => issue.code) };
};
const STRICT = ["planner", "verified_recovery", "linear_source", "text_only"];
const numbersDrawn = (selection: ReturnType<typeof selectProductionScene>): string[] =>
  (selection.representation?.renderScene?.primitives ?? [])
    .map((primitive) => (primitive as { text?: unknown }).text)
    .filter((text): text is string => typeof text === "string" && /\d/.test(text));
const segmentFigure = (question: string): Record<string, unknown> => ({
  schemaVersion: "scene-document/v2", source: { question, nonMetric: true, representationTier: "qualitative_verified" },
  visualDecision: { mode: "scene", reason: "a labelled axis segment" }, quantities: [],
  entities: [{ id: "a", kind: "point", role: "endpoint", label: "A" }, { id: "b", kind: "point", role: "endpoint", label: "B" }, { id: "ab", kind: "segment", role: "segment", label: "AB" }],
  constructions: [{ id: "pa", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] }, { id: "pb", operator: "point", inputs: { x: 3, y: 0 }, outputs: ["b"] }, { id: "sab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] }],
  relations: [], assertions: [{ id: "exists", predicate: "exists", entities: ["ab"], expected: true, severity: "fatal" }],
  annotations: [], requiredEntityIds: ["a", "b", "ab"],
  revealGroups: [{ id: "setup", entityIds: ["a", "b", "ab"], dependsOn: [], narrationCue: "Draw AB." }],
  teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Draw AB." }],
});

async function main() {
  for (const row of SIGN_MIXES) {
    const wrong = plan(row.question, row.givens, row.wrong, row.laws, row.assumptions);
    const right = plan(row.question, row.givens, row.right, row.laws, row.assumptions);
    await check(`${row.name}: a size the law rules out rejects the lane`, () => {
      const parsed = parse(wrong);
      assert.equal(parsed.plan, null);
      assert.ok(parsed.codes.includes("optics_law_mismatch"), parsed.codes.join(","));
    });
    await check(`${row.name}: the right sizes stay accepted and declined`, () => {
      const parsed = parse(right);
      assert.ok(parsed.plan, parsed.codes.join(","));
      const audit = reconcileTurnPlanWithOpticsLaws(right);
      assert.deepEqual(audit.inconsistencies, []);
      assert.ok(audit.declined.some((item) => row.reason.test(item.reason)), "the decline stays on the record");
    });
    await check(`${row.name}: a false magnification alone rejects`, () => {
      assert.equal(parse(plan(row.question, row.givens, [row.right[0]!, row.wrong[1]!], row.laws, row.assumptions)).plan, null);
    });
    await check(`${row.name}: a false image distance alone rejects`, () => {
      assert.equal(parse(plan(row.question, row.givens, [row.wrong[0]!, row.right[1]!], row.laws, row.assumptions)).plan, null);
    });
    await check(`${row.name}: the image sign alone is no fault`, () => {
      const flipped = plan(row.question, row.givens, row.right.map(([id, value, unit]) => [id, -value, unit] as Named), row.laws, row.assumptions);
      assert.ok(parse(flipped).plan);
    });
  }

  await check("d_o and d_i are read on a plan with one convention: a false image rejects", () => {
    const parsed = parse(plan(CONVEX_LENS, [["f", 15, "cm"], ["d_o", 40, "cm"]], [["d_i", 17.14, "cm"]], LENS));
    assert.equal(parsed.plan, null);
    assert.ok(parsed.codes.includes("optics_law_mismatch"));
  });
  await check("d_o and d_i are read on a plan with one convention: the true image is checked", () => {
    const right = plan(CONVEX_LENS, [["f", 15, "cm"], ["d_o", 40, "cm"]], [["d_i", 24, "cm"]], LENS);
    assert.ok(parse(right).plan);
    assert.deepEqual(reconcileTurnPlanWithOpticsLaws(right).checkedLawIds, ["thin_lens_formula"]);
  });
  await check("a Cartesian d_o is read the same way", () => {
    assert.ok(parse(plan(CONVEX_LENS, [["f", 15, "cm"], ["d_o", -40, "cm"]], [["d_i", 24, "cm"]], LENS)).plan);
    assert.equal(parse(plan(CONVEX_LENS, [["f", 15, "cm"], ["d_o", -40, "cm"]], [["d_i", 17.14, "cm"]], LENS)).plan, null);
  });

  const shapes: [string, Named[], Named[]][] = [
    ["d_o positive, f positive", [["d_o", 30, "cm"], ["f", 10, "cm"]], [["d_i", 100, "cm"]]],
    ["u negative, f positive", [["u", -30, "cm"], ["f", 10, "cm"]], [["v", 100, "cm"]]],
    ["lens sign contradiction", [["d_o", 30, "cm"], ["f", -10, "cm"]], [["d_i", 100, "cm"]]],
  ];
  for (const question of SECOND_ELEMENT) {
    for (const [name, givens, results] of shapes) {
      await check(`a second element keeps declining, ${name}: ${question.slice(0, 60)}`, () => {
        const candidate = plan(question, givens, results, LENS);
        const audit = reconcileTurnPlanWithOpticsLaws(candidate);
        assert.deepEqual(audit.inconsistencies, []);
        assert.deepEqual(audit.checkedLawIds, []);
        assert.ok(audit.declined.length > 0, "declined, not skipped");
        assert.ok(parse(candidate).plan);
      });
    }
  }
  await check("a one element stem that says a lens twice in other words is still read", () => {
    const stem = "An object stands 40 cm from a convex lens of focal length 15 cm. The lens forms an image. Find it.";
    assert.equal(parse(plan(stem, [["f", 15, "cm"], ["d_o", 40, "cm"]], [["d_i", 17.14, "cm"]], LENS)).plan, null);
  });
  await check("an element the stem does not name keeps declining", () => {
    const stem = "An object stands 30 cm from a mirror of focal length 12 cm. Find the image.";
    const candidate = plan(stem, [["f", 12, "cm"], ["u", -30, "cm"]], [["v", 50, "cm"]], MIRROR);
    assert.deepEqual(reconcileTurnPlanWithOpticsLaws(candidate).inconsistencies, []);
    assert.ok(parse(candidate).plan);
  });
  await check("a virtual object keeps declining", () => {
    const stem = "Light heading for a virtual object 30 cm behind a concave mirror of focal length 12 cm. Find the image.";
    const candidate = plan(stem, [["f", 12, "cm"], ["u", -30, "cm"]], [["v", 8.571, "cm"]], MIRROR);
    assert.deepEqual(reconcileTurnPlanWithOpticsLaws(candidate).inconsistencies, []);
    assert.ok(parse(candidate).plan);
  });

  // What a rejection does next. The other lane first, then the fallback.
  const realFetch = globalThis.fetch;
  const reply = (body: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }], content: JSON.stringify(body) }), { status: 200, headers: { "Content-Type": "application/json" } });
  const wrongPlan = plan(CONCAVE_MIRROR, [["f", 12, "cm"], ["u", -30, "cm"]], [["v", 8.571, "cm"], ["m", 0.2857]], MIRROR);
  const rightPlan = plan(CONCAVE_MIRROR, [["f", 12, "cm"], ["u", -30, "cm"]], [["v", 20, "cm"], ["m", 0.6667]], MIRROR);
  await check("the other lane's right plan takes the turn", async () => {
    let calls = 0;
    globalThis.fetch = (async () => reply((calls += 1) === 1 ? wrongPlan : rightPlan)) as typeof fetch;
    const planned = await planTurnV3(CONCAVE_MIRROR, { proxyUrl: "http://planner.test", timeoutMs: 1_000 });
    assert.ok(planned, "a plan came back");
    assert.equal(planned!.turnPlan.derived.find((item) => item.id === "v")?.value, 20);
  });
  const outcomes: TurnPlanRequestOutcome[] = [];
  await check("both lanes false: no plan, and the subject stays physics, so the turn stays strict", async () => {
    globalThis.fetch = (async () => reply(wrongPlan)) as typeof fetch;
    const planned = await planTurnV3(CONCAVE_MIRROR, { proxyUrl: "http://planner.test", timeoutMs: 1_000, classifySubject: true, onRequestOutcome: (outcome) => outcomes.push(outcome) });
    assert.equal(planned, null);
    assert.ok(outcomes.length >= 2 && outcomes.every((outcome) => outcome.code === "optics_law_mismatch"));
    assert.equal(subjectFromRejectedTurnPlanOutcomes(outcomes), "physics");
  });
  globalThis.fetch = realFetch;
  for (const question of [CONCAVE_MIRROR, CONVEX_MIRROR, CONCAVE_LENS]) {
    const fallback = createFallbackTurnPlanV3(question);
    for (const [name, policy] of [["strict", { preferPlanner: true, allowedFigureSources: STRICT }], ["planner proven", { preferPlanner: false, allowedFigureSources: STRICT }]] as const) {
      await check(`the fallback draws no number on ${name}: ${question.slice(0, 40)}`, () => {
        const selected = selectProductionScene({ question, turnPlan: fallback, problemIR: null, candidate: null, requiredRetryEnabled: true, policy } as Parameters<typeof selectProductionScene>[0]);
        assert.equal(selected.representation, null);
        assert.deepEqual(numbersDrawn(selected), []);
      });
    }
  }

  // Rule 3 in holds.md: a figure saved under a plan this audit now rejects still passes its next resume save.
  await check("a saved figure under a plan the audit now rejects passes its resume save", async () => {
    assert.ok(reconcileTurnPlanWithOpticsLaws(wrongPlan).inconsistencies.length > 0, "the fixture is a plan the audit rejects");
    const question = CONCAVE_MIRROR;
    const artifacts = { schemaVersion: "scene-artifacts/v3", diagramResultStatus: "ready", representationTier: "qualitative_verified", nonMetric: true, figureSource: "planner", turnPlan: wrongPlan, boardContinuation: { schemaVersion: "board-continuation/v1", lessonQuestion: question } };
    const saved = await canonicalizeTurnSceneMetadata({ question, sceneDocument: segmentFigure(question), visualStatus: "validated", sceneArtifacts: artifacts, segments: [{ orderIndex: 0, narration: "Let us carry on.", command: null }] } as never, { kind: "resume" } as never);
    assert.ok(saved.ok, saved.ok ? "" : `${saved.code}: ${saved.error}`);
  });

  if (failures.length) {
    for (const failure of failures) console.log(`FAIL ${failure}`);
    console.log(`${failures.length} failed of ${checks}`);
    process.exit(1);
  }
  console.log(`pass: ${checks} checks, a false size rejects, right plans with the same signs stay, a second element declines, the fallback draws no number, resume save holds`);
}

void main();
