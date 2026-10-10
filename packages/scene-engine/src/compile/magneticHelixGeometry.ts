import { isometricProject, vec3Length, type SpaceFrame, type Vec3 } from "../math/space";
import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export interface MagneticHelixDefinition {
  frameId: string;
  origin: Vec3;
  axis: Vec3;
  velocity: Vec3;
  perpendicularVelocity: Vec3;
  angularFrequency: number;
  radius: number;
  pitch: number;
  period: number;
  turns: number;
  displayScale: number;
}
export interface MagneticHelixGeometry { kind: "path"; points: RenderPoint[]; magneticHelix: MagneticHelixDefinition }
interface Context { number(value: unknown): number; geometry(value: unknown): unknown }
const TAU = 2 * Math.PI;
const UNITS = { mass: "kg", charge: "C", velocity: "m/s", magneticField: "T" } as const;
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fail(message: string): never { throw new Error(`magnetic_helix: ${message}`); }
function finite(value: number, name: string): number { if (!Number.isFinite(value)) fail(`${name} must be finite and numerically representable`); return value; }
function scalar(value: unknown, name: string, context: Context): number {
  if (typeof value !== "number" && typeof value !== "string" && !record(value)) fail(`${name} must be a numeric literal or quantity reference`);
  const result = finite(context.number(value), name);
  if (typeof value === "string" && Number(value) === 0 && /[1-9]/.test(value) && result === 0) fail(`${name} must not underflow`);
  return result;
}
function vector(value: unknown, name: string, context: Context): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) return fail(`${name} requires exactly three SI components`);
  return { x: scalar(value[0], name, context), y: scalar(value[1], name, context), z: scalar(value[2], name, context) };
}
const scale = (v: Vec3, k: number): Vec3 => ({ x: v.x * k, y: v.y * k, z: v.z * k });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** Uniform B: integrate dv/dt=(q/m)v×B, retaining the sign of q. */
export function magneticHelixPoint(definition: MagneticHelixDefinition, time: number): Vec3 {
  const { origin, axis, velocity, perpendicularVelocity: transverse, angularFrequency: omega, displayScale } = definition;
  const phase = omega * time;
  const parallel = scale(axis, dot(velocity, axis));
  const displacement = add(scale(parallel, time), add(scale(transverse, Math.sin(phase) / omega), scale(cross(transverse, axis), (1 - Math.cos(phase)) / omega)));
  return add(origin, scale(displacement, displayScale));
}

