/**
 * Space view gate (G1 to G16 of .context/h4/3d/DESIGN.md section 8; G17 to G21
 * from fix pass 1: two planes and their line, patch size, element labels,
 * room inside triangles, face-on planes; G22 to G25 from fix pass 2: room for
 * point names at their real size inside and on the corners of planes).
 *
 * G15 guards byte identity: every frozen document without a space_frame
 * (golden and regression fixtures, the evaluation compile probes, the physics
 * evaluation probes, and synthesized polyhedral solids) must render exactly as
 * it did on the base commit. `--record-byte-identity` rewrites the fixture and
 * is only ever run on the base commit.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compileSceneDocument, synthesizeFamilyScene, validateSceneDocument, type RenderPoint, type RenderPrimitive, type RenderScene, type SceneAssertion, type SceneConstruction, type SceneDocument, type SceneEntity } from "../../src/index";
import { planePatchCorners } from "../../src/math/space";
import { EVALUATION_COMPILE_PROBES } from "../probes/evaluationCompileProbes";
import { PHYSICS_EVALUATION_COMPILE_PROBES } from "../probes/evaluationPhysicsProbes";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "../..");
const identityFixture = join(here, "fixtures/space-view-byte-identity.json");

let failures = 0;
const results: string[] = [];
function gate(name: string, run: () => string | null): void {
  let failure: string | null;
  try { failure = run(); } catch (error) { failure = `threw ${error instanceof Error ? error.message : String(error)}`; }
  if (failure) { failures += 1; results.push(`FAIL ${name}: ${failure}`); } else results.push(`ok   ${name}`);
}

// New modules load lazily so the gate also runs, and fails, on the base engine.
type SpaceViewModule = typeof import("../../src/compile/spaceView");
type SpaceCameraModule = typeof import("../../src/math/spaceCamera");
const spaceView: SpaceViewModule | null = await import("../../src/compile/spaceView").catch(() => null);
const spaceCamera: SpaceCameraModule | null = await import("../../src/math/spaceCamera").catch(() => null);

// ---------- Synthetic documents ----------
interface V3 { x: number; y: number; z: number }
type Part = [SceneEntity, SceneConstruction];
const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
const entity = (id: string, kind: string, label?: string): SceneEntity => ({ id, kind, role: `${kind} in the world figure`, ...(label ? { label } : {}) });
const make = (operator: string, inputs: Record<string, unknown>, outputs: string[], id = `make_${outputs.join("_")}`): SceneConstruction => ({ id, operator, inputs, outputs });
const sp = (id: string, p: V3, label?: string): Part => [entity(id, "point", label), make("space_point", { frame: "frame", x: p.x, y: p.y, z: p.z }, [id])];
const part = (id: string, kind: string, operator: string, inputs: Record<string, unknown>, label?: string): Part => [entity(id, kind, label), make(operator, { frame: "frame", ...inputs }, [id])];
function spaceDocument(title: string, parts: Part[], options: { axisLength?: number; assertions?: SceneAssertion[]; frames?: Part[] } = {}): SceneDocument {
  const all: Part[] = [
    [{ id: "origin", kind: "point", role: "construction helper point" }, make("point", { x: 0, y: 0 }, ["origin"])],
    [entity("frame", "polyline"), make("space_frame", { origin: "origin", scale: 1, ...(options.axisLength ? { axisLength: options.axisLength } : {}) }, ["frame"])],
    ...(options.frames ?? []),
    ...parts,
  ];
  const required = all.map(([item]) => item.id).filter((id) => id !== "origin" && !id.startsWith("origin_"));
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "synthetic space view figure" },
    source: { question: title }, quantities: [], entities: all.map(([item]) => item), constructions: all.map(([, construction]) => construction),
    relations: [], assertions: options.assertions ?? [], annotations: [], requiredEntityIds: required,
    revealGroups: [{ id: "scene", entityIds: required, dependsOn: [], narrationCue: title }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "scene", dependsOn: [], narrationIntent: title }],
  } as SceneDocument;
}
interface Compiled { validated: SceneDocument | null; render: RenderScene | null; issues: string }
function compile(document: SceneDocument): Compiled {
  const validation = validateSceneDocument(structuredClone(document));
  const fatal = (issues: Array<{ severity: string; code: string; message: string }>) => issues.filter((issue) => issue.severity === "fatal").map((issue) => `${issue.code}: ${issue.message}`).join("; ");
  if (!validation.document) return { validated: null, render: null, issues: fatal(validation.report.issues) };
  const compiled = compileSceneDocument(validation.document);
  return { validated: validation.document, render: compiled.ok ? compiled.renderScene : null, issues: fatal(compiled.report.issues) };
}
function rendered(document: SceneDocument): RenderScene {
  const result = compile(document);
  if (!result.render) throw new Error(`does not compile: ${result.issues}`);
  return result.render;
}

// ---------- Canvas helpers ----------
const sub2 = (a: RenderPoint, b: RenderPoint): RenderPoint => ({ x: a.x - b.x, y: a.y - b.y });
const len2 = (a: RenderPoint): number => Math.hypot(a.x, a.y);
/** Unsigned angle between two canvas lines, 0 to 90 degrees. */
function lineAngle(a: RenderPoint, b: RenderPoint): number {
  const cosine = Math.abs(a.x * b.x + a.y * b.y) / (len2(a) * len2(b));
  return Math.acos(Math.min(1, cosine)) * 180 / Math.PI;
}
function segmentDistance(p: RenderPoint, a: RenderPoint, b: RenderPoint): number {
  const ab = sub2(b, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / Math.max(1e-12, ab.x * ab.x + ab.y * ab.y)));
  return len2(sub2(p, { x: a.x + ab.x * t, y: a.y + ab.y * t }));
}
function primitive(render: RenderScene, id: string): RenderPrimitive {
  const found = render.primitives.find((item) => item.id === id);
  if (!found) throw new Error(`no primitive ${id}`);
  return found;
}
function polygon(render: RenderScene, entityId: string): RenderPoint[] {
  const points = primitive(render, `primitive_${entityId}`).points;
  const last = points.at(-1)!;
  return points.length > 3 && len2(sub2(points[0]!, last)) < 1e-6 ? points.slice(0, -1) : points;
}
/** Smallest distance to an edge, positive inside a convex polygon and negative outside. */
function insideMargin(point: RenderPoint, ring: RenderPoint[]): number {
  const area = ring.reduce((sum, a, index) => { const b = ring[(index + 1) % ring.length]!; return sum + a.x * b.y - b.x * a.y; }, 0);
  const sign = Math.sign(area) || 1;
  return Math.min(...ring.map((a, index) => {
    const b = ring[(index + 1) % ring.length]!;
    const edge = sub2(b, a);
    return sign * (edge.x * (point.y - a.y) - edge.y * (point.x - a.x)) / len2(edge);
  }));
}
function pointCanvas(render: RenderScene, entityId: string): RenderPoint {
  const own = render.primitives.find((item) => item.entityId === entityId && item.kind === "point");
  if (own) return own.points[0]!;
  const bounds = render.entityBounds[entityId];
  if (!bounds) throw new Error(`no canvas point for ${entityId}`);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}
