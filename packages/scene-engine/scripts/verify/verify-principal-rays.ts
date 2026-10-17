/**
 * `principal_rays` traces lens and mirror rays from a verified gaussian_image (DESIGN-RAYS).
 *
 * R1: every ray kind (parallel, focal, central) on a convex lens (real, at 2F, inside F, an
 * inverted object, a rotated and scaled axis), a diverging lens, a concave mirror (real, at C,
 * inside F) and a convex mirror. Each starts at the engine's object tip, hits the element plane
 * at the height the paraxial construction gives (the archetype generator's hits: parallel h,
 * mirror focal m h, lens central the centre; the lens focal hit is the line T F1 met on the plane),
 * and its emergent line or back-extension passes the image tip within 1e-6 world units. The
 * sub-paths come in order (incident, emergent, extension, guide), the extension exists for a
 * virtual image only, and the focal guide exists only when the focus is off the solid incident path.
 * R2: every fail-closed case gives its exact code. R3: converges [r1, r2, it] passes and
 * [r1, r2, ib] fails. R4: in the compiled scene only extensions and guides are dashed.
 * R5: three source mutants (focal hit at h, mirror sigma +1, extension not dashed) each turn R1
 * or R4 red, and each first proves its replacement changed the text.
 * R6: a traced ray is paraxial by construction, so a planner role such as "refracted ray
 * through F2" or "reflected ray" on a principal_rays output validates; the same role on a
 * free segment without a declared paraxial approximation still fails.
 * R7: one lens or mirror, one focal length. The recorded round 8 two-mirror documents (a concave
 * optical_focus with no form, so f > 0 and the focus behind the mirror, against its gaussian_image
 * form converging and its spherical_surface signedRadius < 0) fail closed with
 * optical_element_focal_length_disagrees; with form converging on that focus the p9b1 document
 * compiles and draws the focus in front of the mirror. A lens or a convex mirror whose focus, image
 * and surface agree still compiles clean; a lens focus of the wrong sign, a mirror surface of the
 * wrong sense and a mirror surface of the wrong radius each fail closed. The same holds on principal
 * axes written as a start and a direction or vector (the recorded documents, a surface, a reversed
 * focus), and a focus whose axis the check cannot read fails closed even when its values agree.
 * R8: the renderer draws a spherical_surface in a +x frame, so on a principal axis written toward -x
 * (endpoints B to A) its signedRadius is read along +x. A concave mirror there with signedRadius 28 and
 * focalLength -14 (and a convex one with -66 and 33) compiles clean, with the centre of curvature and
 * focus drawn on the correct side; the same surfaces signed along the written axis, which draw the
 * other sense, and a kind-only concave surface, which draws convex there, fail closed.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateSceneDocument } from "../../src/document/validation";
import { evaluateGeometricOpticsConstruction } from "../../src/compile/geometricOpticsGeometry";
import type { SceneConstruction, SceneDocument } from "../../src/types";

type RaysModule = typeof import("../../src/compile/principalRaysGeometry");
type Point = { x: number; y: number };
const SOURCE = fileURLToPath(new URL("../../src/compile/principalRaysGeometry.ts", import.meta.url));
const failures: string[] = [];
const gates = new Map<string, number>();
function check(gate: string, condition: unknown, message: string): void {
  gates.set(gate, (gates.get(gate) ?? 0) + (condition ? 0 : 1));
  if (!condition) failures.push(`${gate}: ${message}`);
}

interface Case { name: string; kind: "lens" | "mirror"; u: number; f: number; h: number; center?: Point; axis?: Point; scale?: number }
/** Signed Cartesian inputs: u < 0, lens f > 0 converging, mirror f < 0 converging. */
const CASES: Case[] = [
  { name: "convex lens, real (u 30, f 10)", kind: "lens", u: -30, f: 10, h: 5 },
  { name: "convex lens, at 2F (u 20, f 10)", kind: "lens", u: -20, f: 10, h: 5 },
  { name: "convex lens, inside F (u 12, f 16)", kind: "lens", u: -12, f: 16, h: 5 },
  { name: "convex lens, inverted object", kind: "lens", u: -30, f: 10, h: -4 },
  { name: "convex lens, rotated and scaled", kind: "lens", u: -30, f: 10, h: 5, center: { x: 5, y: -3 }, axis: { x: 3, y: 4 }, scale: 0.5 },
  { name: "diverging lens (u 27, f 18)", kind: "lens", u: -27, f: -18, h: 5 },
  { name: "concave mirror, real (u 21, f 14)", kind: "mirror", u: -21, f: -14, h: 6 },
  { name: "concave mirror, at C (u 28, f 14)", kind: "mirror", u: -28, f: -14, h: 6 },
  { name: "concave mirror, inside F (u 10, f 15)", kind: "mirror", u: -10, f: -15, h: 6 },
  { name: "convex mirror (u 22, f 33)", kind: "mirror", u: -22, f: 33, h: 6 },
  { name: "convex mirror, axis toward -x", kind: "mirror", u: -22, f: 33, h: 6, axis: { x: -1, y: 0 } },
];

