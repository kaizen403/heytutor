/**
 * projectile_trajectory fails closed on units.
 *
 * The operator works in m/s, m/s^2, m and degrees. A stated km/h speed is
 * converted to m/s, so 72 km/h draws exactly the 20 m/s figure. Any stated
 * unit it cannot read is a fatal invalid_projectile_trajectory_units issue and
 * nothing renders. A value with no unit keeps today's meaning: the SI unit the
 * operator contract names.
 */
import assert from "node:assert/strict";
import { evaluateChapterRemainderConstruction } from "../../src/compile/chapterRemainderGeometry";
import { SourceInputError, validationNumber, type SourceContext } from "../../src/compile/sourceScalars";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";

let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks += 1;
  assert.ok(condition, message);
}

type Quantity = { id: string; value: unknown; unit?: unknown };
const SPEED = { id: "u", value: 20, unit: "m/s" };
const GRAVITY = { id: "g", value: 10, unit: "m/s^2" };
const ANGLE = { id: "theta", value: 30, unit: "°" };
const HEIGHT = { id: "h", value: 15, unit: "m" };
const BASE_INPUTS = { speed: "u", launchAngleDeg: "theta", gravity: "g", initialHeight: "h", displayScale: 8 };

function scene(quantities: Quantity[], inputs: Record<string, unknown> = BASE_INPUTS): SceneDocument {
  const ids = ["path", "launch"];
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "projectile units" },
    source: {},
    quantities: quantities.map((quantity) => ({ ...quantity })),
    entities: [{ id: "path", kind: "polyline", role: "trajectory" }, { id: "launch", kind: "vector", role: "launch" }],
    constructions: [{ id: "shot", operator: "projectile_trajectory", inputs: structuredClone(inputs), outputs: ids }],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: ids,
    revealGroups: [{ id: "reveal", entityIds: ids, dependsOn: [], narrationCue: "projectile" }],
    teachingTimeline: [],
  } as unknown as SceneDocument;
}
function withQuantity(replacement: Quantity, inputs: Record<string, unknown> = BASE_INPUTS): SceneDocument {
  const base = [SPEED, GRAVITY, ANGLE, HEIGHT].map((quantity) => quantity.id === replacement.id ? replacement : quantity);
  return scene(base, inputs);
}
/** The operator alone, reading quantities the way document validation does. */
function evaluate(document: SceneDocument): unknown {
  const context: SourceContext = {
    number: (value) => validationNumber(value, document),
    point: () => { throw new Error("no points in this fixture"); },
    geometry: () => undefined,
  };
  const construction = document.constructions[0]!;
  return evaluateChapterRemainderConstruction(construction.operator, construction.inputs as Record<string, unknown>, context, document);
}
function inkOf(document: SceneDocument): string {
  const compiled = compileSceneDocument(document);
  check(compiled.ok && compiled.renderScene, `compile: ${JSON.stringify(compiled.report.issues.filter((issue) => issue.severity === "fatal"))}`);
  return JSON.stringify(compiled.renderScene.primitives);
}
function refused(document: SceneDocument, message: string): void {
  checks += 1;
  assert.throws(() => evaluate(document), (error: unknown) => error instanceof SourceInputError && error.key === "units", `${message}: the operator must refuse with key units`);
  const fatal = validateSceneDocument(document).report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code);
  check(fatal.includes("invalid_projectile_trajectory_units"), `${message}: validation must raise invalid_projectile_trajectory_units, saw ${JSON.stringify(fatal)}`);
  const compiled = compileSceneDocument(document);
  check(!compiled.ok && compiled.renderScene === null, `${message}: nothing renders`);
}

