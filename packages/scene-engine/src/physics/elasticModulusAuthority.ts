type VolumeUnit = "m3" | "cm3" | "mm3";
type LengthUnit = "m" | "cm" | "mm";

export interface BulkResponseInput {
  model: "linear_bulk_response";
  initialVolume: number;
  volumeUnit: VolumeUnit;
  deltaVolume: number;
  deltaVolumeUnit: VolumeUnit;
  deltaPressure: number;
  pressureUnit: "Pa" | "kPa" | "MPa";
}

export interface SimpleShearInput {
  model: "linear_simple_shear";
  shearAxisId: string;
  tangentialForce: number;
  forceUnit: "N" | "kN";
  faceArea: number;
  areaUnit: "m2" | "cm2" | "mm2";
  layerDisplacement: number;
  displacementUnit: LengthUnit;
  layerHeight: number;
  heightUnit: LengthUnit;
}

export type ElasticModulusInput = BulkResponseInput | SimpleShearInput;

export interface BulkModulusAuthority extends BulkResponseInput {
  stressConvention: "tension_positive_mean_normal";
  initialVolumeM3: number;
  deltaVolumeM3: number;
  finalVolumeM3: number;
  deltaPressurePa: number;
  strain: number;
  stressPa: number;
  modulusPa: number;
}

export interface ShearModulusAuthority extends SimpleShearInput {
  stressConvention: "shared_axis_tangential";
  forceN: number;
  areaM2: number;
  displacementM: number;
  heightM: number;
  strain: number;
  stressPa: number;
  modulusPa: number;
}

export type ElasticModulusAuthority = BulkModulusAuthority | ShearModulusAuthority;

const VOLUME_UNITS = { m3: 1, cm3: 1e-6, mm3: 1e-9 };
const LENGTH_UNITS = { m: 1, cm: 0.01, mm: 0.001 };
const BULK_KEYS = ["model", "initialVolume", "volumeUnit", "deltaVolume", "deltaVolumeUnit", "deltaPressure", "pressureUnit"];
const SHEAR_KEYS = ["model", "shearAxisId", "tangentialForce", "forceUnit", "faceArea", "areaUnit", "layerDisplacement", "displacementUnit", "layerHeight", "heightUnit"];

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function bounded(value: unknown, key: string, positive = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) < 1e-12 || Math.abs(value) > 1e12 || positive && value <= 0) {
    throw new Error(`${key} must be finite with ${positive ? "positive value" : "nonzero magnitude"} from 1e-12 through 1e12 in SI`);
  }
  return value;
}

