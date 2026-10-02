import type { RenderPoint, SceneDocument, SceneIssue } from "../../src/types";
import { FIELD_OPERATORS, evaluateFieldConstruction, fieldConstructionOutputLabels, validateEvaluatedFieldLabels, validateFieldConstruction, type FieldEvaluationContext, type FieldGeometry } from "../../src/compile/fieldGeometry";

const quantities = new Map<string, number>([["source_charge", 10], ["observation_x", 3], ["observation_y", 4], ["arrow_length", 2], ["coefficient", 9e9]]);
const geometries = new Map<string, FieldGeometry>();
const context: FieldEvaluationContext = {
  number(value) {
    if (typeof value === "object" && value !== null && "value" in value) return context.number(value.value);
    const resolved = typeof value === "string" && quantities.has(value) ? quantities.get(value)! : Number(value);
    if (!Number.isFinite(resolved)) throw new Error("not finite");
    return resolved;
  },
  point(value) {
    if (value === "source_position") return { x: 0, y: 0 };
    if (typeof value === "object" && value !== null && "x" in value && "y" in value) {
      return { x: context.number(value.x), y: context.number(value.y) };
    }
    throw new Error("not a point");
  },
  geometry(value) { return typeof value === "string" ? geometries.get(value) : undefined; },
};
let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks += 1;
  if (!condition) throw new Error(message);
}
function close(actual: number, expected: number, message: string, tolerance = 1e-12): void {
  check(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}
function distance(a: RenderPoint, b: RenderPoint): number { return Math.hypot(a.x - b.x, a.y - b.y); }

// A 3-4-5 displacement gives a worked oracle independent of sampled board geometry.
const specimen = evaluateFieldConstruction("electric_field", {
  charges: [{ position: { x: 0, y: 0 }, charge: 10 }],
  at: { x: 3, y: 4 }, mode: "schematic", k: 1, displayLength: 2,
}, context)[0]!;
check(specimen.kind === "path" && specimen.directed, "nonzero point field must be a directed path");
close(specimen.electricField.components.x, 0.24, "analytic point-charge Ex");
close(specimen.electricField.components.y, 0.32, "analytic point-charge Ey");
close(specimen.electricField.magnitude, 0.4, "field magnitude is independent of display length");
close(distance(specimen.points[0]!, specimen.points[1]!), 2, "explicit display length");
close(specimen.points[1]!.x, 4.2, "normalized display direction x");
close(specimen.points[1]!.y, 5.6, "normalized display direction y");
check(specimen.electricField.unit === "normalized", "schematic field must not claim SI magnitude");

function scene(): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "explicit electric field superposition" }, source: {},
    quantities: [{ id: "q", value: 10 }, { id: "x", value: 3 }, { id: "y", value: 4 }],
    entities: [{ id: "source", kind: "point", role: "charge location" }, { id: "field", kind: "vector", role: "resultant electric field" }],
    constructions: [
      { id: "make_source", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["source"] },
      { id: "make_field", operator: "electric_field", inputs: { charges: [{ position: "source", charge: "q" }], at: { x: "x", y: "y" }, mode: "schematic", k: 1, displayLength: 2 }, outputs: ["field"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["source", "field"],
    revealGroups: [{ id: "field_group", entityIds: ["source", "field"], dependsOn: [], narrationCue: "superposition" }], teachingTimeline: [],
  };
}
function validationIssues(document: SceneDocument, index = 1): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const byOutput = new Map(document.constructions.flatMap((construction) => construction.outputs.map((output) => [output, construction] as const)));
  validateFieldConstruction(document.constructions[index]!, index, document, byOutput, issues);
  return issues;
}
check(validationIssues(scene()).length === 0, "source quantities and scalar point coordinates must validate");
const staleLabel = scene();
staleLabel.entities[1]!.label = "E=999 N/C";
check(validationIssues(staleLabel).some((issue) => issue.severity === "fatal"), "model magnitude label cannot pair with computed field");
let forgedReferenceRejected = false;
try {
  evaluateFieldConstruction("field_components", { field: "forged" }, {
    ...context, geometry() { return { ...specimen, electricField: { ...specimen.electricField, magnitude: 999 } }; },
  });
} catch { forgedReferenceRejected = true; }
check(forgedReferenceRejected, "field components must reject inconsistent reference metadata");
let malformedOutputRejected = false;
try { fieldConstructionOutputLabels("electric_field", [{ kind: "path", electricField: specimen.electricField }]); } catch { malformedOutputRejected = true; }
check(malformedOutputRejected, "result labels must reject missing or malformed actual field geometry");
for (const key of ["at", "source"] as const) {
  let projectedRejected = false;
  try {
    evaluateFieldConstruction("electric_field", {
      charges: [{ position: key === "source" ? "projected" : { x: 0, y: 0 }, charge: 10 }],
      at: key === "at" ? "projected" : { x: 7, y: 8 }, mode: "schematic", k: 1, displayLength: 2,
    }, {
      ...context, point() { return { x: 3, y: 4 }; },
      geometry(value) { return value === "projected" ? { kind: "point", point: { x: 3, y: 4 }, space: { x: 3, y: 4, z: 100 }, spaceFrameId: "frame" } : undefined; },
    });
  } catch { projectedRejected = true; }
  check(projectedRejected, "projected 3D positions must not be treated as physical 2D source or observation points");
}
const derivedObservation = scene();
derivedObservation.entities.push({ id: "observation", kind: "point", role: "triangle centroid" });
derivedObservation.requiredEntityIds.push("observation");
derivedObservation.revealGroups[0]!.entityIds.push("observation");
derivedObservation.constructions.push({ id: "centroid", operator: "triangle_center", inputs: { a: { x: 0, y: 0 }, b: { x: 9, y: 0 }, c: { x: 0, y: 12 }, kind: "centroid" }, outputs: ["observation"] });
derivedObservation.constructions[1]!.inputs.at = "observation";
check(validationIssues(derivedObservation).length === 0, "derived point validation must defer positions without inventing coordinates");
derivedObservation.entities[1]!.label = "E=999 N/C";
const derivedLabels: SceneIssue[] = [];
validateEvaluatedFieldLabels(derivedObservation.constructions[1]!, 1, derivedObservation, [specimen], derivedLabels);
check(derivedLabels.some((issue) => issue.severity === "fatal"), "derived-point field must reject stale labels after evaluation");

