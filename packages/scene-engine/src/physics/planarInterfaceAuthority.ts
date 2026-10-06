export type PlanarDirection = readonly [number, number];

export interface PlanarInterfaceAuthority {
  readonly model: "isotropic_lossless_planar";
  readonly coordinateFrameId: string;
  readonly mediumBefore: string;
  readonly mediumAfter: string;
  readonly nBefore: number;
  readonly nAfter: number;
  readonly incidentDirection: PlanarDirection;
  readonly normalBeforeToAfter: PlanarDirection;
  readonly branch: "transmitted" | "total_internal_reflection";
  readonly reflectedDirection: PlanarDirection;
  readonly transmittedDirection: PlanarDirection | null;
  readonly discriminant: number;
  readonly branchErrorBound: number;
}

export type PlanarInterfaceResult =
  | { readonly ok: true; readonly value: PlanarInterfaceAuthority }
  | { readonly ok: false; readonly code: PlanarInterfaceDecline };

export type PlanarInterfaceDecline =
  | "invalid_structure"
  | "invalid_model"
  | "invalid_frame_or_media"
  | "invalid_refractive_index"
  | "invalid_unit_direction"
  | "unresolved_numeric_input"
  | "unresolved_numeric_output"
  | "incompatible_approach"
  | "unresolved_grazing_contact"
  | "unresolved_critical_contact";

const EPS = Number.EPSILON;
const NORM_TOLERANCE = 64 * EPS;
const MIN_NORMAL = 2 ** -1022;
const INPUT_KEYS = [
  "model", "coordinateFrameId", "mediumBefore", "mediumAfter",
  "nBefore", "nAfter", "incidentDirection", "normalBeforeToAfter",
] as const;

class Decline extends Error {
  constructor(readonly code: PlanarInterfaceDecline) {
    super(code);
  }
}

function decline(code: PlanarInterfaceDecline): never {
  throw new Decline(code);
}

function inputRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) decline("invalid_structure");
  const prototype: unknown = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) decline("invalid_structure");
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== INPUT_KEYS.length || keys.some((key) => typeof key !== "string" || !INPUT_KEYS.some((allowed) => allowed === key))) {
    decline("invalid_structure");
  }
  const record: Record<string, unknown> = Object.create(null);
  for (const key of INPUT_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) decline("invalid_structure");
    record[key] = descriptor.value;
  }
  return record;
}

function direction(raw: unknown): PlanarDirection {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length !== 2) decline("invalid_structure");
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== 3 || keys.some((key) => key !== "0" && key !== "1" && key !== "length")) decline("invalid_structure");
  const x = Object.getOwnPropertyDescriptor(raw, "0");
  const y = Object.getOwnPropertyDescriptor(raw, "1");
  if (!x || !y || !Object.hasOwn(x, "value") || !Object.hasOwn(y, "value")) decline("invalid_structure");
  if (typeof x.value !== "number" || typeof y.value !== "number" || !Number.isFinite(x.value) || !Number.isFinite(y.value)) decline("invalid_unit_direction");
  if ((x.value !== 0 && Math.abs(x.value) < MIN_NORMAL) || (y.value !== 0 && Math.abs(y.value) < MIN_NORMAL)) decline("unresolved_numeric_input");
  if (Math.abs(x.value) > 1 || Math.abs(y.value) > 1 || Math.abs(Math.hypot(x.value, y.value) - 1) > NORM_TOLERANCE) decline("invalid_unit_direction");
  return Object.freeze([x.value, y.value]);
}

function identifier(raw: unknown): string {
  if (typeof raw !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(raw)) decline("invalid_frame_or_media");
  return raw;
}

function refractiveIndex(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1e-6 || raw > 1e6) decline("invalid_refractive_index");
  return raw;
}

function product(a: number, b: number): number {
  const value = a * b;
  if (!Number.isFinite(value) || (a !== 0 && b !== 0 && Math.abs(value) < MIN_NORMAL)) decline("unresolved_numeric_output");
  return value;
}

