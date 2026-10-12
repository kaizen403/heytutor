/**
 * Light stops at the optical elements it meets (Harness 4).
 *
 * A light path's drawn extent came from a construction span or the view
 * edge, and nothing asked whether it crossed a declared surface, lens or
 * closed region on the way. Round 7 drew a prism's inside ray straight on
 * through the second face, refracted rays leaving a sphere through its far
 * side unbent, and rays running through a convex mirror. One prism put the
 * incident ray's source on the glass side, so the ray crossed the other face
 * before it reached its contact.
 *
 * Each case below is a small scene built from one of those recorded figures.
 * Outgoing paths must be cut at the element they cross; an incident path that
 * crosses an element before its contact must stop the figure with
 * `incident_path_crosses_element`. Correct paths (a prism at minimum
 * deviation, a ray through a thin lens centre, a reflection that stops at the
 * mirror) must render exactly as they did.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-ray-optics-paths.ts
 */
import { compileSceneDocument, validateSceneDocument } from "../../src";

type P = { x: number; y: number };
type Primitive = { id: string; entityId?: string; kind: string; points: P[]; radius?: number; startAngle?: number; endAngle?: number; text?: string };
type Entity = { id: string; kind: string; role: string; label?: string };
type Construction = { id: string; operator: string; inputs: Record<string, unknown>; outputs: string[] };

const DEG = Math.PI / 180;
const failures: string[] = [];
let passed = 0;

function scene(question: string, entities: Entity[], constructions: Construction[]) {
  const ids = entities.map((entity) => entity.id);
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: question },
    source: { question },
    quantities: [],
    entities,
    constructions,
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids }],
    teachingTimeline: [{ action: "reveal", targetId: "setup" }],
  };
}

const point = (id: string, x: number, y: number): Construction =>
  ({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] });

function compile(document: ReturnType<typeof scene>) {
  const validated = validateSceneDocument(document);
  const compiled = validated.document ? compileSceneDocument(validated.document) : null;
  const fatal = (compiled?.report ?? validated.report).issues.filter((issue) => issue.severity === "fatal");
  return { ok: Boolean(compiled?.ok && compiled.renderScene), primitives: (compiled?.renderScene?.primitives ?? []) as Primitive[], fatal };
}

function stroke(primitives: Primitive[], id: string): Primitive {
  const found = primitives.find((primitive) => primitive.id === `primitive_${id}`);
  if (!found) throw new Error(`no primitive for ${id}`);
  return found;
}