function imageTip(test: Case) {
  const outputs = evaluateGeometricOpticsConstruction("gaussian_image", {
    kind: test.kind, center: [test.center?.x ?? 0, test.center?.y ?? 0], axis: [test.axis?.x ?? 1, test.axis?.y ?? 0],
    objectDistance: test.u, focalLength: test.f, objectHeight: test.h, displayScale: test.scale ?? 1, lengthUnit: "cm",
  }, { number: Number, point: () => { throw new Error("no points"); }, geometry: () => undefined });
  return outputs;
}

const near = (p: Point, q: Point, tolerance = 1e-6) => Math.hypot(p.x - q.x, p.y - q.y) <= tolerance;
const lineResidual = (point: Point, a: Point, b: Point) =>
  Math.abs((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
const onSegment = (point: Point, a: Point, b: Point) => {
  const t = ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  return lineResidual(point, a, b) <= 1e-6 && t >= -1e-9 && t <= 1 + 1e-9;
};

/** R1 on one evaluator module; returns its failures (used for the real source and the mutants). */
function matrixFailures(module: RaysModule): string[] {
  const found: string[] = [];
  const fail = (condition: unknown, message: string) => { if (!condition) found.push(message); };
  for (const test of CASES) {
    const anchors = imageTip(test);
    const model = anchors[3]!.opticalImage!;
    const { center: c, axis: a, normal: n, displayScale: s } = model;
    const u = model.objectDistance; const v = model.imageDistance; const f = model.focalLength; const h = model.objectHeight; const hi = model.imageHeight;
    const P = (alpha: number, tau: number): Point => ({ x: c.x + s * (alpha * a.x + tau * n.x), y: c.y + s * (alpha * a.y + tau * n.y) });
    const coords = (point: Point) => ({ alpha: ((point.x - c.x) * a.x + (point.y - c.y) * a.y) / s, tau: ((point.x - c.x) * n.x + (point.y - c.y) * n.y) / s });
    const T = anchors[1]!.point; const I = anchors[3]!.point;
    const sigma = test.kind === "lens" ? 1 : -1;
    const real = test.kind === "lens" ? v > 0 : v < 0;
    const focus = P(test.kind === "lens" ? -f : f, 0);
    const exitFocus = P(f, 0);
    let rays;
    try {
      rays = module.evaluatePrincipalRaysConstruction({ image: "it", rays: ["parallel", "focal", "central"] }, { geometry: (id) => (id === "it" ? anchors[3] : anchors[0]) });
    } catch (error) { found.push(`${test.name}: evaluation threw ${(error as Error).message}`); continue; }
    fail(rays.length === 3, `${test.name}: three rays`);
    for (const ray of rays) {
      const label = `${test.name} ${ray.opticalRay.role}`;
      const [incident, emergent, ...rest] = ray.paths;
      fail(incident && emergent, `${label}: incident and emergent sub-paths`);
      if (!incident || !emergent) continue;
      const H = incident[1]!;
      fail(near(incident[0]!, T), `${label}: incident starts at the object tip`);
      fail(near(emergent[0]!, H), `${label}: emergent starts at the hit`);
      fail(Math.abs(coords(H).alpha) * s <= 1e-6, `${label}: hit lies on the element plane`);
      fail(near(ray.opticalRay.hit, H), `${label}: metadata hit is the drawn hit`);
      // The archetype generator's hits; the lens focal hit is T F1 met on the plane.
      const lensFocalHit = h + (0 - u) * (0 - h) / (-f - u);
      const expectedHeight = ray.opticalRay.role === "parallel" ? h : ray.opticalRay.role === "central" ? 0 : test.kind === "mirror" ? hi : lensFocalHit;
      fail(Math.abs(coords(H).tau - expectedHeight) * s <= 1e-6, `${label}: hit height ${coords(H).tau} is ${expectedHeight}`);
      fail((coords(emergent[1]!).alpha - coords(H).alpha) * sigma > 0, `${label}: emergent leaves the element along sigma`);
      // Role geometry, checked as lines, independent of how the engine parametrises them.
      if (ray.opticalRay.role === "parallel") {
        fail(Math.abs(coords(T).tau - coords(H).tau) * s <= 1e-6, `${label}: incident runs parallel to the axis`);
        fail(lineResidual(exitFocus, emergent[0]!, emergent[1]!) <= 1e-6, `${label}: emergent line passes F2 or F`);
      } else if (ray.opticalRay.role === "focal") {
        fail(lineResidual(focus, incident[0]!, incident[1]!) <= 1e-6, `${label}: incident line passes F1 or F`);
        fail(Math.abs(coords(emergent[1]!).tau - coords(H).tau) * s <= 1e-6, `${label}: emergent runs parallel to the axis`);
      } else {
        fail(near(H, c), `${label}: the central ray crosses the centre or pole`);
        const din = coords(T); const dout = coords(emergent[1]!);
        // Lens: straight on (out is along -T). Mirror: the incident direction mirrored about the axis.
        const cross = test.kind === "lens" ? din.alpha * dout.tau - din.tau * dout.alpha : din.alpha * dout.tau + din.tau * dout.alpha;
        fail(Math.abs(cross) <= 1e-9 * Math.max(1, Math.abs(din.alpha * dout.alpha)), `${label}: emergent direction obeys the ${test.kind === "lens" ? "straight-through" : "reflection"} law`);
      }
      // The image tip: on the emergent line, and on the segment that shows it.
      fail(lineResidual(I, emergent[0]!, emergent[1]!) <= 1e-6, `${label}: emergent line passes the image tip`);
      const extension = rest.find((path, index) => ray.pathDashed[index + 2] && (onSegment(I, path[0]!, path[1]!)));
      if (real) fail(onSegment(I, emergent[0]!, emergent[1]!), `${label}: a real image lies on the solid emergent ray`);
      else {
        const lensCentralOnIncident = test.kind === "lens" && ray.opticalRay.role === "central" && Math.abs(v) < Math.abs(u);
        fail(lensCentralOnIncident ? onSegment(I, incident[0]!, incident[1]!) : extension, `${label}: a virtual image lies on a dashed back-extension${lensCentralOnIncident ? " (or the incident path)" : ""}`);
      }
      // Sub-path set: arrows on the two solid paths, dashes on the rest; an extension only for a virtual image.
      fail(ray.paths.length === ray.pathDirections.length && ray.paths.length === ray.pathDashed.length, `${label}: per-path flags`);
      fail(ray.pathDirections.every((directed, index) => directed === index < 2), `${label}: arrows on incident and emergent only`);
      fail(ray.pathDashed.every((dashed, index) => dashed === index >= 2), `${label}: extensions and guides dashed, solid paths not`);
      const guide = ray.opticalRay.role === "focal" && (coords(focus).alpha < u || coords(focus).alpha > 0);
      const expectedExtension = !real && !(test.kind === "lens" && ray.opticalRay.role === "central" && Math.abs(v) <= Math.abs(u));
      fail(ray.paths.length === 2 + (expectedExtension ? 1 : 0) + (guide ? 1 : 0), `${label}: ${ray.paths.length} sub-paths, expected ${2 + (expectedExtension ? 1 : 0) + (guide ? 1 : 0)}`);
      if (guide) {
        const last = ray.paths.at(-1)!;
        fail(last.some((point) => near(point, focus)), `${label}: the guide reaches the focus`);
        fail(last.some((point) => near(point, T) || near(point, H)), `${label}: the guide joins the solid ray`);
      }
      fail(ray.opticalRay.imageIsReal === real && near(ray.opticalRay.imageTip, I), `${label}: metadata image tip and reality`);
    }
  }
  return found;
}

// ---- R1 ----
const r1 = matrixFailures(await import("../../src/compile/principalRaysGeometry"));
for (const message of r1) check("R1", false, message);
check("R1", true, "");

// ---- documents for R2 to R4 ----
const ent = (id: string, kind: string, role = "optical geometry") => ({ id, kind, role });
function doc(test: Case, edits: { rays?: unknown; image?: string; outputs?: string[]; extraInputs?: Record<string, unknown>; outputKind?: string; assertions?: SceneDocument["assertions"]; gaussian?: Record<string, unknown> } = {}): SceneDocument {
  const outputs = edits.outputs ?? ["r1", "r2"];
  const constructions: SceneConstruction[] = [
    { id: "c-O", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["O"] },
    { id: "c-A", operator: "point", inputs: { x: -60, y: 0 }, outputs: ["A"] },
    { id: "c-B", operator: "point", inputs: { x: 60, y: 0 }, outputs: ["B"] },
    { id: "c-Q", operator: "point", inputs: { x: 10, y: 3 }, outputs: ["Q"] },
    { id: "c-axis", operator: "line", inputs: { start: "A", end: "B" }, outputs: ["axis"] },
    { id: "c-img", operator: "gaussian_image", inputs: { kind: test.kind, center: "O", axis: "axis", objectDistance: test.u, focalLength: test.f, objectHeight: test.h, displayScale: 1, lengthUnit: "cm", ...edits.gaussian }, outputs: ["ob", "ot", "ib", "it"] },
    { id: "c-object", operator: "vector", inputs: { start: "ob", end: "ot" }, outputs: ["object"] },
    { id: "c-image", operator: "vector", inputs: { start: "ib", end: "it" }, outputs: ["image"] },
    { id: "c-rays", operator: "principal_rays", inputs: { image: edits.image ?? "it", ...(edits.rays === undefined ? {} : { rays: edits.rays }), ...edits.extraInputs }, outputs },
  ];
  const points = ["O", "A", "B", "Q", "ob", "ot", "ib", "it"];
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "traced principal rays" }, source: { question: "principal rays" },
    quantities: [],
    entities: [...points.map((id) => ent(id, "point")), ent("axis", "line"), ent("object", "vector"), ent("image", "vector"), ...outputs.map((id) => ent(id, edits.outputKind ?? "polyline", "principal ray"))],
    constructions, relations: [], annotations: [],
    assertions: edits.assertions ?? [{ id: "meet", predicate: "converges", entities: [...outputs, "it"], expected: true, severity: "fatal" }],
    requiredEntityIds: [...points, "axis", "object", "image", ...outputs],
    revealGroups: [{ id: "all", entityIds: [...points, "axis", "object", "image", ...outputs], dependsOn: [], narrationCue: "rays" }],
    teachingTimeline: [],
  } as unknown as SceneDocument;
}
const fatalCodes = (document: SceneDocument) => {
  const validation = validateSceneDocument(document);
  const compiled = compileSceneDocument(validation.document ?? document);
  return { codes: [...new Set([...validation.report.issues, ...compiled.report.issues].filter((issue) => issue.severity === "fatal" || issue.code === "assertion_failed").map((issue) => issue.code))], compiled };
};

