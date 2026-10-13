/**
 * Instrument and axis arrow figures stand on their rays (Harness 4, R4).
 *
 * Round 7 drew a compound microscope with the telescope's parallel bundle:
 * `optical_train` started its rays at the object's foot plus and minus a beam
 * height and ran them parallel to the axis, and the finite instrument
 * normalizer stood the object, intermediate and final arrows at a fixed 0.55
 * height, so no arrow tip lay on a ray. A convex mirror parallax figure stood
 * its object arrow where no ray started.
 *
 * Rule: when a figure draws light paths and declares an optical axis, every
 * arrow standing on that axis has its tip on a drawn ray or a ray's straight
 * extension, else the figure fails closed (`axis_arrow_off_rays`). With an
 * object, `optical_train` starts its rays at the object point and runs them
 * through the image points the chief rays give; the normalizer scales arrow
 * heights by those same chief rays. A telescope (no object) keeps its
 * parallel bundle.
 *
 * Image arrows come from a paraxial model, while the engine traces a
 * reflection or refraction at a spherical surface exactly. Where a traced ray
 * leaves a spherical surface along the exact law, the tip is measured against
 * the paraxial ray from the same contact, so spherical aberration does not
 * decline a correct mirror (recorded 42159a885e4a) and an arrow off that
 * paraxial ray still fails closed.
 *
 * A drawn segment counts as a ray only when it is joined to the light and does
 * not stand across the axis: a screen at the image's x, a segment along the
 * arrow, or a stray segment through a misplaced tip passes no image height
 * (third review of #164).
 *
 * Arrow and ray positions are read from the rendered primitives, not from the
 * engine's own check.
 *
 * R5: the image one refracting spherical surface forms comes from
 * `evaluateOpticsLaw("spherical_refraction")` through the operator
 * `sphericalRefractionImage`. Round 7 (m1, glass sphere h8a) placed a bubble's
 * images at literal points 2.29 and 5.33 cm from the surfaces; the law gives
 * 3.2 cm and 16 cm (at the near surface). A literal image at a plan-derived
 * distance from a surface vertex that the law does not give is reported
 * (`spherical_refraction_image_disagrees`); production selection declines it.
 * Only surfaces the document declares refracting are held to the law (a
 * refraction event there, or both faces of one ball): spherical_surface also
 * draws mirrors, and a concave mirror's correct image must not be compared
 * with the refraction of an index found elsewhere in the plan.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-ray-optics-instruments.ts
 */
import { readFileSync } from "node:fs";
import * as engine from "../../src";
import { compileSceneDocument, pruneDeadSceneEntities, validateSceneDocument } from "../../src";

type P = { x: number; y: number };
type Primitive = { id: string; entityId?: string; kind: string; points: P[] };
type Entity = { id: string; kind: string; role: string; label?: string };
type Construction = { id: string; operator: string; inputs: Record<string, unknown>; outputs: string[] };
type Doc = { entities: Entity[]; constructions: Construction[] };

const fixture = JSON.parse(readFileSync(new URL("./fixtures/ray-optics-instruments.json", import.meta.url), "utf8")) as {
  documents: Record<string, Record<string, unknown>>;
  plans: Record<string, Record<string, unknown>>;
};
const failures: string[] = [];
let passed = 0;
const PIXEL_TOLERANCE = 3;

function check(name: string, run: () => string | null): void {
  let problem: string | null;
  try { problem = run(); } catch (error) { problem = `threw: ${error instanceof Error ? error.message : String(error)}`; }
  if (problem) { failures.push(`${name}: ${problem}`); console.log(`FAIL ${name}: ${problem}`); }
  else { passed += 1; console.log(`pass ${name}`); }
}

function scene(question: string, entities: Entity[], constructions: Construction[], assertions: unknown[] = []) {
  const ids = entities.map((entity) => entity.id);
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: question },
    source: { question },
    quantities: [],
    entities,
    constructions,
    relations: [],
    assertions,
    annotations: [],
    requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids }],
    teachingTimeline: [{ action: "reveal", targetId: "setup" }],
  };
}

const point = (id: string, x: number, y: number): Construction =>
  ({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] });

/** As production validation does: prune dead entities, validate (normalizers run here), compile. */
function compile(raw: Record<string, unknown>) {
  const validated = validateSceneDocument(pruneDeadSceneEntities(structuredClone(raw)));
  const compiled = validated.document ? compileSceneDocument(validated.document) : null;
  const fatal = (compiled?.report ?? validated.report).issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code);
  return {
    ok: Boolean(compiled?.ok && compiled.renderScene),
    primitives: (compiled?.renderScene?.primitives ?? []) as Primitive[],
    document: (validated.document ?? raw) as unknown as Doc,
    fatal,
  };
}

const AXIS_OPERATORS = new Set(["lens_section", "spherical_surface", "optical_train", "gaussian_image", "optical_focus"]);

function lightPathIds(document: Doc): Set<string> {
  const ids = new Set(document.entities.filter((entity) => entity.kind === "ray").map((entity) => entity.id));
  for (const construction of document.constructions) {
    const outputs = construction.outputs ?? [];
    if (["optical_train", "ray", "refract_direction", "reflect_direction"].includes(construction.operator)) outputs.forEach((id) => ids.add(id));
    if (construction.operator === "refract_at" || construction.operator === "reflect_at") [outputs[0], outputs[2]].forEach((id) => id && ids.add(id));
    if (construction.operator === "surface_contact" && outputs[1]) ids.add(outputs[1]);
  }
  return ids;
}

const lineDistance = (p: P, a: P, b: P) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  return length > 0 ? Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / length : Math.hypot(p.x - a.x, p.y - a.y);
};
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const stroke = (primitives: Primitive[], id: string) => primitives.find((primitive) => primitive.id === `primitive_${id}`);

