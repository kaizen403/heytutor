/**
 * Final rendered labels retain their geometric carrier, and values keep MAIN's
 * summary stack: an "X = value" or quantity label is never moved onto a stroke
 * (beside a segment it would read as that segment's measure), and one entity
 * keeps MAIN's single label. These small Euclidean fixtures are independently
 * constructed; recorded questions stay in verify-label-placement-review-rows.
 *
 * pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-geometric-label-attachment.ts
 */
import assert from "node:assert/strict";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { RenderPoint, RenderPrimitive, SceneDocument } from "../../src/types";

const failures: string[] = [];
let passed = 0;
function check(name: string, body: () => void): void {
  try { body(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

function scene(): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "geometric attachment" },
    source: { question: "Show the labelled geometric objects and their stated values." },
    quantities: [], entities: [], constructions: [], relations: [], assertions: [], annotations: [],
    requiredEntityIds: [], revealGroups: [], teachingTimeline: [],
  };
}
function point(document: SceneDocument, id: string, x: number, y: number): void {
  document.entities.push({ id, kind: "point", role: "construction helper" });
  document.constructions.push({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] });
}
function path(document: SceneDocument, id: string, start: string, end: string, kind = "segment", label?: string): void {
  document.entities.push({ id, kind, role: kind, ...(label ? { label } : {}) });
  document.constructions.push({ id: `make_${id}`, operator: kind, inputs: { start, end }, outputs: [id] });
}
function compiled(document: SceneDocument): RenderPrimitive[] {
  document.requiredEntityIds = document.entities.filter((entity) => entity.kind !== "point" || entity.label).map((entity) => entity.id);
  document.revealGroups = [{ id: "setup", entityIds: document.entities.map((entity) => entity.id), dependsOn: [], narrationCue: "Show the geometry." }];
  const result = compileSceneDocument(document);
  assert.ok(result.ok && result.renderScene, `fixture must remain drawable: ${result.report.issues.map((issue) => issue.code).join(", ")}`);
  return result.renderScene.primitives;
}
function only(primitives: RenderPrimitive[], id: string): RenderPrimitive {
  const primitive = primitives.find((candidate) => candidate.id === id);
  assert.ok(primitive, `missing rendered primitive ${id}`);
  return primitive;
}
function distanceToStroke(point: RenderPoint, carrier: RenderPrimitive): number {
  if (carrier.points.length === 1) return Math.hypot(point.x - carrier.points[0]!.x, point.y - carrier.points[0]!.y);
  return Math.min(...carrier.points.slice(1).map((end, index) => {
    const start = carrier.points[index]!, dx = end.x - start.x, dy = end.y - start.y;
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
  }));
}
function assertAttached(primitives: RenderPrimitive[], label: RenderPrimitive, carrier: RenderPrimitive): void {
  assert.equal(label.entityId, carrier.entityId, `${label.text} preserves its source owner`);
  const box = label.provenance?.labelBounds as { width: number; height: number } | undefined;
  assert.ok(box, `${label.id} retains its text bounds`);
  // Text must be close to the actual stroke, allowing its own half diagonal.
  assert.ok(distanceToStroke(label.points[0]!, carrier) <= Math.hypot(box.width, box.height) / 2 + 32,
    `${label.id} floats away from ${carrier.id}`);
  const leader = primitives.find((primitive) => primitive.id === `${label.id}_leader`);
  if (leader) assert.ok(distanceToStroke(leader.points[0]!, carrier) <= 0.05, `${leader.id} starts on its exact carrier`);
}

function assertSummary(value: RenderPrimitive, text: string): void {
  assert.equal(value.text, text, "the complete authored value remains visible");
  assert.equal(value.provenance?.summary, true, `${value.id} keeps MAIN's summary stack instead of moving onto a stroke`);
  assert.notEqual(value.provenance?.usesLeader, true, "a summary does not gain a guessed connector");
}

check("quantity-bound vector value keeps the summary stack", () => {
  const document = scene(); point(document, "O", 0, 0); point(document, "U", -3, 4);
  path(document, "velocity", "O", "U", "vector", "v");
  document.quantities.push({ id: "speed", symbol: "v", value: 5, unit: "m/s", provenance: "given" });
  document.annotations.push({ id: "speed_value", kind: "label", targetIds: ["velocity"], quantityId: "speed", text: "5 m/s" });
  const primitives = compiled(document);
  assertSummary(only(primitives, "speed_value"), "5 m/s");
  assertAttached(primitives, only(primitives, "primitive_velocity_label"), only(primitives, "primitive_velocity"));
});

