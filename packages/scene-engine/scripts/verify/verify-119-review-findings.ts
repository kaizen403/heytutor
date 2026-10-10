/**
 * PR #119 review findings, each as a claim with a negation that must fail:
 * 1. two directed space vectors keep their sense in angle proofs (135°, not 45°);
 * 2. a nearly parallel but nonzero cross product is drawn, never zeroed;
 * 3. a genuinely small curve value keeps its value, only rounding at an
 *    irrational stated x (kπ/n) is certified zero;
 * 4. an accepted space right-angle mark proves its own angle;
 * 5. a translated figure keeps its verdict (tolerances follow local lengths).
 */
import assert from "node:assert/strict";
import { compileSceneDocument, validateSceneDocument, type SceneDocument } from "../../src/index";

type Construction = SceneDocument["constructions"][number];
type Entity = SceneDocument["entities"][number];
function scene(question: string, entities: Entity[], constructions: Construction[], assertions: SceneDocument["assertions"] = [], annotations: SceneDocument["annotations"] = []): SceneDocument {
  const ids = entities.map((entity) => entity.id);
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "review finding" },
    source: { question }, quantities: [], entities, constructions, relations: [], assertions, annotations,
    requiredEntityIds: ids, revealGroups: [{ id: "scene", entityIds: ids, dependsOn: [], narrationCue: "figure" }],
    teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "scene", dependsOn: [], narrationIntent: "figure" }],
  };
}
function compile(document: SceneDocument) {
  const validated = validateSceneDocument(document);
  if (!validated.document) return { ok: false, issues: validated.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code), render: null };
  const compiled = compileSceneDocument(validated.document);
  return { ok: compiled.ok, issues: compiled.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code), render: compiled.renderScene ?? null };
}
const origin: Construction = { id: "make_o", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["o"] };
const frame: Construction = { id: "make_frame", operator: "space_frame", inputs: { origin: "o" }, outputs: ["frame"] };
const sp = (id: string, x: number, y: number, z: number): Construction => ({ id: `make_${id}`, operator: "space_point", inputs: { frame: "frame", x, y, z }, outputs: [id] });
const base: Entity[] = [{ id: "o", kind: "point" }, { id: "frame", kind: "polyline" }, { id: "O", kind: "point" }];
const angle = (entities: string[], degrees: number) => [{ id: "angle", predicate: "angle_between", entities, expected: { value: degrees, unit: "degree" }, severity: "fatal" as const }];

// 1. Directed vectors keep their sense; undirected lines keep the acute rule.
{
  const vectors = (degrees: number) => scene("Find the angle between a = (1, 0, 0) and b = (-1, 1, 0).",
    [...base, { id: "A", kind: "point" }, { id: "B", kind: "point" }, { id: "a", kind: "vector" }, { id: "b", kind: "vector" }],
    [origin, frame, sp("O", 0, 0, 0), sp("A", 1, 0, 0), sp("B", -1, 1, 0),
      { id: "make_a", operator: "space_vector", inputs: { frame: "frame", start: "O", end: "A" }, outputs: ["a"] },
      { id: "make_b", operator: "space_vector", inputs: { frame: "frame", start: "O", end: "B" }, outputs: ["b"] }],
    angle(["a", "b"], degrees));
  assert.deepEqual(compile(vectors(135)).issues, [], "vectors (1,0,0) and (-1,1,0) meet at 135 degrees");
  assert(!compile(vectors(45)).ok, "the acute 45 degrees is false for directed vectors");
  const lines = (degrees: number) => scene("Find the angle between the lines.",
    [...base, { id: "l1", kind: "line" }, { id: "l2", kind: "line" }],
    [origin, frame, sp("O", 0, 0, 0),
      { id: "make_l1", operator: "space_line", inputs: { frame: "frame", point: "O", direction: [1, 0, 0] }, outputs: ["l1"] },
      { id: "make_l2", operator: "space_line", inputs: { frame: "frame", point: "O", direction: [-1, 1, 0] }, outputs: ["l2"] }],
    angle(["l1", "l2"], degrees));
  assert.deepEqual(compile(lines(45)).issues, [], "two undirected lines keep the acute angle");
  assert(!compile(lines(135)).ok, "lines never prove an obtuse angle");
}

