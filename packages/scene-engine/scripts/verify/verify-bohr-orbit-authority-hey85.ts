import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { deriveBohrOrbit, type BohrOrbitInput } from "../../src/physics/bohrOrbitAuthority";

const source: BohrOrbitInput = {
  model: "bohr_hydrogenic",
  electronCount: 1,
  Z: 1,
  n: 2,
  groundRadius: 5.29e-11,
  radiusUnit: "m",
  radiusConvention: "hydrogen_reference",
  groundSpeed: 2.18e6,
  speedUnit: "m/s",
  speedConvention: "hydrogen_reference",
};

const hydrogen = deriveBohrOrbit(source);
assert.equal(hydrogen.radiusM, 2.116e-10);
assert.equal(hydrogen.speedMPerS, 1090000);
assert.equal(hydrogen.n, 2);
assert.equal(hydrogen.Z, 1);

let checks = 4;
let inputsChecked = 0;

function check(condition: unknown, message: string): void {
  checks++;
  assert.ok(condition, message);
}

function close(actual: number, expected: number, message: string): void {
  checks++;
  assert.ok(Number.isFinite(actual) && actual > 0, `${message}: positive finite output required`);
  assert.ok(Math.abs((actual - expected) / expected) < 2e-13, `${message}: ${actual} != ${expected}`);
}

function reject(raw: unknown, message: string): void {
  checks++;
  assert.throws(() => deriveBohrOrbit(raw), message);
}

function rational(numerator: bigint, denominator: bigint): number {
  return Number(numerator) / Number(denominator);
}

function verify(Z: number, n: number, radiusNumerator: bigint, radiusDenominator: bigint, speedNumerator: bigint, speedDenominator: bigint): void {
  const charge = BigInt(Z);
  const level = BigInt(n);
  const expectedRadiusM = rational(radiusNumerator * level ** 2n, radiusDenominator * charge);
  const expectedSpeedMPerS = rational(speedNumerator * charge, speedDenominator * level);
  for (const radiusUnit of ["m", "nm"] as const) {
    for (const speedUnit of ["m/s", "km/s"] as const) {
      for (const radiusConvention of ["hydrogen_reference", "ion_ground"] as const) {
        for (const speedConvention of ["hydrogen_reference", "ion_ground"] as const) {
          inputsChecked++;
          const radiusSourceNumerator = radiusNumerator * (radiusUnit === "nm" ? 10n ** 9n : 1n);
          const radiusSourceDenominator = radiusDenominator * (radiusConvention === "ion_ground" ? charge : 1n);
          const speedSourceNumerator = speedNumerator * (speedConvention === "ion_ground" ? charge : 1n);
          const speedSourceDenominator = speedDenominator * (speedUnit === "km/s" ? 1000n : 1n);
          const input: BohrOrbitInput = {
            ...source,
            Z,
            n,
            groundRadius: rational(radiusSourceNumerator, radiusSourceDenominator),
            radiusUnit,
            radiusConvention,
            groundSpeed: rational(speedSourceNumerator, speedSourceDenominator),
            speedUnit,
            speedConvention,
          };
          const before = JSON.stringify(input);
          const orbit = deriveBohrOrbit(Object.freeze(input));
          close(orbit.radiusM, expectedRadiusM, "integer-rational radius law across source calibrations");
          close(orbit.speedMPerS, expectedSpeedMPerS, "integer-rational speed law across source calibrations");
          close(orbit.radius, radiusUnit === "nm" ? expectedRadiusM * 1e9 : expectedRadiusM, "declared radius unit retained");
          close(orbit.speed, speedUnit === "km/s" ? expectedSpeedMPerS / 1000 : expectedSpeedMPerS, "declared speed unit retained");
          close(orbit.groundRadiusM, rational(radiusNumerator, radiusDenominator * (radiusConvention === "ion_ground" ? charge : 1n)), "canonical supplied radius provenance");
          close(orbit.groundSpeedMPerS, rational(speedNumerator * (speedConvention === "ion_ground" ? charge : 1n), speedDenominator), "canonical supplied speed provenance");
          check(orbit.radiusConvention === radiusConvention && orbit.speedConvention === speedConvention, "both explicit calibrations retained independently");
          check(orbit.radiusUnit === radiusUnit && orbit.speedUnit === speedUnit, "supplied units retained");
          check(orbit.groundRadius === input.groundRadius && orbit.groundSpeed === input.groundSpeed, "actual source scales are not replaced with defaults");
          check(orbit.model === "bohr_hydrogenic" && orbit.electronCount === 1 && orbit.Z === Z && orbit.n === n, "explicit model, charge and level provenance retained");
          check(JSON.stringify(input) === before, "source object remains unchanged");
          check(Object.isFrozen(orbit) && !Reflect.set(orbit, "radiusM", 999), "immutable scalar authority cannot take stale result overwrites");
          check(orbit.groundSpeedMPerS <= 29979245.8 && orbit.speedMPerS <= 29979245.8, "conservative source and selected speed guard");
          check(orbit.groundSpeedMPerS * (speedConvention === "hydrogen_reference" ? Z : 1) <= 29979245.8, "the actual-ion ground speed cannot hide behind a high selected level");
        }
      }
    }
  }
}

