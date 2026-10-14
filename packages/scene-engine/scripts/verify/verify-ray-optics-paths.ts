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
 * mirror) must render exactly as they did. Only a thin lens lets a ray with a
 * vertex inside it pass: a ray through a point inside a glass sphere or a
 * prism is still cut where it leaves the glass.
 *
 * Normal incidence lets light through glass only: a line parallel to a ray
 * along a reflecting ball's diameter is refused, not drawn through the mirror
 * (third review of #164). A line parallel to a ray through a point inside a
 * glass or reflecting ball, off the diameter, is refused too; only a thin
 * lens excuses a through point inside it (sixth review).
 *
 * An angle mark between a normal and a light path at a contact is the acute
 * angle: `refract_at` emits its normal on the incident side only, and the arc
 * from that half to the refracted ray drew the 136 to 151 degree supplement.
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

// Review of #164: a vertex strictly inside a closed element excused every crossing of
// that element, which is right only for a thin lens (rays bend at its centre plane).
// A `ray` from a contact on thick glass through a declared point inside the glass
// skipped the check and ran on through the far face unbent.
const throughInteriorPoint = (body: "sphere" | "prism") => body === "sphere"
  ? scene("A ray enters a glass sphere and passes a marked point inside it.", [
    { id: "center", kind: "point", role: "centre of the sphere" },
    { id: "boundary", kind: "circle", role: "glass sphere" },
    { id: "object", kind: "point", role: "object", label: "O" },
    { id: "contact1", kind: "point", role: "point of incidence" },
    { id: "incoming1", kind: "vector", role: "incident ray" },
    { id: "inner", kind: "point", role: "point inside the glass", label: "Q" },
    { id: "insideRay", kind: "ray", role: "ray in the glass", label: "r" },
  ], [
    point("center", 2, 0),
    { id: "make_boundary", operator: "circle", inputs: { center: "center", radius: 2 }, outputs: ["boundary"] },
    point("object", -4, 1),
    { id: "contact", operator: "surface_contact", inputs: { origin: "object", surface: "boundary", direction: [1, -0.1] }, outputs: ["contact1", "incoming1"] },
    // The ray leaves the far side about 30 degrees off the normal. (Through (1.5, 0.2) it
    // ran 1.7 degrees off a diameter, which is normal incidence and passes unbent.)
    point("inner", 1.5, 0.9),
    { id: "make_ray", operator: "ray", inputs: { start: "contact1", end: "inner" }, outputs: ["insideRay"] },
  ])
  : (() => {
    const half = 1.0190508989888576;
    return scene("A ray enters a prism and passes a marked point inside the glass.", [
      { id: "P", kind: "point", role: "apex", label: "A" },
      { id: "L", kind: "point", role: "base corner" },
      { id: "R", kind: "point", role: "base corner" },
      { id: "prism", kind: "polygon", role: "prism section" },
      { id: "leftFace", kind: "segment", role: "first face" },
      { id: "rightFace", kind: "segment", role: "second face" },
      { id: "contact", kind: "point", role: "point of incidence" },
      { id: "incoming", kind: "ray", role: "incident ray" },
      { id: "normal", kind: "vector", role: "normal" },
      { id: "refracted", kind: "ray", role: "refracted ray" },
      { id: "inner", kind: "point", role: "point inside the glass", label: "Q" },
      { id: "insideRay", kind: "ray", role: "ray in the glass", label: "r" },
    ], [
      point("P", 0, 2), point("L", -half, 0), point("R", half, 0),
      { id: "make_prism", operator: "polygon", inputs: { points: ["L", "P", "R"] }, outputs: ["prism"] },
      { id: "make_left", operator: "segment", inputs: { start: "L", end: "P" }, outputs: ["leftFace"] },
      { id: "make_right", operator: "segment", inputs: { start: "P", end: "R" }, outputs: ["rightFace"] },
      point("contact", -half / 2, 1),
      { id: "entry", operator: "refract_at", inputs: { point: "contact", surface: "leftFace", incidentAngleDeg: 46.2, n1: 1, n2: 1.59, tangentSign: 1, span: 0.4 }, outputs: ["incoming", "normal", "refracted"] },
      point("inner", 0, 0.9),
      { id: "make_ray", operator: "ray", inputs: { start: "contact", end: "inner" }, outputs: ["insideRay"] },
    ]);
  })();

check("ray through a point inside a glass sphere is cut at the far side", () => {
  const { ok, primitives, fatal } = compile(throughInteriorPoint("sphere"));
  if (!ok) return `did not compile: ${JSON.stringify(fatal)}`;
  const ray = stroke(primitives, "insideRay");
  const circle = stroke(primitives, "boundary");
  const center = circle.points[0]!;
  const end = ray.points.at(-1)!;
  const past = dist(end, center) - circle.radius!;
  if (past > 1.5) return `ray runs ${past.toFixed(1)} px past the far side of the sphere`;
  if (Math.abs(past) > 1.5 || length(ray) < 20) return `ray ends ${Math.abs(past).toFixed(1)} px off the sphere (length ${length(ray).toFixed(0)} px)`;
  return null;
});

check("ray through a point inside a prism is cut at the second face", () => {
  const { ok, primitives, fatal } = compile(throughInteriorPoint("prism"));
  if (!ok) return `did not compile: ${JSON.stringify(fatal)}`;
  const ray = stroke(primitives, "insideRay");
  const prism = stroke(primitives, "prism");
  const face = stroke(primitives, "rightFace");
  const end = ray.points.at(-1)!;
  const gap = segmentDistance(end, face.points[0]!, face.points.at(-1)!);
  if (!insidePolygon(end, prism.points) && gap > 1.5) return `ray runs ${gap.toFixed(1)} px past the second face`;
  if (gap > 1.5) return `ray ends ${gap.toFixed(1)} px short of the second face`;
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

// Recorded m1 refraction h8a: water to crown glass is drawn from glass (n = 1.52) into water
// (n = 1.33) at 37 degrees; r = asin(1.52 sin 37 / 1.33) = 43.46 degrees. The arc from the
// incident side normal to the refracted ray measured the 136.5 degree supplement.
function refractionArcs(mode: "refract" | "reflect") {
  return scene(mode === "refract" ? "A ray refracts at a plane interface." : "A ray reflects from a plane mirror.", [
    { id: "a", kind: "point", role: "interface end" },
    { id: "b", kind: "point", role: "interface end" },
    { id: "interface", kind: "segment", role: mode === "refract" ? "interface" : "plane mirror" },
    { id: "contact", kind: "point", role: "point of incidence" },
    { id: "incident", kind: "ray", role: "incident ray" },
    { id: "normal", kind: "segment", role: "normal" },
    { id: "outgoing", kind: "ray", role: mode === "refract" ? "refracted ray" : "reflected ray" },
    { id: "incidenceAngle", kind: "angle_mark", role: "angle of incidence", label: "i" },
    { id: "outgoingAngle", kind: "angle_mark", role: mode === "refract" ? "angle of refraction" : "angle of reflection", label: "r" },
  ], [
    point("a", -3, 0), point("b", 3, 0),
    { id: "make_interface", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["interface"] },
    point("contact", 0, 0),
    mode === "refract"
      ? { id: "event", operator: "refract_at", inputs: { point: "contact", surface: "interface", incidentAngleDeg: 37, n1: 1.52, n2: 1.33, span: 3 }, outputs: ["incident", "normal", "outgoing"] }
      : { id: "event", operator: "reflect_at", inputs: { point: "contact", surface: "interface", incidentAngleDeg: 40, span: 3 }, outputs: ["incident", "normal", "outgoing"] },
    { id: "mark_incidence", operator: "angle_mark", inputs: { vertex: "contact", a: "incident", b: "normal" }, outputs: ["incidenceAngle"] },
    { id: "mark_outgoing", operator: "angle_mark", inputs: { vertex: "contact", a: "normal", b: "outgoing" }, outputs: ["outgoingAngle"] },
  ]);
}

function sweepDegrees(arc: Primitive): number {
  let sweep = Math.abs(arc.endAngle! - arc.startAngle!) % (2 * Math.PI);
  if (sweep > Math.PI) sweep = 2 * Math.PI - sweep;
  return sweep / DEG;
}

check("refraction arc measures the acute angle from the normal", () => {
  const { ok, primitives, fatal } = compile(refractionArcs("refract"));
  if (!ok) return `did not compile: ${JSON.stringify(fatal)}`;
  const expected = Math.asin(1.52 * Math.sin(37 * DEG) / 1.33) / DEG;
  const r = sweepDegrees(stroke(primitives, "outgoingAngle"));
  if (Math.abs(r - expected) > 0.5) return `refraction arc spans ${r.toFixed(2)} degrees, expected ${expected.toFixed(2)}`;
  const i = sweepDegrees(stroke(primitives, "incidenceAngle"));
  if (Math.abs(i - 37) > 0.5) return `incidence arc spans ${i.toFixed(2)} degrees, expected 37`;
  // Both arms of the refraction arc are ink: the normal now runs through the contact.
  const normal = stroke(primitives, "normal");
  const refracted = stroke(primitives, "outgoing");
  const contact = refracted.points[0]!;
  const direction = { x: refracted.points.at(-1)!.x - contact.x, y: refracted.points.at(-1)!.y - contact.y };
  const transmitted = normal.points.some((p) => (p.x - contact.x) * direction.x + (p.y - contact.y) * direction.y > 10);
  if (!transmitted) return "the normal is not drawn on the refracted side, where the arc starts";
  return null;
});

check("control: a reflection arc keeps its angle and its normal", () => {
  const { ok, primitives, fatal } = compile(refractionArcs("reflect"));
  if (!ok) return `did not compile: ${JSON.stringify(fatal)}`;
  const r = sweepDegrees(stroke(primitives, "outgoingAngle"));
  if (Math.abs(r - 40) > 0.5) return `reflection arc spans ${r.toFixed(2)} degrees, expected 40`;
  const normal = stroke(primitives, "normal");
  const incident = stroke(primitives, "incident");
  const contact = incident.points.at(-1)!;
  if (dist(normal.points[0]!, contact) > 0.5) return "the reflection normal no longer starts at the contact";
  return null;
});

// Recorded figures PR #164 still drew wrong. Each document is the
// selected planner response of a round 7 run after production validation,
// as the engine compiles it (fixtures/ray-optics-remaining.json).
//
// R6: b2 glass slab h8a built its emergent ray as `parallel_through` the
// incident ray through the exit point. A line runs both ways, so it also
// crossed the block and its faces without bending. A line that copies a
// declared ray's direction carries that light: from a point where it leaves
// a closed glass element it is drawn forward only, and it may not run through
// glass with no event there (`light_line_crosses_element`).
const { readFileSync } = await import("node:fs");
const remaining = JSON.parse(readFileSync(new URL("./fixtures/ray-optics-remaining.json", import.meta.url), "utf8")) as {
  documents: Record<string, Record<string, unknown>>;
};
type RecordedDocument = Record<string, any>;
function recorded(name: string, edit?: (document: RecordedDocument) => void) {
  const document = structuredClone(remaining.documents[name]!) as RecordedDocument;
  edit?.(document);
  return compile(document as ReturnType<typeof scene>);
}
const lerpPoint = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const edgeDistance = (p: P, polygon: P[]) =>
  Math.min(...polygon.map((a, index) => segmentDistance(p, a, polygon[(index + 1) % polygon.length]!)));
function lineDistance(p: P, a: P, b: P): number {
  return Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / dist(a, b);
}
/** Angle between two strokes' directions, 0 to 90 degrees. */
function strokeAngle(a: Primitive, b: Primitive): number {
  const u = Math.atan2(a.points.at(-1)!.y - a.points[0]!.y, a.points.at(-1)!.x - a.points[0]!.x);
  const v = Math.atan2(b.points.at(-1)!.y - b.points[0]!.y, b.points.at(-1)!.x - b.points[0]!.x);
  const difference = Math.abs(u - v) % Math.PI;
  return Math.min(difference, Math.PI - difference) / DEG;
}
/** First sample of a stroke that lies inside a polygon by more than 1.5 px. */
function runsInsidePolygon(stroke: Primitive, polygon: P[]): P | null {
  for (let index = 0; index <= 60; index += 1) {
    const sample = lerpPoint(stroke.points[0]!, stroke.points.at(-1)!, index / 60);
    if (insidePolygon(sample, polygon) && edgeDistance(sample, polygon) > 1.5) return sample;
  }
  return null;
}
const fatalCodes = (fatal: Array<{ code: string }>) => fatal.map((issue) => issue.code);

check("recorded b2 slab: the emergent line leaves the block at the exit and never crosses it", () => {
  const { ok, primitives, fatal } = recorded("slab");
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  const block = stroke(primitives, "block").points;
  const emergent = stroke(primitives, "emergent");
  const inside = runsInsidePolygon(emergent, block);
  if (inside) return `the emergent line runs through the block at (${inside.x.toFixed(1)}, ${inside.y.toFixed(1)})`;
  const start = emergent.points[0]!;
  const bottom = stroke(primitives, "bottomFace");
  const offFace = segmentDistance(start, bottom.points[0]!, bottom.points.at(-1)!);
  if (offFace > 1.5) return `the emergent line starts ${offFace.toFixed(1)} px off the exit face`;
  const refracted = stroke(primitives, "insideRay");
  const offPath = lineDistance(start, refracted.points[0]!, refracted.points.at(-1)!);
  if (offPath > 1.5) return `the emergent line starts ${offPath.toFixed(1)} px off the refracted ray's line`;
  const turn = strokeAngle(emergent, stroke(primitives, "incident"));
  if (turn > 0.5) return `the emergent line is ${turn.toFixed(2)} degrees off the incident direction`;
  return null;
});

check("recorded b2 slab: a parallel ray meeting the block with no refraction is refused", () => {
  const { ok, fatal } = recorded("slab", (document) => {
    document.entities.push({ id: "beamEntry", kind: "point", role: "second ray meets the block" });
    document.constructions.push({ id: "makeBeamEntry", operator: "point", inputs: { x: -3, y: 7.4, coordinateSpace: "world" }, outputs: ["beamEntry"] });
    document.requiredEntityIds.push("beamEntry");
    document.revealGroups.at(-1).entityIds.push("beamEntry");
    document.constructions.find((construction: RecordedDocument) => construction.id === "emergence").inputs.through = "beamEntry";
  });
  if (ok) return "compiled a line carrying the incident light straight through the block";
  if (!fatalCodes(fatal).includes("light_line_crosses_element")) return `refused with ${JSON.stringify(fatalCodes(fatal))}, not light_line_crosses_element`;
  return null;
});

check("control: recorded b1 slab path (refract_at, intersection, ray) is unchanged", () => {
  const { ok, primitives, fatal } = recorded("slabCorrect");
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  const emergent = stroke(primitives, "emergent");
  const refracted = stroke(primitives, "refracted");
  const lower = stroke(primitives, "lower");
  const start = emergent.points[0]!;
  if (lineDistance(start, refracted.points[0]!, refracted.points.at(-1)!) > 1.5) return "the emergent ray no longer starts on the refracted ray's line";
  if (segmentDistance(start, lower.points[0]!, lower.points.at(-1)!) > 1.5) return "the emergent ray no longer starts on the lower face";
  const turn = strokeAngle(emergent, stroke(primitives, "incident"));
  if (turn > 0.5) return `the emergent ray is ${turn.toFixed(2)} degrees off the incident direction`;
  return null;
});

// R7: b2 optical fibre h8u reflected at 26.6 degrees to the normal where the
// light should be totally internally reflected. That document declares no
// index, so it cannot be held; once an interface's indices are declared (by
// the refractions on it), a reflection from the denser side below the
// critical angle, with no refraction drawn at its contact, is refused
// (`reflection_below_critical_angle`).
//
// The fibre's own reflection, with the interface indices declared by a
// refraction that leaves the core at another contact on the same boundary.
function declareFibreIndices(document: RecordedDocument, options: { sameContact?: boolean } = {}): void {
  if (options.sameContact) {
    document.entities.push({ id: "leakOut", kind: "ray", role: "light refracted into the cladding" });
    document.constructions.push({ id: "makeLeakOut", operator: "refract_direction", inputs: { origin: "contact", incoming: "incoming", normal: "contactNormal", n1: 1.58, n2: 1.47 }, outputs: ["leakOut"] });
    document.requiredEntityIds.push("leakOut");
    document.revealGroups.at(-1).entityIds.push("leakOut");
    return;
  }
  const ids = ["leakOrigin", "leak", "leakIncoming", "leakNormal", "leakOut"];
  document.entities.push(
    { id: "leakOrigin", kind: "point", role: "helper point" },
    { id: "leak", kind: "point", role: "second point of incidence" },
    { id: "leakIncoming", kind: "vector", role: "light in the core" },
    { id: "leakNormal", kind: "segment", role: "normal" },
    { id: "leakOut", kind: "ray", role: "light refracted into the cladding" },
  );
  document.constructions.push(
    { id: "makeLeakOrigin", operator: "point", inputs: { x: -4, y: -2, coordinateSpace: "world" }, outputs: ["leakOrigin"] },
    { id: "makeLeak", operator: "surface_contact", inputs: { origin: "leakOrigin", surface: "boundary", direction: [1, 1] }, outputs: ["leak", "leakIncoming"] },
    { id: "makeLeakNormal", operator: "normal_at", inputs: { point: "leak", surface: "boundary" }, outputs: ["leakNormal"] },
    { id: "makeLeakOut", operator: "refract_direction", inputs: { origin: "leak", incoming: "leakIncoming", normal: "leakNormal", n1: 1.58, n2: 1.47 }, outputs: ["leakOut"] },
  );
  document.requiredEntityIds.push(...ids);
  document.revealGroups.at(-1).entityIds.push(...ids);
}

check("recorded b2 TIR: the second ray at 20 degrees, below the declared 27.7 degree critical angle, is refused", () => {
  const { ok, fatal } = recorded("tir", (document) => {
    document.quantities.find((quantity: RecordedDocument) => quantity.id === "i2").value = 20;
  });
  if (ok) return "compiled a lone reflection below the critical angle of n = 2.15 to air";
  if (!fatalCodes(fatal).includes("reflection_below_critical_angle")) return `refused with ${JSON.stringify(fatalCodes(fatal))}, not reflection_below_critical_angle`;
  return null;
});

check("recorded b2 fibre: the 26.6 degree reflection is refused once core 1.58 and cladding 1.47 are declared", () => {
  const { ok, fatal } = recorded("fibre", (document) => declareFibreIndices(document));
  if (ok) return "compiled a total internal reflection at 26.6 degrees, below the 68.5 degree critical angle";
  if (!fatalCodes(fatal).includes("reflection_below_critical_angle")) return `refused with ${JSON.stringify(fatalCodes(fatal))}, not reflection_below_critical_angle`;
  return null;
});

check("control: recorded b2 TIR at 34 degrees, above the 27.7 degree critical angle, is unchanged", () => {
  const { ok, primitives, fatal } = recorded("tir");
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  const reflected = stroke(primitives, "reflected2");
  const face = stroke(primitives, "face");
  if (segmentDistance(reflected.points[0]!, face.points[0]!, face.points.at(-1)!) > 1.5) return "the reflected ray no longer leaves the face";
  return null;
});

check("control: the fibre with declared indices and its reflection at 71.6 degrees compiles", () => {
  const { ok, primitives, fatal } = recorded("fibre", (document) => {
    declareFibreIndices(document);
    document.constructions.find((construction: RecordedDocument) => construction.id === "makeContact").inputs.direction = [3, 1];
  });
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  stroke(primitives, "reflected");
  stroke(primitives, "leakOut");
  return null;
});

check("control: a reflection below the critical angle drawn with its refraction at the same contact compiles", () => {
  const { ok, primitives, fatal } = recorded("fibre", (document) => declareFibreIndices(document, { sameContact: true }));
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  stroke(primitives, "reflected");
  stroke(primitives, "leakOut");
  return null;
});

// Second review of #164 (R1). "Light never crosses glass unbent" is false in two
// cases: a path along the surface normal (normal incidence, a ray along a radius of a
// sphere or a semicircular block) and a thin lens, where rays meet the lens at its
// centre plane. Each correct figure below was cut or refused; each must render, while
// thick glass crossed away from the normal and mirrors stay cut or refused.
const review = JSON.parse(readFileSync(new URL("./fixtures/ray-optics-review-164.json", import.meta.url), "utf8")) as {
  documents: Record<string, { why: string; document: RecordedDocument }>;
};
const reviewed = (id: string) => compile(structuredClone(review.documents[id]!.document) as ReturnType<typeof scene>);
const pointAt = (primitives: Primitive[], id: string) => stroke(primitives, id).points[0]!;
const xs = (primitive: Primitive) => primitive.points.map((p) => p.x);

check("recorded 1fa5a146ebd6 telescope: optical_train rays run from objective to eyepiece and on", () => {
  const { ok, primitives, fatal } = reviewed("1fa5a146ebd6");
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  // Each lens outline is symmetric about its centre plane.
  const centreX = (id: string) => (Math.min(...xs(stroke(primitives, id))) + Math.max(...xs(stroke(primitives, id)))) / 2;
  const eyepieceX = centreX("eyepiece");
  const objectiveX = centreX("objective");
  for (const id of ["internalUpper", "internalLower"]) {
    const ray = stroke(primitives, id);
    if (Math.abs(ray.points.at(-1)!.x - eyepieceX) > 1.5) return `${id} stops at x ${ray.points.at(-1)!.x.toFixed(1)}, not at the eyepiece (${eyepieceX.toFixed(1)})`;
    if (Math.abs(ray.points[0]!.x - objectiveX) > 1.5) return `${id} does not start at the objective`;
  }
  for (const id of ["outgoingUpper", "outgoingLower"]) {
    const ray = stroke(primitives, id);
    if (Math.abs(ray.points[0]!.x - eyepieceX) > 1.5 || length(ray) < 100) return `${id} drawn ${length(ray).toFixed(0)} px from x ${ray.points[0]!.x.toFixed(1)}; it should leave the eyepiece at full span`;
  }
  return null;
});

check("recorded 841475739996: the returning ray along the axis goes back through the lens", () => {
  const { ok, primitives, fatal } = reviewed("841475739996");
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  const ray = stroke(primitives, "returning");
  const lensLeft = Math.min(...xs(stroke(primitives, "lens")));
  const end = Math.min(...xs(ray));
  if (end > lensLeft - 20) return `returning ray ends at x ${end.toFixed(1)}, not past the lens (left edge ${lensLeft.toFixed(1)})`;
  return null;
});

check("recorded f782478761ab: the axial ray through the lens centre to a plane mirror renders", () => {
  const { ok, primitives, fatal } = reviewed("f782478761ab");
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  const ray = stroke(primitives, "incoming");
  const lensLeft = Math.min(...xs(stroke(primitives, "lens")));
  const mirrorX = stroke(primitives, "mirror").points[0]!.x;
  if (ray.points[0]!.x > lensLeft - 20) return "incoming ray does not start before the lens";
  if (Math.abs(ray.points.at(-1)!.x - mirrorX) > 1.5) return "incoming ray does not reach the mirror";
  return null;
});

check("control: recorded a885e2eab386, a return ray crossing the lens plane off centre with no bend there, is cut at the lens", () => {
  const { ok, primitives, fatal } = reviewed("a885e2eab386");
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  const lens = stroke(primitives, "lens");
  const centreX = (Math.min(...xs(lens)) + Math.max(...xs(lens))) / 2;
  const end = Math.min(...xs(stroke(primitives, "returnRay")));
  if (end < centreX - 1.5) return `return ray runs on to x ${end.toFixed(1)}, past the lens plane at ${centreX.toFixed(1)}, unbent`;
  return null;
});

// The chief ray from the object tip to the image tip goes straight through a thin lens.
const chiefRay = (operator: "segment" | "ray") => scene("Image formed by a convex lens", [
  { id: "axis_origin", kind: "point", role: "axis start" },
  { id: "axis", kind: "line", role: "principal axis" },
  { id: "O", kind: "point", role: "optical centre", label: "O" },
  { id: "lens", kind: "polygon", role: "convex lens" },
  { id: "base", kind: "point", role: "object base" },
  { id: "tip", kind: "point", role: "object tip" },
  { id: "ibase", kind: "point", role: "image base" },
  { id: "itip", kind: "point", role: "image tip" },
  { id: "chief", kind: "ray", role: "ray through the optical centre" },
], [
  point("axis_origin", -5, 0),
  { id: "make_axis", operator: "line", inputs: { start: "axis_origin", direction: [1, 0] }, outputs: ["axis"] },
  point("O", 0, 0),
  { id: "make_lens", operator: "lens_section", inputs: { center: "O", axis: "axis", radius1: 5, radius2: -5, halfHeight: 1.2 }, outputs: ["lens"] },
  point("base", -3, 0), point("tip", -3, 1), point("ibase", 3, 0), point("itip", 3, -1),
  { id: "make_chief", operator, inputs: { start: "tip", end: "itip" }, outputs: ["chief"] },
]);

for (const operator of ["segment", "ray"] as const) {
  check(`chief ray through a lens_section drawn as one ${operator} goes straight on`, () => {
    const { ok, primitives, fatal } = compile(chiefRay(operator));
    if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
    const ray = stroke(primitives, "chief");
    const itip = pointAt(primitives, "itip");
    const end = ray.points.at(-1)!;
    if (operator === "segment" && dist(end, itip) > 1.5) return `chief ray ends ${dist(end, itip).toFixed(1)} px short of the image tip`;
    if (operator === "ray" && end.x < itip.x - 1.5) return `chief ray stops at x ${end.x.toFixed(1)}, before the image tip`;
    return null;
  });
}

// A slab (closed outline plus a refracting top face) and a plain ray at normal incidence.
const slabNormal = () => scene("Ray at normal incidence passes straight through a slab; another bends", [
  { id: "A", kind: "point", role: "corner" }, { id: "B", kind: "point", role: "corner" },
  { id: "C", kind: "point", role: "corner" }, { id: "D", kind: "point", role: "corner" },
  { id: "hit1", kind: "point", role: "entry" }, { id: "src", kind: "point", role: "source" }, { id: "nhit", kind: "point", role: "normal exit" },
  { id: "slab", kind: "polygon", role: "glass slab" }, { id: "top", kind: "segment", role: "top face" },
  { id: "incident1", kind: "ray", role: "incident ray" }, { id: "normal1", kind: "segment", role: "normal" }, { id: "refracted1", kind: "ray", role: "refracted ray" },
  { id: "straight", kind: "ray", role: "ray at normal incidence" },
], [
  point("A", -2, 0), point("B", 2, 0), point("C", 2, -1.5), point("D", -2, -1.5),
  point("hit1", -1, 0), point("src", 1, 1.5), point("nhit", 1, -1.5),
  { id: "make_slab", operator: "polygon", inputs: { points: ["A", "B", "C", "D"] }, outputs: ["slab"] },
  { id: "make_top", operator: "segment", inputs: { start: "A", end: "B" }, outputs: ["top"] },
  { id: "r1", operator: "refract_at", inputs: { point: "hit1", surface: "top", incidentAngleDeg: 40, n1: 1, n2: 1.5, span: 1.2 }, outputs: ["incident1", "normal1", "refracted1"] },
  { id: "make_straight", operator: "ray", inputs: { start: "src", end: "nhit" }, outputs: ["straight"] },
]);

check("a ray at normal incidence on a slab passes through both faces", () => {
  const { ok, primitives, fatal } = compile(slabNormal());
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  const ray = stroke(primitives, "straight");
  const bottom = Math.max(...stroke(primitives, "slab").points.map((p) => p.y));
  // The fitted view ends at the bottom face, so the ray must reach it.
  if (ray.points.at(-1)!.y < bottom - 1.5) return `ray stops at y ${ray.points.at(-1)!.y.toFixed(1)}; the bottom face is at ${bottom.toFixed(1)}`;
  return null;
});

// A glass sphere: one refraction at its surface and a ray along a diameter.
const sphereDiameter = () => scene("Rays through a glass sphere; the ray along a diameter is undeviated", [
  { id: "C", kind: "point", role: "centre", label: "C" }, { id: "sphere", kind: "circle", role: "glass sphere" },
  { id: "hit", kind: "point", role: "entry" }, { id: "src", kind: "point", role: "source" }, { id: "far", kind: "point", role: "far point" },
  { id: "inc", kind: "ray", role: "incident ray" }, { id: "nrm", kind: "segment", role: "normal" }, { id: "ref", kind: "ray", role: "refracted ray" },
  { id: "axial", kind: "ray", role: "ray along the diameter" },
], [
  point("C", 0, 0),
  { id: "make_sphere", operator: "circle", inputs: { center: "C", radius: 1.5 }, outputs: ["sphere"] },
  point("hit", -1.5 * Math.cos(30 * DEG), 1.5 * Math.sin(30 * DEG)), point("src", -4, 0), point("far", 4, 0),
  { id: "r1", operator: "refract_at", inputs: { point: "hit", surface: "sphere", incidentAngleDeg: 30, n1: 1, n2: 1.5, tangentSign: 1 }, outputs: ["inc", "nrm", "ref"] },
  { id: "make_axial", operator: "segment", inputs: { start: "src", end: "far" }, outputs: ["axial"] },
]);

check("a ray along a sphere's diameter passes through", () => {
  const { ok, primitives, fatal } = compile(sphereDiameter());
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  const ray = stroke(primitives, "axial");
  const circle = stroke(primitives, "sphere");
  // The far point is 4 units from the centre of a sphere of radius 1.5.
  const far = { x: circle.points[0]!.x + circle.radius! * 4 / 1.5, y: circle.points[0]!.y };
  if (dist(ray.points.at(-1)!, far) > 1.5) return `ray stops ${dist(ray.points.at(-1)!, far).toFixed(1)} px short of its far point`;
  return null;
});

// Right angle isosceles prism: the ray enters face AB along its normal and is totally
// internally reflected at the hypotenuse (reflect_at with its default span).
const rightAnglePrism = (tangentSign: 1 | -1) => scene("A ray enters a right-angled isosceles prism normally and is totally internally reflected at the hypotenuse", [
  { id: "A", kind: "point", role: "right angle corner", label: "A" }, { id: "B", kind: "point", role: "corner", label: "B" },
  { id: "C", kind: "point", role: "corner", label: "C" }, { id: "hit", kind: "point", role: "point on hypotenuse" },
  { id: "prism", kind: "polygon", role: "glass prism" }, { id: "hyp", kind: "segment", role: "hypotenuse face" },
  { id: "inc", kind: "ray", role: "incident ray" }, { id: "nrm", kind: "segment", role: "normal" }, { id: "refl", kind: "ray", role: "totally internally reflected ray" },
], [
  point("A", 0, 0), point("B", 2, 0), point("C", 0, 2), point("hit", 0.6, 1.4),
  { id: "make_prism", operator: "polygon", inputs: { points: ["A", "B", "C"] }, outputs: ["prism"] },
  { id: "make_hyp", operator: "segment", inputs: { start: "B", end: "C" }, outputs: ["hyp"] },
  { id: "tir", operator: "reflect_at", inputs: { point: "hit", surface: "hyp", incidentAngleDeg: 45, tangentSign }, outputs: ["inc", "nrm", "refl"] },
]);

for (const tangentSign of [1, -1] as const) {
  check(`right angle prism entered normally with total internal reflection renders (tangentSign ${tangentSign})`, () => {
    const { ok, primitives, fatal } = compile(rightAnglePrism(tangentSign));
    if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
    const inc = stroke(primitives, "inc");
    if (insidePolygon(inc.points[0]!, stroke(primitives, "prism").points)) return "incident ray starts inside the prism";
    const hyp = stroke(primitives, "hyp");
    if (segmentDistance(inc.points.at(-1)!, hyp.points[0]!, hyp.points.at(-1)!) > 1.5) return "incident ray does not reach the hypotenuse";
    return null;
  });
}

// Semicircular block (closed outline), a ray along a radius to the centre of the flat
// face, totally internally reflected there; a second ray from the air side through the
// flat face declares the indices, so the critical angle rule (R7) runs too.
const semicircle = (tangentSign: 1 | -1, declareIndices: boolean) => {
  const outline: number[][] = [];
  for (let k = 0; k <= 24; k += 1) outline.push([1.5 * Math.cos(k * Math.PI / 24), 1.5 * Math.sin(k * Math.PI / 24)]);
  return scene("Critical angle: a ray enters a semicircular glass block along a radius and is totally internally reflected at the flat face", [
    ...outline.map((_, k) => ({ id: `s${k}`, kind: "point", role: "outline point" })),
    { id: "O", kind: "point", role: "centre of flat face", label: "O" },
    { id: "block", kind: "polygon", role: "semicircular glass block" }, { id: "flat", kind: "segment", role: "flat face" },
    { id: "inc", kind: "ray", role: "incident ray along a radius" }, { id: "nrm", kind: "segment", role: "normal" }, { id: "refl", kind: "ray", role: "reflected ray" },
    ...(declareIndices ? [
      { id: "Q", kind: "point", role: "entry on the flat face" },
      { id: "airRay", kind: "ray", role: "ray from air" }, { id: "nrmQ", kind: "segment", role: "normal" }, { id: "intoGlass", kind: "ray", role: "refracted ray" },
    ] : []),
  ], [
    ...outline.map(([x, y], k) => point(`s${k}`, x!, y!)), point("O", 0, 0),
    { id: "make_block", operator: "polygon", inputs: { points: outline.map((_, k) => `s${k}`) }, outputs: ["block"] },
    { id: "make_flat", operator: "segment", inputs: { start: "s24", end: "s0" }, outputs: ["flat"] },
    { id: "tir", operator: "reflect_at", inputs: { point: "O", surface: "flat", incidentAngleDeg: 50, tangentSign }, outputs: ["inc", "nrm", "refl"] },
    ...(declareIndices ? [
      point("Q", 0.7, 0),
      { id: "refraction", operator: "refract_at", inputs: { point: "Q", surface: "flat", incidentAngleDeg: 30, n1: 1, n2: 1.5, tangentSign: 1, span: 0.6 }, outputs: ["airRay", "nrmQ", "intoGlass"] },
    ] : []),
  ]);
};

for (const [tangentSign, declareIndices] of [[1, false], [-1, false], [-1, true]] as const) {
  check(`semicircular block, ray along a radius, total internal reflection at the flat face renders (tangentSign ${tangentSign}${declareIndices ? ", indices declared" : ""})`, () => {
    const { ok, primitives, fatal } = compile(semicircle(tangentSign, declareIndices));
    if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
    const inc = stroke(primitives, "inc");
    if (insidePolygon(inc.points[0]!, stroke(primitives, "block").points)) return "incident ray starts inside the block";
    if (dist(inc.points.at(-1)!, pointAt(primitives, "O")) > 1.5) return "incident ray does not reach the flat face centre";
    return null;
  });
}

check("semicircular block, ray along a radius refracting out of the flat face below the critical angle renders", () => {
  const document = semicircle(-1, false);
  const event = document.constructions.find((construction) => construction.id === "tir")!;
  event.operator = "refract_at";
  event.inputs = { point: "O", surface: "flat", incidentAngleDeg: 30, n1: 1.5, n2: 1, tangentSign: -1 };
  document.entities.find((entity) => entity.id === "refl")!.role = "refracted ray";
  const { ok, primitives, fatal } = compile(document);
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  const inc = stroke(primitives, "inc");
  if (insidePolygon(inc.points[0]!, stroke(primitives, "block").points)) return "incident ray starts inside the block";
  if (dist(inc.points.at(-1)!, pointAt(primitives, "O")) > 1.5) return "incident ray does not reach the flat face centre";
  return null;
});

// R6: a line built parallel to a ray at normal incidence, through the entry contact,
// runs straight through the slab; it was refused as light crossing glass unbent.
const slabNormalLine = () => scene("A ray meets a glass slab along the normal and passes straight through", [
  { id: "A", kind: "point", role: "corner" }, { id: "B", kind: "point", role: "corner" },
  { id: "C", kind: "point", role: "corner" }, { id: "D", kind: "point", role: "corner" },
  { id: "src", kind: "point", role: "source" }, { id: "contact", kind: "point", role: "point of incidence" }, { id: "hit1", kind: "point", role: "entry" },
  { id: "slab", kind: "polygon", role: "glass slab" }, { id: "top", kind: "segment", role: "top face" },
  { id: "inc1", kind: "ray", role: "incident ray" }, { id: "nrm1", kind: "segment", role: "normal" }, { id: "ref1", kind: "ray", role: "refracted ray" },
  { id: "incident", kind: "ray", role: "incident ray along the normal" }, { id: "onward", kind: "line", role: "ray through the slab" },
], [
  point("A", -2, 0), point("B", 2, 0), point("C", 2, -1.5), point("D", -2, -1.5), point("src", 1, 1.5), point("contact", 1, 0), point("hit1", -1, 0),
  { id: "make_slab", operator: "polygon", inputs: { points: ["A", "B", "C", "D"] }, outputs: ["slab"] },
  { id: "make_top", operator: "segment", inputs: { start: "A", end: "B" }, outputs: ["top"] },
  { id: "r1", operator: "refract_at", inputs: { point: "hit1", surface: "top", incidentAngleDeg: 40, n1: 1, n2: 1.5, span: 1.2 }, outputs: ["inc1", "nrm1", "ref1"] },
  { id: "make_incident", operator: "segment", inputs: { start: "src", end: "contact" }, outputs: ["incident"] },
  { id: "make_onward", operator: "parallel_through", inputs: { through: "contact", line: "incident" }, outputs: ["onward"] },
]);

check("a line parallel to a ray at normal incidence runs through the slab (R6)", () => {
  const { ok, primitives, fatal } = compile(slabNormalLine());
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  const line = stroke(primitives, "onward");
  const bottom = Math.max(...stroke(primitives, "slab").points.map((p) => p.y));
  if (Math.max(...line.points.map((p) => p.y)) < bottom - 1.5) return "the line does not run on through the slab";
  return null;
});

// Third review of #164 (thread "Light passes through mirrors"): R6 excused a line meeting
// every boundary along the normal for any closed body, a mirror too. A line built parallel
// to a ray along a reflecting ball's diameter, through its contact, was drawn on through
// the ball. Light never passes a mirror; the normal incidence allowance is glass only (R1's
// test: a closed body light reflects from outside with no refraction there is a mirror).
const ballDiameterLine = (body: "mirror" | "glass") => scene(body === "mirror"
  ? "Light reflects from a polished steel ball; one ray meets it along a diameter."
  : "Light refracts into a glass ball; one ray meets it along a diameter.", [
  { id: "C", kind: "point", role: "centre", label: "C" }, { id: "ball", kind: "circle", role: body === "mirror" ? "reflecting ball" : "glass ball" },
  { id: "src2", kind: "point", role: "source" }, { id: "hit", kind: "point", role: "point of incidence" },
  { id: "inc", kind: "ray", role: "incident ray" }, { id: "nrm", kind: "segment", role: "normal" },
  { id: "out", kind: "ray", role: body === "mirror" ? "reflected ray" : "refracted ray" },
  { id: "src", kind: "point", role: "source" }, { id: "contact", kind: "point", role: "contact on the diameter" },
  { id: "axial", kind: "ray", role: "ray along the diameter" }, { id: "onward", kind: "line", role: "line parallel to the ray" },
], [
  point("C", 0, 0),
  { id: "make_ball", operator: "circle", inputs: { center: "C", radius: 1.5 }, outputs: ["ball"] },
  point("src2", -4, 0.75), point("src", -4, 0), point("contact", -1.5, 0),
  { id: "meet", operator: "surface_contact", inputs: { origin: "src2", surface: "ball", direction: [1, 0], which: "nearest_forward" }, outputs: ["hit", "inc"] },
  { id: "normal", operator: "normal_at", inputs: { point: "hit", surface: "ball" }, outputs: ["nrm"] },
  body === "mirror"
    ? { id: "bounce", operator: "reflect_direction", inputs: { origin: "hit", incoming: "inc", normal: "nrm" }, outputs: ["out"] }
    : { id: "bend", operator: "refract_direction", inputs: { origin: "hit", incoming: "inc", normal: "nrm", n1: 1, n2: 1.5 }, outputs: ["out"] },
  { id: "make_axial", operator: "segment", inputs: { start: "src", end: "contact" }, outputs: ["axial"] },
  { id: "make_onward", operator: "parallel_through", inputs: { through: "contact", line: "axial" }, outputs: ["onward"] },
]);

check("a line parallel to a ray along a reflecting ball's diameter is refused, not drawn through the mirror (R6)", () => {
  const { ok, primitives, fatal } = compile(ballDiameterLine("mirror"));
  if (ok) {
    const line = stroke(primitives, "onward");
    const ball = stroke(primitives, "ball");
    return `compiled with the line from x ${Math.min(...xs(line)).toFixed(0)} to ${Math.max(...xs(line)).toFixed(0)} through the mirror (centre x ${ball.points[0]!.x.toFixed(0)}, radius ${ball.radius!.toFixed(0)})`;
  }
  return fatalCodes(fatal).includes("light_line_crosses_element") ? null : `failed with ${fatalCodes(fatal).join(", ")}, not light_line_crosses_element`;
});

check("control: the same line along a glass ball's diameter runs on through it (R6)", () => {
  const { ok, primitives, fatal } = compile(ballDiameterLine("glass"));
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  const ball = stroke(primitives, "ball");
  if (Math.max(...xs(stroke(primitives, "onward"))) < ball.points[0]!.x + ball.radius! + 1.5) return "the line does not run on through the glass ball";
  return null;
});

// Fifth review of #164 (thread "Light passes through mirrors"): the mirror test read a
// reflection's incoming light only from a path id, but reflect_direction also takes a
// literal direction. With `incoming: [1, 0]` (or { x: 1, y: 0 }) the reflecting ball
// counted as glass, so a ray along its diameter, and a line parallel to it through
// its contact, ran straight through it.
const ballAlongDiameter = (body: "mirror" | "glass", incoming: unknown, form: "ray" | "line" = "ray") => scene(body === "mirror"
  ? "Light reflects from a polished steel ball; another ray runs along a diameter."
  : "Light refracts into a glass ball; another ray runs along a diameter.", [
  { id: "C", kind: "point", role: "centre", label: "C" }, { id: "ball", kind: "circle", role: body === "mirror" ? "reflecting ball" : "glass ball" },
  { id: "hit", kind: "point", role: "point of incidence" }, { id: "nrm", kind: "segment", role: "normal" },
  { id: "out", kind: "ray", role: body === "mirror" ? "reflected ray" : "refracted ray" },
  { id: "src", kind: "point", role: "source" }, { id: "end", kind: "point", role: form === "ray" ? "far point" : "contact on the diameter" },
  { id: "axial", kind: "ray", role: "ray along the diameter" },
  ...form === "line" ? [{ id: "onward", kind: "line", role: "line parallel to the ray" }] : [],
], [
  point("C", 0, 0),
  { id: "make_ball", operator: "circle", inputs: { center: "C", radius: 1.5 }, outputs: ["ball"] },
  point("hit", -Math.sqrt(1.5 ** 2 - 0.75 ** 2), 0.75), point("src", -4, 0), point("end", form === "ray" ? 4 : -1.5, 0),
  { id: "normal", operator: "normal_at", inputs: { point: "hit", surface: "ball" }, outputs: ["nrm"] },
  body === "mirror"
    ? { id: "bounce", operator: "reflect_direction", inputs: { origin: "hit", incoming, normal: "nrm" }, outputs: ["out"] }
    : { id: "bend", operator: "refract_direction", inputs: { origin: "hit", incoming, normal: "nrm", n1: 1, n2: 1.5 }, outputs: ["out"] },
  { id: "make_axial", operator: "segment", inputs: { start: "src", end: "end" }, outputs: ["axial"] },
  ...form === "line" ? [{ id: "make_onward", operator: "parallel_through", inputs: { through: "end", line: "axial" }, outputs: ["onward"] }] : [],
]);

for (const [form, incoming] of [["[1, 0]", [1, 0]], ["{ x: 1, y: 0 }", { x: 1, y: 0 }]] as const) {
  check(`a reflecting ball with literal incoming ${form} cuts a ray along its diameter at its surface`, () => {
    const { ok, primitives, fatal } = compile(ballAlongDiameter("mirror", incoming));
    if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
    const ball = stroke(primitives, "ball");
    const surface = ball.points[0]!.x - ball.radius!;
    const end = Math.max(...xs(stroke(primitives, "axial")));
    return Math.abs(end - surface) > 1.5 ? `the ray ends at x ${end.toFixed(1)}, through the mirror (its near surface is at x ${surface.toFixed(1)})` : null;
  });
}

check("control: a glass ball with literal incoming [1, 0] lets the ray along its diameter through", () => {
  const { ok, primitives, fatal } = compile(ballAlongDiameter("glass", [1, 0]));
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  const ball = stroke(primitives, "ball");
  const far = ball.points[0]!.x + ball.radius! * 4 / 1.5;
  const end = Math.max(...xs(stroke(primitives, "axial")));
  return Math.abs(end - far) > 1.5 ? `the ray ends at x ${end.toFixed(1)}, not at its far point x ${far.toFixed(1)}` : null;
});

check("a line parallel to a ray along a reflecting ball's diameter, the reflection's incoming literal [1, 0], is refused (R6)", () => {
  const { ok, primitives, fatal } = compile(ballAlongDiameter("mirror", [1, 0], "line"));
  if (ok) return `compiled with the line running to x ${Math.max(...xs(stroke(primitives, "onward"))).toFixed(0)} through the mirror`;
  return fatalCodes(fatal).includes("light_line_crosses_element") ? null : `failed with ${fatalCodes(fatal).join(", ")}, not light_line_crosses_element`;
});

check("control: the same line along a glass ball's diameter, incoming literal [1, 0], runs on through it (R6)", () => {
  const { ok, primitives, fatal } = compile(ballAlongDiameter("glass", [1, 0], "line"));
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  const ball = stroke(primitives, "ball");
  return Math.max(...xs(stroke(primitives, "onward"))) < ball.points[0]!.x + ball.radius! + 1.5 ? "the line does not run on through the glass ball" : null;
});

// Sixth review of #164 (thread "Light crosses thick bodies"): R6 skipped every closed
// element whose interior held the line's through point, which is right only for a thin
// lens (rays meet it at its centre plane). A line parallel to the incident ray through a
// point inside a glass ball, off the diameter, was drawn through both faces unbent; inside
// a reflecting ball it was drawn through the mirror.
const ballInteriorLine = (body: "mirror" | "glass", through: [number, number]) => {
  const document = ballDiameterLine(body);
  document.entities = document.entities.filter((entity) => !["src", "contact", "axial"].includes(entity.id));
  document.entities.push({ id: "P", kind: "point", role: "point inside the ball" });
  document.constructions = document.constructions.filter((construction) => !["make_src", "make_contact", "make_axial"].includes(construction.id));
  document.constructions.splice(-1, 1, point("P", ...through), { id: "make_onward", operator: "parallel_through", inputs: { through: "P", line: "inc" }, outputs: ["onward"] });
  const ids = document.entities.map((entity) => entity.id);
  return { ...document, requiredEntityIds: ids, revealGroups: [{ id: "setup", entityIds: ids }] };
};

// Refused, or drawn so that it never crosses the ball's outline.
function stopsAtBall(result: ReturnType<typeof compile>, what: string): string | null {
  if (!result.ok) return fatalCodes(result.fatal).includes("light_line_crosses_element") ? null : `failed with ${fatalCodes(result.fatal).join(", ")}, not light_line_crosses_element`;
  const ball = stroke(result.primitives, "ball");
  const line = stroke(result.primitives, "onward");
  const crossings = xs(line).filter((x) => Math.abs(x - ball.points[0]!.x) > ball.radius! + 1.5).length;
  return crossings > 0 ? `compiled with the line from x ${Math.min(...xs(line)).toFixed(0)} to ${Math.max(...xs(line)).toFixed(0)} ${what} (centre x ${ball.points[0]!.x.toFixed(0)}, radius ${ball.radius!.toFixed(0)})` : null;
}

check("a line parallel to the incident ray through a point inside a glass ball, off the diameter, is cut or refused (R6)", () =>
  stopsAtBall(compile(ballInteriorLine("glass", [0, -0.6])), "through both faces of the glass unbent"));

check("a line parallel to the incident ray through a point inside a reflecting ball, off the diameter, is cut or refused (R6)", () =>
  stopsAtBall(compile(ballInteriorLine("mirror", [0, -0.6])), "through the mirror"));

check("control: a line parallel to the incident ray through a glass ball's centre, along a diameter, runs on through it (R6)", () => {
  const { ok, primitives, fatal } = compile(ballInteriorLine("glass", [0, 0]));
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  const ball = stroke(primitives, "ball");
  const line = xs(stroke(primitives, "onward"));
  return Math.min(...line) > ball.points[0]!.x - ball.radius! - 1.5 || Math.max(...line) < ball.points[0]!.x + ball.radius! + 1.5
    ? "the line does not run through the glass ball along its diameter" : null;
});

// A thin lens drawn as a lens_section, or as a closed outline about the centre plane of an
// optical_focus of kind lens (the ray meets the outline's first edge by surface_contact, so the figure
// has optics); a line parallel to the ray through the optical centre runs straight through.
const thinLensParallelLine = (lens: "lens_section" | "optical_focus") => scene("Oblique parallel rays: the line through the optical centre parallel to the ray goes straight through", [
  { id: "axis_origin", kind: "point", role: "axis start" }, { id: "axis", kind: "line", role: "principal axis" },
  { id: "O", kind: "point", role: "optical centre", label: "O" }, { id: "lens", kind: "polygon", role: "convex lens" },
  { id: "S", kind: "point", role: "source" }, { id: "T", kind: "point", role: "point on the lens" },
  { id: "oblique", kind: "ray", role: "oblique incident ray" }, { id: "onward", kind: "line", role: "line through the optical centre" },
  ...lens === "optical_focus" ? ["L0", "L1", "L2", "L3"].map((id) => ({ id, kind: "point", role: "lens outline" }))
    .concat({ id: "F1", kind: "point", role: "first focus" }, { id: "F2", kind: "point", role: "second focus" }) : [],
], [
  point("axis_origin", -5, 0),
  { id: "make_axis", operator: "line", inputs: { start: "axis_origin", direction: [1, 0] }, outputs: ["axis"] },
  point("O", 0, 0),
  ...lens === "lens_section" ? [
    point("T", 0, 1.2), point("S", -3, 2.2),
    { id: "make_lens", operator: "lens_section", inputs: { center: "O", axis: "axis", radius1: 5, radius2: -5, halfHeight: 1.2 }, outputs: ["lens"] },
    { id: "make_oblique", operator: "segment", inputs: { start: "S", end: "T" }, outputs: ["oblique"] },
  ] : [
    point("L0", 0, 1.2), point("L1", 0.25, 0), point("L2", 0, -1.2), point("L3", -0.25, 0), point("S", -3, 1.6),
    { id: "make_lens", operator: "polygon", inputs: { points: ["L3", "L0", "L1", "L2"] }, outputs: ["lens"] },
    { id: "make_focus", operator: "optical_focus", inputs: { kind: "lens", center: "O", axis: "axis", focalLength: 2, displayScale: 1 }, outputs: ["F1", "F2"] },
    { id: "make_oblique", operator: "surface_contact", inputs: { origin: "S", surface: "lens", direction: [3, -1], which: "nearest_forward" }, outputs: ["T", "oblique"] },
  ],
  { id: "make_onward", operator: "parallel_through", inputs: { through: "O", line: "oblique" }, outputs: ["onward"] },
]);

for (const lens of ["lens_section", "optical_focus"] as const) {
  check(`control: a line parallel to a ray through the centre of a thin lens drawn as ${lens === "lens_section" ? "a lens_section" : "an outline about an optical_focus centre plane"} runs straight through it (R6)`, () => {
    const { ok, primitives, fatal } = compile(thinLensParallelLine(lens));
    if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
    const outline = xs(stroke(primitives, "lens"));
    const line = xs(stroke(primitives, "onward"));
    return Math.min(...line) > Math.min(...outline) - 1.5 || Math.max(...line) < Math.max(...outline) + 1.5
      ? "the line does not run through the lens" : null;
  });
}

// Controls: thick glass crossed a little away from the normal, and a mirror met along
// its normal, still stop the light.
const slabNearNormal = () => scene("A ray refracts into a glass slab at 10 degrees.", [
  { id: "A", kind: "point", role: "corner" }, { id: "B", kind: "point", role: "corner" },
  { id: "C", kind: "point", role: "corner" }, { id: "D", kind: "point", role: "corner" }, { id: "hit", kind: "point", role: "entry" },
  { id: "slab", kind: "polygon", role: "glass slab" }, { id: "top", kind: "segment", role: "top face" },
  { id: "incident", kind: "ray", role: "incident ray" }, { id: "normal", kind: "segment", role: "normal" }, { id: "refracted", kind: "ray", role: "refracted ray" },
], [
  point("A", -2, 0), point("B", 2, 0), point("C", 2, -1.5), point("D", -2, -1.5), point("hit", 0, 0),
  { id: "make_slab", operator: "polygon", inputs: { points: ["A", "B", "C", "D"] }, outputs: ["slab"] },
  { id: "make_top", operator: "segment", inputs: { start: "A", end: "B" }, outputs: ["top"] },
  { id: "r", operator: "refract_at", inputs: { point: "hit", surface: "top", incidentAngleDeg: 10, n1: 1, n2: 1.5, span: 3 }, outputs: ["incident", "normal", "refracted"] },
]);

check("control: a refracted ray meeting the slab's far face 6.6 degrees off the normal is cut there", () => {
  const { ok, primitives, fatal } = compile(slabNearNormal());
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  const ray = stroke(primitives, "refracted");
  const bottom = Math.max(...stroke(primitives, "slab").points.map((p) => p.y));
  if (Math.abs(ray.points.at(-1)!.y - bottom) > 1.5) return `refracted ray ends at y ${ray.points.at(-1)!.y.toFixed(1)}, not at the far face (${bottom.toFixed(1)})`;
  return null;
});

const mirrorNormal = () => scene("A ray reflects from a plane mirror; another meets it along the normal.", [
  { id: "m1", kind: "point", role: "mirror end" }, { id: "m2", kind: "point", role: "mirror end" },
  { id: "mirror", kind: "segment", role: "plane mirror" }, { id: "hit", kind: "point", role: "point of incidence" },
  { id: "incident", kind: "ray", role: "incident ray" }, { id: "normal", kind: "segment", role: "normal" }, { id: "reflected", kind: "ray", role: "reflected ray" },
  { id: "s", kind: "point", role: "source" }, { id: "t", kind: "point", role: "point on the ray" },
  { id: "straight", kind: "ray", role: "ray along the normal" },
], [
  point("m1", -2, 0), point("m2", 2, 0),
  { id: "make_mirror", operator: "segment", inputs: { start: "m1", end: "m2" }, outputs: ["mirror"] },
  point("hit", 0, 0),
  { id: "reflect", operator: "reflect_at", inputs: { point: "hit", surface: "mirror", incidentAngleDeg: 40, span: 1.5 }, outputs: ["incident", "normal", "reflected"] },
  point("s", 1, 1.5), point("t", 1, 0.5),
  { id: "make_straight", operator: "ray", inputs: { start: "s", end: "t" }, outputs: ["straight"] },
]);

check("control: a ray meeting a plane mirror along its normal is cut at the mirror", () => {
  const { ok, primitives, fatal } = compile(mirrorNormal());
  if (!ok) return `did not compile: ${JSON.stringify(fatalCodes(fatal))}`;
  const ray = stroke(primitives, "straight");
  const mirrorY = stroke(primitives, "mirror").points[0]!.y;
  if (Math.abs(ray.points.at(-1)!.y - mirrorY) > 1.5) return `ray ends at y ${ray.points.at(-1)!.y.toFixed(1)}, past the mirror at ${mirrorY.toFixed(1)}`;
  return null;
});

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