const convexReal = CASES[0]!; const convexInside = CASES[2]!; const mirrorReal = CASES[6]!; const convexMirror = CASES[9]!;
for (const test of [convexReal, convexInside, CASES[5]!, mirrorReal, CASES[8]!, convexMirror]) {
  for (const rays of [undefined, ["parallel", "focal"], ["focal", "central"], ["parallel", "focal", "central"]]) {
    const outputs = (rays ?? ["parallel", "central"]).map((_, index) => `r${index + 1}`);
    const { codes, compiled } = fatalCodes(doc(test, { rays, outputs }));
    check("R2", compiled.ok && codes.length === 0, `${test.name} ${JSON.stringify(rays ?? "default")} must compile clean; got ${codes.join(", ")}`);
  }
}

// ---- R2: fail closed, each with its exact code ----
const objectInsideF = { name: "object at F", kind: "lens" as const, u: -10, f: 10, h: 5 };
for (const [name, document, code] of [
  ["image = object base", doc(convexReal, { image: "ob" }), "invalid_principal_rays_image"],
  ["image = object tip", doc(convexReal, { image: "ot" }), "invalid_principal_rays_image"],
  ["image = image base", doc(convexReal, { image: "ib" }), "invalid_principal_rays_image"],
  ["image = a free point", doc(convexReal, { image: "Q" }), "invalid_principal_rays_image"],
  ["one ray", doc(convexReal, { rays: ["parallel"], outputs: ["r1"] }), "invalid_principal_rays_rays"],
  ["a repeated ray", doc(convexReal, { rays: ["parallel", "parallel"] }), "invalid_principal_rays_rays"],
  ["an unknown ray name", doc(convexReal, { rays: ["parallel", "marginal"] }), "invalid_principal_rays_rays"],
  ["four rays", doc(convexReal, { rays: ["parallel", "focal", "central", "parallel"], outputs: ["r1", "r2", "r3", "r4"] }), "invalid_principal_rays_rays"],
  ["an output count that is not the ray count", doc(convexReal, { rays: ["parallel", "focal", "central"] }), "invalid_principal_rays_outputs"],
  ["segment outputs", doc(convexReal, { outputKind: "segment" }), "invalid_principal_rays_outputs"],
  ["an extra input", doc(convexReal, { extraInputs: { focus: "O" } }), "invalid_principal_rays_fields"],
  ["an object on the axis (h = 0)", doc({ ...convexReal, h: 0 }), "invalid_principal_rays_object"],
  ["a virtual object", doc({ ...convexReal, u: 30 }), "invalid_principal_rays_object"],
  ["a parallel assertion on a traced ray", doc(convexReal, { assertions: [{ id: "par", predicate: "parallel", entities: ["r1", "axis"], expected: true, severity: "fatal" }] }), "invalid_principal_rays_assertion"],
  ["an on assertion on a traced ray", doc(convexReal, { assertions: [{ id: "on", predicate: "on", entities: ["O", "r2"], expected: true, severity: "fatal" }] }), "invalid_principal_rays_assertion"],
  ["an image at infinity (object at F)", doc(objectInsideF), "invalid_gaussian_image_objectDistance"],
] as const) {
  const { codes, compiled } = fatalCodes(document);
  check("R2", !compiled.ok || !compiled.renderScene, `${name} must not render`);
  check("R2", codes.includes(code), `${name} must fail with ${code}; got ${codes.join(", ") || "nothing"}`);
}
// Forged metadata on the image tip: the evaluator re-derives the model and refuses it.
{
  const rays = await import("../../src/compile/principalRaysGeometry");
  const anchors = imageTip(convexReal);
  const forged = structuredClone(anchors[3]!);
  forged.opticalImage!.imageDistance *= 1.1;
  const moved = structuredClone(anchors[3]!);
  moved.point = { x: moved.point.x + 1, y: moved.point.y };
  for (const [name, geometry] of [["forged image distance", forged], ["moved image tip", moved], ["an object tip", anchors[1]]] as const) {
    let message = "";
    try { rays.evaluatePrincipalRaysConstruction({ image: "it" }, { geometry: () => geometry }); } catch (error) { message = (error as Error).message; }
    check("R2", message.startsWith("principal_rays image:"), `${name} must fail on the image; got ${message || "no error"}`);
  }
}

