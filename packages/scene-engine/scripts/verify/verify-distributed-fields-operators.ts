import assert from "node:assert/strict";
import { evaluateDistributedFieldsConstruction, distributedFieldsConstructionOutputLabels, type DistributedFieldsEvaluationContext, type DistributedFieldsGeometry } from "../../src/compile/distributedFieldsGeometry";

/**
 * DCP-06 gate: continuous line-charge fields, spherical Gauss flux,
 * straight-wire and loop Biot-Savart fields, and sinusoidal varying flux.
 * Oracles are independent derivations (closed forms, Simpson integration of
 * Coulomb/Biot-Savart densities, polygon limits, numeric differentiation),
 * never a second copy of the implementation.
 */

const geometries = new Map<string, unknown>();
const quantities = new Map<string, number>([["lambda", 2], ["current", 3], ["charge", 4], ["time", 0.25]]);
const context: DistributedFieldsEvaluationContext = {
  number(value) {
    if (typeof value === "object" && value !== null && "value" in value) return context.number(value.value);
    return typeof value === "string" && quantities.has(value) ? quantities.get(value)! : Number(value);
  },
  point: () => ({ x: 0, y: 0 }),
  geometry(value) { return typeof value === "string" ? geometries.get(value) : undefined; },
};
let checks = 0;
function check(condition: unknown, message: string): asserts condition { checks++; assert.ok(condition, message); }
function close(actual: number, expected: number, message: string, tolerance = 1e-12): void {
  checks++;
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}
function fieldOf(output: DistributedFieldsGeometry, key: "lineChargeField" | "wireField" | "loopField"): any {
  check(key in output, `${key} metadata is present`);
  return (output as any)[key];
}

// A symmetric transverse line charge: E_perp = kλ(1/√2 + 1/√2), E_par = 0.
const lineBase = { mode: "schematic", k: 1, displayLength: 2 };
const symmetric = evaluateDistributedFieldsConstruction("line_charge_field", {
  ...lineBase, start: [-1, 0], end: [1, 0], at: [0, 1], chargeDensity: 2,
}, context)[0]!;
check(symmetric.kind === "path" && symmetric.directed, "nonzero line charge field is a directed path");
close(fieldOf(symmetric, "lineChargeField").components.x, 0, "symmetric line charge transverse cancellation");
close(fieldOf(symmetric, "lineChargeField").components.y, 2 * Math.SQRT2, "symmetric line charge perpendicular oracle");
close(fieldOf(symmetric, "lineChargeField").magnitude, 2 * Math.SQRT2, "line charge magnitude");
check(fieldOf(symmetric, "lineChargeField").totalCharge === 4, "total charge is density times length");
check(distributedFieldsConstructionOutputLabels("line_charge_field", [symmetric])[0] === "E schematic", "schematic line field carries no SI claim");

// Axial observation uses the on-axis limit, not the transverse quotient.
const axial = evaluateDistributedFieldsConstruction("line_charge_field", {
  ...lineBase, start: [1, 0], end: [3, 0], at: [0, 0], chargeDensity: 3,
}, context)[0]!;
close(fieldOf(axial, "lineChargeField").components.x, 3 * (1 / 3 - 1), "axial line charge oracle");
close(fieldOf(axial, "lineChargeField").components.y, 0, "axial line charge has no transverse part");

// Semi-infinite line: E_perp = kλL/(d√(L²+d²)), E_par = kλ(1/√(L²+d²) − 1/d).
const semi = evaluateDistributedFieldsConstruction("line_charge_field", {
  ...lineBase, start: [0, 0], end: [4, 0], at: [0, 3], chargeDensity: 1,
}, context)[0]!;
close(fieldOf(semi, "lineChargeField").components.y, 4 / (3 * 5), "semi-infinite perpendicular oracle");
close(fieldOf(semi, "lineChargeField").components.x, 1 / 5 - 1 / 3, "semi-infinite parallel oracle");

