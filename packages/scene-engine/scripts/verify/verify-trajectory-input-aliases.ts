/**
 * Trajectory operator input aliases (Motion in a Plane, lane T).
 *
 * Fixtures are the exact arguments the live planner wrote in recorded YouTube
 * tries (maseru-v1 .context/youtube/lessons/<try>/chat.json), where the scene
 * candidate was rejected. The one alias normalised is a projectile_trajectory
 * `units` block that only restates the operator's own metre and second
 * convention. Every other recorded mistake, and every ambiguous or
 * contradicted variant, must still fail with its original code.
 */
import { strict as assert } from "node:assert";
import { compileSceneDocument, validateSceneDocument } from "../../src/index";
import { normalizeOperatorInputAliases } from "../../src/document/operatorInputAliases";
import type { SceneDocument, SceneIssue } from "../../src/types";

let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  checks++;
}

type Quantity = { id: string; symbol?: string; value: number; unit: string };
type Construction = { id: string; operator: string; inputs: Record<string, unknown>; outputs: string[] };
function documentOf(quantities: Quantity[], constructions: Construction[], entities: Array<[string, string]>): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "recorded trajectory fixture" },
    source: {},
    quantities: quantities.map((quantity) => ({ ...quantity, symbol: quantity.symbol ?? quantity.id, sourceText: `${quantity.id} = ${quantity.value} ${quantity.unit}`, provenance: "given" })),
    entities: entities.map(([id, kind]) => ({ id, kind, role: kind })),
    constructions,
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: entities.map(([id]) => id),
    revealGroups: [{ id: "revealAll", entityIds: entities.map(([id]) => id), dependsOn: [], narrationCue: "trajectory" }],
    teachingTimeline: [],
  } as unknown as SceneDocument;
}
const codes = (issues: readonly SceneIssue[]) => issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code);
const SI_BLOCK = { speed: "m/s", gravity: "m/s^2", length: "m" } as const;

