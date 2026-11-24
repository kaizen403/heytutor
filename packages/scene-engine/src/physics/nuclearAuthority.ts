/** Bounded scalar physics. Display coordinates never act as physical inputs.
 * Relations: OpenStax University Physics vol.3 §§10.1–10.3; constants: NIST CODATA 2022.
 * https://openstax.org/books/university-physics-volume-3/pages/10-2-nuclear-binding-energy
 * https://physics.nist.gov/cuu/Constants/Table/allascii.txt
 */
export const SECONDS_PER_TIME_UNIT: Readonly<Record<string, number>> = Object.freeze({ s: 1, min: 60, h: 3600, d: 86400, y: 31557600 });
export const MEV_PER_U = 931.49410372;
export const SPEED_OF_LIGHT = 299792458;

function finite(value: number, name: string, positive = false): number {
  if (!Number.isFinite(value) || Math.abs(value) > 1e30 || positive && !(value > 0) || value !== 0 && Math.abs(value) < 2 ** -1022) {
    throw new Error(`${name} must remain ${positive ? "positive, " : ""}finite and representable`);
  }
  return value === 0 ? 0 : value;
}
function integer(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer in [${minimum}, ${maximum}]`);
  return value;
}

export function deriveNuclide(A: number, Z: number, radiusConstant?: number, radiusUnit?: "m" | "fm") {
  integer(A, "A", 1, 300); integer(Z, "Z", 0, A);
  if (radiusUnit !== undefined && radiusUnit !== "m" && radiusUnit !== "fm") throw new Error("Nuclear radius unit must be m or fm");
  if ((radiusConstant === undefined) !== (radiusUnit === undefined)) throw new Error("Nuclear radius requires both its stated constant and unit");
  const radius = radiusConstant === undefined ? undefined : finite(finite(radiusConstant, "radius constant", true) * Math.cbrt(A), "radius", true);
  return Object.freeze({ A, Z, N: A - Z, radius, radiusUnit });
}

/** Instantaneous activity is a rate, never a future event count or detector
 * count. The caller must independently prove population and lambda refer to
 * the same state. No initial population or time interval is implied. */
export function deriveRadioactiveActivity(population: number, lambda: number, timeUnit: string) {
  finite(population, "population"); finite(lambda, "decay constant");
  if (population < 0 || lambda < 0) throw new Error("Population and decay constant cannot be negative");
  const seconds = SECONDS_PER_TIME_UNIT[timeUnit];
  if (!seconds) throw new Error("Activity requires an explicit supported time unit");
  const lambdaPerSecond = finite(lambda / seconds, "decay constant per second");
  const activity = finite(lambdaPerSecond * population, "activity");
  if (lambda !== 0 && lambdaPerSecond === 0 || population !== 0 && lambdaPerSecond !== 0 && activity === 0)
    throw new Error("Nonzero activity inputs cannot underflow to a zero result");
  return Object.freeze({ population, lambdaPerSecond, activity, unit: "Bq" as const });
}

export type DecayObservable = "population" | "activity" | "population_fraction" | "activity_fraction";
export function deriveRadioactiveDecay(initial: number, halfLife: number, time: number, timeUnit: string, observable: DecayObservable) {
  if (!["population", "activity", "population_fraction", "activity_fraction"].includes(observable)) throw new Error("Unsupported decay observable");
  finite(initial, "initial population", true); finite(halfLife, "half-life", true); finite(time, "time");
  if (time < 0) throw new Error("Decay time cannot precede the stated initial state");
  const seconds = SECONDS_PER_TIME_UNIT[timeUnit];
  if (!seconds) throw new Error("Decay requires a case-sensitive s, min, h, d, or y time unit");
  const lambdaPerSecond = finite(Math.LN2 / finite(halfLife * seconds, "half-life in seconds", true), "decay constant", true);
  const fraction = finite(Math.exp(-Math.LN2 * time / halfLife), "remaining fraction", true);
  const population = finite(initial * fraction, "population", true);
  const activity = deriveRadioactiveActivity(population, lambdaPerSecond, "s").activity;
  const value = observable.endsWith("_fraction") ? fraction : observable === "activity" ? activity : population;
  return Object.freeze({ initial, halfLife, time, timeUnit, lambdaPerSecond, fraction, population, activity, observable, value, unit: observable.endsWith("_fraction") ? "1" : observable === "activity" ? "Bq" : "nuclei" });
}

export interface NuclearParticipant { A: number; Z: number; count?: number; mass?: number; element?: string }
function massEnergyConversion(massUnit: "u" | "kg" | undefined, energyPerU?: number): number {
  if (massUnit !== undefined && massUnit !== "u" && massUnit !== "kg") throw new Error("Nuclear masses require u or kg");
  if (energyPerU !== undefined && massUnit !== "u") throw new Error("A supplied MeV/u conversion applies only to masses in u");
  if (energyPerU !== undefined) finite(energyPerU, "mass-energy conversion", true);
  return massUnit === "u" ? energyPerU ?? MEV_PER_U : SPEED_OF_LIGHT ** 2 / 1.602176634e-13;
}
export function deriveNuclearReaction(initial: readonly NuclearParticipant[], final: readonly NuclearParticipant[], massConvention: "nuclear" | "atomic", massUnit?: "u" | "kg", energyPerU?: number) {
  if (massConvention !== "nuclear" && massConvention !== "atomic") throw new Error("Nuclear mass convention must be explicit");
  const conversion = massEnergyConversion(massUnit, energyPerU);
  if (!initial.length || !final.length || initial.length > 12 || final.length > 12) throw new Error("A nuclear reaction requires 1..12 participants on each side");
  const validate = (side: readonly NuclearParticipant[]) => side.map(item => {
    integer(item.A, "participant A", 0, 300); integer(item.Z, "participant charge", -1, Math.max(1, item.A));
    if (item.A > 0 && item.Z < 0 || item.A === 0 && Math.abs(item.Z) > 1) throw new Error("Unsupported nuclear participant inventory");
    const count = integer(item.count ?? 1, "participant count", 1, 300);
    if (item.mass !== undefined) {
      finite(item.mass, "participant mass");
      if (item.mass < 0 || item.A > 0 && item.mass === 0) throw new Error("A massive nuclear participant requires a positive mass");
      if (item.A === 0 && item.Z === 0 && item.mass !== 0) throw new Error("The supported neutral non-nucleon participant is zero-rest-mass radiation; massive neutral leptons require an independent model");
    }
    if (item.A === 0 && item.Z !== 0) throw new Error("Charged-lepton channels require independent lepton-number and neutrino accounting, which this bounded nuclear operator does not support");
    return { ...item, count };
  });
  const reactants = validate(initial), products = validate(final);
  const sum = (side: typeof reactants, field: "A" | "Z") => side.reduce((total, item) => total + item.count * item[field], 0);
  if (sum(reactants, "A") !== sum(products, "A") || sum(reactants, "Z") !== sum(products, "Z")) throw new Error("Nuclear reaction fails total nucleon or charge conservation");
  const masses = [...reactants, ...products].filter(item => item.mass !== undefined).length;
  if (masses && (masses !== reactants.length + products.length || !massUnit)) throw new Error("Reaction Q requires every participant mass and one consistent mass unit");
  const totalMass = (side: typeof reactants) => side.reduce((total, item) => total + item.count * item.mass!, 0);
  const massDefect = masses ? finite(totalMass(reactants) - totalMass(products), "reaction mass defect") : undefined;
  const qMeV = massDefect === undefined ? undefined : finite(massDefect * conversion, "reaction Q");
  return Object.freeze({ reactants, products, totalA: sum(reactants, "A"), totalZ: sum(reactants, "Z"), massConvention, massUnit, massDefect, qMeV });
}

export function deriveNuclearMassDefect(A: number, Z: number, boundMass: number, protonOrHydrogenMass: number, neutronMass: number, massConvention: "nuclear" | "atomic", massUnit: "u" | "kg", energyPerU?: number) {
  if (massConvention !== "nuclear" && massConvention !== "atomic") throw new Error("Nuclear mass convention must be explicit");
  if (massUnit !== "u" && massUnit !== "kg") throw new Error("Nuclear masses require u or kg");
  const conversion = massEnergyConversion(massUnit, energyPerU);
  const nuclide = deriveNuclide(A, Z);
  for (const [name, value] of [["bound mass", boundMass], [massConvention === "atomic" ? "hydrogen-atom mass" : "proton mass", protonOrHydrogenMass], ["neutron mass", neutronMass]] as const) finite(value, name, true);
  const freeMass = Z * protonOrHydrogenMass + nuclide.N * neutronMass;
  const massDefect = finite(freeMass - boundMass, "nuclear mass defect", true);
  const bindingMeV = finite(massDefect * conversion, "binding energy", true);
  return Object.freeze({ ...nuclide, massConvention, massUnit, freeMass, boundMass, massDefect, bindingMeV, bindingPerNucleonMeV: bindingMeV / A });
}

/** Classical nonrelativistic repulsion in the explicitly fixed, heavy-target approximation. */
export function deriveRutherfordScattering(projectileCharge: number, targetCharge: number, kEnergyLength: number, energy: number, impactParameter: number) {
  finite(projectileCharge, "projectile charge"); finite(targetCharge, "target charge"); finite(kEnergyLength, "Coulomb constant in energy-length units", true); finite(energy, "kinetic energy", true); finite(impactParameter, "impact parameter");
  if (impactParameter < 0 || !(projectileCharge * targetCharge > 0)) throw new Error("Supported Rutherford scattering requires repulsive charges and a nonnegative impact parameter");
  const coupling = finite(projectileCharge * targetCharge * kEnergyLength, "Coulomb coupling", true);
  const a = finite(coupling / (2 * energy), "Coulomb orbit scale", true);
  const closestApproach = finite(a + Math.hypot(a, impactParameter), "closest approach", true);
  const thetaRadians = impactParameter === 0 ? Math.PI : 2 * Math.atan2(a, impactParameter);
  return Object.freeze({ model: "fixed_target_coulomb" as const, coupling, energy, impactParameter, a, closestApproach, thetaRadians, thetaDegrees: thetaRadians * 180 / Math.PI });
}