export function evaluateMagneticHelix(inputs: Record<string, unknown>, context: Context): MagneticHelixGeometry[] {
  const extra = Object.keys(inputs).filter(key => !["frame", "origin", "mass", "charge", "velocity", "magneticField", "turns", "displayScale", "units"].includes(key));
  if (extra.length) fail(`unsupported inputs: ${extra.join(", ")}`);
  if (!record(inputs.units) || Object.keys(inputs.units).some(key => !(key in UNITS))) fail("explicit SI units are required");
  for (const [name, unit] of Object.entries(UNITS)) if (inputs.units[name] !== unit) fail(`${name} must declare SI ${unit}`);
  const frameGeometry = context.geometry(inputs.frame);
  const start = context.geometry(inputs.origin);
  if (typeof inputs.frame !== "string" || !record(frameGeometry) || !record(frameGeometry.spaceFrame)) fail("frame must reference space_frame");
  if (!record(start) || start.kind !== "point" || start.spaceFrameId !== inputs.frame || !record(start.space)) fail("origin must be a space_point in the same frame");
  const origin = start.space as unknown as Vec3;
  const frame = frameGeometry.spaceFrame as unknown as SpaceFrame;
  const mass = scalar(inputs.mass, "mass", context), charge = scalar(inputs.charge, "charge", context);
  const velocity = vector(inputs.velocity, "velocity", context), field = vector(inputs.magneticField, "magneticField", context);
  const turns = scalar(inputs.turns, "turns", context), displayScale = inputs.displayScale === undefined ? 1 : scalar(inputs.displayScale, "displayScale", context);
  const fieldNorm = finite(vec3Length(field), "field magnitude");
  if (!(mass > 0) || charge === 0 || !(fieldNorm > 0)) fail("mass must be positive; charge and B must be nonzero");
  if (!(turns > 0 && turns <= 12) || !(displayScale > 0)) fail("turns must be in (0,12] and displayScale must be positive");
  const axis = scale(field, 1 / fieldNorm), parallelSpeed = dot(velocity, axis);
  const perpendicularVelocity = add(velocity, scale(axis, -parallelSpeed));
  const transverseSpeed = vec3Length(perpendicularVelocity), speed = vec3Length(velocity);
  if (!(transverseSpeed > 64 * Number.EPSILON * speed) || !(Math.abs(parallelSpeed) > 64 * Number.EPSILON * speed)) fail("a helix requires resolved transverse and parallel velocity; use circle or line for limiting cases");
  const angularFrequency = finite(charge * (fieldNorm / mass), "angular frequency");
  if (angularFrequency === 0) fail("angular frequency must not underflow");
  const period = finite(TAU / Math.abs(angularFrequency), "period"), radius = finite(transverseSpeed / Math.abs(angularFrequency), "radius"), pitch = finite(parallelSpeed * period, "pitch");
  if (!(period > 0 && radius > 0) || pitch === 0) fail("helix measurements must not underflow");
  const magneticHelix: MagneticHelixDefinition = { frameId: inputs.frame, origin, axis, velocity, perpendicularVelocity, angularFrequency, period, radius, pitch, turns, displayScale };
  const samples = Math.max(24, Math.ceil(turns * 96));
  const points = Array.from({ length: samples + 1 }, (_, index) => {
    const world = magneticHelixPoint(magneticHelix, turns * period * index / samples);
    if (![world.x, world.y, world.z].every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) fail("world positions exceed finite geometry bounds");
    const point = isometricProject(world, frame);
    if (![point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e12)) fail("projection exceeds finite geometry bounds");
    return point;
  });
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  if (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < 1e-9) fail("helix collapses at the chosen display scale");
  return [{ kind: "path", points, magneticHelix }];
}

function documentNumber(value: unknown, document: SceneDocument, depth = 0): number {
  if (depth > 32) return fail("cyclic or deep quantity reference");
  if (record(value)) return documentNumber(value.value, document, depth + 1);
  const quantity = typeof value === "string" ? document.quantities.find(q => q.id === value) : undefined;
  if (quantity) return documentNumber(quantity.value, document, depth + 1);
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return fail("invalid scalar quantity");
  const number = Number(value);
  if (number === 0 && typeof value === "string" && /[1-9]/.test(value)) fail("scalar must not underflow");
  return finite(number, "quantity");
}
export function validateMagneticHelixConstruction(construction: SceneConstruction, index: number, document: SceneDocument, producers: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  try {
    if (construction.outputs.length !== 1 || document.entities.find(e => e.id === construction.outputs[0])?.kind !== "polyline") fail("requires one polyline output");
    if (typeof construction.inputs.frame !== "string" || producers.get(construction.inputs.frame)?.operator !== "space_frame") fail("frame must reference space_frame");
    const origin = typeof construction.inputs.origin === "string" ? producers.get(construction.inputs.origin) : undefined;
    if (origin?.operator !== "space_point" || origin.inputs.frame !== construction.inputs.frame) fail("origin must reference a same-frame space_point");
    const checkUnits = (value: unknown, expected: string, depth = 0): void => {
      if (depth > 32) fail("cyclic or deep unit reference");
      const quantity = typeof value === "string" ? document.quantities.find(q => q.id === value) : undefined;
      const entry = quantity ?? (record(value) ? value : undefined);
      if (entry) {
        if (entry.unit !== undefined && entry.unit !== expected) fail(`quantity unit must be SI ${expected}`);
        checkUnits(entry.value, expected, depth + 1);
      }
    };
    checkUnits(construction.inputs.mass, "kg"); checkUnits(construction.inputs.charge, "C");
    for (const name of ["velocity", "magneticField"] as const) if (Array.isArray(construction.inputs[name])) for (const value of construction.inputs[name]) checkUnits(value, UNITS[name]);
    // Evaluate all physical fields through the same seam; constructed origin
    // and frame geometry are validated independently and supplied as sentinels.
    evaluateMagneticHelix(construction.inputs, {
      number: value => documentNumber(value, document),
      geometry: id => id === construction.inputs.frame ? { kind: "compound", spaceFrame: { origin: { x: 0, y: 0 }, scale: 1 } } : id === construction.inputs.origin ? { kind: "point", spaceFrameId: construction.inputs.frame, space: { x: 0, y: 0, z: 0 } } : undefined,
    });
  } catch (error) { issues.push({ code: "invalid_magnetic_helix", message: error instanceof Error ? error.message : "invalid helix", severity: "fatal", path: `constructions[${index}]` }); }
}

