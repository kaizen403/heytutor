import { evaluateSpaceDerivationConstruction, validateSpaceDerivationConstruction, SPACE_DERIVATION_OPERATORS, spaceIncidenceResidual, spaceDirectionResidual, spaceMetricLength, spacePointDistance, spaceAcuteAngle, spaceCollinearityResidual, type SpaceDerivationEvaluationContext } from "../../src/compile/spaceDerivations";
import { isometricProject, type Vec3 } from "../../src/math/space";
import type { SceneDocument, SceneIssue } from "../../src/types";

const geometries = new Map<string, unknown>([
  ["frame", { kind: "compound", spaceFrame: { origin: { x: 0, y: 0 }, scale: 2 } }],
  ["P", { kind: "point", point: { x: 0, y: 0 }, space: { x: 3, y: 4, z: 5 }, spaceFrameId: "frame" }],
  ["line", { kind: "path", spaceLine: { frameId: "frame", point: { x: 1, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } } }],
]);
const context: SpaceDerivationEvaluationContext = {
  number(value) { const number = Number(value); if (!Number.isFinite(number)) throw new Error("nonfinite"); return number; },
  point() { return { x: 0, y: 0 }; },
  geometry(value) { return typeof value === "string" ? geometries.get(value) : undefined; },
};
const [foot] = evaluateSpaceDerivationConstruction("space_project", { frame: "frame", point: "P", onto: "line" }, context);
if (foot?.kind !== "point" || foot.space.x !== 3 || foot.space.y !== 0 || foot.space.z !== 0) throw new Error("point projection must use world line geometry");
let checks = 1;
function check(condition: unknown, message: string): asserts condition { checks += 1; if (!condition) throw new Error(message); }
function close(actual: number, expected: number, message: string): void { check(Math.abs(actual - expected) < 1e-7 * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`); }
function world(actual: unknown, expected: Vec3, message: string): void {
  check(typeof actual === "object" && actual !== null && "x" in actual && "y" in actual && "z" in actual, `${message}: missing world point`);
  close(Number(actual.x), expected.x, message); close(Number(actual.y), expected.y, message); close(Number(actual.z), expected.z, message);
}
function line(id: string, point: Vec3, direction: Vec3): void { geometries.set(id, { kind: "path", spaceLine: { frameId: "frame", point, direction } }); }
function plane(id: string, point: Vec3, normal: Vec3): void { geometries.set(id, { kind: "path", spacePlane: { frameId: "frame", point, normal } }); }
line("vertical", { x: 2, y: 3, z: -1 }, { x: 0, y: 0, z: 7 });
plane("z-plane", { x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 3 });
plane("x-plane", { x: 2, y: 0, z: 0 }, { x: -4, y: 0, z: 0 });
for (const [first, second] of [["vertical", "z-plane"], ["z-plane", "vertical"]]) {
  const [intersection] = evaluateSpaceDerivationConstruction("space_intersection", { frame: "frame", first, second }, context);
  check(intersection?.kind === "point", "line-plane intersection must produce a point");
  world(intersection.space, { x: 2, y: 3, z: 5 }, "line-plane intersection");
}
const [intersectionLine] = evaluateSpaceDerivationConstruction("space_intersection", { frame: "frame", first: "x-plane", second: "z-plane", tMin: -3, tMax: 5 }, context);
check(intersectionLine?.kind === "path" && intersectionLine.infinite && intersectionLine.spaceLine, "plane-plane intersection must preserve infinite line identity");
world(intersectionLine.spaceLine.point, { x: 2, y: 0, z: 5 }, "two-plane analytic intersection anchor");
close(Math.hypot(intersectionLine.spaceLine.direction.x, intersectionLine.spaceLine.direction.y, intersectionLine.spaceLine.direction.z), 1, "intersection parameter uses unit world direction");
line("skew-a", { x: 1, y: 2, z: 3 }, { x: 2, y: 0, z: 0 });
line("skew-b", { x: 4, y: 5, z: 8 }, { x: 0, y: -3, z: 0 });
const closest = evaluateSpaceDerivationConstruction("space_closest_points", { frame: "frame", first: "skew-a", second: "skew-b" }, context);
check(closest.length === 2 && closest[0]?.kind === "point" && closest[1]?.kind === "point", "closest points must be ordered point outputs");
world(closest[0].space, { x: 4, y: 2, z: 3 }, "first closest point");
world(closest[1].space, { x: 4, y: 2, z: 8 }, "second closest point");
geometries.set("closest-a", closest[0]); geometries.set("closest-b", closest[1]);
const [segment] = evaluateSpaceDerivationConstruction("space_segment", { frame: "frame", a: "closest-a", b: "closest-b" }, context);
check(segment?.kind === "path" && segment.spaceSegment, "segment must preserve world metric identity");
close(segment.spaceSegment.length, 5, "skew-line shortest distance");
check(Math.abs(Math.hypot(segment.points[1]!.x - segment.points[0]!.x, segment.points[1]!.y - segment.points[0]!.y) - 5) > 1, "test must distinguish projected length from world distance");
close(spaceMetricLength(segment)!, 5, "proof length must remain world length");
close(spacePointDistance(closest[0], closest[1])!, 5, "proof point distance must remain world distance");
close(spaceIncidenceResidual(closest[0], geometries.get("skew-a"))!, 0, "closest point must lie on first infinite line");
close(spaceIncidenceResidual(closest[1], geometries.get("skew-b"))!, 0, "closest point must lie on second infinite line");
close(spaceDirectionResidual(segment, geometries.get("skew-a"), "perpendicular")!, 0, "shortest connector must be world-perpendicular to first line");
close(spaceDirectionResidual(segment, geometries.get("skew-b"), "perpendicular")!, 0, "shortest connector must be world-perpendicular to second line");
line("y-axis", { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
close(spaceDirectionResidual(geometries.get("line"), geometries.get("y-axis"), "perpendicular")!, 0, "3D perpendicular axes must pass even when their isometric strokes do not meet at 90 degrees");
close(spaceAcuteAngle(geometries.get("line"), geometries.get("y-axis"))!, Math.PI / 2, "3D line angle");
close(spaceDirectionResidual(geometries.get("vertical"), geometries.get("z-plane"), "perpendicular")!, 0, "line perpendicular to plane must use plane normal");
close(spaceAcuteAngle(geometries.get("vertical"), geometries.get("z-plane"))!, Math.PI / 2, "3D line-plane angle");
const hiddenOffPlane = { kind: "point", point: { x: Math.sqrt(3) * 2, y: 2 }, space: { x: 3, y: -1, z: 1 }, spaceFrameId: "frame" };
close(spaceIncidenceResidual(hiddenOffPlane, geometries.get("x-plane"))!, 1, "off-plane point with identical isometric projection must fail world incidence");
const halfway = { kind: "point", point: { x: 0, y: 0 }, space: { x: 4, y: 2, z: 5.5 }, spaceFrameId: "frame" };
close(spaceCollinearityResidual([closest[0], halfway, closest[1]])!, 0, "world point collinearity");
close(spaceIncidenceResidual(halfway, segment)!, 0, "finite world segment interior incidence");
close(spaceIncidenceResidual({ ...halfway, space: { x: 4, y: 2, z: 13 } }, segment)!, 5, "collinear point beyond finite segment must fail incidence");
const foreign = { ...halfway, spaceFrameId: "other" };
check(spacePointDistance(halfway, foreign) === Infinity, "mixed frames must reject proof rather than fall back to canvas");
check(spaceIncidenceResidual({ kind: "point", point: { x: 0, y: 0 } }, geometries.get("x-plane")) === Infinity, "mixed 2D/3D incidence must reject");
check(spaceDirectionResidual({ kind: "path", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, geometries.get("line"), "parallel") === Infinity, "mixed 2D/3D direction must reject");
check(spacePointDistance({ kind: "point", point: { x: 0, y: 0 } }, { kind: "point", point: { x: 1, y: 0 } }) === null, "2D-only proof must stay with the 2D authority");
function scene(): SceneDocument {
  const constructions = [
    { id: "origin", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["O"] },
    { id: "frame", operator: "space_frame", inputs: { origin: "O", scale: 2 }, outputs: ["F"] },
    { id: "point", operator: "space_point", inputs: { frame: "F", x: { value: "three" }, y: "4", z: 5 }, outputs: ["P"] },
    { id: "a", operator: "space_line", inputs: { frame: "F", point: [1, 2, 3], direction: [2, 0, 0] }, outputs: ["A"] },
    { id: "b", operator: "space_line", inputs: { frame: "F", point: [4, 5, 8], direction: [0, -3, 0] }, outputs: ["B"] },
    { id: "plane", operator: "plane", inputs: { frame: "F", a: 0, b: 0, c: "three", d: 15 }, outputs: ["Z"] },
    { id: "plane2", operator: "plane", inputs: { frame: "F", point: [2, 0, 0], u: [0, 1, 0], v: [0, 0, 1] }, outputs: ["X"] },
    { id: "make-foot", operator: "space_project", inputs: { frame: "F", point: "P", onto: "A" }, outputs: ["foot"] },
    { id: "make-plane-foot", operator: "space_project", inputs: { frame: "F", point: "P", onto: "Z" }, outputs: ["plane-foot"] },
    { id: "closest", operator: "space_closest_points", inputs: { frame: "F", first: "A", second: "B" }, outputs: ["C", "D"] },
    { id: "segment", operator: "space_segment", inputs: { frame: "F", a: "C", b: "D" }, outputs: ["CD"] },
    { id: "intersection", operator: "space_intersection", inputs: { frame: "F", first: "X", second: "Z", tMin: -3, tMax: 5 }, outputs: ["L"] },
    { id: "make-intersection-foot", operator: "space_project", inputs: { frame: "F", point: "P", onto: "L" }, outputs: ["intersection-foot"] },
  ];
  const ids = constructions.flatMap((c) => c.outputs);
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "world-vector derived geometry" }, source: {}, quantities: [{ id: "three", value: 3 }],
    entities: ids.map((id) => ({ id, kind: id === "F" ? "polyline" : ["A", "B", "L"].includes(id) ? "line" : ["X", "Z"].includes(id) ? "polygon" : id === "CD" ? "segment" : "point", role: "world geometry" })),
    constructions, relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "show exact 3D derivation" }], teachingTimeline: [],
  };
}
function structural(candidate: SceneDocument): SceneIssue[] {
  const byOutput = new Map(candidate.constructions.flatMap((c) => c.outputs.map((id) => [id, c] as const)));
  const issues: SceneIssue[] = [];
  for (const [index, construction] of candidate.constructions.entries()) if (SPACE_DERIVATION_OPERATORS.includes(construction.operator as typeof SPACE_DERIVATION_OPERATORS[number])) validateSpaceDerivationConstruction(construction, index, candidate, byOutput, issues);
  return issues;
}
check(structural(scene()).length === 0, "source-grounded numeric refs and derived point/line references must validate");
const invalidScene = scene();
invalidScene.constructions.find((c) => c.operator === "space_segment")!.outputs = ["C", "D"];
check(structural(invalidScene).some((issue) => issue.code === "invalid_space_segment_outputs"), "wrong output arity must be fatal");
for (const badParameter of [null, false, true, " ", { value: null }]) {
  let threw = false;
  try { evaluateSpaceDerivationConstruction("space_intersection", { frame: "frame", first: "x-plane", second: "z-plane", tMin: badParameter, tMax: 5 }, context); } catch { threw = true; }
  check(threw, `intersection render parameter must reject coercible non-numeric input ${JSON.stringify(badParameter)}`);
}

function putPoint(id: string, space: Vec3, spaceFrameId = "frame"): void {
  geometries.set(id, { kind: "point", point: isometricProject(space, { origin: { x: 0, y: 0 }, scale: 2 }), space, spaceFrameId });
}
function difference(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function scalarProduct(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function transform(p: Vec3, scale: number, translation: Vec3): Vec3 { return { x: p.x * scale + translation.x, y: p.y * scale + translation.y, z: p.z * scale + translation.z }; }

// Worked non-axis-aligned pair: feet (1,-2,3), (-7,8,-3), common perpendicular (-8,10,-6).
for (const scale of [0.2, 1, 7]) for (const shift of [{ x: 0, y: 0, z: 0 }, { x: 19, y: -11, z: 3 }]) for (const parameterScale of [1, -4, 11]) {
  const u = { x: 1, y: 2, z: 2 }; const v = { x: 2, y: 1, z: -1 };
  line("oblique-a", transform({ x: 4, y: 4, z: 9 }, scale, shift), transform(u, parameterScale, { x: 0, y: 0, z: 0 }));
  line("oblique-b", transform({ x: -11, y: 6, z: -1 }, scale, shift), transform(v, -2 * parameterScale, { x: 0, y: 0, z: 0 }));
  const result = evaluateSpaceDerivationConstruction("space_closest_points", { frame: "frame", first: "oblique-a", second: "oblique-b" }, context);
  check(result.length === 2 && result[0]?.kind === "point" && result[1]?.kind === "point", "oblique closest points must produce ordered feet");
  world(result[0].space, transform({ x: 1, y: -2, z: 3 }, scale, shift), "closest-point translation, scale, and direction reparameterization");
  world(result[1].space, transform({ x: -7, y: 8, z: -3 }, scale, shift), "second closest-point invariance");
  const connector = difference(result[1].space, result[0].space);
  close(scalarProduct(connector, u), 0, "independent first orthogonality identity");
  close(scalarProduct(connector, v), 0, "independent second orthogonality identity");
  close(Math.hypot(connector.x, connector.y, connector.z), 10 * Math.sqrt(2) * scale, "independent shortest-distance oracle");
}
plane("oblique-plane", { x: 0, y: -9, z: 0 }, { x: 2, y: -1, z: 2 });
for (const [target, expected] of [["oblique-plane", { x: 7 / 3, y: 13 / 3, z: 13 / 3 }], ["oblique-projection-line", { x: 3, y: 2, z: 7 }]] as const) {
  line("oblique-projection-line", { x: 1, y: -2, z: 3 }, { x: 1, y: 2, z: 2 });
  const [result] = evaluateSpaceDerivationConstruction("space_project", { frame: "frame", point: "P", onto: target }, context);
  check(result?.kind === "point", "projection must be a world point");
  world(result.space, expected, "oblique projection known oracle");
  close(spaceIncidenceResidual(result, geometries.get(target))!, 0, "projection must lie on target world locus");
}
for (const scale of [0.25, 1, 3]) for (const translation of [{ x: 0, y: 0, z: 0 }, { x: -17, y: 9, z: 14 }]) {
  putPoint("translated-p", transform({ x: 3, y: 4, z: 5 }, scale, translation));
  plane("translated-plane", transform({ x: 0, y: -9, z: 0 }, scale, translation), { x: -22, y: 11, z: -22 });
  const [result] = evaluateSpaceDerivationConstruction("space_project", { frame: "frame", point: "translated-p", onto: "translated-plane" }, context);
  check(result?.kind === "point", "translated projection must produce a point");
  world(result.space, transform({ x: 7 / 3, y: 13 / 3, z: 13 / 3 }, scale, translation), "plane projection translation/scale/normal reparameterization");
}
plane("oblique-plane-a", { x: 2, y: -1, z: 3 }, { x: 1, y: 2, z: 3 });
plane("oblique-plane-b", { x: 2, y: -1, z: 3 }, { x: 2, y: -1, z: 1 });
const [obliqueIntersection] = evaluateSpaceDerivationConstruction("space_intersection", { frame: "frame", first: "oblique-plane-a", second: "oblique-plane-b", tMin: -3, tMax: 5 }, context);
check(obliqueIntersection?.kind === "path" && obliqueIntersection.spaceLine, "oblique plane intersection must retain analytic line");
world(obliqueIntersection.spaceLine.point, { x: 8 / 3, y: -1 / 3, z: 7 / 3 }, "intersection minimum-origin world anchor");
for (const parameter of [-7, -3, 0, 5, 19]) {
  const p = transform(obliqueIntersection.spaceLine.direction, parameter, obliqueIntersection.spaceLine.point);
  close(p.x + 2 * p.y + 3 * p.z, 9, "first plane equation along intersection");
  close(2 * p.x - p.y + p.z, 8, "second plane equation along intersection");
}
line("crossing-a", { x: 2, y: 3, z: 5 }, { x: 1, y: 0, z: 0 });
line("crossing-b", { x: 2, y: 3, z: 5 }, { x: 0, y: 1, z: 0 });
const crossing = evaluateSpaceDerivationConstruction("space_closest_points", { frame: "frame", first: "crossing-a", second: "crossing-b" }, context);
check(crossing[0]?.kind === "point" && crossing[1]?.kind === "point", "intersecting nonparallel lines have unique coincident feet");
world(crossing[0].space, { x: 2, y: 3, z: 5 }, "intersection first foot"); world(crossing[1].space, { x: 2, y: 3, z: 5 }, "intersection second foot");

function rejects(operator: string, inputs: Record<string, unknown>, message: string): void {
  let threw = false; try { evaluateSpaceDerivationConstruction(operator, inputs, context); } catch { threw = true; }
  check(threw, message);
}
line("parallel-a", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
line("parallel-b", { x: 0, y: 1, z: 0 }, { x: -7, y: 0, z: 0 });
line("near-parallel", { x: 0, y: 1, z: 0 }, { x: 1, y: 1e-10, z: 0 });
plane("parallel-plane", { x: 0, y: 0, z: 7 }, { x: 0, y: 0, z: -1 });
geometries.set("other-frame", { kind: "compound", spaceFrame: { origin: { x: 0, y: 0 }, scale: 2 } });
putPoint("foreign-point", { x: 1, y: 2, z: 3 }, "other-frame");
putPoint("hidden-on-plane", { x: 2, y: 0, z: 0 }); putPoint("hidden-off-plane", { x: 3, y: -1, z: 1 });
putPoint("too-large", { x: 1e9 + 1, y: 0, z: 0 });
putPoint("nonfinite", { x: NaN, y: 0, z: 0 });
geometries.set("bad-frame", { kind: "compound", spaceFrame: { origin: { x: 0, y: 0 }, scale: 1e9 + 1 } });
for (const [operator, inputs, message] of [
  ["space_closest_points", { first: "parallel-a", second: "parallel-b" }, "parallel skew lines have no unique feet"],
  ["space_closest_points", { first: "parallel-a", second: "parallel-a" }, "coincident lines have no unique feet"],
  ["space_closest_points", { first: "parallel-a", second: "near-parallel" }, "near-parallel lines must fail numerical verification"],
  ["space_intersection", { first: "parallel-a", second: "z-plane" }, "parallel disjoint line-plane intersection is undefined"],
  ["space_intersection", { first: "crossing-a", second: "z-plane" }, "line contained in plane does not define a unique point"],
  ["space_intersection", { first: "z-plane", second: "parallel-plane", tMin: -3, tMax: 5 }, "parallel planes must reject"],
  ["space_intersection", { first: "z-plane", second: "z-plane", tMin: -3, tMax: 5 }, "coincident planes must reject"],
  ["space_intersection", { first: "skew-a", second: "skew-b" }, "two-line intersection is outside the declared contract"],
  ["space_intersection", { first: "x-plane", second: "z-plane" }, "two-plane intersection requires explicit render extent"],
  ["space_intersection", { first: "x-plane", second: "z-plane", tMin: 5, tMax: 5 }, "intersection extent must increase"],
  ["space_intersection", { first: "x-plane", second: "z-plane", tMin: -Infinity, tMax: 5 }, "intersection extent must be finite"],
  ["space_intersection", { first: "x-plane", second: "z-plane", tMin: -3, tMax: 1e9 + 1 }, "intersection extent must be bounded"],
  ["space_project", { point: "P", onto: "line", unexpected: true }, "unknown projection fields must reject"],
  ["space_project", { point: "foreign-point", onto: "line" }, "identical projections in different frames cannot be mixed"],
  ["space_project", { point: "too-large", onto: "line" }, "world coordinates must be bounded"],
  ["space_project", { point: "nonfinite", onto: "line" }, "world coordinates must be finite"],
  ["space_project", { point: "P", onto: "closest-a" }, "projection onto a point is unsupported"],
  ["space_project", { frame: "bad-frame", point: "P", onto: "line" }, "frame scale must be bounded"],
  ["space_segment", { a: "P", b: "P" }, "zero-length segment must reject"],
  ["space_segment", { a: "hidden-on-plane", b: "hidden-off-plane" }, "world segment hidden by isometric kernel cannot render"],
  ["space_segment", { a: "closest-a", b: "foreign-point" }, "segment endpoints cannot mix frames"],
] as const) rejects(operator, { frame: "frame", ...inputs }, message);

for (const mutate of [
  (candidate: SceneDocument) => { candidate.constructions.find((c) => c.operator === "space_closest_points")!.outputs = ["C"]; },
  (candidate: SceneDocument) => { candidate.entities.find((e) => e.id === "CD")!.kind = "line"; },
  (candidate: SceneDocument) => { candidate.constructions.find((c) => c.operator === "space_project")!.inputs.point = "Z"; },
  (candidate: SceneDocument) => { candidate.constructions.find((c) => c.operator === "space_project")!.inputs.frame = "X"; },
  (candidate: SceneDocument) => { candidate.quantities[0]!.value = "three"; },
  (candidate: SceneDocument) => { candidate.constructions.find((c) => c.id === "make-foot")!.inputs.point = "foot"; },
  (candidate: SceneDocument) => { candidate.constructions.find((c) => c.operator === "space_intersection")!.inputs.tMax = 1e9 + 1; },
  (candidate: SceneDocument) => { candidate.constructions.find((c) => c.id === "b")!.inputs.direction = [0, 0, 0]; },
  (candidate: SceneDocument) => { candidate.constructions.find((c) => c.id === "b")!.inputs.direction = [2, 0, 0]; },
] as const) {
  const candidate = scene(); mutate(candidate);
  check(structural(candidate).some((issue) => issue.severity === "fatal"), "invalid world derivation must fail structural validation");
}
if (!process.argv.includes("--geometry-only")) {
  const { compileSceneDocument, validateSceneDocument, isSupportedSceneOperator } = await import("../../src/index");
  for (const operator of SPACE_DERIVATION_OPERATORS) check(isSupportedSceneOperator(operator), `${operator} must be an executable capability`);
  const candidate = scene();
  for (const [id, z] of [["S0", 0], ["S2", 2.5], ["S5", 5]] as const) {
    candidate.entities.push({ id, kind: "point", role: "world distance reference" });
    candidate.constructions.push({ id: `make_${id}`, operator: "space_point", inputs: { frame: "F", x: 0, y: 0, z }, outputs: [id] });
    candidate.requiredEntityIds.push(id); candidate.revealGroups[0]!.entityIds.push(id);
  }
  candidate.entities.push({ id: "reference-length", kind: "segment", role: "world reference segment" });
  candidate.constructions.push({ id: "make-reference-length", operator: "space_segment", inputs: { frame: "F", a: "S0", b: "S5" }, outputs: ["reference-length"] });
  candidate.requiredEntityIds.push("reference-length"); candidate.revealGroups[0]!.entityIds.push("reference-length");
  for (const [id, kind] of [["derived-anchor-line", "line"], ["derived-anchor-plane", "polygon"], ["derived-plane-foot", "point"]] as const) {
    candidate.entities.push({ id, kind, role: "reusable derived world reference" });
    candidate.requiredEntityIds.push(id); candidate.revealGroups[0]!.entityIds.push(id);
  }
  candidate.constructions.push(
    { id: "make-derived-anchor-line", operator: "space_line", inputs: { frame: "F", point: "C", direction: [1, 0, 0] }, outputs: ["derived-anchor-line"] },
    { id: "make-derived-anchor-plane", operator: "plane", inputs: { frame: "F", point: "D", u: [1, 0, 0], v: [0, 1, 0] }, outputs: ["derived-anchor-plane"] },
    { id: "make-derived-plane-foot", operator: "space_project", inputs: { frame: "F", point: "P", onto: "derived-anchor-plane" }, outputs: ["derived-plane-foot"] },
  );
  candidate.assertions = [
    { id: "first-foot-incidence", predicate: "incident", entities: ["C", "A"], severity: "fatal", expected: true },
    { id: "second-foot-incidence", predicate: "incident", entities: ["D", "B"], severity: "fatal", expected: true },
    { id: "first-orthogonality", predicate: "perpendicular", entities: ["CD", "A"], severity: "fatal", expected: true },
    { id: "second-orthogonality", predicate: "perpendicular", entities: ["CD", "B"], severity: "fatal", expected: true },
    { id: "world-line-angle", predicate: "angle_between", entities: ["A", "B"], severity: "fatal", expected: { value: 90, unit: "deg" } },
    { id: "equal-world-angle", predicate: "equal_angle", entities: ["CD", "A", "CD", "B"], severity: "fatal", expected: true },
    { id: "intersection-parallel", predicate: "parallel", entities: ["L", "B"], severity: "fatal", expected: true },
    { id: "world-collinearity", predicate: "collinear", entities: ["S0", "S2", "S5"], severity: "fatal", expected: true },
    { id: "world-length-ratio", predicate: "distance_ratio", entities: ["C", "D", "S0", "S5"], severity: "fatal", expected: 1 },
    { id: "equal-world-segments", predicate: "equal_length", entities: ["CD", "reference-length"], severity: "fatal", expected: true },
    { id: "equal-world-pairs", predicate: "equal_length", entities: ["C", "D", "S0", "S5"], severity: "fatal", expected: true },
    { id: "off-plane-negative", predicate: "incident", entities: ["P", "X"], severity: "fatal", expected: false },
    { id: "derived-base-line-incidence", predicate: "incident", entities: ["C", "derived-anchor-line"], severity: "fatal", expected: true },
    { id: "derived-base-plane-incidence", predicate: "incident", entities: ["D", "derived-anchor-plane"], severity: "fatal", expected: true },
    { id: "derived-plane-foot-incidence", predicate: "incident", entities: ["derived-plane-foot", "derived-anchor-plane"], severity: "fatal", expected: true },
  ];
  const validated = validateSceneDocument(candidate);
  check(validated.document, `world derivation scene structurally failed: ${JSON.stringify(validated.report.issues)}`);
  const compiled = compileSceneDocument(validated.document);
  check(compiled.ok && compiled.renderScene, `world derivation scene failed compile: ${JSON.stringify(compiled.report.issues)}`);
  check(compiled.renderScene.primitives.some((p) => p.entityId === "CD"), "world shortest connector must render");
  check(compiled.renderScene.primitives.every((p) => p.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))), "compiled projection must remain finite");
  check(JSON.stringify(compiled.renderScene) === JSON.stringify(compileSceneDocument(validated.document).renderScene), "world derivation scene compile must be deterministic");
  const reordered = structuredClone(candidate);
  reordered.constructions.reverse();
  const reorderedResult = compileSceneDocument(reordered);
  check(reorderedResult.ok && reorderedResult.renderScene, `world dependencies must compile independently of construction array order: ${JSON.stringify(reorderedResult.report.issues)}`);
  for (const id of ["first-foot-incidence", "second-foot-incidence", "first-orthogonality", "second-orthogonality", "equal-world-segments", "equal-world-pairs", "world-collinearity"]) {
    const falseAssertion = structuredClone(candidate);
    falseAssertion.assertions.find((a) => a.id === id)!.expected = false;
    const result = compileSceneDocument(falseAssertion);
    check(!result.ok && result.renderScene === null, `${id} must fail when its verified truth is negated`);
  }
  const hiddenPoint = structuredClone(candidate);
  hiddenPoint.constructions.find((c) => c.id === "point")!.inputs = { frame: "F", x: 3, y: -1, z: 1 };
  hiddenPoint.assertions = [{ id: "flattened-incidence-lie", predicate: "incident", entities: ["P", "X"], severity: "fatal", expected: true }];
  const hiddenResult = compileSceneDocument(hiddenPoint);
  check(!hiddenResult.ok && hiddenResult.renderScene === null, "off-plane point with same canvas projection must reject world incidence atomically");
  for (const mutate of [
    (bad: SceneDocument) => { bad.constructions.find((c) => c.id === "closest")!.outputs = ["C"]; },
    (bad: SceneDocument) => { bad.entities.find((e) => e.id === "CD")!.kind = "line"; },
    (bad: SceneDocument) => { bad.constructions.find((c) => c.id === "b")!.inputs.direction = [2, 0, 0]; },
    (bad: SceneDocument) => { bad.constructions.find((c) => c.id === "intersection")!.inputs.tMax = 1e9 + 1; },
    (bad: SceneDocument) => { bad.constructions.find((c) => c.id === "point")!.inputs.z = Infinity; },
    (bad: SceneDocument) => { bad.constructions.find((c) => c.id === "segment")!.operator = "space_magic_segment"; },
    (bad: SceneDocument) => {
      bad.entities.push({ id: "foreign-frame", kind: "polyline", role: "another world frame" });
      bad.constructions.push({ id: "make-foreign-frame", operator: "space_frame", inputs: { origin: "O", scale: 2 }, outputs: ["foreign-frame"] });
      bad.requiredEntityIds.push("foreign-frame"); bad.revealGroups[0]!.entityIds.push("foreign-frame");
      bad.constructions.find((c) => c.id === "b")!.inputs.frame = "foreign-frame";
    },
  ] as const) {
    const bad = structuredClone(candidate); mutate(bad);
    check(!validateSceneDocument(bad).document, "invalid space scene must fail before compilation");
    const result = compileSceneDocument(bad);
    check(!result.ok && result.renderScene === null, "invalid space scene cannot emit partial primitives");
  }
  check(!isSupportedSceneOperator("space_magic_segment"), "undeclared space capability must remain rejected");
}
console.log(`space derivation operator verification passed (${checks} checks)`);