const base = { mode: "schematic", k: 1, displayLength: 2 };
function field(inputs: Record<string, unknown>): FieldGeometry {
  const result = evaluateFieldConstruction("electric_field", { ...base, ...inputs }, context);
  check(result.length === 1, "electric field arity");
  return result[0]!;
}
function rejects(operator: string, inputs: Record<string, unknown>, message: string): void {
  let threw = false;
  try { evaluateFieldConstruction(operator, inputs, context); } catch { threw = true; }
  check(threw, message);
}
const dipole = [{ position: { x: -1, y: 0 }, charge: 1 }, { position: { x: 1, y: 0 }, charge: -1 }];
const axial = field({ charges: dipole, at: { x: 2, y: 0 } });
close(axial.electricField.components.x, -8 / 9, "dipole axial oracle");
close(axial.electricField.components.y, 0, "dipole axial transverse component");
check(axial.kind === "path" && axial.points[1]!.x < axial.points[0]!.x, "negative charge reverses axial direction");
const equatorial = field({ charges: dipole, at: { x: 0, y: 2 } });
close(equatorial.electricField.components.x, 2 / (5 * Math.sqrt(5)), "dipole equatorial oracle");
close(equatorial.electricField.components.y, 0, "equal-radius transverse cancellation");
const cancelled = field({ charges: dipole.map((source) => ({ ...source, charge: 1 })), at: { x: 0, y: 0 } });
check(cancelled.kind === "point" && cancelled.electricField.zero && cancelled.electricField.direction === null, "equal charges at midpoint must have a null marker without arbitrary direction");
check(fieldConstructionOutputLabels("electric_field", [cancelled])[0] === "E=0 schematic", "zero marker label");
const balancedRing = field({ charges: [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y]) => ({ position: { x, y }, charge: 3 })), at: { x: 0, y: 0 } });
check(balancedRing.electricField.zero, "multi-source same-radius cancellation must be certified");
const almostCancelled = field({ charges: [{ position: { x: -1, y: 0 }, charge: 1 }, { position: { x: 1, y: 0 }, charge: 1 + 2 ** -40 }], at: { x: 0, y: 0 } });
check(almostCancelled.kind === "path" && !almostCancelled.electricField.zero && almostCancelled.electricField.components.x < 0, "resolvable near cancellation must remain nonzero");
rejects("electric_field", { ...base, charges: [{ position: { x: -1, y: 0 }, charge: 1 }, { position: { x: 1, y: 0 }, charge: 1 + 2 ** -50 }], at: { x: 0, y: 0 } }, "unresolved near cancellation must fail closed instead of claiming exact zero");

