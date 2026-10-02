import assert from "node:assert/strict";
import nodeProcess from "node:process";
import { evaluateInductionConstruction, inductionConstructionOutputLabels, validateInductionConstruction, type InductionEvaluationContext, type InductionGeometry } from "../../src/compile/inductionGeometry";
import { evaluateCalculusConstruction, calculusAnchorResidual } from "../../src/compile/calculusGeometry";
import type { SceneDocument, SceneIssue } from "../../src/types";

const geometries = new Map<string, unknown>(); const quantities = new Map<string, number>([["B", 2], ["BRate", 3], ["A", 4], ["ARate", 5], ["N", 2], ["time", 1]]);
const context: InductionEvaluationContext = {
  number(value) { if (typeof value === "object" && value !== null && "value" in value) return context.number(value.value); return typeof value === "string" && quantities.has(value) ? quantities.get(value)! : Number(value); },
  point: () => ({ x: 0, y: 0 }), geometry(value) { return typeof value === "string" ? geometries.get(value) : undefined; },
};
const base = { model: "uniform_affine", B0: [0, 0, 2], fieldRate: [0, 0, 3], areaVector: [0, 0, 4], areaRate: [0, 0, 5], turns: 2, tMin: 0, tMax: 2, units: { field: "T", area: "m^2", time: "s" } };
let checks = 0;
function check(condition: unknown, message: string): asserts condition { checks++; assert.ok(condition, message); }
function close(actual: number, expected: number, message: string): void { checks++; assert.ok(actual === expected || Math.abs(actual - expected) <= 1e-12 * Math.abs(expected), `${message}: ${actual} != ${expected}`); }
function process(overrides: Record<string, unknown> = {}): InductionGeometry { return evaluateInductionConstruction("flux_process", { ...base, ...overrides }, context)[0]!; }
function state(processId = "process", time: unknown = 1, overrides: Record<string, unknown> = {}): InductionGeometry[] { return evaluateInductionConstruction("induction_state", { process: processId, time, ...overrides }, context); }
function reject(overrides: Record<string, unknown>): void { checks++; assert.throws(() => process(overrides), undefined, `invalid induction source ${JSON.stringify(overrides)}`); }
const quadratic = process(); geometries.set("process", quadratic);
check("fluxProcess" in quadratic && quadratic.kind === "path", "explicit process renders a sampled analytic curve");
check(JSON.stringify(quadratic.fluxProcess.coefficientsSI) === JSON.stringify({ constant: 16, linear: 44, quadratic: 30 }), "independent expanded N(B0+Bt)(A0+At) coefficients");
close(quadratic.sampledCurve.evaluate(1).y, 90, "quadratic source dot-product flux oracle at t=1");
close(quadratic.sampledCurve.derivative!(1).y, 104, "exact polynomial derivative oracle");
check(quadratic.points.length === 65 && inductionConstructionOutputLabels("flux_process", [quadratic])[0] === "Phi(t)", "bounded process sampling and source-law symbolic label");
const snapshot = state("process", "time");
check(snapshot[0]!.kind === "point" && "inductionState" in snapshot[0]! && "inductionState" in snapshot[1]!, "state produces ordered flux point and emf scalar anchor");
close(snapshot[0]!.inductionState.fluxSI, 90, "exact-source-time physical flux"); close(snapshot[1]!.inductionState.emfSI, -104, "Lenz minus sign is the derivative of flux linkage");
check(snapshot[0]!.calculusAnchor?.curveId === "process" && snapshot[0]!.calculusAnchor.parameter === 1 && snapshot[1]!.calculusAnchor === undefined, "only the flux point claims analytic curve incidence");
check(calculusAnchorResidual(snapshot[0], quadratic, "process") === 0, "source-time-pinned exact incidence proof");
check(JSON.stringify(inductionConstructionOutputLabels("induction_state", snapshot)) === JSON.stringify(["Phi(t)", "emf(t)"]), "state defaults preserve initial setup");
check(JSON.stringify(inductionConstructionOutputLabels("induction_state", snapshot, ["Phi=90 Wb", "emf=-104 V"])) === JSON.stringify(["Phi=90 Wb", "emf=-104 V"]), "correct explicitly requested signed numeric claims survive");
for (const requested of [["Phi=999 Wb", "emf=-104 V"], ["Phi=90 Wb", "emf=104 V"], ["Phi=NaN Wb", "emf(t)"], ["Phi(t)", "emf=Infinity V"], ["Phi(t)", "emf=-104 Wb"]]) { checks++; assert.throws(() => inductionConstructionOutputLabels("induction_state", snapshot, requested)); }
const tangent = evaluateCalculusConstruction("curve_derivative", { curve: "process", at: 1, parameterScale: 0.01 }, context)[0]!;
check(tangent.kind === "path", "exact source callbacks compose with a directed derivative vector"); close(tangent.calculusDerivative!.derivative.y, 104, "calculus consumes the analytic flux derivative");
for (const [name, overrides, flux, emf] of [
  ["field_only", { areaRate: [0, 0, 0] }, 40, -24], ["area_only", { fieldRate: [0, 0, 0] }, 36, -20],
  ["static", { fieldRate: [0, 0, 0], areaRate: [0, 0, 0] }, 16, 0],
  ["normal_reverse", { areaVector: [0, 0, -4], areaRate: [0, 0, -5] }, -90, 104],
  ["field_reverse", { B0: [0, 0, -2], fieldRate: [0, 0, -3] }, -90, 104],
  ["orthogonal", { B0: [1, 0, 0], fieldRate: [0, 0, 0], areaVector: [0, 1, 0], areaRate: [0, 0, 1] }, 0, 0],
] as const) {
  const model = process(overrides); geometries.set(name, model); const sample = state(name)[0]!;
  check("inductionState" in sample, "changed source-law state authority"); close(sample.inductionState.fluxSI, flux, `${name} independent flux oracle`); close(sample.inductionState.emfSI, emf, `${name} independent signed emf oracle`);
}
const rotated = process({ B0: [2, 0, 0], fieldRate: [3, 0, 0], areaVector: [4, 0, 0], areaRate: [5, 0, 0] }); check("fluxProcess" in rotated && JSON.stringify(rotated.fluxProcess.coefficientsSI) === JSON.stringify(quadratic.fluxProcess.coefficientsSI), "shared Cartesian rotation preserves oriented dot products");
const cancelled = process({ B0: [1, -1, 0], fieldRate: [2, -2, 0], areaVector: [1, 1, 0], areaRate: [3, 3, 0] }); check("fluxProcess" in cancelled && Object.values(cancelled.fluxProcess.coefficientsSI).every((value) => value === 0), "exact binary dot cancellation certifies zero flux/emf without zero source area");
const roundedCancellation = process({ B0: [4 / 3, 1, 0], fieldRate: [0, 0, 0], areaVector: [3, -4, 0], areaRate: [0, 0, 0], turns: 1 });
check("fluxProcess" in roundedCancellation && roundedCancellation.fluxProcess.coefficientsSI.constant === -(2 ** -52), "rounded products cannot falsely certify zero flux");
const metric = process({ B0: [0, 0, 2000], fieldRate: [0, 0, 3], areaVector: [0, 0, 40000], areaRate: [0, 0, 50], tMin: 0, tMax: 2000, units: { field: "mT", area: "cm^2", time: "ms" }, fluxUnit: "mWb", timeScale: 0.001, fluxScale: 0.001 }); geometries.set("metric", metric);
check("fluxProcess" in metric, "declared metric unit process"); check(JSON.stringify(metric.fluxProcess.coefficientsSI) === JSON.stringify(quadratic.fluxProcess.coefficientsSI), "mT/cm^2/ms rates convert to the same SI polynomial");
const metricState = state("metric", 1000)[0]!; check("inductionState" in metricState, "metric source-time snapshot"); close(metricState.inductionState.timeSI, 1, "native ms parameter converts to SI time"); close(metricState.inductionState.fluxSI, 90, "unit-invariant physical flux"); close(metricState.inductionState.emfSI, -104, "source-time derivative scales to volts");
close(metric.sampledCurve.evaluate(1000).x, 1, "display x uses explicit native source-time scale"); close(metric.sampledCurve.evaluate(1000).y, 90, "mWb display scale remains distinct from SI flux"); close(metric.sampledCurve.derivative!(1000).y, 0.104, "derivative callback is per native ms parameter");
const bound = process({ B0: [0, 0, "B"], fieldRate: [0, 0, { value: "BRate", unit: "T/s" }], areaVector: [0, 0, "A"], areaRate: [0, 0, { value: "ARate", unit: "m^2/s" }], turns: "N" }); check("fluxProcess" in bound && bound.fluxProcess.coefficientsSI.linear === 44, "source quantities and strict scalar wrappers bind rates and units");
for (let seed = 1; seed <= 12; seed++) {
  const B0 = [seed - 4, 2, 3]; const b = [1, seed % 3, -2]; const A0 = [5, seed % 4, 1]; const a = [0, 1, seed % 2]; const N = seed + 1; const time = 0.125;
  const model = process({ B0, fieldRate: b, areaVector: A0, areaRate: a, turns: N, tMax: 0.25 }); geometries.set("oracle", model); const result = state("oracle", time)[0]!; check("inductionState" in result, "deterministic independent vector-law oracle");
  const B = B0.map((value, axis) => value + b[axis]! * time); const A = A0.map((value, axis) => value + a[axis]! * time);
  close(result.inductionState.fluxSI, N * B.reduce((sum, value, axis) => sum + value * A[axis]!, 0), "independent direct dot-product oracle");
  close(result.inductionState.emfSI, -N * b.reduce((sum, value, axis) => sum + value * A[axis]! + B[axis]! * a[axis]!, 0), "independent direct product-rule/Lenz oracle");
}
const badSources: Record<string, unknown>[] = [
  { B0: [0, 0, "1e-400"], fieldRate: [0, 0, 0] }, { fieldRate: [0, 0, "1e-400"], areaRate: [0, 0, 0] },
  { model: undefined }, { model: "guess_circle" }, { B0: [0, 2] }, { fieldRate: undefined }, { areaRate: undefined }, { B0: [0, 0, Infinity] }, { B0: [0, 0, null] }, { turns: 0 }, { turns: 1.5 }, { turns: 1e6 + 1 }, { turns: true },
  { tMax: 0 }, { tMin: Infinity }, { tMax: 1e10 }, { tMin: 0, tMax: 1e-8 }, { samples: 2 }, { samples: 1026 }, { samples: 17.5 }, { timeScale: 0 }, { fluxScale: -1 }, { fluxScale: Infinity },
  { areaVector: [0, 0, 0], areaRate: [0, 0, 0] }, { areaVector: [0, 0, 1], areaRate: [0, 0, -1] }, { areaVector: [0, 0, 2], areaRate: [0, 0, -1] },
  { units: undefined }, { units: { ...base.units, field: "G" } }, { units: { ...base.units, area: "m" } }, { fluxUnit: "V" }, { fieldRate: [0, 0, { value: 3, unit: "T/ms" }] }, { areaRate: [0, 0, { value: 5, unit: "m^2" }] },
  { B0: [0, 0, { value: 2, unit: "mT" }] }, { tMax: { value: 2, unit: "ms" } }, { timeScale: { value: 1, unit: "s" } }, { origin: [1, 2, 3] }, { origin: "world_point" }, { origin: { x: 0, y: 0, world3D: [0, 0, 1] } }, { origin: [0, 1e12] },
  { B0: [0, 0, 1e-300], fieldRate: [0, 0, 0], areaVector: [0, 0, 1e-100], areaRate: [0, 0, 0] }, { areaVector: [Number.MIN_VALUE, Number.MIN_VALUE, 0], areaRate: [0, 0, 0] }, { arbitrary: 1 },
  { B0: [0, 0, 2], fieldRate: [0, 0, 0], areaVector: [0, 0, 4], areaRate: [0, 0, 0], tMin: 1e9 - 2 ** -23, tMax: 1e9, timeScale: 100 },
];
badSources.forEach(reject);
for (const mutation of [{ time: 3 }, { time: null }, { time: { value: 1, unit: "ms" } }, { emfAt: "world_point" }, { emfAt: [0, 0, 1] }, { process: "missing" }, { extra: true }]) { checks++; assert.throws(() => state("process", 1, mutation)); }
for (const mutation of [{ fluxProcess: { ...quadratic.fluxProcess, coefficientsSI: { constant: 999, linear: 44, quadratic: 30 } } }, { points: [] }, { world3D: { x: 0, y: 0, z: 1 } }, { sampledCurve: { ...quadratic.sampledCurve, derivative: () => ({ x: 1, y: 999 }) } }]) { geometries.set("tampered", { ...quadratic, ...mutation }); checks++; assert.throws(() => state("tampered"), undefined, "tampered process cannot supply an induction state"); }