// 2. Nearly parallel but nonzero products are drawn; exact zero stays a zero marker.
{
  const product = (a: [number, number, number], b: [number, number, number], scale: number) => scene("Find a × b.",
    [...base, { id: "A", kind: "point" }, { id: "B", kind: "point" }, { id: "a", kind: "vector" }, { id: "b", kind: "vector" }, { id: "c", kind: "vector" }],
    [origin, frame, sp("O", 0, 0, 0), sp("A", ...a), sp("B", ...b),
      { id: "make_a", operator: "space_vector", inputs: { frame: "frame", start: "O", end: "A" }, outputs: ["a"] },
      { id: "make_b", operator: "space_vector", inputs: { frame: "frame", start: "O", end: "B" }, outputs: ["b"] },
      { id: "make_c", operator: "space_cross", inputs: { frame: "frame", a: "a", b: "b", scale }, outputs: ["c"] }]);
  const near = compile(product([1e8, 0, 0], [1e8, 0.5, 0], 1e-7));
  assert(near.ok, `a nonzero product of nearly parallel vectors is drawn: ${near.issues}`);
  assert(near.render!.primitives.some((primitive) => primitive.entityId === "c" && primitive.kind !== "point" && primitive.kind !== "label"), "the product is an arrow, not a zero marker");
  const zero = compile(product([1, 2, 3], [2, 4, 6], 1));
  assert(zero.ok, `exactly parallel vectors give a certified zero marker: ${zero.issues}`);
  assert(!zero.render!.primitives.some((primitive) => primitive.entityId === "c" && primitive.kind === "line"), "the exact zero product is not an arrow");
}

// 3. Small values keep their value; rounding at kπ/n is the only certified zero.
{
  const anchor = (expression: string, at: number, text: string) => scene("Mark the point on the curve.",
    [{ id: "curve", kind: "polyline" }, { id: "p", kind: "point" }],
    [{ id: "make_curve", operator: "function_curve", inputs: { expression, xMin: -1, xMax: 4 }, outputs: ["curve"] },
      { id: "make_p", operator: "curve_anchor", inputs: { curve: "curve", at }, outputs: ["p"] }],
    [], [{ id: "label_p", kind: "label", targetIds: ["p"], text }]);
  assert(compile(anchor("1e-16", 0, "(0, 1e-16)")).ok, "the true small value labels correctly");
  assert(!compile(anchor("1e-16", 0, "(0, 0)")).ok, "a genuinely nonzero value is never relabelled zero");
  assert(compile(anchor("sin(x)", Math.PI, "(π, 0)")).ok, "sin π is the exact zero its rounding hides");
  assert(!compile(anchor("sin(x)", 3, "(3, 0)")).ok, "sin 3 is not zero");
}

// 4. An accepted right-angle mark proves its own angle.
{
  const mark = (bx: number) => scene("Mark the right angle between the lines.",
    [...base, { id: "A", kind: "point" }, { id: "B", kind: "point" }, { id: "r", kind: "right_angle_mark" }],
    [origin, frame, sp("O", 0, 0, 0), sp("A", 1, 0, 0), sp("B", bx, 1, 0),
      { id: "make_r", operator: "space_right_angle_mark", inputs: { frame: "frame", vertex: "O", a: "A", b: "B" }, outputs: ["r"] }],
    angle(["r"], 90));
  assert.deepEqual(compile(mark(1e-7)).issues, [], "a mark accepted within its tolerance proves 90 degrees");
  assert.deepEqual(compile(mark(0)).issues, [], "an exact right angle proves 90 degrees");
  assert(!compile(mark(0.2)).ok, "an 79 degree pair is still refused as a right angle");
}