const asymmetricalSources = [{ position: { x: 0, y: 0 }, charge: 10 }, { position: { x: 6, y: 8 }, charge: -5 }, { position: { x: 3, y: 0 }, charge: 16 }];
const asymmetric = field({ charges: asymmetricalSources, at: { x: 3, y: 4 } });
close(asymmetric.electricField.components.x, 0.36, "three-charge nonsymmetric x oracle");
close(asymmetric.electricField.components.y, 1.48, "three-charge nonsymmetric y oracle");
close(asymmetric.electricField.magnitude, Math.sqrt(2.32), "nonsymmetric resultant oracle");
for (const shift of [{ x: 19, y: -7 }, { x: -2, y: 50 }]) {
  const translated = field({ charges: asymmetricalSources.map((source) => ({ ...source, position: { x: source.position.x + shift.x, y: source.position.y + shift.y } })), at: { x: 3 + shift.x, y: 4 + shift.y } });
  close(translated.electricField.components.x, 0.36, "translation leaves Ex unchanged");
  close(translated.electricField.components.y, 1.48, "translation leaves Ey unchanged");
}
for (const angle of [Math.PI / 2, 0.7, -1.3]) {
  const rotate = (point: RenderPoint): RenderPoint => ({ x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) });
  const rotated = field({ charges: asymmetricalSources.map((source) => ({ ...source, position: rotate(source.position) })), at: rotate({ x: 3, y: 4 }) });
  const expected = rotate({ x: 0.36, y: 1.48 });
  close(rotated.electricField.components.x, expected.x, "field rotates as a vector x");
  close(rotated.electricField.components.y, expected.y, "field rotates as a vector y");
}
for (const scale of [0.001, 7, 1e6]) {
  const scaled = field({ charges: asymmetricalSources.map((source) => ({ ...source, position: { x: source.position.x * scale, y: source.position.y * scale } })), at: { x: 3 * scale, y: 4 * scale }, displayLength: 2 * scale });
  close(scaled.electricField.components.x, 0.36 / scale ** 2, "inverse-square coordinate scale x");
  close(scaled.electricField.components.y, 1.48 / scale ** 2, "inverse-square coordinate scale y");
  check(scaled.kind === "path", "scaled nonzero field remains a path");
  close(distance(scaled.points[0]!, scaled.points[1]!), 2 * scale, "display scale remains separate");
}
for (const order of [[2, 0, 1], [1, 2, 0], [2, 1, 0]]) {
  const permuted = field({ charges: order.map((index) => asymmetricalSources[index]!), at: { x: 3, y: 4 } });
  check(JSON.stringify(permuted.electricField.components) === JSON.stringify(asymmetric.electricField.components), "superposition numeric result must be permutation deterministic");
}
const referenced = field({ charges: [{ position: "source_position", charge: { value: "source_charge" } }], at: { x: "observation_x", y: { value: "observation_y" } }, displayLength: "arrow_length" });
check(JSON.stringify(referenced) === JSON.stringify(specimen), "numeric strings, wrappers, point refs, and quantity refs must preserve geometry");
const si = field({ charges: [{ position: { x: 0, y: 0 }, charge: 10 }], at: { x: 3, y: 4 }, mode: "si", k: "coefficient", lengthUnit: "cm", chargeUnit: "nC" });
close(si.electricField.components.x, 21600, "SI conversion from nC and cm x");
close(si.electricField.components.y, 28800, "SI conversion from nC and cm y");
close(si.electricField.magnitude, 36000, "SI converted field magnitude");
check(si.electricField.unit === "N/C", "SI metadata unit");
const dielectric = field({ charges: [{ position: { x: 0, y: 0 }, charge: 10 }], at: { x: 3, y: 4 }, mode: "si", k: 4.5e9, lengthUnit: "cm", chargeUnit: "nC" });
close(dielectric.electricField.magnitude, 18000, "explicit medium Coulomb coefficient remains authority");
geometries.set("specimen", specimen);
const components = evaluateFieldConstruction("field_components", { field: "specimen" }, context);
check(components.length === 2, "field component arity");
for (const [index, component] of components.entries()) {
  const axis = index === 0 ? "x" : "y";
  check(component.kind === "path" && component.directed && component.electricField.component === axis, "component identity must be retained");
  close(component.points[1]![axis] - component.points[0]![axis], index === 0 ? 1.2 : 1.6, "component uses resultant's display scale");
  close(component.points[1]![axis === "x" ? "y" : "x"] - component.points[0]![axis === "x" ? "y" : "x"], 0, "axis component cannot drift into the other axis");
}
geometries.set("axial", axial);
check(evaluateFieldConstruction("field_components", { field: "axial" }, context)[1]!.kind === "point", "null transverse component must be a point marker");
for (const output of [specimen, si, cancelled, almostCancelled]) check(fieldConstructionOutputLabels("electric_field", [output])[0]!.length <= 16, "derived field label must remain compact");
check(fieldConstructionOutputLabels("field_components", components).every((label) => label.length <= 16), "component labels compact");
check(FIELD_OPERATORS.length === 2, "public field operator inventory");

