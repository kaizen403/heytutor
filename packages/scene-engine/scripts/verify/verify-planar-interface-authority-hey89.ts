import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluatePlanarInterfaceAuthority } from "../../src/physics/planarInterfaceAuthority";

let checks = 0;
const EPS = Number.EPSILON;
const base = {
  model: "isotropic_lossless_planar",
  coordinateFrameId: "source-plane",
  mediumBefore: "glass",
  mediumAfter: "air",
  nBefore: 1.5,
  nAfter: 1,
  incidentDirection: [0.6, 0.8],
  normalBeforeToAfter: [0, 1],
};

function check(value: unknown, message: string): asserts value {
  checks += 1;
  assert.ok(value, message);
}

function near(actual: number, expected: number, message: string): void {
  checks += 1;
  assert.ok(Math.abs(actual - expected) <= 2e-11 * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}

function rejected(value: unknown, code?: string): void {
  const result = evaluatePlanarInterfaceAuthority(value);
  check(!result.ok, "invalid input must decline atomically");
  if (result.ok) throw new Error("unreachable");
  if (code) check(result.code === code, `expected ${code}, got ${result.code}`);
  check(!Object.hasOwn(result, "value"), "declines cannot carry partial authority");
}

function solved(value: unknown) {
  const result = evaluatePlanarInterfaceAuthority(value);
  check(result.ok, `positive input declined: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  check(Object.isFrozen(result) && Object.isFrozen(result.value), "authority is immutable");
  check(Object.isFrozen(result.value.reflectedDirection), "direction is immutable");
  return result.value;
}

function rotate(v: readonly number[], angle: number): [number, number] {
  return [v[0]! * Math.cos(angle) - v[1]! * Math.sin(angle), v[0]! * Math.sin(angle) + v[1]! * Math.cos(angle)];
}

if (process.argv.includes("--prototype-child")) {
  const names = Object.keys(base);
  const before = names.map((key) => Object.getOwnPropertyDescriptor(Object.prototype, key));
  try {
    names.forEach((key) => Object.defineProperty(Object.prototype, key, { configurable: true, value: base[key as keyof typeof base] }));
    rejected({});
    for (const key of names) {
      const input: Record<string, unknown> = { ...base };
      delete input[key];
      rejected(input);
    }
    Object.defineProperty(Array.prototype, "1", { configurable: true, writable: true, value: 1 });
    const sparse = new Array(2);
    sparse[0] = 0;
    rejected({ ...base, normalBeforeToAfter: sparse });
  } finally {
    delete (Array.prototype as unknown as Record<string, unknown>)["1"];
    names.forEach((key, i) => {
      const descriptor = before[i];
      if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
      else delete (Object.prototype as Record<string, unknown>)[key];
    });
  }
  console.log(`prototype child passed: ${checks}`);
  process.exit(0);
}

const regular = solved(base);
check(regular.branch === "transmitted", "below critical transmits");
near(regular.reflectedDirection[0], 0.6, "reflection tangent");
near(regular.reflectedDirection[1], -0.8, "reflection normal");
if (regular.transmittedDirection === null) throw new Error("missing transmitted direction");
near(regular.transmittedDirection[0], 0.9, "Snell tangent");
near(regular.transmittedDirection[1], Math.sqrt(0.19), "transmitted normal");
check(regular.coordinateFrameId === base.coordinateFrameId, "frame retained");
check(regular.mediumBefore === "glass" && regular.mediumAfter === "air", "ordered media retained");
near(regular.nBefore, 1.5, "source index retained");

const normal = solved({ ...base, incidentDirection: [0, 1] });
check(normal.branch === "transmitted", "normal incidence transmits");
near(normal.transmittedDirection![0], 0, "no deflection tangent");
near(normal.transmittedDirection![1], 1, "no deflection normal");
const tir = solved({ ...base, incidentDirection: [0.8, 0.6] });
check(tir.branch === "total_internal_reflection", "above critical TIR");
check(tir.transmittedDirection === null, "TIR has no fake transmission");
near(tir.reflectedDirection[0], 0.8, "TIR tangent");
near(tir.reflectedDirection[1], -0.6, "TIR normal");
rejected({ ...base, nBefore: 5, nAfter: 3 }, "unresolved_critical_contact");
rejected({ ...base, incidentDirection: [1, 0] }, "unresolved_grazing_contact");
rejected({ ...base, incidentDirection: [0, -1] }, "incompatible_approach");
rejected({ ...base, normalBeforeToAfter: [0, -1] }, "incompatible_approach");
rejected({ ...base, nBefore: 0 });
rejected({ ...base, nAfter: 1e-7 });
rejected({ ...base, mediumAfter: base.mediumBefore });
rejected({ ...base, coordinateFrameId: "" });
rejected({ ...base, model: "anisotropic" });
rejected({ ...base, incidentDirection: [0.3, 0.4] });
rejected({ ...base, incidentDirection: [NaN, 1] });
rejected({ ...base, normalBeforeToAfter: [0, Infinity] });
rejected({ ...base, intensity: 1 });
rejected({ ...base, [Symbol("extra")]: 1 });
rejected(Object.assign(Object.create({ extra: 1 }), base));
for (const name of Object.keys(base)) {
  const input: Record<string, unknown> = { ...base };
  delete input[name];
  rejected(input);
}
for (const field of ["incidentDirection", "normalBeforeToAfter"]) {
  rejected({ ...base, [field]: [0, 1, 2] });
  const sparse = new Array(2); sparse[1] = 1;
  rejected({ ...base, [field]: sparse });
  rejected({ ...base, [field]: Object.assign([0, 1], { extra: 1 }) });
  rejected({ ...base, [field]: Object.assign([0, 1], { [Symbol("extra")]: 1 }) });
  rejected({ ...base, [field]: { 0: 0, 1: 1, length: 2 } });
}
rejected({ ...base, incidentDirection: [Number.MIN_VALUE, 1] }, "unresolved_numeric_input");
rejected({ ...base, incidentDirection: [1e-200, 1] }, "unresolved_numeric_output");
rejected(null);
rejected(1);
rejected([]);
let getterReads = 0;
const accessor = { ...base };
Object.defineProperty(accessor, "nBefore", { get() { getterReads += 1; return 1.5; } });
rejected(accessor);
check(getterReads === 0, "source accessors are not executed");
const vectorAccessor = [0, 1];
Object.defineProperty(vectorAccessor, "0", { get() { getterReads += 1; return 0; } });
rejected({ ...base, normalBeforeToAfter: vectorAccessor });
check(getterReads === 0, "vector accessors are not executed");
const highRatioNormal = solved({ ...base, nBefore: 1e6, nAfter: 1e-6, incidentDirection: [0, 1] });
near(highRatioNormal.transmittedDirection![1], 1, "high-ratio normal remains normal");
check(regular.discriminant > regular.branchErrorBound && tir.discriminant < -tir.branchErrorBound, "branch signs exceed propagated bounds");
check(regular.branchErrorBound > 0 && Object.isFrozen(regular.incidentDirection), "provenance directions retained immutably");

for (const [n1, n2] of [[1, 1], [1, 1.5], [1.5, 1], [2.4, 1.1], [0.9, 1.7]]) {
  for (const sign of [-1, 1]) {
    for (const radians of [0, 0.1, 0.35, 0.7, 1.1]) {
      const direction = [sign * Math.sin(radians), Math.cos(radians)];
      const scalar = n1! * Math.sin(radians) / n2!;
      for (const rotation of [0, 0.31, -0.83, 2.17, Math.PI]) {
        const value = solved({ ...base, nBefore: n1, nAfter: n2, incidentDirection: rotate(direction, rotation), normalBeforeToAfter: rotate([0, 1], rotation) });
        const reflectedOracle = rotate([direction[0]!, -direction[1]!], rotation);
        near(value.reflectedDirection[0], reflectedOracle[0], "rotated reflection x");
        near(value.reflectedDirection[1], reflectedOracle[1], "rotated reflection y");
        near(Math.hypot(...value.reflectedDirection), 1, "reflected norm");
        check(value.nBefore === n1 && value.nAfter === n2, "no index swap");
        if (scalar > 1) {
          check(value.branch === "total_internal_reflection", "independent scalar TIR");
          check(value.transmittedDirection === null, "no TIR transmitted direction");
          continue;
        }
        check(value.branch === "transmitted", "independent scalar transmission");
        const transmitted = value.transmittedDirection!;
        const oracle = rotate([sign * scalar, Math.sqrt(1 - scalar * scalar)], rotation);
        near(transmitted[0], oracle[0], "transmission x");
        near(transmitted[1], oracle[1], "transmission y");
        near(Math.hypot(...transmitted), 1, "transmitted norm");
        const reverse = solved({ ...base, mediumBefore: "air", mediumAfter: "glass", nBefore: n2, nAfter: n1, incidentDirection: transmitted.map((v) => -v), normalBeforeToAfter: rotate([0, -1], rotation) });
        near(reverse.transmittedDirection![0], -rotate(direction, rotation)[0], "reciprocity x");
        near(reverse.transmittedDirection![1], -rotate(direction, rotation)[1], "reciprocity y");
      }
    }
  }
}

const entering = solved({ ...base, nBefore: 1, nAfter: 1.5, mediumBefore: "outside", mediumAfter: "slab" });
const exiting = solved({ ...base, nBefore: 1.5, nAfter: 1, mediumBefore: "slab", mediumAfter: "outside", incidentDirection: entering.transmittedDirection });
near(exiting.transmittedDirection![0], 0.6, "parallel slab output x");
near(exiting.transmittedDirection![1], 0.8, "parallel slab output y");

const holdout = Array.from({ length: 257 }, (_, i) => ({
  n1: 0.71 + ((i * 47 + 13) % 389) / 113,
  n2: 0.83 + ((i * 29 + 7) % 331) / 127,
  theta: 0.012 + ((i * 61 + 19) % 271) / 307,
  rotation: ((i * 31 + 5) % 359) * Math.PI / 180,
}));
for (const sample of holdout) {
  const ratioSine = sample.n1 * Math.sin(sample.theta) / sample.n2;
  const result = solved({ ...base, nBefore: sample.n1, nAfter: sample.n2, incidentDirection: rotate([Math.sin(sample.theta), Math.cos(sample.theta)], sample.rotation), normalBeforeToAfter: rotate([0, 1], sample.rotation) });
  check(result.branch === (ratioSine > 1 ? "total_internal_reflection" : "transmitted"), "prelisted holdout branch");
  if (ratioSine < 1) {
    const oracle = rotate([ratioSine, Math.sqrt(1 - ratioSine ** 2)], sample.rotation);
    near(result.transmittedDirection![0], oracle[0], "holdout direction x");
    near(result.transmittedDirection![1], oracle[1], "holdout direction y");
  }
}

for (const delta of [-8 * EPS, -2 * EPS, 0, 2 * EPS, 8 * EPS]) {
  rejected({ ...base, nBefore: 5 * (1 + delta), nAfter: 3 }, "unresolved_critical_contact");
}
const child = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), "--prototype-child"], { encoding: "utf8" });
check(child.status === 0, `prototype child failed: ${child.stdout}\n${child.stderr}`);
console.log(`planar interface authority: ${checks} independent checks; 257 prelisted synthetic holdouts; critical/grazing unresolved kept unsupported`);
