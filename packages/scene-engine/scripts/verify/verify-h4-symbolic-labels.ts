import assert from "node:assert/strict";
import type { SceneDocument, SceneIssue } from "../../src/types";
import { withEvaluatedOutputLabels } from "../../src/compile/outputLabels";
import { evaluateDipoleFieldConstruction, dipoleConstructionOutputLabels } from "../../src/compile/dipoleFieldGeometry";
import { evaluateGeometricOpticsConstruction } from "../../src/compile/geometricOpticsGeometry";
import { evaluateFieldConstruction } from "../../src/compile/fieldGeometry";
import { evaluateWavesConstruction } from "../../src/compile/wavesGeometry";
import { representativeOutputLabel } from "../../src/compile/symbolicOutputLabels";
import { compileSceneDocument } from "../../src/compile/compiler";

let checks = 0;
const failures: string[] = [];
function check(condition: unknown, message: string): void { checks++; if (!condition) failures.push(message); }
const context = {
  number: (value: unknown): number => Number(value),
  point(value: unknown): { x: number; y: number } {
    if (Array.isArray(value)) return { x: Number(value[0]), y: Number(value[1]) };
    return value as { x: number; y: number };
  }, geometry: () => undefined,
};
const optics = { kind: "lens", center: [0, 0], axis: [1, 0], focalLength: 2, displayScale: 1 };
const cases = [
  { operator: "optical_focus", inputs: optics, evaluate: evaluateGeometricOpticsConstruction, symbols: ["F1", "F2"] },
  { operator: "gaussian_image", inputs: { ...optics, objectDistance: -6, objectHeight: 1 }, evaluate: evaluateGeometricOpticsConstruction, symbols: ["u", "h_o", "v", "h_i"] },
  { operator: "point_charge_field", inputs: { charge: { position: [0, 0], charge: 1 }, at: [2, 0], k: 1, displayLength: 1 }, evaluate: evaluateDipoleFieldConstruction, symbols: ["E1"] },
  { operator: "equipotential", inputs: { source: "point_charge", charge: { position: [0, 0], charge: 1 }, V: 0.5, k: 1 }, evaluate: evaluateDipoleFieldConstruction, symbols: ["V"] },
  { operator: "field_lines", inputs: { charges: [{ id: "q", position: [0, 0], charge: 1 }], starts: [[0.15, 0]], stepLength: 0.1, stepCount: 8, exclusionRadius: 0.1, k: 1 }, evaluate: evaluateDipoleFieldConstruction, symbols: ["E"] },
  { operator: "coulomb_pair", inputs: { charges: [{ position: [0, 0], charge: 1 }, { position: [2, 0], charge: -1 }], k: 1, displayLength: 1 }, evaluate: evaluateDipoleFieldConstruction, symbols: ["F1", "F2"] },
  { operator: "dipole_torque", inputs: { p: [1, 0], E: [0, 1], at: [0, 0], displayLength: 0.4 }, evaluate: evaluateDipoleFieldConstruction, symbols: ["τ"] },
  { operator: "electric_field", inputs: { charges: [{ position: [0, 0], charge: 1e-6 }], at: [2, 0], k: 9e9, displayLength: 1, mode: "si", lengthUnit: "m", chargeUnit: "C" }, evaluate: evaluateFieldConstruction, symbols: ["E1"] },
  { operator: "harmonic_wave", inputs: { amplitude: 1, waveNumber: 1, angularFrequency: 1, phase: 0, phaseUnit: "rad", time: 0, xMin: 0, xMax: 6 }, evaluate: evaluateWavesConstruction, symbols: ["y1(x)"] },
] as const;
function document(operator: string, inputs: Record<string, unknown>, symbols: readonly string[]): SceneDocument {
  const ids = symbols.map((_, i) => `output_${i}`);
  return { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "symbolic representative" },
    source: { nonMetric: true, representationTier: "qualitative_verified" }, quantities: [],
    entities: ids.map((id, i) => ({ id, kind: "vector", label: symbols[i] })),
    constructions: [{ id: "make", operator, inputs, outputs: ids }], relations: [], assertions: [], annotations: [],
    requiredEntityIds: ids, revealGroups: [{ id: "show", entityIds: ids, dependsOn: [] }], teachingTimeline: [] };
}
for (const item of cases) {
  const outputs = item.evaluate(item.operator, item.inputs, context);
  const scene = document(item.operator, item.inputs, item.symbols);
  const issues: SceneIssue[] = [];
  const labelled = withEvaluatedOutputLabels(scene.constructions[0]!, 0, item.inputs, outputs, scene, context, issues, new Set());
  check(issues.length === 0, `${item.operator}: symbolic identities accepted: ${JSON.stringify(issues)}`);
  check(labelled.entities.every((entity, i) => entity.label === item.symbols[i]), `${item.operator}: retain symbols without representative numbers`);
  const bad = structuredClone(scene); bad.entities[0]!.label = item.operator === "optical_focus" || item.operator === "gaussian_image" ? "f=999" : item.operator === "dipole_torque" ? "τ=999" : "E=999";
  const badIssues: SceneIssue[] = [];
  withEvaluatedOutputLabels(bad.constructions[0]!, 0, item.inputs, outputs, bad, context, badIssues, new Set());
  check(badIssues.length > 0, `${item.operator}: symbolic mode cannot hide false numeric ink`);
}
const tiny = evaluateDipoleFieldConstruction("dipole_torque", { p: [1e-12, 0], E: [0, 2], at: [0, 0], displayLength: 0.4 }, context);
check(!/^tau=0(?:\D|$)/.test(dipoleConstructionOutputLabels("dipole_torque", tiny)[0]!), "nonzero SI torque must not print zero");
const numerical = document("optical_focus", optics, ["F1", "F2"]); numerical.source = {};
const numbered = withEvaluatedOutputLabels(numerical.constructions[0]!, 0, optics, evaluateGeometricOpticsConstruction("optical_focus", optics, context), numerical, context, [], new Set());
check(numbered.entities[0]!.label?.includes("="), "numeric scenes keep derived scalar labels");
const sourced = document("optical_focus", optics, ["F1", "F2"]); sourced.quantities.push({ id: "f", value: 2, unit: "m" });
const sourcedLabels = withEvaluatedOutputLabels(sourced.constructions[0]!, 0, optics, evaluateGeometricOpticsConstruction("optical_focus", optics, context), sourced, context, [], new Set());
check(sourcedLabels.entities[0]!.label?.includes("="), "a nonmetric flag cannot suppress source quantities");
check(representativeOutputLabel("count=8", "n", { setPartition: {} }) === "count=8", "discrete count labels are not representative physical parameters");
const realField = document("electric_field", cases[7].inputs, ["E1"]);
const fieldRender = compileSceneDocument(realField);
check(fieldRender.ok && fieldRender.renderScene?.primitives.some((mark) => mark.kind === "label" && mark.text === "E1"), `full compile retains symbolic field identity: ${JSON.stringify(fieldRender.report.issues)}`);
const realWave = document("harmonic_wave", cases[8].inputs, ["y1(x)"]); realWave.entities[0]!.kind = "polyline";
const waveRender = compileSceneDocument(realWave);
check(waveRender.ok && waveRender.renderScene?.primitives.some((mark) => mark.kind === "label" && mark.text === "y1(x)"), `full compile retains distinct symbolic wave identity: ${JSON.stringify(waveRender.report.issues)}`);
console.log(`H4 symbolic labels: ${checks - failures.length}/${checks} passed`);
assert.equal(failures.length, 0, failures.join("\n"));