// ---- R3: converges on the traced rays ----
{
  const good = fatalCodes(doc(convexReal));
  check("R3", good.compiled.ok && good.codes.length === 0, `converges [r1, r2, it] must pass; got ${good.codes.join(", ")}`);
  const wrong = fatalCodes(doc(convexReal, { assertions: [{ id: "meet", predicate: "converges", entities: ["r1", "r2", "ib"], expected: true, severity: "fatal" }] }));
  check("R3", !wrong.compiled.ok || wrong.codes.includes("assertion_failed"), `converges [r1, r2, ib] must fail; got ${wrong.codes.join(", ") || "pass"}`);
  for (const test of [convexInside, mirrorReal, convexMirror]) {
    const traced = fatalCodes(doc(test));
    check("R3", traced.compiled.ok && traced.codes.length === 0, `${test.name}: converges [r1, r2, it] must pass; got ${traced.codes.join(", ")}`);
  }
}

// ---- R4: dashed primitives only on extensions and guides ----
function dashFailures(module: RaysModule | null): string[] {
  const found: string[] = [];
  for (const test of [convexReal, convexInside, CASES[5]!, mirrorReal, CASES[8]!, convexMirror]) {
    const document = doc(test, { rays: ["parallel", "focal", "central"], outputs: ["r1", "r2", "r3"] });
    if (module) {
      const anchors = imageTip(test);
      const traced = module.evaluatePrincipalRaysConstruction({ image: "it", rays: ["parallel", "focal", "central"] }, { geometry: () => anchors[3] });
      const real = test.kind === "lens" ? anchors[3]!.opticalImage!.imageDistance > 0 : anchors[3]!.opticalImage!.imageDistance < 0;
      for (const ray of traced) {
        if (!real && !ray.pathDashed.some(Boolean) && ray.paths.length > 2) found.push(`${test.name} ${ray.opticalRay.role}: virtual extension is not dashed`);
        if (ray.pathDashed.some((dashed, index) => dashed !== index >= 2)) found.push(`${test.name} ${ray.opticalRay.role}: dashes off the extensions and guides`);
      }
      continue;
    }
    const { compiled } = fatalCodes(document);
    if (!compiled.ok || !compiled.renderScene) { found.push(`${test.name}: did not compile`); continue; }
    for (const id of ["r1", "r2", "r3"]) {
      const primitives = compiled.renderScene.primitives.filter((primitive) => primitive.entityId === id && primitive.kind !== "label");
      const real = primitives.length > 0 && !primitives.some((primitive) => primitive.provenance?.dashed === true);
      for (const [index, primitive] of primitives.entries()) {
        const dashed = primitive.provenance?.dashed === true;
        if (dashed !== index >= 2) found.push(`${test.name} ${id} primitive ${index}: dashed ${dashed}`);
        if (dashed && primitive.provenance?.strokeRole !== "construction") found.push(`${test.name} ${id} primitive ${index}: dashed ink is not construction ink`);
        if ((primitive.kind === "vector") !== index < 2) found.push(`${test.name} ${id} primitive ${index}: kind ${primitive.kind}`);
      }
      if (primitives.length < 2) found.push(`${test.name} ${id}: ${primitives.length} primitives`);
      void real;
    }
  }
  return found;
}
for (const message of dashFailures(null)) check("R4", false, message);
check("R4", true, "");

