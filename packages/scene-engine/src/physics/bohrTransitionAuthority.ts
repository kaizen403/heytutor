export interface BohrTransitionInput {
  model: "bohr_hydrogenic";
  electronCount: 1;
  Z: number;
  nFrom: number;
  nTo: number;
  bindingEnergy: number;
  bindingEnergyConvention: "hydrogen_reference" | "ion_ground";
  energyUnit: "eV" | "J";
  direction?: "emission" | "absorption";
}

export interface BohrTransitionAuthority extends BohrTransitionInput {
  direction: "emission" | "absorption";
  energyFrom: number;
  energyTo: number;
  atomicDelta: number;
  photonEnergy: number;
  energyFromJ: number;
  energyToJ: number;
  atomicDeltaJ: number;
  photonEnergyJ: number;
}

const JOULES_PER_EV = 1.602176634e-19;
const MIN_NORMAL = 2 ** -1022;
const INPUT_KEYS = new Set([
  "model", "electronCount", "Z", "nFrom", "nTo", "bindingEnergy", "bindingEnergyConvention", "energyUnit", "direction",
]);
const REQUIRED_KEYS = ["model", "electronCount", "Z", "nFrom", "nTo", "bindingEnergy", "bindingEnergyConvention", "energyUnit"];

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

function normalNumber(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) < MIN_NORMAL) {
    throw new Error(`${key} must remain nonzero and finite at normal double precision`);
  }
  return value;
}

export function deriveBohrTransition(raw: unknown): Readonly<BohrTransitionAuthority> {
  if (!isRecord(raw) || Reflect.ownKeys(raw).some((key) => typeof key !== "string" || !INPUT_KEYS.has(key))) {
    throw new Error("Bohr transition inputs must be an object containing only supported source fields");
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
    throw new Error("Bohr transitions require an explicit one-electron bohr_hydrogenic model");
  }
  const Z = boundedInteger(inputs.Z, "Z", 10);
  const nFrom = boundedInteger(inputs.nFrom, "nFrom", 64);
  const nTo = boundedInteger(inputs.nTo, "nTo", 64);
  if (nFrom === nTo) throw new Error("A photon transition requires distinct initial and final levels");

  const bindingEnergy = normalNumber(inputs.bindingEnergy, "bindingEnergy");
  if (!(bindingEnergy > 0)) throw new Error("The supplied ground binding energy must be positive");
  const bindingEnergyConvention = inputs.bindingEnergyConvention;
  if (bindingEnergyConvention !== "hydrogen_reference" && bindingEnergyConvention !== "ion_ground") {
    throw new Error("The binding energy must explicitly identify a hydrogen_reference or ion_ground convention");
  }
  const energyUnit = inputs.energyUnit;
  if (energyUnit !== "eV" && energyUnit !== "J") {
    throw new Error("The supplied binding energy must declare case-sensitive eV or J units");
  }
  const direction = nTo > nFrom ? "absorption" : "emission";
  if (Object.hasOwn(inputs, "direction") && inputs.direction !== direction) {
    throw new Error("The declared photon direction contradicts the ordered initial and final levels");
  }

  const chargeScale = bindingEnergyConvention === "hydrogen_reference" ? Z ** 2 : 1;
  const energyFrom = normalNumber(-bindingEnergy * (chargeScale / nFrom ** 2), "energyFrom");
  const energyTo = normalNumber(-bindingEnergy * (chargeScale / nTo ** 2), "energyTo");
  const deltaFactor = chargeScale * (nTo - nFrom) * (nTo + nFrom) / (nFrom ** 2 * nTo ** 2);
  const atomicDelta = normalNumber(bindingEnergy * deltaFactor, "atomicDelta");
  if (Math.sign(atomicDelta) !== Math.sign(energyTo - energyFrom)) {
    throw new Error("The ordered level energies cannot resolve the signed transition");
  }
  const residual = Math.abs(energyTo - energyFrom - atomicDelta);
  const closureTolerance = 64 * Number.EPSILON * Math.max(Math.abs(energyFrom), Math.abs(energyTo));
  if (residual > closureTolerance) throw new Error("The transition does not close at source precision");

  const photonEnergy = Math.abs(atomicDelta);
  const toJoules = energyUnit === "eV" ? JOULES_PER_EV : 1;
  return Object.freeze({
    model: "bohr_hydrogenic",
    electronCount: 1,
    Z,
    nFrom,
    nTo,
    bindingEnergy,
    bindingEnergyConvention,
    energyUnit,
    direction,
    energyFrom,
    energyTo,
    atomicDelta,
    photonEnergy,
    energyFromJ: normalNumber(energyFrom * toJoules, "energyFromJ"),
    energyToJ: normalNumber(energyTo * toJoules, "energyToJ"),
    atomicDeltaJ: normalNumber(atomicDelta * toJoules, "atomicDeltaJ"),
    photonEnergyJ: normalNumber(photonEnergy * toJoules, "photonEnergyJ"),
  });
}