// --- A. projectile_trajectory with the SI `units` block (the prompt's old "Full shape" told the planner to write it).
const projectileFixtures: Array<{ name: string; quantities: Quantity[]; inputs: Record<string, unknown>; launchPoint?: true }> = [
  { name: "q08-t2 repair 5 make_lower", quantities: [{ id: "u", value: 20, unit: "m/s" }, { id: "low", value: 36.86989764584402, unit: "°" }, { id: "g", value: 10, unit: "m/s²" }],
    inputs: { speed: "u", launchAngleDeg: "low", gravity: "g", displayScale: 1, units: { ...SI_BLOCK } } },
  { name: "q08-t2 repair 5 make_higher", quantities: [{ id: "u", value: 20, unit: "m/s" }, { id: "high", value: 53.13010235415598, unit: "°" }, { id: "g", value: 10, unit: "m/s²" }],
    inputs: { speed: "u", launchAngleDeg: "high", gravity: "g", displayScale: 1, units: { ...SI_BLOCK } } },
  { name: "q08-t2 repair 6 make_lower", quantities: [{ id: "u", value: 20, unit: "m/s" }, { id: "low", value: 36.86989764584402, unit: "°" }, { id: "g", value: 10, unit: "m/s²" }],
    inputs: { speed: "u", launchAngleDeg: "low", gravity: "g", inclineAngleDeg: 0, origin: "launch", displayScale: 1, units: { ...SI_BLOCK } }, launchPoint: true },
  { name: "q08-t2 repair 6 make_higher", quantities: [{ id: "u", value: 20, unit: "m/s" }, { id: "high", value: 53.13010235415598, unit: "°" }, { id: "g", value: 10, unit: "m/s²" }],
    inputs: { speed: "u", launchAngleDeg: "high", gravity: "g", inclineAngleDeg: 0, origin: "launch", displayScale: 1, units: { ...SI_BLOCK } }, launchPoint: true },
  { name: "q11-t1 repair 6 makeProjectile", quantities: [{ id: "v0", value: 40, unit: "m/s" }, { id: "theta", value: 53, unit: "°" }, { id: "g", value: 10, unit: "m/s²" }],
    inputs: { speed: "v0", launchAngleDeg: "theta", gravity: "g", inclineAngleDeg: 0, origin: [0, 0], displayScale: 0.1, samples: 81, units: { ...SI_BLOCK } } },
  { name: "q18-t2 lane 4 cFlight", quantities: [{ id: "launchSpeed", value: 30, unit: "m/s" }, { id: "gravity", value: 10, unit: "m/s^2" }, { id: "inclination", value: 30, unit: "degree" }],
    inputs: { speed: "launchSpeed", launchAngleDeg: 60, gravity: "gravity", inclineAngleDeg: "inclination", displayScale: 1, units: { ...SI_BLOCK } } },
  { name: "q18-t3 lane 4 makeFlight", quantities: [],
    inputs: { speed: 30, launchAngleDeg: 60, gravity: 10, inclineAngleDeg: 30, displayScale: 1, units: { ...SI_BLOCK } } },
];
function projectileDocument(quantities: Quantity[], inputs: Record<string, unknown>, launchPoint?: true): SceneDocument {
  const constructions: Construction[] = [];
  const entities: Array<[string, string]> = [];
  if (launchPoint) { constructions.push({ id: "makeLaunch", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["launch"] }); entities.push(["launch", "point"]); }
  constructions.push({ id: "makeFlight", operator: "projectile_trajectory", inputs, outputs: ["path", "launchVelocity"] });
  entities.push(["path", "polyline"], ["launchVelocity", "vector"]);
  return documentOf(quantities, constructions, entities);
}
/** The production path: validate (which normalises), then compile the validated document. */
function validateThenCompile(document: SceneDocument) {
  const validation = validateSceneDocument(document);
  const compiled = validation.document ? compileSceneDocument(validation.document) : { ok: false, renderScene: null, report: validation.report };
  return { validationCodes: codes(validation.report.issues), compiled };
}
function projectileOutcome(quantities: Quantity[], inputs: Record<string, unknown>, launchPoint?: true) {
  return validateThenCompile(projectileDocument(quantities, structuredClone(inputs), launchPoint));
}
const fieldsRejected = (outcome: ReturnType<typeof projectileOutcome>) =>
  outcome.validationCodes.includes("invalid_projectile_trajectory_fields") && !outcome.compiled.ok && outcome.compiled.renderScene === null;

for (const fixture of projectileFixtures) {
  const recorded = structuredClone(fixture.inputs);
  const withoutUnits = { ...recorded };
  delete withoutUnits.units;
  const [normalized] = normalizeOperatorInputAliases([{ id: "makeFlight", operator: "projectile_trajectory", inputs: recorded, outputs: ["path", "launchVelocity"] }], fixture.quantities) as Construction[];
  check(normalized && !("units" in normalized.inputs), `${fixture.name}: the restated SI units block is dropped`);
  assert.deepEqual(normalized.inputs, withoutUnits, `${fixture.name}: nothing but the units block changes`); checks++;
  check("units" in recorded, `${fixture.name}: the planner's own inputs object is not mutated`);

  const outcome = projectileOutcome(fixture.quantities, fixture.inputs, fixture.launchPoint);
  check(!outcome.validationCodes.some((code) => code.startsWith("invalid_projectile_trajectory_")), `${fixture.name}: no projectile input issue after normalisation: ${outcome.validationCodes.join(",")}`);
  check(outcome.compiled.ok && outcome.compiled.renderScene, `${fixture.name}: compiles: ${JSON.stringify(codes(outcome.compiled.report.issues))}`);
  const reference = validateThenCompile(projectileDocument(fixture.quantities, structuredClone(withoutUnits), fixture.launchPoint)).compiled;
  check(reference.ok && reference.renderScene, `${fixture.name}: the same program without units compiles`);
  assert.deepEqual(outcome.compiled.renderScene!.primitives, reference.renderScene!.primitives, `${fixture.name}: the figure is exactly the one drawn without the units block`); checks++;
  check(outcome.compiled.renderScene!.primitives.some((primitive) => primitive.entityId === "path"), `${fixture.name}: the trajectory reaches ink`);
}