/** Arrows standing on a declared axis, with the rays their tips are on (empty when off every ray). */
function axisArrows(document: Doc, primitives: Primitive[]) {
  const axes = document.constructions
    .filter((construction) => AXIS_OPERATORS.has(construction.operator) && typeof construction.inputs?.axis === "string")
    .flatMap((construction) => {
      const found = stroke(primitives, construction.inputs.axis as string);
      return found ? [found.points] : [];
    });
  const rayIds = lightPathIds(document);
  const rays = primitives.filter((primitive) => primitive.entityId && rayIds.has(primitive.entityId) && primitive.id === `primitive_${primitive.entityId}`);
  const vectorIds = new Set(document.constructions.filter((construction) => construction.operator === "vector").flatMap((construction) => construction.outputs));
  return primitives
    .filter((primitive) => primitive.kind === "vector" && primitive.entityId && vectorIds.has(primitive.entityId) && primitive.id === `primitive_${primitive.entityId}`)
    .flatMap((arrow) => {
      const foot = arrow.points[0]!;
      const tip = arrow.points.at(-1)!;
      const stands = axes.some((axis) => {
        const [a, b] = [axis[0]!, axis.at(-1)!];
        if (lineDistance(foot, a, b) > PIXEL_TOLERANCE) return false;
        const along = Math.abs((b.x - a.x) * (tip.x - foot.x) + (b.y - a.y) * (tip.y - foot.y));
        return along <= 0.2 * dist(a, b) * dist(foot, tip);
      });
      if (!stands) return [];
      const on = rays.filter((ray) => ray.points.some((p, index) =>
        index + 1 < ray.points.length && lineDistance(tip, p, ray.points[index + 1]!) <= PIXEL_TOLERANCE));
      return [{ id: arrow.entityId!, tip, on: on.map((ray) => ray.entityId!) }];
    });
}

function drawsOnRaysOrFailsClosed(raw: Record<string, unknown>): string | null {
  const { ok, primitives, document, fatal } = compile(raw);
  if (!ok) {
    console.log(`   fails closed: ${[...new Set(fatal)].join(", ")}`);
    return null;
  }
  const arrows = axisArrows(document, primitives);
  if (arrows.length === 0) return "draws, but no arrow stands on the declared axis";
  const off = arrows.filter((arrow) => arrow.on.length === 0);
  if (off.length > 0) return `draws with ${off.map((arrow) => arrow.id).join(", ")} off every ray`;
  return null;
}

// Recorded m2 compound microscope h8u: the normalizer built the chain and optical_train drew a telescope bundle.
check("recorded microscope: arrows on rays from the object tip, or fail closed", () => {
  const raw = fixture.documents.microscope!;
  const problem = drawsOnRaysOrFailsClosed(raw);
  if (problem) return problem;
  const { ok, primitives, document } = compile(raw);
  if (!ok) return null;
  const train = document.constructions.find((construction) => construction.operator === "optical_train");
  if (!train) return "no optical_train";
  const objectTip = stroke(primitives, String(document.constructions.find((construction) =>
    construction.operator === "vector" && construction.inputs.start === train.inputs.object)?.outputs[0] ?? ""))?.points.at(-1)
    ?? stroke(primitives, String(train.inputs.object))?.points[0];
  const incoming = train.outputs.slice(0, 2).map((id) => stroke(primitives, id));
  if (!objectTip || incoming.some((ray) => !ray)) return "missing object tip or incoming rays";
  const starts = incoming.map((ray) => dist(ray!.points[0]!, objectTip));
  if (starts.some((gap) => gap > PIXEL_TOLERANCE)) return `incoming rays start ${starts.map((gap) => gap.toFixed(1)).join(", ")} px from the object tip (parallel bundle)`;
  return null;
});

// Recorded m2 convex mirror parallax h8u: rays start on the lens, not at the object arrow's tip.
check("recorded convex mirror parallax: arrows on rays, or fail closed", () => drawsOnRaysOrFailsClosed(fixture.documents.parallax!));

// A finite object instrument built directly: object 0.5 above the axis, intermediate and final image
// arrows placed where the chief rays through each lens centre put them.
const finiteMicroscope = () => {
  const xO = 0; const xCo = 1.5; const xI = 3.2; const xCe = 5; const xF = -2.5; const hO = 0.5;
  const hI = hO * (xI - xCo) / (xO - xCo);
  const hF = hI * (xF - xCe) / (xI - xCe);
  return scene("A compound microscope forms an enlarged final virtual image.", [
    { id: "Ob", kind: "point", role: "object foot" },
    { id: "Ot", kind: "point", role: "object tip" },
    { id: "Co", kind: "point", role: "objective centre", label: "Lo" },
    { id: "Ib", kind: "point", role: "intermediate foot" },
    { id: "It", kind: "point", role: "intermediate tip" },
    { id: "Ce", kind: "point", role: "eyepiece centre", label: "Le" },
    { id: "Fb", kind: "point", role: "final foot" },
    { id: "Ft", kind: "point", role: "final tip" },
    { id: "axis", kind: "line", role: "optical axis" },
    { id: "objective", kind: "line", role: "objective", label: "Objective" },
    { id: "eyepiece", kind: "line", role: "eyepiece", label: "Eyepiece" },
    { id: "objectArrow", kind: "vector", role: "object", label: "AB" },
    { id: "imageArrow", kind: "vector", role: "real image", label: "A'B'" },
    { id: "finalArrow", kind: "vector", role: "virtual image", label: "A''B''" },
    { id: "in1", kind: "ray", role: "ray" }, { id: "in2", kind: "ray", role: "ray" },
    { id: "mid1", kind: "ray", role: "ray" }, { id: "mid2", kind: "ray", role: "ray" },
    { id: "out1", kind: "ray", role: "ray" }, { id: "out2", kind: "ray", role: "ray" },
  ], [
    point("Ob", xO, 0), point("Ot", xO, hO), point("Co", xCo, 0), point("Ib", xI, 0), point("It", xI, hI),
    point("Ce", xCe, 0), point("Fb", xF, 0), point("Ft", xF, hF),
    { id: "make_axis", operator: "line", inputs: { start: "Ob", end: "Ce" }, outputs: ["axis"] },
    { id: "make_objective", operator: "perpendicular_through", inputs: { through: "Co", line: "axis" }, outputs: ["objective"] },
    { id: "make_eyepiece", operator: "perpendicular_through", inputs: { through: "Ce", line: "axis" }, outputs: ["eyepiece"] },
    { id: "make_objectArrow", operator: "vector", inputs: { start: "Ob", end: "Ot" }, outputs: ["objectArrow"] },
    { id: "make_imageArrow", operator: "vector", inputs: { start: "Ib", end: "It" }, outputs: ["imageArrow"] },
    { id: "make_finalArrow", operator: "vector", inputs: { start: "Fb", end: "Ft" }, outputs: ["finalArrow"] },
    {
      id: "make_train", operator: "optical_train",
      inputs: { axis: "axis", objective: "objective", eyepiece: "eyepiece", focus: "Ib", object: "Ot", finalImage: "Fb" },
      outputs: ["in1", "in2", "mid1", "mid2", "out1", "out2"],
    },
  ], [
    { id: "objective_perp", predicate: "perpendicular", entities: ["objective", "axis"], expected: true, severity: "fatal" },
    { id: "eyepiece_perp", predicate: "perpendicular", entities: ["eyepiece", "axis"], expected: true, severity: "fatal" },
  ]);
};