interface AxisInk { origin: RenderPoint; tips: RenderPoint[]; paths: Array<Array<[RenderPoint, RenderPoint]>> }
/** The frame's three positive half-axes and any appended negative halves, grouped by axis. */
function axisInk(render: RenderScene, frameId = "frame"): AxisInk {
  const paths = render.primitives.filter((item) => item.entityId === frameId && item.kind !== "label" && new RegExp(`^primitive_${frameId}_\\d+$`).test(item.id));
  const positive = [0, 1, 2].map((index) => primitive(render, `primitive_${frameId}_${index}`).points);
  const origin = positive[0]![0]!;
  const grouped = positive.map((path) => [[path[0]!, path[1]!] as [RenderPoint, RenderPoint]]);
  for (const path of paths.slice(3)) {
    const direction = sub2(path.points[1]!, path.points[0]!);
    const axis = positive.findIndex((tip) => { const own = sub2(tip[1]!, tip[0]!); return lineAngle(own, direction) < 0.5 && own.x * direction.x + own.y * direction.y < 0; });
    if (axis >= 0) grouped[axis]!.push([path.points[0]!, path.points[1]!]);
  }
  return { origin, tips: positive.map((path) => path[1]!), paths: grouped };
}
function axisDistance(ink: AxisInk, axis: number, point: RenderPoint): number {
  return Math.min(...ink.paths[axis]!.map(([a, b]) => segmentDistance(point, a, b)));
}
/** World to canvas through the drawn axes: linear, with the drawn positive tips at the planned axis lengths. */
function worldToCanvas(render: RenderScene, document: SceneDocument, axisLength = 2): (p: V3) => RenderPoint {
  const ink = axisInk(render);
  const plan = spaceView?.planSpaceView(document) ?? null;
  const reach = plan?.frames.get("frame")?.axisMax ?? v3(axisLength, axisLength, axisLength);
  const unit = [reach.x, reach.y, reach.z].map((length, index) => { const tip = sub2(ink.tips[index]!, ink.origin); return { x: tip.x / length, y: tip.y / length }; });
  return (p) => ({ x: ink.origin.x + p.x * unit[0]!.x + p.y * unit[1]!.x + p.z * unit[2]!.x, y: ink.origin.y + p.x * unit[0]!.y + p.y * unit[1]!.y + p.z * unit[2]!.y });
}
function lineDirection(render: RenderScene, entityId: string): RenderPoint {
  const points = primitive(render, `primitive_${entityId}`).points;
  return sub2(points.at(-1)!, points[0]!);
}
function rho(document: SceneDocument, direction: V3): number {
  const plan = spaceView?.planSpaceView(document);
  if (!plan) throw new Error("planSpaceView is absent or returned null");
  const length = Math.hypot(direction.x, direction.y, direction.z);
  const { right, up } = plan.projection;
  const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.hypot(dot(right, direction), dot(up, direction)) / length;
}

// ---------- G1 to G14, G16 ----------
const frameOnly = spaceDocument("coordinate axes", []);
gate("G1 z is drawn straight up", () => {
  const [origin, tip] = primitive(rendered(frameOnly), "primitive_frame_2").points;
  const dx = tip!.x - origin!.x;
  const dy = tip!.y - origin!.y;
  return Math.abs(dx) <= 0.5 && dy < -20 ? null : `z axis runs (${dx.toFixed(2)}, ${dy.toFixed(2)}) px`;
});

const xyPlane = spaceDocument("the plane z = 0", [part("plane", "polygon", "plane", { a: 0, b: 0, c: 1, d: 0 })]);
gate("G2 the xy-plane lies flat", () => {
  const ring = polygon(rendered(xyPlane), "plane");
  const fromVertical = ring.map((a, index) => lineAngle(sub2(ring[(index + 1) % ring.length]!, a), { x: 0, y: 1 }));
  const width = Math.max(...ring.map((p) => p.x)) - Math.min(...ring.map((p) => p.x));
  const height = Math.max(...ring.map((p) => p.y)) - Math.min(...ring.map((p) => p.y));
  if (fromVertical.some((angle) => angle < 15)) return `an edge is ${Math.min(...fromVertical).toFixed(1)} degrees from vertical`;
  return height < width ? null : `polygon is ${width.toFixed(1)} wide and ${height.toFixed(1)} tall`;
});

const kernelSegment: Part[] = [sp("O", v3(0, 0, 0), "O"), sp("A", v3(1, -1, 1), "A"), part("OA", "segment", "space_segment", { a: "O", b: "A" })];
const kernelDocument = spaceDocument("segment OA along (1, -1, 1)", kernelSegment);
gate("G3 a segment along (1, -1, 1) does not collapse", () => {
  const result = compile(kernelDocument);
  if (!result.validated || !result.render) return `rejected: ${result.issues}`;
  const measured = rho(result.validated, v3(1, -1, 1));
  return measured >= 0.45 ? null : `rho(1,-1,1) is ${measured.toFixed(3)}`;
});

const lineThroughOrigin = (direction: V3, title: string) => spaceDocument(title, [sp("O", v3(0, 0, 0), "O"), part("L", "line", "space_line", { point: "O", direction: [direction.x, direction.y, direction.z] })]);
gate("G4 a line along (1, 1, 1) is drawn apart from every axis", () => {
  const render = rendered(lineThroughOrigin(v3(1, 1, 1), "the line x = y = z"));
  const line = lineDirection(render, "L");
  const angles = [0, 1, 2].map((index) => lineAngle(line, lineDirection(render, `frame_${index}`)));
  return Math.min(...angles) >= 15 ? null : `angles to x, y, z axes ${angles.map((angle) => angle.toFixed(1)).join(", ")}`;
});
gate("G5 a line along (2, 1, 2) is not drawn vertical", () => {
  const render = rendered(lineThroughOrigin(v3(2, 1, 2), "the line x/2 = y = z/2"));
  const line = lineDirection(render, "L");
  const toZ = lineAngle(line, lineDirection(render, "frame_2"));
  const toVertical = lineAngle(line, { x: 0, y: 1 });
  return Math.min(toZ, toVertical) >= 15 ? null : `angle to z ${toZ.toFixed(1)}, to vertical ${toVertical.toFixed(1)}`;
});