// Independent Simpson integration of the Coulomb density along the segment.
function simpsonLineCharge(start: number[], end: number[], at: number[], lambda: number, intervals = 2000): number[] {
  const ux = (end[0]! - start[0]!) / Math.hypot(end[0]! - start[0]!, end[1]! - start[1]!);
  const uy = (end[1]! - start[1]!) / Math.hypot(end[0]! - start[0]!, end[1]! - start[1]!);
  const length = Math.hypot(end[0]! - start[0]!, end[1]! - start[1]!);
  const step = length / intervals;
  let ex = 0;
  let ey = 0;
  for (let index = 0; index <= intervals; index++) {
    const t = index * step;
    const dx = at[0]! - (start[0]! + ux * t);
    const dy = at[1]! - (start[1]! + uy * t);
    const r3 = Math.pow(dx * dx + dy * dy, 1.5);
    const weight = index === 0 || index === intervals ? 1 : index % 2 === 0 ? 2 : 4;
    ex += weight * dx / r3;
    ey += weight * dy / r3;
  }
  return [lambda * step * ex / 3, lambda * step * ey / 3];
}
for (let seed = 1; seed <= 8; seed++) {
  const start = [seed - 4, (seed * 3) % 5 - 2];
  const end = [seed + 1, ((seed * 3) % 5) - 2 + (seed % 2 === 0 ? 2 : -1)];
  const spanX = end[0]! - start[0]!;
  const spanY = end[1]! - start[1]!;
  const span = Math.hypot(spanX, spanY);
  const at = [
    (start[0]! + end[0]!) / 2 + (-spanY / span) * 1.5,
    (start[1]! + end[1]!) / 2 + (spanX / span) * 1.5,
  ];
  const lambda = seed % 2 === 0 ? -1.5 : 2.5;
  const analytic = fieldOf(evaluateDistributedFieldsConstruction("line_charge_field", { ...lineBase, start, end, at, chargeDensity: lambda }, context)[0]!, "lineChargeField");
  const numeric = simpsonLineCharge(start, end, at, lambda);
  close(analytic.components.x, numeric[0]!, `line charge Simpson oracle x (seed ${seed})`, 1e-6);
  close(analytic.components.y, numeric[1]!, `line charge Simpson oracle y (seed ${seed})`, 1e-6);
}
const siLine = evaluateDistributedFieldsConstruction("line_charge_field", {
  start: [-100, 0], end: [100, 0], at: [0, 100], chargeDensity: 2, mode: "si", k: 9e9,
  displayLength: 2, lengthUnit: "cm", densityUnit: "uC/m",
}, context)[0]!;
close(fieldOf(siLine, "lineChargeField").magnitude, 9e9 * 2e-6 * Math.SQRT2, "SI line charge unit conversion", 1e-9);
const siMagnitude = fieldOf(siLine, "lineChargeField").magnitude;
const siNumeric = `E=${siMagnitude >= 0.001 && siMagnitude < 10000 ? Number(siMagnitude.toPrecision(3)).toString() : siMagnitude.toExponential(1).replace("e+", "e")} N/C`;
check(distributedFieldsConstructionOutputLabels("line_charge_field", [siLine])[0] === "E", "default SI line label is the symbol");
check(distributedFieldsConstructionOutputLabels("line_charge_field", [siLine], [siNumeric])[0] === siNumeric, "requested SI line label must match the verified magnitude");
checks++; assert.throws(() => distributedFieldsConstructionOutputLabels("line_charge_field", [siLine], ["E=1 N/C"]));
const zeroLine = evaluateDistributedFieldsConstruction("line_charge_field", {
  ...lineBase, start: [-1, 0], end: [1, 0], at: [0, 1], chargeDensity: 0,
}, context)[0]!;
check(zeroLine.kind === "point" && fieldOf(zeroLine, "lineChargeField").zero, "zero density certifies a zero point marker");
for (const bad of [
  { start: [0, 0], end: [0, 0], at: [0, 1], chargeDensity: 1 },
  { start: [-1, 0], end: [1, 0], at: [0, 0], chargeDensity: 1 },
  { start: [-1, 0], end: [1, 0], at: [1, 0], chargeDensity: 1 },
  { start: [-1, 0], end: [1, 0], at: [0, 1e-12], chargeDensity: 1 },
  { start: [-1, 0], end: [1, 0], at: [0, 1], chargeDensity: 1, k: 2 },
  { start: [-1, 0], end: [1, 0], at: [0, 1], chargeDensity: 1, mode: "si", k: 9e9 },
  { start: [-1, 0], end: [1, 0], at: [0, 1], chargeDensity: 1, displayLength: 0 },
  { start: [-1, 0], end: [1, 0], at: [0, 1], chargeDensity: 1, densityUnit: "C/m" },
  { start: [-1, 0], end: [1, 0], at: [0, 1], chargeDensity: 1, extra: true },
]) { checks++; assert.throws(() => evaluateDistributedFieldsConstruction("line_charge_field", { ...lineBase, ...bad }, context)); }

// Spherical Gauss flux is Q/ε, independent of the drawn circle's radius.
const gauss = evaluateDistributedFieldsConstruction("gauss_flux", {
  model: "spherical", center: [1, 2], radius: 3, enclosedCharge: 4, epsilon0: 1, mode: "schematic",
}, context);
check(gauss.length === 2 && gauss[0]!.kind === "circle" && gauss[1]!.kind === "point", "gauss flux draws a cross-section and a label anchor");
close((gauss[0] as { gaussFlux: { flux: number } }).gaussFlux.flux, 4, "schematic Gauss flux is enclosed charge over epsilon");
const gaussSI = evaluateDistributedFieldsConstruction("gauss_flux", {
  model: "spherical", center: [0, 0], radius: 2, enclosedCharge: 5, epsilon0: 8.85e-12,
  mode: "si", chargeUnit: "uC", lengthUnit: "cm", epsilonUnit: "F/m",
}, context);
close((gaussSI[0] as { gaussFlux: { flux: number } }).gaussFlux.flux, 5e-6 / 8.85e-12, "SI Gauss flux converts charge before dividing by epsilon", 1e-6);