const heliumReference = deriveBohrOrbit({ ...source, Z: 2, n: 3 });
const heliumGround = deriveBohrOrbit({ ...source, Z: 2, n: 3, groundRadius: 2.645e-11, radiusConvention: "ion_ground", groundSpeed: 4.36e6, speedConvention: "ion_ground" });
close(heliumGround.radiusM, 2.3805e-10, "He+ actual-ion n=3 radius is not divided by Z again");
close(heliumGround.speedMPerS, 1453333.3333333333, "He+ actual-ion n=3 speed is not multiplied by Z again");
close(heliumGround.radiusM, heliumReference.radiusM, "He+ actual-ion and hydrogen-reference radius agree");
close(heliumGround.speedMPerS, heliumReference.speedMPerS, "He+ actual-ion and hydrogen-reference speed agree");
const heliumUnits = deriveBohrOrbit({ ...source, Z: 2, n: 3, groundRadius: 0.02645, radiusUnit: "nm", radiusConvention: "ion_ground", groundSpeed: 4360, speedUnit: "km/s", speedConvention: "ion_ground" });
close(heliumUnits.radiusM, heliumGround.radiusM, "actual-ion nm-to-m source equivalence");
close(heliumUnits.speedMPerS, heliumGround.speedMPerS, "actual-ion km/s-to-m/s source equivalence");
const nextHydrogen = deriveBohrOrbit({ ...source, n: 3 });
close(nextHydrogen.radiusM / hydrogen.radiusM, 2.25, "n=3 versus n=2 radius follows independently known squared-level ratio");
close(nextHydrogen.speedMPerS / hydrogen.speedMPerS, 2 / 3, "n=3 versus n=2 speed follows reciprocal-level ratio");
close(nextHydrogen.radiusM * nextHydrogen.speedMPerS ** 2, hydrogen.radiusM * hydrogen.speedMPerS ** 2, "r times v squared is level-invariant for supplied scales");
const zGround = deriveBohrOrbit({ ...source, Z: 2, n: 2 });
close(zGround.radiusM / hydrogen.radiusM, 0.5, "reference radius scales inversely with Z");
close(zGround.speedMPerS / hydrogen.speedMPerS, 2, "reference speed scales directly with Z");

for (const raw of [null, [], "hydrogen", 5.29e-11, new Map(), new Date(), Object.create(source)]) reject(raw, "only explicit structural source objects are accepted");
for (const key of Object.keys(source)) {
  const missing: Record<string, unknown> = { ...source };
  delete missing[key];
  reject(missing, `missing ${key} must not be guessed`);
}
for (const [key, values] of [
  ["model", ["relativistic", "multi_electron", "rutherford", undefined]],
  ["electronCount", [0, 2, "1", true, undefined]],
  ["Z", [0, -1, 11, 1.5, NaN, Infinity, "1", true, { value: 1, unit: "1" }]],
  ["n", [0, -1, 65, 1.5, NaN, Infinity, "2", true, { value: 2, unit: "1" }]],
  ["groundRadius", [0, -0, -1, NaN, Infinity, Number.MIN_VALUE, "5.29e-11", "1e-400", { value: 1, unit: "nm" }]],
  ["groundSpeed", [0, -0, -1, NaN, Infinity, Number.MIN_VALUE, "2180000", "1e-400", { value: 1, unit: "m/s" }]],
  ["radiusUnit", ["M", "NM", "cm", "m^2", "", undefined]],
  ["speedUnit", ["M/s", "Km/s", "nm/s", "km/h", "rad/s", "", undefined]],
  ["radiusConvention", ["ground", "reference", "auto", "", undefined]],
  ["speedConvention", ["ground", "reference", "auto", "", undefined]],
] as const) for (const value of values) reject({ ...source, [key]: value }, `${key} mutation rejects`);
for (const key of ["radius", "speed", "trajectory", "bindingEnergy", "a0", "questionId", "sourceId"]) reject({ ...source, [key]: 999 }, "unsupported source/derived fields reject");
reject({ ...source, [Symbol("source")]: 1 }, "symbol fields cannot hide source defaults");
reject({ ...source, groundRadius: 2 ** -1022, radiusUnit: "nm" }, "canonical supplied radius must not underflow");
reject({ ...source, groundSpeed: 2 ** -1022, n: 64, speedConvention: "ion_ground" }, "selected speed must not become subnormal");
reject({ ...source, groundRadius: Number.MAX_VALUE, n: 64 }, "derived radius overflow rejects all authority");
const large = deriveBohrOrbit({ ...source, groundRadius: 1e308, Z: 10, n: 2 });
close(large.radiusM, 4e307, "factored multiplier avoids needless intermediate radius overflow");
const small = deriveBohrOrbit({ ...source, groundRadius: 1e-290, groundSpeed: 1e-290, speedConvention: "ion_ground", n: 64 });
check(small.radiusM >= 2 ** -1022 && small.speedMPerS >= 2 ** -1022, "small normal source and result scalars remain supported");

