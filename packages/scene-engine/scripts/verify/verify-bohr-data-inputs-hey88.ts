import assert from "node:assert/strict";
import { deriveBohrOrbit as sourceBohrOrbit, type BohrOrbitInput } from "../../src/physics/bohrOrbitAuthority";
import { deriveBohrTransition as sourceBohrTransition, type BohrTransitionInput } from "../../src/physics/bohrTransitionAuthority";

const compiledBoundary = process.argv.includes("--compiled-boundary");
const api = compiledBoundary ? await import("@heytutor/scene-engine") : null;
const deriveBohrOrbit = api?.deriveBohrOrbit ?? sourceBohrOrbit;
const deriveBohrTransition = api?.deriveBohrTransition ?? sourceBohrTransition;

let checks = 0;
const transition = {
  model: "bohr_hydrogenic", electronCount: 1, Z: 2, nFrom: 3, nTo: 2,
  bindingEnergy: 13.6, bindingEnergyConvention: "hydrogen_reference", energyUnit: "eV", direction: "emission",
} satisfies BohrTransitionInput;
const orbit = {
  model: "bohr_hydrogenic", electronCount: 1, Z: 2, n: 3,
  groundRadius: 0.0529, radiusUnit: "nm", radiusConvention: "hydrogen_reference",
  groundSpeed: 2180000, speedUnit: "m/s", speedConvention: "hydrogen_reference",
} satisfies BohrOrbitInput;

function verify(name: string, base: Record<string, unknown>, derive: (raw: unknown) => unknown, optionalKeys: string[] = []): void {
  const expected = derive(base);
  assert.ok(Object.isFrozen(expected), `${name}: authority is frozen`);
  checks++;
  for (const key of Object.keys(base)) {
    for (const enumerable of [true, false]) {
      let reads = 0;
      const accessor = Object.defineProperty({ ...base }, key, {
        enumerable, configurable: true,
        get() { reads++; return base[key]; },
      });
      assert.throws(() => derive(accessor), /own data source fields/, `${name}: ${key} accessor rejected`);
      assert.equal(reads, 0, `${name}: ${key} getter was never called`);
      checks += 2;
      const setterOnly = Object.defineProperty({ ...base }, key, {
        enumerable, configurable: true,
        set() { throw new Error("source setter must not be executed"); },
      });
      assert.throws(() => derive(setterOnly), /own data source fields/, `${name}: ${key} setter rejected`);
      checks++;
      const throwing = Object.defineProperty({ ...base }, key, {
        enumerable, configurable: true,
        get() { reads++; throw new Error("source getter executed"); },
      });
      assert.throws(() => derive(throwing), /own data source fields/, `${name}: throwing getter rejected structurally`);
      assert.equal(reads, 0, `${name}: throwing getter not executed`);
      checks += 2;
    }
    const absent = { ...base };
    delete absent[key];
    if (optionalKeys.includes(key)) {
      assert.deepEqual(derive(absent), expected, `${name}: absent optional ${key} remains derived`);
    } else {
      assert.throws(() => derive(absent), /explicit own source field/, `${name}: missing required ${key}`);
    }
    checks++;
  }
  const descriptors = Object.fromEntries(Object.entries(base).map(([key, value]) => [key, {
    value, enumerable: false, configurable: false, writable: false,
  }]));
  assert.deepEqual(derive(Object.create(Object.prototype, descriptors)), expected, `${name}: nonenumerable own data accepted`);
  assert.deepEqual(derive(Object.create(null, descriptors)), expected, `${name}: null-prototype own data accepted`);
  assert.deepEqual(derive(Object.freeze({ ...base })), expected, `${name}: frozen source accepted`);
  checks += 3;
  let extraReads = 0;
  for (const key of ["unexpected", Symbol("unexpected")]) {
    const extra = Object.defineProperty({ ...base }, key, {
      enumerable: true,
      get() { extraReads++; return 1; },
    });
    assert.throws(() => derive(extra), `${name}: unknown own key rejected`);
    assert.equal(extraReads, 0, `${name}: unknown key accessor not read`);
    checks += 2;
  }
  assert.throws(() => derive(Object.create(base)), `${name}: inherited source rejected`);
  checks++;
  const mutable = { ...base };
  const result = derive(mutable);
  Object.assign(mutable, { model: "invented", electronCount: 2, Z: 9 });
  assert.deepEqual(result, expected, `${name}: caller mutation cannot alter authority`);
  checks++;
  assert.deepEqual(derive(base), expected, `${name}: input remains unmodified`);
  checks++;
}

verify("transition", transition, deriveBohrTransition, ["direction"]);
verify("orbit", orbit, deriveBohrOrbit);
console.log(`Bohr own-data boundary (${compiledBoundary ? "compiled public API" : "source"}): ${checks} checks; getters/setters, optional direction, own data descriptors, frozen/null-prototype inputs and mutation isolation`);
