import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { deriveElasticModulus, type BulkResponseInput, type SimpleShearInput } from "../../src/physics/elasticModulusAuthority";

const bulkSource: BulkResponseInput = {
  model: "linear_bulk_response",
  initialVolume: 1,
  volumeUnit: "m3",
  deltaVolume: -0.001,
  deltaVolumeUnit: "m3",
  deltaPressure: 1000,
  pressureUnit: "Pa",
};

const compression = deriveElasticModulus(bulkSource);
assert.equal(compression.strain, -0.001);
assert.equal(compression.stressPa, -1000);
assert.equal(compression.modulusPa, 1000000);
assert.equal(compression.model, "linear_bulk_response");

const shearSource: SimpleShearInput = {
  model: "linear_simple_shear",
  shearAxisId: "source:x-positive",
  tangentialForce: 10,
  forceUnit: "N",
  faceArea: 0.01,
  areaUnit: "m2",
  layerDisplacement: 0.001,
  displacementUnit: "m",
  layerHeight: 0.1,
  heightUnit: "m",
};

let checks = 4;
let inputsChecked = 0;

function check(condition: unknown, message: string): void {
  checks++;
  assert.ok(condition, message);
}

function close(actual: number, expected: number, message: string): void {
  checks++;
  assert.ok(Number.isFinite(actual), `${message}: finite output required`);
  assert.ok(Math.abs((actual - expected) / expected) < 2e-13, `${message}: ${actual} != ${expected}`);
}

function reject(raw: unknown, message: string): void {
  checks++;
  assert.throws(() => deriveElasticModulus(raw), message);
}

function rational(numerator: bigint, denominator: bigint): number {
  return Number(numerator) / Number(denominator);
}

const volumeUnits = [["m3", 1n], ["cm3", 1000000n], ["mm3", 1000000000n]] as const;
const pressureUnits = [["Pa", 1n], ["kPa", 1000n], ["MPa", 1000000n]] as const;
const forceUnits = [["N", 1n], ["kN", 1000n]] as const;
const areaUnits = [["m2", 1n], ["cm2", 10000n], ["mm2", 1000000n]] as const;
const lengthUnits = [["m", 1n], ["cm", 100n], ["mm", 1000n]] as const;

function verifyBulk(volumeNumerator: bigint, volumeDenominator: bigint, strainNumerator: bigint, strainDenominator: bigint, modulus: bigint): void {
  const expectedVolume = rational(volumeNumerator, volumeDenominator);
  const expectedDelta = rational(volumeNumerator * strainNumerator, volumeDenominator * strainDenominator);
  const expectedPressure = rational(-modulus * strainNumerator, strainDenominator);
  const expectedStrain = rational(strainNumerator, strainDenominator);
  const expectedFinal = rational(volumeNumerator * (strainDenominator + strainNumerator), volumeDenominator * strainDenominator);
  for (const [volumeUnit, volumeScale] of volumeUnits) for (const [deltaVolumeUnit, deltaScale] of volumeUnits) for (const [pressureUnit, pressureScale] of pressureUnits) {
    inputsChecked++;
    const input: BulkResponseInput = {
      ...bulkSource,
      initialVolume: rational(volumeNumerator * volumeScale, volumeDenominator),
      volumeUnit,
      deltaVolume: rational(volumeNumerator * strainNumerator * deltaScale, volumeDenominator * strainDenominator),
      deltaVolumeUnit,
      deltaPressure: rational(-modulus * strainNumerator, strainDenominator * pressureScale),
      pressureUnit,
    };
    const before = JSON.stringify(input);
    const result = deriveElasticModulus(Object.freeze(input));
    check(result.model === "linear_bulk_response", "bulk mode cannot become uniaxial or shear authority");
    if (result.model !== "linear_bulk_response") throw new Error("bulk result missing");
    close(result.initialVolumeM3, expectedVolume, "independent initial-volume unit conversion");
    close(result.deltaVolumeM3, expectedDelta, "independent signed volume-change conversion");
    close(result.finalVolumeM3, expectedFinal, "independent final-volume conservation");
    close(result.deltaPressurePa, expectedPressure, "independent signed pressure unit conversion");
    close(result.strain, expectedStrain, "independent rational volumetric strain");
    close(result.stressPa, -expectedPressure, "mean normal stress has the declared tensile-positive sign");
    close(result.modulusPa, Number(modulus), "independently supplied worked bulk modulus");
    check(result.stressConvention === "tension_positive_mean_normal", "pressure must not be mislabeled as tensile stress");
    check(result.volumeUnit === volumeUnit && result.deltaVolumeUnit === deltaVolumeUnit && result.pressureUnit === pressureUnit, "supplied independent unit scales retained");
    check(result.initialVolume === input.initialVolume && result.deltaVolume === input.deltaVolume && result.deltaPressure === input.deltaPressure, "observations remain the actual supplied values");
    check(result.modulusPa > 0 && Math.sign(result.strain) !== Math.sign(result.deltaPressurePa), "restoring bulk sign");
    check(Object.isFrozen(result) && !Reflect.set(result, "modulusPa", 999), "bulk authority is immutable");
    check(JSON.stringify(input) === before, "bulk source data unchanged");
  }
}