check("two scalar values on one body both keep the summary stack", () => {
  const document = scene(); point(document, "body", 0, 0);
  document.entities[0]!.label = "P";
  for (const [id, symbol, value, unit] of [["mass", "m", 2, "kg"], ["charge", "q", 3, "C"]] as const) {
    document.quantities.push({ id, symbol, value, unit, provenance: "given" });
    document.annotations.push({ id: `label_${id}`, kind: "label", targetIds: ["body"], quantityId: id, text: `${value} ${unit}` });
  }
  const primitives = compiled(document);
  assertSummary(only(primitives, "label_mass"), "2 kg");
  assertSummary(only(primitives, "label_charge"), "3 C");
});

// Row 653 of the frozen set: "air" and "glass" both aimed at one boundary.
// MAIN draws the first label only; nothing proves the second one's side.
check("a second label on one entity keeps MAIN's single label", () => {
  const document = scene(); point(document, "A", 0, -2); point(document, "B", 0, 2);
  path(document, "boundary", "A", "B");
  document.annotations.push(
    { id: "airLabel", kind: "label", targetIds: ["boundary"], text: "air", placementIntent: "left" },
    { id: "glassLabel", kind: "label", targetIds: ["boundary"], text: "glass", placementIntent: "right" },
  );
  const primitives = compiled(document);
  const labels = primitives.filter((primitive) => primitive.kind === "label" && primitive.entityId === "boundary");
  assert.deepEqual(labels.map((label) => label.text), ["air"], "only the first label on the boundary is drawn");
});

check("diagonal vector name stays beside its actual stroke", () => {
  const document = scene(); point(document, "O", 0, 0); point(document, "A", -3, 4); point(document, "B", 0, 4); point(document, "N", 0, 5);
  path(document, "reference", "O", "N", "segment", "north");
  path(document, "diagonal", "O", "A", "vector", "v_a");
  path(document, "horizontal", "A", "B", "vector", "v_w");
  path(document, "vertical", "O", "B", "vector", "v_g");
  const primitives = compiled(document);
  assertAttached(primitives, only(primitives, "primitive_diagonal_label"), only(primitives, "primitive_diagonal"));
});

// A generic arc is a curve, not an angle_mark. Its full or reflex sweep must
// remain intact and must not acquire the minor-angle label restriction.
for (const degrees of [270, 360]) check(`generic ${degrees} degree arc remains a curve`, () => {
  const document = scene(); point(document, "O", 0, 0);
  document.entities.push({ id: "curve", kind: "arc", role: "curve", label: "c" });
  document.constructions.push({ id: "make_curve", operator: "arc", inputs: { center: "O", radius: 2, startAngle: 0, endAngle: degrees, angleUnit: "degrees" }, outputs: ["curve"] });
  const primitives = compiled(document), arc = only(primitives, "primitive_curve");
  assert.ok(Math.abs(Math.abs(arc.endAngle! - arc.startAngle!) - degrees * Math.PI / 180) < 1e-10, "generic arc retains its full evaluated sweep");
  assert.ok(primitives.some((primitive) => primitive.entityId === "curve" && primitive.kind === "label"), "generic arc keeps its label");
});

check("assignment callout on an unlabelled vector keeps the summary stack", () => {
  const document = scene(); point(document, "O", 0, 0); point(document, "A", -3, 4); point(document, "B", 0, 4);
  path(document, "diagonal", "O", "A", "vector");
  path(document, "horizontal", "A", "B", "vector"); path(document, "vertical", "O", "B", "vector");
  document.quantities.push({ id: "speed", symbol: "v", value: 5, unit: "m/s", provenance: "given" });
  document.annotations.push({ id: "value", kind: "callout", targetIds: ["diagonal"], text: "v = 5 m/s" });
  assertSummary(only(compiled(document), "value"), "v = 5 m/s");
});

// Rows 518 and 590 of the frozen set: "r = 60 m" aimed at a banked road.
// Beside the incline it would read as the road's length.
check("assignment value aimed at a labelled segment keeps the summary stack", () => {
  const document = scene(); point(document, "A", 0, 0); point(document, "B", 4, 1);
  path(document, "road", "A", "B", "segment", "banked surface");
  document.quantities.push({ id: "radius", symbol: "r", value: 60, unit: "m", provenance: "given" });
  document.annotations.push({ id: "radiusGiven", kind: "callout", targetIds: ["road"], quantityId: "radius", text: "r = 60 m" });
  assertSummary(only(compiled(document), "radiusGiven"), "r = 60 m");
});