/** Radius and pitch claims are measurements of the source law, never pixels. */
export function validateMagneticHelixLabels(construction: SceneConstruction, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  const output = outputs[0];
  if (!record(output) || !record(output.magneticHelix)) return;
  const definition = output.magneticHelix as unknown as MagneticHelixDefinition;
  const check = (inputText: unknown, quantityId?: string): void => {
    if (typeof inputText !== "string") return;
    const text = inputText.replaceAll("−", "-");
    const named = /\b(r(?:adius)?|p(?:itch)?)\s*(=|≈|~)\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(m|cm|mm)\b/gi;
    const matches = [...text.matchAll(named)];
    // Every standalone number must belong to a parsed source measurement.
    // Symbol indices and descriptions such as 3D are names, not values.
    const unclaimed = matches.reduce((remaining, match) => remaining.replace(match[0], " "), text).replace(/\b[123]D\b/gi, " ");
    const number = /(?<![\p{L}\p{N}_'′^.])[+\-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+\-]?\d+)?/iu;
    if (number.test(unclaimed) || /\b(?:r(?:adius)?|p(?:itch)?)\s*[=≈~]\s*\S/i.test(unclaimed) || /(?<![\p{L}\p{N}_])(?:π|pi|∞|Infinity|NaN)(?=\s*(?:m|cm|mm)\b|\s*[;,)]?\s*$)/iu.test(unclaimed)) fail("numeric helix labels require radius or pitch with a length unit");
    for (const [index, match] of matches.entries()) {
      const next = matches[index + 1];
      const suffix = text.slice(match.index! + match[0].length, next?.index);
      const endsMeasurement = next ? /^\s*(?:[,;:]|and)?\s*$/i.test(suffix) : /^\s*[.;,)]?\s*$/.test(suffix);
      if (!["m", "cm", "mm"].includes(match[4]!) || !endsMeasurement) fail("helix measurements require one length unit");
      const expected = match[1]!.toLowerCase().startsWith("r") ? definition.radius : definition.pitch;
      const actual = Number(match[3]) * ({ m: 1, cm: 0.01, mm: 0.001 }[match[4]!.toLowerCase()] ?? 1);
      const tolerance = match[2] === "=" ? 1e-9 : 0.001;
      if (Math.abs(actual - expected) > tolerance * Math.abs(expected)) fail("radius or pitch label contradicts the source-derived helix");
    }
    if (quantityId) {
      const quantity = document.quantities.find(q => q.id === quantityId);
      const symbol = `${quantity?.symbol ?? ""} ${quantity?.id ?? ""}`.trim();
      const expected = /^(?:r|radius)(?:\s|$)/i.test(symbol) ? definition.radius : /^(?:p|pitch)(?:\s|$)/i.test(symbol) ? definition.pitch : undefined;
      if (expected === undefined) fail("helix quantity annotations must identify radius or pitch");
      const factor = { m: 1, cm: 0.01, mm: 0.001 }[String(quantity?.unit) as "m" | "cm" | "mm"];
      const tolerance = /[≈~]/.test(text) ? 0.001 : 1e-9;
      if (factor === undefined || Math.abs(documentNumber(quantityId, document) * factor - expected) > tolerance * Math.abs(expected)) fail("helix quantity contradicts its source-derived measurement");
    }
  };
  try {
    const id = construction.outputs[0]!;
    check(document.entities.find(e => e.id === id)?.label);
    for (const annotation of document.annotations) if (annotation.targetIds.includes(id) && ["label", "callout"].includes(annotation.kind)) check(annotation.text, annotation.quantityId);
    for (const label of document.constructions) if (label.operator === "label" && (label.inputs.target ?? label.inputs.at ?? label.inputs.point) === id) check(label.inputs.text);
  } catch (error) { issues.push({ code: "invalid_magnetic_helix_label", message: error instanceof Error ? error.message : "invalid helix label", severity: "fatal", entityIds: construction.outputs }); }
}