// ---- R6: refracted and reflected roles on traced rays ----
for (const [test, roles] of [[convexReal, ["refracted ray through F2", "undeviated ray through the optical centre"]], [mirrorReal, ["reflected ray through F", "reflected ray at the pole"]]] as const) {
  const document = doc(test);
  document.entities = document.entities.map((entity) => (entity.id === "r1" ? { ...entity, role: roles[0] } : entity.id === "r2" ? { ...entity, role: roles[1] } : entity));
  const { codes, compiled } = fatalCodes(document);
  check("R6", compiled.ok && codes.length === 0, `${test.name}: roles ${roles.join(", ")} on traced rays must validate; got ${codes.join(", ")}`);
}
{
  const document = doc(convexReal);
  document.constructions.push({ id: "c-free", operator: "segment", inputs: { start: "O", end: "it" }, outputs: ["free"] });
  document.entities.push({ id: "free", kind: "segment", role: "refracted ray" });
  document.requiredEntityIds.push("free"); document.revealGroups[0]!.entityIds.push("free");
  const { codes } = fatalCodes(document);
  check("R6", codes.includes("derived_role_operator_mismatch"), `a free refracted segment must still fail; got ${codes.join(", ") || "nothing"}`);
}

// ---- R7: one element, one focal length ----
const FOCAL_CODE = "optical_element_focal_length_disagrees";
const recorded = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/optics-round8-two-mirror.json", import.meta.url)), "utf8")) as Record<"p9b1" | "p9b2", SceneDocument>;
for (const arm of ["p9b1", "p9b2"] as const) {
  const { codes, compiled } = fatalCodes(structuredClone(recorded[arm]));
  check("R7", codes.includes(FOCAL_CODE) && !compiled.ok, `recorded ${arm} two-mirror document must fail closed with ${FOCAL_CODE}; got ${codes.join(", ") || "nothing"}, compiled ${compiled.ok}`);
}
{
  const document = structuredClone(recorded.p9b1);
  const focus = document.constructions.find((construction) => construction.id === "cfc")!;
  focus.inputs = { ...focus.inputs, form: "converging" };
  const { codes, compiled } = fatalCodes(document);
  check("R7", compiled.ok && codes.length === 0, `p9b1 with form converging on the concave focus must compile clean; got ${codes.join(", ")}`);
  const at = (id: string) => compiled.renderScene?.primitives.find((primitive) => primitive.entityId === id && primitive.kind === "point")?.points[0];
  const [pole, focusPoint, objectBase] = [at("pc"), at("fc"), at("cob")];
  // The axis runs toward +x from the object side: in front of the mirror is the object's side of the pole.
  check("R7", pole && focusPoint && objectBase && focusPoint.x < pole.x && objectBase.x < pole.x,
    `the concave focus must sit in front of the mirror, on the object side; pole ${JSON.stringify(pole)}, focus ${JSON.stringify(focusPoint)}, object ${JSON.stringify(objectBase)}`);
}
function withElement(test: Case, focus: Record<string, unknown> | null, surface: Record<string, unknown> | null, gaussian?: Record<string, unknown>): SceneDocument {
  const document = doc(test, gaussian ? { gaussian } : {});
  const added: string[] = [];
  if (focus) {
    const outputs = test.kind === "lens" ? ["F1", "F2"] : ["F"];
    document.constructions.push({ id: "c-focus", operator: "optical_focus", inputs: { kind: test.kind, center: "O", axis: "axis", displayScale: 1, lengthUnit: "cm", ...focus }, outputs });
    for (const id of outputs) { document.entities.push(ent(id, "point", "focus")); added.push(id); }
  }
  if (surface) {
    document.constructions.push({ id: "c-surface", operator: "spherical_surface", inputs: { vertex: "O", axis: "axis", halfHeight: 12, ...surface }, outputs: ["surface"] });
    document.entities.push(ent("surface", "arc", "mirror")); added.push("surface");
  }
  document.requiredEntityIds.push(...added); document.revealGroups[0]!.entityIds.push(...added);
  return document;
}
/** The same focus stated on the principal axis drawn the other way (B to A): a mirror's focus is one world point. */
function reversedAxisFocus(test: Case, focalLength: number): SceneDocument {
  const document = withElement(test, { focalLength, axis: "axis-r" }, null);
  document.constructions.splice(5, 0, { id: "c-axis-r", operator: "line", inputs: { start: "B", end: "A" }, outputs: ["axis-r"] });
  document.entities.push(ent("axis-r", "line")); document.requiredEntityIds.push("axis-r"); document.revealGroups[0]!.entityIds.push("axis-r");
  return document;
}
const diverging = CASES[5]!;
for (const [name, document] of [
  ["convex lens, signed focus agrees", withElement(convexReal, { focalLength: 10 }, null)],
  ["convex lens, form focus agrees with form image", withElement(convexReal, { focalLength: 10, form: "converging" }, null, { objectDistance: 30, form: "converging", objectSide: "real" })],
  ["diverging lens, signed focus agrees", withElement(diverging, { focalLength: -18 }, null)],
  ["convex mirror, signed focus and surface agree", withElement(convexMirror, { focalLength: 33 }, { signedRadius: 66 })],
  ["convex mirror, form focus and kind-only surface agree", withElement(convexMirror, { focalLength: 33, form: "diverging" }, { kind: "convex" })],
  ["concave mirror, signed focus and surface agree", withElement(mirrorReal, { focalLength: -14 }, { signedRadius: -28, kind: "concave" })],
  ["convex mirror, focus stated on the reversed axis", reversedAxisFocus(convexMirror, -33)],
] as const) {
  const { codes, compiled } = fatalCodes(document);
  check("R7", compiled.ok && codes.length === 0, `${name} must compile clean; got ${codes.join(", ")}`);
}
for (const [name, document] of [
  ["convex lens, focus of the wrong sign", withElement(convexReal, { focalLength: -10 }, null)],
  ["concave mirror, focus without form beside a form image", withElement(mirrorReal, { focalLength: 14 }, null, { objectDistance: 21, focalLength: 14, form: "converging", objectSide: "real" })],
  ["concave mirror, convex surface", withElement(mirrorReal, { focalLength: -14 }, { signedRadius: 28 })],
  ["concave mirror, kind-only convex surface", withElement(mirrorReal, null, { kind: "convex" })],
  ["concave mirror, surface radius not 2f", withElement(mirrorReal, { focalLength: -14 }, { signedRadius: -60 })],
  ["convex mirror, reversed-axis focus in front of the mirror", reversedAxisFocus(convexMirror, 33)],
] as const) {
  const { codes, compiled } = fatalCodes(document);
  check("R7", codes.includes(FOCAL_CODE) && !compiled.ok, `${name} must fail closed with ${FOCAL_CODE}; got ${codes.join(", ") || "nothing"}`);
}
// The same elements on principal axes written as a start and a direction (or vector): the compiler draws
// these lines, so the check reads them too, and an axis it cannot read fails closed instead of being skipped.
function directionAxes(document: SceneDocument, along: (start: unknown) => Record<string, unknown>): SceneDocument {
  for (const construction of document.constructions) if (construction.operator === "line") construction.inputs = along(construction.inputs.start);
  return document;
}
const directionOf = (start: unknown) => ({ start, direction: [1, 0] });
const vectorOf = (start: unknown) => ({ start, vector: { x: 2, y: 0 } });
const withForm = (document: SceneDocument, id: string): SceneDocument => {
  const focus = document.constructions.find((construction) => construction.id === id)!;
  focus.inputs = { ...focus.inputs, form: "converging" };
  return document;
};
/** A mirror focus on its own principal axis written from the pole: B to A as a direction toward -x. */
function directionReversedFocus(test: Case, focalLength: number): SceneDocument {
  const document = withElement(test, { focalLength, axis: "axis-r" }, null);
  document.constructions.splice(5, 0, { id: "c-axis-r", operator: "line", inputs: { start: "O", direction: [-1, 0] }, outputs: ["axis-r"] });
  document.entities.push(ent("axis-r", "line")); document.requiredEntityIds.push("axis-r"); document.revealGroups[0]!.entityIds.push("axis-r");
  return document;
}
/** A mirror focus whose principal axis starts at the image's object base: the compiler draws it, the check cannot read it. */
function unreadAxisFocus(test: Case, focus: Record<string, unknown>): SceneDocument {
  const document = withElement(test, { ...focus, axis: "axis-u" }, null);
  document.constructions.splice(6, 0, { id: "c-axis-u", operator: "line", inputs: { start: "ob", end: "O" }, outputs: ["axis-u"] });
  document.entities.push(ent("axis-u", "line")); document.requiredEntityIds.push("axis-u"); document.revealGroups[0]!.entityIds.push("axis-u");
  return document;
}
for (const [name, document] of [
  ["recorded p9b1 on direction axes", directionAxes(structuredClone(recorded.p9b1), directionOf)],
  ["recorded p9b2 on vector axes", directionAxes(structuredClone(recorded.p9b2), vectorOf)],
  ["concave mirror on a direction axis, convex surface", directionAxes(withElement(mirrorReal, { focalLength: -14 }, { signedRadius: 28 }), directionOf)],
  ["convex mirror, focus in front of the mirror on a direction axis toward -x", directionReversedFocus(convexMirror, 33)],
  ["concave mirror, agreeing focus on an axis the check cannot read", unreadAxisFocus(mirrorReal, { focalLength: -14 })],
] as const) {
  const { codes, compiled } = fatalCodes(document);
  check("R7", codes.includes(FOCAL_CODE) && !compiled.ok, `${name} must fail closed with ${FOCAL_CODE}; got ${codes.join(", ") || "nothing"}`);
}
for (const [name, document] of [
  ["recorded p9b1 on direction axes, form converging on the concave focus", withForm(directionAxes(structuredClone(recorded.p9b1), directionOf), "cfc")],
  ["recorded p9b2 on vector axes, form converging on the concave focus", withForm(directionAxes(structuredClone(recorded.p9b2), vectorOf), "cf0")],
  ["concave mirror on a direction axis, focus and surface agree", directionAxes(withElement(mirrorReal, { focalLength: -14 }, { signedRadius: -28 }), directionOf)],
  ["convex mirror, focus stated on a direction axis toward -x", directionReversedFocus(convexMirror, -33)],
] as const) {
  const { codes, compiled } = fatalCodes(document);
  check("R7", compiled.ok && codes.length === 0, `${name} must compile clean; got ${codes.join(", ")}`);
  if (!name.startsWith("recorded p9b1") || !compiled.ok) continue;
  const at = (id: string) => compiled.renderScene?.primitives.find((primitive) => primitive.entityId === id && primitive.kind === "point")?.points[0];
  const [pole, focusPoint, objectBase] = [at("pc"), at("fc"), at("cob")];
  check("R7", pole && focusPoint && objectBase && focusPoint.x < pole.x && objectBase.x < pole.x,
    `${name}: the concave focus must sit in front of the mirror; pole ${JSON.stringify(pole)}, focus ${JSON.stringify(focusPoint)}, object ${JSON.stringify(objectBase)}`);
}

