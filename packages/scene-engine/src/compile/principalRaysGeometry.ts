import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import { gaussianImageInputsForValidation, verifiedGaussianImageTip } from "./geometricOpticsGeometry";

/**
 * `principal_rays` traces whole lens and mirror rays from a verified `gaussian_image`.
 *
 * Every point comes from the Gaussian model the image tip carries, never from the planner. With
 * centre c, unit axis a (the light direction), normal n, display scale s and Cartesian u < 0, v, f,
 * h, h' = m h, write P(alpha, tau) = c + s (alpha a + tau n). The object tip is T = P(u, h) and the
 * image tip I = P(v, h'). Hits lie on the element plane alpha = 0 (the paraxial pole plane). Light
 * leaves along sigma = +1 (lens) or returns along sigma = -1 (mirror); the image is real when
 * sigma v > 0.
 *
 * - parallel: hit P(0, h), leaves on tau = h (1 - alpha / f), through F2 (lens) or F (mirror).
 * - focal: arrives on the line T F1 (lens, F1 = P(-f, 0)) or T F (mirror, F = P(f, 0)), hits
 *   P(0, h'), leaves parallel to the axis.
 * - central: crosses the centre (lens, tau = alpha h / u) or reflects at the pole about the axis
 *   (mirror, tau = -alpha h / u).
 *
 * Each output is one multi_path in drawing order: incident (arrow), emergent (arrow), then a
 * dashed back-extension to I for a virtual image, then a dashed guide to the focus for a focal
 * ray whose focus is off its solid incident path. Every emergent line and extension passes I by
 * construction, and the engine checks it at numeric precision.
 */
export const PRINCIPAL_RAYS_OPERATORS = ["principal_rays"] as const;
export const PRINCIPAL_RAY_ROLES = ["parallel", "focal", "central"] as const;
export type PrincipalRayRole = (typeof PRINCIPAL_RAY_ROLES)[number];
const DEFAULT_RAYS: readonly PrincipalRayRole[] = ["parallel", "central"];
const INPUT_KEYS = ["image", "rays"];
const RESIDUAL_TOLERANCE = 1e-8;
const MAX_COORDINATE = 1e12;

export interface OpticalRayDefinition {
  role: PrincipalRayRole;
  kind: "lens" | "mirror";
  /** World point where the ray meets the element plane. */
  hit: RenderPoint;
  /** Signed physical height of the hit above the axis (h, h' or 0). */
  hitHeight: number;
  imageTip: RenderPoint;
  imageIsReal: boolean;
}
export type PrincipalRayGeometry = {
  kind: "multi_path";
  paths: RenderPoint[][];
  pathDirections: boolean[];
  pathDashed: boolean[];
  opticalRay: OpticalRayDefinition;
};
export interface PrincipalRaysEvaluationContext { geometry(value: unknown): unknown }

class PrincipalRaysError extends Error { constructor(readonly key: string, message: string) { super(`principal_rays ${key}: ${message}`); } }
function invalid(key: string, message: string): never { throw new PrincipalRaysError(key, message); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

function checkFields(inputs: unknown): Record<string, unknown> {
  if (!isRecord(inputs)) return invalid("fields", "inputs must be an object");
  const extra = Object.keys(inputs).filter((key) => !INPUT_KEYS.includes(key));
  if (extra.length) invalid("fields", `unsupported inputs: ${extra.join(", ")}; principal_rays takes only image and rays`);
  return inputs;
}
/** The ray names, in order: 2 or 3 distinct names from parallel, focal and central. */
export function principalRayRoles(value: unknown): PrincipalRayRole[] {
  if (value === undefined) return [...DEFAULT_RAYS];
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) return invalid("rays", 'rays must list 2 or 3 of "parallel", "focal", "central"');
  if (value.some((item) => !PRINCIPAL_RAY_ROLES.includes(item as PrincipalRayRole))) return invalid("rays", 'each ray must be "parallel", "focal" or "central"');
  if (new Set(value).size !== value.length) invalid("rays", "ray names must be distinct");
  return value as PrincipalRayRole[];
}

