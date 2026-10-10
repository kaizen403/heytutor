/**
 * World angle marks, directed space vectors and the derived cross product.
 * Every positive case states its true value independently of the engine and
 * every claim has a negation that must fail, so a mark is a proof, not ink.
 *
 * `--render <dir>` also writes each positive case as SVG for visual review.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { evaluateSpaceDerivationConstruction, SPACE_DERIVATION_OPERATORS, spaceMarkedAngle, type SpaceDerivationEvaluationContext } from "../../src/compile/spaceDerivations";
import { isometricProject, type Vec3 } from "../../src/math/space";
import { compileSceneDocument, isSupportedSceneOperator, validateSceneDocument, type CompileResult, type SceneAssertion, type SceneConstruction, type SceneDocument, type SceneEntity } from "../../src/index";
import { renderSceneSvg } from "../lib/renderSceneSvg";

let checks = 0;
function check(condition: unknown, message: string): asserts condition { checks += 1; if (!condition) throw new Error(message); }
function close(actual: number, expected: number, message: string, tolerance = 1e-9): void { check(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`); }
const DEG = Math.PI / 180;
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const scale = (a: Vec3, k: number): Vec3 => v3(a.x * k, a.y * k, a.z * k);
const list = (a: Vec3): [number, number, number] => [a.x, a.y, a.z];
const renderDir = process.argv.includes("--render") ? resolve(process.argv[process.argv.indexOf("--render") + 1] ?? "/tmp/heytutor-space-angle-vector") : null;
for (const operator of ["space_vector", "space_cross", "space_angle_mark", "space_right_angle_mark"]) {
  check((SPACE_DERIVATION_OPERATORS as readonly string[]).includes(operator), `${operator} must be a space derivation operator`);
  check(isSupportedSceneOperator(operator), `${operator} must be an executable, planner-visible capability`);
}

// ---------- Operator level: arms, orientation and fail-closed inputs ----------
const frame = { origin: { x: 0, y: 0 }, scale: 2 };
const geometries = new Map<string, unknown>([["frame", { kind: "compound", spaceFrame: frame }], ["other", { kind: "compound", spaceFrame: frame }]]);
const context: SpaceDerivationEvaluationContext = {
  number(value) { const number = Number(value); if (!Number.isFinite(number)) throw new Error("nonfinite"); return number; },
  point() { return { x: 0, y: 0 }; },
  geometry(value) { return typeof value === "string" ? geometries.get(value) : undefined; },
};
function point(id: string, space: Vec3, frameId = "frame"): void { geometries.set(id, { kind: "point", point: isometricProject(space, frame), space, spaceFrameId: frameId }); }
function line(id: string, through: Vec3, direction: Vec3, tMin = -2, tMax = 2): void {
  geometries.set(id, { kind: "path", infinite: true, points: [isometricProject(v3(through.x + direction.x * tMin, through.y + direction.y * tMin, through.z + direction.z * tMin), frame), isometricProject(v3(through.x + direction.x * tMax, through.y + direction.y * tMax, through.z + direction.z * tMax), frame)], spaceLine: { frameId: "frame", point: through, direction } });
}
function plane(id: string, through: Vec3, normal: Vec3): void { geometries.set(id, { kind: "path", closed: true, points: [], spacePlane: { frameId: "frame", point: through, normal } }); }
function evaluate(operator: string, inputs: Record<string, unknown>): ReturnType<typeof evaluateSpaceDerivationConstruction> { return evaluateSpaceDerivationConstruction(operator, { frame: "frame", ...inputs }, context); }
function rejects(operator: string, inputs: Record<string, unknown>, message: string, pattern?: RegExp): void {
  let error = "";
  try { evaluate(operator, inputs); } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  check(error !== "" && (!pattern || pattern.test(error)), `${message}${error ? ` (threw: ${error})` : " (did not throw)"}`);
}
function markedAngle(result: ReturnType<typeof evaluate>): number {
  const [mark] = result;
  check(mark?.kind === "path" && mark.spaceAngle, "a world angle mark must keep its world arms");
  close(spaceMarkedAngle(mark)!, mark.spaceAngle.radians, "the proof reads the angle back from the arms");
  return mark.spaceAngle.radians;
}

// Line-plane inclination from integer literals: sin(theta) = |d.n| / (|d||n|).
for (const [theta, normal, direction] of [[30, v3(1, 0, 1), v3(1, 1, 0)], [45, v3(0, 0, 1), v3(1, 0, 1)], [60, v3(2, 1, 1), v3(1, 1, 0)]] as const) {
  close(Math.asin(Math.abs(dot(direction, normal)) / (norm(direction) * norm(normal))) / DEG, theta, `independent oracle for the ${theta} degree construction`);
  plane("incline", v3(0, 0, 0), normal);
  point("O", v3(0, 0, 0)); point("P", scale(direction, 2));
  line("L", scale(direction, 2), direction, -2.6, 0.4);
  for (const [a, b] of [["L", "incline"], ["incline", "L"], ["P", "incline"]]) close(markedAngle(evaluate("space_angle_mark", { vertex: "O", a, b })) / DEG, theta, `line-plane arc ${a}/${b} must draw ${theta} degrees`, 1e-9);
  const [mark] = evaluate("space_angle_mark", { vertex: "O", a: "L", b: "incline" });
  check(mark?.kind === "path" && mark.spaceAngle, "line-plane arc must be a world mark");
  close(dot(mark.spaceAngle.v, normal), 0, "the plane arm is the line's own projection into the plane");
  close(dot(mark.spaceAngle.u, scale(direction, 1 / norm(direction))), 1, "the line arm keeps the line direction toward its longer drawn side");
  check(mark.points.length >= 9, "the arc must be sampled, not a chord");
  const radius = 0.25 * 2.4 * norm(direction);
  close(Math.hypot(mark.points[0]!.x - isometricProject(scale(mark.spaceAngle.u, radius), frame).x, mark.points[0]!.y - isometricProject(scale(mark.spaceAngle.u, radius), frame).y), 0, "the arc starts on the projected line arm", 1e-9);
  rejects("space_right_angle_mark", { vertex: "O", a: "L", b: "incline" }, `a ${theta} degree line-plane angle must not take a right-angle mark`, /not 90/);
}
// Dihedral: planes z=0 and x+z=0 meet along the y axis at 45 degrees.
plane("floor", v3(0, 0, 0), v3(0, 0, 1)); plane("tilted", v3(0, 0, 0), v3(1, 0, 1)); plane("wall", v3(0, 0, 0), v3(3, 0, 0));
point("V", v3(0, 1, 0));
close(markedAngle(evaluate("space_angle_mark", { vertex: "V", a: "floor", b: "tilted" })) / DEG, 45, "dihedral arc between z=0 and x+z=0");
const [dihedral] = evaluate("space_angle_mark", { vertex: "V", a: "floor", b: "tilted" });
check(dihedral?.kind === "path" && dihedral.spaceAngle, "dihedral must keep world arms");
close(dihedral.spaceAngle.u.y, 0, "dihedral arms are normal to the common line"); close(dihedral.spaceAngle.v.y, 0, "dihedral arms are normal to the common line");
close(markedAngle(evaluate("space_right_angle_mark", { vertex: "V", a: "floor", b: "wall" })) / DEG, 90, "perpendicular planes take a right-angle mark");
// Lines through one point: unsensed lines mark the acute angle, rays keep their sense.
point("C", v3(1, 1, 1)); point("A", v3(2, 2, 1)); point("B", v3(1, 0, 0)); point("B60", v3(1, 2, 2));
line("l1", v3(1, 1, 1), v3(1, 1, 0)); line("l2", v3(1, 1, 1), v3(0, -1, -1));
close(markedAngle(evaluate("space_angle_mark", { vertex: "C", a: "l1", b: "l2" })) / DEG, 60, "two intersecting lines mark their acute angle");
close(markedAngle(evaluate("space_angle_mark", { vertex: "C", a: "A", b: "B" })) / DEG, 120, "two rays keep their sense: (1,1,0) and (0,-1,-1) meet at 120 degrees");
close(markedAngle(evaluate("space_angle_mark", { vertex: "C", a: "A", b: "B60" })) / DEG, 60, "two rays at 60 degrees");
close(markedAngle(evaluate("space_angle_mark", { vertex: "C", a: "A", b: "l2" })) / DEG, 60, "a ray and an unsensed line mark the acute angle");
// Right-angle mark at a foot: P=(2,2,0) onto x+z=0 lands at N=(1,2,-1).
plane("slope", v3(0, 0, 0), v3(1, 0, 1)); point("P30", v3(2, 2, 0)); point("N", v3(1, 2, -1)); point("O", v3(0, 0, 0));
close(markedAngle(evaluate("space_right_angle_mark", { vertex: "N", a: "P30", b: "O" })) / DEG, 90, "the foot of a perpendicular is a right angle");
line("axis", v3(0, 0, 0), v3(1, 0, 0), -1, 3); point("Q", v3(2, 1, 2)); point("F", v3(2, 0, 0));
close(markedAngle(evaluate("space_right_angle_mark", { vertex: "F", a: "Q", b: "axis" })) / DEG, 90, "the foot on a line is a right angle against the line arm");

// Vectors and the derived cross product a x b.
point("o", v3(0, 0, 0)); point("pa", v3(2, 0, 0)); point("pb", v3(1, 1.5, 0)); point("far", v3(-1, 0, 0)); point("pc", v3(4, 0, 0));
for (const [id, end] of [["a", "pa"], ["b", "pb"], ["anti", "far"], ["twice", "pc"]]) {
  const [vector] = evaluate("space_vector", { start: "o", end });
  check(vector?.kind === "path" && vector.directed === true && vector.spaceSegment, "space_vector must be a directed world segment");
  geometries.set(id, vector);
}
const [product] = evaluate("space_cross", { a: "a", b: "b" });
check(product?.kind === "path" && product.directed && product.spaceCross && product.spaceSegment, "a x b must be a directed world vector");
check(JSON.stringify(list(product.spaceCross.product)) === JSON.stringify([0, 0, 3]), `(2,0,0) x (1,1.5,0) must be (0,0,3), got ${JSON.stringify(product.spaceCross.product)}`);
check(JSON.stringify(list(product.spaceSegment.b)) === JSON.stringify([0, 0, 3]), "a x b is drawn from the shared start");
close(dot(product.spaceCross.product, v3(2, 0, 0)), 0, "a x b is perpendicular to a"); close(dot(product.spaceCross.product, v3(1, 1.5, 0)), 0, "a x b is perpendicular to b");
const [reverse] = evaluate("space_cross", { a: "b", b: "a" });
check(reverse?.kind === "path" && reverse.spaceCross && reverse.spaceCross.product.z === -3, "right-hand rule: b x a is (0,0,-3)");
const [scaled] = evaluate("space_cross", { a: "a", b: "b", origin: "pa", scale: 0.5 });
check(scaled?.kind === "path" && scaled.spaceSegment && JSON.stringify(list(scaled.spaceSegment.a)) === "[2,0,0]" && JSON.stringify(list(scaled.spaceSegment.b)) === "[2,0,1.5]", "scale and origin place 0.5 a x b at the stated point");
for (const parallel of ["anti", "twice"]) {
  const [zero] = evaluate("space_cross", { a: "a", b: parallel });
  check(zero?.kind === "point" && zero.spaceCross?.zero === true && norm(zero.spaceCross.product) === 0, `parallel inputs (${parallel}) give a certified zero marker, not an arrow`);
}
geometries.set("ab", product);
close(markedAngle(evaluate("space_right_angle_mark", { vertex: "o", a: "ab", b: "a" })) / DEG, 90, "a x b meets a at a right angle");
close(markedAngle(evaluate("space_angle_mark", { vertex: "o", a: "a", b: "b" })) / DEG, Math.acos(2 / (2 * Math.hypot(1, 1.5))) / DEG, "vector arms mark the true angle between a and b");
// A sensed vector arm keeps its own sense against a point arm: away from the vertex at its start or its end.
const abDegrees = Math.acos(1 / Math.hypot(1, 1.5)) / DEG;
close(markedAngle(evaluate("space_angle_mark", { vertex: "o", a: "a", b: "pb" })) / DEG, abDegrees, "a vector starting at the vertex points along itself");
close(markedAngle(evaluate("space_angle_mark", { vertex: "o", a: "anti", b: "pb" })) / DEG, 180 - abDegrees, "the reversed vector meets b at the supplement");
close(markedAngle(evaluate("space_angle_mark", { vertex: "pa", a: "a", b: "pb" })) / DEG, abDegrees, "a vector ending at the vertex points back along itself");

// Fail-closed operator inputs.
point("foreign", v3(1, 0, 0), "other"); point("onAxis", v3(1, 0, 0)); point("edgeA", v3(1, 0, 0)); point("edgeB", v3(0, 1, -1));
point("Pz", v3(0, 0, 2)); line("normalLine", v3(0, 0, 2), v3(0, 0, 1)); line("inFloor", v3(0, 0, 0), v3(1, 1, 0));
plane("floor2", v3(0, 0, 0), v3(0, 0, -2)); point("near90", v3(Math.cos(89.9 * DEG), Math.sin(89.9 * DEG), 0));
for (const [operator, inputs, message, pattern] of [
  ["space_angle_mark", { vertex: "C", a: "l1", b: "l1" }, "identical arms are parallel", /parallel/],
  ["space_angle_mark", { vertex: "o", a: "pa", b: "pc" }, "collinear rays are parallel", /parallel/],
  ["space_angle_mark", { vertex: "o", a: "pa", b: "far" }, "opposite rays are antiparallel", /parallel/],
  ["space_angle_mark", { vertex: "O", a: "inFloor", b: "floor" }, "a line lying in the plane has a zero angle", /parallel/],
  ["space_angle_mark", { vertex: "V", a: "floor", b: "floor2" }, "coincident planes have no dihedral angle", /parallel/],
  ["space_angle_mark", { vertex: "Pz", a: "normalLine", b: "floor" }, "a vertex off the plane arm", /plane arm/],
  ["space_angle_mark", { vertex: "Pz", a: "l1", b: "Q" }, "a vertex off the line arm", /line arm/],
  ["space_angle_mark", { vertex: "pc", a: "a", b: "Q" }, "a vertex beyond the segment's end", /segment arm/],
  ["space_angle_mark", { vertex: "B", a: "floor", b: "tilted" }, "a dihedral vertex off the common line", /plane arm/],
  ["space_angle_mark", { vertex: "O", a: "O", b: "pa" }, "a zero-length arm", /differ from the vertex/],
  ["space_angle_mark", { vertex: "O", a: "normalLine", b: "floor" }, "a line perpendicular to the plane has no projection", /perpendicular to the plane/],
  ["space_right_angle_mark", { vertex: "o", a: "near90", b: "pa" }, "89.9 degrees is not a right angle", /not 90/],
  ["space_angle_mark", { vertex: "o", a: "edgeA", b: "edgeB" }, "an angle whose plane is edge-on cannot be drawn", /edge-on/],
  ["space_right_angle_mark", { vertex: "o", a: "edgeA", b: "edgeB" }, "a right angle whose plane is edge-on cannot be drawn", /edge-on/],
  ["space_angle_mark", { vertex: "o", a: "foreign", b: "pa" }, "an arm from another frame", /same space_frame/],
  ["space_angle_mark", { frame: "other", vertex: "o", a: "pa", b: "pb" }, "a vertex from another frame", /same space_frame/],
  ["space_angle_mark", { vertex: "o", a: "pa", b: "pb", radius: 0 }, "a zero radius", /radius/],
  ["space_angle_mark", { vertex: "o", a: "pa", b: "pb", count: 2 }, "undeclared inputs", /unsupported/],
  ["space_right_angle_mark", { vertex: "o", a: "pa", b: "pb", radius: 1 }, "a right-angle mark takes size, not radius", /unsupported/],
  ["space_vector", { start: "o", end: "o" }, "a zero vector", /distinct/],
  ["space_vector", { start: "o", end: "foreign" }, "a vector across frames", /same space_frame/],
  ["space_cross", { a: "a", b: "l1" }, "a cross product needs vectors or segments", /space_segment or space_vector/],
  ["space_cross", { a: "a", b: "b", scale: -1 }, "a negative scale", /scale/],
  ["space_cross", { a: "a", b: "b", origin: "foreign" }, "an origin from another frame", /same space_frame/],
] as const) rejects(operator, inputs, `${message} must fail closed`, pattern);
const [shifted] = evaluate("space_vector", { start: "pa", end: "Q" });
geometries.set("shifted", shifted);
rejects("space_cross", { a: "a", b: "shifted" }, "vectors with different starts need an explicit origin", /origin/);
check(spaceMarkedAngle({ kind: "path", points: [], spaceAngle: { frameId: "frame", vertex: v3(0, 0, 0), u: v3(1, 0, 0), v: v3(0, 1, 0), radians: 1 } }) === Infinity, "tampered angle metadata cannot prove a value");
check(spaceMarkedAngle({ kind: "path", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], markedAngleRadians: 1 }) === null, "a 2D mark stays with its own authority");

// ---------- Document level: validate, compile, prove, and negate ----------
const entity = (id: string, kind: string, label?: string): SceneEntity => ({ id, kind, role: `${kind} in the world figure`, ...(label ? { label } : {}) });
const make = (operator: string, inputs: Record<string, unknown>, outputs: string[]): SceneConstruction => ({ id: `make_${outputs.join("_")}`, operator, inputs, outputs });
const sp = (id: string, p: Vec3, label?: string): [SceneEntity, SceneConstruction] => [entity(id, "point", label), make("space_point", { frame: "frame", x: p.x, y: p.y, z: p.z }, [id])];
const claim = (id: string, predicate: string, entities: string[], expected: unknown = true): SceneAssertion => ({ id, predicate, entities, expected, severity: "fatal" });
const degrees = (value: number) => ({ value, unit: "degree" });
interface Case { title: string; parts: Array<[SceneEntity, SceneConstruction]>; assertions: SceneAssertion[] }
function document(item: Case): SceneDocument {
  const parts: Array<[SceneEntity, SceneConstruction]> = [
    [{ id: "origin", kind: "point", role: "construction helper point" }, make("point", { x: 0, y: 0 }, ["origin"])],
    [entity("frame", "polyline"), make("space_frame", { origin: "origin", scale: 1, axisLength: 2.5 }, ["frame"])],
    // Cases are mutated into negatives, so every document owns its constructions.
    ...structuredClone(item.parts),
  ];
  const required = parts.map(([part]) => part.id).filter((id) => id !== "origin");
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "normalized qualitative representative" },
    source: { question: item.title, representationTier: "qualitative_verified", nonMetric: true }, quantities: [],
    entities: parts.map(([part]) => part), constructions: parts.map(([, construction]) => construction), relations: [],
    assertions: item.assertions, annotations: [], requiredEntityIds: required,
    revealGroups: [{ id: "scene", entityIds: required, dependsOn: [], narrationCue: item.title }], teachingTimeline: [],
  } as SceneDocument;
}
function run(item: Case | SceneDocument): { validated: SceneDocument | null; compiled: CompileResult | null; issues: string } {
  const candidate = "parts" in item ? document(item) : item;
  const validated = validateSceneDocument(candidate);
  if (!validated.document) return { validated: null, compiled: null, issues: JSON.stringify(validated.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => `${issue.code}: ${issue.message}`)) };
  const compiled = compileSceneDocument(validated.document);
  return { validated: validated.document, compiled, issues: JSON.stringify(compiled.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => `${issue.code}: ${issue.message}`)) };
}
function passes(item: Case, message: string): CompileResult {
  const result = run(item);
  check(result.validated, `${message}: structural validation failed ${result.issues}`);
  for (const assertion of item.assertions) {
    check(result.validated.assertions.some((kept) => kept.id === assertion.id), `${message}: validation dropped assertion ${assertion.id}; a single-mark angle_between needs .context/h3/ops/validation.patch`);
  }
  check(result.compiled?.ok && result.compiled.renderScene, `${message}: compile failed ${result.issues}`);
  for (const primitive of result.compiled.renderScene.primitives) for (const p of primitive.points) check(Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 400 && p.x <= 1160 && p.y >= 55 && p.y <= 610, `${message}: ${primitive.id} leaves the diagram viewport`);
  check(JSON.stringify(result.compiled.renderScene) === JSON.stringify(compileSceneDocument(result.validated).renderScene), `${message}: compile must be deterministic`);
  return result.compiled;
}
function fails(item: Case | SceneDocument, message: string, code?: RegExp): void {
  const result = run(item);
  check(!result.compiled?.ok && !result.compiled?.renderScene, `${message} must not render`);
  if (code) check(code.test(result.issues), `${message}: expected ${code} in ${result.issues}`);
}
const rendered: Array<{ title: string; compiled: CompileResult }> = [];
function negate(item: Case, id: string, expected: unknown): Case { return { ...item, assertions: item.assertions.map((assertion) => assertion.id === id ? { ...assertion, expected } : assertion) }; }

function linePlane(theta: number, normal: Vec3, direction: Vec3): Case {
  const p = scale(direction, 2);
  return {
    title: `Angle between a line and a plane (${theta} degrees)`,
    parts: [
      [entity("plane", "polygon", "Π"), make("plane", { frame: "frame", a: normal.x, b: normal.y, c: normal.z, d: 0 }, ["plane"])],
      sp("P", p, "P"),
      [entity("L", "line", "L"), make("space_line", { frame: "frame", point: "P", direction: list(direction), tMin: -2.6, tMax: 0.4 }, ["L"])],
      [entity("O", "point", "O"), make("space_intersection", { frame: "frame", first: "L", second: "plane" }, ["O"])],
      [entity("N", "point", "N"), make("space_project", { frame: "frame", point: "P", onto: "plane" }, ["N"])],
      [entity("proj", "segment"), make("space_segment", { frame: "frame", a: "O", b: "N" }, ["proj"])],
      [entity("PN", "segment"), make("space_segment", { frame: "frame", a: "P", b: "N" }, ["PN"])],
      [entity("theta", "angle_mark", "θ"), make("space_angle_mark", { frame: "frame", vertex: "O", a: "L", b: "plane" }, ["theta"])],
      [entity("theta_proj", "angle_mark"), make("space_angle_mark", { frame: "frame", vertex: "O", a: "L", b: "proj" }, ["theta_proj"])],
      [entity("foot", "right_angle_mark"), make("space_right_angle_mark", { frame: "frame", vertex: "N", a: "PN", b: "proj" }, ["foot"])],
    ],
    assertions: [
      claim("line-plane", "angle_between", ["L", "plane"], degrees(theta)),
      claim("mark-angle", "angle_between", ["theta"], degrees(theta)),
      claim("projection-arm", "equal_angle", ["theta", "theta_proj"]),
      claim("foot-right", "angle_between", ["foot"], degrees(90)),
      claim("perpendicular", "perpendicular", ["PN", "plane"]),
      claim("foot-on-plane", "incident", ["N", "plane"]),
    ],
  };
}
for (const [theta, normal, direction] of [[30, v3(1, 0, 1), v3(1, 1, 0)], [45, v3(0, 0, 1), v3(1, 0, 1)], [60, v3(2, 1, 1), v3(1, 1, 0)]] as const) {
  const item = linePlane(theta, normal, direction);
  const compiled = passes(item, `${theta} degree line-plane angle`);
  rendered.push({ title: item.title, compiled });
  const arc = compiled.renderScene!.primitives.filter((primitive) => primitive.id === "primitive_theta");
  check(arc.length === 1 && arc[0]!.kind === "polyline" && arc[0]!.points.length >= 9, "the line-plane angle renders one sampled arc");
  check(compiled.renderScene!.primitives.some((primitive) => primitive.entityId === "theta" && primitive.text === "θ") || compiled.renderScene!.primitives.some((primitive) => primitive.kind === "label" && primitive.text === "θ"), "θ is owned by the arc");
  const wrong = theta === 45 ? 50 : 45;
  fails(negate(item, "mark-angle", degrees(wrong)), `a ${theta} degree arc claimed as ${wrong}`, /assertion_failed/);
  fails(negate(item, "line-plane", degrees(wrong)), `a ${theta} degree line-plane angle claimed as ${wrong} over its arms`, /assertion_failed/);
  fails(negate(item, "mark-angle", degrees(180 - theta)), `the supplement of ${theta} degrees`, /assertion_failed/);
  if (theta !== 45) fails(negate(item, "mark-angle", degrees(90 - theta)), `the complement of ${theta} degrees`, /assertion_failed/);
  fails(negate(item, "foot-right", degrees(theta)), "a right-angle mark claimed as another angle", /assertion_failed/);
  fails(negate(item, "projection-arm", false), "the plane arm and the explicit projection arm draw the same angle", /assertion_failed/);
  const nonRight = document(item);
  nonRight.constructions.find((construction) => construction.operator === "space_right_angle_mark")!.inputs = { frame: "frame", vertex: "O", a: "L", b: "plane" };
  fails(nonRight, `a right-angle mark on the ${theta} degree inclination`, /not 90/);
}
const twoPlanes: Case = {
  title: "Dihedral angle between two planes (45 degrees)",
  parts: [
    [entity("p1", "polygon", "Π₁"), make("plane", { frame: "frame", a: 0, b: 0, c: 1, d: 0 }, ["p1"])],
    [entity("p2", "polygon", "Π₂"), make("plane", { frame: "frame", a: 1, b: 0, c: 1, d: 0 }, ["p2"])],
    [entity("edge", "line"), make("space_intersection", { frame: "frame", first: "p1", second: "p2", tMin: -1.5, tMax: 1.5 }, ["edge"])],
    sp("V", v3(0, 1, 0), "V"),
    [entity("phi", "angle_mark", "φ"), make("space_angle_mark", { frame: "frame", vertex: "V", a: "p1", b: "p2", radius: 0.8 }, ["phi"])],
  ],
  assertions: [claim("dihedral", "angle_between", ["p1", "p2"], degrees(45)), claim("dihedral-mark", "angle_between", ["phi"], degrees(45)), claim("vertex-on-edge", "incident", ["V", "edge"])],
};
rendered.push({ title: twoPlanes.title, compiled: passes(twoPlanes, "dihedral angle") });
fails(negate(twoPlanes, "dihedral-mark", degrees(135)), "the obtuse dihedral claimed for an acute mark", /assertion_failed/);
const offEdge = document(twoPlanes);
offEdge.constructions.find((construction) => construction.id === "make_V")!.inputs = { frame: "frame", x: 1, y: 1, z: 0 };
fails(offEdge, "a dihedral vertex off the common line", /plane arm/);
const crossingLines: Case = {
  title: "Angle between two intersecting lines (60 degrees)",
  parts: [
    sp("C", v3(1, 1, 1), "C"), sp("A", v3(2, 2, 1), "A"), sp("B", v3(1, 0, 0), "B"),
    [entity("l1", "line", "l₁"), make("space_line", { frame: "frame", point: "C", direction: [1, 1, 0], tMin: -1, tMax: 1.5 }, ["l1"])],
    [entity("l2", "line", "l₂"), make("space_line", { frame: "frame", point: "C", direction: [0, -1, -1], tMin: -1, tMax: 1.5 }, ["l2"])],
    [entity("alpha", "angle_mark", "α"), make("space_angle_mark", { frame: "frame", vertex: "C", a: "l1", b: "l2" }, ["alpha"])],
    [entity("beta", "angle_mark"), make("space_angle_mark", { frame: "frame", vertex: "C", a: "A", b: "B", radius: 0.6 }, ["beta"])],
  ],
  assertions: [claim("lines", "angle_between", ["l1", "l2"], degrees(60)), claim("lines-mark", "angle_between", ["alpha"], degrees(60)), claim("rays-mark", "angle_between", ["beta"], degrees(120)), claim("A-on-l1", "incident", ["A", "l1"]), claim("B-on-l2", "incident", ["B", "l2"])],
};
rendered.push({ title: crossingLines.title, compiled: passes(crossingLines, "two intersecting lines") });
fails(negate(crossingLines, "rays-mark", degrees(60)), "two sensed rays at 120 degrees claimed as 60", /assertion_failed/);
const parallelArms = document(crossingLines);
parallelArms.constructions.find((construction) => construction.id === "make_alpha")!.inputs = { frame: "frame", vertex: "C", a: "l1", b: "A" };
fails(parallelArms, "a mark between a line and a point on it", /parallel/);
const crossProduct: Case = {
  title: "Cross product a×b of (2,0,0) and (1,1.5,0)",
  parts: [
    sp("O", v3(0, 0, 0), "O"), sp("A", v3(2, 0, 0)), sp("B", v3(1, 1.5, 0)), sp("K", v3(2, 0, 3)), sp("U", v3(1, 2, 2)), sp("W", v3(2, -1, 0)),
    [entity("a", "vector", "a"), make("space_vector", { frame: "frame", start: "O", end: "A" }, ["a"])],
    [entity("b", "vector", "b"), make("space_vector", { frame: "frame", start: "O", end: "B" }, ["b"])],
    [entity("axb", "vector", "a×b"), make("space_cross", { frame: "frame", a: "a", b: "b" }, ["axb"])],
    [entity("bxa", "vector", "b×a"), make("space_cross", { frame: "frame", a: "b", b: "a" }, ["bxa"])],
    [entity("ref", "segment"), make("space_segment", { frame: "frame", a: "A", b: "K" }, ["ref"])],
    [entity("u", "vector", "u"), make("space_vector", { frame: "frame", start: "O", end: "U" }, ["u"])],
    [entity("w", "vector", "w"), make("space_vector", { frame: "frame", start: "O", end: "W" }, ["w"])],
    [entity("ab_angle", "angle_mark", "θ"), make("space_angle_mark", { frame: "frame", vertex: "O", a: "a", b: "b" }, ["ab_angle"])],
    [entity("ra_a", "right_angle_mark"), make("space_right_angle_mark", { frame: "frame", vertex: "O", a: "axb", b: "a" }, ["ra_a"])],
  ],
  assertions: [
    claim("perp-a", "perpendicular", ["axb", "a"]), claim("perp-b", "perpendicular", ["axb", "b"]),
    claim("magnitude", "equal_length", ["axb", "ref"]), claim("direction", "parallel", ["axb", "ref"]),
    claim("right-hand", "opposite_direction", ["axb", "bxa"]),
    claim("vector-angle", "angle_between", ["a", "b"], degrees(Math.atan2(1.5, 1) / DEG)),
  ],
};
const crossCompiled = passes(crossProduct, "cross product");
rendered.push({ title: crossProduct.title, compiled: crossCompiled });
check(crossCompiled.renderScene!.primitives.filter((primitive) => ["a", "b", "axb", "bxa", "u", "w"].includes(primitive.entityId) && primitive.kind === "vector").length === 6, "space vectors render as arrows");
fails(negate(crossProduct, "right-hand", false), "a x b and b x a are opposite", /assertion_failed/);
fails(negate(crossProduct, "perp-a", false), "a x b is perpendicular to a", /assertion_failed/);
fails(negate(crossProduct, "magnitude", false), "|a x b| = 3", /assertion_failed/);
const vectorProofs: Case = { ...crossProduct, title: "Space vector proofs", assertions: [
  claim("perp-uw", "perpendicular", ["u", "w"]), claim("len-u", "equal_length", ["u", "axb"]), claim("par-ref", "parallel", ["axb", "ref"]),
  claim("angle-ua", "angle_between", ["u", "a"], degrees(Math.acos(1 / 3) / DEG)), claim("same-sense", "opposite_direction", ["axb", "ref"], false),
] };
passes(vectorProofs, "space vector proofs");
for (const [id, expected] of [["perp-uw", false], ["len-u", false], ["par-ref", false], ["angle-ua", degrees(60)], ["same-sense", true]] as const) fails(negate(vectorProofs, id, expected), `negated vector proof ${id}`, /assertion_failed/);
const wrongCross = document(crossProduct);
wrongCross.constructions.find((construction) => construction.id === "make_axb")!.inputs = { frame: "frame", a: "b", b: "a" };
fails(wrongCross, "b x a in place of a x b breaks the right-hand claim", /assertion_failed/);
const parallelCross = document({ ...crossProduct, assertions: [] });
parallelCross.constructions.find((construction) => construction.id === "make_B")!.inputs = { frame: "frame", x: -1, y: 0, z: 0 };
parallelCross.constructions = parallelCross.constructions.filter((construction) => !["make_ab_angle", "make_ra_a"].includes(construction.id));
parallelCross.entities = parallelCross.entities.filter((item) => !["ab_angle", "ra_a"].includes(item.id));
parallelCross.requiredEntityIds = parallelCross.requiredEntityIds.filter((id) => !["ab_angle", "ra_a"].includes(id));
parallelCross.revealGroups[0]!.entityIds = parallelCross.requiredEntityIds;
const zeroResult = run(parallelCross);
check(zeroResult.compiled?.ok && zeroResult.compiled.renderScene, `parallel inputs must still compile with a zero marker: ${zeroResult.issues}`);
const zeroInk = zeroResult.compiled.renderScene.primitives;
// The zero marker is a dot at the shared start; coincident dots in one reveal group render once, labelled by both owners.
check(!zeroInk.some((primitive) => primitive.entityId === "axb" && primitive.kind === "vector"), "a zero cross product never draws an arrow");
check(zeroInk.some((primitive) => primitive.kind === "point" && (primitive.entityId === "axb" || primitive.entityId === "O")) && zeroInk.some((primitive) => primitive.entityId === "axb" && primitive.text === "a×b"), "a zero cross product is a labelled point marker at the shared start");
fails({ ...parallelCross, assertions: [claim("zero-perp", "perpendicular", ["axb", "a"])] }, "a zero marker certifies no direction", /invalid_world_assertion|assertion_failed/);
const segmentKind = structuredClone(parallelCross);
segmentKind.entities.find((item) => item.id === "axb")!.kind = "segment";
fails(segmentKind, "a cross product declared as a segment", /output_kind/);
const foreignFrame = document(crossProduct);
foreignFrame.entities.push(entity("frame2", "polyline")); foreignFrame.requiredEntityIds.push("frame2"); foreignFrame.revealGroups[0]!.entityIds.push("frame2");
foreignFrame.constructions.push(make("space_frame", { origin: "origin", scale: 1, axisLength: 2 }, ["frame2"]));
foreignFrame.constructions.find((construction) => construction.id === "make_B")!.inputs = { frame: "frame2", x: 1, y: 1.5, z: 0 };
fails(foreignFrame, "a vector whose end belongs to another frame", /same space_frame/);
const mixedCross = document(crossProduct);
mixedCross.constructions.find((construction) => construction.id === "make_axb")!.inputs = { frame: "frame2", a: "a", b: "b" };
mixedCross.entities.push(entity("frame2", "polyline")); mixedCross.requiredEntityIds.push("frame2"); mixedCross.revealGroups[0]!.entityIds.push("frame2");
mixedCross.constructions.push(make("space_frame", { origin: "origin", scale: 1, axisLength: 2 }, ["frame2"]));
fails(mixedCross, "a cross product in another frame than its inputs", /same space_frame/);
const planarMark = document(crossProduct);
planarMark.constructions.find((construction) => construction.id === "make_ab_angle")!.operator = "angle_mark";
planarMark.constructions.find((construction) => construction.id === "make_ab_angle")!.inputs = { vertex: "O", a: "A", b: "B" };
fails(planarMark, "the 2D angle_mark over space points", /world metadata/);
const arcKind = document(crossProduct);
arcKind.entities.find((item) => item.id === "ab_angle")!.kind = "arc";
fails(arcKind, "a space angle mark declared as an arc", /output_kind/);
const footOnLine: Case = {
  title: "Right angle at the foot of a perpendicular to a line",
  parts: [
    sp("Q", v3(2, 1, 2), "Q"),
    [entity("m", "line", "m"), make("space_line", { frame: "frame", point: [0, 0, 0], direction: [1, 0, 0], tMin: -1, tMax: 3 }, ["m"])],
    [entity("F", "point", "F"), make("space_project", { frame: "frame", point: "Q", onto: "m" }, ["F"])],
    [entity("QF", "segment"), make("space_segment", { frame: "frame", a: "Q", b: "F" }, ["QF"])],
    [entity("foot", "right_angle_mark"), make("space_right_angle_mark", { frame: "frame", vertex: "F", a: "Q", b: "m", size: 0.35 }, ["foot"])],
  ],
  assertions: [claim("foot-right", "angle_between", ["foot"], degrees(90)), claim("perpendicular", "perpendicular", ["QF", "m"]), claim("foot-on-line", "incident", ["F", "m"])],
};
rendered.push({ title: footOnLine.title, compiled: passes(footOnLine, "foot of a perpendicular to a line") });
const tiltedFoot = document(footOnLine);
tiltedFoot.constructions.find((construction) => construction.id === "make_foot")!.inputs = { frame: "frame", vertex: "F", a: "Q", b: "origin_mark", size: 0.35 };
tiltedFoot.entities.push(entity("origin_mark", "point")); tiltedFoot.constructions.push(make("space_point", { frame: "frame", x: 1, y: 0, z: 1 }, ["origin_mark"]));
tiltedFoot.requiredEntityIds.push("origin_mark"); tiltedFoot.revealGroups[0]!.entityIds.push("origin_mark");
fails(tiltedFoot, "a right-angle mark against an arm that is not perpendicular", /not 90/);

if (renderDir) {
  mkdirSync(renderDir, { recursive: true });
  const cards: string[] = [];
  for (const [index, { title, compiled }] of rendered.entries()) {
    const name = `${index + 1}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    writeFileSync(join(renderDir, `${name}.svg`), renderSceneSvg(compiled.renderScene!, { title, guides: true }));
    cards.push(`<article><h2>${title}</h2><img src="${name}.svg" alt="${title}"></article>`);
  }
  writeFileSync(join(renderDir, "index.html"), `<!doctype html><meta charset="utf-8"><title>Space angle and vector operators</title><style>body{font:16px system-ui;background:#eceff2;margin:24px}article{background:white;margin:0 0 24px;padding:12px}img{width:100%;max-width:1200px}</style><h1>Space angle and vector operators</h1>${cards.join("")}`);
  console.log(`rendered ${rendered.length} verified world figures to ${renderDir}`);
}
console.log(`space angle and vector operator verification passed (${checks} checks)`);