const meetingParts: Part[] = [
  part("plane", "polygon", "plane", { a: 1, b: -2, c: 2, d: 6 }, "Π"),
  sp("P", v3(2.5, -0.75, -0.5), "P"),
  part("L", "line", "space_line", { point: "P", direction: [2, 1, 2] }, "L"),
  [entity("Q", "point", "Q"), make("space_intersection", { frame: "frame", first: "L", second: "plane" }, ["Q"])],
];
const meetingDocument = spaceDocument("line through P meets the plane x - 2y + 2z = 6 at Q", meetingParts);
gate("G6 the plane patch holds the meeting point", () => {
  const render = rendered(meetingDocument);
  const ring = polygon(render, "plane");
  const q = pointCanvas(render, "Q");
  const shortest = Math.min(...ring.map((a, index) => len2(sub2(ring[(index + 1) % ring.length]!, a))));
  const margin = insideMargin(q, ring);
  if (margin < 0.05 * shortest) return `Q is ${margin.toFixed(1)} px inside, needs ${(0.05 * shortest).toFixed(1)}`;
  const [a, b] = [primitive(render, "primitive_L").points[0]!, primitive(render, "primitive_L").points.at(-1)!];
  if (segmentDistance(q, a, b) > 1) return "Q is not on the drawn line";
  const crosses = Array.from({ length: 401 }, (_, index) => ({ x: a.x + (b.x - a.x) * index / 400, y: a.y + (b.y - a.y) * index / 400 })).some((point) => insideMargin(point, ring) > 1);
  return crosses ? null : "the line never crosses the plane's interior";
});
const footDocument = spaceDocument("foot N of P on the plane", [...meetingParts, [entity("N", "point", "N"), make("space_project", { frame: "frame", point: "P", onto: "plane" }, ["N"])]]);
gate("G7 the plane patch holds the foot of the perpendicular", () => {
  const render = rendered(footDocument);
  const ring = polygon(render, "plane");
  const margins = ["Q", "N"].map((id) => insideMargin(pointCanvas(render, id), ring));
  return margins.every((margin) => margin > 0) ? null : `Q and N margins ${margins.map((margin) => margin.toFixed(1)).join(", ")} px`;
});

const normalDocument = spaceDocument("normal ON to the plane z = 1", [
  part("plane", "polygon", "plane", { a: 0, b: 0, c: 1, d: 1, span: 2 }),
  sp("O", v3(0, 0, 0), "O"), sp("N", v3(0, 0, 1), "N"), sp("T", v3(0, 0, 2), "T"),
  part("ON", "segment", "space_segment", { a: "O", b: "N" }),
  part("n", "vector", "space_vector", { start: "N", end: "T" }, "n"),
]);
gate("G8 a plane in normal form keeps its corners off O", () => {
  const render = rendered(normalDocument);
  const ring = polygon(render, "plane");
  const o = pointCanvas(render, "O");
  const diagonal = Math.max(...ring.flatMap((a) => ring.map((b) => len2(sub2(a, b)))));
  const nearest = Math.min(...ring.map((corner) => len2(sub2(corner, o))));
  if (nearest < 0.1 * diagonal) return `a corner is ${nearest.toFixed(1)} px from O (diagonal ${diagonal.toFixed(1)})`;
  return insideMargin(pointCanvas(render, "N"), ring) > 0 ? null : "N is outside the plane";
});

const interceptCoefficient = spaceDocument("the plane 6x + 3y - 2z = 6", [part("plane", "polygon", "plane", { a: 6, b: 3, c: -2, d: 6 })]);
const interceptBasis = spaceDocument("the plane through A, B and C", [
  sp("A", v3(1, 0, 0), "A"), sp("B", v3(0, 2, 0), "B"), sp("C", v3(0, 0, -3), "C"),
  part("plane", "polygon", "plane", { point: "A", u: [-1, 2, 0], v: [-1, 0, -3] }),
]);
const interceptsOf = [v3(1, 0, 0), v3(0, 2, 0), v3(0, 0, -3)];
gate("G9 an intercept plane is drawn as its intercept triangle", () => {
  for (const [name, document] of [["coefficient form", interceptCoefficient], ["point/u/v form", interceptBasis]] as const) {
    const render = rendered(document);
    const ring = polygon(render, "plane");
    if (primitive(render, "primitive_plane").points.length !== 3 || ring.length !== 3) return `${name}: plane has ${ring.length} vertices`;
    const canvas = worldToCanvas(render, document);
    const ink = axisInk(render);
    for (const [axis, intercept] of interceptsOf.entries()) {
      const image = canvas(intercept);
      const vertex = ring.reduce((best, point) => len2(sub2(point, image)) < len2(sub2(best, image)) ? point : best);
      if (len2(sub2(vertex, image)) > 0.5) return `${name}: no vertex within 0.5 px of intercept ${axis}`;
      if (axisDistance(ink, axis, vertex) > 0.5) return `${name}: vertex ${axis} is ${axisDistance(ink, axis, vertex).toFixed(2)} px off its axis`;
    }
  }
  return null;
});
const farIntercept = spaceDocument("the plane x/2 + y/3 + z/5 = 1", [part("plane", "polygon", "plane", { a: 15, b: 10, c: 6, d: 30 })]);
gate("G10 axes reach their intercepts", () => {
  const below = rendered(interceptCoefficient);
  const belowInk = axisInk(below);
  if (belowInk.paths[2]!.length < 2) return "no negative z half-axis";
  const minusThree = worldToCanvas(below, interceptCoefficient)(v3(0, 0, -3));
  if (axisDistance(belowInk, 2, minusThree) > 0.5) return `(0, 0, -3) is ${axisDistance(belowInk, 2, minusThree).toFixed(2)} px off the z axis`;
  const above = rendered(farIntercept);
  const aboveInk = axisInk(above);
  const five = worldToCanvas(above, farIntercept)(v3(0, 0, 5));
  const offset = segmentDistance(five, aboveInk.origin, aboveInk.tips[2]!);
  return offset <= 0.5 ? null : `(0, 0, 5) is ${offset.toFixed(2)} px beyond the positive z axis`;
});