for (const [name, text, value, unit] of [
  ["u", "2 units", 2, "units"],
  ["m", "25 mm", 25, "mm"],
  ["v_1", "v_12 = 2 m", 2, "m"],
] as const) check(`carrier ${name} survives value ${text}`, () => {
  const document = scene(); point(document, "A", 0, 0); point(document, "B", 2, 0);
  path(document, "span", "A", "B", "segment", name);
  document.quantities.push({ id: "value", symbol: "length", value, unit, provenance: "given" });
  document.annotations.push({ id: "measure", kind: "label", targetIds: ["span"], quantityId: "value", text });
  const labels = compiled(document).filter((primitive) => primitive.kind === "label" && primitive.entityId === "span");
  assert.ok(labels.some((label) => (label.text?.match(/[\p{L}\p{N}_]+/gu) ?? []).some((token) => token === name)), "the complete carrier name survives outside unit and identifier substrings");
  assert.ok(labels.some((label) => label.text === text || label.text?.endsWith(` ${text}`)), "the complete authored value remains a literal run");
});

for (const kind of ["line", "ray"]) for (const text of ["n = 2", "2"]) check(`${kind} retains scalar header ${text} without a bounded carrier contract`, () => {
  const document = scene(); point(document, "A", 0, 0); point(document, "B", 2, 1);
  path(document, "interface", "A", "B", kind, "s");
  document.quantities.push({ id: "index", symbol: "n", value: 2, provenance: "given" });
  document.annotations.push({ id: "index_value", kind: "label", targetIds: ["interface"], quantityId: "index", text });
  const primitives = compiled(document), value = only(primitives, "index_value");
  assert.equal(value.provenance?.summary, true, "an unbounded stroke must not acquire an annotation-only scalar owner");
  assert.equal(value.text, text, "the existing scalar summary remains unchanged");
  assert.notEqual(value.provenance?.usesLeader, true, "the scalar must not gain a guessed stroke connector");
});

for (const text of ["3 kg", "m=3kg"] as const) check(`body value ${text} keeps the summary stack`, () => {
  const document = scene(); point(document, "body", 0, 0);
  document.entities[0]!.label = "m";
  document.quantities.push({ id: "mass", symbol: "m", value: 3, unit: "kg", provenance: "given" });
  document.annotations.push({ id: "body_mass", kind: "label", targetIds: ["body"], quantityId: "mass", text });
  assertSummary(only(compiled(document), "body_mass"), text);
});

for (const kind of ["segment", "vector"]) check(`a later ${kind} target cannot consume a body's quantity label`, () => {
  const document = scene(); point(document, "body", 0, 0); point(document, "A", 2, -1); point(document, "B", 4, 1);
  document.entities[0]!.label = "P";
  path(document, "span", "A", "B", kind, "s");
  document.quantities.push({ id: "mass", symbol: "m", value: 2, unit: "kg", provenance: "given" });
  document.annotations.push({ id: "mass_value", kind: "label", targetIds: ["body", "span"], quantityId: "mass", text: "2 kg" });
  const primitives = compiled(document), value = only(primitives, "mass_value");
  assert.equal(value.entityId, "body", "quantity annotation keeps its first-target owner");
  assertSummary(value, "2 kg");
  assert.ok(primitives.some((primitive) => primitive.kind === "label" && primitive.entityId === "span" && primitive.text === "s"), "the separate carrier retains its own name");
});

check("a closed projected section keeps contour label placement", () => {
  const document = scene(); point(document, "center", 0, 0);
  document.entities.push(
    { id: "solid", kind: "polyline", role: "solid", label: "solid" },
    { id: "section", kind: "polyline", role: "section", label: "section" },
  );
  document.constructions.push(
    { id: "make_solid", operator: "solid_projection", inputs: { center: "center", kind: "polyhedron", base: { kind: "rectangle", length: 8, width: 5 }, height: 3 }, outputs: ["solid"] },
    { id: "slice", operator: "solid_cross_section", inputs: { solid: "solid", at: 0.5 }, outputs: ["section"] },
  );
  const primitives = compiled(document), section = only(primitives, "primitive_section");
  assert.equal(section.kind, "polyline", "the original contour remains a polyline");
  assert.deepEqual(section.points[0], section.points.at(-1), "the section retains its exact closed contour");
  assert.equal(only(primitives, "primitive_section_label").text, "section", "the complete contour name remains visible");
});

console.log(`geometric-label-attachment: ${passed} passed, ${failures.length} failed`);
assert.deepEqual(failures, [], "rendered labels must retain their geometric attachment");