check("optical_train with an object: rays leave the object tip and meet the image tips", () => {
  const { ok, primitives, document, fatal } = compile(finiteMicroscope());
  if (!ok) return `did not compile: ${fatal.join(", ")}`;
  const tip = (id: string) => stroke(primitives, id)!.points.at(-1)!;
  for (const id of ["in1", "in2"]) {
    const gap = dist(stroke(primitives, id)!.points[0]!, tip("objectArrow"));
    if (gap > 1.5) return `${id} starts ${gap.toFixed(1)} px from the object tip`;
  }
  for (const id of ["mid1", "mid2"]) {
    const points = stroke(primitives, id)!.points;
    const gap = Math.min(...points.map((p) => dist(p, tip("imageArrow"))));
    if (gap > 1.5) return `${id} passes ${gap.toFixed(1)} px from the intermediate image tip`;
  }
  for (const id of ["out1", "out2"]) {
    const [a, b] = stroke(primitives, id)!.points;
    const gap = lineDistance(tip("finalArrow"), a!, b!);
    if (gap > 1.5) return `${id} extended passes ${gap.toFixed(1)} px from the final image tip`;
  }
  const off = axisArrows(document, primitives).filter((arrow) => arrow.on.length === 0);
  if (off.length > 0) return `${off.map((arrow) => arrow.id).join(", ")} off every ray`;
  return null;
});

// Telescope: no object, the incoming bundle stays parallel to the axis and meets at the shared focus.
const telescope = () => scene("An astronomical telescope in normal adjustment.", [
  { id: "A", kind: "point", role: "axis start" }, { id: "B", kind: "point", role: "axis end" },
  { id: "Co", kind: "point", role: "objective centre" }, { id: "Ce", kind: "point", role: "eyepiece centre" },
  { id: "F", kind: "point", role: "shared focus", label: "F" },
  { id: "axis", kind: "line", role: "optical axis" },
  { id: "objective", kind: "line", role: "objective", label: "Objective" },
  { id: "eyepiece", kind: "line", role: "eyepiece", label: "Eyepiece" },
  { id: "in1", kind: "ray", role: "ray" }, { id: "in2", kind: "ray", role: "ray" },
  { id: "mid1", kind: "ray", role: "ray" }, { id: "mid2", kind: "ray", role: "ray" },
  { id: "out1", kind: "ray", role: "ray" }, { id: "out2", kind: "ray", role: "ray" },
], [
  point("A", -4, 0), point("B", 6, 0), point("Co", 0, 0), point("Ce", 5, 0), point("F", 4, 0),
  { id: "make_axis", operator: "line", inputs: { start: "A", end: "B" }, outputs: ["axis"] },
  { id: "make_objective", operator: "perpendicular_through", inputs: { through: "Co", line: "axis" }, outputs: ["objective"] },
  { id: "make_eyepiece", operator: "perpendicular_through", inputs: { through: "Ce", line: "axis" }, outputs: ["eyepiece"] },
  {
    id: "make_train", operator: "optical_train",
    inputs: { axis: "axis", objective: "objective", eyepiece: "eyepiece", focus: "F", beamHalfHeight: 0.8, raySpan: 2 },
    outputs: ["in1", "in2", "mid1", "mid2", "out1", "out2"],
  },
], [
  { id: "objective_perp", predicate: "perpendicular", entities: ["objective", "axis"], expected: true, severity: "fatal" },
  { id: "eyepiece_perp", predicate: "perpendicular", entities: ["eyepiece", "axis"], expected: true, severity: "fatal" },
]);

check("control: a telescope with its object at infinity keeps the parallel bundle", () => {
  const { ok, primitives, fatal } = compile(telescope());
  if (!ok) return `did not compile: ${fatal.join(", ")}`;
  const axis = stroke(primitives, "axis")!.points;
  const axisAngle = Math.atan2(axis.at(-1)!.y - axis[0]!.y, axis.at(-1)!.x - axis[0]!.x);
  for (const id of ["in1", "in2", "out1", "out2"]) {
    const [a, b] = stroke(primitives, id)!.points;
    const angle = Math.atan2(b!.y - a!.y, b!.x - a!.x);
    const skew = Math.abs(Math.sin(angle - axisAngle));
    if (skew > 1e-3) return `${id} is not parallel to the axis (sin ${skew.toFixed(4)})`;
  }
  const focus = stroke(primitives, "F")!.points[0]!;
  for (const id of ["mid1", "mid2"]) {
    if (!stroke(primitives, id)!.points.some((p) => dist(p, focus) < 1)) return `${id} does not pass the shared focus`;
  }
  return null;
});

// The rule on its own: a thin lens with an object arrow, and one ray that leaves its tip or misses it.
const thinLensArrow = (rayFrom: "tip" | "elsewhere") => scene("An object in front of a thin convex lens.", [
  { id: "A", kind: "point", role: "axis start" },
  { id: "axis", kind: "line", role: "principal axis" },
  { id: "O", kind: "point", role: "optical centre", label: "O" },
  { id: "lens", kind: "polygon", role: "convex lens" },
  { id: "foot", kind: "point", role: "object foot" },
  { id: "tip", kind: "point", role: "object tip", label: "B" },
  { id: "start", kind: "point", role: "ray start" },
  { id: "object", kind: "vector", role: "object", label: "AB" },
  { id: "centralRay", kind: "ray", role: "ray through the optical centre" },
], [
  point("A", -5, 0),
  { id: "make_axis", operator: "line", inputs: { start: "A", direction: [1, 0] }, outputs: ["axis"] },
  point("O", 0, 0),
  { id: "make_lens", operator: "lens_section", inputs: { center: "O", axis: "axis", radius1: 5, radius2: -5, halfHeight: 1.2 }, outputs: ["lens"] },
  point("foot", -3, 0),
  point("tip", -3, 1),
  point("start", -3, rayFrom === "tip" ? 1 : 0.4),
  { id: "make_object", operator: "vector", inputs: { start: "foot", end: "tip" }, outputs: ["object"] },
  { id: "make_ray", operator: "ray", inputs: { start: "start", end: "O" }, outputs: ["centralRay"] },
]);

