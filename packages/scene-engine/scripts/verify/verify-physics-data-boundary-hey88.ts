import assert from "node:assert/strict";
import { deriveElasticModulus as sourceElastic, type ElasticModulusInput } from "../../src/physics/elasticModulusAuthority";
import { evaluatePlanarInterfaceAuthority as sourcePlanar } from "../../src/physics/planarInterfaceAuthority";

const compiled = process.argv.includes("--compiled-boundary");
const api = compiled ? await import("@heytutor/scene-engine") : null;
const deriveElasticModulus = api?.deriveElasticModulus ?? sourceElastic;
const evaluatePlanarInterfaceAuthority = api?.evaluatePlanarInterfaceAuthority ?? sourcePlanar;
let checks = 0;
function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) <= 64 * Number.EPSILON * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
  checks++;
}
const bulk = {
  model: "linear_bulk_response", initialVolume: 200, volumeUnit: "cm3",
  deltaVolume: -0.4, deltaVolumeUnit: "cm3", deltaPressure: 60, pressureUnit: "kPa",
} satisfies ElasticModulusInput;
const shear = {
  model: "linear_simple_shear", shearAxisId: "observed:x", tangentialForce: -2, forceUnit: "kN",
  faceArea: 20, areaUnit: "cm2", layerDisplacement: -0.5, displacementUnit: "mm", layerHeight: 10, heightUnit: "cm",
} satisfies ElasticModulusInput;
const plane = {
  model: "isotropic_lossless_planar", coordinateFrameId: "source:xy", mediumBefore: "air", mediumAfter: "glass",
  nBefore: 1, nAfter: 1.5, incidentDirection: [0.6, 0.8], normalBeforeToAfter: [0, 1],
};
function planar(raw: unknown) {
  const result = evaluatePlanarInterfaceAuthority(raw);
  if (!result.ok) throw new Error(result.code);
  return result.value;
}
const b = deriveElasticModulus(bulk);
assert.equal(b.model, "linear_bulk_response");
if (b.model !== "linear_bulk_response") throw new Error("bulk model missing");
close(b.initialVolumeM3, 0.0002);
close(b.deltaVolumeM3, -4e-7);
close(b.deltaPressurePa, 60000);
close(b.strain, -0.002);
close(b.stressPa, -60000);
close(b.modulusPa, 30000000);
const s = deriveElasticModulus(shear);
assert.equal(s.model, "linear_simple_shear");
if (s.model !== "linear_simple_shear") throw new Error("shear model missing");
close(s.forceN, -2000);
close(s.areaM2, 0.002);
close(s.displacementM, -0.0005);
close(s.heightM, 0.1);
close(s.strain, -0.005);
close(s.stressPa, -1000000);
close(s.modulusPa, 200000000);
const p = planar(plane);
assert.equal(p.branch, "transmitted");
assert.ok(p.transmittedDirection);
close(p.transmittedDirection[0], 0.4);
close(p.transmittedDirection[1], Math.sqrt(0.84));
close(p.reflectedDirection[0], 0.6);
close(p.reflectedDirection[1], -0.8);
checks += 4;
for (const { name, base, derive } of [
  { name: "bulk", base: bulk, derive: deriveElasticModulus },
  { name: "shear", base: shear, derive: deriveElasticModulus },
  { name: "planar", base: plane, derive: planar },
]) {
  const expected = derive(base);
  for (const key of Object.keys(base)) {
    for (const enumerable of [true, false]) {
      let reads = 0;
      const getter = Object.defineProperty({ ...base }, key, {
        enumerable, get() { reads++; throw new Error("input getter was executed"); },
      });
      assert.throws(() => derive(getter), `${name}.${key} getter must decline`);
      assert.equal(reads, 0, `${name}.${key} getter must not execute`);
      checks += 2;
    }
    const missing = { ...base };
    Reflect.deleteProperty(missing, key);
    assert.throws(() => derive(missing), `${name}.${key} must be explicit`);
    checks++;
  }
  const data = Object.fromEntries(Object.entries(base).map(([key, value]) => [key, { value, enumerable: false }]));
  assert.deepEqual(derive(Object.create(null, data)), expected, `${name}: null-prototype own data retained`);
  assert.deepEqual(derive(Object.create(Object.prototype, data)), expected, `${name}: nonenumerable own data retained`);
  assert.deepEqual(derive(Object.freeze({ ...base })), expected, `${name}: frozen source retained`);
  assert.deepEqual(derive(JSON.parse(JSON.stringify(base))), expected, `${name}: source JSON parity`);
  assert.throws(() => derive(Object.create(base)), `${name}: inherited source declines`);
  assert.throws(() => derive({ ...base, [Symbol("hidden")]: 1 }), `${name}: symbol source declines`);
  checks += 6;
}
for (const key of ["incidentDirection", "normalBeforeToAfter"] as const) {
  for (const index of ["0", "1"]) {
    let reads = 0;
    const vector = Object.defineProperty([...plane[key]], index, { get() { reads++; throw new Error("direction getter executed"); } });
    assert.throws(() => planar({ ...plane, [key]: vector }), /invalid_structure/);
    assert.equal(reads, 0);
    checks += 2;
  }
}
assert.throws(() => deriveElasticModulus({ ...bulk, deltaVolume: 0.4 }));
assert.throws(() => deriveElasticModulus({ ...shear, layerDisplacement: 0.5 }));
assert.throws(() => deriveElasticModulus({ ...bulk, youngModulus: 30000000 }));
assert.throws(() => deriveElasticModulus({ ...shear, shearAxisId: "" }));
assert.throws(() => planar({ ...plane, normalBeforeToAfter: [0, -1] }), /incompatible_approach/);
assert.throws(() => planar({ ...plane, mediumAfter: "air" }), /invalid_frame_or_media/);
assert.throws(() => planar({ ...plane, incidentDirection: [1, 0] }), /unresolved_grazing_contact/);
assert.throws(() => planar({ ...plane, nBefore: 5, nAfter: 3 }), /unresolved_critical_contact/);
const tir = planar({ ...plane, nBefore: 1.5, nAfter: 1, incidentDirection: [0.8, 0.6] });
assert.equal(tir.branch, "total_internal_reflection");
assert.equal(tir.transmittedDirection, null);
checks += 10;
console.log(`HEY88 physics boundary (${compiled ? "compiled public API" : "source"}): ${checks} independent own-data, signed SI, oriented branch and unresolved-domain checks; no source-cohort/topic acceptance`);
