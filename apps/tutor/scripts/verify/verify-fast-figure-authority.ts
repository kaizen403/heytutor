/**
 * The deterministic fast figure under a real ProblemIR, on captured turns.
 *
 * Mirrors the planning band of the live hook: reconcile the plan with the
 * solver, audit it, block on a contradiction, infer families with ProblemIR,
 * then selectFastVerifiedRepresentation. The fixtures are live turn plans and
 * ProblemIR captured from the lecture lab, so the planner variance that sent
 * "Derive the range of a projectile" to a 20 to 30 s LLM scene plan is pinned:
 * a not_applicable authority keeps the fast figure, and every bound or
 * structure-routed authority keeps today's selection.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  reconcileTurnPlanWithSolver,
  validateSceneQuantityAgreement,
  validateTurnPlanV3,
  verifyTurnPlanAgainstSolver,
  synthesizeFamilyScene,
  type ProblemIR,
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
}

function selectLikeLive(entry: FixtureCase, overrides: { problemIR?: null } = {}): LiveSelection {
  let plan = entry.turnPlan;
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
  };
}

const PROJECTILE = "qualitative_verified/contact_body";
let checks = 0;
const check = (name: string, run: () => void) => {
  run();
  checks += 1;
  console.log(`ok  ${name}`);
};

check("not_applicable authority keeps the fast projectile figure", () => {
  const entry = get("derive_symbolic");
  const live = selectLikeLive(entry);
  assert.equal(live.audit, "not_applicable");
  assert.equal(live.bindings, 0);
  assert.equal(live.figure, PROJECTILE);
  // ProblemIR present or absent selects the same figure: the null-authority
  // path origin/main took is not what made the figure fast.
  assert.equal(selectLikeLive(entry, { problemIR: null }).figure, live.figure);
});

check("a constant the planner added (g = 9.8) does not make a symbolic question numeric", () => {
  const entry = get("derive_planner_constant");
  assert.deepEqual(entry.turnPlan.givens.map((given) => given.symbol), ["g"]);
  const live = selectLikeLive(entry);
  assert.equal(live.audit, "not_applicable");
  assert.equal(live.figure, PROJECTILE);
});

check("only a constant the question never states is set aside", () => {
  const symbolic = get("derive_planner_constant").question;
  assert.equal(isPlannerQuotedConstant(symbolic, { symbol: "g", value: 9.8 }), true);
  // "Take g = 10" is part of the problem: it stays a given.
  assert.equal(isPlannerQuotedConstant(`${symbolic} Take g = 10 m/s^2.`, { symbol: "g", value: 10 }), false);
  // R is overloaded: a stated 8.31 ohm resistance is not the gas constant.
  assert.equal(isPlannerQuotedConstant("A 8.31 ohm resistor R carries 2 A.", { symbol: "R", value: 8.31 }), false);
  // A planner value that is no standard constant always counts.
  assert.equal(isPlannerQuotedConstant(symbolic, { symbol: "u", value: 0 }), false);
  assert.equal(isPlannerQuotedConstant(symbolic, { symbol: "h", value: 2 }), false);
});

check("a value the question states supports the figure's label when the claims omit it", () => {
  const entry = get("derive_claims_omit_45");
  const live = selectLikeLive(entry);
  assert.equal(live.audit, "not_applicable");
  // Guard the fixture: against the plan alone the 45 degree label is
  // unsupported, so this case does exercise the question evidence.
  const plan = validateTurnPlanV3(live.plan, entry.question).plan;
  assert.ok(plan);
  const scene = synthesizeFamilyScene({
    question: entry.question,
    turnPlan: plan,
    families: live.families,
    problemIR: entry.authority?.problemIR ?? null,
  });
  assert.ok(scene);
  const labels = scene.renderScene.primitives.flatMap((primitive) =>
    (primitive.kind === "label" || primitive.kind === "dimension") && typeof primitive.text === "string"
      ? [primitive.text] : []);
  const planOnly = validateSceneQuantityAgreement(scene.document.quantities, plan, labels);
  assert.ok(planOnly.some((issue) => issue.code === "displayed_quantity_unverified"), "fixture no longer needs question evidence");
  assert.equal(live.figure, PROJECTILE);
});

check("a value nobody stated stays unsupported", () => {
  const entry = get("derive_claims_omit_45");
  const question = entry.question.replace("at 45 degrees", "at the angle that maximises it");
  assert.notEqual(question, entry.question);
  const plan = validateTurnPlanV3({ ...entry.turnPlan, question }, question).plan;
  assert.ok(plan);
  const issues = validateSceneQuantityAgreement(
    [{ id: "theta", symbol: "theta", value: 45, unit: "degree" }],
    plan,
    ["θ=45°"],
  );
  assert.ok(issues.length > 0);
  const live = selectLikeLive({ ...entry, question, turnPlan: { ...entry.turnPlan, question }, authority: null });
  if (live.figure) {
    // Whatever is drawn for the reworded stem must not carry a 45 degree label.
    const fast = selectFastVerifiedRepresentation({
      question,
      turnPlan: live.plan,
      problemIR: null,
      families: live.families,
    });
    assert.ok(fast);
    assert.ok(!fast.renderScene.primitives.some((primitive) =>
      typeof (primitive as { text?: unknown }).text === "string" &&
      /45/.test((primitive as { text: string }).text)));
  }
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
  assert.equal(live.audit, "verified");
  assert.ok(live.bindings > 0);
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
