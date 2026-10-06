import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { deriveBohrTransition, type BohrTransitionInput } from "../../src/physics/bohrTransitionAuthority";

const source: BohrTransitionInput = {
  model: "bohr_hydrogenic",
  electronCount: 1,
  Z: 1,
  nFrom: 3,
  nTo: 2,
  bindingEnergy: 13.6,
  bindingEnergyConvention: "hydrogen_reference",
  energyUnit: "eV",
  direction: "emission",
};

const emission = deriveBohrTransition(source);
assert.equal(emission.direction, "emission");
assert.equal(emission.nFrom, 3);
assert.equal(emission.nTo, 2);
assert.ok(Math.abs(emission.energyFrom - -1.511111111111111) < 1e-12);
assert.ok(Math.abs(emission.energyTo - -3.4) < 1e-12);
assert.ok(Math.abs(emission.atomicDelta - -1.888888888888889) < 1e-12);
assert.ok(Math.abs(emission.photonEnergy - 1.888888888888889) < 1e-12);

let checks = 7;
let cases = 0;

function check(condition: unknown, message: string): void {
  checks++;
  assert.ok(condition, message);
}

function close(actual: number, expected: number, message: string): void {
  checks++;
  assert.ok(Number.isFinite(actual), `${message}: output is not finite`);
  assert.ok(
    expected === 0 ? actual === 0 : Math.abs((actual - expected) / expected) < 2e-13,
    `${message}: ${actual} != ${expected}`,
  );
}

function reject(raw: unknown, message: string): void {
  checks++;
  assert.throws(() => deriveBohrTransition(raw), message);
}

function rational(numerator: bigint, denominator: bigint): number {
  return Number(numerator) / Number(denominator);
}

function reference(nFrom: number, nTo: number, Z: number, numerator: bigint, denominator: bigint) {
  const fromSquared = BigInt(nFrom) ** 2n;
  const toSquared = BigInt(nTo) ** 2n;
  const scale = numerator * BigInt(Z) ** 2n;
  const deltaNumerator = scale * (toSquared - fromSquared);
  const deltaDenominator = denominator * fromSquared * toSquared;
  const jouleNumerator = 1602176634n;
  const jouleDenominator = 10n ** 28n;
  return {
    energyFrom: rational(-scale, denominator * fromSquared),
    energyTo: rational(-scale, denominator * toSquared),
    energyFromJ: rational(-scale * jouleNumerator, denominator * fromSquared * jouleDenominator),
    energyToJ: rational(-scale * jouleNumerator, denominator * toSquared * jouleDenominator),
    atomicDelta: rational(deltaNumerator, deltaDenominator),
    atomicDeltaJ: rational(deltaNumerator * jouleNumerator, deltaDenominator * jouleDenominator),
  };
}

function verify(nFrom: number, nTo: number, Z: number, numerator: bigint, denominator: bigint): void {
  cases++;
  const input: BohrTransitionInput = {
    ...source,
    Z,
    nFrom,
    nTo,
    bindingEnergy: rational(numerator, denominator),
    direction: nTo > nFrom ? "absorption" : "emission",
  };
  const before = JSON.stringify(input);
  const actual = deriveBohrTransition(Object.freeze(input));
  const expected = reference(nFrom, nTo, Z, numerator, denominator);
  close(actual.energyFrom, expected.energyFrom, "initial level: integer-rational Bohr reference");
  close(actual.energyTo, expected.energyTo, "final level: integer-rational Bohr reference");
  close(actual.energyFromJ, expected.energyFromJ, "canonical initial level from integer-rational source");
  close(actual.energyToJ, expected.energyToJ, "canonical final level from integer-rational source");
  close(actual.atomicDelta, expected.atomicDelta, "signed energy: independent rational difference");
  close(actual.photonEnergy, Math.abs(expected.atomicDelta), "positive photon energy");
  close(actual.atomicDeltaJ, expected.atomicDeltaJ, "exact SI conversion from integer-rational source");
  close(actual.photonEnergyJ, Math.abs(expected.atomicDeltaJ), "canonical photon energy");
  close(actual.energyTo - actual.energyFrom, actual.atomicDelta, "energy conservation");
  check(actual.nFrom === nFrom && actual.nTo === nTo, "ordered source levels must not be sorted");
  check(actual.direction === input.direction, "source direction follows initial/final state ordering");
  check(actual.energyFrom < 0 && actual.energyTo < 0 && actual.photonEnergy > 0, "bound levels and positive photon");
  check(actual.model === "bohr_hydrogenic" && actual.electronCount === 1 && actual.Z === Z, "explicit model retained");
  check(JSON.stringify(input) === before, "input source remains unchanged");
  check(Object.isFrozen(actual), "derived authority cannot be silently mutated");
  check(!Reflect.set(actual, "photonEnergy", 999), "stale photon claims cannot overwrite derived authority");
  check(actual.bindingEnergyConvention === "hydrogen_reference", "reference calibration remains explicit");
  const ion = deriveBohrTransition({
    ...input,
    bindingEnergy: rational(numerator * BigInt(Z) ** 2n, denominator),
    bindingEnergyConvention: "ion_ground",
  });
  close(ion.energyFrom, expected.energyFrom, "declared ion ground binding gives the same initial level");
  close(ion.energyTo, expected.energyTo, "declared ion ground binding gives the same final level");
  close(ion.atomicDelta, expected.atomicDelta, "ion calibration does not apply Z squared twice");
  close(ion.photonEnergyJ, Math.abs(expected.atomicDeltaJ), "ion calibration gives the independently derived photon");
  check(ion.bindingEnergyConvention === "ion_ground", "declared ion calibration remains explicit");
}

