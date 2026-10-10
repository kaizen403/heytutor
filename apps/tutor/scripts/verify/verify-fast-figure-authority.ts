/**
 * The deterministic fast figure under a real ProblemIR, on captured turns.
 *
 * Mirrors the planning band of the live hook: reconcile the plan with the
 * solver, audit it, block on a contradiction, infer families with ProblemIR,
 * then selectFastVerifiedRepresentation. The fixtures are live turn plans and
 * ProblemIR captured from the lecture lab, so the planner variance that sent
 * "Derive the range of a projectile" to a 20 to 30 s LLM scene plan is pinned:
 * a not_applicable authority keeps the fast figure, a constant the planner
 * added does not count as a student given, and every bound or
 * structure-routed authority keeps today's selection. The question's own
 * numbers are never evidence for a drawn value: matching them is role blind,
 * so a wind at 45 degrees would label the launch angle.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  reconcileTurnPlanV3ExplicitArithmetic,
  reconcileTurnPlanWithSolver,
  validateSceneQuantityAgreement,
  validateTurnPlanV3,
  verifyTurnPlanAgainstSolver,
  type ProblemIR,
  type RenderScene,
  type SolverResult,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { inferSceneCapabilities } from "@heytutor/tutor-core";
import {
  isPlannerQuotedConstant,
  selectFastVerifiedRepresentation,
} from "../../features/tutor-session/lib/scene/representationFallback";

interface FixtureCase {
  id: string;
  question: string;
  turnPlan: TurnPlanV3;
  authority: { problemIR: ProblemIR; solverResult: SolverResult } | null;
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures/fast-figure-authority.json"), "utf8"),
) as { cases: FixtureCase[] };
const byId = new Map(fixture.cases.map((entry) => [entry.id, entry]));
const get = (id: string): FixtureCase => {
  const entry = byId.get(id);
  assert.ok(entry, `fixture ${id} is missing`);
  return entry;
};

interface LiveSelection {
  audit: string | null;
  bindings: number;
  families: readonly string[];
  plan: TurnPlanV3;
  figure: string | null;
  labels: string[];
}

function textLabels(scene: RenderScene): string[] {
  return scene.primitives.flatMap((primitive) =>
    (primitive.kind === "label" || primitive.kind === "dimension") && typeof primitive.text === "string"
      ? [primitive.text] : []);
}

/** A captured plan asked of a different stem, with no authority. */
function restem(entry: FixtureCase, question: string, patch: Partial<TurnPlanV3> = {}): FixtureCase {
  return { ...entry, id: `${entry.id}:restem`, question, turnPlan: { ...entry.turnPlan, ...patch, question }, authority: null };
}

/** A hand-written plan for a stem, with no authority. */
function stemCase(question: string, plan: Partial<TurnPlanV3>): FixtureCase {
  return {
    id: question,
    question,
    turnPlan: {
      schemaVersion: "turn-plan/v3",
      question,
      givens: [],
      unknowns: [],
      derived: [],
      qualitativeClaims: [],
      lawIds: [],
      assumptions: [],
      visualRequirement: "required",
      ...plan,
    },
    authority: null,
  };
}