const throughOrigin = spaceDocument("the plane x + y + z = 0", [part("plane", "polygon", "plane", { a: 1, b: 1, c: 1, d: 0 })]);
const parallelToZ = spaceDocument("the plane x + y = 2", [part("plane", "polygon", "plane", { a: 1, b: 1, c: 0, d: 2 })]);
const pointOutside = spaceDocument("the plane x + y + z = 2 through P", [part("plane", "polygon", "plane", { a: 1, b: 1, c: 1, d: 2 }), sp("P", v3(2, 2, -2), "P")]);
gate("G11 control planes are patches that hold what lies on them", () => {
  const checks: Array<[string, SceneDocument, V3[], string[]]> = [
    ["x + y + z = 0", throughOrigin, [v3(0, 0, 0)], []],
    ["x + y = 2", parallelToZ, [v3(2, 0, 0), v3(0, 2, 0)], []],
    // Fix pass 1: a plane that holds a point is drawn around it, not grown to its unmarked intercepts.
    ["x + y + z = 2 with P outside its triangle", pointOutside, [], ["P"]],
  ];
  for (const [name, document, worlds, points] of checks) {
    const render = rendered(document);
    const ring = polygon(render, "plane");
    if (ring.length !== 4) return `${name}: ${ring.length} vertices`;
    const canvas = worldToCanvas(render, document);
    const margins = [...worlds.map((p) => insideMargin(canvas(p), ring)), ...points.map((id) => insideMargin(pointCanvas(render, id), ring))];
    if (margins.some((margin) => margin < 1)) return `${name}: margins ${margins.map((margin) => margin.toFixed(1)).join(", ")} px`;
  }
  return null;
});

const edgeOnDocument = spaceDocument("right angle between OA and OB", [
  ...kernelSegment.slice(1),
  sp("O", v3(0, 0, 0), "O"), sp("B", v3(1, 0, 0), "B"), sp("C", v3(0, 1, -1), "C"),
  part("angle", "angle_mark", "space_angle_mark", { vertex: "O", a: "B", b: "C" }),
]);
gate("G12 validation and compile agree on the view", () => {
  for (const document of [kernelDocument, edgeOnDocument]) {
    const validation = validateSceneDocument(structuredClone(document));
    const fatal = validation.report.issues.filter((issue) => issue.severity === "fatal");
    if (!validation.document || fatal.length) return `validation rejects ${document.source.question}: ${fatal.map((issue) => issue.code).join(", ")}`;
  }
  const render = rendered(edgeOnDocument);
  const o = pointCanvas(render, "O");
  const b = sub2(pointCanvas(render, "B"), o);
  const c = sub2(pointCanvas(render, "C"), o);
  const sine = Math.abs(b.x * c.y - b.y * c.x) / (len2(b) * len2(c));
  return sine >= 0.15 ? null : `projected arm sine ${sine.toFixed(3)}`;
});

gate("G13 the camera rule reproduces the design numbers", () => {
  if (!spaceCamera || !spaceView) return "spaceCamera or spaceView is absent";
  const bad = spaceCamera.SPACE_PROJECTION_CANDIDATES.filter((candidate) => candidate.right.z !== 0 || !(candidate.up.z > 0));
  if (bad.length) return `${bad.length} candidates do not keep z up`;
  const separation = (projection: { right: V3; up: V3 }, a: V3, b: V3) => {
    const image = (p: V3) => ({ x: projection.right.x * p.x + projection.right.y * p.y + projection.right.z * p.z, y: projection.up.x * p.x + projection.up.y * p.y + projection.up.z * p.z });
    return lineAngle(image(a), image(b));
  };
  const axes = [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)];
  const cases: Array<[V3, string, (projection: { right: V3; up: V3 }) => string | null]> = [
    [v3(1, 1, 1), "book 0.5 60", (projection) => { const worst = Math.min(...axes.map((axis) => separation(projection, v3(1, 1, 1), axis))); return worst >= 22.8 ? null : `axis separation ${worst.toFixed(1)}`; }],
    [v3(2, 1, 2), "book 0.5 52.5", (projection) => {
      const worst = Math.min(...axes.map((axis) => separation(projection, v3(2, 1, 2), axis)));
      const image = { x: projection.right.x * 2 + projection.right.y + projection.right.z * 2, y: projection.up.x * 2 + projection.up.y + projection.up.z * 2 };
      const measured = len2(image) / 3;
      return worst >= 17.9 && measured >= 0.42 ? null : `separation ${worst.toFixed(1)}, rho ${measured.toFixed(3)}`;
    }],
    [v3(1, -1, 1), "book 0.5 45", () => null],
  ];
  for (const [direction, expected, extra] of cases) {
    const plan = spaceView.planSpaceView(lineThroughOrigin(direction, "line through O"));
    if (!plan) return "no plan";
    const name = `${plan.projection.family} ${plan.projection.params[0]} ${plan.projection.params[1]}`;
    if (name !== expected) return `(${direction.x}, ${direction.y}, ${direction.z}) chose ${name}, expected ${expected}`;
    const failure = extra(plan.projection);
    if (failure) return `(${direction.x}, ${direction.y}, ${direction.z}): ${failure}`;
  }
  return null;
});

const angleOnPlane: Part[] = [...meetingParts, [entity("N", "point", "N"), make("space_project", { frame: "frame", point: "P", onto: "plane" }, ["N"])],
  part("PN", "segment", "space_segment", { a: "P", b: "N" }), part("NQ", "segment", "space_segment", { a: "N", b: "Q" }),
  part("foot", "right_angle_mark", "space_right_angle_mark", { vertex: "N", a: "P", b: "Q" })];
gate("G14 the view is deterministic and shared by every frame", () => {
  const document = spaceDocument("foot of the perpendicular and the meeting point", angleOnPlane);
  const first = JSON.stringify(rendered(document));
  if (JSON.stringify(rendered(document)) !== first) return "two compiles differ";
  const reversed = structuredClone(document);
  reversed.constructions.reverse();
  if (JSON.stringify(rendered(reversed)) !== first) return "reversed construction order renders differently";
  const twoFrames = spaceDocument("two frames", [sp("A", v3(1, 1, 1), "A")], { frames: [
    [{ id: "origin_2", kind: "point", role: "construction helper point" }, make("point", { x: 9, y: 0 }, ["origin_2"])],
    [entity("frame_b", "polyline"), make("space_frame", { origin: "origin_2", scale: 1 }, ["frame_b"])],
    [entity("B", "point", "B"), make("space_point", { frame: "frame_b", x: 1, y: -1, z: 1 }, ["B"])],
  ] });
  const render = rendered(twoFrames);
  for (const index of [0, 1, 2]) {
    const angle = lineAngle(lineDirection(render, `frame_${index}`), lineDirection(render, `frame_b_${index}`));
    if (angle > 0.05) return `axis ${index} of the two frames differs by ${angle.toFixed(2)} degrees`;
  }
  if (spaceView) {
    // The plan memo must not outlive an in-place edit of the same document.
    const edited = structuredClone(meetingDocument);
    const before = JSON.stringify(spaceView.planSpaceView(edited)?.planes.get("plane"));
    edited.constructions.find((construction) => construction.id === "make_plane")!.inputs = { frame: "frame", a: 1, b: -2, c: 2, d: 9 };
    if (JSON.stringify(spaceView.planSpaceView(edited)?.planes.get("plane")) === before) return "an in-place edit kept the stale plane drawing";
  }
  return null;
});