function observation(value: unknown, factor: number, key: string, positive = false): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} requires a finite numeric observation`);
  return bounded(value * factor, key, positive);
}

function readUnit<T extends string>(value: unknown, factors: Record<T, number>, key: string): { unit: T; factor: number } {
  if (typeof value !== "string" || !Object.hasOwn(factors, value)) throw new Error(`${key} must declare a supported case-sensitive unit`);
  const unit = value as T;
  return { unit, factor: factors[unit] };
}

function strainWithinModel(value: number): number {
  const strain = bounded(value, "strain");
  if (Math.abs(strain) > 0.01) throw new Error("Observed strain exceeds the conservative supported linear-response subset of 0.01");
  return strain;
}

export function deriveElasticModulus(raw: unknown): Readonly<ElasticModulusAuthority> {
  if (!isRecord(raw)) throw new Error("Elastic response requires a plain structural observation object");
  const keys = Reflect.ownKeys(raw);
  const data: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (typeof key !== "string" || !descriptor || !Object.hasOwn(descriptor, "value")) {
      throw new Error("Elastic observation fields must be own plain data, with no symbols or accessors");
    }
    data[key] = descriptor.value;
  }
  if (!Object.hasOwn(data, "model")) throw new Error("model must be an explicit own source field");
  const model = data.model;
  if (model !== "linear_bulk_response" && model !== "linear_simple_shear") throw new Error("An explicit supported linear bulk or simple-shear model is required");
  const required = model === "linear_bulk_response" ? BULK_KEYS : SHEAR_KEYS;
  if (keys.some((key) => typeof key !== "string" || !required.includes(key))) throw new Error("Elastic response contains unsupported observation fields");
  const missing = required.find((key) => !Object.hasOwn(data, key));
  if (missing) throw new Error(`${missing} must be an explicit own source field`);

  if (model === "linear_bulk_response") {
    const volume = readUnit(data.volumeUnit, VOLUME_UNITS, "volumeUnit");
    const change = readUnit(data.deltaVolumeUnit, VOLUME_UNITS, "deltaVolumeUnit");
    const pressure = readUnit(data.pressureUnit, { Pa: 1, kPa: 1000, MPa: 1e6 }, "pressureUnit");
    const initialVolumeM3 = observation(data.initialVolume, volume.factor, "initialVolumeM3", true);
    const deltaVolumeM3 = observation(data.deltaVolume, change.factor, "deltaVolumeM3");
    const deltaPressurePa = observation(data.deltaPressure, pressure.factor, "deltaPressurePa");
    const finalVolumeM3 = bounded(initialVolumeM3 + deltaVolumeM3, "finalVolumeM3", true);
    if (Math.sign(deltaVolumeM3) === Math.sign(deltaPressurePa)) throw new Error("A positive bulk modulus requires opposite signed pressure and volume changes");
    const strain = strainWithinModel(deltaVolumeM3 / initialVolumeM3);
    const stressPa = -deltaPressurePa;
    const modulusPa = bounded(stressPa / strain, "modulusPa", true);
    return Object.freeze({
      model,
      initialVolume: data.initialVolume as number,
      volumeUnit: volume.unit,
      deltaVolume: data.deltaVolume as number,
      deltaVolumeUnit: change.unit,
      deltaPressure: data.deltaPressure as number,
      pressureUnit: pressure.unit,
      stressConvention: "tension_positive_mean_normal",
      initialVolumeM3,
      deltaVolumeM3,
      finalVolumeM3,
      deltaPressurePa,
      strain,
      stressPa,
      modulusPa,
    });
  }

  const shearAxisId = data.shearAxisId;
  if (typeof shearAxisId !== "string" || !shearAxisId || shearAxisId.trim() !== shearAxisId) throw new Error("Simple shear requires an explicit shared signed-axis ID");
  const force = readUnit(data.forceUnit, { N: 1, kN: 1000 }, "forceUnit");
  const area = readUnit(data.areaUnit, { m2: 1, cm2: 1e-4, mm2: 1e-6 }, "areaUnit");
  const displacement = readUnit(data.displacementUnit, LENGTH_UNITS, "displacementUnit");
  const height = readUnit(data.heightUnit, LENGTH_UNITS, "heightUnit");
  const forceN = observation(data.tangentialForce, force.factor, "forceN");
  const areaM2 = observation(data.faceArea, area.factor, "areaM2", true);
  const displacementM = observation(data.layerDisplacement, displacement.factor, "displacementM");
  const heightM = observation(data.layerHeight, height.factor, "heightM", true);
  if (Math.sign(forceN) !== Math.sign(displacementM)) throw new Error("A positive shear modulus requires force and displacement along the same signed source axis");
  const strain = strainWithinModel(displacementM / heightM);
  const stressPa = bounded(forceN / areaM2, "stressPa");
  const modulusPa = bounded(stressPa / strain, "modulusPa", true);
  return Object.freeze({
    model,
    shearAxisId,
    tangentialForce: data.tangentialForce as number,
    forceUnit: force.unit,
    faceArea: data.faceArea as number,
    areaUnit: area.unit,
    layerDisplacement: data.layerDisplacement as number,
    displacementUnit: displacement.unit,
    layerHeight: data.layerHeight as number,
    heightUnit: height.unit,
    stressConvention: "shared_axis_tangential",
    forceN,
    areaM2,
    displacementM,
    heightM,
    strain,
    stressPa,
    modulusPa,
  });
}