function selectLikeLive(entry: FixtureCase, overrides: { problemIR?: null } = {}): LiveSelection {
  // The planner reconciles explicit arithmetic before it validates
  // (turnPlannerV3), so the band starts from that plan. A captured plan is
  // main's reconcile output; the fixed reconcile reads "cos 30°" in degrees
  // and refines a rounded 17.32 to 17.3205..., which validation alone would
  // report against the unrefined value.
  const reconciled = reconcileTurnPlanV3ExplicitArithmetic(entry.turnPlan).plan as TurnPlanV3;
  // A hand-built or re-stemmed plan must be a real plan, or a null figure
  // would only prove the plan was rejected.
  assert.ok(validateTurnPlanV3(reconciled, entry.question).plan, `${entry.id}: plan must validate`);
  let plan = reconciled;
  let audit: ReturnType<typeof verifyTurnPlanAgainstSolver> | null = null;
  if (entry.authority) {
    plan = reconcileTurnPlanWithSolver(plan, entry.authority.problemIR, entry.authority.solverResult);
    audit = verifyTurnPlanAgainstSolver(entry.authority.problemIR, entry.authority.solverResult, plan, entry.question);
  }
  const problemIR = "problemIR" in overrides ? null : entry.authority?.problemIR ?? null;
  const families = inferSceneCapabilities(entry.question, {
    lawIds: plan.lawIds,
    problemIR,
    turnPlan: plan,
  }).families;
  const blocked = audit?.status === "contradiction";
  const fast = blocked
    ? null
    : selectFastVerifiedRepresentation({ question: entry.question, turnPlan: plan, problemIR, families });
  return {
    audit: audit?.status ?? null,
    bindings: audit?.bindings.length ?? 0,
    families,
    plan,
    figure: fast ? `${fast.tier}/${fast.family}` : null,
    labels: fast ? textLabels(fast.renderScene) : [],
  };
}

const CONTACT_BODY = "qualitative_verified/contact_body";
let checks = 0;
const check = (name: string, run: () => void) => {
  run();
  checks += 1;
  console.log(`ok  ${name}`);
};
const given = (id: string, value: number, unit: string, sourceText: string) =>
  ({ id, symbol: id, value, unit, sourceText, provenance: "given" as const });

check("not_applicable authority keeps the fast projectile figure", () => {
  const entry = get("derive_symbolic");
  const live = selectLikeLive(entry);
  assert.equal(live.audit, "not_applicable");
  assert.equal(live.bindings, 0);
  assert.equal(live.figure, CONTACT_BODY);
  // ProblemIR present or absent selects the same figure: the null-authority
  // path origin/main took is not what made the figure fast.
  assert.equal(selectLikeLive(entry, { problemIR: null }).figure, live.figure);
});

check("a constant the planner added (g = 9.8) does not make a symbolic question numeric", () => {
  const entry = get("derive_planner_constant");
  assert.deepEqual(entry.turnPlan.givens.map((item) => item.symbol), ["g"]);
  const live = selectLikeLive(entry);
  assert.equal(live.audit, "not_applicable");
  assert.equal(live.figure, CONTACT_BODY);
});

check("a constant the question states stays a given on the live path", () => {
  // The hanging mass draws no number, so the given alone decides.
  const stated = "A mass m hangs from a string attached to the ceiling. Take g = 10 m/s^2. Draw the free body diagram and derive the tension.";
  const unstated = stated.replace(" Take g = 10 m/s^2.", "");
  const lawIds = ["newtons-second-law"];
  const planner = selectLikeLive(stemCase(unstated, {
    lawIds,
    givens: [given("g", 9.8, "m/s^2", "standard gravity")],
  }));
  assert.equal(planner.figure, CONTACT_BODY, "an unstated g must not block the qualitative figure");
  const student = selectLikeLive(stemCase(stated, {
    lawIds,
    givens: [given("g", 10, "m/s^2", "Take g = 10 m/s^2")],
  }));
  assert.equal(student.figure, null, "a g the student stated is a given: a qualitative figure must wait for the planner");
  assert.equal(selectLikeLive(stemCase(stated, { lawIds })).figure, CONTACT_BODY,
    "guard: without the given the same stem does draw, so the given is what declines it");
});