function scene(): SceneDocument {
  return { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "explicit uniform-field affine flux linkage" }, source: {}, quantities: [],
    entities: [{ id: "process", kind: "polyline", role: "source-time flux linkage" }, { id: "flux", kind: "point", role: "physical flux sample" }, { id: "emf", kind: "label", role: "signed emf scalar anchor" }],
    constructions: [{ id: "make_process", operator: "flux_process", inputs: { ...base, timeScale: 50 }, outputs: ["process"] }, { id: "snapshot", operator: "induction_state", inputs: { process: "process", time: 1, emfAt: [0, -20] }, outputs: ["flux", "emf"] }],
    relations: [], assertions: [{ id: "sample_on_flux", predicate: "on", entities: ["flux", "process"], severity: "fatal", tolerance: 1e-10 }], annotations: [], requiredEntityIds: ["process", "flux", "emf"], revealGroups: [{ id: "induction", entityIds: ["process", "flux", "emf"], dependsOn: [], narrationCue: "source flux and signed induction emf" }], teachingTimeline: [] };
}
function issues(document: SceneDocument): SceneIssue[] { const result: SceneIssue[] = []; const producers = new Map(document.constructions.flatMap((construction) => construction.outputs.map((id) => [id, construction] as const))); document.constructions.forEach((construction, index) => { if (["flux_process", "induction_state"].includes(construction.operator)) validateInductionConstruction(construction, index, document, producers, result); }); return result; }
check(issues(scene()).length === 0, "explicit process and point/label state validate");
const quantityScene = scene(); quantityScene.quantities = [{ id: "B", value: 2, unit: "T" }, { id: "BRate", value: 3, unit: "T/s" }, { id: "A", value: 4, unit: "m^2" }, { id: "ARate", value: 5, unit: "m^2/s" }, { id: "N", value: 2, unit: "1" }, { id: "time", value: 1, unit: "s" }]; Object.assign(quantityScene.constructions[0]!.inputs, { B0: [0, 0, "B"], fieldRate: [0, 0, "BRate"], areaVector: [0, 0, "A"], areaRate: [0, 0, "ARate"], turns: "N" }); quantityScene.constructions[1]!.inputs.time = "time"; check(issues(quantityScene).length === 0, "known rate/area/field/time source units validate");
const invalidScenes: SceneDocument[] = [];
const underflowField = structuredClone(quantityScene); underflowField.quantities[0]!.value = "1e-400"; check(issues(underflowField).some((issue) => issue.severity === "fatal"), "quantity-bound nonzero decimal field cannot become zero flux"); invalidScenes.push(underflowField);
for (const [id, unit] of [["B", "mT"], ["BRate", "T/ms"], ["A", "cm^2"], ["ARate", "m^2/ms"], ["time", "ms"], ["B", ""], ["A", 42]] as const) { const candidate = structuredClone(quantityScene); candidate.quantities.find((quantity) => quantity.id === id)!.unit = unit; check(issues(candidate).some((issue) => issue.severity === "fatal"), "known quantity scale contradictions fail closed"); invalidScenes.push(candidate); }
const explicitLabels = scene(); explicitLabels.entities[1]!.label = "Phi=90 Wb"; explicitLabels.entities[2]!.label = "emf=-104 V"; check(issues(explicitLabels).length === 0, "accurate requested physical scalar labels validate");
const stale = scene(); stale.entities[2]!.label = "emf=104 V"; check(issues(stale).some((issue) => issue.severity === "fatal"), "wrong Lenz-sign result label cannot pair with valid graph"); invalidScenes.push(stale);
const annotation = scene(); annotation.quantities.push({ id: "wrong_emf", value: 104, unit: "V" }); annotation.annotations.push({ id: "answer", kind: "badge", targetIds: ["emf"], quantityId: "wrong_emf" }); check(issues(annotation).some((issue) => issue.severity === "fatal"), "scalar quantity annotations retain signed physical authority"); invalidScenes.push(annotation);
const correctAnnotation = scene(); correctAnnotation.quantities.push({ id: "flux_source", value: 90000, unit: "mWb" }); correctAnnotation.annotations.push({ id: "answer", kind: "badge", targetIds: ["flux"], quantityId: "flux_source" }); check(issues(correctAnnotation).length === 0, "declared scalar milliunits convert deterministically");
const scalarKind = scene(); scalarKind.entities[2]!.kind = "point"; check(issues(scalarKind).some((issue) => issue.severity === "fatal"), "emf output is a scalar label anchor rather than a physical point"); invalidScenes.push(scalarKind);
const replay = scene(); replay.constructions.reverse(); check(issues(replay).length === 0, "construction source order does not affect source-law replay");
const staticScene = scene(); Object.assign(staticScene.constructions[0]!.inputs, { fieldRate: [0, 0, 0], areaRate: [0, 0, 0] }); check(issues(staticScene).length === 0, "constant flux and zero emf remain physical source models");
const linearScene = scene(); linearScene.constructions[0]!.inputs.areaRate = [0, 0, 0]; check(issues(linearScene).length === 0, "single changing source produces a supported linear flux graph");
const zeroScene = scene(); Object.assign(zeroScene.constructions[0]!.inputs, { B0: [1, 0, 0], fieldRate: [0, 0, 0], areaVector: [0, 1, 0], areaRate: [0, 0, 1] }); check(issues(zeroScene).length === 0, "orthogonal sources certify a zero baseline and zero signed emf");
const metricScene = scene(); Object.assign(metricScene.constructions[0]!.inputs, { B0: [0, 0, 2000], fieldRate: [0, 0, 3], areaVector: [0, 0, 40000], areaRate: [0, 0, 50], tMax: 2000, units: { field: "mT", area: "cm^2", time: "ms" }, fluxUnit: "mWb", timeScale: 0.05, fluxScale: 0.001 }); metricScene.constructions[1]!.inputs.time = 1000; check(issues(metricScene).length === 0, "declared metric process and native-time state validate");
const cycle = structuredClone(quantityScene); cycle.quantities.push({ id: "again", value: "B", unit: "T" }); cycle.quantities[0]!.value = "again"; check(issues(cycle).some((issue) => issue.severity === "fatal"), "quantity binding cycles fail closed"); invalidScenes.push(cycle);
const malformedWrapper = structuredClone(quantityScene); malformedWrapper.quantities[0]!.value = { value: 2, extra: "untrusted" }; check(issues(malformedWrapper).some((issue) => issue.severity === "fatal"), "quantity-bound wrapper schemas remain strict"); invalidScenes.push(malformedWrapper);
const tinyWrong = structuredClone(zeroScene); tinyWrong.quantities.push({ id: "tiny", value: Number.MIN_VALUE, unit: "V" }); tinyWrong.annotations.push({ id: "false_zero", kind: "badge", targetIds: ["emf"], quantityId: "tiny" }); check(issues(tinyWrong).some((issue) => issue.severity === "fatal"), "a tiny nonzero physical claim cannot become a certified zero emf"); invalidScenes.push(tinyWrong);
const processScalar = scene(); processScalar.quantities.push({ id: "unbound_flux", value: 90, unit: "Wb" }); processScalar.annotations.push({ id: "wrong_scope", kind: "badge", targetIds: ["process"], quantityId: "unbound_flux" }); check(issues(processScalar).some((issue) => issue.severity === "fatal"), "a curve does not claim an unbound flux scalar without a state time"); invalidScenes.push(processScalar);
const calculus = scene(); calculus.entities.push({ id: "derivative", kind: "vector", role: "analytic source-time derivative" }); calculus.constructions.push({ id: "make_derivative", operator: "curve_derivative", inputs: { curve: "process", at: 1, parameterScale: 0.1 }, outputs: ["derivative"] }); calculus.requiredEntityIds.push("derivative"); calculus.revealGroups[0]!.entityIds.push("derivative");
if (!nodeProcess.argv.includes("--geometry-only")) {
  const { compileSceneDocument } = await import("../../src/index");
  for (const candidate of [scene(), quantityScene, explicitLabels, correctAnnotation, replay, calculus, staticScene, linearScene, zeroScene, metricScene]) { const before = JSON.stringify(candidate); const result = compileSceneDocument(candidate); check(result.ok && result.renderScene, `live induction compile: ${JSON.stringify(result.report.issues)}`); for (const [id, defaultText] of [["process", "Phi(t)"], ["flux", "Phi(t)"], ["emf", "emf(t)"]]) check(result.renderScene.primitives.some((primitive) => primitive.entityId === id && primitive.kind === "label" && primitive.text === (candidate.entities.find((entity) => entity.id === id)?.label ?? defaultText)), "engine-owned process and state labels preserve setup or explicit verified values"); check(JSON.stringify(candidate) === before, "live induction compilation leaves the source document untouched"); check(JSON.stringify(result.renderScene) === JSON.stringify(compileSceneDocument(candidate).renderScene), "live induction ink is deterministic"); }
  for (const mutation of badSources) { const candidate = scene(); Object.assign(candidate.constructions[0]!.inputs, mutation); invalidScenes.push(candidate); }
  for (const candidate of invalidScenes) { const result = compileSceneDocument(candidate); check(!result.ok && result.renderScene === null, `invalid induction authority never emits partial geometry: ${JSON.stringify(result.report.issues)}`); }
}
console.log(`induction operator verification passed (${checks} checks${nodeProcess.argv.includes("--geometry-only") ? ", geometry only" : ""})`);
