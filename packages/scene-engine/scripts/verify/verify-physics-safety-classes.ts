import { compileSceneDocument } from "../../src/compile/compiler";
import { evaluateMagneticHelix, magneticHelixPoint } from "../../src/compile/magneticHelixGeometry";
import { validateSceneDocument } from "../../src/document/validation";
import { validatePhysicsRegionClaims } from "../../src/compile/physicsRegionClaims";
import { readFileSync } from "node:fs";
import type { SceneDocument, SceneIssue } from "../../src/types";

let checks = 0;
const failures: string[] = [];
function check(condition: unknown, message: string): void { checks++; if (!condition) failures.push(message); }
function scene(): SceneDocument {
  return { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "class regression" }, source: {}, quantities: [], entities: [], constructions: [], relations: [], assertions: [], annotations: [], requiredEntityIds: [], revealGroups: [], teachingTimeline: [] };
}
function add(doc: SceneDocument, id: string, kind: string, operator: string, inputs: Record<string, unknown>, role = kind, label?: string): void {
  doc.entities.push({ id, kind, role, ...(label ? { label } : {}) });
  doc.constructions.push({ id: `make_${id}`, operator, inputs, outputs: [id] });
  doc.requiredEntityIds.push(id);
}
function compile(doc: SceneDocument) {
  doc.revealGroups = [{ id: "figure", entityIds: doc.requiredEntityIds, dependsOn: [], narrationCue: "Draw verified geometry." }];
  return compileSceneDocument(doc);
}

// The real Doppler output used end=observer with length=1. A reference point
// supplies direction; explicit length must still choose the arrow's span.
const velocity = scene();
add(velocity, "source", "point", "point", { x: 0, y: 0 }, "source", "S");
add(velocity, "observer", "point", "point", { x: 4, y: 0 }, "observer", "O");
add(velocity, "line", "line", "line", { start: "source", end: "observer" });
add(velocity, "velocity", "vector", "vector", { start: "source", end: "observer", length: 1 }, "velocity", "v_s");
const arrow = compile(velocity).renderScene?.primitives.find(p => p.entityId === "velocity" && p.kind === "vector");
check(arrow, "endpoint-directed velocity arrow survives its coincident supporting line");
const source = compile(velocity).renderScene?.primitives.find(p => p.entityId === "source" && p.kind === "point")?.points[0];
const observer = compile(velocity).renderScene?.primitives.find(p => p.entityId === "observer" && p.kind === "point")?.points[0];
check(arrow && source && observer && Math.abs(Math.hypot(arrow.points[1]!.x - arrow.points[0]!.x, arrow.points[1]!.y - arrow.points[0]!.y) / Math.hypot(observer.x - source.x, observer.y - source.y) - 0.25) < 1e-9, "endpoint-directed vector honors its length");
const coincident = structuredClone(velocity);
delete coincident.constructions.at(-1)!.inputs.length;
check(compile(coincident).renderScene?.primitives.some(p => p.entityId === "velocity" && p.kind === "vector"), "a full-span direction overlay survives supporting-line deduplication");

// A stated zero-field region contradicts any electric-field arrow through its
// interior. It does not forbid unrelated velocity/force arrows in the region.
const slab = scene();
add(slab, "centre", "point", "point", { x: 0, y: 0 });
add(slab, "slab", "polygon", "rectangle", { center: "centre", width: 4, height: 1 }, "conductor");
add(slab, "field", "vector", "vector", { start: "centre", direction: [0, -1], length: 1 }, "electric field", "E_air");
slab.quantities.push({ id: "zero", value: 0, unit: "V/m", symbol: "E_slab" });
slab.annotations.push({ id: "zero_field", kind: "callout", targetIds: ["slab"], text: "E_slab = 0", quantityId: "zero" });
const slabResult = compile(slab);
check(!slabResult.ok && slabResult.report.issues.some(i => i.code === "field_in_zero_region"), "electric field through a declared zero-field interior is refused");

const helix = scene();
add(helix, "origin", "point", "point", { x: 0, y: 0 });
add(helix, "frame", "polyline", "space_frame", { origin: "origin", scale: 1, axisLength: 1 });
add(helix, "start", "point", "space_point", { frame: "frame", x: 0, y: 0, z: 0 });
add(helix, "trajectory", "polyline", "magnetic_helix", { frame: "frame", origin: "start", mass: 1e-26, charge: 1e-19, velocity: [3e5, 0, 4e5], magneticField: [0, 0, 0.5], turns: 2, displayScale: 1, units: { mass: "kg", charge: "C", velocity: "m/s", magneticField: "T" } }, "helical trajectory", "helix");
const helixResult = compile(helix);
check(helixResult.ok && helixResult.renderScene?.primitives.some(p => p.entityId === "trajectory" && p.points.length > 50), "uniform-field motion is a sampled 3D helix, not a circle");