const absorption = deriveBohrTransition({ ...source, nFrom: 2, nTo: 3, direction: "absorption" });
close(absorption.atomicDelta, 1.888888888888889, "worked-example upward energy uptake");
close(absorption.photonEnergyJ, 3.026333642e-19, "worked-example Balmer photon in joules");
close(absorption.energyFrom, emission.energyTo, "reversal swaps source energy levels");
close(absorption.energyTo, emission.energyFrom, "reversal swaps final energy levels");
close(absorption.atomicDelta, -emission.atomicDelta, "reversal changes atomic energy sign");
close(absorption.photonEnergy, emission.photonEnergy, "reversal preserves photon energy");
const lyman = deriveBohrTransition({ ...source, nFrom: 2, nTo: 1 });
close(lyman.photonEnergy, 10.2, "Lyman worked example is distinct from Balmer");
const paschen = deriveBohrTransition({ ...source, nFrom: 4, nTo: 3 });
close(paschen.photonEnergy, 0.6611111111111111, "Paschen worked example is distinct from Balmer");
const helium = deriveBohrTransition({ ...source, Z: 2 });
close(helium.photonEnergy, 7.555555555555556, "hydrogen-like He+ scales photon energy by four");
const heliumGround = deriveBohrTransition({ ...source, Z: 2, bindingEnergy: 54.4, bindingEnergyConvention: "ion_ground" });
close(heliumGround.photonEnergy, 7.555555555555555, "actual He+ ground binding is not scaled by Z squared again");
close(heliumGround.energyTo, -13.6, "actual He+ final n=2 energy");
close(heliumGround.photonEnergy, helium.photonEnergy, "reference and actual-ion source calibrations agree");
const heliumGroundJ = deriveBohrTransition({ ...source, Z: 2, bindingEnergy: 8.71584088896e-18, bindingEnergyConvention: "ion_ground", energyUnit: "J" });
close(heliumGroundJ.photonEnergy, heliumGround.photonEnergyJ, "actual He+ ground calibration agrees across eV and J sources");
const lithiumGround = deriveBohrTransition({ ...source, Z: 3, nFrom: 5, nTo: 2, bindingEnergy: 122.4, bindingEnergyConvention: "ion_ground" });
close(lithiumGround.photonEnergy, 25.704, "actual Li2+ binding energy has independently specified calibration");
const joules = deriveBohrTransition({ ...source, bindingEnergy: 2.17896022224e-18, energyUnit: "J" });
close(joules.energyFrom, emission.energyFromJ, "joule-source initial state agrees with eV source");
close(joules.energyTo, emission.energyToJ, "joule-source final state agrees with eV source");
close(joules.photonEnergy, emission.photonEnergyJ, "joule-source photon agrees with eV source");
check(joules.energyUnit === "J" && joules.photonEnergy === joules.photonEnergyJ, "source unit retained without rescaling twice");
const planck = 6.62607015e-34;
const lightSpeed = 299792458;
const rydberg = 10973731.568160;
const rydbergTransition = deriveBohrTransition({
  ...source,
  bindingEnergy: planck * lightSpeed * rydberg,
  energyUnit: "J",
});
close(rydbergTransition.photonEnergyJ / (planck * lightSpeed), rydberg * 5 / 36, "independent Rydberg wave number for the Balmer 3-to-2 line");
close(rydbergTransition.photonEnergyJ / planck, lightSpeed * rydberg * 5 / 36, "photon frequency agrees with the independently supplied Rydberg law");
const withoutDirection = { ...source };
delete withoutDirection.direction;
check(deriveBohrTransition(withoutDirection).direction === "emission", "optional direction derives from ordered states");

