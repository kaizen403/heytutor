export interface PlanarApparentDepthInputs {
  readonly model: "paraxial_normal_view";
  readonly coordinateFrameId: string;
  readonly depthAxisId: string;
  readonly signConvention: "positive_into_object_medium";
  readonly objectMediumId: string;
  readonly viewerMediumId: string;
  readonly nObject: number;
  readonly nViewer: number;
  readonly trueDepth: number;
  readonly depthUnit: "m" | "cm" | "mm";
}

export interface PlanarApparentDepthAuthority extends PlanarApparentDepthInputs {
  readonly trueDepthSI: number;
  readonly apparentDepth: number;
  readonly apparentDepthSI: number;
  readonly signedDepthShift: number;
  readonly signedDepthShiftSI: number;
}

export type PlanarApparentDepthDecline =
  | "invalid_source_data"
  | "invalid_model"
  | "invalid_frame_or_media"
  | "invalid_sign_convention"
  | "invalid_refractive_index"
  | "invalid_depth_unit"
  | "invalid_true_depth"
  | "unresolved_numeric_output";

export type PlanarApparentDepthResult =
  | { readonly ok: true; readonly value: PlanarApparentDepthAuthority }
  | { readonly ok: false; readonly code: PlanarApparentDepthDecline };

const MIN_NORMAL = 2 ** -1022;
const KEYS = [
  "model", "coordinateFrameId", "depthAxisId", "signConvention",
  "objectMediumId", "viewerMediumId", "nObject", "nViewer", "trueDepth", "depthUnit",
] as const;

class Decline extends Error {
  constructor(readonly code: PlanarApparentDepthDecline) {
    super(code);
  }
}

function decline(code: PlanarApparentDepthDecline): never {
  throw new Decline(code);
}

function ownData(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) decline("invalid_source_data");
  const prototype: unknown = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) decline("invalid_source_data");
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== KEYS.length || keys.some((key) => typeof key !== "string" || !KEYS.some((allowed) => key === allowed))) decline("invalid_source_data");
  for (const key of KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(descriptors, key)?.value as PropertyDescriptor | undefined;
    if (!descriptor || !Object.hasOwn(descriptor, "value")) decline("invalid_source_data");
  }
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of KEYS) snapshot[key] = descriptors[key]!.value;
  return Object.freeze(snapshot);
}

function identifier(raw: unknown): string {
  if (typeof raw !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(raw)) decline("invalid_frame_or_media");
  return raw;
}

function index(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1e-6 || raw > 1e6) decline("invalid_refractive_index");
  return raw;
}

function resolved(value: number, positive: boolean): number {
  if (!Number.isFinite(value) || (positive && value <= 0) || (value !== 0 && Math.abs(value) < MIN_NORMAL)) decline("unresolved_numeric_output");
  return value;
}

export function derivePlanarApparentDepth(raw: unknown): PlanarApparentDepthResult {
  try {
    const data = ownData(raw);
    if (data.model !== "paraxial_normal_view") decline("invalid_model");
    if (data.signConvention !== "positive_into_object_medium") decline("invalid_sign_convention");
    const coordinateFrameId = identifier(data.coordinateFrameId);
    const depthAxisId = identifier(data.depthAxisId);
    const objectMediumId = identifier(data.objectMediumId);
    const viewerMediumId = identifier(data.viewerMediumId);
    if (objectMediumId === viewerMediumId) decline("invalid_frame_or_media");
    const nObject = index(data.nObject);
    const nViewer = index(data.nViewer);
    const depthUnit = data.depthUnit;
    if (depthUnit !== "m" && depthUnit !== "cm" && depthUnit !== "mm") decline("invalid_depth_unit");
    const trueDepth = data.trueDepth;
    if (typeof trueDepth !== "number" || !Number.isFinite(trueDepth) || trueDepth <= 0 || trueDepth < MIN_NORMAL) decline("invalid_true_depth");
    const divisor = depthUnit === "m" ? 1 : depthUnit === "cm" ? 100 : 1000;
    const trueDepthSI = trueDepth / divisor;
    if (!Number.isFinite(trueDepthSI) || trueDepthSI < 1e-12 || trueDepthSI > 1e12 || trueDepthSI < MIN_NORMAL) decline("invalid_true_depth");
    const ratio = nViewer / nObject;
    const apparentDepth = resolved(trueDepth * ratio, true);
    const apparentDepthSI = resolved(trueDepthSI * ratio, true);
    const shiftFactor = nObject === nViewer ? 0 : (nViewer - nObject) / nObject;
    const signedDepthShift = resolved(trueDepth * shiftFactor, false);
    const signedDepthShiftSI = resolved(trueDepthSI * shiftFactor, false);
    if (nObject !== nViewer && (signedDepthShift === 0 || signedDepthShiftSI === 0 || shiftFactor === 0)) decline("unresolved_numeric_output");
    const value: PlanarApparentDepthAuthority = Object.freeze({
      model: "paraxial_normal_view", coordinateFrameId, depthAxisId,
      signConvention: "positive_into_object_medium", objectMediumId, viewerMediumId,
      nObject, nViewer, trueDepth, depthUnit, trueDepthSI,
      apparentDepth, apparentDepthSI, signedDepthShift, signedDepthShiftSI,
    });
    return Object.freeze({ ok: true, value });
  } catch (error) {
    return Object.freeze({ ok: false, code: error instanceof Decline ? error.code : "invalid_source_data" });
  }
}