check("an object arrow whose tip is on no ray fails closed", () => {
  const { ok, fatal } = compile(thinLensArrow("elsewhere"));
  if (ok) return "compiled with the object arrow off the only ray";
  if (!fatal.includes("axis_arrow_off_rays")) return `failed with ${fatal.join(", ")}, not axis_arrow_off_rays`;
  return null;
});

check("control: an object arrow whose tip a ray leaves compiles", () => {
  const { ok, fatal } = compile(thinLensArrow("tip"));
  return ok ? null : `did not compile: ${fatal.join(", ")}`;
});

// Second review of #164 (R4): planners often draw rays as segments. When one `ray`
// entity exists, a correct object or image arrow standing on segment rays was refused.
// A ray now is any drawn open straight path that is not an axis, a normal, an element
// or a standing arrow.
const review = JSON.parse(readFileSync(new URL("./fixtures/ray-optics-review-164.json", import.meta.url), "utf8")) as {
  documents: Record<string, { why: string; document: Record<string, unknown> }>;
};
const reviewed = (id: string) => structuredClone(review.documents[id]!.document) as Record<string, any>;
const tipsOnStrokes = (primitives: Primitive[], arrowIds: string[], rayIds: string[]): string | null => {
  for (const arrowId of arrowIds) {
    const arrow = stroke(primitives, arrowId);
    if (!arrow) return `${arrowId} is not drawn`;
    const tip = arrow.points.at(-1)!;
    const on = rayIds.some((rayId) => {
      const ray = stroke(primitives, rayId);
      return Boolean(ray) && ray!.points.some((p, index) => index + 1 < ray!.points.length && lineDistance(tip, p, ray!.points[index + 1]!) <= 2);
    });
    if (!on) return `${arrowId} tip is on none of ${rayIds.join(", ")}`;
  }
  return null;
};

check("recorded bcaf2215e808: a real image between F and 2F with segment rays compiles", () => {
  const { ok, primitives, fatal } = compile(reviewed("bcaf2215e808"));
  if (!ok) return `did not compile: ${fatal.join(", ")}`;
  return tipsOnStrokes(primitives, ["object", "image"], ["parallelRay", "centralIncident", "refractedRay", "centralOutgoing"]);
});

check("recorded 9cfc03a682ea: a magnifier's virtual image on the segment rays' extensions compiles", () => {
  const { ok, primitives, fatal } = compile(reviewed("9cfc03a682ea"));
  if (!ok) return `did not compile: ${fatal.join(", ")}`;
  return tipsOnStrokes(primitives, ["object", "image"], ["incoming", "central", "outgoing"]);
});

check("control: bcaf2215e808 with its image arrow moved to x = 5, off every segment ray, fails closed", () => {
  const document = reviewed("bcaf2215e808");
  const constructions = document.constructions as Construction[];
  constructions.push(point("wrongTip", 5, -2));
  constructions.find((construction) => construction.outputs.includes("imageBase"))!.inputs = { x: 5, y: 0, coordinateSpace: "world" };
  constructions.find((construction) => construction.outputs.includes("image"))!.inputs = { start: "imageBase", end: "wrongTip" };
  (document.entities as Entity[]).push({ id: "wrongTip", kind: "point", role: "misplaced image tip" });
  (document.requiredEntityIds as string[]).push("wrongTip");
  const { ok, fatal } = compile(document);
  if (ok) return "compiled with the image arrow off every ray";
  if (!fatal.includes("axis_arrow_off_rays")) return `failed with ${fatal.join(", ")}, not axis_arrow_off_rays`;
  return null;
});

// Recorded 42159a885e4a: a concave mirror (R 2, f -1) with the object at u -3 and the image
// drawn by gaussian_image at v -1.5. The engine traces the reflected ray exactly on the sphere
// (contact 0.5 above the axis), so spherical aberration takes it across the axis at -0.967 and
// about 4 px from the paraxial image tip. The image model is paraxial, so the tip is measured
// against the paraxial ray from the same contact.
const mirrorImageTip = (document: Record<string, any>, tip: P) => {
  const constructions = document.constructions as Construction[];
  constructions.push(point("wrongTip", tip.x, tip.y));
  constructions.find((construction) => construction.outputs.includes("image"))!.inputs = { start: "imageBase", end: "wrongTip" };
  (document.entities as Entity[]).push({ id: "wrongTip", kind: "point", role: "misplaced image tip" });
  return document;
};
const failsOffRays = (document: Record<string, unknown>): string | null => {
  const { ok, fatal } = compile(document);
  if (ok) return "compiled with the image arrow off every ray";
  if (!fatal.includes("axis_arrow_off_rays")) return `failed with ${fatal.join(", ")}, not axis_arrow_off_rays`;
  return null;
};

// Third review of #164 (thread "Screens approve wrong image heights"): every drawn segment
// counted as a ray, so a screen drawn as a `segment` at the image's x passed an image arrow
// of any height (the arrow lies along the screen), and a stray segment drawn through a
// misplaced tip passed it too. A stroke that is not a declared light path is a ray only
// when it does not stand across the axis an arrow stands on and an end of it is joined to
// the light (a declared ray, an element's boundary, a thin lens, or a stroke already joined).
const withSegment = (document: ReturnType<typeof reviewed>, id: string, from: [number, number], to: [number, number], role: string) => {
  const constructions = document.constructions as Construction[];
  constructions.push(point(`${id}From`, ...from), point(`${id}To`, ...to));
  constructions.push({ id: `make_${id}`, operator: "segment", inputs: { start: `${id}From`, end: `${id}To` }, outputs: [id] });
  (document.entities as Entity[]).push({ id: `${id}From`, kind: "point", role: "construction helper" }, { id: `${id}To`, kind: "point", role: "construction helper" }, { id, kind: "segment", role });
  (document.requiredEntityIds as string[]).push(id);
  return document;
};
/** bcaf2215e808 with its image arrow at x = 6 but 1 below the axis: the rays meet 2 below. */
const shortImage = () => {
  const document = reviewed("bcaf2215e808");
  const constructions = document.constructions as Construction[];
  constructions.push(point("wrongTip", 6, -1));
  constructions.find((construction) => construction.outputs.includes("image"))!.inputs = { start: "imageBase", end: "wrongTip" };
  (document.entities as Entity[]).push({ id: "wrongTip", kind: "point", role: "misplaced image tip" });
  (document.requiredEntityIds as string[]).push("wrongTip");
  return document;
};