function verifyShear(areaNumerator: bigint, areaDenominator: bigint, heightNumerator: bigint, heightDenominator: bigint, strainNumerator: bigint, strainDenominator: bigint, modulus: bigint): void {
  const expectedArea = rational(areaNumerator, areaDenominator);
  const expectedHeight = rational(heightNumerator, heightDenominator);
  const expectedDisplacement = rational(heightNumerator * strainNumerator, heightDenominator * strainDenominator);
  const expectedStress = rational(modulus * strainNumerator, strainDenominator);
  const expectedForce = rational(modulus * strainNumerator * areaNumerator, strainDenominator * areaDenominator);
  const expectedStrain = rational(strainNumerator, strainDenominator);
  for (const [forceUnit, forceScale] of forceUnits) for (const [areaUnit, areaScale] of areaUnits) for (const [displacementUnit, displacementScale] of lengthUnits) for (const [heightUnit, heightScale] of lengthUnits) {
    inputsChecked++;
    const input: SimpleShearInput = {
      ...shearSource,
      shearAxisId: strainNumerator > 0 ? "source:x-positive" : "source:x-reversed",
      tangentialForce: rational(modulus * strainNumerator * areaNumerator, strainDenominator * areaDenominator * forceScale),
      forceUnit,
      faceArea: rational(areaNumerator * areaScale, areaDenominator),
      areaUnit,
      layerDisplacement: rational(heightNumerator * strainNumerator * displacementScale, heightDenominator * strainDenominator),
      displacementUnit,
      layerHeight: rational(heightNumerator * heightScale, heightDenominator),
      heightUnit,
    };
    const before = JSON.stringify(input);
    const result = deriveElasticModulus(Object.freeze(input));
    check(result.model === "linear_simple_shear", "shear mode cannot inherit Young modulus authority");
    if (result.model !== "linear_simple_shear") throw new Error("shear result missing");
    close(result.forceN, expectedForce, "independent signed applied force conversion");
    close(result.areaM2, expectedArea, "independent face-area conversion");
    close(result.displacementM, expectedDisplacement, "independent signed layer displacement conversion");
    close(result.heightM, expectedHeight, "independent layer-height conversion");
    close(result.strain, expectedStrain, "independent rational engineering shear strain");
    close(result.stressPa, expectedStress, "independent rational applied tangential stress");
    close(result.modulusPa, Number(modulus), "independently supplied worked shear modulus");
    check(result.shearAxisId === input.shearAxisId && result.stressConvention === "shared_axis_tangential", "signed source-axis provenance retained");
    check(result.forceUnit === forceUnit && result.areaUnit === areaUnit && result.displacementUnit === displacementUnit && result.heightUnit === heightUnit, "all explicit observation units retained");
    check(result.tangentialForce === input.tangentialForce && result.layerDisplacement === input.layerDisplacement, "signed observations not replaced by magnitudes");
    check(result.modulusPa > 0 && Math.sign(result.forceN) === Math.sign(result.displacementM), "restoring shear sign");
    check(Object.isFrozen(result) && !Reflect.set(result, "strain", 999), "shear authority is immutable");
    check(JSON.stringify(input) === before, "shear source data unchanged");
  }
}

const shear = deriveElasticModulus(shearSource);
close(shear.strain, 0.01, "worked shear strain");
close(shear.stressPa, 1000, "worked applied shear stress");
close(shear.modulusPa, 100000, "worked shear modulus");
const decompression = deriveElasticModulus({ ...bulkSource, deltaVolume: 0.001, deltaPressure: -1000 });
close(decompression.modulusPa, compression.modulusPa, "compression/decompression reversal preserves K");
close(decompression.stressPa, -compression.stressPa, "reversal changes bulk stress sign");
const reverseShear = deriveElasticModulus({ ...shearSource, shearAxisId: "source:x-reversed", tangentialForce: -10, layerDisplacement: -0.001 });
close(reverseShear.modulusPa, shear.modulusPa, "common signed-axis reversal preserves G");
close(reverseShear.strain, -shear.strain, "axis reversal preserves signed observation, not absolute value");
const scaledBulk = deriveElasticModulus({ ...bulkSource, initialVolume: 10, deltaVolume: -0.01 });
close(scaledBulk.modulusPa, compression.modulusPa, "volume/volume-change homogeneity preserves K");
const scaledShear = deriveElasticModulus({ ...shearSource, tangentialForce: 100, faceArea: 0.1, layerDisplacement: 0.01, layerHeight: 1 });
close(scaledShear.modulusPa, shear.modulusPa, "force/area and displacement/height homogeneity preserves G");