gate("G16 the axes carry their letters", () => {
  for (const document of [frameOnly, footDocument]) {
    const render = rendered(document);
    const ink = axisInk(render);
    for (const [index, letter] of ["x", "y", "z"].entries()) {
      const label = render.primitives.find((item) => item.kind === "label" && item.entityId === "frame" && item.text === letter);
      if (!label) return `${document.source.question}: no ${letter} label`;
      const nearest = ink.tips.map((tip) => len2(sub2(tip, label.points[0]!)));
      if (nearest.indexOf(Math.min(...nearest)) !== index) return `${document.source.question}: ${letter} sits nearest another tip`;
    }
  }
  return null;
});

// ---------- Fix pass 1: G17 to G21 ----------
const ZONE = { left: 410, right: 1150, top: 55, bottom: 610 };
const inZone = (point: RenderPoint, inset = 0): boolean => point.x >= ZONE.left + inset && point.x <= ZONE.right - inset && point.y >= ZONE.top + inset && point.y <= ZONE.bottom - inset;
function labelCentre(render: RenderScene, entityId: string): RenderPoint {
  return primitive(render, `primitive_${entityId}_label`).points[0]!;
}

const twoPlanes = spaceDocument("planes x + 2y - z = 4 and 2x - y + z = 3 meet in a line through M", [
  part("p1", "polygon", "plane", { a: 1, b: 2, c: -1, d: 4 }, "Π₁"),
  part("p2", "polygon", "plane", { a: 2, b: -1, c: 1, d: 3 }, "Π₂"),
  [entity("m", "line", "m"), make("space_intersection", { frame: "frame", first: "p1", second: "p2", tMin: -2, tMax: 2 }, ["m"])],
  sp("M", v3(2, 1, 0), "M"),
]);
gate("G17 two planes hold a common stretch of their line, drawn inside the figure", () => {
  const render = rendered(twoPlanes);
  const line = primitive(render, "primitive_m").points;
  const ends = [line[0]!, line.at(-1)!];
  // Lines are clipped 24 px inside the zone; an end there was cut by the view.
  if (ends.some((end) => !inZone(end, 25))) return `line ends ${ends.map((end) => `(${end.x}, ${end.y})`).join(" ")} reach the view edge`;
  for (const id of ["p1", "p2"]) {
    const margins = ends.map((end) => insideMargin(end, polygon(render, id)));
    if (margins.some((margin) => margin < 1)) return `${id} holds the line ends by ${margins.map((margin) => margin.toFixed(1)).join(", ")} px`;
  }
  return null;
});

gate("G18 a patch around a meeting point does not grow to unmarked intercepts", () => {
  const render = rendered(meetingDocument);
  const ring = polygon(render, "plane");
  const canvas = worldToCanvas(render, meetingDocument);
  const held = [v3(6, 0, 0), v3(0, -3, 0), v3(0, 0, 3)].filter((intercept) => insideMargin(canvas(intercept), ring) > 0);
  return held.length === 0 ? null : `the patch holds ${held.length} unmarked intercept(s)`;
});

gate("G19 line and plane labels sit on their drawn elements inside the view", () => {
  const render = rendered(meetingDocument);
  const line = primitive(render, "primitive_L").points;
  const lineLabel = labelCentre(render, "L");
  const toLine = segmentDistance(lineLabel, line[0]!, line.at(-1)!);
  if (toLine > 48) return `L's label is ${toLine.toFixed(1)} px from its line`;
  const planeLabel = labelCentre(render, "plane");
  const toPlane = insideMargin(planeLabel, polygon(render, "plane"));
  if (toPlane < -24) return `the plane's label is ${(-toPlane).toFixed(1)} px outside the plane`;
  const outside = render.primitives.filter((item) => item.kind === "label" && !inZone(item.points[0]!)).map((item) => item.id);
  return outside.length === 0 ? null : `labels outside the zone: ${outside.join(", ")}`;
});

const footInTriangle = spaceDocument("foot N of the perpendicular from O to 2x + y + 2z = 2", [
  sp("O", v3(0, 0, 0), "O"),
  part("plane", "polygon", "plane", { a: 2, b: 1, c: 2, d: 2 }, "Π"),
  [entity("N", "point", "N"), make("space_project", { frame: "frame", point: "O", onto: "plane" }, ["N"])],
  part("ON", "segment", "space_segment", { a: "O", b: "N" }, "p"),
  part("k", "line", "space_line", { point: "N", direction: [1, -2, 0], tMin: -0.5, tMax: 0.5 }),
  part("right", "right_angle_mark", "space_right_angle_mark", { vertex: "N", a: "ON", b: "k" }),
]);
gate("G20 a point drawn inside an intercept triangle keeps room for its name", () => {
  const render = rendered(footInTriangle);
  const ring = polygon(render, "plane");
  // O at the axes' meeting point is either clear of the triangle or well inside it.
  const margin = insideMargin(pointCanvas(render, "O"), ring);
  return margin < 0 || margin >= 30 ? null : `O is ${margin.toFixed(1)} px inside the triangle's edges`;
});

const facingPlane = spaceDocument("the plane x = 1", [part("plane", "polygon", "plane", { a: 1, b: 0, c: 0, d: 1 }, "Π")]);
gate("G21 a plane seen face on is drawn as a plane, not a box", () => {
  const kind = primitive(rendered(facingPlane), "primitive_plane").kind;
  return kind === "polygon" ? null : `plane primitive is a ${kind}`;
});