// 5. A figure keeps its verdict wherever it sits: tolerances follow the
// figure's own lengths and float rounding, never the distance from the origin.
{
  const far = 1e6;
  const fbase = base.filter((entity) => entity.id !== "O");
  const rightMark = (x: number) => scene("Mark the right angle.",
    [...fbase, { id: "V", kind: "point" }, { id: "A", kind: "point" }, { id: "B", kind: "point" }, { id: "r", kind: "right_angle_mark" }],
    [origin, frame, sp("V", x, 0, 0), sp("A", x + 1, 0, 0), sp("B", x, 1, 0),
      { id: "make_r", operator: "space_right_angle_mark", inputs: { frame: "frame", vertex: "V", a: "A", b: "B" }, outputs: ["r"] }],
    angle(["r"], 90));
  assert.deepEqual(compile(rightMark(0)).issues, [], "unit arms at the origin make a right angle");
  assert.deepEqual(compile(rightMark(far)).issues, [], "the same unit arms translated to x = 1e6 still make a right angle");
  const sameAsVertex = scene("Mark the angle.",
    [...fbase, { id: "V", kind: "point" }, { id: "A", kind: "point" }, { id: "B", kind: "point" }, { id: "m", kind: "angle_mark" }],
    [origin, frame, sp("V", far, 0, 0), sp("A", far, 0, 0), sp("B", far, 1, 0),
      { id: "make_m", operator: "space_angle_mark", inputs: { frame: "frame", vertex: "V", a: "A", b: "B" }, outputs: ["m"] }]);
  assert(!compile(sameAsVertex).ok, "a point arm on the vertex is still refused far from the origin");
  // The plane x = at, drawn about its own foot (at, 0, 0); the vertex sits `off` from it.
  const offPlane = (at: number, off: number) => scene("Mark the angle between the line and the plane.",
    [...fbase, { id: "plane", kind: "polygon" }, { id: "V", kind: "point" }, { id: "Q", kind: "point" }, { id: "m", kind: "angle_mark" }],
    [origin, frame, { id: "make_plane", operator: "plane", inputs: { frame: "frame", a: 1, b: 0, c: 0, d: at }, outputs: ["plane"] },
      sp("V", at + off, 0, 0), sp("Q", at + off + 1, 1, 0),
      { id: "make_m", operator: "space_angle_mark", inputs: { frame: "frame", vertex: "V", a: "plane", b: "Q" }, outputs: ["m"] }]);
  // A plane drawn 1000 or more from the frame collapses on screen, so this
  // case sits at 100, where the old rule let a vertex sit 1e-4 off the plane.
  assert.deepEqual(compile(offPlane(0, 0)).issues, [], "a vertex on the plane marks the line-plane angle");
  assert.deepEqual(compile(offPlane(100, 0)).issues, [], "a vertex on the plane x = 100 marks the same angle");
  assert(!compile(offPlane(0, 5e-5)).ok, "a vertex 5e-5 off the plane is refused");
  assert(!compile(offPlane(100, 5e-5)).ok, "a vertex 5e-5 off the plane x = 100 is refused too");
  const crossFrom = (offset: number) => scene("Find a × b.",
    [...fbase, { id: "P", kind: "point" }, { id: "Q", kind: "point" }, { id: "A", kind: "point" }, { id: "B", kind: "point" }, { id: "a", kind: "vector" }, { id: "b", kind: "vector" }, { id: "c", kind: "vector" }],
    [origin, frame, sp("P", far, 0, 0), sp("Q", far, offset, 0), sp("A", far + 1, 0, 0), sp("B", far, offset, 1),
      { id: "make_a", operator: "space_vector", inputs: { frame: "frame", start: "P", end: "A" }, outputs: ["a"] },
      { id: "make_b", operator: "space_vector", inputs: { frame: "frame", start: "Q", end: "B" }, outputs: ["b"] },
      { id: "make_c", operator: "space_cross", inputs: { frame: "frame", a: "a", b: "b" }, outputs: ["c"] }]);
  assert(compile(crossFrom(0)).ok, "two vectors from one far point give a cross product");
  assert(!compile(crossFrom(0.5)).ok, "vectors starting half a unit apart far from the origin need an origin");
}

console.log("PR #119 review findings: directed vector angles, nonzero near-parallel products, small-value labels, right-angle mark proofs and translation-invariant tolerances verified");