check("a screen drawn as a segment at the image's x does not pass an image arrow of the wrong height", () =>
  failsOffRays(withSegment(shortImage(), "screen", [6, -2.5], [6, 2.5], "screen")));

check("a screen segment ending where the rays meet (joined to them) does not pass it either", () =>
  failsOffRays(withSegment(shortImage(), "screen", [6, 1.5], [6, -2], "screen")));

check("a screen across the axis passes no tip, even of an arrow standing a little off it (foot x 5.9, tip on the screen at x 6)", () => {
  const document = withSegment(shortImage(), "screen", [6, 1.5], [6, -2], "screen");
  (document.constructions as Construction[]).find((construction) => construction.outputs.includes("imageBase"))!.inputs = { x: 5.9, y: 0, coordinateSpace: "world" };
  return failsOffRays(document);
});

check("a declared ray drawn along the misplaced arrow itself does not pass it", () => {
  const document = withSegment(shortImage(), "alongArrow", [6, 0.5], [6, -1.5], "image ray");
  (document.entities as Entity[]).find((entity) => entity.id === "alongArrow")!.kind = "ray";
  return failsOffRays(document);
});

// Corpus 1366f929fd68: a flagpole 12 m tall, 64 m from a lens of focal length 8 cm. The image
// arrow is shorter than the tolerance, so every ray through its tip also passes its foot; it
// still stands on the two declared rays that meet at its tip.
check("control: an image arrow shorter than the tolerance, its tip where two declared rays meet, is on them", () => {
  const document = scene("A converging lens of focal length 8 cm images a flagpole 12 m tall 64 m away.", [
    { id: "O", kind: "point", role: "optical centre", label: "O" }, { id: "axis", kind: "line", role: "principal axis" },
    { id: "lens", kind: "polygon", role: "converging lens" }, { id: "F2", kind: "point", role: "image-side focus" },
    { id: "ob", kind: "point", role: "flagpole foot" }, { id: "ot", kind: "point", role: "flagpole tip" },
    { id: "obj", kind: "vector", role: "flagpole" }, { id: "P", kind: "point", role: "parallel-ray lens crossing" },
    { id: "r1i", kind: "segment", role: "incident parallel ray" }, { id: "r1o", kind: "ray", role: "ray through image-side focus" },
    { id: "r2", kind: "ray", role: "ray through optical centre" }, { id: "it", kind: "point", role: "image tip" },
    { id: "ib", kind: "point", role: "image foot" }, { id: "img", kind: "vector", role: "real inverted image" },
  ], [
    point("O", 0, 0),
    { id: "make_axis", operator: "line", inputs: { start: "O", direction: [1, 0] }, outputs: ["axis"] },
    { id: "make_lens", operator: "lens_section", inputs: { center: "O", axis: "axis", radius1: 40, radius2: -40, halfHeight: 14 }, outputs: ["lens"] },
    point("F2", 0.08, 0), point("ob", -64, 0), point("ot", -64, 12), point("P", 0, 12),
    { id: "make_obj", operator: "vector", inputs: { start: "ob", end: "ot" }, outputs: ["obj"] },
    { id: "make_r1i", operator: "segment", inputs: { start: "ot", end: "P" }, outputs: ["r1i"] },
    { id: "make_r1o", operator: "ray", inputs: { start: "P", end: "F2" }, outputs: ["r1o"] },
    { id: "make_r2", operator: "ray", inputs: { start: "ot", end: "O" }, outputs: ["r2"] },
    { id: "make_it", operator: "intersection", inputs: { first: "r1o", second: "r2" }, outputs: ["it"] },
    point("ib", 0.08 * 64 / (64 - 0.08), 0),
    { id: "make_img", operator: "vector", inputs: { start: "ib", end: "it" }, outputs: ["img"] },
  ]);
  const { fatal } = compile(document);
  return fatal.includes("axis_arrow_off_rays") ? `refused the tiny image arrow: ${fatal.join(", ")}` : null;
});

check("a stray segment through the misplaced tip, joined to no ray, does not pass it", () =>
  failsOffRays(withSegment(shortImage(), "stray", [4.5, -1], [7.5, -1], "image height mark")));

check("control: bcaf2215e808 with a screen segment at its correct image compiles", () => {
  const { ok, primitives, fatal } = compile(withSegment(reviewed("bcaf2215e808"), "screen", [6, -2.5], [6, 2.5], "screen"));
  if (!ok) return `did not compile: ${fatal.join(", ")}`;
  return tipsOnStrokes(primitives, ["object", "image"], ["parallelRay", "centralIncident", "refractedRay", "centralOutgoing"]);
});

check("control: 9cfc03a682ea with a screen segment at its virtual image compiles", () => {
  const { ok, fatal } = compile(withSegment(reviewed("9cfc03a682ea"), "screen", [-18, -3], [-18, 3], "screen"));
  return ok ? null : `did not compile: ${fatal.join(", ")}`;
});

check("recorded 42159a885e4a: a concave mirror's paraxial image beside the exactly traced reflected ray compiles", () => {
  const { ok, primitives, fatal } = compile(reviewed("42159a885e4a"));
  if (!ok) return `did not compile: ${fatal.join(", ")}`;
  const tip = stroke(primitives, "image")?.points.at(-1);
  const reflected = stroke(primitives, "reflected")?.points;
  if (!tip || !reflected) return "image or reflected ray not drawn";
  const gap = lineDistance(tip, reflected[0]!, reflected.at(-1)!);
  console.log(`   reflected ray passes ${gap.toFixed(1)} px from the image tip (spherical aberration)`);
  return gap > 8 ? `reflected ray passes ${gap.toFixed(1)} px from the image tip` : null;
});

check("control: 42159a885e4a with its image tip moved 0.04 off the paraxial ray fails closed", () =>
  failsOffRays(mirrorImageTip(reviewed("42159a885e4a"), { x: -1.5, y: -0.21 })));