for (const raw of [null, [], "bulk", new Map(), new Date(), Object.create(bulkSource)]) reject(raw, "plain structural data only");
for (const input of [bulkSource, shearSource]) {
  for (const key of Object.keys(input)) {
    const missing: Record<string, unknown> = { ...input };
    delete missing[key];
    reject(missing, `missing ${key} cannot be inferred`);
    let getterCalls = 0;
    const accessor = Object.defineProperty({ ...input }, key, { get() { getterCalls++; return input[key as keyof typeof input]; } });
    reject(accessor, `accessor ${key} is not a plain source observation`);
    check(getterCalls === 0, "rejected accessor is never invoked");
  }
  for (const [key, value] of Object.entries(input)) if (typeof value === "number") {
    for (const invalid of [0, -0, NaN, Infinity, -Infinity, "1", true, { value, unit: "Pa" }]) reject({ ...input, [key]: invalid }, `${key} must be an explicit nonzero finite numeric observation`);
  }
  reject({ ...input, [Symbol("source")]: 1 }, "symbol fields reject");
  for (const key of ["modulusPa", "strain", "youngModulus", "poissonsRatio", "material", "uncertainty", "questionId"]) reject({ ...input, [key]: 999 }, "unsupported material/default/derived fields reject");
}
for (const model of ["linear_elastic", "nonlinear_bulk", "plastic_shear", "", undefined]) reject({ ...bulkSource, model }, "unprovided or unsupported model rejects");
for (const key of ["volumeUnit", "deltaVolumeUnit"]) for (const unit of ["m^3", "M3", "cm2", "L", "", "constructor"]) reject({ ...bulkSource, [key]: unit }, "unsupported volume unit rejects");
for (const unit of ["pa", "KPa", "mPa", "N", "", "toString"]) reject({ ...bulkSource, pressureUnit: unit }, "case-sensitive pressure unit rejects");
for (const unit of ["n", "kn", "Pa", "", "constructor"]) reject({ ...shearSource, forceUnit: unit }, "case-sensitive force unit rejects");
for (const unit of ["m^2", "M2", "m3", "", "toString"]) reject({ ...shearSource, areaUnit: unit }, "unsupported area unit rejects");
for (const key of ["displacementUnit", "heightUnit"]) for (const unit of ["M", "cm2", "nm", "m/s", "", "constructor"]) reject({ ...shearSource, [key]: unit }, "unsupported length unit rejects");
for (const shearAxisId of ["", " ", " x", "x ", undefined, 1, ["x", "y"]]) reject({ ...shearSource, shearAxisId }, "missing or ambiguous shared axis rejects");
reject({ ...bulkSource, initialVolume: -1 }, "positive initial volume is required");
reject({ ...bulkSource, deltaVolume: -1 }, "zero final volume rejects");
reject({ ...bulkSource, deltaVolume: -2 }, "negative final volume rejects");
reject({ ...bulkSource, deltaVolume: 0.001 }, "same signed pressure and volume change gives invalid restoring K");
reject({ ...shearSource, layerDisplacement: -0.001 }, "force/displacement on opposing signed axis reject");
reject({ ...shearSource, faceArea: -0.01 }, "negative face area rejects");
reject({ ...shearSource, layerHeight: -0.1 }, "negative layer height rejects");
reject({ ...bulkSource, deltaVolume: -0.0101 }, "above-bound bulk strain is unsupported");
reject({ ...shearSource, layerDisplacement: 0.00101 }, "above-bound shear strain is unsupported");
reject({ ...bulkSource, initialVolume: 1e12, deltaVolume: -1e-12 }, "below-bound derived strain rejects");
reject({ ...shearSource, layerHeight: 1e12, layerDisplacement: 1e-12 }, "unresolved below-bound shear strain rejects");
reject({ ...bulkSource, deltaPressure: 1e12, deltaVolume: -1e-12 }, "out-of-bound derived modulus rejects");
reject({ ...shearSource, tangentialForce: 1e-12, faceArea: 1e12 }, "out-of-bound derived shear stress rejects");
reject({ ...bulkSource, initialVolume: 1e12, deltaVolume: 1, deltaPressure: -1000 }, "out-of-bound final volume rejects");
reject({ ...bulkSource, deltaPressure: 1e12, pressureUnit: "MPa" }, "SI prefix conversion cannot bypass source magnitude bound");
reject({ ...shearSource, tangentialForce: 1e12, forceUnit: "kN" }, "source force bound applies after conversion");
reject({ ...bulkSource, deltaVolume: Number.MIN_VALUE, deltaVolumeUnit: "mm3" }, "volume change underflow rejects");
reject({ ...shearSource, layerDisplacement: Number.MIN_VALUE, displacementUnit: "mm" }, "displacement underflow rejects");
reject({ ...bulkSource, deltaPressure: Number.MAX_VALUE, pressureUnit: "MPa" }, "source conversion overflow rejects");
const minimumStrain = deriveElasticModulus({ ...bulkSource, deltaVolume: -1e-12, deltaPressure: 1e-12 });
close(minimumStrain.strain, -1e-12, "derived strain minimum boundary");
close(minimumStrain.modulusPa, 1, "minimal SI observations retain their exact modulus relation");
const maximumModulus = deriveElasticModulus({ ...bulkSource, deltaVolume: -0.01, deltaPressure: 1e10 });
close(maximumModulus.modulusPa, 1e12, "supported modulus maximum boundary");