// Spelling aliases of the same SI units also restate the convention.
for (const block of [{ speed: "m s^-1", gravity: "m/s²" }, { speed: "m·s⁻¹", gravity: "m s⁻²", length: "metres" }, { gravity: "m/s2" }]) {
  const outcome = projectileOutcome([{ id: "u", value: 20, unit: "m/s" }], { speed: "u", launchAngleDeg: 30, gravity: 10, displayScale: 1, units: block });
  check(outcome.compiled.ok && outcome.compiled.renderScene, `SI spelling ${JSON.stringify(block)} compiles: ${outcome.validationCodes.join(",")}`);
}

// Ambiguous, partial or contradicted blocks still fail closed with the original code.
const base = { speed: "u", launchAngleDeg: 30, gravity: "g", displayScale: 1 };
const siQuantities: Quantity[] = [{ id: "u", value: 20, unit: "m/s" }, { id: "g", value: 10, unit: "m/s^2" }];
const stillRejected: Array<[string, Quantity[], Record<string, unknown>]> = [
  ["declared km/h speed with a literal value", [], { speed: 72, launchAngleDeg: 30, gravity: 10, displayScale: 1, units: { speed: "km/h", gravity: "m/s^2", length: "m" } }],
  ["declared cm length", siQuantities, { ...base, units: { speed: "m/s", gravity: "m/s^2", length: "cm" } }],
  ["an extra time key the operator never reads", siQuantities, { ...base, units: { ...SI_BLOCK, time: "s" } }],
  ["an angle key", siQuantities, { ...base, units: { ...SI_BLOCK, angle: "deg" } }],
  ["an empty block", siQuantities, { ...base, units: {} }],
  ["a string block", siQuantities, { ...base, units: "SI" }],
  ["a non-string unit", siQuantities, { ...base, units: { speed: 1 } }],
  ["speed quantity in km/h", [{ id: "u", value: 72, unit: "km/h" }, { id: "g", value: 10, unit: "m/s^2" }], { ...base, units: { ...SI_BLOCK } }],
  ["gravity quantity in cm/s^2", [{ id: "u", value: 20, unit: "m/s" }, { id: "g", value: 981, unit: "cm/s^2" }], { ...base, units: { ...SI_BLOCK } }],
  ["inline speed record in km/h", siQuantities, { ...base, speed: { value: 72, unit: "km/h" }, units: { ...SI_BLOCK } }],
  ["initial height quantity in cm", [...siQuantities, { id: "h", value: 80, unit: "cm" }], { ...base, initialHeight: "h", units: { ...SI_BLOCK } }],
  ["an unknown sibling field", siQuantities, { ...base, units: { ...SI_BLOCK }, frame: "ground" }],
];
for (const [name, quantities, inputs] of stillRejected) {
  const outcome = projectileOutcome(quantities, inputs);
  check(fieldsRejected(outcome), `${name}: still rejected as invalid_projectile_trajectory_fields, got ${outcome.validationCodes.join(",")}`);
}