check("only a constant the question never states is set aside", () => {
  const symbolic = get("derive_planner_constant").question;
  assert.equal(isPlannerQuotedConstant(symbolic, { symbol: "g", value: 9.8 }), true);
  assert.equal(isPlannerQuotedConstant(`${symbolic} Take g = 10 m/s^2.`, { symbol: "g", value: 10 }), false);
  // R is overloaded: a stated 8.31 ohm resistance is not the gas constant.
  assert.equal(isPlannerQuotedConstant("A 8.31 ohm resistor R carries 2 A.", { symbol: "R", value: 8.31 }), false);
  assert.equal(isPlannerQuotedConstant(symbolic, { symbol: "u", value: 0 }), false);
  assert.equal(isPlannerQuotedConstant(symbolic, { symbol: "h", value: 2 }), false);
});

const SHORTEST = "A boat moves at 5 m/s in still water across a 100 m wide river flowing at 3 m/s. It must cross along the shortest path. Find the heading angle upstream and the crossing time.";
const shortestPlan = (withCurrent: boolean): Partial<TurnPlanV3> => ({
  lawIds: ["relative-velocity"],
  givens: [
    given("vb", 5, "m/s", "5 m/s in still water"),
    given("w", 100, "m", "100 m wide"),
    ...(withCurrent ? [given("vr", 3, "m/s", "flowing at 3 m/s")] : []),
  ],
  derived: [
    { id: "alpha", symbol: "alpha", value: 36.87, unit: "deg", sourceText: "sin alpha = 3/5", provenance: "derived", dependsOn: ["vb"] },
    { id: "v", symbol: "v", value: 4, unit: "m/s", sourceText: "v = 4", provenance: "derived", dependsOn: ["vb"] },
    { id: "t", symbol: "t", value: 25, unit: "s", sourceText: "t = w / v", provenance: "derived", dependsOn: ["w", "v"] },
  ],
});

check("an exact figure the plan fully backs is selected", () => {
  const live = selectLikeLive(stemCase(SHORTEST, shortestPlan(true)));
  assert.equal(live.figure, "exact_verified/vector_diagram");
});

const LADDER = "A ladder 5 m long leans against a wall making 60 degrees with the ground. How high up the wall does it reach?";
const ladderPlan = (withAngle: boolean): Partial<TurnPlanV3> => ({
  lawIds: ["trigonometry"],
  givens: [
    given("L", 5, "m", "5 m long"),
    ...(withAngle ? [given("theta", 60, "deg", "60 degrees with the ground")] : []),
  ],
  derived: [{
    id: "h", symbol: "h", value: 4.33, unit: "m", sourceText: withAngle ? "h = 5 sin 60 = 4.33" : "h = 4.33", provenance: "derived",
    dependsOn: withAngle ? ["L", "theta"] : ["L"],
  }],
});

check("an exact figure drawing a stem value the plan omits is still declined", () => {
  const backed = selectLikeLive(stemCase(LADDER, ladderPlan(true)));
  assert.equal(backed.figure, "exact_verified/contact_body", "guard: the backed ladder is exact and selected");
  assert.ok(backed.labels.includes("θ=60°"));
  // The stem states 60 degrees, but only the plan may back a drawn value,
  // exact tier included.
  assert.equal(selectLikeLive(stemCase(LADDER, ladderPlan(false))).figure, null);
});

check("a stem number is not evidence for the drawn launch angle", () => {
  const entry = get("derive_claims_omit_45");
  // The plan's claims never state 45 degrees; the drawn theta = 45 is the
  // derivation's result, not a given, so the fast path declines it.
  assert.equal(selectLikeLive(entry).figure, null);
  const stems = [
    "A wind blows at 45 degrees to the north. Derive the range of a projectile launched with speed u at angle theta on level ground.",
    "A ball is launched with speed u at angle theta. It hits a wall that leans at 60 degrees. Derive its range on level ground.",
    "Derive the range of a projectile launched with speed u at angle theta on level ground. (b) Hence show the maximum range occurs at 45°. (c) A ball thrown at 60° travels 30 m; find u.",
  ];
  for (const question of stems) {
    const live = selectLikeLive(restem(entry, question));
    assert.equal(live.figure, null, `must not commit a labelled value: ${question}`);
  }
});