const inherited = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", `
  import assert from "node:assert/strict";
  import { deriveElasticModulus } from ${JSON.stringify(new URL("../../src/physics/elasticModulusAuthority.ts", import.meta.url).href)};
  const inputs = ${JSON.stringify([bulkSource, shearSource])};
  let cases = 0;
  for (const input of inputs) {
    const saved = new Map(Object.keys(input).map(key => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]));
    try {
      for (const [key, value] of Object.entries(input)) Object.defineProperty(Object.prototype, key, { value, configurable: true, writable: true });
      assert.throws(() => deriveElasticModulus({}), /own source field/); cases++;
      for (const key of Object.keys(input)) {
        const missing = { ...input }; delete missing[key];
        assert.throws(() => deriveElasticModulus(missing), /own source field/); cases++;
      }
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
        else delete Object.prototype[key];
      }
    }
    for (const [key, descriptor] of saved) assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, key), descriptor);
  }
  console.log("Inherited modulus source guard: " + cases + " cases and restoration passed");
`], { encoding: "utf8" });
check(inherited.status === 0, `isolated inherited-observation regression: ${inherited.stderr}`);
check(inherited.stdout.includes("19 cases and restoration passed"), "both models reject inherited defaults without polluting the parent");

let seed = 20261004;
function next(max: number): number { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; }
const holdout = Array.from({ length: 128 }, (_, id) => ({
  id,
  volume: BigInt(next(999) + 1),
  area: BigInt(next(99) + 1),
  height: BigInt(next(99) + 1),
  strain: BigInt(next(90) + 1) * (id % 2 ? -1n : 1n),
  modulus: BigInt(next(999999999) + 100000),
}));

if (!process.argv.includes("--holdout-only")) {
  for (const volume of [1n, 2n, 5n, 10n]) for (const denominator of [10000n, 1000n, 200n, 100n]) for (const modulus of [100000n, 10000000n, 1000000000n]) for (const sign of [-1n, 1n]) verifyBulk(volume, 1n, sign, denominator, modulus);
  for (const area of [1n, 10n, 100n]) for (const height of [1n, 10n, 100n]) for (const denominator of [10000n, 1000n, 200n, 100n]) for (const modulus of [100000n, 10000000n, 1000000000n]) for (const sign of [-1n, 1n]) verifyShear(area, 1000n, height, 10n, sign, denominator, modulus);
  console.log(`Elastic moduli core: ${inputsChecked} signed unit/model inputs; ${checks} independent checks including domain and mutation cases`);
}
const coreChecks = checks;
const coreInputs = inputsChecked;
for (const row of holdout) {
  verifyBulk(row.volume, 10n, row.strain, 10000n, row.modulus);
  verifyShear(row.area, 1000n, row.height, 10n, row.strain, 10000n, row.modulus);
}
console.log(`Elastic moduli synthetic holdout: 128 pre-listed bulk/shear pairs; ${inputsChecked - coreInputs} unit/model inputs; ${checks - coreChecks} checks; seed 20261004; not an exam cohort`);
