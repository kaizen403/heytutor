/**
 * A bare projectile_trajectory speed or launch height is held to the plan.
 *
 * The operator reads a speed with no unit as m/s and a height with no unit as
 * m, so a planner that copies 72 from "72 km/h" would draw 72 m/s, and one
 * that copies 80 from a table "80 cm high" would draw an 80 m drop. Production
 * selection holds the number to the plan in SI (72 km/h is 20 m/s, 80 cm is
 * 0.8 m) and refuses a mismatch as invalid_projectile_trajectory_units:
 * against every launch speed the plan names (two that disagree refuse), else
 * against any plan speed, else, with no plan speed, a stem that states a speed
 * in a unit other than m/s refuses the bare number. An inline wrapper that
 * states a unit is held in that unit. A height is held when some plan length
 * is not in metres.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FIGURE_SOURCES, type TurnPlanV3 } from "@heytutor/scene-engine";
import { diagramStrategyAllowsFigureSource, liveDiagramStrategyDecision } from "../../features/tutor-session/lib/scene/diagramStrategy";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { isSpeedUnit } from "../../features/tutor-session/lib/scene/projectileSpeedLiteral";

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

function candidate(question: string, speed: unknown, quantities: Array<Record<string, unknown>> = [], inputs: Record<string, unknown> = {}): Record<string, unknown> {
  const ids = ["path", "launch"];
  return {
    schemaVersion: "scene-document/v2", source: { question },
    visualDecision: { mode: "scene", reason: "the launch and the path" },
    quantities: [{ id: "g", symbol: "g", value: 10, unit: "m/s^2" }, ...quantities],
    entities: [{ id: "path", kind: "polyline", role: "trajectory", label: "trajectory" }, { id: "launch", kind: "vector", role: "launch velocity", label: "launch" }],
    constructions: [{ id: "shot", operator: "projectile_trajectory", inputs: { speed, launchAngleDeg: 30, gravity: "g", displayScale: 8, ...inputs }, outputs: ids }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "reveal", entityIds: ids, dependsOn: [], narrationCue: "the path" }], teachingTimeline: [],
  };
}

const policyFor = (strategy: "strict") => {
  const decision = liveDiagramStrategyDecision({ assignedStrategy: strategy, subject: "physics", strictSubjects: ["maths", "physics"],
    chemistryLane: false, codeLesson: false, dsa: false, doubt: false } as Parameters<typeof liveDiagramStrategyDecision>[0]);
  return { preferPlanner: decision.strategy === "strict", allowedFigureSources: FIGURE_SOURCES.filter((source) => diagramStrategyAllowsFigureSource(decision, source)) };
};

function run(question: string, turnPlan: TurnPlanV3, speed: unknown, quantities: Array<Record<string, unknown>> = [], inputs: Record<string, unknown> = {}) {
  const validation = validateProductionSceneCandidate({ candidate: candidate(question, speed, quantities, inputs), question, turnPlan });
  const units = validation.errors.filter((issue) => issue.code === CODE);
  // Physics runs the strict strategy live (planner first); "current" prefers a source figure when one exists.
  const drawn = validation.valid ? selectProductionScene({
    question, turnPlan, problemIR: null, candidateValidation: validation, fastRepresentation: null,
    exactFigureSource: "planner", solverAuthorityBlocked: false, requiredRetryEnabled: true, policy: policyFor("strict"),
  }).representation : null;
  return { validation, units, drawn, ink: validation.valid && validation.value ? JSON.stringify(validation.value.renderScene.primitives) : null };
}
function refused(label: string, result: ReturnType<typeof run>, mentions?: string, input = "speed") {
  check(!result.validation.valid, `${label}: refused`);
  check(result.units.length === 1 && result.units[0]!.severity === "fatal", `${label}: one fatal ${CODE}, got ${JSON.stringify(result.validation.errors.map((issue) => issue.code))}`);
  check(result.units[0]!.path === `constructions[0].inputs.${input}`, `${label}: points at the ${input} input`);
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
const MINUTE_ACCELERATION = "A ball is thrown at 20 m/s at 30° above horizontal. Gravity is 36000 metres per minute². Find its range.";
kept("written per-minute acceleration is not a speed", run(MINUTE_ACCELERATION, plan(MINUTE_ACCELERATION, []), 20));
const PER_MINUTE_STEM = "A ball is thrown at 120 m/min at 30° above horizontal. Take g = 10 m/s^2. Find its range.";
refused("no plan speed, per-minute bare number cannot be read as m/s", run(PER_MINUTE_STEM, plan(PER_MINUTE_STEM, []), 120), "120 m/min");
// NFKC turns the Unicode y subscript into Greek gamma; dropping it would make v₀ᵧ look like v₀.
const componentPlan = plan(MS, [given("v0", 40, "m/s", "v₀")], [derived("vy0", 32, "m/s", "v₀ᵧ")]);
kept("a Unicode vertical component cannot become a second launch speed", run(MS, componentPlan, 40));
refused("the Unicode vertical component cannot supply the launch magnitude", run(MS, componentPlan, 32));
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
// A stated unit the plan agrees with is kept, and the scene engine converts it.
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

// Per-minute speeds are non-SI too, including inverse notation and written-out units.
for (const unit of ["m/min", "m/minute", "m min^-1", "m min⁻¹", "metres per minute", "meters per min", "cm/min", "km/min", "metres a minute", "ft/min", "feet per minute", "in/min", "yards/min", "miles per minute", "mm/min", "µm/min"]) {
  const question = `A ball is thrown at 120 ${unit} at 30° above horizontal. Take g = 10 m/s^2. Find its range.`;
  refused(`no plan speed, ${unit}: copied 120 is refused`, run(question, plan(question, []), 120));
  refused(`no plan speed, ${unit}: converted 2 still needs plan authority`, run(question, plan(question, []), 2));
}
for (const unit of ["m/min^2", "m/min²", "metres per minute squared", "m/min/s", "metres per minute²", "metres per minute^2", "metres per minute ^2", "meters per min²", "m/min ^2", "m/min squared", "m/minute ^2"]) {
  const question = `A ball is thrown at 20 m/s with acceleration 120 ${unit}. Find its range.`;
  kept(`${unit} is acceleration, not a non-SI speed in the stem`, run(question, plan(question, []), 20));
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

// 5. No launch role in the plan: the number is held to every plan speed, in the unit the planner wrote (review fix 1).
const KMH_PER_HR = "A ball is thrown from level ground at 72 km per hr at 30° above the horizontal. Take g = 10 m/s^2. Find its range.";
const velPlan = plan(KMH_PER_HR, [given("vel", 72, "km/h")]);
refused("plan vel = 72 km/h, \"km per hr\" stem, bare 72", run(KMH_PER_HR, velPlan, 72), "vel = 72 km/h");
const velTwenty = run(KMH_PER_HR, velPlan, 20);
kept("plan vel = 72 km/h, \"km per hr\" stem, bare 20", velTwenty);
check(velTwenty.ink === twenty.ink, "plan vel = 72 km/h, bare 20: the same ink as the m/s stem's 20");
// With a stem the regex reads, the plan's own unit decides: the right 20 is kept, not refused with the wrong 72.
kept("plan vel = 72 km/h, km/h stem, bare 20", run(KMH, plan(KMH, [given("vel", 72, "km/h")]), 20));
refused("plan vel = 72 km/h, km/h stem, bare 72", run(KMH, plan(KMH, [given("vel", 72, "km/h")]), 72), "vel = 72 km/h");
for (const [stem, symbol, unit] of [
  ["72 km hr^-1", "v_initial", "km/h"], ["72 km hr⁻¹", "u1", "km/h"], ["72 kmhr", "v_A", "kmhr"], ["72 kmphr", "v_p", "km/h"],
  ["72 km./hr.", "v_ball", "km./hr."], ["72 km. per hour", "velocity of projection", "km/h"], ["72 k.m./h", "प्रक्षेप वेग", "km/h"],
  ["72 km/ghanta", "vel", "km/ghanta"], ["72 km prati ghanta", "prakshep veg", "km prati ghanta"], ["72 किमी प्रति घंटा", "वेग", "किमी प्रति घंटा"],
  ["72 km hr^-1", "vel", "km hr^-1"],
] as const) {
  const question = `A ball is thrown from level ground at ${stem} at 30° above the horizontal. Take g = 10 m/s^2. Find its range.`;
  const turnPlan = plan(question, [given("q1", 72, unit, symbol)]);
  refused(`plan ${symbol} = 72 ${unit}, stem "${stem}", bare 72`, run(question, turnPlan, 72));
  kept(`plan ${symbol} = 72 ${unit}, stem "${stem}", bare 20`, run(question, turnPlan, 20));
}
for (const [stem, symbol, value, unit] of [["45 m.p.h.", "vel", 45, "mph"], ["66 fps", "v_ball", 66, "fps"], ["39 kn", "v_A", 39, "kn"],
  ["39 nautical miles per hour", "vel", 39, "nautical miles per hour"]] as const) {
  const question = `A ball is thrown from level ground at ${stem} at 30° above the horizontal. Take g = 10 m/s^2. Find its range.`;
  const turnPlan = plan(question, [given("q1", value, unit, symbol)]);
  refused(`plan ${symbol} = ${value} ${unit}, bare ${value}`, run(question, turnPlan, value), `${symbol} = ${value} ${unit}`);
  refused(`plan ${symbol} = ${value} ${unit} cannot be converted, so a bare 20 is refused too`, run(question, turnPlan, 20));
}
const TWO_BODIES = "Body A is thrown at 15 m/s and body B at 72 km/h, both at 30° above level ground. Take g = 10 m/s^2. Find each range.";
const bodies = plan(TWO_BODIES, [given("u_A", 15, "m/s"), given("u_B", 72, "km/h")]);
kept("two bodies u_A = 15 m/s and u_B = 72 km/h, bare 15", run(TWO_BODIES, bodies, 15));
kept("two bodies u_A = 15 m/s and u_B = 72 km/h, bare 20", run(TWO_BODIES, bodies, 20));
refused("two bodies u_A = 15 m/s and u_B = 72 km/h, bare 72", run(TWO_BODIES, bodies, 72), "u_A = 15 m/s, u_B = 72 km/h");
refused("two bodies, bare 21", run(TWO_BODIES, bodies, 21));
kept("a derived plain v is a plan speed when no launch role is named", run(MS, plan(MS, [], [derived("v", 20, "m/s")]), 20));
refused("a derived plain v holds the number when no launch role is named", run(MS, plan(MS, [], [derived("v", 20, "m/s")]), 72));
// Accelerations and angular speeds are not speeds, so they never become the plan speed.
for (const unit of ["m/s", "km/h", "km per hr", "km hr^-1", "km hr⁻¹", "kmhr", "kmphr", "km./hr.", "k.m./h", "km. per hour", "m.p.h.", "mph", "fps",
  "kn", "knots", "nautical miles per hour", "km/ghanta", "km prati ghanta", "किमी प्रति घंटा", "ms⁻¹", "m s^-1", "cm/s", "km an hour", "m/min"]) {
  check(isSpeedUnit(unit), `${unit} is a speed unit`);
}
for (const unit of ["m/s^2", "m s^-2", "m/s²", "m s⁻²", "m/s/s", "metres per second per second", "metres per second squared", "cm/s^2", "m/sec2",
  "N/kg", "rad/s", "rev/min", "rpm", "°/s", "cm", "m", "V", "°", "s", "kg/m^3", ""]) {
  check(!isSpeedUnit(unit), `${unit || "(empty)"} is not a speed unit`);
}
for (const unit of ["m s^-2", "m/s/s", "m/sec²"]) {
  kept(`g in ${unit} is not a speed: m/s stem, bare 20`, run(MS, { ...plan(MS, []), givens: [ANGLE, given("g", 10, unit)] }, 20));
}
refused("a = 980 cm/s^2 is not a speed: km/h stem, bare 72", run(KMH, plan(KMH, [given("a", 980, "cm/s^2")]), 72), "72 km/h");
kept("ω = 2 rad/s is not a launch speed: m/s stem, bare 20", run(MS, plan(MS, [given("omega", 2, "rad/s", "ω")]), 20));
// The stem regex is the last resort, and reads the spellings a plan with no speed leaves.
for (const stem of ["at 72 km hr^-1", "at 72 kmhr", "at 72 km./hr.", "at 72 km. per hour", "at 72 k.m./h", "at 45 m.p.h.", "at 66 fps",
  "at 39 kn", "at 39 nautical miles per hour", "at 72 km/ghanta", "at 72 km prati ghanta", "at 72 किमी प्रति घंटा", "at 72 किमी/घंटा"]) {
  const question = `A ball is thrown from level ground ${stem} at 30° above the horizontal. Take g = 10 m/s^2. Find its range.`;
  refused(`no plan speed, stem "${stem}"`, run(question, plan(question, []), 20));
}
kept("no plan speed, a 5 kN force is not a speed in knots", run(`${MS.replace("Find its range.", "A 5 kN thrust acts. Find its range.")}`, plan(MS, []), 20));

// 6. An inline wrapper that states a unit is held in that unit (review fix 2).
refused("plan u = 72 km/h, wrapper { 72, m/s }", run(KMH, kmhPlan, { value: 72, unit: "m/s" }), "72 m/s");
refused("plan u = 72 km/h, wrapper { 72, ms^-1 }", run(KMH, kmhPlan, { value: 72, unit: "ms^-1" }));
refused("plan u = 72 km/h, nested wrapper { { 72, m/s } }", run(KMH, kmhPlan, { value: { value: 72, unit: "m/s" } }));
kept("plan u = 72 km/h, wrapper { 20, m/s }", run(KMH, kmhPlan, { value: 20, unit: "m/s" }));
kept("plan u = 72 km/h, wrapper { 20, ms^-1 }", run(KMH, kmhPlan, { value: 20, unit: "ms^-1" }));
kept("plan u = 72 km/h, wrapper { 72, kmph }", run(KMH, kmhPlan, { value: 72, unit: "kmph" }));
refused("plan vel = 72 km/h, wrapper { 72, m/s }", run(KMH_PER_HR, velPlan, { value: 72, unit: "m/s" }), "72 m/s");
kept("plan vel = 72 km/h, wrapper { 72, km/h }", run(KMH_PER_HR, velPlan, { value: 72, unit: "km/h" }));
refused("plan u = 20 m/s, wrapper { 20, km/h }", run(MS, plan(MS, [given("u", 20, "m/s")]), { value: 20, unit: "km/h" }), "20 km/h");

// 7. A launch height is held when some plan length is not in metres (review fix 3).
const TABLE = "A ball rolls off a table 80 cm high at 2 m/s. Take g = 10 m/s^2.";
const tablePlan = (height: Quantity, extra: Quantity[] = []): TurnPlanV3 => ({ ...plan(TABLE, [given("u", 2, "m/s"), height, ...extra]), givens: [GRAVITY, given("u", 2, "m/s"), height, ...extra] });
const tableRun = (turnPlan: TurnPlanV3, initialHeight: unknown, displayScale = 100) =>
  run(TABLE, turnPlan, 2, [], { launchAngleDeg: 0, initialHeight, displayScale });
const cm = tablePlan(given("h", 80, "cm"));
for (const scale of [8, 50, 100]) refused(`table h = 80 cm, bare 80 at displayScale ${scale}`, tableRun(cm, 80, scale), "h = 80 cm", "initialHeight");
kept("table h = 80 cm, bare 0.8", tableRun(cm, 0.8));
refused("table h = 80 cm, numeric string 80", tableRun(cm, "80"), undefined, "initialHeight");
refused("table h = 80 cm, unitless wrapper 80", tableRun(cm, { value: 80 }), undefined, "initialHeight");
refused("table h = 80 cm, wrapper { 80, m }", tableRun(cm, { value: 80, unit: "m" }), "80 m", "initialHeight");
kept("table h = 80 cm, wrapper { 0.8, m }", tableRun(cm, { value: 0.8, unit: "m" }));
refused("table h = 80 centimetres, bare 80", tableRun(tablePlan(given("h", 80, "centimetres")), 80), undefined, "initialHeight");
kept("table h = 80 centimetres, bare 0.8", tableRun(tablePlan(given("h", 80, "centimetres")), 0.8));
kept("table h = 800 mm, bare 0.8", tableRun(tablePlan(given("h", 800, "mm")), 0.8));
kept("table y = -80 cm (signed drop), bare 0.8", tableRun(tablePlan(given("y", -80, "cm")), 0.8));
refused("table h = 2.5 ft, bare 2.5", tableRun(tablePlan(given("h", 2.5, "ft")), 2.5), undefined, "initialHeight");
refused("table h = 2.5 ft cannot be converted, so bare 0.762 is refused too", tableRun(tablePlan(given("h", 2.5, "ft")), 0.762), undefined, "initialHeight");
kept("table h = 0.8 m, all plan lengths in metres: bare 0.8", tableRun(tablePlan(given("h", 0.8, "m")), 0.8));
kept("a range in cm holds the height: h = 0.8 m and R = 80 cm, bare 0.8", tableRun(tablePlan(given("h", 0.8, "m"), [given("R", 80, "cm")]), 0.8));
kept("zero height is the same in every unit", run(TABLE, cm, 2, [], { initialHeight: 0, displayScale: 100 }));
kept("no initialHeight is not held", run(TABLE, cm, 2, [], { displayScale: 100 }));

// 8. The launch role binds the speed: a final velocity or a wind speed never stands in for it (review fix 4).
const LANDS = "A ball is thrown at 20 m/s at 30° above level ground and lands moving at 15 m/s. Take g = 10 m/s^2.";
refused("given u = 20 m/s and a given v_i = 15 m/s final velocity, bare 15", run(LANDS, plan(LANDS, [given("u", 20, "m/s"), given("vi", 15, "m/s", "v_i")]), 15), "disagree");
refused("given u = 20 m/s and a given v_i = 15 m/s final velocity, bare 20: refused rather than one picked", run(LANDS, plan(LANDS, [given("u", 20, "m/s"), given("vi", 15, "m/s", "v_i")]), 20), "disagree");
refused("given u = 20 m/s and a derived v_i = 15 m/s, bare 15", run(LANDS, plan(LANDS, [given("u", 20, "m/s")], [derived("vi", 15, "m/s", "v_i")]), 15), "u = 20 m/s");
kept("given u = 20 m/s and a derived v_i = 15 m/s is not a launch speed, bare 20", run(LANDS, plan(LANDS, [given("u", 20, "m/s")], [derived("vi", 15, "m/s", "v_i")]), 20));
const WIND = "A ball is thrown at 20 m/s at 30° above level ground into a 5 m/s wind. Take g = 10 m/s^2.";
const windPlan = plan(WIND, [given("u", 20, "m/s"), given("speed", 5, "m/s", "v_w")]);
refused("a wind speed with id speed (5 m/s) beside u = 20 m/s, bare 5", run(WIND, windPlan, 5), "disagree");
refused("a wind speed with id speed (5 m/s) beside u = 20 m/s, bare 20: refused rather than one picked", run(WIND, windPlan, 20), "disagree");
refused("a wind speed with id speed, wrapper { 5, m/s }", run(WIND, windPlan, { value: 5, unit: "m/s" }), "disagree");
const later2 = plan(LANDS, [given("u", 20, "m/s")], [derived("speed", 15, "m/s", "|v|")]);
kept("a derived speed is a later speed: bare 20", run(LANDS, later2, 20));
refused("a derived speed is a later speed: bare 15", run(LANDS, later2, 15), "u = 20 m/s");
const agreeing = plan(KMH, [given("u", 72, "km/h"), given("v0", 20, "m/s", "v₀")]);
kept("two launch speeds that agree (u = 72 km/h, v₀ = 20 m/s), bare 20", run(KMH, agreeing, 20));
refused("two launch speeds that agree (u = 72 km/h, v₀ = 20 m/s), bare 72", run(KMH, agreeing, 72), "u = 72 km/h and v₀ = 20 m/s");

// Named quantities need launch-role checks too: value/unit agreement alone also approves a wind or final speed.
refused("wind document quantity cannot supply the launch speed", run(WIND, windPlan, "speed", [{ id: "speed", symbol: "v_w", value: 5, unit: "m/s" }]), "disagree");
refused("final velocity document quantity cannot supply the launch speed", run(LANDS, plan(LANDS, [given("u", 20, "m/s"), given("vi", 15, "m/s")]), "vi", [{ id: "vi", value: 15, unit: "m/s" }]), "disagree");
const unlistedFinal = plan(LANDS, [given("vel", 20, "m/s"), given("vi", 15, "m/s")]);
refused("an ambiguous vi cannot hide an unlisted initial speed", run(LANDS, unlistedFinal, 15), "disagree");
refused("an ambiguous vi cannot hide an unlisted initial speed in a wrapper", run(LANDS, unlistedFinal, { value: 15, unit: "m/s" }), "disagree");
refused("ambiguous vi and vel refuse either number", run(LANDS, unlistedFinal, 20), "disagree");
refused("an ambiguous wind id speed cannot hide an unlisted initial speed", run(WIND, plan(WIND, [given("vel", 20, "m/s"), given("speed", 5, "m/s", "v_w")]), 5), "disagree");
kept("a named document launch speed still draws", run(MS, plan(MS, [given("u", 20, "m/s")]), "u", [{ id: "u", value: 20, unit: "m/s" }]));
kept("a named converted launch speed still draws", run(KMH, kmhPlan, "u", [{ id: "u", value: 72, unit: "km/h" }]));
kept("two unlisted bodies retain their named launch speeds", run(TWO_BODIES, bodies, "u_A", [{ id: "u_A", value: 15, unit: "m/s" }]));

// 9. Both callers hold it: the live hook and the lab call this validation.
for (const file of ["features/tutor-session/hooks/turn/useQuestionHandler.ts", "scripts/lecture-lab/lecturePipeline.ts"]) {
  const source = readFileSync(resolve(__dirname, "../..", file), "utf8");
  check(/validateProductionSceneCandidate\(\{ candidate, question, turnPlan: authoritativePlan \}\)/.test(source), `${file} validates candidates through production selection`);
}

console.log(`verify-projectile-speed-literal: ${checks} checks ok`);
