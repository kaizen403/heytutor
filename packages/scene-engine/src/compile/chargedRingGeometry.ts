import { isometricProject, type Vec3, type SpaceFrame } from "../math/space";
import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import { electricSourceScalar, electricSourceUnits } from "./dipoleSourceUnits";
import { validatePublicationDerivedClaims } from "./publicationDerivedClaims";
import type { SpaceSegmentDefinition } from "./spaceDerivations";

export interface ChargedRingDefinition {
  model: "uniform_charged_ring_axial";
  frameId: string;
  center: Vec3;
  radius: number;
  chargeSI: number;
  radiusSI: number;
  axialDistanceSI: number;
  k: number;
  kUnit: "N*m^2/C^2";
  axialField: number;
  componentsSI: Vec3;
  unit: "N/C";
  sourceUnits: { charge: string; length: string };
  zero: boolean;
  /** Only field output has independently normalized display length. */
  displayLength?: number;
}
export type ChargedRingGeometry =
  | { kind: "path"; points: RenderPoint[]; chargedRing: ChargedRingDefinition }
  | { kind: "point"; point: RenderPoint; space: Vec3; spaceFrameId: string; chargedRing: ChargedRingDefinition }
  | { kind: "path"; points: RenderPoint[]; directed: true; spaceSegment: SpaceSegmentDefinition; chargedRing: ChargedRingDefinition };