// General negations: a gap arrow or boundary stroke is valid; an arrow whose
// endpoints are outside but which traverses the region is still invalid.
for (const [start, direction, length, rejected, role] of [
  [[0, 0.7], [0, 1], 0.5, false, "electric field"],
  [[0, -1], [0, 1], 2, true, "electric field"],
  [[-3, 0], [1, 0], 6, true, "electric field"],
  [[-3, 0.5], [1, 0], 6, false, "electric field"],
  [[0, 0], [0, 1], 1, false, "velocity"],
  [[0, 0], [0, 1], 1, false, "magnetic field"],
] as const) {
  const test = structuredClone(slab);
  const entity = test.entities.find(e => e.id === "field")!;
  entity.role = role; entity.label = role === "electric field" ? "E_air" : role === "velocity" ? "v" : "B";
  test.constructions.find(c => c.outputs.includes("field"))!.inputs = { start, direction, length };
  const result = compile(test);
  check(result.ok === !rejected, `zero-region interior rule: ${JSON.stringify({ start, role, rejected })}`);
}
const missingZero = structuredClone(slab); missingZero.annotations = [];
check(compile(missingZero).ok, "a field has no zero-region contradiction without a declared zero claim");
const staleZero = structuredClone(slab); staleZero.quantities[0]!.value = 3;
check(compile(staleZero).ok, "region's numeric quantity, not printed text, is the zero authority");

const geometries = new Map<string, unknown>([
  ["f", { kind: "compound", spaceFrame: { origin: { x: 0, y: 0 }, scale: 1 } }],
  ["o", { kind: "point", space: { x: 0, y: 0, z: 0 }, spaceFrameId: "f" }],
]);
const context = { number: (value: unknown) => Number(value), geometry: (id: unknown) => geometries.get(String(id)) };
const physical = { frame: "f", origin: "o", mass: 1e-26, charge: 1e-19, velocity: [3e5, 0, 4e5], magneticField: [0, 0, 0.5], turns: 2, displayScale: 1, units: { mass: "kg", charge: "C", velocity: "m/s", magneticField: "T" } };
const definition = evaluateMagneticHelix(physical, context)[0]!.magneticHelix;
check(Math.abs(definition.radius - 0.06) < 1e-14, "independent helix radius m*v_perp/(abs(q)*B) is 0.060 m");
check(Math.abs(definition.pitch - 0.16 * Math.PI) < 1e-14, "independent helix pitch v_parallel*2*pi*m/(abs(q)*B)");
const fullTurn = magneticHelixPoint(definition, definition.period);
check(Math.hypot(fullTurn.x, fullTurn.y) < 1e-14 && Math.abs(fullTurn.z - definition.pitch) < 1e-14, "one turn returns transversely while advancing a pitch");
const quarter = magneticHelixPoint(definition, definition.period / 4);
const opposite = evaluateMagneticHelix({ ...physical, charge: -physical.charge }, context)[0]!.magneticHelix;
const oppositeQuarter = magneticHelixPoint(opposite, opposite.period / 4);
check(quarter.x > 0 && quarter.y < 0 && oppositeQuarter.x > 0 && oppositeQuarter.y > 0 && quarter.z === oppositeQuarter.z, "charge sign reverses transverse handedness without reversing parallel motion");
const negativePitch = evaluateMagneticHelix({ ...physical, velocity: [3e5, 0, -4e5] }, context)[0]!.magneticHelix;
check(negativePitch.pitch < 0 && negativePitch.radius === definition.radius, "parallel velocity sign reverses axial advance and keeps radius");
for (const mutation of [{ mass: 0 }, { charge: 0 }, { magneticField: [0, 0, 0] }, { velocity: [3e5, 0, 0] }, { velocity: [0, 0, 4e5] }, { turns: 13 }, { displayScale: 0 }, { origin: "foreign" }, { units: { ...physical.units, charge: "mC" } }, { radius: 100 }]) {
  let refused = false; try { evaluateMagneticHelix({ ...physical, ...mutation }, context); } catch { refused = true; }
  check(refused, `helix refuses invalid/unproven inputs: ${JSON.stringify(mutation)}`);
}
const wrongRadius = structuredClone(helix); wrongRadius.entities.at(-1)!.label = "r = 9 m";
check(compile(wrongRadius).report.issues.some(i => i.code === "invalid_magnetic_helix_label"), "wrong radius value cannot pair with a correct helix");
const goodMeasurements = structuredClone(helix);
goodMeasurements.annotations = [{ id: "r", kind: "callout", targetIds: ["trajectory"], text: "r = 0.060 m" }, { id: "p", kind: "callout", targetIds: ["trajectory"], text: "p ≈ 0.503 m" }];
check(compile(goodMeasurements).ok, "source-derived radius and rounded pitch remain valid");
const implicit = structuredClone(helix);
implicit.entities.at(-1)!.kind = "circle";
implicit.constructions.at(-1)!.operator = "circle";
implicit.constructions.at(-1)!.inputs = { center: "origin", radius: 1 };
check(compile(implicit).report.issues.some(i => i.code === "helical_path_not_proven"), "typed helical trajectory is not proved by a circle");
const unrelated = structuredClone(implicit);
add(unrelated, "unrelatedHelix", "polyline", "magnetic_helix", { ...helix.constructions.at(-1)!.inputs }, "helical trajectory");
check(compile(unrelated).report.issues.some(i => i.code === "helical_path_not_proven" && i.entityIds?.includes("trajectory")), "an unrelated valid helix cannot bless the planar trajectory");
const hiddenIssues: SceneIssue[] = [];
validatePhysicsRegionClaims(implicit, new Map<string, unknown>([["trajectory", { kind: "circle", center: { x: 0, y: 0 }, radius: 1 }], ["hiddenHelix", evaluateMagneticHelix(physical, context)[0]]]), Number, hiddenIssues);
check(hiddenIssues.some(i => i.code === "helical_path_not_proven" && i.entityIds?.includes("trajectory")), "a hidden computed helix cannot bless the planar trajectory");
const namedOrigin = structuredClone(helix); namedOrigin.entities.find(e => e.id === "start")!.label = "helix origin";
check(compile(namedOrigin).ok, "a point may name the helix origin without claiming to draw a trajectory");
const projection = structuredClone(implicit); delete projection.entities.at(-1)!.label;
projection.annotations = [{ id: "projection_caption", kind: "callout", targetIds: ["trajectory"], text: "transverse projection" }];
const projectionResult = compile(projection);
check(projectionResult.ok, `a visibly labelled planar cross section is an honest projection: ${JSON.stringify(projectionResult.report.issues)}`);
projection.annotations.push({ id: "fake_pitch", kind: "callout", targetIds: ["trajectory"], text: "pitch = 2 m" });
check(compile(projection).report.issues.some(i => i.code === "helical_path_not_proven"), "a projection caption cannot certify a pitch claim");