// ---- R8: a mirror surface's radius is read along the axis the renderer draws it on ----
/** Image, focus and surface all on the principal axis drawn B to A (toward -x); the renderer flips that axis to +x. */
function reversedEndpointAxis(test: Case, focus: Record<string, unknown>, surface: Record<string, unknown>): SceneDocument {
  const document = withElement(test, focus, surface);
  document.constructions.splice(5, 0, { id: "c-axis-r", operator: "line", inputs: { start: "B", end: "A" }, outputs: ["axis-r"] });
  for (const construction of document.constructions) {
    if (["c-img", "c-focus", "c-surface"].includes(construction.id)) construction.inputs = { ...construction.inputs, axis: "axis-r" };
  }
  document.entities.push(ent("axis-r", "line")); document.requiredEntityIds.push("axis-r"); document.revealGroups[0]!.entityIds.push("axis-r");
  return document;
}
const concaveMirror = mirrorReal; // u 21, f -14: the object sits on the +x side of the pole once the axis runs toward -x
for (const [name, document] of [
  // The review's case: concave, focus on the object side, centre of curvature on the object side (+x) as drawn.
  ["concave mirror, reversed endpoint axis, signedRadius 28 and focalLength -14", reversedEndpointAxis(concaveMirror, { focalLength: -14 }, { signedRadius: 28 })],
  ["concave mirror, reversed endpoint axis, form converging focus and signedRadius 28", reversedEndpointAxis(concaveMirror, { focalLength: 14, form: "converging" }, { signedRadius: 28 })],
  ["convex mirror, reversed endpoint axis, signedRadius -66 and focalLength 33", reversedEndpointAxis(convexMirror, { focalLength: 33 }, { signedRadius: -66 })],
] as const) {
  const { codes, compiled } = fatalCodes(document);
  check("R8", compiled.ok && codes.length === 0, `${name} must compile clean; got ${codes.join(", ")}`);
  if (!compiled.ok) continue;
  // As drawn: the concave mirror's centre of curvature and focus lie on the object's side of the pole.
  const at = (id: string) => compiled.renderScene?.primitives.find((primitive) => primitive.entityId === id && primitive.kind === "point")?.points[0];
  const arc = compiled.renderScene?.primitives.find((primitive) => primitive.entityId === "surface");
  const [pole, objectBase, focusPoint] = [at("O"), at("ob"), at("F")];
  const centre = arc?.points[0];
  const concave = name.startsWith("concave");
  check("R8", pole && objectBase && focusPoint && centre &&
    (Math.sign(centre.x - pole.x) === Math.sign(objectBase.x - pole.x)) === concave &&
    (Math.sign(focusPoint.x - pole.x) === Math.sign(objectBase.x - pole.x)) === concave,
  `${name}: centre of curvature and focus must sit ${concave ? "on" : "behind"} the object side; pole ${JSON.stringify(pole)}, object ${JSON.stringify(objectBase)}, focus ${JSON.stringify(focusPoint)}, centre ${JSON.stringify(centre)}`);
}
for (const [name, document] of [
  // Read along the supplied axis these agreed; drawn, their centre of curvature sits behind the mirror.
  ["concave mirror, reversed endpoint axis, signedRadius -28 (drawn convex)", reversedEndpointAxis(concaveMirror, { focalLength: -14 }, { signedRadius: -28 })],
  ["concave mirror, reversed endpoint axis, kind-only concave (drawn convex)", reversedEndpointAxis(concaveMirror, { focalLength: -14 }, { kind: "concave" })],
  ["convex mirror, reversed endpoint axis, signedRadius 66 (drawn concave)", reversedEndpointAxis(convexMirror, { focalLength: 33 }, { signedRadius: 66 })],
] as const) {
  const { codes, compiled } = fatalCodes(document);
  check("R8", codes.includes(FOCAL_CODE) && !compiled.ok, `${name} must fail closed with ${FOCAL_CODE}; got ${codes.join(", ") || "nothing"}`);
}