check("control: 42159a885e4a reflected about a tilted normal does not borrow the paraxial ray", () => {
  const document = reviewed("42159a885e4a");
  const constructions = document.constructions as Construction[];
  constructions.push(point("tilt", -2, 0.3));
  const normal = constructions.find((construction) => construction.outputs.includes("normalHelper"))!;
  Object.assign(normal, { operator: "segment", inputs: { start: "hit", end: "tilt" } });
  return failsOffRays(document);
});

// The same for refraction: a convex glass face (R 2, n 1 to 1.5) with the object 8 before it.
// The law puts the image 12 past the vertex, inverted at the same height; the ray refracted
// exactly 1 above the axis crosses x = 12 at -1.18.
const refractingFace = (imageTip: P) => scene("An object 8 units before a convex glass surface of radius 2 and index 1.5.", [
  { id: "A", kind: "point", role: "axis start" }, { id: "B", kind: "point", role: "axis end" },
  { id: "V", kind: "point", role: "vertex" }, { id: "C", kind: "point", role: "centre of curvature", label: "C" },
  { id: "Ob", kind: "point", role: "object foot" }, { id: "Ot", kind: "point", role: "object tip" },
  { id: "Ib", kind: "point", role: "image foot" }, { id: "It", kind: "point", role: "image tip" },
  { id: "axis", kind: "line", role: "principal axis" },
  { id: "face", kind: "arc", role: "refracting surface" },
  { id: "object", kind: "vector", role: "object" }, { id: "image", kind: "vector", role: "real image" },
  { id: "incident", kind: "ray", role: "incident ray" }, { id: "refracted", kind: "ray", role: "refracted ray" },
], [
  point("A", -9, 0), point("B", 14, 0), point("V", 0, 0), point("C", 2, 0),
  point("Ob", -8, 0), point("Ot", -8, 1), point("Ib", 12, 0), point("It", imageTip.x, imageTip.y),
  { id: "make_axis", operator: "line", inputs: { start: "A", end: "B" }, outputs: ["axis"] },
  { id: "make_face", operator: "spherical_surface", inputs: { vertex: "V", axis: "axis", center: "C", halfHeight: 1.3 }, outputs: ["face"] },
  { id: "make_object", operator: "vector", inputs: { start: "Ob", end: "Ot" }, outputs: ["object"] },
  { id: "make_image", operator: "vector", inputs: { start: "Ib", end: "It" }, outputs: ["image"] },
  { id: "meet", operator: "surface_contact", inputs: { origin: "Ot", surface: "face", direction: [1, 0], which: "nearest_forward" }, outputs: ["hit", "incident"] },
  { id: "normal", operator: "normal_at", inputs: { point: "hit", surface: "face" }, outputs: ["faceNormal"] },
  { id: "refract", operator: "refract_direction", inputs: { origin: "hit", incoming: "incident", normal: "faceNormal", n1: 1, n2: 1.5 }, outputs: ["refracted"] },
]);

check("a convex glass face's paraxial image beside the exactly refracted ray compiles", () => {
  const { ok, primitives, fatal } = compile(refractingFace({ x: 12, y: -1 }));
  if (!ok) return `did not compile: ${fatal.join(", ")}`;
  const tip = stroke(primitives, "image")?.points.at(-1);
  const refracted = stroke(primitives, "refracted")?.points;
  if (!tip || !refracted) return "image or refracted ray not drawn";
  console.log(`   refracted ray passes ${lineDistance(tip, refracted[0]!, refracted.at(-1)!).toFixed(1)} px from the image tip`);
  return null;
});

check("control: the glass face's image tip 0.1 off the paraxial ray fails closed", () => failsOffRays(refractingFace({ x: 12, y: -0.9 })));

// Fourth review of #164 (thread "Unrelated axes reject valid rays"): the stands across test
// ran against every axis with an arrow on it. With two setups on different axes, a lens on a
// horizontal axis whose rays are segments and a lens on a vertical axis, the horizontal
// setup's segment rays stand across the vertical axis and were dropped, so its correct
// object arrow failed. A stroke is dropped only for an arrow on the axis it stands across.
const twoSetups = (objectRayHeight: number) => scene("Two thin lenses, one on a horizontal axis and one on a vertical axis.", [
  { id: "A1", kind: "point", role: "axis start" },
  { id: "axis1", kind: "line", role: "principal axis" },
  { id: "O1", kind: "point", role: "optical centre" },
  { id: "lens1", kind: "polygon", role: "convex lens" },
  { id: "foot1", kind: "point", role: "object foot" },
  { id: "tip1", kind: "point", role: "object tip" },
  { id: "rayStart1", kind: "point", role: "ray start" },
  { id: "rayEnd1", kind: "point", role: "ray end at the lens" },
  { id: "object1", kind: "vector", role: "object" },
  { id: "parallelRay1", kind: "segment", role: "ray parallel to the axis" },
  { id: "A2", kind: "point", role: "axis start" },
  { id: "axis2", kind: "line", role: "principal axis" },
  { id: "O2", kind: "point", role: "optical centre" },
  { id: "lens2", kind: "polygon", role: "convex lens" },
  { id: "foot2", kind: "point", role: "object foot" },
  { id: "tip2", kind: "point", role: "object tip" },
  { id: "object2", kind: "vector", role: "object" },
  { id: "centralRay2", kind: "ray", role: "ray through the optical centre" },
], [
  point("A1", -5, 0),
  { id: "make_axis1", operator: "line", inputs: { start: "A1", direction: [1, 0] }, outputs: ["axis1"] },
  point("O1", 0, 0),
  { id: "make_lens1", operator: "lens_section", inputs: { center: "O1", axis: "axis1", radius1: 5, radius2: -5, halfHeight: 1.2 }, outputs: ["lens1"] },
  point("foot1", -3, 0), point("tip1", -3, 1),
  point("rayStart1", -3, objectRayHeight), point("rayEnd1", 0, objectRayHeight),
  { id: "make_object1", operator: "vector", inputs: { start: "foot1", end: "tip1" }, outputs: ["object1"] },
  { id: "make_parallelRay1", operator: "segment", inputs: { start: "rayStart1", end: "rayEnd1" }, outputs: ["parallelRay1"] },
  point("A2", 10, -5),
  { id: "make_axis2", operator: "line", inputs: { start: "A2", direction: [0, 1] }, outputs: ["axis2"] },
  point("O2", 10, 0),
  { id: "make_lens2", operator: "lens_section", inputs: { center: "O2", axis: "axis2", radius1: 5, radius2: -5, halfHeight: 1.2 }, outputs: ["lens2"] },
  point("foot2", 10, -3), point("tip2", 11, -3),
  { id: "make_object2", operator: "vector", inputs: { start: "foot2", end: "tip2" }, outputs: ["object2"] },
  { id: "make_centralRay2", operator: "ray", inputs: { start: "tip2", end: "O2" }, outputs: ["centralRay2"] },
]);