function labelOf(primitives: Primitive[], id: string): P | undefined {
  return primitives.find((primitive) => primitive.id === `primitive_${id}_label`)?.points[0];
}

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
function segmentDistance(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function insidePolygon(p: P, polygon: P[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
const length = (primitive: Primitive) => dist(primitive.points[0]!, primitive.points.at(-1)!);

function check(name: string, run: () => string | null): void {
  let problem: string | null;
  try { problem = run(); } catch (error) { problem = `threw: ${error instanceof Error ? error.message : String(error)}`; }
  if (problem) { failures.push(`${name}: ${problem}`); console.log(`FAIL ${name}: ${problem}`); }
  else { passed += 1; console.log(`pass ${name}`); }
}

// Recorded m2 prism minimum deviation: refract_at's inside ray (span 2) ran on past the second face.
const prismSecondFace = () => {
  const half = 1.0190508989888576;
  return scene("Prism: the refracted ray inside the glass meets the second face.", [
    { id: "P", kind: "point", role: "apex", label: "A" },
    { id: "L", kind: "point", role: "base corner" },
    { id: "R", kind: "point", role: "base corner" },
    { id: "prism", kind: "polygon", role: "prism section" },
    { id: "leftFace", kind: "segment", role: "first face" },
    { id: "rightFace", kind: "segment", role: "second face" },
    { id: "contact", kind: "point", role: "point of incidence" },
    { id: "incoming", kind: "ray", role: "incident ray" },
    { id: "normal", kind: "vector", role: "normal" },
    { id: "insideRay", kind: "ray", role: "refracted ray in the glass", label: "r" },
  ], [
    point("P", 0, 2), point("L", -half, 0), point("R", half, 0),
    { id: "make_prism", operator: "polygon", inputs: { points: ["L", "P", "R"] }, outputs: ["prism"] },
    { id: "make_left", operator: "segment", inputs: { start: "L", end: "P" }, outputs: ["leftFace"] },
    { id: "make_right", operator: "segment", inputs: { start: "P", end: "R" }, outputs: ["rightFace"] },
    point("contact", -half / 2, 1),
    { id: "entry", operator: "refract_at", inputs: { point: "contact", surface: "leftFace", incidentAngleDeg: 46.2, n1: 1, n2: 1.59, tangentSign: 1 }, outputs: ["incoming", "normal", "insideRay"] },
  ]);
};

check("prism inside ray is cut at the second face", () => {
  const { ok, primitives, fatal } = compile(prismSecondFace());
  if (!ok) return `did not compile: ${JSON.stringify(fatal)}`;
  const ray = stroke(primitives, "insideRay");
  const face = stroke(primitives, "rightFace");
  const end = ray.points.at(-1)!;
  const gap = segmentDistance(end, face.points[0]!, face.points.at(-1)!);
  if (gap > 1.5) return `inside ray ends ${gap.toFixed(1)} px off the second face`;
  const label = labelOf(primitives, "insideRay");
  if (!label) return "inside ray lost its label";
  if (segmentDistance(label, ray.points[0]!, end) > 45) return `inside ray label sits ${segmentDistance(label, ray.points[0]!, end).toFixed(1)} px from the cut ray`;
  return null;
});

// Recorded m1 sphere h8u: refract_direction rays (kind ray) ran out through the far side.
const sphereFarSide = () => scene("A point object in air; rays refract into a glass sphere.", [
  { id: "center", kind: "point", role: "centre of curvature" },
  { id: "boundary", kind: "circle", role: "glass sphere" },
  { id: "object", kind: "point", role: "object", label: "O" },
  { id: "contact1", kind: "point", role: "point of incidence" },
  { id: "incoming1", kind: "vector", role: "incident ray" },
  { id: "normal1", kind: "segment", role: "normal" },
  { id: "outgoing1", kind: "ray", role: "refracted ray", label: "glass" },
], [
  point("center", 2, 0),
  { id: "make_boundary", operator: "circle", inputs: { center: "center", radius: 2 }, outputs: ["boundary"] },
  point("object", -4, 1),
  { id: "contact", operator: "surface_contact", inputs: { origin: "object", surface: "boundary", direction: [1, -0.1] }, outputs: ["contact1", "incoming1"] },
  { id: "normal", operator: "normal_at", inputs: { point: "contact1", surface: "boundary" }, outputs: ["normal1"] },
  { id: "refraction", operator: "refract_direction", inputs: { origin: "contact1", incoming: "incoming1", normal: "normal1", n1: 1, n2: 1.5 }, outputs: ["outgoing1"] },
]);

check("ray refracted into a sphere is cut at its far side", () => {
  const { ok, primitives, fatal } = compile(sphereFarSide());
  if (!ok) return `did not compile: ${JSON.stringify(fatal)}`;
  const ray = stroke(primitives, "outgoing1");
  const circle = stroke(primitives, "boundary");
  const center = circle.points[0]!;
  const end = ray.points.at(-1)!;
  const gap = Math.abs(dist(end, center) - circle.radius!);
  if (gap > 1.5 || length(ray) < 20) return `refracted ray ends ${gap.toFixed(1)} px off the sphere (length ${length(ray).toFixed(0)} px)`;
  const label = labelOf(primitives, "outgoing1");
  if (!label) return "refracted ray lost its label";
  if (dist(label, center) > circle.radius!) return "the refracted ray's label sits outside the glass";
  return null;
});

// Recorded m2 convex mirror parallax: a free `ray` from the lens to I passed through the mirror.
const mirrorPassThrough = () => scene("Rays converge toward the centre of a convex mirror.", [
  { id: "axis_origin", kind: "point", role: "axis start" },
  { id: "axis", kind: "line", role: "principal axis" },
  { id: "P", kind: "point", role: "pole", label: "P" },
  { id: "I", kind: "point", role: "centre of curvature", label: "I" },
  { id: "upper", kind: "point", role: "lens point" },
  { id: "mirror", kind: "arc", role: "convex mirror" },
  { id: "ray_upper", kind: "ray", role: "ray toward I" },
], [
  point("axis_origin", -4, 0),
  { id: "make_axis", operator: "line", inputs: { start: "axis_origin", direction: [1, 0] }, outputs: ["axis"] },
  point("P", 2, 0), point("I", 4, 0), point("upper", 0, 0.6),
  { id: "make_mirror", operator: "spherical_surface", inputs: { vertex: "P", axis: "axis", center: "I", signedRadius: 2, halfHeight: 0.8, kind: "convex" }, outputs: ["mirror"] },
  { id: "make_ray", operator: "ray", inputs: { start: "upper", end: "I" }, outputs: ["ray_upper"] },
]);

check("ray toward a convex mirror's centre is cut at the mirror", () => {
  const { ok, primitives, fatal } = compile(mirrorPassThrough());
  if (!ok) return `did not compile: ${JSON.stringify(fatal)}`;
  const ray = stroke(primitives, "ray_upper");
  const mirror = stroke(primitives, "mirror");
  const end = ray.points.at(-1)!;
  const gap = Math.abs(dist(end, mirror.points[0]!) - mirror.radius!);
  if (gap > 1.5) return `ray ends ${gap.toFixed(1)} px off the mirror`;
  const centre = stroke(primitives, "I").points[0]!;
  if (dist(end, centre) < mirror.radius! - 1.5) return "ray still reaches past the mirror";
  return null;
});

// Recorded m1 prism minimum deviation: refract_at put the source on the glass side,
// so the "incident" ray crossed the other face before it reached its contact.
const incidentThroughGlass = () => scene("Prism: a ray enters the first face.", [
  { id: "apex", kind: "point", role: "apex", label: "A" },
  { id: "left", kind: "point", role: "base corner" },
  { id: "right", kind: "point", role: "base corner" },
  { id: "prism", kind: "polygon", role: "prism section" },
  { id: "face", kind: "segment", role: "first face" },
  { id: "otherFace", kind: "segment", role: "second face" },
  { id: "contact", kind: "point", role: "point of incidence" },
  { id: "incoming", kind: "ray", role: "incident ray" },
  { id: "normal", kind: "vector", role: "normal" },
  { id: "inside", kind: "ray", role: "refracted ray" },
], [
  point("apex", 0, 0), point("left", 1, 0), point("right", Math.cos(54 * DEG), Math.sin(54 * DEG)),
  { id: "make_prism", operator: "polygon", inputs: { points: ["apex", "left", "right"] }, outputs: ["prism"] },
  { id: "make_face", operator: "segment", inputs: { start: "apex", end: "left" }, outputs: ["face"] },
  { id: "make_other", operator: "segment", inputs: { start: "apex", end: "right" }, outputs: ["otherFace"] },
  point("contact", 0.5, 0),
  { id: "entry", operator: "refract_at", inputs: { point: "contact", surface: "face", incidentAngleDeg: 46.2, n1: 1, n2: 1.59 }, outputs: ["incoming", "normal", "inside"] },
]);

check("incident ray crossing the glass before its contact is refused", () => {
  const { ok, fatal } = compile(incidentThroughGlass());
  if (ok) return "compiled; the incident ray crosses the second face before it reaches the first";
  if (!fatal.some((issue) => issue.code === "incident_path_crosses_element")) return `refused for another reason: ${JSON.stringify(fatal.map((issue) => issue.code))}`;
  return null;
});

// Negative control: an equilateral prism at minimum deviation (n = 1.5, i = 48.59 degrees).
const correctPrism = () => {
  const h = Math.sqrt(3);
  return scene("Equilateral prism at minimum deviation.", [
    { id: "L", kind: "point", role: "base corner" },
    { id: "P", kind: "point", role: "apex", label: "A" },
    { id: "R", kind: "point", role: "base corner" },
    { id: "prism", kind: "polygon", role: "prism section" },
    { id: "face1", kind: "segment", role: "first face" },
    { id: "face2", kind: "segment", role: "second face" },
    { id: "c1", kind: "point", role: "entry point" },
    { id: "c2", kind: "point", role: "exit point" },
    { id: "incident", kind: "ray", role: "incident ray" },
    { id: "normal1", kind: "segment", role: "normal at entry" },
    { id: "inside", kind: "ray", role: "ray in the glass" },
    { id: "normal2", kind: "segment", role: "normal at exit" },
    { id: "emergent", kind: "ray", role: "emergent ray" },
  ], [
    point("L", -1, 0), point("P", 0, h), point("R", 1, 0),
    { id: "make_prism", operator: "polygon", inputs: { points: ["L", "P", "R"] }, outputs: ["prism"] },
    { id: "make_face1", operator: "segment", inputs: { start: "L", end: "P" }, outputs: ["face1"] },
    { id: "make_face2", operator: "segment", inputs: { start: "R", end: "P" }, outputs: ["face2"] },
    point("c1", -0.5, h / 2), point("c2", 0.5, h / 2),
    { id: "entry", operator: "refract_at", inputs: { point: "c1", surface: "face1", incidentAngleDeg: Math.asin(0.75) / DEG, n1: 1, n2: 1.5, tangentSign: 1 }, outputs: ["incident", "normal1", "inside"] },
    { id: "exit", operator: "refract_at", inputs: { point: "c2", surface: "face2", incidentAngleDeg: 30, n1: 1.5, n2: 1, tangentSign: -1 }, outputs: ["inside", "normal2", "emergent"] },
  ]);
};

check("control: a correct prism path is unchanged", () => {
  const { ok, primitives, fatal } = compile(correctPrism());
  if (!ok) return `did not compile: ${JSON.stringify(fatal)}`;
  const inside = stroke(primitives, "inside");
  // The contacts are the face midpoints.
  const midpoint = (id: string) => { const face = stroke(primitives, id); return { x: (face.points[0]!.x + face.points.at(-1)!.x) / 2, y: (face.points[0]!.y + face.points.at(-1)!.y) / 2 }; };
  const [c1, c2] = [midpoint("face1"), midpoint("face2")];
  if (dist(inside.points[0]!, c1) > 0.5 || dist(inside.points.at(-1)!, c2) > 0.5) return "inside ray no longer runs between the two contacts";
  const incident = stroke(primitives, "incident");
  const emergent = stroke(primitives, "emergent");
  if (Math.abs(length(incident) - length(emergent)) > 1) return `emergent ray drawn ${length(emergent).toFixed(1)} px against the incident ${length(incident).toFixed(1)} px of the same span`;
  if (Math.abs(emergent.points.at(-1)!.y - emergent.points[0]!.y) < 1) return "emergent ray lost its deviation";
  return null;
});

// Negative control: a ray from an object tip through a thin lens centre passes straight through.
const thinLensCentre = () => scene("A ray through the optical centre of a thin convex lens.", [
  { id: "axis_origin", kind: "point", role: "axis start" },
  { id: "axis", kind: "line", role: "principal axis" },
  { id: "O", kind: "point", role: "optical centre", label: "O" },
  { id: "lens", kind: "polygon", role: "convex lens" },
  { id: "tip", kind: "point", role: "object tip", label: "B" },
  { id: "centralRay", kind: "ray", role: "ray through the optical centre" },
], [
  point("axis_origin", -5, 0),
  { id: "make_axis", operator: "line", inputs: { start: "axis_origin", direction: [1, 0] }, outputs: ["axis"] },
  point("O", 0, 0),
  { id: "make_lens", operator: "lens_section", inputs: { center: "O", axis: "axis", radius1: 5, radius2: -5, halfHeight: 1.2 }, outputs: ["lens"] },
  point("tip", -3, 1),
  { id: "make_ray", operator: "ray", inputs: { start: "tip", end: "O" }, outputs: ["centralRay"] },
]);

check("control: a ray through a thin lens centre is unchanged", () => {
  const { ok, primitives, fatal } = compile(thinLensCentre());
  if (!ok) return `did not compile: ${JSON.stringify(fatal)}`;
  const ray = stroke(primitives, "centralRay");
  const lens = stroke(primitives, "lens");
  const centre = stroke(primitives, "O").points[0]!;
  const [start, end] = [ray.points[0]!, ray.points.at(-1)!];
  if ((end.x - start.x) * (centre.x - start.x) + (end.y - start.y) * (centre.y - start.y) <= dist(centre, start) ** 2) return "ray stops before the lens centre";
  const edges = lens.points.map((p, i) => [p, lens.points[(i + 1) % lens.points.length]!] as const);
  const gap = Math.min(...edges.map(([a, b]) => segmentDistance(end, a, b)));
  if (gap < 2 || insidePolygon(end, lens.points)) return "ray was cut at the lens outline";
  return null;
});

// Negative control: a plane mirror reflection; both rays stop at the mirror.
const planeMirror = () => scene("A ray reflects from a plane mirror.", [
  { id: "m1", kind: "point", role: "mirror end" },
  { id: "m2", kind: "point", role: "mirror end" },
  { id: "mirror", kind: "segment", role: "plane mirror" },
  { id: "hit", kind: "point", role: "point of incidence" },
  { id: "incident", kind: "ray", role: "incident ray" },
  { id: "normal", kind: "segment", role: "normal" },
  { id: "reflected", kind: "ray", role: "reflected ray" },
], [
  point("m1", -2, 0), point("m2", 2, 0),
  { id: "make_mirror", operator: "segment", inputs: { start: "m1", end: "m2" }, outputs: ["mirror"] },
  point("hit", 0, 0),
  { id: "reflect", operator: "reflect_at", inputs: { point: "hit", surface: "mirror", incidentAngleDeg: 40, span: 1.5 }, outputs: ["incident", "normal", "reflected"] },
]);

check("control: a reflection that stops at the mirror is unchanged", () => {
  const { ok, primitives, fatal } = compile(planeMirror());
  if (!ok) return `did not compile: ${JSON.stringify(fatal)}`;
  const incident = stroke(primitives, "incident");
  const reflected = stroke(primitives, "reflected");
  const hit = stroke(primitives, "hit").points[0]!;
  if (dist(incident.points.at(-1)!, hit) > 0.5 || dist(reflected.points[0]!, hit) > 0.5) return "rays no longer meet at the point of incidence";
  if (Math.abs(length(incident) - length(reflected)) > 1) return `reflected ray drawn ${length(reflected).toFixed(1)} px against the incident ${length(incident).toFixed(1)} px of the same span`;
  return null;
});

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