// Controls in m/s: the SI figure, and bare numbers keep today's SI meaning.
const control = scene([SPEED, GRAVITY, ANGLE, HEIGHT]);
const controlGeometry = JSON.stringify(evaluate(control));
const controlInk = inkOf(control);
check(controlInk.includes("\"path\"") && controlInk.includes("\"launch\""), "the m/s control draws the path and the launch arrow");
const bare = scene([{ id: "u", value: 20 }, { id: "g", value: 10 }, { id: "theta", value: 30 }, { id: "h", value: 15 }]);
check(JSON.stringify(evaluate(bare)) === controlGeometry, "quantities with no unit read as m/s, m/s^2, degrees and m");
check(inkOf(bare) === controlInk, "unitless quantities draw the SI figure");
const literal = scene([], { speed: 20, launchAngleDeg: 30, gravity: 10, initialHeight: 15, displayScale: 8 });
check(inkOf(literal) === controlInk, "literal numbers draw the SI figure");
for (const unit of ["m s⁻¹", "m s^-1", "m/sec", "metres per second"]) {
  check(inkOf(withQuantity({ ...SPEED, unit })) === controlInk, `speed spelt ${unit} is m/s`);
}
for (const unit of ["m/s²", "m s⁻²", "m s^-2", "m/s/s"]) {
  check(inkOf(withQuantity({ ...GRAVITY, unit })) === controlInk, `gravity spelt ${unit} is m/s^2`);
}
for (const unit of ["metres", "meter"]) check(inkOf(withQuantity({ ...HEIGHT, unit })) === controlInk, `height spelt ${unit} is m`);
for (const unit of ["deg", "degree", "degrees"]) check(inkOf(withQuantity({ ...ANGLE, unit })) === controlInk, `angle spelt ${unit} is degrees`);

// km/h is converted only because it is stated: 72 km/h is the 20 m/s figure.
const kmh = withQuantity({ id: "u", value: 72, unit: "km/h" });
check(JSON.stringify(evaluate(kmh)) === controlGeometry, "72 km/h has the 20 m/s geometry exactly");
check(inkOf(kmh) === controlInk, "72 km/h draws the 20 m/s figure");
const wrongReading = scene([{ id: "u", value: 72, unit: "m/s" }, GRAVITY, ANGLE, HEIGHT]);
check(inkOf(wrongReading) !== controlInk, "the fixture discriminates: 72 m/s is a different figure");
for (const unit of ["km/hr", "kmph", "km h⁻¹", "km/hour"]) {
  check(inkOf(withQuantity({ id: "u", value: 72, unit })) === controlInk, `speed spelt ${unit} converts from km/h`);
}
const wrapped = scene([GRAVITY, ANGLE, HEIGHT], { ...BASE_INPUTS, speed: { value: 72, unit: "km/h" } });
check(inkOf(wrapped) === controlInk, "a {value, unit} wrapper in km/h converts too");
const nested = scene([{ id: "u", value: { value: 72, unit: "km/h" }, unit: "km/h" }, GRAVITY, ANGLE, HEIGHT]);
check(inkOf(nested) === controlInk, "a quantity and its wrapper agreeing on km/h convert once");
const launchMark = (evaluate(kmh) as Array<{ remainder: { magnitude: number; unit: string } }>)[1]!.remainder;
check(launchMark.unit === "m/s" && Math.abs(launchMark.magnitude - 20) < 1e-12, "the launch arrow certifies 20 m/s");

// Unreadable or wrong-dimension units are refused, never read as SI.
for (const unit of ["mph", "ft/s", "cm/s", "km/s", "knots", "M/S", "m/s^2", "", "constructor", "toString"]) {
  refused(withQuantity({ id: "u", value: 20, unit }), `speed in ${JSON.stringify(unit)}`);
}
for (const unit of ["ft/s^2", "cm/s^2", "m/s", "N/kg", "g"]) refused(withQuantity({ ...GRAVITY, unit }), `gravity in ${unit}`);
for (const unit of ["cm", "km", "ft", "s"]) refused(withQuantity({ ...HEIGHT, unit }), `height in ${unit}`);
for (const unit of ["rad", "radian", "grad"]) refused(withQuantity({ ...ANGLE, unit }), `launch angle in ${unit}`);
refused(scene([SPEED, GRAVITY, ANGLE, HEIGHT, { id: "beta", value: 0.5, unit: "rad" }], { ...BASE_INPUTS, inclineAngleDeg: "beta" }), "incline angle in rad");
refused(scene([GRAVITY, ANGLE, HEIGHT], { ...BASE_INPUTS, speed: { value: 20, unit: "furlong/fortnight" } }), "a wrapper unit it cannot read");
refused(scene([{ id: "u", value: { value: 72, unit: "km/h" }, unit: "m/s" }, GRAVITY, ANGLE, HEIGHT]), "a quantity and its wrapper disagreeing");

console.log(`projectile units verification passed (${checks} checks)`);
