/** Projectile unit follow-ups, exercised through the production validator and selector. */
import assert from "node:assert/strict";
import { FIGURE_SOURCES, type TurnPlanV3 } from "@heytutor/scene-engine";
import { diagramStrategyAllowsFigureSource, liveDiagramStrategyDecision } from "../../features/tutor-session/lib/scene/diagramStrategy";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { isSpeedUnit, projectileSpeedLiteralIssues } from "../../features/tutor-session/lib/scene/projectileSpeedLiteral";

const CODE = "invalid_projectile_trajectory_units";
let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks += 1;
  assert.ok(condition, message);
}

type Quantity = TurnPlanV3["givens"][number];
const given = (id: string, value: number, unit: string, symbol = id): Quantity =>
  ({ id, symbol, value, unit, provenance: "given", sourceText: `${symbol} = ${value} ${unit}` }) as Quantity;
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

refused("missing plan speed: wrapper cannot relabel 72 km/h as 72 m/s", run(KMH, plan(KMH, []), { value: 72, unit: "m/s" }));
kept("missing plan speed: the stated 72 km/h stays valid", run(KMH, plan(KMH, []), { value: 72, unit: "km/h" }));
kept("missing plan speed: exactly converted 20 m/s stays valid", run(KMH, plan(KMH, []), { value: 20, unit: "m/s" }));
check(!isSpeedUnit("s^-1"), "a frequency is not a linear speed");
for (const unit of ["s^-1", "s⁻¹", "Hz", "kg/s", "N/s", "m^2/s", "m²/s", "J/s", "W/h", "1/s", "rad/s", "rev/min"]) {
  check(!isSpeedUnit(unit), `${unit} is not length per time`);
}
for (const unit of ["m/s", "cm/s", "km/h", "m s^-1", "ms⁻¹", "metres per second", "feet per minute", "nautical miles per hour", "fps", "kn"]) {
  check(isSpeedUnit(unit), `${unit} is a linear speed`);
}
kept("missing plan speed: a frequency cannot bind the launch speed", run(MS, plan(MS, [given("frequency", 3, "s^-1")]), 20));
const SPACED_G = "A ball is thrown at 20 m/s at 30° above horizontal. Take g = 980 cm/s ^2. Find its range.";
kept("a spaced squared exponent is acceleration, not speed", run(SPACED_G, plan(SPACED_G, []), 20));
const TABLE = "A ball rolls off a table 80 cm high at 2 m/s. Take g = 10 m/s^2.";
const noHeight = plan(TABLE, [given("u", 2, "m/s")]);
refused("missing plan height: bare 80 cannot become an 80 m table", run(TABLE, noHeight, 2, [], { launchAngleDeg: 0, initialHeight: 80, displayScale: 50 }), undefined, "initialHeight");
for (const speed of [{ value: 72, unit: "ms^-1" }, { value: { value: 72, unit: "m/s" } }, { value: 20, unit: "km/h" }]) {
  refused("missing plan speed: wrapper must match the question measurement", run(KMH, plan(KMH, []), speed));
}
for (const gravity of ["980 cm/s ^2", "980 cm/s ²", "980 centimetres per second ^2", "980 cm/sec squared", "980 cm/s /s"]) {
  const question = `A ball is thrown at 20 m/s at 30° above horizontal. Take g = ${gravity}. Find its range.`;
  kept(`${gravity} cannot hold a launch speed`, run(question, plan(question, []), 20));
}
for (const height of [80, "80", { value: 80 }, { value: 80, unit: "m" }]) {
  for (const scale of [8, 50, 100]) {
    refused("missing plan height: centimetres cannot become metres", run(TABLE, noHeight, 2, [], { launchAngleDeg: 0, initialHeight: height, displayScale: scale }), undefined, "initialHeight");
  }
}
kept("missing plan height: converted 0.8 m stays valid", run(TABLE, noHeight, 2, [], { launchAngleDeg: 0, initialHeight: 0.8, displayScale: 50 }));
kept("missing plan height: stated 0.8 m stays valid", run(TABLE, noHeight, 2, [], { launchAngleDeg: 0, initialHeight: { value: 0.8, unit: "m" }, displayScale: 50 }));
kept("zero height is unit independent", run(TABLE, noHeight, 2, [], { initialHeight: 0 }));
refused("an unrelated metre length cannot hide the omitted cm height", run(TABLE, plan(TABLE, [given("u", 2, "m/s"), given("R", 80, "m")]), 2, [], { launchAngleDeg: 0, initialHeight: 80 }), undefined, "initialHeight");
for (const gravity of ["980 cm/s ^2", "980 cm s^-2", "980 cm/s/s"]) {
  const question = `A ball is thrown at 20 m/s. Take g = ${gravity}. Find its range.`;
  kept("acceleration cannot become a source length", run(question, plan(question, []), 20, [], { initialHeight: 1 }));
}
const empty = { ...plan(TABLE, []), givens: [] };
const missing = candidate(TABLE, 2, [], { launchAngleDeg: 0, initialHeight: 80, gravity: 10 });
missing.quantities = [];
const result = validateProductionSceneCandidate({ candidate: missing, question: TABLE, turnPlan: empty });
check(!result.valid && result.errors.some(issue => issue.code === CODE && issue.path?.endsWith("initialHeight")), "completely empty plan still refuses the cm-to-m height copy");
refused("missing plan speed: SI wrapper still needs the source value", run(MS, plan(MS, []), { value: 72, unit: "m/s" }));
refused("missing plan speed: bare SI input still needs the source value", run(MS, plan(MS, []), 72));
const TWO = "A ball is launched at 20 m/s through a 36 km/h wind. Take g = 10 m/s^2.";
refused("missing plan speed: a wrapper cannot pick a wind measurement", run(TWO, plan(TWO, []), { value: 10, unit: "m/s" }));
const SI_TABLE = TABLE.replace("80 cm", "0.8 m");
refused("missing plan height: SI source still binds the height", run(SI_TABLE, plan(SI_TABLE, []), 2, [], { launchAngleDeg: 0, initialHeight: 80 }), undefined, "initialHeight");
kept("missing plan height: correct SI height stays valid", run(SI_TABLE, plan(SI_TABLE, []), 2, [], { launchAngleDeg: 0, initialHeight: 0.8 }));
const COMPOSITE = "A ball is launched at 20 m/s from a 30 m platform on a 50 m building. Take g = 10 m/s^2.";
const compositePlan = plan(COMPOSITE, [given("u", 20, "m/s"), given("platform", 30, "m"), given("building", 50, "m")], [{ ...given("h", 80, "m"), provenance: "derived", dependsOn: ["platform", "building"] } as Quantity]);
kept("an authoritative derived height is not replaced by separate source lengths", run(COMPOSITE, compositePlan, 20, [], { initialHeight: 80, displayScale: 8 }));
const MAXIMUM = "A ball is launched at 20 m/s from a 50 m tower at 30° above horizontal. Take g = 10 m/s^2.";
const maximumPlan = plan(MAXIMUM, [given("u", 20, "m/s")], [{ ...given("h", 55, "m"), provenance: "derived", dependsOn: [] } as Quantity]);
kept("a maximum-height h cannot replace the stated launch height", run(MAXIMUM, maximumPlan, 20, [], { initialHeight: 50, displayScale: 8 }));
for (const [written, value, unit] of [["1,000 m/s", 1000, "m/s"], ["3,600 km/h", 1000, "km/h"], ["1,000.5 m/s", 1000.5, "m/s"]] as const) {
  const question = `A ball is launched at ${written} at 30° above horizontal. Take g = 10 m/s^2.`;
  kept("grouped source speeds preserve their whole value", run(question, plan(question, []), unit === "m/s" ? value : { value, unit: "m/s" }, [], { displayScale: 0.001 }));
  refused("grouped source speeds cannot lose their trailing digits", run(question, plan(question, []), { value: 1, unit }));
}
for (const [id, symbol] of [["launch_elevation", "y"], ["initial_elevation", "y0"], ["launch_height", "y_launch"]] as const) {
  const renamed = structuredClone(compositePlan);
  renamed.derived[0]!.id = id; renamed.derived[0]!.symbol = symbol;
  kept("renamed authoritative launch heights retain their geometry", run(COMPOSITE, renamed, 20, [], { initialHeight: 80 }));
}
for (const [unit, value] of [["um/s", 1000000], ["µm/s", 1000000], ["μm/s", 1000000], ["pm/s", 1e12], ["nm/s", 1e9], ["Mm/s", 1e-6], ["Gm/s", 1e-9]] as const) {
  check(isSpeedUnit(unit), `${unit}: the shared unit reader's length prefix remains a speed`);
  const question = "A ball is launched obliquely at 30° above horizontal. Take g = 10 m/s^2.";
  const authority = plan(question, [], [{ ...given("u", value * 20, unit), provenance: "derived", dependsOn: [] } as Quantity]);
  const copied = projectileSpeedLiteralIssues(candidate(question, value * 20), authority, question);
  check(copied.length === 1 && copied[0]!.path.endsWith(".speed"), `${unit}: the copied prefixed number is held by the speed guard`);
  refused(`${unit}: prefixed derived speeds hold a drawable wrong SI value`, run(question, authority, 10));
  kept(`${unit}: prefixed derived speeds retain their converted SI value`, run(question, authority, 20));
}
const GROUPED_TABLE = TABLE.replace("80 cm", "1,000 cm");
refused("grouped source lengths cannot become bare metres", run(GROUPED_TABLE, plan(GROUPED_TABLE, [given("u", 2, "m/s")]), 2, [], { launchAngleDeg: 0, initialHeight: 1000 }), undefined, "initialHeight");
kept("grouped source lengths retain their converted value", run(GROUPED_TABLE, plan(GROUPED_TABLE, [given("u", 2, "m/s")]), 2, [], { launchAngleDeg: 0, initialHeight: 10 }));
for (const symbol of ["y", "elevation"]) {
  const apex = plan(MAXIMUM, [given("u", 20, "m/s")], [{ ...given("apex_y", 55, "m", symbol), provenance: "derived", dependsOn: [] } as Quantity]);
  refused("a later vertical position cannot supply the launch height", run(MAXIMUM, apex, 20, [], { initialHeight: 55 }), undefined, "initialHeight");
}
console.log(`verify-projectile-authority-followups: ${checks} checks ok`);