check("a numeric circuit whose plan dropped its values commits no labelled value", () => {
  const kirchhoff = get("kirchhoff_two_loop");
  const dropped: Partial<TurnPlanV3> = {
    givens: [],
    derived: [],
    unknowns: [],
    qualitativeClaims: kirchhoff.turnPlan.qualitativeClaims.map((claim) => ({ ...claim, relatedQuantityIds: [] })),
  };
  const stems = [
    kirchhoff.question,
    "A 6 ohm and a 3 ohm resistor are connected in parallel across a 9 V battery. A separate 2 ohm resistor is in another circuit. Find the current.",
    "A 12 V battery is connected to a 4 ohm resistor and a 2 ohm resistor in series. Find the current.",
  ];
  for (const question of stems) {
    const live = selectLikeLive(restem(kirchhoff, question, dropped));
    assert.equal(live.figure, null, `must not commit a labelled value: ${question}`);
  }
});

check("a stem that states no angle draws the projectile without one", () => {
  const entry = get("derive_claims_omit_45");
  const question = entry.question.replace("at 45 degrees", "at the angle that maximises it");
  assert.notEqual(question, entry.question);
  const live = selectLikeLive(restem(entry, question));
  assert.equal(live.figure, CONTACT_BODY);
  assert.ok(live.labels.length > 0);
  assert.ok(!live.labels.some((text) => /\d/.test(text)), `unexpected value labels: ${live.labels.join(" ")}`);
  // And against the plan alone a 45 degree label would be unsupported.
  const plan = validateTurnPlanV3(live.plan, question).plan;
  assert.ok(plan);
  assert.ok(validateSceneQuantityAgreement(
    [{ id: "theta", symbol: "theta", value: 45, unit: "degree" }],
    plan,
    ["θ=45°"],
  ).length > 0);
});

check("symbolic quantities written as zero givens still decline the fast figure", () => {
  const live = selectLikeLive(get("derive_symbolic_zeros"));
  assert.equal(live.figure, null);
});

check("river crossing, numeric: verified bindings keep today's selection (none)", () => {
  const live = selectLikeLive(get("river_numeric"));
  assert.equal(live.audit, "verified");
  assert.ok(live.bindings > 0);
  assert.ok(live.families.includes("vector_diagram"));
  assert.equal(live.figure, null);
});

check("river crossing, symbolic: not_applicable with symbolic zero givens keeps today's selection", () => {
  const live = selectLikeLive(get("river_symbolic"));
  assert.equal(live.audit, "not_applicable");
  assert.ok(live.families.includes("vector_diagram"));
  assert.equal(live.figure, null);
});

check("Kirchhoff two loop: structure-routed circuit keeps today's selection", () => {
  const live = selectLikeLive(get("kirchhoff_two_loop"));
  // The captured plan solved its own loop equations wrong (I = 1.8 A; they
  // give 24/13 A) and repeats 1.8 A in its claims, while the captured solver
  // formulation gives 36/13 A. Reconcile writes the solver's value into the
  // quantity, so the claims now contradict it and the audit blocks the turn
  // instead of teaching a current that disagrees with its own working.
  assert.equal(live.audit, "contradiction");
  // An input contradiction is reported before any result is bound.
  assert.equal(live.bindings, 0);
  assert.deepEqual([...live.families], ["circuit_network"]);
  assert.equal(live.figure, null);
});

check("projectile, numeric: verified bindings keep today's selection (none)", () => {
  const live = selectLikeLive(get("projectile_numeric"));
  assert.equal(live.audit, "verified");
  assert.ok(live.bindings > 0);
  assert.equal(live.figure, null);
});

check("concave mirror without ProblemIR keeps today's selection (none)", () => {
  const live = selectLikeLive(get("concave_mirror"));
  assert.equal(live.audit, null);
  assert.equal(live.figure, null);
});

console.log(`verify-fast-figure-authority: ${checks} checks passed`);
