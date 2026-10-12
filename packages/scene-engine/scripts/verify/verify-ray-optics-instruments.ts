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

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