for (const angle of [0, Math.PI / 5, Math.PI / 2]) {
  const rotated = structuredClone(slab), origin = { x: 1e6, y: -1e6 };
  const transform = ([x, y]: readonly number[]) => [origin.x + x! * Math.cos(angle) - y! * Math.sin(angle), origin.y + x! * Math.sin(angle) + y! * Math.cos(angle)];
  rotated.constructions.find(c => c.outputs.includes("centre"))!.inputs = { x: origin.x, y: origin.y };
  const corners = [[-2, -0.5], [2, -0.5], [2, 0.5], [-2, 0.5]].map(transform);
  const region = rotated.constructions.find(c => c.outputs.includes("slab"))!;
  region.operator = "polygon"; region.inputs = { points: corners };
  const field = rotated.constructions.find(c => c.outputs.includes("field"))!;
  field.inputs = { start: transform([-3, 0]), end: transform([3, 0]) };
  check(compile(rotated).report.issues.some(i => i.code === "field_in_zero_region"), `translated/rotated crossing at angle ${angle} is rejected`);
  field.inputs = { start: transform([-3, 0.5]), end: transform([3, 0.5]) };
  check(compile(rotated).ok, `translated/rotated boundary at angle ${angle} remains valid`);
}
const worldOverlapIssues: SceneIssue[] = [];
validatePhysicsRegionClaims(slab, new Map<string, unknown>([
  ["slab", { kind: "path", closed: true, points: [{ x: -2, y: -0.5 }, { x: 2, y: -0.5 }, { x: 2, y: 0.5 }, { x: -2, y: 0.5 }] }],
  ["field", { kind: "path", directed: true, points: [{ x: -3, y: 0 }, { x: 3, y: 0 }], spaceSegment: { frameId: "f", a: { x: -3, y: 0, z: 100 }, b: { x: 3, y: 0, z: 100 }, length: 6 } }],
]), () => 0, worldOverlapIssues);
check(!worldOverlapIssues.some(i => i.code === "field_in_zero_region"), "a 3D vector outside the region's plane is not refused for projected screen overlap");
const droppedWorld = structuredClone(helix);
add(droppedWorld, "screenVector", "vector", "vector", { start: "origin", direction: "trajectory", length: 1 }, "direction");
check(!compile(droppedWorld).ok, "a screen vector cannot discard the helix's world geometry metadata");

// Retained planner documents are regression oracles, not runtime templates.
const saved = JSON.parse(readFileSync(new URL("./fixtures/physics-safety-candidates.json", import.meta.url), "utf8")) as Record<string, SceneDocument>;
for (const [name, raw] of Object.entries(saved)) {
  const normalized = validateSceneDocument(raw).document;
  const result = normalized ? compileSceneDocument(normalized) : null;
  if (name.includes("doppler")) {
    check(result?.ok && result.renderScene?.primitives.some(p => p.entityId === "sourceVelocity" && p.kind === "vector"), "recorded Doppler scene preserves source velocity arrow");
  } else if (name.includes("helical")) {
    check(!result?.ok && result?.report.issues.some(i => i.code === "helical_path_not_proven"), "recorded planar helix is refused");
  } else if (name.endsWith("-0.json")) {
    check(!result?.ok && result?.report.issues.some(i => i.code === "field_in_zero_region"), "recorded slab primary field cannot pass through conductor");
  } else {
    check(result?.ok, "recorded slab alternate with fields in both air gaps still passes");
  }
}

console.log(`${checks - failures.length}/${checks} physics safety checks passed`);
for (const message of failures) console.error(`FAIL: ${message}`);
if (failures.length) process.exitCode = 1;