// Infinite wire: B = μI (−ry, rx) / 2πr². At (3, 0) this is straight up.
const wireBase = { mu0: 1, mode: "schematic", displayLength: 2 };
const wire = evaluateDistributedFieldsConstruction("wire_field", {
  ...wireBase, model: "infinite_wire", wire: [0, 0], at: [3, 0], current: 2,
}, context)[0]!;
close(fieldOf(wire, "wireField").components.x, 0, "infinite wire field has no radial part");
close(fieldOf(wire, "wireField").components.y, 2 / (2 * Math.PI * 3), "infinite wire azimuthal oracle");
const axialWire = evaluateDistributedFieldsConstruction("wire_field", {
  ...wireBase, model: "finite_segment", start: [0, 0], end: [4, 0], at: [6, 0], current: 3,
}, context)[0]!;
check(axialWire.kind === "point" && fieldOf(axialWire, "wireField").zero, "off-segment axial finite wire certifies zero");
const finiteWire = evaluateDistributedFieldsConstruction("wire_field", {
  ...wireBase, model: "finite_segment", start: [0, 0], end: [4, 0], at: [2, 3], current: 2,
}, context)[0]!;
const finiteR = 3;
const finiteS1 = -2;
const finiteS2 = 2;
const finiteOracle = (2 * ((finiteS2 / Math.hypot(finiteR, finiteS2)) - (finiteS1 / Math.hypot(finiteR, finiteS1)))) / (4 * Math.PI * finiteR);
close(fieldOf(finiteWire, "wireField").components.z, finiteOracle, "finite-segment Biot-Savart oracle");

// Loop center: Bz = μI / 2R. A 12-side polygon approaches the same center field.
const loop = evaluateDistributedFieldsConstruction("loop_field", {
  ...wireBase, center: [0, 0], radius: 5, current: 4,
}, context)[0]!;
close(fieldOf(loop, "loopField").axialField, 4 / (2 * 5), "loop center field oracle");
function polygonCenterField(radius: number, current: number, sides: number): number {
  const side = 2 * radius * Math.sin(Math.PI / sides);
  const distance = radius * Math.cos(Math.PI / sides);
  return sides * (current * side) / (4 * Math.PI * distance * Math.hypot(distance, side / 2));
}
close(fieldOf(loop, "loopField").axialField, polygonCenterField(5, 4, 256), "loop center matches a fine polygon limit", 1e-4);

// Φ = N (axis·A) (b0 + b1 sin(ωt+p)); emf = −dΦ/dt. Quarter period is a closed form.
const sinusoid = evaluateDistributedFieldsConstruction("flux_sinusoid", {
  model: "uniform_sinusoidal", axis: [0, 0, 1], b0: 0, b1: 2, angularFrequency: Math.PI,
  frequencyUnit: "rad/s", phase: 0, phaseUnit: "rad", areaVector: [0, 0, 1], turns: 1,
  tMin: 0, tMax: 1, units: { field: "T", area: "m^2", time: "s" }, samples: 33,
}, context)[0]!;
check(sinusoid.kind === "path", "sinusoidal flux is a time curve");
const sinusoidPoints = (sinusoid as { points: { x: number; y: number }[] }).points;
check(sinusoidPoints.length === 33, "sinusoid samples the declared count");
close(sinusoidPoints[16]!.x, 0.5, "sinusoid midpoint uses source time");
close(sinusoidPoints[16]!.y, 2, "quarter-period flux is the sine peak");
geometries.set("phi", sinusoid);
const state = evaluateDistributedFieldsConstruction("sinusoid_state", { process: "phi", time: 0 }, context);
check(state.length === 2, "sinusoid state returns flux and emf anchors");
close((state[0] as { sinusoidState: { fluxSI: number; emfSI: number } }).sinusoidState.fluxSI, 0, "t=0 flux is the sine zero");
close((state[0] as { sinusoidState: { emfSI: number } }).sinusoidState.emfSI, -2 * Math.PI, "t=0 emf is the negative cosine peak");
const numericEmf = (2 * Math.sin(Math.PI * 1e-6) - 0) / 1e-6;
close((state[0] as { sinusoidState: { emfSI: number } }).sinusoidState.emfSI, -numericEmf, "emf matches a one-sided numeric derivative", 1e-6);

console.log(`verify-distributed-fields-operators: ${checks} checks ok`);