for (const speedUnit of ["m/s", "km/s"] as const) {
  const boundaryScale = speedUnit === "m/s" ? 1 : 1000;
  const boundary = deriveBohrOrbit({ ...source, n: 1, groundSpeed: 29979245.8 / boundaryScale, speedUnit, speedConvention: "ion_ground" });
  close(boundary.speedMPerS, 29979245.8, "supported 0.1c boundary across source units");
  const ionBoundary = deriveBohrOrbit({ ...source, Z: 2, n: 64, groundSpeed: 14989622.9 / boundaryScale, speedUnit });
  close(ionBoundary.speedMPerS, 468425.715625, "reference-source implied ion ground lies on 0.1c boundary");
  reject({ ...source, groundSpeed: 29979245.8001 / boundaryScale, speedUnit, speedConvention: "ion_ground", n: 64 }, "above-bound actual-ion ground cannot hide at high n");
  reject({ ...source, Z: 2, groundSpeed: 14989622.9001 / boundaryScale, speedUnit, n: 64 }, "above-bound implied ion ground cannot hide at high n");
  reject({ ...source, groundSpeed: 299792458 / boundaryScale, speedUnit, n: 64 }, "light-speed ground rejects even when selected speed is lower");
}
reject({ ...source, groundSpeed: 1e8, Z: 1, n: 64 }, "finite relativistic source stays an unsupported gap");

const inheritedSource = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", `
  import assert from "node:assert/strict";
  import { deriveBohrOrbit } from ${JSON.stringify(new URL("../../src/physics/bohrOrbitAuthority.ts", import.meta.url).href)};
  const source = ${JSON.stringify(source)};
  const saved = new Map(Object.keys(source).map(key => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]));
  try {
    for (const [key, value] of Object.entries(source)) Object.defineProperty(Object.prototype, key, { value, configurable: true, writable: true });
    assert.throws(() => deriveBohrOrbit({}), /explicit own source field/);
    for (const key of Object.keys(source)) {
      const missing = { ...source };
      delete missing[key];
      assert.throws(() => deriveBohrOrbit(missing), /explicit own source field/);
    }
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
      else delete Object.prototype[key];
    }
  }
  for (const [key, descriptor] of saved) assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, key), descriptor);
  console.log("Orbit inherited-source guard: 11 cases and prototype restoration passed");
`], { encoding: "utf8" });
check(inheritedSource.status === 0, `isolated inherited-source regression: ${inheritedSource.stderr}`);
check(inheritedSource.stdout.includes("11 cases and prototype restoration passed"), "all required source fields reject inherited defaults without parent pollution");

let seed = 20261003;
function next(max: number): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % max;
}
const holdout = Array.from({ length: 257 }, (_, id) => ({
  id,
  Z: next(10) + 1,
  n: next(64) + 1,
  radiusNumerator: BigInt(next(999999) + 1),
  speedNumerator: BigInt(next(1999999) + 1),
}));

if (!process.argv.includes("--holdout-only")) {
  for (let Z = 1; Z <= 10; Z++) for (let n = 1; n <= 64; n++) verify(Z, n, 529n, 10n ** 13n, 2180000n, 1n);
  console.log(`Bohr orbit core: 640 level/Z tuples; ${inputsChecked} unit/calibration inputs; ${checks} checks including worked, domain and mutation cases`);
}
const coreChecks = checks;
const coreInputs = inputsChecked;
for (const row of holdout) verify(row.Z, row.n, row.radiusNumerator, 10n ** 12n, row.speedNumerator, 1n);
console.log(`Bohr orbit synthetic holdout: 257 pre-listed tuples; ${inputsChecked - coreInputs} unit/calibration inputs; ${checks - coreChecks} checks; seed 20261003; not an exam cohort`);