// ---- R5: source mutants ----
const source = readFileSync(SOURCE, "utf8");
for (const [name, from, to, gate] of [
  ["focal hit at h", "      hitHeight = hi;\n", "      hitHeight = h;\n", "R1"],
  ["mirror sigma +1", 'const sigma = kind === "lens" ? 1 : -1;', "const sigma = 1;", "R1"],
  ["extension not dashed", "const pathDashed = paths.map((_, index) => index >= 2);", "const pathDashed = paths.map(() => false);", "R4"],
] as const) {
  const mutated = source.replace(from, to);
  check("R5", mutated !== source, `mutant "${name}" did not apply`);
  if (mutated === source) continue;
  const file = SOURCE.replace(/\.ts$/, `.mutant-${process.pid}-${name.replace(/\W+/g, "-")}.ts`);
  try {
    writeFileSync(file, mutated);
    const module = await import(pathToFileURL(file).href) as RaysModule;
    const found = gate === "R1" ? matrixFailures(module) : dashFailures(module);
    check("R5", found.length > 0, `mutant "${name}" must turn ${gate} red`);
  } finally { rmSync(file, { force: true }); }
}

for (const gate of ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"]) console.log(`${gate}: ${gates.get(gate) ? `FAIL (${gates.get(gate)} checks)` : "pass"}`);
if (failures.length) {
  for (const failure of failures.slice(0, 40)) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("verify-principal-rays: traced lens and mirror rays pass the image tip, dash only their extensions, and fail closed");
