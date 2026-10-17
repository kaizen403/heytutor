/**
 * A bare projectile_trajectory speed is held to the plan's launch speed.
 *
 * The operator reads a speed with no unit as m/s, so a planner that copies 72
 * from "72 km/h" would draw 72 m/s. Production selection holds that bare
 * number to the plan speed in SI (72 km/h is 20 m/s) and refuses a mismatch
 * as invalid_projectile_trajectory_units. With no plan speed, a stem that
 * states a speed in a unit other than m/s refuses the bare number. A stated
 * unit is the scene engine's job and stays untouched here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FIGURE_SOURCES, type TurnPlanV3 } from "@heytutor/scene-engine";
import { diagramStrategyAllowsFigureSource, liveDiagramStrategyDecision } from "../../features/tutor-session/lib/scene/diagramStrategy";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";

const CODE = "invalid_projectile_trajectory_units";
let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks += 1;
  assert.ok(condition, message);
}

type Quantity = TurnPlanV3["givens"][number];
const given = (id: string, value: number, unit: string, symbol = id): Quantity =>
  ({ id, symbol, value, unit, provenance: "given", sourceText: `${symbol} = ${value} ${unit}` }) as Quantity;
const derived = (id: string, value: number, unit: string, symbol = id): Quantity =>
  ({ id, symbol, value, unit, provenance: "derived", dependsOn: [], sourceText: `${symbol} = ${value} ${unit}` }) as Quantity;
const ANGLE = given("theta", 30, "°", "θ");
const GRAVITY = given("g", 10, "m/s^2");
const plan = (question: string, givens: Quantity[], derivedValues: Quantity[] = []): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
  givens: [ANGLE, GRAVITY, ...givens], unknowns: [], derived: derivedValues, qualitativeClaims: [], lawIds: [], assumptions: [],
});
const KMH = "A ball is thrown from level ground at 72 km/h at 30° above the horizontal. Take g = 10 m/s^2. Find its range.";
const MS = "A ball is thrown from level ground at 20 m/s at 30° above the horizontal. Take g = 10 m/s^2. Find its range.";

function candidate(question: string, speed: unknown, quantities: Array<Record<string, unknown>> = []): Record<string, unknown> {
  const ids = ["path", "launch"];
  return {
    schemaVersion: "scene-document/v2", source: { question },
    visualDecision: { mode: "scene", reason: "the launch and the path" },
    quantities: [{ id: "g", symbol: "g", value: 10, unit: "m/s^2" }, ...quantities],
    entities: [{ id: "path", kind: "polyline", role: "trajectory", label: "trajectory" }, { id: "launch", kind: "vector", role: "launch velocity", label: "launch" }],
    constructions: [{ id: "shot", operator: "projectile_trajectory", inputs: { speed, launchAngleDeg: 30, gravity: "g", displayScale: 8 }, outputs: ids }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "reveal", entityIds: ids, dependsOn: [], narrationCue: "the path" }], teachingTimeline: [],
  };
}

const policyFor = (strategy: "strict") => {
  const decision = liveDiagramStrategyDecision({ assignedStrategy: strategy, subject: "physics", strictSubjects: ["maths", "physics"],
    chemistryLane: false, codeLesson: false, dsa: false, doubt: false } as Parameters<typeof liveDiagramStrategyDecision>[0]);
  return { preferPlanner: decision.strategy === "strict", allowedFigureSources: FIGURE_SOURCES.filter((source) => diagramStrategyAllowsFigureSource(decision, source)) };
};

function run(question: string, turnPlan: TurnPlanV3, speed: unknown, quantities: Array<Record<string, unknown>> = []) {
  const validation = validateProductionSceneCandidate({ candidate: candidate(question, speed, quantities), question, turnPlan });
  const units = validation.errors.filter((issue) => issue.code === CODE);
  // Physics runs the strict strategy live (planner first); "current" prefers a source figure when one exists.
  const drawn = validation.valid ? selectProductionScene({
    question, turnPlan, problemIR: null, candidateValidation: validation, fastRepresentation: null,
    exactFigureSource: "planner", solverAuthorityBlocked: false, requiredRetryEnabled: true, policy: policyFor("strict"),
  }).representation : null;
  return { validation, units, drawn, ink: validation.valid && validation.value ? JSON.stringify(validation.value.renderScene.primitives) : null };
}
function refused(label: string, result: ReturnType<typeof run>, mentions?: string) {
  check(!result.validation.valid, `${label}: refused`);
  check(result.units.length === 1 && result.units[0]!.severity === "fatal", `${label}: one fatal ${CODE}, got ${JSON.stringify(result.validation.errors.map((issue) => issue.code))}`);
  check(result.units[0]!.path === "constructions[0].inputs.speed", `${label}: points at the speed input`);
  if (mentions) check(result.units[0]!.message.includes(mentions), `${label}: message names ${mentions}: ${result.units[0]!.message}`);
}
function kept(label: string, result: ReturnType<typeof run>) {
  check(result.validation.valid, `${label}: valid, got ${JSON.stringify(result.validation.errors.map((issue) => `${issue.code} ${issue.message}`))}`);
  check(result.units.length === 0, `${label}: no ${CODE}`);
  check(result.drawn?.figureSource === "planner" && result.drawn.renderScene.primitives.length > 0,
    `${label}: the planner figure is drawn under the strict strategy`);
}

// 1. The km/h stem with the plan's launch speed u = 72 km/h.
const kmhPlan = plan(KMH, [given("u", 72, "km/h")]);
const twenty = run(MS, plan(MS, [given("u", 20, "m/s")]), 20);
refused("km/h stem, bare 72", run(KMH, kmhPlan, 72), "u = 72 km/h");
const kmhTwenty = run(KMH, kmhPlan, 20);
kept("km/h stem, bare 20", kmhTwenty);
check(kmhTwenty.ink === twenty.ink, "km/h stem, bare 20: the same ink as the m/s stem's 20");
refused("km/h stem, unitless wrapper 72", run(KMH, kmhPlan, { value: 72 }));
refused("km/h stem, numeric string 72", run(KMH, kmhPlan, "72"));
const unitless = run(KMH, kmhPlan, "u", [{ id: "u", symbol: "u", value: 72 }]);
check(!unitless.validation.valid && unitless.units.length === 1, "km/h stem, unitless quantity 72: refused with the units code too");
kept("km/h stem, bare 20.000000000000004 (72 * 1000 / 3600 in floating point)", run(KMH, kmhPlan, 72 * 1000 / 3600));
refused("km/h stem, bare 20.5", run(KMH, kmhPlan, 20.5));
// Greptile (7c9f91758): other spellings of the plan's speed unit convert too, so a correct bare 20 is kept.
for (const unit of ["kmph", "kmh", "kph", "km per hour", "kilometres per hour", "kilometers per hour", "km an hour"]) {
  const spelled = plan(KMH, [given("u", 72, unit)]);
  kept(`km/h stem, plan u = 72 ${unit}, bare 20`, run(KMH, spelled, 20));
  refused(`km/h stem, plan u = 72 ${unit}, bare 72`, run(KMH, spelled, 72));
}
for (const unit of ["metres per second", "meters per second", "m per s"]) {
  kept(`plan u = 20 ${unit}, bare 20`, run(KMH, plan(KMH, [given("u", 20, unit)]), 20));
}
kept("plan u = 2000 centimetres per second, bare 20", run(KMH, plan(KMH, [given("u", 2000, "centimetres per second")]), 20));
// A stated unit is the scene engine's job: it converts, and this check never reads it.
for (const [label, speed, quantities] of [
  ["wrapper 72 km/h", { value: 72, unit: "km/h" }, []],
  ["quantity u = 72 km/h", "u", [{ id: "u", symbol: "u", value: 72, unit: "km/h" }]],
] as const) {
  const result = run(KMH, kmhPlan, speed, [...quantities]);
  kept(`km/h stem, ${label}`, result);
  check(result.ink === twenty.ink, `km/h stem, ${label}: the 20 m/s ink`);
}

// 2. The m/s stem.
kept("m/s stem, bare 20", twenty);
refused("m/s stem, bare 72", run(MS, plan(MS, [given("u", 20, "m/s")]), 72), "u = 20 m/s");
refused("m/s stem, bare 21 against a 20 m/s plan", run(MS, plan(MS, [given("u", 20, "m/s")]), 21));
kept("m/s stem, no plan speed, bare 20", run(MS, plan(MS, []), 20));

// 3. No plan speed and a stem speed in another unit.
refused("km/h stem, no plan speed, bare 72", run(KMH, plan(KMH, []), 72), "72 km/h");
refused("km/h stem, no plan speed, bare 20", run(KMH, plan(KMH, []), 20), "72 km/h");
for (const stem of ["at 72 kmph", "at 72 km h⁻¹", "at 72 km h^-1", "at 72 kilometres per hour", "at 72 km/hr", "at 45 mph",
  "at 45 miles per hour", "at 66 ft/s", "at 2000 cm/s", "at 2 km/s", "at 39 knots", "at 72 KM/H", "at 72 km·h⁻¹"]) {
  const question = `A ball is thrown from level ground ${stem} at 30° above the horizontal. Take g = 10 m/s^2. Find its range.`;
  refused(`no plan speed, stem "${stem}"`, run(question, plan(question, []), 20));
}
for (const stem of ["at 20 m/s", "at 20 m s^-1", "at 20 ms⁻¹", "at 20 metres per second", "at 20 m/s with g = 980 cm/s^2",
  "at 20 m/s with g = 980 cm s^-2", "at 20 m/s, 3 km away", "for 2 h at 20 m/s"]) {
  const question = `A ball is thrown from level ground ${stem} at 30° above the horizontal. Find its range.`;
  kept(`no plan speed, stem "${stem}"`, run(question, plan(question, []), 20));
}

// 4. Which plan quantity is a launch speed: by role, then by a rate unit.
for (const [symbol, id] of [["u", "u"], ["u₀", "u0"], ["v₀", "v"], ["v_0", "v0"], ["V0", "launch"], ["v_i", "vi"],
  ["speed", "s1"], ["launch speed", "s2"], ["initial velocity", "s3"], ["v", "v"]] as const) {
  const turnPlan = plan(KMH, [given(id, 72, "km/h", symbol)]);
  kept(`plan speed ${symbol}, bare 20`, run(KMH, turnPlan, 20));
  refused(`plan speed ${symbol}, bare 72`, run(KMH, turnPlan, 72));
}
const later = plan(MS, [given("v0", 40, "m/s", "v₀")], [derived("v", 30, "m/s"), derived("vy", -18, "m/s", "vᵧ"), derived("vx", 24, "m/s", "v₀ₓ")]);
kept("a derived v is a later speed: bare 40 is the launch speed", run(MS, later, 40));
refused("a derived v is a later speed: bare 30 is not the launch speed", run(MS, later, 30));
refused("a velocity component is not the launch speed: bare 24", run(MS, later, 24));
const conversion = plan(KMH, [given("u", 72, "km/h")], [derived("u_si", 20, "m/s", "u")]);
kept("a derived SI launch speed, bare 20", run(KMH, conversion, 20));
kept("a signed plan launch velocity is held by magnitude", run(MS, plan(MS, [given("v0", -20, "m/s", "v₀")]), 20));
kept("ms⁻¹ in the plan is metres per second", run(MS, plan(MS, [given("u", 20, "ms⁻¹")]), 20));
kept("cm/s in the plan converts: 2000 cm/s is 20 m/s", run(MS, plan(MS, [given("u", 2000, "cm/s")]), 20));
refused("mph in the plan cannot be converted by the shared reader", run(MS, plan(MS, [given("u", 45, "mph")]), 45), "u = 45 mph");
refused("mph in the plan, even at its SI value", run(MS, plan(MS, [given("u", 45, "mph")]), 20.1168));
kept("a u in cm is an optics distance, not a speed", run(MS, plan(MS, [given("u", 72, "cm")]), 20));
kept("a u in volts is not a speed", run(MS, plan(MS, [given("u", 72, "V")]), 20));
refused("a u in cm leaves the km/h stem with no plan speed", run(KMH, plan(KMH, [given("u", 72, "cm")]), 20));
kept("a plan speed with no unit leaves an m/s stem unchecked", run(MS, plan(MS, [{ ...given("u", 20, "m/s"), unit: undefined } as unknown as Quantity]), 20));

// 5. Both callers hold it: the live hook and the lab call this validation.
for (const file of ["features/tutor-session/hooks/turn/useQuestionHandler.ts", "scripts/lecture-lab/lecturePipeline.ts"]) {
  const source = readFileSync(resolve(__dirname, "../..", file), "utf8");
  check(/validateProductionSceneCandidate\(\{ candidate, question, turnPlan: authoritativePlan \}\)/.test(source), `${file} validates candidates through production selection`);
}

console.log(`verify-projectile-speed-literal: ${checks} checks ok`);
