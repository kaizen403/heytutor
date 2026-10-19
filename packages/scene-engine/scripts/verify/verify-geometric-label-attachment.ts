/**
 * Final rendered labels retain their angle wedge and geometric carrier.
 * These small Euclidean fixtures are independently constructed; recorded
 * student questions stay in the private offline replay, outside this gate.
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
function normalize(angle: number): number { return Math.atan2(Math.sin(angle), Math.cos(angle)); }
function assertWedge(primitives: RenderPrimitive[], entityId: string): void {
  const arc = primitives.find((primitive) => primitive.entityId === entityId && primitive.kind === "arc");
  assert.ok(arc?.points[0] && arc.startAngle !== undefined && arc.endAngle !== undefined, `${entityId} retains its arc`);
  const labels = primitives.filter((primitive) => primitive.entityId === entityId && primitive.kind === "label");
  assert.ok(labels.length > 0, `${entityId} retains its label`);
  const sweep = normalize(arc.endAngle - arc.startAngle);
  for (const label of labels) {
    const center = label.points[0]!;
    const delta = normalize(Math.atan2(center.y - arc.points[0].y, center.x - arc.points[0].x) - arc.startAngle);
    assert.ok(sweep >= 0 ? delta >= -1e-6 && delta <= sweep + 1e-6 : delta <= 1e-6 && delta >= sweep - 1e-6,
      `${label.id} centre (${center.x}, ${center.y}) left its rendered arc wedge`);
  }
}

// A 30° ray above an elevated horizontal, with a tangent parabola passing
// nearby: the same geometry relationship as a launch-angle figure. Rotation,
// reflection, translation and scale change only the Euclidean coordinates.
function elevatedAngle(rotation: number, reflected = false, scale = 1): SceneDocument {
  const document = scene();
  const transform = (x: number, y: number): [number, number] => {
    const dx = reflected ? -x : x;
    return [11 + scale * (dx * Math.cos(rotation) - y * Math.sin(rotation)), -7 + scale * (dx * Math.sin(rotation) + y * Math.cos(rotation))];
  };
  for (const [id, x, y] of [
    ["base", 0, 0], ["vertex", 0, 4], ["left", -1.2, 4], ["ground_end", 7.5, 0],
    ["ray_end", Math.sqrt(3), 5], ["reference_end", 2, 4],
  ] as const) point(document, id, ...transform(x, y));
  path(document, "wall", "base", "vertex"); path(document, "roof", "left", "vertex");
  path(document, "ground", "base", "ground_end"); path(document, "reference", "vertex", "reference_end");
  path(document, "ray", "vertex", "ray_end", "vector", "u");
  document.entities.push({ id: "trajectory", kind: "polyline", role: "tangent curve" }, { id: "angle", kind: "angle_mark", role: "angle", label: "α = 30°" });
  document.constructions.push(
    { id: "make_curve", operator: "polyline", inputs: { points: Array.from({ length: 65 }, (_, i) => {
      const x = (4 * Math.sqrt(3) * i) / 64;
      return transform(x, 4 + x / Math.sqrt(3) - x * x / 6);
    }) }, outputs: ["trajectory"] },
    { id: "make_angle", operator: "angle_mark", inputs: { vertex: "vertex", a: "reference", b: "ray", radius: 0.5 * scale }, outputs: ["angle"] },
  );
  document.quantities.push({ id: "alpha", symbol: "α", value: 30, unit: "degree", provenance: "given" });
  document.assertions.push({ id: "given_angle", predicate: "angle_between", entities: ["reference", "ray"], expected: { value: 30, unit: "degree" }, severity: "fatal" });
  return document;
}
for (const [name, rotation, reflected, scale] of [
  ["elevated 30 degree angle", 0, false, 1], ["quarter turn", Math.PI / 2, false, 1],
  ["reflected angle", 0, true, 1], ["angle crossing pi", 17 * Math.PI / 18, false, 1],
  ["translated scaled angle", Math.PI / 3, false, 2],
] as const) check(name, () => assertWedge(compiled(elevatedAngle(rotation, reflected, scale)), "angle"));

check("nested angles retain their own wedge", () => {
  const document = scene();
  point(document, "origin", 0, 0); point(document, "end", 3.84, 0);
  point(document, "lower_tip", 0.56, 0.42); point(document, "higher_tip", 0.6, 0.8);
  path(document, "reference", "origin", "end");
  for (const [name, radius] of [["lower", 0.3], ["higher", 0.5]] as const) {
    path(document, `${name}_ray`, "origin", `${name}_tip`, "vector");
    document.entities.push({ id: name, kind: "angle_mark", role: "angle", label: `α_${name}` });
    document.constructions.push({ id: `make_${name}`, operator: "angle_mark", inputs: { vertex: "origin", a: "reference", b: `${name}_ray`, radius }, outputs: [name] });
  }
  const primitives = compiled(document);
  assertWedge(primitives, "lower"); assertWedge(primitives, "higher");
});

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

check("quantity-bound vector value retains its carrier", () => {
  const document = scene(); point(document, "O", 0, 0); point(document, "U", -3, 4);
  path(document, "velocity", "O", "U", "vector", "v");
  document.quantities.push({ id: "speed", symbol: "v", value: 5, unit: "m/s", provenance: "given" });
  document.annotations.push({ id: "speed_value", kind: "label", targetIds: ["velocity"], quantityId: "speed", text: "5 m/s" });
  const primitives = compiled(document), carrier = only(primitives, "primitive_velocity");
  const label = primitives.find((primitive) => primitive.kind === "label" && primitive.text?.includes("5 m/s"));
  assert.ok(label, "the scalar value remains visible"); assertAttached(primitives, label, carrier);
});

check("two scalar values on one carrier survive owner deduplication", () => {
  const document = scene(); point(document, "body", 0, 0);
  document.entities[0]!.label = "P";
  for (const [id, symbol, value, unit] of [["mass", "m", 2, "kg"], ["charge", "q", 3, "C"]] as const) {
    document.quantities.push({ id, symbol, value, unit, provenance: "given" });
    document.annotations.push({ id: `label_${id}`, kind: "label", targetIds: ["body"], quantityId: id, text: `${value} ${unit}` });
  }
  const primitives = compiled(document), carrier = only(primitives, "primitive_body");
  const labels = ["2 kg", "3 C"].map((text) => {
    const label = primitives.find((primitive) => primitive.kind === "label" && primitive.text?.includes(text));
    assert.ok(label, `${text} remains visible rather than being deduplicated`); return label;
  });
  for (const label of labels) assertAttached(primitives, label, carrier);
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

check("assignment callout remains on its unlabelled vector", () => {
  const document = scene(); point(document, "O", 0, 0); point(document, "A", -3, 4); point(document, "B", 0, 4);
  path(document, "diagonal", "O", "A", "vector");
  path(document, "horizontal", "A", "B", "vector"); path(document, "vertical", "O", "B", "vector");
  document.quantities.push({ id: "speed", symbol: "v", value: 5, unit: "m/s", provenance: "given" });
  document.annotations.push({ id: "value", kind: "callout", targetIds: ["diagonal"], text: "v = 5 m/s" });
  const primitives = compiled(document);
  assertAttached(primitives, only(primitives, "value"), only(primitives, "primitive_diagonal"));
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

for (const [text, summary] of [["3 kg", false], ["m=3kg", true]] as const) check(`body value ${text} retains ${summary ? "self-describing summary" : "point attachment"}`, () => {
  const document = scene(); point(document, "body", 0, 0);
  document.entities[0]!.label = "m";
  document.quantities.push({ id: "mass", symbol: "m", value: 3, unit: "kg", provenance: "given" });
  document.annotations.push({ id: "body_mass", kind: "label", targetIds: ["body"], quantityId: "mass", text });
  const primitives = compiled(document), value = only(primitives, "body_mass");
  assert.equal(value.text, text, "the complete authored value remains visible");
  assert.equal(value.provenance?.summary === true, summary, "only the self-describing assignment belongs in the summary stack");
  if (summary) assert.notEqual(value.provenance?.usesLeader, true, "a summary does not gain a guessed connector");
  else assertAttached(primitives, value, only(primitives, "primitive_body"));
});

for (const kind of ["segment", "vector"]) check(`a later ${kind} target cannot consume a body's quantity label`, () => {
  const document = scene(); point(document, "body", 0, 0); point(document, "A", 2, -1); point(document, "B", 4, 1);
  document.entities[0]!.label = "P";
  path(document, "span", "A", "B", kind, "s");
  document.quantities.push({ id: "mass", symbol: "m", value: 2, unit: "kg", provenance: "given" });
  document.annotations.push({ id: "mass_value", kind: "label", targetIds: ["body", "span"], quantityId: "mass", text: "2 kg" });
  const primitives = compiled(document), value = only(primitives, "mass_value");
  assert.equal(value.entityId, "body", "quantity annotation keeps its first-target owner");
  assert.equal(value.text, "2 kg", "the original complete body value survives");
  assertAttached(primitives, value, only(primitives, "primitive_body"));
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
