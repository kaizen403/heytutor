export interface BohrOrbitInput {
  model: "bohr_hydrogenic";
  electronCount: 1;
  Z: number;
  n: number;
  groundRadius: number;
  radiusUnit: "m" | "nm";
  radiusConvention: "hydrogen_reference" | "ion_ground";
  groundSpeed: number;
  speedUnit: "m/s" | "km/s";
  speedConvention: "hydrogen_reference" | "ion_ground";
}

export interface BohrOrbitAuthority extends BohrOrbitInput {
  groundRadiusM: number;
  groundSpeedMPerS: number;
  radius: number;
  radiusM: number;
  speed: number;
  speedMPerS: number;
}

const REQUIRED_KEYS = [
  "model", "electronCount", "Z", "n", "groundRadius", "radiusUnit", "radiusConvention",
  "groundSpeed", "speedUnit", "speedConvention",
];
const INPUT_KEYS = new Set(REQUIRED_KEYS);
const MIN_NORMAL = 2 ** -1022;
const MAX_SPEED_M_PER_S = 299792458 / 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedInteger(value: unknown, key: string, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${key} must be an integer from 1 through ${max}`);
  }
  return value;
}

function positiveNormal(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < MIN_NORMAL) {
    throw new Error(`${key} must remain positive and finite at normal double precision`);
  }
  return value;
}

function convention(value: unknown, key: string): "hydrogen_reference" | "ion_ground" {
  if (value !== "hydrogen_reference" && value !== "ion_ground") {
    throw new Error(`${key} must explicitly identify hydrogen_reference or ion_ground`);
  }
  return value;
}

function supportedSpeed(value: number, key: string): void {
  if (value > MAX_SPEED_M_PER_S) {
    throw new Error(`${key} exceeds the conservative supported nonrelativistic bound of 0.1c`);
  }
}

export function deriveBohrOrbit(raw: unknown): Readonly<BohrOrbitAuthority> {
  if (!isRecord(raw) || Reflect.ownKeys(raw).some((key) => typeof key !== "string" || !INPUT_KEYS.has(key))) {
    throw new Error("Bohr orbit inputs must contain only the supported structural source fields");
  }
  const inputs: Record<string, unknown> = Object.create(null);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(raw))) {
    if (!Object.hasOwn(descriptor, "value")) {
      throw new Error("Bohr inputs must contain only own data source fields");
    }
    inputs[key] = descriptor.value;
  }
  const missing = REQUIRED_KEYS.find((key) => !Object.hasOwn(inputs, key));
  if (missing) throw new Error(`${missing} must be an explicit own source field`);
  if (inputs.model !== "bohr_hydrogenic" || inputs.electronCount !== 1) {
    throw new Error("Bohr orbit scalars require an explicit one-electron bohr_hydrogenic model");
  }
  const Z = boundedInteger(inputs.Z, "Z", 10);
  const n = boundedInteger(inputs.n, "n", 64);
  const groundRadius = positiveNormal(inputs.groundRadius, "groundRadius");
  const groundSpeed = positiveNormal(inputs.groundSpeed, "groundSpeed");
  const radiusUnit = inputs.radiusUnit;
  if (radiusUnit !== "m" && radiusUnit !== "nm") throw new Error("radiusUnit must be case-sensitive m or nm");
  const speedUnit = inputs.speedUnit;
  if (speedUnit !== "m/s" && speedUnit !== "km/s") throw new Error("speedUnit must be case-sensitive m/s or km/s");
  const radiusConvention = convention(inputs.radiusConvention, "radiusConvention");
  const speedConvention = convention(inputs.speedConvention, "speedConvention");
  const radiusConversion = radiusUnit === "nm" ? 1e-9 : 1;
  const speedConversion = speedUnit === "km/s" ? 1000 : 1;
  const groundRadiusM = positiveNormal(groundRadius * radiusConversion, "groundRadiusM");
  const groundSpeedMPerS = positiveNormal(groundSpeed * speedConversion, "groundSpeedMPerS");
  supportedSpeed(groundSpeedMPerS, "groundSpeedMPerS");
  const ionGroundSpeed = positiveNormal(groundSpeedMPerS * (speedConvention === "hydrogen_reference" ? Z : 1), "ionGroundSpeed");
  supportedSpeed(ionGroundSpeed, "ionGroundSpeed");

  const radius = positiveNormal(groundRadius * (n ** 2 / (radiusConvention === "hydrogen_reference" ? Z : 1)), "radius");
  const speed = positiveNormal(groundSpeed * ((speedConvention === "hydrogen_reference" ? Z : 1) / n), "speed");
  const radiusM = positiveNormal(radius * radiusConversion, "radiusM");
  const speedMPerS = positiveNormal(speed * speedConversion, "speedMPerS");
  supportedSpeed(speedMPerS, "speedMPerS");

  return Object.freeze({
    model: "bohr_hydrogenic",
    electronCount: 1,
    Z,
    n,
    groundRadius,
    radiusUnit,
    radiusConvention,
    groundSpeed,
    speedUnit,
    speedConvention,
    groundRadiusM,
    groundSpeedMPerS,
    radius,
    radiusM,
    speed,
    speedMPerS,
  });
}