for (const raw of [null, [], 13.6, "hydrogen", new Map(), new Date(), Object.create({ ...source })]) {
  reject(raw, "only explicit structural source objects are accepted");
}
for (const key of ["model", "electronCount", "Z", "nFrom", "nTo", "bindingEnergy", "bindingEnergyConvention", "energyUnit"]) {
  const missing: Record<string, unknown> = { ...source };
  delete missing[key];
  reject(missing, `missing ${key} cannot be guessed`);
}
for (const [key, values] of [
  ["model", ["classical_orbit", "rutherford", "hydrogen", undefined]],
  ["electronCount", [0, 2, "1", true, undefined]],
  ["Z", [0, -1, 11, 1.5, NaN, Infinity, "1", true, { value: 1, unit: "1" }]],
  ["nFrom", [0, -1, 65, 1.5, NaN, Infinity, "3", true, { value: 3, unit: "1" }]],
  ["nTo", [0, -1, 65, 1.5, NaN, Infinity, "2", true, { value: 2, unit: "1" }]],
  ["bindingEnergy", [0, -0, -13.6, NaN, Infinity, -Infinity, Number.MIN_VALUE, "13.6", "1e-400", true]],
  ["bindingEnergyConvention", ["ground", "reference", "hydrogen", "auto", "", undefined]],
  ["energyUnit", ["ev", "EV", "j", "keV", "J/mol", "Hz", "", undefined]],
  ["direction", ["absorption", "up", "down", "spontaneous", undefined]],
] as const) {
  for (const value of values) reject({ ...source, [key]: value }, `${key} mutation must reject`);
}
for (const n of [1, 2, 3, 64]) reject({ ...source, nFrom: n, nTo: n }, "no fictitious zero-energy photon");
reject({ ...source, nFrom: 2, nTo: 3 }, "swapping source levels with a stale emission claim rejects");
for (const key of ["photonEnergy", "atomicDelta", "temperature", "radius", "energyScale", "questionId"]) {
  reject({ ...source, [key]: 999 }, "derived answers and unsupported assumptions cannot be source fields");
}
reject({ ...source, [Symbol("source")]: 1 }, "hidden unsupported fields reject");
reject({ ...source, bindingEnergy: 2 ** -1022 }, "eV to J underflow must not certify a zero photon");
reject({ ...source, bindingEnergy: 2 ** -1022, energyUnit: "J", nFrom: 64, nTo: 63 }, "subnormal levels reject unresolved authority");
reject({ ...source, bindingEnergy: Number.MAX_VALUE, Z: 10, nFrom: 1, nTo: 2, direction: "absorption" }, "overflow rejects the whole calculation");
const large = deriveBohrTransition({ ...source, bindingEnergy: 1e308, Z: 10, nFrom: 64, nTo: 63 });
check(Number.isFinite(large.energyFrom) && Number.isFinite(large.atomicDelta), "finite results do not fail from an avoidable intermediate overflow");
const boundary = deriveBohrTransition({ ...source, bindingEnergy: 1e-290, Z: 10, nFrom: 2, nTo: 1 });
check(boundary.photonEnergyJ > 2 ** -1022, "small but normal canonical energies remain supported");

const inheritedSource = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", `
  import assert from "node:assert/strict";
  import { deriveBohrTransition } from ${JSON.stringify(new URL("../../src/physics/bohrTransitionAuthority.ts", import.meta.url).href)};
  const source = ${JSON.stringify(source)};
  const saved = new Map(Object.keys(source).map(key => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]));
  try {
    for (const [key, value] of Object.entries(source)) Object.defineProperty(Object.prototype, key, { value, configurable: true, writable: true });
    assert.throws(() => deriveBohrTransition({}), /explicit own source field/);
    for (const key of Object.keys(source).filter(key => key !== "direction")) {
      const missing = { ...source };
      delete missing[key];
      assert.throws(() => deriveBohrTransition(missing), /explicit own source field/);
    }
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
      else delete Object.prototype[key];
    }
  }
  for (const [key, descriptor] of saved) assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, key), descriptor);
  console.log("Inherited-source guard and prototype restoration passed");
`], { encoding: "utf8" });
check(inheritedSource.status === 0, `isolated inherited-source regression: ${inheritedSource.stderr}`);
check(inheritedSource.stdout.includes("Inherited-source guard and prototype restoration passed"), "child regression restores every inherited default");

if (!process.argv.includes("--holdout-only")) {
  for (let Z = 1; Z <= 10; Z++) {
    for (let nFrom = 1; nFrom <= 64; nFrom++) {
      for (let nTo = 1; nTo <= 64; nTo++) {
        if (nFrom !== nTo) verify(nFrom, nTo, Z, 136n, 10n);
      }
    }
  }
  console.log(`Bohr core: ${cases} bounded ordered level/Z cases; ${checks} checks including worked, unit, invalid and mutation cases`);
}

const coreChecks = checks;
const coreCases = cases;
let seed = 20261002;
function next(max: number): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % max;
}
for (let index = 0; index < 257; index++) {
  const nFrom = next(64) + 1;
  const nTo = (nFrom + next(63)) % 64 + 1;
  verify(nFrom, nTo, next(10) + 1, BigInt(next(999999) + 1), 1000n);
}
console.log(`Bohr synthetic holdout: ${cases - coreCases} cases; ${checks - coreChecks} checks; seed 20261002; not an exam cohort`);