// ---------- Fix pass 2: G22 to G25, names at their real size ----------
const coordinateText = (p: V3): string => `(${[p.x, p.y, p.z].map((value) => String(Math.round(value * 100) / 100)).join(",")})`;
/** A line through P along d meets n·r = k at I, named by its coordinates, with the angle marked there. */
function meetingLookAlike(P: V3, d: V3, n: V3, k: number): { document: SceneDocument; I: V3 } {
  const t = (k - (n.x * P.x + n.y * P.y + n.z * P.z)) / (n.x * d.x + n.y * d.y + n.z * d.z);
  const I = v3(P.x + t * d.x, P.y + t * d.y, P.z + t * d.z);
  const document = spaceDocument(`line through P along d meets the plane at ${coordinateText(I)}`, [
    sp("P", P, `P${coordinateText(P)}`),
    part("plane", "polygon", "plane", { a: n.x, b: n.y, c: n.z, d: k }, "Π"),
    part("L", "line", "space_line", { point: "P", direction: [d.x, d.y, d.z], tMin: -0.4, tMax: 1.5 }, "ℓ"),
    part("I", "point", "space_intersection", { first: "L", second: "plane" }, "I"),
    part("theta", "angle_mark", "space_angle_mark", { vertex: "I", a: "L", b: "plane" }, "θ"),
  ], { axisLength: 3 });
  document.annotations = [{ id: "meeting_value", kind: "callout", targetIds: ["I"], text: coordinateText(I) }];
  return { document, I };
}
/** The centroid G of the triangle cut from the axes, named with its coordinates; the plane by coefficients or through A. */
function centroidLookAlike(G: V3, form: "coefficients" | "basis"): SceneDocument {
  const [a, b, c] = [3 * G.x, 3 * G.y, 3 * G.z];
  const plane: Part = form === "coefficients"
    ? part("plane", "polygon", "plane", { a: b * c, b: a * c, c: a * b, d: a * b * c })
    : part("plane", "polygon", "plane", { point: "A", u: [-a, b, 0], v: [-a, 0, c] });
  return spaceDocument(`centroid ${coordinateText(G)} of the triangle the plane cuts from the axes`, [
    sp("G", G, `G${coordinateText(G)}`), sp("A", v3(a, 0, 0), "A"), sp("B", v3(0, b, 0), "B"), sp("C", v3(0, 0, c), "C"), plane,
  ]);
}
function namesPlaced(render: RenderScene, labelIds: string[]): string | null {
  const missing = labelIds.filter((id) => !render.primitives.some((item) => item.kind === "label" && item.id === id));
  return missing.length ? `no label ${missing.join(", ")}` : null;
}

gate("G22 a meeting point named by its coordinates has room in its plane", () => {
  for (const [P, d, n, k] of [
    [v3(0, 2, -1), v3(3, 1, -1), v3(3, 1, 1), 4],
    [v3(-1, 1, 3), v3(1, -2, 2), v3(3, 1, 1), 4],
    [v3(0, 2, -1), v3(1, 1, 1), v3(1, 2, -2), 3],
  ] as Array<[V3, V3, V3, number]>) {
    const { document, I } = meetingLookAlike(P, d, n, k);
    const result = compile(document);
    if (!result.render) return `meeting at ${coordinateText(I)} does not compile: ${result.issues}`;
    const missing = namesPlaced(result.render, ["meeting_value"]);
    if (missing) return `meeting at ${coordinateText(I)}: ${missing}`;
    // The name sits beside its point: within its tether plus half its own width.
    const gap = len2(sub2(primitive(result.render, "meeting_value").points[0]!, pointCanvas(result.render, "I")));
    if (gap > 130) return `meeting at ${coordinateText(I)}: name ${gap.toFixed(1)} px from the point`;
  }
  if (spaceView) {
    // Names size the view, so the plan memo must not outlive an in-place edit of a name.
    const edited = meetingLookAlike(v3(0, 2, -1), v3(3, 1, -1), v3(3, 1, 1), 4).document;
    const before = spaceView.planSpaceView(edited)?.report.candidate;
    edited.annotations = [];
    const after = spaceView.planSpaceView(edited)?.report.candidate;
    if (before === after) return `dropping the coordinate name kept the view ${before}`;
  }
  return null;
});

gate("G23 a centroid named by its coordinates has room inside the intercept triangle", () => {
  for (const [G, form] of [[v3(1, -2, 3), "coefficients"], [v3(-1, 1, 2), "basis"], [v3(2, -2, 4), "basis"], [v3(1, 1, -1), "coefficients"]] as Array<[V3, "coefficients" | "basis"]>) {
    const result = compile(centroidLookAlike(G, form));
    if (!result.render) return `centroid ${coordinateText(G)} (${form}) does not compile: ${result.issues}`;
    const missing = namesPlaced(result.render, ["primitive_G_label", "primitive_A_label", "primitive_B_label", "primitive_C_label"]);
    if (missing) return `centroid ${coordinateText(G)}: ${missing}`;
  }
  return null;
});

gate("G24 fix pass 1 look-alike: a named centroid keeps room once triangles are drawn", () => {
  for (const [G, form] of [[v3(1, 1, 3), "basis"], [v3(3, -1, 4), "coefficients"], [v3(-1, 2, 1), "coefficients"]] as Array<[V3, "coefficients" | "basis"]>) {
    const result = compile(centroidLookAlike(G, form));
    if (!result.render) return `centroid ${coordinateText(G)} (${form}) does not compile: ${result.issues}`;
  }
  return null;
});

const cornerNames = spaceDocument("the plane cutting the axes at (p,0,0), (0,q,0), (0,0,r)", [
  part("plane", "polygon", "plane", { a: 2, b: -2, c: -1, d: -2 }),
  sp("X", v3(-1, 0, 0), "(p,0,0)"), sp("Y", v3(0, 1, 0), "(0,q,0)"), sp("Z", v3(0, 0, 2), "(0,0,r)"),
]);
gate("G25 points named at the corners of an intercept triangle keep room for their names", () => {
  const result = compile(cornerNames);
  if (!result.render) return `does not compile: ${result.issues}`;
  return namesPlaced(result.render, ["primitive_X_label", "primitive_Y_label", "primitive_Z_label"]);
});

// ---------- G15: byte identity of every document without a space_frame ----------
interface IdentityFixture { schema: "space-view-byte-identity/v1"; baseCommit: string; documents: Record<string, unknown>; hashes: Record<string, string> }