export function evaluatePrincipalRaysConstruction(rawInputs: Record<string, unknown>, context: PrincipalRaysEvaluationContext): PrincipalRayGeometry[] {
  const inputs = checkFields(rawInputs);
  const roles = principalRayRoles(inputs.rays);
  if (typeof inputs.image !== "string" || !inputs.image.trim()) invalid("image", "image must name the imageTip output of a gaussian_image");
  const tip = verifiedGaussianImageTip(context.geometry(inputs.image));
  if (typeof tip === "string") return invalid("image", tip);
  const { center: c, axis: a, normal: n, displayScale: s, kind } = tip;
  const u = tip.objectDistance; const v = tip.imageDistance; const f = tip.focalLength; const h = tip.objectHeight; const hi = tip.imageHeight;
  if (!(u < 0)) invalid("object", "principal rays need a real object (u < 0); a virtual object has no drawn incident ray");
  if (h === 0) invalid("object", "an object on the axis has no principal rays");
  const sigma = kind === "lens" ? 1 : -1;
  const real = sigma * v > 0;
  if (real !== tip.imageIsReal) invalid("geometry", "image reality contradicts the Gaussian model");
  const at = (alpha: number, tau: number): RenderPoint => {
    const result = { x: c.x + s * (alpha * a.x + tau * n.x), y: c.y + s * (alpha * a.y + tau * n.y) };
    if (!Number.isFinite(result.x) || !Number.isFinite(result.y) || Math.abs(result.x) > MAX_COORDINATE || Math.abs(result.y) > MAX_COORDINATE) invalid("geometry", "ray point is not finite");
    return result;
  };
  const T = at(u, h); const I = at(v, hi);
  // Real: the emergent ray runs on past I. Virtual: it leaves the element away from I, past the
  // exit focus when that focus lies on its side (so the parallel ray shows it), else past the object.
  const reach = real ? 1.25 * v : 1.2 * sigma * Math.max(Math.abs(u), sigma * f > 0 ? Math.abs(f) : 0);
  // The focus a focal ray aims at (or comes from): F1 = P(-f, 0) for a lens, F = P(f, 0) for a mirror.
  const focalAlpha = kind === "lens" ? -f : f;
  const scale = Math.max(1, Math.abs(s * u), Math.abs(s * v), Math.abs(s * f), Math.abs(s * h), Math.abs(s * hi));
  const outputs = roles.map((role): PrincipalRayGeometry => {
    let hitHeight: number;
    let emergentAt: (alpha: number) => number;
    let extension: RenderPoint[] | undefined;
    let guide: RenderPoint[] | undefined;
    if (role === "parallel") {
      hitHeight = h;
      emergentAt = (alpha) => h * (1 - alpha / f);
      if (!real) {
        // The back-extension runs on to the focus when the focus lies beyond I on that side.
        const end = Math.sign(f) === Math.sign(v) && Math.abs(f) > Math.abs(v) ? f : v;
        extension = [at(0, h), at(end, emergentAt(end))];
      }
    } else if (role === "focal") {
      hitHeight = hi;
      emergentAt = () => hi;
      if (!real) extension = [at(0, hi), I];
      if (focalAlpha < u) guide = [at(focalAlpha, 0), T];
      else if (focalAlpha > 0) guide = [at(0, hi), at(focalAlpha, 0)];
    } else {
      hitHeight = 0;
      emergentAt = (alpha) => sigma * alpha * h / u;
      if (!real) {
        if (kind === "mirror") extension = [c, I];
        // A lens image nearer than the object already lies on the solid incident path.
        else if (Math.abs(v) > Math.abs(u)) extension = [T, I];
      }
    }
    const hit = at(0, hitHeight);
    const emergent = [hit, at(reach, emergentAt(reach))];
    const paths = [[T, hit], emergent, ...(extension ? [extension] : []), ...(guide ? [guide] : [])];
    const pathDirections = paths.map((_, index) => index < 2);
    const pathDashed = paths.map((_, index) => index >= 2);
    for (const path of paths) {
      if (!(Math.hypot(path[1]!.x - path[0]!.x, path[1]!.y - path[0]!.y) > RESIDUAL_TOLERANCE * scale)) invalid("geometry", `${role} ray has a degenerate sub-path`);
    }
    // Self-check: I lies on the emergent line and on every extension line.
    for (const line of [emergent, ...(extension ? [extension] : [])]) {
      const dx = line[1]!.x - line[0]!.x; const dy = line[1]!.y - line[0]!.y;
      const residual = Math.abs(dx * (I.y - line[0]!.y) - dy * (I.x - line[0]!.x)) / Math.hypot(dx, dy);
      if (!(residual <= RESIDUAL_TOLERANCE * Math.max(1, Math.abs(s * v), Math.abs(s * hi)))) invalid("geometry", `${role} ray does not pass the image tip at numeric precision`);
    }
    return { kind: "multi_path", paths, pathDirections, pathDashed, opticalRay: { role, kind, hit, hitHeight, imageTip: I, imageIsReal: real } };
  });
  return outputs;
}

export function validatePrincipalRaysConstruction(
  construction: SceneConstruction,
  index: number,
  document: SceneDocument,
  constructionByOutput: Map<string, SceneConstruction>,
  issues: SceneIssue[],
): void {
  const add = (key: string, message: string): void => {
    issues.push({ code: `invalid_principal_rays_${key}`, message, severity: "fatal", path: `constructions[${index}].${key === "outputs" ? "outputs" : key === "assertion" ? "outputs" : `inputs.${key}`}` });
  };
  let roles: PrincipalRayRole[] = [...DEFAULT_RAYS];
  try {
    const inputs = checkFields(construction.inputs);
    roles = principalRayRoles(inputs.rays);
  } catch (error) {
    if (error instanceof PrincipalRaysError) add(error.key, error.message); else throw error;
    if (!isRecord(construction.inputs)) return;
  }
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  if (outputs.length !== roles.length || outputs.some((output) => typeof output !== "string" || !output.trim()) || new Set(outputs).size !== outputs.length) {
    add("outputs", `principal_rays requires ${roles.length} distinct polyline outputs, one per ray name`);
  }
  for (const output of outputs) {
    if (document.entities.find((entity) => entity.id === output)?.kind !== "polyline") add("outputs", "principal_rays outputs must be polyline entities");
  }
  const image = construction.inputs.image;
  const producer = typeof image === "string" ? constructionByOutput.get(image) : undefined;
  if (!producer || producer.operator !== "gaussian_image" || producer.outputs[3] !== image) {
    add("image", "image must name the imageTip (fourth) output of a gaussian_image");
  } else {
    try {
      const resolved = gaussianImageInputsForValidation(producer, document);
      if (!(resolved.objectDistance! < 0)) add("object", "principal rays need a real object (u < 0); a virtual object has no drawn incident ray");
      else if (resolved.objectHeight === 0) add("object", "an object on the axis has no principal rays");
    } catch {
      // The gaussian_image reports its own invalid inputs.
    }
  }
  const owned = new Set(outputs);
  for (const assertion of document.assertions ?? []) {
    if (assertion.predicate === "converges" || !Array.isArray(assertion.entities) || !assertion.entities.some((id) => owned.has(id))) continue;
    add("assertion", `assertion ${assertion.id} (${assertion.predicate}) names a traced ray; the engine certifies these rays, so only converges may name them`);
  }
}
