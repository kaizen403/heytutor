import assert from "node:assert/strict";
import { validateEvaluatedDerivedValueLabels } from "../../src/compile/derivedValueLabels";
import { evaluateKinematicsConstruction } from "../../src/compile/kinematicsGeometry";
import { evaluateVectorConstruction } from "../../src/compile/vectorGeometry";
import { evaluateCalculusConstruction } from "../../src/compile/calculusGeometry";
import type { SceneDocument, SceneIssue } from "../../src/types";

const geometries = new Map<string, unknown>();
const context = { number: (value: unknown): number => Number(value), point: () => ({ x: 0, y: 0 }), geometry: (value: unknown): unknown => geometries.get(String(value)) };
const trajectoryInputs = { initialPosition: [7, -3], initialVelocity: [3, 4], acceleration: [0, 0], tMin: 0, tMax: 2, samples: 5, units: { length: "m", time: "s" } };
const trajectory = evaluateKinematicsConstruction("constant_acceleration_trajectory", trajectoryInputs, context)[0]!;
geometries.set("trajectory", trajectory);
const velocityInputs = { trajectory: "trajectory", time: 1, kind: "velocity", timeScale: 8 };
const velocity = evaluateKinematicsConstruction("trajectory_state", velocityInputs, context)[0]!;
function documentFor(operator: string, inputs: Record<string, unknown>, kind = "vector"): SceneDocument {
  return { schemaVersion: "scene-document/v2", source: {}, visualDecision: { mode: "scene", reason: "computed source values" }, quantities: [],
    entities: [{ id: "result", kind, role: "derived mathematical result" }], constructions: [{ id: "construct_result", operator, inputs, outputs: ["result"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["result"], revealGroups: [{ id: "setup", entityIds: ["result"], dependsOn: [], narrationCue: "show computed result" }], teachingTimeline: [] };
}
let checks = 0;
function issuesFor(scene: SceneDocument, output: unknown): SceneIssue[] {
  const issues: SceneIssue[] = []; validateEvaluatedDerivedValueLabels(scene.constructions[0]!, 0, scene, [output], issues); return issues;
}
function label(operator: string, inputs: Record<string, unknown>, output: unknown, text: string, valid: boolean, kind = "vector"): void {
  const scene = documentFor(operator, inputs, kind); scene.entities[0]!.label = text; const issues = issuesFor(scene, output); checks++;
  assert.equal(!issues.some((issue) => issue.severity === "fatal"), valid, `${text}: ${JSON.stringify(issues)}`);
}
label("trajectory_state", velocityInputs, velocity, "v=999 m/s", false);
for (const text of ["v(t)", "P(t)", "a+b", "dC/dt", "A1", "v=5 m/s", "vx=3 m/s", "vy=400 cm/s", "v=(3,4) m/s", "|v|=5 m/s"]) label("trajectory_state", velocityInputs, velocity, text, true);
for (const text of ["v=40 m/s", "vx=4 m/s", "v=(4,3) m/s", "v=5 m", "v=NaN", "v=Infinity", "NaN", "Infinity", "v=(3,4] m/s", "value=3 m/s", "(4,3)"]) label("trajectory_state", velocityInputs, velocity, text, false);
const sourceQuantity = documentFor("trajectory_state", velocityInputs); sourceQuantity.quantities = [{ id: "given_g", symbol: "g", value: 9.8, unit: "m/s^2" }]; sourceQuantity.entities[0]!.label = "g=9.8 m/s^2";
assert.deepEqual(issuesFor(sourceQuantity, velocity), []); checks++;
sourceQuantity.quantities.push({ id: "given_length", symbol: "L", value: 250, unit: "cm" }); sourceQuantity.entities[0]!.label = "L=2.5 m"; assert.deepEqual(issuesFor(sourceQuantity, velocity), []); checks++;
sourceQuantity.entities[0]!.label = "L=250 m"; assert(issuesFor(sourceQuantity, velocity).some((issue) => issue.severity === "fatal")); checks++;
for (const kind of ["label", "callout", "badge"]) {
  const scene = documentFor("trajectory_state", velocityInputs); scene.annotations.push({ id: `wrong_${kind}`, kind, targetIds: ["result"], text: "v=999 m/s" }); assert(issuesFor(scene, velocity).some((issue) => issue.severity === "fatal")); checks++;
}
for (const [symbol, value, unit, valid] of [["v", 5, "m/s", true], ["vx", 300, "cm/s", true], ["v", 40, "m/s", false], ["v", 5, "m", false], [undefined, 3, "m/s", false]] as const) {
  const scene = documentFor("trajectory_state", velocityInputs); scene.quantities.push({ id: "q", symbol, value, unit }); scene.annotations.push({ id: "quantity_claim", kind: "label", targetIds: ["result"], quantityId: "q" });
  assert.equal(!issuesFor(scene, velocity).some((issue) => issue.severity === "fatal"), valid); checks++;
}
const positionInputs = { trajectory: "trajectory", time: 1, kind: "position" }; const position = evaluateKinematicsConstruction("trajectory_state", positionInputs, context)[0]!;
for (const text of ["x=10 m", "y=1 m", "P=(10,1) m", "t=1 s"]) label("trajectory_state", positionInputs, position, text, true, "point");
for (const text of ["x=7 m", "P=(10,-1) m", "t=8 s"]) label("trajectory_state", positionInputs, position, text, false, "point");
// Conversions follow the physical declarations, not arrow lengths or placements.
for (const [length, time, speedSI] of [["cm", "ms", 50], ["km", "h", 5 / 3.6], ["ft", "s", 1.524]] as const) {
  const model = evaluateKinematicsConstruction("constant_acceleration_trajectory", { ...trajectoryInputs, units: { length, time } }, context)[0]!; geometries.set("converted", model);
  for (const timeScale of [0.2, 1, 20]) {
    const inputs = { ...velocityInputs, trajectory: "converted", timeScale }; const output = evaluateKinematicsConstruction("trajectory_state", inputs, context)[0]!;
    label("trajectory_state", inputs, output, `v=${speedSI} m/s`, true); label("trajectory_state", inputs, output, `v=${speedSI * 2} m/s`, false);
  }
}
const rest = evaluateKinematicsConstruction("trajectory_state", { trajectory: "trajectory", time: 1, kind: "acceleration", timeScale: 20 }, context)[0]!;
const milliTrajectory = evaluateKinematicsConstruction("constant_acceleration_trajectory", { ...trajectoryInputs, units: { length: "mm", time: "ms" } }, context)[0]!; geometries.set("milli", milliTrajectory);
const milliInputs = { ...velocityInputs, trajectory: "milli" }; const milliVelocity = evaluateKinematicsConstruction("trajectory_state", milliInputs, context)[0]!;
label("trajectory_state", milliInputs, milliVelocity, "v=5 mm/ms", true);
label("trajectory_state", milliInputs, milliVelocity, "v=5 Mm/ms", false);
label("trajectory_state", milliInputs, milliVelocity, "v=5 mm/Ms", false);
label("trajectory_state", { trajectory: "trajectory", time: 1, kind: "acceleration", timeScale: 20 }, rest, "|a|=0 m/s^2", true);
label("trajectory_state", { trajectory: "trajectory", time: 1, kind: "acceleration", timeScale: 20 }, rest, "|a|=1e-20 m/s^2", false);
label("trajectory_state", { trajectory: "trajectory", time: 1, kind: "acceleration", timeScale: 20 }, rest, "|a|=1e-400 m/s^2", false);
const underflowAnnotation = documentFor("trajectory_state", { trajectory: "trajectory", time: 1, kind: "acceleration", timeScale: 20 }); underflowAnnotation.quantities = [{ id: "tiny_a", symbol: "|a|", value: "1e-400", unit: "m/s^2" }]; underflowAnnotation.annotations.push({ id: "tiny_claim", kind: "label", targetIds: ["result"], quantityId: "tiny_a" });
assert(issuesFor(underflowAnnotation, rest).some((issue) => issue.severity === "fatal")); checks++;
label("trajectory_state", velocityInputs, velocity, "v=5 METERS/SECOND", true);
label("trajectory_state", velocityInputs, velocity, "v≈5.0 m/s", true); label("trajectory_state", velocityInputs, velocity, "v≈0 m/s", false);
const tinyInputs = { ...trajectoryInputs, initialPosition: [1e-320, 0], units: { length: "nm", time: "s" } }; const tinyTrajectory = evaluateKinematicsConstruction("constant_acceleration_trajectory", tinyInputs, context)[0]!;
label("constant_acceleration_trajectory", tinyInputs, tinyTrajectory, "x0=2e-320 nm", false, "polyline");
label("constant_acceleration_trajectory", tinyInputs, tinyTrajectory, "x0=1e-320 nm", true, "polyline");
label("constant_acceleration_trajectory", trajectoryInputs, trajectory, "ay=1e-320 nm/s^2", false, "polyline");
for (const value of [1e-320, 2e-320]) {
  const scene = documentFor("constant_acceleration_trajectory", tinyInputs, "polyline"); scene.quantities = [{ id: "tiny_x", symbol: "x0", value, unit: "nm" }]; scene.annotations.push({ id: "tiny_claim", kind: "label", targetIds: ["result"], quantityId: "tiny_x" });
  assert.equal(!issuesFor(scene, tinyTrajectory).some((issue) => issue.severity === "fatal"), value === 1e-320, "tiny annotation must compare the actual source values"); checks++;
}
geometries.set("a", { kind: "path", directed: true, points: [{ x: 0, y: 0 }, { x: 3, y: 0 }] });
geometries.set("b", { kind: "path", directed: true, points: [{ x: 0, y: 0 }, { x: 0, y: 4 }] });
const vectorInputs = { vectors: ["a", "b"], origin: [0, 0] }; const vector = evaluateVectorConstruction("vector_sum", vectorInputs, context)[0]!;
for (const text of ["a+b", "r=(3,4)", "|r|=5", "x=3", "y=4"]) label("vector_sum", vectorInputs, vector, text, true);
for (const text of ["r=(4,3)", "|r|=999", "r=3", "|r|=5 N"]) label("vector_sum", vectorInputs, vector, text, false);
for (const declaredUnit of ["N", "N*m", "m/s", "cm"]) {
  const scene = documentFor("vector_sum", vectorInputs); scene.quantities = [{ id: "qx", value: 3, unit: declaredUnit }, { id: "qy", value: 4, unit: declaredUnit }];
  scene.constructions.push({ id: "make_start", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["start"] }, { id: "make_x", operator: "point", inputs: { x: "qx", y: 0 }, outputs: ["tip_x"] }, { id: "make_y", operator: "point", inputs: { x: 0, y: "qy" }, outputs: ["tip_y"] }, { id: "make_a", operator: "vector", inputs: { start: "start", end: "tip_x" }, outputs: ["a"] }, { id: "make_b", operator: "vector", inputs: { start: "start", end: "tip_y" }, outputs: ["b"] });
  scene.entities[0]!.label = `|r|=5 ${declaredUnit}`; assert.deepEqual(issuesFor(scene, vector), []); checks++;
  scene.entities[0]!.label = `|r|=6 ${declaredUnit}`; assert(issuesFor(scene, vector).some((issue) => issue.severity === "fatal")); checks++;
  if (declaredUnit === "cm") { scene.entities[0]!.label = "|r|=0.05 m"; assert.deepEqual(issuesFor(scene, vector), []); checks++; }
  scene.entities[0]!.label = "a+b"; scene.quantities.push({ id: "result_value", symbol: "|r|", value: declaredUnit === "cm" ? 0.05 : 5, unit: declaredUnit === "cm" ? "m" : declaredUnit }); scene.annotations.push({ id: "exact_vector_value", kind: "label", targetIds: ["result"], quantityId: "result_value" }); assert.deepEqual(issuesFor(scene, vector), []); checks++;
}
const temporalModel = evaluateKinematicsConstruction("constant_acceleration_trajectory", { ...trajectoryInputs, units: { length: "unit", time: "s" } }, context)[0]!; geometries.set("temporal", temporalModel);
const temporalInputs = { ...velocityInputs, trajectory: "temporal" }; const temporalVelocity = evaluateKinematicsConstruction("trajectory_state", temporalInputs, context)[0]!;
label("trajectory_state", temporalInputs, temporalVelocity, "v=5 1/s", true); label("trajectory_state", temporalInputs, temporalVelocity, "v=5 1", false);
const lengthModel = evaluateKinematicsConstruction("constant_acceleration_trajectory", { ...trajectoryInputs, units: { length: "m", time: "unit" } }, context)[0]!; geometries.set("length_only", lengthModel);
const lengthInputs = { ...velocityInputs, trajectory: "length_only" }; const lengthVelocity = evaluateKinematicsConstruction("trajectory_state", lengthInputs, context)[0]!;
label("trajectory_state", lengthInputs, lengthVelocity, "v=5 m", true); label("trajectory_state", lengthInputs, lengthVelocity, "v=5 m/s", false);
geometries.set("curve", { kind: "path", sampledCurve: { curveKind: "function", parameterMin: 0, parameterMax: 3, evaluate: (t: number) => ({ x: t, y: t * t }), derivative: (t: number) => ({ x: 1, y: 2 * t }) } });
const derivativeInputs = { curve: "curve", at: 2, parameterScale: 7 }; const derivative = evaluateCalculusConstruction("curve_derivative", derivativeInputs, context)[0]!;
for (const text of ["dC/dt", "dC/dt=(1,4)", "dy/dx=4", "slope=4"]) label("curve_derivative", derivativeInputs, derivative, text, true);
for (const text of ["dC/dt=(7,28)", "dy/dx=28", "dy/dx=4 m/s"]) label("curve_derivative", derivativeInputs, derivative, text, false);
const secantInputs = { curve: "curve", first: 1, second: 2, span: 10 }; const secant = evaluateCalculusConstruction("curve_secant", secantInputs, context)[0]!;
label("curve_secant", secantInputs, secant, "slope=3", true, "line"); label("curve_secant", secantInputs, secant, "slope=10", false, "line");
const anchorInputs = { curve: "curve", at: 2 }; const anchor = evaluateCalculusConstruction("curve_anchor", anchorInputs, context)[0]!;
label("curve_anchor", anchorInputs, anchor, "P=(2,4)", true, "point"); label("curve_anchor", anchorInputs, anchor, "y=2", false, "point");
const separate = documentFor("trajectory_state", velocityInputs); separate.entities.push({ id: "stale", kind: "label", role: "claimed result", label: "v=999 m/s" }); separate.constructions.push({ id: "construct_label", operator: "label", inputs: { target: "result", text: "v=999 m/s" }, outputs: ["stale"] });
assert(issuesFor(separate, velocity).some((issue) => issue.severity === "fatal")); checks++;
const cyclic = documentFor("trajectory_state", velocityInputs); cyclic.quantities = [{ id: "first", symbol: "v", value: "second", unit: "m/s" }, { id: "second", value: "first" }]; cyclic.annotations.push({ id: "cyclic_claim", kind: "label", targetIds: ["result"], quantityId: "first" });
assert(issuesFor(cyclic, velocity).some((issue) => issue.severity === "fatal")); checks++;
const conflicting = documentFor("trajectory_state", velocityInputs); conflicting.quantities = [{ id: "first", symbol: "v", value: "second", unit: "m/s" }, { id: "second", value: 5, unit: "m" }]; conflicting.annotations.push({ id: "unit_claim", kind: "label", targetIds: ["result"], quantityId: "first" });
assert(issuesFor(conflicting, velocity).some((issue) => issue.severity === "fatal")); checks++;
for (const operator of ["harmonic_wave", "polytropic_process", "hydrostatic_profile", "harmonic_motion", "flux_process", "elastic_profile"]) {
  const scene = documentFor("curve_derivative", derivativeInputs); scene.constructions.push({ id: "physical_curve", operator, inputs: {}, outputs: ["curve"] }); scene.entities[0]!.label = "dy/dx=4";
  assert(issuesFor(scene, derivative).some((issue) => issue.severity === "fatal"), "scaled physical callbacks cannot be claimed as raw physical slopes"); checks++;
  scene.quantities.push({ id: "given_slope", symbol: "slope", value: 999, unit: "1" }); scene.entities[0]!.label = "slope=999";
  assert(issuesFor(scene, derivative).some((issue) => issue.severity === "fatal"), "a source quantity cannot override intentionally unavailable derivative authority"); checks++;
  scene.quantities[0]!.value = 4; scene.entities[0]!.label = "slope=4"; assert(issuesFor(scene, derivative).some((issue) => issue.severity === "fatal"), "matching display slope remains unsupported physical authority"); checks++;
  for (const symbol of ["E","sigma","Phi","F","U","q","v","a"]) {
    const stale = structuredClone(scene); stale.quantities.push({id:`stale_${symbol}`,symbol,value:2,unit:"Pa"}); stale.entities[0]!.label=`${symbol}=2 Pa`;
    assert(issuesFor(stale, derivative).some((issue)=>issue.severity==="fatal"), "unbound source givens cannot replace physical callback authority"); checks++;
  }
  scene.quantities.push({ id: "given_g", symbol: "g", value: 9.8, unit: "m/s^2" }); scene.entities[0]!.label = "g=9.8 m/s^2"; assert(issuesFor(scene, derivative).some((issue) => issue.severity === "fatal"), "unrelated givens must attach to their typed source owners, not replace physical derivative authority"); checks++;
}
if (!process.argv.includes("--unit-only")) {
  const { compileSceneDocument } = await import("../../src/compile/compiler");
  for (const [text, valid] of [["x0=1e-320 nm", true], ["x0=2e-320 nm", false]] as const) {
    const scene = documentFor("constant_acceleration_trajectory", tinyInputs, "polyline"); scene.entities[0]!.label = text; const result = compileSceneDocument(scene); assert.equal(result.ok, valid, JSON.stringify(result.report.issues)); assert.equal(result.renderScene !== null, valid); checks++;
  }
  for (const value of [1e-320, 2e-320]) {
    const scene = documentFor("constant_acceleration_trajectory", tinyInputs, "polyline"); scene.quantities = [{ id: "tiny_x", symbol: "x0", value, unit: "nm" }]; scene.annotations.push({ id: "tiny_claim", kind: "label", targetIds: ["result"], quantityId: "tiny_x" }); const result = compileSceneDocument(scene); assert.equal(result.ok, value === 1e-320, JSON.stringify(result.report.issues)); assert.equal(result.renderScene !== null, value === 1e-320); checks++;
  }
  function withTrajectory(scene: SceneDocument): SceneDocument {
    scene.entities.unshift({ id: "trajectory", kind: "polyline", role: "source trajectory" }); scene.constructions.unshift({ id: "make_trajectory", operator: "constant_acceleration_trajectory", inputs: trajectoryInputs, outputs: ["trajectory"] }); scene.requiredEntityIds.unshift("trajectory"); scene.revealGroups[0]!.entityIds.unshift("trajectory"); return scene;
  }
  for (const candidate of [underflowAnnotation, documentFor("trajectory_state", { trajectory: "trajectory", time: 1, kind: "acceleration", timeScale: 20 })]) {
    if (!candidate.annotations.length) candidate.entities[0]!.label = "|a|=1e-400 m/s^2";
    const result = compileSceneDocument(withTrajectory(candidate)); assert.equal(result.ok, false); assert.equal(result.renderScene, null, "nonzero decimal label and quantity literals cannot become certified zero"); checks++;
  }
  for (const [claimUnit, valid] of [["mm/ms", true], ["Mm/ms", false], ["mm/Ms", false]] as const) {
    const scene = withTrajectory(documentFor("trajectory_state", velocityInputs)); scene.constructions[0]!.inputs = { ...trajectoryInputs, units: { length: "mm", time: "ms" } }; scene.entities.find((entity) => entity.id === "result")!.label = `v=5 ${claimUnit}`;
    const result = compileSceneDocument(scene); assert.equal(result.ok, valid, JSON.stringify(result.report.issues)); assert.equal(result.renderScene !== null, valid, "case-sensitive SI unit labels must reject without partial ink"); checks++;
    const quantityScene = structuredClone(scene); quantityScene.entities.find((entity) => entity.id === "result")!.label = "v(t)"; quantityScene.quantities = [{ id: "claim_speed", symbol: "v", value: 5, unit: claimUnit }]; quantityScene.annotations.push({ id: "speed_claim", kind: "label", targetIds: ["result"], quantityId: "claim_speed" });
    const annotated = compileSceneDocument(quantityScene); assert.equal(annotated.ok, valid, JSON.stringify(annotated.report.issues)); assert.equal(annotated.renderScene !== null, valid); checks++;
  }
  for (const [text, valid] of [["v=5 m/s", true], ["vx=3 m/s", true], ["v(t)", true], ["v=999 m/s", false], ["v=40 m/s", false]] as const) {
    const scene = documentFor("trajectory_state", velocityInputs); scene.entities[0]!.label = text;
    const result = compileSceneDocument(withTrajectory(scene)); assert.equal(result.ok, valid, `${text}: ${JSON.stringify(result.report.issues)}`); assert.equal(result.renderScene !== null, valid, "invalid quantitative labels must reject atomically"); checks++;
  }
  for (const kind of ["label", "callout", "badge"]) {
    const scene = withTrajectory(documentFor("trajectory_state", velocityInputs)); scene.annotations.push({ id: `false_${kind}`, kind, targetIds: ["result"], text: "v=999 m/s" }); const result = compileSceneDocument(scene); assert.equal(result.ok, false); assert.equal(result.renderScene, null); checks++;
  }
  for (const value of [5, 40]) {
    const scene = withTrajectory(documentFor("trajectory_state", velocityInputs)); scene.quantities = [{ id: "claim_speed", symbol: "v", value, unit: "m/s" }]; scene.annotations.push({ id: "speed_claim", kind: "label", targetIds: ["result"], quantityId: "claim_speed" }); const result = compileSceneDocument(scene); assert.equal(result.ok, value === 5, JSON.stringify(result.report.issues)); assert.equal(result.renderScene !== null, value === 5); checks++;
  }
  const falseSeparate = withTrajectory(separate); falseSeparate.requiredEntityIds.push("stale"); falseSeparate.revealGroups[0]!.entityIds.push("stale"); const falseLabel = compileSceneDocument(falseSeparate); assert.equal(falseLabel.ok, false); assert.equal(falseLabel.renderScene, null); checks++;
  for (const [text, valid] of [["|r|=5 N", true], ["|r|=999 N", false]] as const) {
    const scene = documentFor("vector_sum", vectorInputs); scene.entities[0]!.label = text; scene.quantities = [{ id: "qx", value: 3, unit: "N" }, { id: "qy", value: 4, unit: "N" }];
    scene.constructions.push({ id: "make_start", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["start"] }, { id: "make_x", operator: "point", inputs: { x: "qx", y: 0 }, outputs: ["tip_x"] }, { id: "make_y", operator: "point", inputs: { x: 0, y: "qy" }, outputs: ["tip_y"] }, { id: "make_a", operator: "vector", inputs: { start: "start", end: "tip_x" }, outputs: ["a"] }, { id: "make_b", operator: "vector", inputs: { start: "start", end: "tip_y" }, outputs: ["b"] });
    for (const id of ["start", "tip_x", "tip_y", "a", "b"]) { scene.entities.push({ id, kind: ["a", "b"].includes(id) ? "vector" : "point", role: "source vector data" }); scene.requiredEntityIds.push(id); scene.revealGroups[0]!.entityIds.push(id); }
    const result = compileSceneDocument(scene); assert.equal(result.ok, valid, JSON.stringify(result.report.issues)); assert.equal(result.renderScene !== null, valid); checks++;
  }
  for (const [operator, inputs] of [["harmonic_wave", { amplitude: 2, waveNumber: 1, angularFrequency: 0, phase: 0, phaseUnit: "rad", time: 0, xMin: 0, xMax: 2 * Math.PI, samples: 65 }], ["polytropic_process", { pressureStart: 100, volumeStart: 1, volumeEnd: 2, exponent: 1, pressureUnit: "Pa", volumeUnit: "m^3", pressureScale: 0.02, volumeScale: 3, samples: 65 }]] as const) {
    for (const claim of ["slope", "dy/dx", "x", "magnitude"]) {
      const scene = documentFor("curve_derivative", { curve: "curve", at: operator === "harmonic_wave" ? 0 : 0.5, parameterScale: 1 }); scene.entities[0]!.label = `${claim}=999`; scene.quantities.push({ id: "given_claim", symbol: claim, value: 999, unit: "1" });
      scene.entities.unshift({ id: "curve", kind: "polyline", role: "physical source curve" }); scene.constructions.unshift({ id: "make_curve", operator, inputs, outputs: ["curve"] }); scene.requiredEntityIds.unshift("curve"); scene.revealGroups[0]!.entityIds.unshift("curve");
      const result = compileSceneDocument(scene); assert.equal(result.ok, false, "invented source scalar cannot replace a protected physical result"); assert.equal(result.renderScene, null); checks++;
    }
    const displaySlope = operator === "harmonic_wave" ? 2 : -100 / 1.5 ** 2 * 0.02 / 3;
    const scene = documentFor("curve_derivative", { curve: "curve", at: operator === "harmonic_wave" ? 0 : 0.5, parameterScale: 1 }); scene.entities[0]!.label = `slope=${displaySlope}`; scene.quantities.push({ id: "given_slope", symbol: "slope", value: displaySlope, unit: "1" });
    scene.entities.unshift({ id: "curve", kind: "polyline", role: "physical source curve" }); scene.constructions.unshift({ id: "make_curve", operator, inputs, outputs: ["curve"] }); scene.requiredEntityIds.unshift("curve"); scene.revealGroups[0]!.entityIds.unshift("curve");
    const result = compileSceneDocument(scene); assert.equal(result.ok, false); assert.equal(result.renderScene, null, "even a matching given must not certify an unavailable physical slope"); checks++;
  }
}
console.log(`derived value labels verified: ${checks} source-math/claim and atomic rejection checks`);