function hasSpaceFrame(document: unknown): boolean {
  const constructions = (document as { constructions?: unknown }).constructions;
  return Array.isArray(constructions) && constructions.some((construction) => (construction as { operator?: unknown })?.operator === "space_frame");
}
function sceneDocumentsIn(value: unknown, path: string, out: Map<string, unknown>): void {
  if (Array.isArray(value)) { value.forEach((item, index) => sceneDocumentsIn(item, `${path}[${index}]`, out)); return; }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion === "scene-document/v2" && Array.isArray(record.constructions)) { out.set(path, record); return; }
  for (const [key, child] of Object.entries(record)) sceneDocumentsIn(child, `${path}.${key}`, out);
}
function jsonFiles(dir: string): string[] {
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? jsonFiles(path) : path.endsWith(".json") ? [path] : [];
  });
}
/** Synthetic solids in the mensuration family's own phrasing; none is a held-out question. */
const POLYHEDRAL_STEMS = [
  "A cube has edge 7 cm. Find its total surface area.",
  "A cuboid has length 9 cm, width 4 cm and height 2 cm. Find its volume.",
  "A square pyramid has base side 8 cm and height 3 cm. Find its volume.",
  "A regular pentagonal prism has base side 3 cm and height 7 cm. Find its volume.",
  "A right triangular prism has base 5 cm, base height 12 cm and length 9 cm. Find its volume.",
  "A regular hexagonal pyramid has base side 2 cm and height 6 cm. Find its volume.",
];
function collectIdentityDocuments(): Map<string, unknown> {
  const documents = new Map<string, unknown>();
  for (const file of [...jsonFiles(join(packageRoot, "fixtures/golden")), ...jsonFiles(join(packageRoot, "fixtures/regression")), ...jsonFiles(join(packageRoot, "fixtures/evaluation"))]) {
    sceneDocumentsIn(JSON.parse(readFileSync(file, "utf8")), relative(packageRoot, file), documents);
  }
  for (const [id, document] of Object.entries(EVALUATION_COMPILE_PROBES)) documents.set(`probe:${id}`, document);
  for (const [id, document] of Object.entries(PHYSICS_EVALUATION_COMPILE_PROBES)) documents.set(`physics-probe:${id}`, document);
  for (const stem of POLYHEDRAL_STEMS) {
    const synthesized = synthesizeFamilyScene({ question: stem, problemIR: { entities: [{ id: "body", kind: "solid" }] } });
    if (!synthesized?.document.constructions.some((construction) => construction.operator === "solid_projection" && construction.inputs.kind === "polyhedron")) {
      throw new Error(`no polyhedral solid for "${stem}"`);
    }
    documents.set(`polyhedral:${stem}`, synthesized.document);
  }
  for (const id of [...documents.keys()]) if (hasSpaceFrame(documents.get(id))) documents.delete(id);
  return documents;
}
function renderHash(document: unknown): string {
  const validated = validateSceneDocument(structuredClone(document));
  const compiled = validated.document ? compileSceneDocument(validated.document) : null;
  return createHash("sha256").update(JSON.stringify(compiled?.renderScene ?? null)).digest("hex");
}

if (process.argv.includes("--record-byte-identity")) {
  const documents = collectIdentityDocuments();
  const baseCommit = process.argv[process.argv.indexOf("--record-byte-identity") + 1] ?? "unknown";
  const fixture: IdentityFixture = { schema: "space-view-byte-identity/v1", baseCommit, documents: {}, hashes: {} };
  for (const [id, document] of documents) { fixture.documents[id] = document; fixture.hashes[id] = renderHash(document); }
  writeFileSync(identityFixture, `${JSON.stringify(fixture)}\n`);
  console.log(`recorded ${documents.size} byte identity hashes at ${baseCommit}`);
  process.exit(0);
}

gate("G26 a near-horizontal tilted plane is drawn in its own surface", () => {
  if (!spaceView) return "planSpaceView absent";
  // 0.1x + z = 0 has |n̂_z| about 0.995; world x and y are not in it.
  const document = spaceDocument("a slightly tilted plane", [part("plane", "polygon", "plane", { a: 0.1, b: 0, c: 1, d: 0 }), sp("P", v3(10, 0, -1), "P")]);
  const drawing = spaceView.planSpaceView(document)?.planes.get("plane");
  if (!drawing) return "no plane drawing";
  const corners = drawing.kind === "triangle"
    ? drawing.vertices
    : planePatchCorners(drawing.center, drawing.u, drawing.v, drawing.uSpan, drawing.vSpan);
  const worst = Math.max(...corners.map((corner) => Math.abs(0.1 * corner.x + corner.z)));
  return worst > 1e-9 ? `a drawn corner is ${worst.toFixed(3)} off the plane 0.1x + z = 0` : null;
});

gate("G27 a line reaches a computed vector tip that lies on it", () => {
  // Planes x = 0 and z = 0 meet along the y axis; 5·(e_x × e_z) from O ends at (0, -5, 0) on that line.
  const document = spaceDocument("a cross product tip on a line of intersection", [
    part("p1", "polygon", "plane", { a: 1, b: 0, c: 0, d: 0 }),
    part("p2", "polygon", "plane", { a: 0, b: 0, c: 1, d: 0 }),
    part("L", "line", "space_intersection", { first: "p1", second: "p2", tMin: -1, tMax: 1 }, "L"),
    sp("O", v3(0, 0, 0), "O"), sp("A", v3(1, 0, 0)), sp("C", v3(0, 0, 1)),
    part("a", "vector", "space_vector", { start: "O", end: "A" }),
    part("c", "vector", "space_vector", { start: "O", end: "C" }),
    part("w", "vector", "space_cross", { a: "a", b: "c", scale: 5 }, "w"),
  ], { axisLength: 2 });
  const render = rendered(document);
  const tip = worldToCanvas(render, document)(v3(0, -5, 0));
  const line = primitive(render, "primitive_L").points;
  const gap = Math.min(...line.slice(1).map((point, index) => segmentDistance(tip, line[index]!, point)));
  return gap > 2 ? `the cross product tip is ${gap.toFixed(1)} px from the drawn line` : null;
});