// --- B, C, D. Recorded mistakes that are not unambiguous aliases keep failing with their codes.
const notNormalised: Array<[string, Quantity[], Construction[], Array<[string, string]>, string]> = [
  ["q06-t2 lane 5: tMax names t (s) and the trajectory declares no units",
    [{ id: "t", value: 4, unit: "s" }],
    [{ id: "cTrajectory", operator: "constant_acceleration_trajectory", inputs: { initialPosition: [0, 80], initialVelocity: [30, 0], acceleration: [0, -10], tMin: 0, tMax: "t", samples: 81 }, outputs: ["trajectory"] },
      { id: "cLanding", operator: "trajectory_state", inputs: { trajectory: "trajectory", time: "t", kind: "position" }, outputs: ["landing"] }],
    [["trajectory", "polyline"], ["landing", "point"]], "invalid_constant_acceleration_trajectory_units"],
  ["q11-t2 lane 4: state time names t (s) on a trajectory without units",
    [{ id: "t", value: 5, unit: "s" }],
    [{ id: "make_trajectory", operator: "constant_acceleration_trajectory", inputs: { initialPosition: [0, 0], initialVelocity: [24, 32], acceleration: [0, -10], tMin: 0, tMax: 6.4, samples: 129 }, outputs: ["trajectory"] },
      { id: "make_P", operator: "trajectory_state", inputs: { trajectory: "trajectory", time: "t", kind: "position" }, outputs: ["P"] }],
    [["trajectory", "polyline"], ["P", "point"]], "invalid_trajectory_state_units"],
  ["q16-t2 lane 4: state time names t (s) on a trajectory without units",
    [{ id: "t", value: 2, unit: "s" }],
    [{ id: "makePathA", operator: "constant_acceleration_trajectory", inputs: { initialPosition: [0, 40], initialVelocity: [10, 0], acceleration: [0, -10], tMin: 0, tMax: 2, samples: 81 }, outputs: ["pathA"] },
      { id: "makeCollision", operator: "trajectory_state", inputs: { trajectory: "pathA", time: "t", kind: "position" }, outputs: ["collision"] }],
    [["pathA", "polyline"], ["collision", "point"]], "invalid_trajectory_state_units"],
  ["q12-t1 lane 4: curve_anchor at 0.5 on a projectile_trajectory path",
    [{ id: "speed", value: 20, unit: "m/s" }, { id: "angle", value: 60, unit: "°" }, { id: "gravity", value: 10, unit: "m/s^2" }],
    [{ id: "makeProjectile", operator: "projectile_trajectory", inputs: { speed: "speed", launchAngleDeg: "angle", gravity: "gravity", displayScale: 0.1 }, outputs: ["trajectory", "launchVelocity"] },
      { id: "makeHighestPoint", operator: "curve_anchor", inputs: { curve: "trajectory", at: 0.5 }, outputs: ["highestPoint"] }],
    [["trajectory", "polyline"], ["launchVelocity", "vector"], ["highestPoint", "point"]], "invalid_curve_anchor_curve"],
  ["q11-t1 lane 5: curve_derivative on a projectile_trajectory path",
    [{ id: "v0", value: 40, unit: "m/s" }, { id: "theta", value: 53, unit: "°" }, { id: "g", value: 10, unit: "m/s²" }],
    [{ id: "makeProjectile", operator: "projectile_trajectory", inputs: { speed: "v0", launchAngleDeg: "theta", gravity: "g", displayScale: 0.1 }, outputs: ["trajectory", "initialVelocity"] },
      { id: "makeInstantVelocity", operator: "curve_derivative", inputs: { curve: "trajectory", at: 0.78125, parameterScale: 0.2 }, outputs: ["instantVelocity"] }],
    [["trajectory", "polyline"], ["initialVelocity", "vector"], ["instantVelocity", "vector"]], "invalid_curve_derivative_curve"],
  ["q15-t1 repair 6: curve_anchor at t (s) on a parametric curve with a literal domain",
    [{ id: "t", value: 2, unit: "s" }],
    [{ id: "c_dart_path", operator: "parametric_curve", inputs: { xExpression: "20*t", yExpression: "15*t-5*t^2", parameter: "t", tMin: 0, tMax: 2, samples: 81 }, outputs: ["dart_path"] },
      { id: "c_meeting", operator: "curve_anchor", inputs: { curve: "dart_path", at: "t" }, outputs: ["meeting"] }],
    [["dart_path", "polyline"], ["meeting", "point"]], "invalid_curve_anchor_units"],
];
for (const [name, quantities, constructions, entities, code] of notNormalised) {
  const document = documentOf(quantities, structuredClone(constructions), entities);
  assert.deepEqual(normalizeOperatorInputAliases(document.constructions, document.quantities), document.constructions, `${name}: the normaliser leaves it untouched`); checks++;
  const { validationCodes, compiled } = validateThenCompile(document);
  const compiledCodes = codes(compiled.report.issues);
  check(validationCodes.includes(code) || compiledCodes.includes(code), `${name}: still fails with ${code}, got ${[...validationCodes, ...compiledCodes].join(",")}`);
  check(!compiled.ok && compiled.renderScene === null, `${name}: no partial figure`);
}

console.log(`verify-trajectory-input-aliases: ok (${checks} checks; ${projectileFixtures.length} recorded projectile fixtures, ${stillRejected.length} still rejected, ${notNormalised.length} recorded non-aliases)`);