check("two setups on crossed axes: the horizontal setup's segment ray, across only the other axis, holds its object arrow", () => {
  const { ok, fatal, primitives } = compile(twoSetups(1));
  if (!ok) return `did not compile: ${fatal.join(", ")}`;
  return tipsOnStrokes(primitives, ["object1"], ["parallelRay1"]);
});

check("control: two setups on crossed axes, the horizontal setup's segment ray leaving below its object tip, fails closed", () =>
  failsOffRays(twoSetups(0.6)));

// R5. Looked up by name so the cases fail, not crash, where the operator is missing.
type LawPoint = { x: number; y: number };
const operator = (name: string) => {
  const found = (engine as unknown as Record<string, unknown>)[name];
  if (typeof found !== "function") throw new Error(`scene-engine does not export ${name}`);
  return found as (...args: unknown[]) => unknown;
};

check("sphericalRefractionImage: a bubble 4 cm inside a glass sphere appears 3.2 cm and 16 cm deep", () => {
  const image = (vertex: LawPoint) => (operator("sphericalRefractionImage")({
    vertex, center: { x: 8, y: 0 }, object: { x: 4, y: 0 }, n1: 1.5, n2: 1,
  }) as { image: LawPoint }).image;
  const nearView = image({ x: 0, y: 0 });
  const farView = image({ x: 16, y: 0 });
  if (Math.abs(nearView.x - 3.2) > 1e-9 || Math.abs(nearView.y) > 1e-9) return `near view image at x = ${nearView.x}, expected 3.2`;
  if (Math.abs(farView.x - 0) > 1e-9 || Math.abs(farView.y) > 1e-9) return `far view image at x = ${farView.x}, expected 0 (16 cm from the far surface)`;
  return null;
});

const placementIssues = (key: string) => {
  const validated = validateSceneDocument(pruneDeadSceneEntities(structuredClone(fixture.documents[key]!)));
  if (!validated.document) throw new Error(`recorded ${key} did not validate`);
  return (operator("validateSphericalRefractionImagePlacements")(validated.document, fixture.plans[key]) as Array<{ code: string; entityIds?: string[] }>);
};

check("recorded sphere: images placed at 2.29 and 5.33 cm disagree with the law", () => {
  const issues = placementIssues("sphere");
  const flagged = issues.filter((issue) => issue.code === "spherical_refraction_image_disagrees").map((issue) => issue.entityIds?.[0]).sort();
  return JSON.stringify(flagged) === JSON.stringify(["farImage", "nearImage"]) ? null : `flagged ${JSON.stringify(flagged)}`;
});

check("control: recorded b1 sphere with its image at 3.2 cm agrees", () => {
  const issues = placementIssues("sphereCorrect");
  return issues.length === 0 ? null : `flagged ${issues.map((issue) => issue.entityIds?.[0]).join(", ")}`;
});

// Review of #164: spherical_surface also draws mirrors. A concave mirror (pole 0, centre
// -30 cm), object at -20 cm, image at -60 cm, in a plan that also carries n = 1.5.
// Refraction would give -22.5 or -17.14 cm; the mirror's image is right.
const mirrorPlan = {
  givens: [
    { id: "n", symbol: "n", value: 1.5 },
    { id: "R", symbol: "R", value: 30, unit: "cm" },
    { id: "u", symbol: "u", value: 20, unit: "cm" },
  ],
  derived: [
    { id: "f", symbol: "f", value: 15, unit: "cm" },
    { id: "v", symbol: "v", value: 60, unit: "cm" },
  ],
};
const concaveSurface = (declaredRefracting: boolean) => scene("An object 20 cm in front of a concave surface of radius 30 cm.", [
  { id: "V", kind: "point", role: "pole", label: "P" },
  { id: "C", kind: "point", role: "centre of curvature", label: "C" },
  { id: "F", kind: "point", role: "principal focus", label: "F" },
  { id: "O", kind: "point", role: "object", label: "O" },
  { id: "I", kind: "point", role: "image", label: "I" },
  { id: "axis", kind: "line", role: "principal axis" },
  { id: "surface", kind: "arc", role: declaredRefracting ? "air to glass surface" : "concave mirror" },
  ...(declaredRefracting ? [
    { id: "contact", kind: "point", role: "point of incidence" },
    { id: "incident", kind: "vector", role: "incident ray" },
    { id: "normal", kind: "segment", role: "normal" },
    { id: "refracted", kind: "ray", role: "refracted ray" },
  ] : []),
], [
  point("V", 0, 0), point("C", -30, 0), point("F", -15, 0), point("O", -20, 0), point("I", -60, 0),
  { id: "make_axis", operator: "line", inputs: { start: "V", direction: [1, 0] }, outputs: ["axis"] },
  { id: "make_surface", operator: "spherical_surface", inputs: { vertex: "V", axis: "axis", center: "C", signedRadius: -30, halfHeight: 12, kind: "concave" }, outputs: ["surface"] },
  ...(declaredRefracting ? [
    { id: "make_contact", operator: "surface_contact", inputs: { origin: "O", surface: "surface", direction: [1, 0.05] }, outputs: ["contact", "incident"] },
    { id: "make_normal", operator: "normal_at", inputs: { point: "contact", surface: "surface" }, outputs: ["normal"] },
    { id: "refraction", operator: "refract_direction", inputs: { origin: "contact", incoming: "incident", normal: "normal", n1: 1, n2: 1.5 }, outputs: ["refracted"] },
  ] : []),
]);
const surfaceIssues = (declaredRefracting: boolean) => {
  const validated = validateSceneDocument(pruneDeadSceneEntities(structuredClone(concaveSurface(declaredRefracting))));
  if (!validated.document) throw new Error(`did not validate: ${validated.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code).join(", ")}`);
  return (operator("validateSphericalRefractionImagePlacements")(validated.document, mirrorPlan) as Array<{ code: string; entityIds?: string[]; message?: string }>);
};

