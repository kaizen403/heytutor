import assert from "node:assert/strict";
import process from "node:process";
import { compileSceneDocument as sourceCompile } from "../../src/compile/compiler";
import { prepareVerifiedParts as sourcePrepare } from "../../src/compile/verifiedParts";
import { validateDimensionAnchors, validatePointLabelPlacement } from "../../src/compile/figureFeatureTruth";
import type { RenderPrimitive, SceneDocument } from "../../src/types";

const compiledBoundary = process.argv.includes("--compiled-boundary");
const { compileSceneDocument, prepareVerifiedParts } = compiledBoundary
  ? await import("../../dist/index.js")
  : { compileSceneDocument: sourceCompile, prepareVerifiedParts: sourcePrepare };
console.log(`pr246 compiler boundary: ${compiledBoundary ? "rebuilt dist/index.js" : "source"}`);

function scene(): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", source: { question: "Show a circle and its centre of curvature and focal point." },
    visualDecision: { mode: "scene", reason: "review regression" }, quantities: [],
    entities: [
      { id: "centreC", kind: "point", role: "centre of curvature", provenance: { pinLabel: true } },
      { id: "focusF", kind: "point", role: "focal point", provenance: { pinLabel: true } },
      { id: "ring", kind: "circle", role: "circle" },
    ],
    constructions: [
      { id: "make_c", operator: "complex_point", inputs: { real: 0, imaginary: 0, displayScale: 1 }, outputs: ["centreC"] },
      { id: "make_f", operator: "complex_point", inputs: { real: 0.2, imaginary: 0, displayScale: 1 }, outputs: ["focusF"] },
      { id: "make_ring", operator: "circle", inputs: { center: "centreC", radius: 4 }, outputs: ["ring"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["centreC", "focusF", "ring"],
    revealGroups: [{ id: "all", entityIds: ["centreC", "focusF", "ring"], dependsOn: [], narrationCue: "Show the circle." }], teachingTimeline: [],
  };
}

// Actual compiler output-label generation -> owner-only placement diagnostics ->
// omission -> output-label generation again. No pre-seeded omission record.
const generated = scene();
const original = structuredClone(generated);
const failed = compileSceneDocument(generated, { yieldPolicy: "verified_parts" });
assert.equal(failed.ok, false);
assert(failed.report.issues.some(issue => issue.code === "label_overlap_unresolved" && !issue.path && issue.entityIds?.[0] === "centreC"), JSON.stringify(failed.report.issues));
const recovered = prepareVerifiedParts(generated, { enabled: true });
assert.equal(recovered.compiledScene?.ok, true, `generated point names must be omitted through owner-only compiler diagnostics: ${JSON.stringify(recovered.compiledScene?.report.issues)}`);
assert(recovered.issues.some(issue => issue.code === "yield_label_omitted" && issue.expected === "label_overlap_unresolved"));
assert(Array.isArray(recovered.document.source.yieldUnlabelledPoints) && recovered.document.source.yieldUnlabelledPoints.includes("centreC"));
assert.deepEqual(recovered.document.entities, generated.entities, "no geometry entity is removed or relabelled");
assert.deepEqual(recovered.document.constructions, generated.constructions);
assert.deepEqual(recovered.document.requiredEntityIds, generated.requiredEntityIds);
assert.deepEqual(generated, original, "input is immutable");
const recompiled = compileSceneDocument(recovered.document);
assert.equal(recompiled.ok, true);
assert.deepEqual(recompiled, recovered.compiledScene, "reused compilation proves the exact surviving document");
assert.deepEqual(new Set(recompiled.renderScene!.primitives.filter(p => p.kind !== "label").map(p => p.entityId)), new Set(generated.requiredEntityIds));
assert(!recompiled.renderScene!.primitives.some(p => p.kind === "label" && p.entityId === "centreC"));
const obligated = scene();
obligated.assertions = [{ id: "planner_needs_C", predicate: "label_attached", entities: ["centreC"], expected: true, severity: "fatal" }];
const blocked = prepareVerifiedParts(obligated, { enabled: true });
assert.equal(blocked.compiledScene?.ok, false, "an explicit planner label obligation remains fatal");
assert(blocked.compiledScene?.report.issues.some(issue => issue.code === "assertion_failed"));
assert.deepEqual(blocked.document.assertions, obligated.assertions);
const ambiguous = scene();
ambiguous.annotations = [{ id: "extra_name", kind: "label", targetIds: ["centreC"], text: "C" }];
const ambiguousResult = prepareVerifiedParts(ambiguous, { enabled: true });
assert(!(Array.isArray(ambiguousResult.document.source.yieldUnlabelledPoints) && ambiguousResult.document.source.yieldUnlabelledPoints.includes("centreC")), "owner-only diagnostics must not guess between annotation and generated name");
assert.deepEqual(ambiguousResult.document.annotations, ambiguous.annotations);
assert.equal(compileSceneDocument(generated).ok, false, "flag-off keeps original behavior");
console.log("pr246 blocker 1: generated-label owner-only diagnostic recovery, retained geometry, annotation ambiguity and explicit obligations passed");

function arcScene(start: number, end: number): SceneDocument {
  return {
    ...scene(), source: { question: "Show a circular arc." },
    entities: [{ id: "arc", kind: "arc", role: "circular arc" }],
    constructions: [{ id: "make_arc", operator: "arc", inputs: { center: [0, 0], radius: 4, startAngle: start, endAngle: end, angleUnit: "degrees" }, outputs: ["arc"] }],
    requiredEntityIds: ["arc"], revealGroups: [{ id: "all", entityIds: ["arc"], dependsOn: [], narrationCue: "Show the arc." }],
  };
}
const arcFailures: string[] = [];
let dimensionCases = 0;
for (const [start, end, drawn] of [
  [0, 90, [0, 45, 90]], [90, 0, [0, 45, 90]],
  [315, 405, [0, 45, 315]], [405, 315, [0, 45, 315]],
  [-45, 45, [0, 45, 315]], [45, -45, [0, 45, 315]],
  [0, 360, [0, 45, 90, 135, 180, 225, 270, 315]],
  [360, 0, [0, 45, 90, 135, 180, 225, 270, 315]],
] as const) {
  for (const degrees of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const doc = arcScene(start, end);
    const angle = degrees * Math.PI / 180;
    doc.entities.push({ id: "c", kind: "point", role: "point", label: "O" }, { id: "dim", kind: "dimension", role: "distance" });
    doc.constructions.push(
      { id: "make_c", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["c"] },
      { id: "make_dim", operator: "dimension", inputs: { start: "c", end: [4 * Math.cos(angle), 4 * Math.sin(angle)] }, outputs: ["dim"] },
    );
    doc.requiredEntityIds.push("c", "dim"); doc.revealGroups[0]!.entityIds.push("c", "dim");
    const off = compileSceneDocument(doc);
    assert.equal(off.ok, true, JSON.stringify(off.report.issues));
    assert(off.renderScene!.primitives.some(p => p.kind === "arc"));
    assert(off.renderScene!.primitives.some(p => p.kind === "point" && p.entityId === "c"));
    assert(!off.renderScene!.primitives.some(p => p.kind === "point" && p.entityId !== "c"), "only the arc can anchor the outer dimension end");
    const on = compileSceneDocument(doc, { yieldPolicy: "verified_parts" });
    const expected = (drawn as readonly number[]).includes(degrees);
    if (on.ok !== expected) arcFailures.push(`dimension ${start}→${end} at ${degrees}: expected ${expected}, got ${on.ok}: ${JSON.stringify(on.report.issues)}`);
    if (!expected && on.ok === false) assert(on.report.issues.some(issue => issue.code === "dimension_end_unanchored" && issue.failureKind === "truth"));
    assert.equal(validateDimensionAnchors(off.renderScene!.primitives).length, on.report.issues.filter(issue => issue.code === "dimension_end_unanchored").length);
    dimensionCases++;
  }
}
// A real compiler-selected point-name slot beside the undrawn left quadrant.
for (const [start, end] of [[0, 90], [90, 0], [315, 405], [405, 315]]) {
  const doc = arcScene(start!, end!);
  doc.entities.push({ id: "O", kind: "point", role: "point", label: "O" });
  doc.constructions.push({ id: "make_o", operator: "point", inputs: { x: -4.2, y: 0, coordinateSpace: "world" }, outputs: ["O"] });
  doc.requiredEntityIds.push("O"); doc.revealGroups[0]!.entityIds.push("O");
  const on = compileSceneDocument(doc, { yieldPolicy: "verified_parts" });
  if (!on.ok) arcFailures.push(`point name beside undrawn quadrant ${start}→${end}: ${JSON.stringify(on.report.issues)}`);
}
const primitive = (entityId: string, kind: RenderPrimitive["kind"], x: number, y: number, extra: Partial<RenderPrimitive> = {}): RenderPrimitive =>
  ({ id: `p_${entityId}_${kind}`, entityId, groupId: "all", kind, points: [{ x, y }], ...extra });
// Targeted placement controls cover both distance comparisons: label-to-arc
// and the exemption only when the owner's dot lies on the drawn sweep.
const pointDoc = arcScene(0, 90);
pointDoc.entities.push({ id: "O", kind: "point", role: "point", label: "O" });
for (const [start, end, nearTop] of [[-90, 0, true], [0, -90, true], [270, 360, true], [360, 270, true], [0, 90, false], [90, 0, false]] as const) {
  const arc = primitive("arc", "arc", 600, 400, { radius: 50, startAngle: start * Math.PI / 180, endAngle: end * Math.PI / 180 });
  const dot = primitive("O", "point", 600, 400);
  const label = primitive("O", "label", 600, 345, { text: "O" });
  const issues = validatePointLabelPlacement(pointDoc, [arc, dot, label]);
  if (issues.length !== Number(nearTop)) arcFailures.push(`point name top ${start}→${end}: expected ambiguity ${nearTop}, got ${issues.length}`);
  const absentDot = primitive("O", "point", 550, 400);
  if (nearTop && validatePointLabelPlacement(pointDoc, [arc, absentDot, label]).length !== 1) arcFailures.push(`dot on undrawn left circumference must not exempt drawn top ${start}→${end}`);
  const endpoint = primitive("O", "point", 650, 400);
  assert.equal(validatePointLabelPlacement(pointDoc, [arc, endpoint, primitive("O", "label", 655, 400, { text: "O" })]).length, 0, "a dot at the actual arc endpoint shares its stroke's neighbourhood");
}
assert.deepEqual(arcFailures, [], "partial arcs must use only their drawn sweeps for dimension anchors and point names");
console.log(`pr246 blocker 2: ${dimensionCases} real compiler dimension sweeps, compiler point names and drawn/undrawn/end-point placement controls passed`);

function fieldScene(points: Array<[number, number]>): SceneDocument {
  return {
    ...scene(), source: { question: "Show a magnetic field line." },
    entities: [{ id: "fl", kind: "polyline", role: "magnetic field line" }],
    constructions: [{ id: "make_fl", operator: "polyline", inputs: { points }, outputs: ["fl"] }],
    requiredEntityIds: ["fl"], revealGroups: [{ id: "all", entityIds: ["fl"], dependsOn: [], narrationCue: "Show the field line." }],
  };
}
const hexagon: Array<[number, number]> = [[0, 0], [40, -20], [80, 0], [80, 40], [40, 60], [0, 40], [0, 0]];
const fieldFailures: string[] = [];
let fieldCases = 0;
for (const subdivisions of [1, 2, 3, 5, 8]) {
  const subdivided: Array<[number, number]> = hexagon.slice(0, -1).flatMap(([x, y], i) => {
    const [endX, endY] = hexagon[i + 1]!;
    return Array.from({ length: subdivisions }, (_, j): [number, number] => [x + (endX - x) * j / subdivisions, y + (endY - y) * j / subdivisions]);
  });
  subdivided.push(hexagon.at(-1)!);
  for (const duplicateCorners of [false, true]) {
    const points = duplicateCorners ? subdivided.flatMap(p => [p, p]) : subdivided;
    const doc = fieldScene(points);
    const off = compileSceneDocument(doc);
    assert.equal(off.ok, true, JSON.stringify(off.report.issues));
    const stroke = off.renderScene!.primitives.find(p => p.entityId === "fl")!;
    assert.equal(stroke.points.length, points.length, "the compiler reaches field truth with the actual subdivided samples");
    const on = compileSceneDocument(doc, { yieldPolicy: "verified_parts" });
    if (on.ok || !on.report.issues.some(issue => issue.code === "field_line_polygon" && issue.failureKind === "truth")) fieldFailures.push(`same hexagon, ${subdivisions} subdivisions, duplicates=${duplicateCorners}, ${points.length} samples: ${JSON.stringify(on.report.issues)}`);
    fieldCases++;
  }
}
for (const samples of [12, 40, 80]) {
  const smooth: Array<[number, number]> = Array.from({ length: samples }, (_, i) => [100 * Math.cos(i / (samples - 1) * Math.PI), 60 * Math.sin(i / (samples - 1) * Math.PI)]);
  for (const duplicateSamples of [false, true]) {
    const points = duplicateSamples ? smooth.flatMap(p => [p, p]) : smooth;
    const on = compileSceneDocument(fieldScene(points), { yieldPolicy: "verified_parts" });
    assert.equal(on.ok, true, `a genuinely smooth sampled curve stays drawable (${samples}, duplicates=${duplicateSamples}): ${JSON.stringify(on.report.issues)}`);
    fieldCases++;
  }
}
const collinear: Array<[number, number]> = Array.from({ length: 20 }, (_, i) => [i, i]);
for (const points of [collinear, collinear.flatMap(p => [p, p])]) {
  const on = compileSceneDocument(fieldScene(points), { yieldPolicy: "verified_parts" });
  assert.equal(on.ok, true, `collinear samples are not corners: ${JSON.stringify(on.report.issues)}`);
  fieldCases++;
}
assert.deepEqual(fieldFailures, [], "subdividing straight sides cannot certify a sharp polygon as a smooth field line");
console.log(`pr246 blocker 3: ${fieldCases} real compiler field-line cases; sparse/dense/subdivided hexagons refused, smooth/duplicate/collinear samples retained`);

// Axes render as exactly [x0,x1] and [y0,y1], not a polyline or bounds box.
type XY = [number, number];
const axisCases: Array<{ name: string; start: XY; end: XY; expected: boolean; bounds?: [number, number, number, number]; point?: boolean }> = [
  { name: "horizontal y-axis interior", start: [0, 2], end: [3, 2], expected: true },
  { name: "vertical x-axis interior", start: [2, 0], end: [2, 3], expected: true },
  { name: "horizontal negative y-axis", start: [0, -2], end: [-3, -2], expected: true },
  { name: "vertical negative x-axis", start: [-2, 0], end: [-2, -3], expected: true },
  { name: "y-axis finite endpoint", start: [0, 4], end: [3, 4], expected: true },
  { name: "x-axis finite endpoint", start: [4, 0], end: [4, 3], expected: true },
  { name: "beyond y-axis extent", start: [0, 6], end: [3, 6], expected: false },
  { name: "beyond x-axis extent", start: [6, 0], end: [6, 3], expected: false },
  { name: "imaginary bounding edge", start: [2, 4], end: [3, 4], expected: false },
  { name: "imaginary inter-axis connector", start: [2, -2], end: [3, -2], expected: false },
  { name: "parallel x-axis interior", start: [2, 0], end: [3, 0], expected: false },
  { name: "parallel y-axis interior", start: [0, 2], end: [0, 3], expected: false },
  { name: "collinear x-axis endpoint", start: [4, 0], end: [6, 0], expected: false },
  { name: "collinear y-axis endpoint", start: [0, 4], end: [0, 6], expected: false },
  { name: "degenerate y-axis", start: [0, 2], end: [3, 2], bounds: [-4, 4, 2, 2], expected: false },
  { name: "degenerate x-axis", start: [2, 0], end: [2, 3], bounds: [2, 2, -4, 4], expected: false },
  { name: "origin independent perpendicular y-axis", start: [0, 0], end: [3, 0], expected: true },
  { name: "origin independent perpendicular x-axis", start: [0, 0], end: [0, 3], expected: true },
  { name: "explicit point still anchors", start: [2, 2], end: [3, 2], point: true, expected: true },
];
const axisFailures: string[] = [];
for (const test of axisCases) {
  const [xMin, xMax, yMin, yMax] = test.bounds ?? [-4, 4, -4, 4];
  const horizontal = test.start[1] === test.end[1];
  const doc: SceneDocument = {
    ...scene(), source: { question: "Show coordinate axes and a distance to a drawn line." },
    entities: [{ id: "axes", kind: "axes", role: "coordinate axes" }, { id: "edge", kind: "line", role: "drawn edge" }, { id: "dim", kind: "dimension", role: "distance" }],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin, xMax, yMin, yMax }, outputs: ["axes"] },
      { id: "make_edge", operator: "line", inputs: { start: horizontal ? [test.end[0], test.end[1] - 1] : [test.end[0] - 1, test.end[1]], end: horizontal ? [test.end[0], test.end[1] + 1] : [test.end[0] + 1, test.end[1]] }, outputs: ["edge"] },
      { id: "make_dim", operator: "dimension", inputs: { start: test.start, end: test.end }, outputs: ["dim"] },
    ],
    requiredEntityIds: ["axes", "edge", "dim"], revealGroups: [{ id: "all", entityIds: ["axes", "edge", "dim"], dependsOn: [], narrationCue: "Show the distance." }],
  };
  if (test.point) {
    doc.entities.push({ id: "anchor", kind: "point", role: "point" });
    doc.constructions.push({ id: "make_anchor", operator: "point", inputs: { x: test.start[0], y: test.start[1], coordinateSpace: "world" }, outputs: ["anchor"] });
    doc.requiredEntityIds.push("anchor"); doc.revealGroups[0]!.entityIds.push("anchor");
  }
  const off = compileSceneDocument(doc);
  assert.equal(off.ok, true, `${test.name} native control: ${JSON.stringify(off.report.issues)}`);
  const axes = off.renderScene!.primitives.find(p => p.kind === "axes")!;
  assert.equal(axes.points.length, 4);
  assert.equal(off.renderScene!.primitives.filter(p => p.kind === "point").length, Number(!!test.point), "no hidden endpoint dots may mask the axis check");
  const on = compileSceneDocument(doc, { yieldPolicy: "verified_parts" });
  if (on.ok !== test.expected) axisFailures.push(`${test.name}: expected ${test.expected}, got ${on.ok}: ${JSON.stringify(on.report.issues)}`);
  if (!test.expected) assert(on.report.issues.some(issue => issue.code === "dimension_end_unanchored" && issue.failureKind === "truth"), test.name);
  if (test.expected && !test.point) {
    // An axis mentioned in prose is not visible ink: removing its drawing
    // must remove the anchor, even though the mathematical axis still exists.
    const withoutAxes: SceneDocument = {
      ...doc, entities: doc.entities.filter(e => e.id !== "axes"),
      constructions: doc.constructions.filter(c => c.id !== "make_axes"),
      requiredEntityIds: doc.requiredEntityIds.filter(id => id !== "axes"),
      revealGroups: doc.revealGroups.map(g => ({ ...g, entityIds: g.entityIds.filter(id => id !== "axes") })),
    };
    const absent = compileSceneDocument(withoutAxes, { yieldPolicy: "verified_parts" });
    assert.equal(absent.ok, false, `${test.name}: undrawn axis cannot anchor`);
    assert(absent.report.issues.some(issue => issue.code === "dimension_end_unanchored" && issue.failureKind === "truth"), test.name);
  }
}
assert.deepEqual(axisFailures, [], "actual finite perpendicular axis strokes must anchor dimensions independently");
console.log(`pr246 blocker 4: ${axisCases.length} actual compiler axes/dimension cases and native controls passed`);