interface Context { number(value: unknown): number; geometry(value: unknown): unknown }
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function fail(message: string): never { throw new Error(`Charged ring: ${message}`); }
function finite(value: number, maximum = 1e9): number {
  if (!Number.isFinite(value) || Math.abs(value) > maximum) fail("source coordinates must be finite and bounded");
  return value;
}
function world(value: unknown): Vec3 {
  if (!record(value) || typeof value.x !== "number" || typeof value.y !== "number" || typeof value.z !== "number") fail("center requires verified world coordinates");
  return { x: finite(value.x), y: finite(value.y), z: finite(value.z) };
}
/** A translated source displacement must survive at its own local scale. */
function displaced(origin: Vec3, delta: Vec3): Vec3 {
  const end = { x: finite(origin.x + delta.x), y: finite(origin.y + delta.y), z: finite(origin.z + delta.z) };
  const length = Math.hypot(delta.x, delta.y, delta.z);
  if (length > 0) {
    const actual = { x: end.x - origin.x, y: end.y - origin.y, z: end.z - origin.z };
    const error = Math.hypot(actual.x - delta.x, actual.y - delta.y, actual.z - delta.z);
    if (!(Math.hypot(actual.x, actual.y, actual.z) > 0) || error > (1e-6 + 16 * Number.EPSILON) * length) {
      fail("source displacement is lost or materially distorted by translated floating-point coordinates");
    }
  }
  return end;
}
function scalar(value: unknown, unit: string, dimension: "charge" | "length" | "other", context: Context, document: SceneDocument): number {
  const number = context.number(electricSourceScalar(value, unit, dimension, document));
  if (!Number.isFinite(number)) fail("source scalar must be finite");
  return number;
}
export function evaluateChargedRing(inputs: Record<string, unknown>, context: Context, document: SceneDocument): ChargedRingGeometry[] {
  if (Object.keys(inputs).some((key) => !["frame", "center", "radius", "charge", "axialDistance", "k", "displayLength", "units"].includes(key))) fail("unsupported input; only the uniform axial model is implemented");
  const units = electricSourceUnits(inputs.units);
  if (typeof inputs.frame !== "string" || typeof inputs.center !== "string") fail("frame and center must reference constructed world geometry");
  const frameGeometry = context.geometry(inputs.frame), centerGeometry = context.geometry(inputs.center);
  if (!record(frameGeometry) || frameGeometry.kind !== "compound" || !record(frameGeometry.spaceFrame) || !record(frameGeometry.spaceFrame.origin)) fail("frame must reference a space_frame");
  const frameData = frameGeometry.spaceFrame;
  if (!record(frameData.origin)) fail("invalid projection origin");
  if (typeof frameData.origin.x !== "number" || typeof frameData.origin.y !== "number" || typeof frameData.scale !== "number" || !(frameData.scale > 0)) fail("invalid projection frame");
  const frame: SpaceFrame = { origin: { x: finite(frameData.origin.x, 1e12), y: finite(frameData.origin.y, 1e12) }, scale: finite(frameData.scale) };
  if (!record(centerGeometry) || centerGeometry.kind !== "point" || centerGeometry.spaceFrameId !== inputs.frame) fail("center must be a space_point in the exact declared frame");
  const producer = document.constructions.find((construction) => construction.outputs.includes(inputs.center as string));
  if (producer?.operator !== "space_point" || producer.inputs.frame !== inputs.frame) fail("center must retain direct space_point source provenance");
  for (const coordinate of [producer.inputs.x, producer.inputs.y, producer.inputs.z]) electricSourceScalar(coordinate, units.length, "length", document);
  const center = world(centerGeometry.space);
  const radius = scalar(inputs.radius, units.length, "length", context, document), charge = scalar(inputs.charge, units.charge, "charge", context, document);
  const axialDistance = finite(scalar(inputs.axialDistance, units.length, "length", context, document));
  const k = scalar(inputs.k, "N*m^2/C^2", "other", context, document);
  const displayLength = finite(scalar(inputs.displayLength, "1", "other", context, document));
  if (!(radius > 0) || radius > 1e9 || !(k > 0) || !(displayLength > 0)) fail("radius, explicit physical Coulomb constant and display length must be positive");
  const radiusSI = radius * units.lengthFactor, distanceSI = axialDistance * units.lengthFactor, chargeSI = charge * units.chargeFactor;
  if (!(radiusSI > 0) || !Number.isFinite(radiusSI) || !Number.isFinite(distanceSI) || !Number.isFinite(chargeSI)
    || charge !== 0 && chargeSI === 0 || axialDistance !== 0 && distanceSI === 0) fail("unit conversion must preserve finite nonzero sources");
  const denominator = Math.hypot(radiusSI, distanceSI);
  const zero = chargeSI === 0 || distanceSI === 0;
  // Compute with an axial direction cosine to avoid squaring/cubing very large source lengths.
  const axialField = zero ? 0 : ((k * chargeSI / denominator) / denominator) * (distanceSI / denominator);
  if (!Number.isFinite(axialField) || !zero && axialField === 0) fail("nonzero physical field must remain finite and nonzero");
  const definition: ChargedRingDefinition = { model: "uniform_charged_ring_axial", frameId: inputs.frame, center, radius, chargeSI, radiusSI, axialDistanceSI: distanceSI, k, kUnit: "N*m^2/C^2", axialField, componentsSI: { x: 0, y: 0, z: axialField }, unit: "N/C", sourceUnits: { charge: units.charge, length: units.length }, zero };
  const project = (point: Vec3): RenderPoint => {
    const projected = isometricProject(point, frame);
    return { x: finite(projected.x, 1e12), y: finite(projected.y, 1e12) };
  };
  const ringPoints = Array.from({ length: 97 }, (_, index) => {
    const angle = (index === 96 ? 0 : index * 2 * Math.PI / 96);
    return project(displaced(center, { x: radius * Math.cos(angle), y: radius * Math.sin(angle), z: 0 }));
  });
  const at = displaced(center, { x: 0, y: 0, z: axialDistance });
  const fieldMetadata = { ...definition, displayLength };
  const field: ChargedRingGeometry = zero
    ? { kind: "point", point: project(at), space: at, spaceFrameId: inputs.frame, chargedRing: fieldMetadata }
    : (() => {
      const end = displaced(at, { x: 0, y: 0, z: Math.sign(axialField) * displayLength });
      if (end.z === at.z) fail("nonzero field arrow is unresolved at this world coordinate");
      const points = [project(at), project(end)];
      if (!(Math.hypot(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y) > 1e-9)) fail("field arrow collapses under projection");
      return { kind: "path", points, directed: true, spaceSegment: { frameId: inputs.frame, a: at, b: end, length: displayLength }, chargedRing: fieldMetadata };
    })();
  return [{ kind: "path", points: ringPoints, chargedRing: definition }, { kind: "point", point: project(at), space: at, spaceFrameId: inputs.frame, chargedRing: definition }, field];
}
function numeric(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) fail("cyclic or overdeep source quantities");
  if (typeof value === "number" && Number.isFinite(value)) return value;
  seen.add(value);
  if (record(value) && "value" in value) return numeric(value.value, document, seen, depth + 1);
  if (typeof value === "string") {
    const quantity = document.quantities.find((candidate) => candidate.id === value);
    if (quantity) return numeric(quantity.value, document, seen, depth + 1);
    if (value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return fail("source quantity must resolve to a finite scalar");
}
export function validateChargedRing(construction: SceneConstruction, index: number, document: SceneDocument, issues: SceneIssue[]): void {
  if (construction.operator !== "charged_ring_axial_field") return;
  const add = (message: string): void => { issues.push({ code: "invalid_charged_ring", severity: "fatal", message, path: `constructions[${index}]`, entityIds: construction.outputs }); };
  if (construction.outputs.length !== 3 || new Set(construction.outputs).size !== 3 || construction.outputs.some((id, i) => document.entities.find((entity) => entity.id === id)?.kind !== ["polyline", "point", "vector"][i])) add("charged_ring_axial_field requires distinct [ring:polyline, observation:point, field:vector] outputs");
  try {
    const context: Context = { number: (value) => numeric(value, document), geometry(value) {
      const producer = document.constructions.find((candidate) => candidate.outputs.includes(value as string));
      if (producer?.operator === "space_frame") return { kind: "compound", spaceFrame: { origin: { x: 0, y: 0 }, scale: producer.inputs.scale === undefined ? 1 : numeric(producer.inputs.scale, document) } };
      if (producer?.operator === "space_point") return { kind: "point", space: { x: numeric(producer.inputs.x, document), y: numeric(producer.inputs.y, document), z: numeric(producer.inputs.z, document) }, spaceFrameId: producer.inputs.frame };
      return undefined;
    } };
    evaluateChargedRing(construction.inputs, context, document);
  } catch (error) { add(error instanceof Error ? error.message : "Invalid charged ring source"); }
}
function isChargedRingGeometry(value: unknown): value is ChargedRingGeometry {
  return record(value) && record(value.chargedRing) && value.chargedRing.model === "uniform_charged_ring_axial"
    && value.chargedRing.unit === "N/C" && typeof value.chargedRing.axialField === "number" && Number.isFinite(value.chargedRing.axialField);
}
export function chargedRingLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): string[] {
  const definitions = outputs.map((output) => {
    if (!record(output) || !record(output.chargedRing)) fail("typed field metadata is missing");
    if (!isChargedRingGeometry(output)) fail("inconsistent typed ring field metadata");
    return output.chargedRing;
  });
  validatePublicationDerivedClaims(construction, index, document, [{ R: definitions[0]!.radius }, {}, { E: Math.abs(definitions[2]!.axialField), Ez: definitions[2]!.axialField, magnitude: Math.abs(definitions[2]!.axialField) }], issues, [{ R: definitions[0]!.sourceUnits.length }, {}, { E: "N/C", Ez: "N/C", magnitude: "N/C" }]);
  const magnitude = Math.abs(definitions[2]!.axialField);
  let label = "E=0 N/C";
  if (magnitude !== 0) {
    for (let digits = 4; digits >= 1; digits--) {
      const text = String(Number(magnitude.toPrecision(digits)));
      label = `E≈${text} N/C`;
      if (label.length <= 16) break;
    }
  }
  return [document.entities.find((entity) => entity.id === construction.outputs[0])?.label ?? "ring", document.entities.find((entity) => entity.id === construction.outputs[1])?.label ?? "P", label];
}