const validInputs = { ...base, charges: [{ position: { x: 0, y: 0 }, charge: 1 }], at: { x: 1, y: 2 } };
const invalidInputs: Array<Record<string, unknown>> = [
  { charges: [] }, { charges: Array.from({ length: 33 }, () => ({ position: { x: 0, y: 0 }, charge: 1 })) }, { charges: [null] },
  { charges: [{ position: { x: 0, y: 0 }, charge: 1, field: 99 }] }, { charges: [{ position: { x: 0, y: 0 } }] },
  { charges: [{ position: { x: 1, y: 2 }, charge: 1 }] }, { at: { x: NaN, y: 0 } }, { at: { x: Infinity, y: 0 } },
  { at: { x: 0, y: 1, z: 1 } }, { at: [0, 1, 2] }, { at: true }, { at: "unknown_point" },
  { charges: [{ position: { x: 0, y: 0 }, charge: Infinity }] }, { charges: [{ position: { x: 0, y: 0 }, charge: null }] },
  { mode: undefined }, { mode: "physical" }, { k: 0 }, { k: -1 }, { k: 9e9 }, { k: true }, { k: Infinity }, { k: "" },
  { displayLength: 0 }, { displayLength: -1 }, { displayLength: Infinity }, { displayLength: " " },
  { fieldMagnitude: 99 }, { mode: "si", k: 9e9 }, { mode: "si", k: 9e9, lengthUnit: "s", chargeUnit: "C" },
  { mode: "si", k: 9e9, lengthUnit: "m", chargeUnit: "MC" },
  { mode: "si", k: { value: 9e9, unit: "C" }, lengthUnit: "m", chargeUnit: "C" },
  { charges: [{ position: { x: 0, y: 0 }, charge: { value: 1, unit: "kg" } }] },
  { at: { x: { value: 1, unit: "cm" }, y: 2 }, lengthUnit: "m" },
  { charges: [{ position: { x: 0, y: 0 }, charge: Number.MIN_VALUE }], at: { x: 1e100, y: 0 } },
  { charges: [{ position: { x: 0, y: 0 }, charge: 1 }], at: { x: Number.MIN_VALUE, y: 0 } },
  { at: { x: 1e300, y: 0 }, displayLength: 1e-100 },
];
for (const mutation of invalidInputs) rejects("electric_field", { ...validInputs, ...mutation }, `malformed field must fail: ${JSON.stringify(mutation)}`);
for (const inputs of [{ field: "missing" }, { field: null }, { field: "specimen", x: 0 }]) rejects("field_components", inputs, "bad component reference contract must fail");
const knownUnits = scene();
knownUnits.quantities = [{ id: "q", value: 10, unit: "nC" }, { id: "x", value: 3, unit: "cm" }, { id: "y", value: 4, unit: "centimetre" }];
Object.assign(knownUnits.constructions[1]!.inputs, { mode: "si", k: { value: 9e9, unit: "N*m^2/C^2" }, lengthUnit: "cm", chargeUnit: "nC" });
check(validationIssues(knownUnits).length === 0, "known source units with compatible aliases must validate");
for (const [quantityId, unit] of [["q", "mC"], ["x", "m"], ["y", "s"]]) {
  const inconsistent = structuredClone(knownUnits);
  inconsistent.quantities.find((quantity) => quantity.id === quantityId)!.unit = unit;
  check(validationIssues(inconsistent).some((issue) => issue.severity === "fatal"), "mixed source quantity units must be rejected");
}
const override = structuredClone(knownUnits);
override.constructions[1]!.inputs.charges = [{ position: "source", charge: { value: "q", unit: "C" } }];
check(validationIssues(override).some((issue) => issue.severity === "fatal"), "outer unit wrapper cannot reinterpret inner quantity units");
const cyclic = scene();
cyclic.quantities[0]!.value = "q";
check(validationIssues(cyclic).some((issue) => issue.severity === "fatal"), "cyclic quantity references must fail closed");
const badAnnotation = scene();
badAnnotation.annotations.push({ id: "false_magnitude", kind: "label", targetIds: ["field"], quantityId: "q", text: "E=10" });
check(validationIssues(badAnnotation).some((issue) => issue.severity === "fatal"), "independent annotation cannot override computed field result");
for (const [label, charge] of [["+q", -10], ["-q", 10], ["−q", 10]] as const) {
  const falseSource = scene();
  falseSource.entities[0]!.label = label;
  falseSource.quantities[0]!.value = charge;
  check(validationIssues(falseSource).some((issue) => issue.severity === "fatal"), "source charge label must not contradict the actual supplied sign");
}
for (const label of ["A", "B", "Q1", "+q", "+q1"]) {
  const namedSource = scene();
  namedSource.entities[0]!.label = label;
  check(validationIssues(namedSource).length === 0, "ordinary source point names and consistent positive-charge labels remain valid");
}
const wrongSourceBinding = structuredClone(knownUnits);
wrongSourceBinding.quantities.push({ id: "other_charge", value: 20, unit: "nC" });
wrongSourceBinding.annotations.push({ id: "wrong_source_binding", kind: "label", targetIds: ["source"], quantityId: "other_charge" });
check(validationIssues(wrongSourceBinding).some((issue) => issue.severity === "fatal"), "source annotations cannot bind a different explicit charge quantity");
const wrongSourceUnit = structuredClone(knownUnits);
wrongSourceUnit.constructions[1]!.inputs.charges = [{ position: "source", charge: 10 }];
wrongSourceUnit.quantities.push({ id: "other_charge", value: 10, unit: "µC" });
wrongSourceUnit.annotations.push({ id: "wrong_source_scale", kind: "label", targetIds: ["source"], quantityId: "other_charge" });
check(validationIssues(wrongSourceUnit).some((issue) => issue.severity === "fatal"), "equal literal numbers with different charge scales must not form a source annotation binding");
const derivedSourceUnit = structuredClone(knownUnits);
derivedSourceUnit.entities.push({ id: "conic", kind: "polyline", role: "conic definition" }, { id: "focus", kind: "point", role: "charge position" });
derivedSourceUnit.constructions.push(
  { id: "make_conic", operator: "conic", inputs: { kind: "ellipse", center: "source", a: { value: 5, unit: "cm" }, b: { value: 3, unit: "cm" } }, outputs: ["conic"] },
  { id: "make_focus", operator: "conic_anchor", inputs: { conic: "conic", feature: "focus", side: 1 }, outputs: ["focus"] },
);
Object.assign(derivedSourceUnit.constructions[1]!.inputs, { charges: [{ position: "focus", charge: "q" }], at: { x: 7, y: 4 }, lengthUnit: "m" });
check(validationIssues(derivedSourceUnit).some((issue) => issue.severity === "fatal"), "known length scales inherited through derived source geometry must not be silently reinterpreted");
derivedSourceUnit.constructions[1]!.inputs.lengthUnit = "cm";
check(validationIssues(derivedSourceUnit).length === 0, `compatible inherited derived-source length unit must validate: ${JSON.stringify(validationIssues(derivedSourceUnit))}`);
const missingOutputs = scene();
Reflect.deleteProperty(missingOutputs.constructions[1]!, "outputs");
const noOutputIssues: SceneIssue[] = [];
validateFieldConstruction(missingOutputs.constructions[1]!, 1, missingOutputs, new Map([["source", missingOutputs.constructions[0]!]]), noOutputIssues);
check(noOutputIssues.some((issue) => issue.code === "invalid_electric_field_outputs"), "missing output list must fail without throwing");