gate("G28 a document cannot supply its own plane drawing", () => {
  // Both forged drawings are off their plane, and the plan skips both planes (a 2e9 span; u and v
  // nearly parallel), so before the fix the forged ink reached the board.
  const forged: Array<[string, Record<string, unknown>]> = [
    ["patch", { a: 1, b: 1, c: 1, d: 1, span: 2e9, __spaceView: { kind: "patch", center: v3(0, 0, 5), u: v3(1, 0, 0), v: v3(0, 1, 0), uSpan: 2, vSpan: 2 } }],
    ["triangle", { point: [0, 0, 0], u: [1, 0, 0], v: [1, 1e-7, 0], __spaceView: { kind: "triangle", vertices: [v3(0, 0, 0.2), v3(1, 0, 0.2), v3(0, 1, 0.2)] } }],
  ];
  for (const [name, inputs] of forged) {
    const { __spaceView: _drop, ...honest } = inputs;
    const withKey = compile(spaceDocument(`forged ${name}`, [part("plane", "polygon", "plane", inputs)]));
    const without = compile(spaceDocument(`forged ${name}`, [part("plane", "polygon", "plane", honest)]));
    if (!withKey.render || !without.render) return `the ${name} documents do not compile: ${withKey.issues || without.issues}`;
    if (JSON.stringify(withKey.render) !== JSON.stringify(without.render)) return `the forged ${name} changed the drawing`;
  }
  return null;
});

gate("G29 a document cannot supply its own parallel lane", () => {
  const fixture = JSON.parse(readFileSync(identityFixture, "utf8")) as IdentityFixture;
  const circuit = Object.values(fixture.documents).find((document) =>
    JSON.stringify(document).includes('"operator":"symbol"')) as SceneDocument | undefined;
  if (!circuit) return "no frozen document with a symbol";
  const forged = structuredClone(circuit);
  const symbol = forged.constructions.find((construction) => construction.operator === "symbol");
  if (!symbol) return "no symbol construction";
  symbol.inputs = { ...symbol.inputs, __parallelLane: 3 };
  return renderHash(forged) === renderHash(circuit) ? null : "a forged __parallelLane moved the symbol";
});

gate("G30 a required space line stays on the board when its stretch misses the view", () => {
  // Greptile's example: a line through (0, 0, 10) along z with t from -1 to 1 holds no marked point.
  // Unlabelled, it compiled with the line off the board; labelled, its name had no slot and the figure failed.
  for (const label of [undefined, "L"]) {
    const document = spaceDocument("a line far up the z axis", [part("L", "line", "space_line", { point: [0, 0, 10], direction: [0, 0, 1], tMin: -1, tMax: 1 }, label)]);
    const line = primitive(rendered(document), "primitive_L").points;
    if (line.length < 2) return "the line has no ink";
    const off = line.filter((point) => !inZone(point, -1));
    if (off.length) return `the ${label ? "labelled" : "unlabelled"} line is drawn off the board at ${off.map((point) => `(${point.x.toFixed(0)}, ${point.y.toFixed(0)})`).join(" ")}`;
  }
  return null;
});

gate("G31 a computed vector tip is not drawn on an unrelated marked point", () => {
  // Greptile's example: e_x × e_y from O ends at (0, 0, 1); the default view drew Q = (1, 0.35, 1.35) under a pixel away.
  const document = spaceDocument("a cross product tip beside a marked point", [
    sp("O", v3(0, 0, 0), "O"), sp("A", v3(1, 0, 0), "A"), sp("B", v3(0, 1, 0), "B"), sp("Q", v3(1, 0.35, 1.35), "Q"),
    part("a", "vector", "space_vector", { start: "O", end: "A" }),
    part("b", "vector", "space_vector", { start: "O", end: "B" }),
    part("w", "vector", "space_cross", { a: "a", b: "b" }, "w"),
  ]);
  const render = rendered(document);
  const tip = worldToCanvas(render, document)(v3(0, 0, 1));
  const gap = len2(sub2(tip, pointCanvas(render, "Q")));
  return gap < 12 ? `the cross product tip is drawn ${gap.toFixed(1)} px from Q` : null;
});

// Hashes re-pinned on purpose since the base commit, each after a before and
// after render was compared:
//   physics-probe:modern-easy-photoelectric (label owner placement, Oct 2026):
//   "Ef" sat 17 px from the energy axis but 22 px from its own Fermi line,
//   straight under the photon arrow's tip; it now sits under the Fermi line,
//   off the arrow, nearer its line than the axis.
// Eight from 32e3bafc0 (v3 directed lanes and point names, PR #249), against
// main's render of the same document. Its five other re-pins
// (mechanics-easy-incline-force, mechanics-hard-pulley-incline,
// electrostatics-easy-null-point, emi-medium-moving-rod, ac-hard-series-lcr)
// are back on main's hashes: 125c22b82 pinned vectors at junctions, so those
// render byte identical to main again.
//   fixtures/golden/optics-concave-mirror-u20-f15.json.sceneDocument: pole
//   name "P" moves from the upper right to the upper left of its point (51 px).
//   probe:coordinate-right-triangle: vertex name "A" moves from above to below
//   its corner point (60 px).
//   physics-probe:fluids-medium-venturi: the flow arrow lay on the pipe axis
//   line; it runs in a 12 px lane beside it, and its "v" label follows.
//   physics-probe:thermal-hard-pv-cycle: the cycle sense arrow lay on a cycle
//   edge; it runs in a 12 px lane, and "A" moves to the side away from it.
//   physics-probe:current-medium-series-parallel-source: the total current
//   arrow lay on the source wire; it runs in a 30 px lane, "I" follows it.
//   physics-probe:magnetism-easy-straight-wire: the current arrow lay on the
//   wire and was not drawn at all; it is now drawn in a 12 px lane beside it.
//   physics-probe:optics-easy-plane-mirror: the reflected ray lay on the
//   incident ray; it runs in a 12 px lane, the helper dot that sat on its
//   shaft is gone, and the object name "O" moves 65 px off the rays.
//   physics-probe:optics-medium-concave-mirror: pole name "P", as the golden
//   concave mirror above.
gate("G15 byte identity of documents without a space_frame", () => {
  const fixture = JSON.parse(readFileSync(identityFixture, "utf8")) as IdentityFixture;
  const ids = Object.keys(fixture.hashes);
  if (ids.length < 30) return `only ${ids.length} frozen documents`;
  const polyhedral = ids.filter((id) => id.startsWith("polyhedral:"));
  if (polyhedral.length !== POLYHEDRAL_STEMS.length) return `expected ${POLYHEDRAL_STEMS.length} polyhedral solids, found ${polyhedral.length}`;
  const changed = ids.filter((id) => hasSpaceFrame(fixture.documents[id]) || renderHash(fixture.documents[id]) !== fixture.hashes[id]);
  return changed.length ? `${changed.length} of ${ids.length} renders changed: ${changed.slice(0, 6).join(", ")}` : null;
});

for (const line of results) console.log(line);
if (failures > 0) {
  console.error(`verify-space-view: ${failures} gate(s) failed`);
  process.exit(1);
}
console.log(`verify-space-view: ${results.length} gates passed`);