check("a concave mirror's image at -60 cm is not held to the refraction law of an index elsewhere in the plan", () => {
  const issues = surfaceIssues(false);
  return issues.length === 0 ? null : `flagged ${issues.map((issue) => issue.message).join("; ")}`;
});

check("control: the same surface declared refracting (refract_direction there) is still held to the law", () => {
  const flagged = surfaceIssues(true).filter((issue) => issue.code === "spherical_refraction_image_disagrees").map((issue) => issue.entityIds?.[0]).sort();
  return JSON.stringify(flagged) === JSON.stringify(["F", "I"]) ? null : `flagged ${JSON.stringify(flagged)}, expected F and I`;
});

// Review of #164, R5 chain: a glass sphere seen through both faces (R 10 cm, n 1.5, object O 30 cm
// before the first vertex). The faces stand at x = 0 and x = 20 around the centre x = 10. The first
// face puts the image I1 90 cm past its vertex (x = 90). I1 is a virtual object 70 cm past the second
// vertex, whose face puts the final image I2 14 cm past it (x = 34). Only O sits at a given distance,
// so I2 is right only if a confirmed image serves as the next face's object.
const twoFaceSphere = (firstImageX: number, finalImageX: number) => scene("A glass sphere of radius 10 cm and index 1.5, an object 30 cm before it.", [
  { id: "V1", kind: "point", role: "first vertex", label: "P1" },
  { id: "V2", kind: "point", role: "second vertex", label: "P2" },
  { id: "C", kind: "point", role: "centre", label: "C" },
  { id: "O", kind: "point", role: "object", label: "O" },
  { id: "I1", kind: "point", role: "first image", label: "I1" },
  { id: "I2", kind: "point", role: "final image", label: "I2" },
  { id: "axis", kind: "line", role: "principal axis" },
  { id: "s1", kind: "arc", role: "first face" },
  { id: "s2", kind: "arc", role: "second face" },
], [
  point("V1", 0, 0), point("V2", 20, 0), point("C", 10, 0), point("O", -30, 0),
  point("I1", firstImageX, 0), point("I2", finalImageX, 0),
  { id: "make_axis", operator: "line", inputs: { start: "V1", direction: [1, 0] }, outputs: ["axis"] },
  { id: "make_s1", operator: "spherical_surface", inputs: { vertex: "V1", axis: "axis", center: "C", halfHeight: 8 }, outputs: ["s1"] },
  { id: "make_s2", operator: "spherical_surface", inputs: { vertex: "V2", axis: "axis", center: "C", halfHeight: 8 }, outputs: ["s2"] },
]);
const twoFacePlan = (derived: Record<string, number>) => ({
  givens: [
    { id: "R", symbol: "R", value: 10, unit: "cm" },
    { id: "n", symbol: "n", value: 1.5 },
    { id: "u", symbol: "u", value: 30, unit: "cm" },
  ],
  derived: Object.entries(derived).map(([id, value]) => ({ id, symbol: id, value, unit: "cm" })),
});
const twoFaceFlags = (firstImageX: number, finalImageX: number, derived: Record<string, number>) => {
  const validated = validateSceneDocument(pruneDeadSceneEntities(structuredClone(twoFaceSphere(firstImageX, finalImageX))));
  if (!validated.document) throw new Error(`did not validate: ${validated.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code).join(", ")}`);
  const issues = operator("validateSphericalRefractionImagePlacements")(validated.document, twoFacePlan(derived)) as Array<{ code: string; entityIds?: string[]; message?: string }>;
  const flagged = issues.filter((issue) => issue.code === "spherical_refraction_image_disagrees");
  for (const issue of flagged) console.log(`   ${issue.message}`);
  return [...new Set(flagged.map((issue) => issue.entityIds?.[0]))].sort();
};

check("sphericalRefractionImage: a virtual object 70 cm past the second face, light going on, images 14 cm past it", () => {
  const result = operator("sphericalRefractionImage")({
    vertex: { x: 20, y: 0 }, center: { x: 10, y: 0 }, object: { x: 90, y: 0 }, direction: { x: 1, y: 0 }, n1: 1.5, n2: 1,
  }) as { image: LawPoint; objectDistance: number; imageDistance: number; radius: number };
  if (Math.abs(result.image.x - 34) > 1e-9 || Math.abs(result.image.y) > 1e-9) return `image at x = ${result.image.x}, expected 34`;
  if (Math.abs(result.objectDistance - 70) > 1e-9 || Math.abs(result.imageDistance - 14) > 1e-9 || Math.abs(result.radius + 10) > 1e-9) {
    return `u ${result.objectDistance}, v ${result.imageDistance}, R ${result.radius}; expected +70, +14, -10 along the light`;
  }
  return null;
});

check("two face glass sphere: images at 90 and 14 cm agree when u2 = 70 cm is also derived", () => {
  const flagged = twoFaceFlags(90, 34, { v1: 90, u2: 70, v2: 14 });
  return flagged.length === 0 ? null : `flagged ${JSON.stringify(flagged)}`;
});

check("two face glass sphere: images at 90 and 14 cm agree with only v1 and v2 derived", () => {
  const flagged = twoFaceFlags(90, 34, { v1: 90, v2: 14 });
  return flagged.length === 0 ? null : `flagged ${JSON.stringify(flagged)}`;
});

check("control: two face glass sphere with the final image at 20 cm, not 14, flags that image only", () => {
  const flagged = twoFaceFlags(90, 40, { v1: 90, v2: 20 });
  return JSON.stringify(flagged) === JSON.stringify(["I2"]) ? null : `flagged ${JSON.stringify(flagged)}, expected I2 only`;
});

check("control: a wrong first image (60 cm, not 90) confirms nothing downstream", () => {
  // I2 sits where the second face would image a virtual object at x = 60: v2 = 80/7 cm.
  const flagged = twoFaceFlags(60, 20 + 80 / 7, { v1: 60, v2: 80 / 7 });
  return JSON.stringify(flagged) === JSON.stringify(["I1", "I2"]) ? null : `flagged ${JSON.stringify(flagged)}, expected I1 and I2`;
});

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