if (!process.argv.includes("--geometry-only")) {
  const { compileSceneDocument, validateSceneDocument } = await import("../../src/index");
  for (const candidate of [scene(), derivedObservation, knownUnits]) {
    candidate.entities.find((entity) => entity.id === "field")!.label = undefined;
    const original = JSON.stringify(candidate);
    const validated = validateSceneDocument(candidate);
    check(validated.document, `field scene structural failure: ${JSON.stringify(validated.report.issues)}`);
    const compiled = compileSceneDocument(candidate);
    check(compiled.ok && compiled.renderScene, `field scene compile failure: ${JSON.stringify(compiled.report.issues)}`);
    check(compiled.renderScene.primitives.some((primitive) => primitive.entityId === "field" && primitive.kind === "vector"), "field must render a directed vector");
    check(compiled.renderScene.primitives.some((primitive) => primitive.entityId === "field" && primitive.kind === "label" && primitive.text?.startsWith("E")), "engine must derive rendered field labels");
    check(JSON.stringify(candidate) === original, "field compilation must not mutate its input document");
    check(JSON.stringify(compileSceneDocument(candidate).renderScene) === JSON.stringify(compiled.renderScene), "compiled field must be deterministic");
  }
  const conicSource = scene();
  conicSource.entities.push({ id: "ellipse", kind: "polyline", role: "conic" }, { id: "focus", kind: "point", role: "source charge position" });
  conicSource.requiredEntityIds.push("ellipse", "focus");
  conicSource.revealGroups[0]!.entityIds.push("ellipse", "focus");
  conicSource.constructions.push(
    { id: "ellipse_definition", operator: "conic", inputs: { center: "source", kind: "ellipse", a: 5, b: 3 }, outputs: ["ellipse"] },
    { id: "focus_definition", operator: "conic_anchor", inputs: { conic: "ellipse", feature: "focus", side: 1 }, outputs: ["focus"] },
  );
  conicSource.constructions[1]!.inputs.charges = [{ position: "focus", charge: "q" }];
  conicSource.constructions[1]!.inputs.at = { x: 7, y: 4 };
  const conicCompiled = compileSceneDocument(conicSource);
  check(conicCompiled.ok && conicCompiled.renderScene, `conic charge position must compile: ${JSON.stringify(conicCompiled.report.issues)}`);
  for (const candidate of [derivedObservation, conicSource]) {
    candidate.entities[1]!.label = "E=999 N/C";
    const result = compileSceneDocument(candidate);
    check(!result.ok && result.renderScene === null, "derived source/observation stale label must reject the complete scene");
  }
  for (const mutation of invalidInputs) {
    const candidate = scene();
    Object.assign(candidate.constructions[1]!.inputs, validInputs, mutation);
    const result = compileSceneDocument(candidate);
    check(!result.ok && result.renderScene === null, `malformed field cannot render partial geometry: ${JSON.stringify(mutation)}; ${JSON.stringify(result.report.issues)}`);
  }
  const nullScene = scene();
  nullScene.constructions[1]!.inputs.charges = dipole.map((source) => ({ ...source, charge: 1 }));
  nullScene.constructions[1]!.inputs.at = { x: 0, y: 0 };
  nullScene.constructions[0]!.inputs = { x: -1, y: 0 };
  const nullResult = compileSceneDocument(nullScene);
  check(nullResult.ok && nullResult.renderScene, `certified null field scene must compile: ${JSON.stringify(nullResult.report.issues)}`);
  check(nullResult.renderScene.primitives.some((primitive) => primitive.entityId === "field" && primitive.kind === "point"), "null field must render an honest point marker");
  check(!nullResult.renderScene.primitives.some((primitive) => primitive.entityId === "field" && primitive.kind === "vector"), "null field cannot render an arbitrary vector");
}
console.log(`field operator verification passed (${checks} checks${process.argv.includes("--geometry-only") ? ", geometry only" : ""})`);