function outputDirection(x: number, y: number): PlanarDirection {
  if (!Number.isFinite(x) || !Number.isFinite(y) || (x !== 0 && Math.abs(x) < MIN_NORMAL) || (y !== 0 && Math.abs(y) < MIN_NORMAL)) decline("unresolved_numeric_output");
  if (Math.abs(Math.hypot(x, y) - 1) > NORM_TOLERANCE) decline("unresolved_numeric_output");
  return Object.freeze([x, y]);
}

export function evaluatePlanarInterfaceAuthority(raw: unknown): PlanarInterfaceResult {
  try {
    const inputs = inputRecord(raw);
    if (inputs.model !== "isotropic_lossless_planar") decline("invalid_model");
    const coordinateFrameId = identifier(inputs.coordinateFrameId);
    const mediumBefore = identifier(inputs.mediumBefore);
    const mediumAfter = identifier(inputs.mediumAfter);
    if (mediumBefore === mediumAfter) decline("invalid_frame_or_media");
    const nBefore = refractiveIndex(inputs.nBefore);
    const nAfter = refractiveIndex(inputs.nAfter);
    const incidentDirection = direction(inputs.incidentDirection);
    const normalBeforeToAfter = direction(inputs.normalBeforeToAfter);
    const [ix, iy] = incidentDirection;
    const [nx, ny] = normalBeforeToAfter;
    const ixnx = product(ix, nx);
    const iyny = product(iy, ny);
    const approach = ixnx + iyny;
    const inputNormError = Math.abs(Math.hypot(ix, iy) - 1) + Math.abs(Math.hypot(nx, ny) - 1);
    const approachError = 8 * EPS * (Math.abs(ixnx) + Math.abs(iyny)) + 2 * inputNormError;
    if (approach < -approachError) decline("incompatible_approach");
    if (approach <= approachError) decline("unresolved_grazing_contact");
    const projectionX = product(approach, nx);
    const projectionY = product(approach, ny);
    const tx = ix - projectionX;
    const ty = iy - projectionY;
    const ex = 8 * EPS * (Math.abs(ix) + Math.abs(projectionX)) + Math.abs(nx) * approachError + 2 * inputNormError;
    const ey = 8 * EPS * (Math.abs(iy) + Math.abs(projectionY)) + Math.abs(ny) * approachError + 2 * inputNormError;
    const tangentSquared = product(tx, tx) + product(ty, ty);
    const tangentError = 2 * (Math.abs(tx) * ex + Math.abs(ty) * ey) + ex * ex + ey * ey + 8 * EPS * tangentSquared;
    const ratio = nBefore / nAfter;
    const ratioSquared = product(ratio, ratio);
    const transmittedTangentSquared = product(ratioSquared, tangentSquared);
    const discriminant = 1 - transmittedTangentSquared;
    const branchErrorBound = ratioSquared * tangentError + 16 * EPS * transmittedTangentSquared + 8 * EPS;
    if (!Number.isFinite(branchErrorBound) || Math.abs(discriminant) <= branchErrorBound) decline("unresolved_critical_contact");
    const reflectedDirection = outputDirection(ix - 2 * projectionX, iy - 2 * projectionY);
    let transmittedDirection: PlanarDirection | null = null;
    if (discriminant > branchErrorBound) {
      const transmittedNormal = Math.sqrt(discriminant);
      transmittedDirection = outputDirection(
        product(ratio, tx) + product(transmittedNormal, nx),
        product(ratio, ty) + product(transmittedNormal, ny),
      );
    }
    const value: PlanarInterfaceAuthority = Object.freeze({
      model: "isotropic_lossless_planar",
      coordinateFrameId, mediumBefore, mediumAfter, nBefore, nAfter,
      incidentDirection, normalBeforeToAfter,
      branch: transmittedDirection ? "transmitted" : "total_internal_reflection",
      reflectedDirection, transmittedDirection, discriminant, branchErrorBound,
    });
    return Object.freeze({ ok: true, value });
  } catch (error) {
    return Object.freeze({ ok: false, code: error instanceof Decline ? error.code : "invalid_structure" });
  }
}
