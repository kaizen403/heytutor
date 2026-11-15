/** Compilation alone cannot let a planner replace requested function graphs. */
import assert from "node:assert/strict";
import { compileSceneDocument, buildLinearSourceDocument, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { admitStoredScene } from "../../lib/scene/sceneAdmission";

const question = "A curve y=x^2 and the line y=4 enclose a region. Sketch the region, then find its area using integration.";
const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], unknowns: [{ id: "area", symbol: "A", unit: "square units" }], derived: [{ id: "area_value", symbol: "A", value: 32 / 3, unit: "square units", provenance: "derived" }], qualitativeClaims: [], lawIds: ["area_between_curves"], assumptions: [] };
function unrelated(source: string): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "mechanically valid segment" }, source: { question: source, exact: true }, quantities: [],
    entities: [{ id: "a", kind: "point", role: "endpoint", label: "A" }, { id: "b", kind: "point", role: "endpoint", label: "B" }, { id: "ab", kind: "segment", role: "segment", label: "AB" }],
    constructions: [{ id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] }, { id: "make_b", operator: "point", inputs: { x: 3, y: 0 }, outputs: ["b"] }, { id: "make_ab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] }],
    relations: [], assertions: [{ id: "exists_ab", predicate: "exists", entities: ["ab"], expected: true, severity: "fatal" }], annotations: [], requiredEntityIds: ["a", "b", "ab"], revealGroups: [{ id: "setup", entityIds: ["a", "b", "ab"], dependsOn: [], narrationCue: "Draw AB." }], teachingTimeline: [],
  };
}
function graph(source: string, bodies: string[], labels: string[], axes = true): SceneDocument {
  const ids = bodies.map((_body, index) => `curve_${index}`);
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "declared function plot" }, source: { question: source }, quantities: [],
    entities: [...(axes ? [{ id: "axes", kind: "axes", role: "Cartesian axes" }] : []), ...ids.map((id, index) => ({ id, kind: "polyline", role: "function curve", label: labels[index]! }))],
    constructions: [...(axes ? [{ id: "make_axes", operator: "axes", inputs: { xMin: -2, xMax: 2, yMin: -1, yMax: 5 }, outputs: ["axes"] }] : []), ...ids.map((id, index) => ({ id: `make_${id}`, operator: "function_curve", inputs: { expression: bodies[index]!, variable: "x", xMin: -2, xMax: 2, samples: 65 }, outputs: [id] }))],
    relations: [], assertions: [], annotations: [], requiredEntityIds: [...(axes ? ["axes"] : []), ...ids],
    revealGroups: [{ id: "setup", entityIds: [...(axes ? ["axes"] : []), ...ids], dependsOn: [], narrationCue: "Draw the requested functions." }], teachingTimeline: [],
  };
}
async function main() {
  const document = unrelated(question);
  const compiled = compileSceneDocument(document);
  assert(compiled.ok && compiled.renderScene, "the regression must pass mechanical compilation first");
  const validation = validateProductionSceneCandidate({ question, turnPlan: plan, candidate: { ...document } });
  assert.equal(validation.valid, false, "an unrelated segment cannot satisfy the source's requested curves");
  assert(validation.errors.some(issue => issue.code === "source_function_inventory_unmet"));
  const exact = { sceneDocument: document, renderScene: compiled.renderScene, validationReport: compiled.report };
  const selected = selectVerifiedRepresentation({ question, turnPlan: plan, exact });
  assert(!selected.sceneDocument.entities.some(entity => entity.id === "ab"), "lower-level exact selection rechecks the source inventory");
  const live = selectProductionScene({ question, turnPlan: plan, problemIR: null, candidateValidation: validation, requiredRetryEnabled: true });
  assert(!live.representation?.sceneDocument.entities.some(entity => entity.id === "ab"));
  for (const retainedPlan of [plan, null]) {
    for (const tier of ["exact_verified", "qualitative_verified", "question_representation"] as const) {
      assert.match(sceneSaveAdmissionFailure({ question, document, turnPlan: retainedPlan, tier }) ?? "", /source_function_inventory_unmet/, "source obligations survive missing planner metadata and all tiers");
    }
    const saved = await canonicalizeTurnSceneMetadata({ question, sceneDocument: document, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: retainedPlan, representationTier: "question_representation", nonMetric: true, diagramResultStatus: "ready" }, segments: [] });
    assert(!saved.ok, "canonical save must refuse the unrelated compiled figure");
  }
  for (const source of [question, "Plot y=x^2 and y=4.", "Sketch the graph of y=x^2.", "Find the area of the region bounded by y=4-x^2 and the x axis", "Sketch y=x^2 and its tangent at x=1."]) {
    const ownPlan = { ...plan, question: source, unknowns: [], derived: [] };
    const native = selectVerifiedRepresentation({ question: source, turnPlan: ownPlan });
    assert.equal(native.sceneDocument.visualDecision.mode, "scene");
    assert(native.sceneDocument.constructions.some(construction => construction.operator === "function_curve"));
    assert.equal(sceneSaveAdmissionFailure({ question: source, document: native.sceneDocument, turnPlan: ownPlan, tier: native.tier }), null, "complete source-owned curves retain their live/save authority");
    const saved = await canonicalizeTurnSceneMetadata({ question: source, sceneDocument: native.sceneDocument, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: ownPlan, representationTier: native.tier, nonMetric: native.nonMetric, diagramResultStatus: "ready" }, segments: [] });
    assert(saved.ok, saved.ok ? "" : saved.error);
    assert(saved.value.sceneDocument);
    assert.equal(sceneSaveAdmissionFailure({ question: source, document: JSON.parse(JSON.stringify(saved.value.sceneDocument)), turnPlan: ownPlan, tier: native.tier }), null);
    const reopened = admitStoredScene({ sceneDocument: JSON.parse(JSON.stringify(saved.value.sceneDocument)), sceneQuestion: source, turnPlan: ownPlan, submittedTier: native.tier });
    assert(reopened.ok, reopened.ok ? "" : reopened.message);
    if (source === "Sketch the graph of y=x^2.") {
      const partial = structuredClone(native.sceneDocument);
      partial.source.question = question;
      const partialCompile = compileSceneDocument(partial);
      assert(partialCompile.ok && partialCompile.renderScene, "a correct single curve remains geometrically valid");
      const partialAdmission = validateProductionSceneCandidate({ question, turnPlan: plan, candidate: { ...partial } });
      assert(!partialAdmission.valid && partialAdmission.errors.some(issue => issue.code === "source_function_inventory_unmet"), "one correct curve cannot replace the complete requested pair");
      assert.match(sceneSaveAdmissionFailure({ question, document: partial, turnPlan: null, tier: native.tier }) ?? "", /source_function_inventory_unmet/);
    }
  }
  const segmentQuestion = "Show A=(0,0) and B=(3,0), joined by segment AB.";
  const segmentPlan = { ...plan, question: segmentQuestion, unknowns: [], derived: [], lawIds: [] };
  const segment = unrelated(segmentQuestion);
  assert(validateProductionSceneCandidate({ question: segmentQuestion, turnPlan: segmentPlan, candidate: { ...segment } }).valid, "a source-matching segment remains valid");
  assert.equal(sceneSaveAdmissionFailure({ question: segmentQuestion, document: segment, turnPlan: segmentPlan, tier: "question_representation" }), null);
  const quotedQuestion = segmentQuestion + ' The quoted text "plot y=x^2" is an example, not a requested graph.';
  const quotedSegment = unrelated(quotedQuestion);
  assert(validateProductionSceneCandidate({ question: quotedQuestion, turnPlan: { ...segmentPlan, question: quotedQuestion }, candidate: { ...quotedSegment } }).valid, "quoted equations cannot create a graph obligation for the requested segment");
  for (const source of ["Sketch y=x^2 and its normal at x=1.", question + " A=32/3."]) {
    const doc = unrelated(source);
    const ownPlan = { ...segmentPlan, question: source };
    const live = selectProductionScene({ question: source, turnPlan: ownPlan, problemIR: null, candidate: { ...doc }, requiredRetryEnabled: true, policy: { preferPlanner: true, allowedFigureSources: ["planner"] } });
    assert.notEqual(live.visualStatus, "validated", "other requested marks or unrelated scalar equalities cannot hide the source curves");
    const saved = await canonicalizeTurnSceneMetadata({ question: source, sceneDocument: doc, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: ownPlan, representationTier: "qualitative_verified", nonMetric: true, diagramResultStatus: "ready" }, segments: [] });
    assert(!saved.ok);
  }
  for (const [source, body, label] of [
    ["Plot f(x)=x^2.", "x^2", "f(x)=x^2"], ["Plot y=x^2.", "x^2", "C: y=x^2"],
    ["Plot y=x*x.", "x*x", "y=x^2"], ["Plot y=x^2.", "x^2", "y-x^2=0"],
  ]) {
    const ownPlan = { ...segmentPlan, question: source! };
    const doc = graph(source!, [body!], [label!]);
    assert(compileSceneDocument(doc, { figureConsistency: true }).ok, "the complete equation label is supported by the compiler");
    assert(validateProductionSceneCandidate({ question: source!, turnPlan: ownPlan, candidate: { ...doc } }).valid, label);
    const saved = await canonicalizeTurnSceneMetadata({ question: source!, sceneDocument: doc, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: ownPlan, representationTier: "qualitative_verified", nonMetric: true, diagramResultStatus: "ready" }, segments: [] });
    assert(saved.ok, saved.ok ? "" : saved.error);
  }
  for (const source of ["Sketch a segment AB lying on y=0, with endpoints at (0,0) and (3,0).", "An electron at y=0 is in a region containing a rightward electric field. Sketch the electric field vector E and the force vector F."]) {
    const doc = unrelated(source);
    if (source.startsWith("An electron")) {
      doc.entities = [{ id: "q", kind: "point", role: "electron", label: "electron" }, { id: "E", kind: "vector", role: "electric field", label: "E" }, { id: "F", kind: "vector", role: "electric force", label: "F" }];
      doc.constructions = [{ id: "make_q", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["q"] }, ...[["E", 1], ["F", -1]].map(([id, direction]) => ({ id: `make_${id}`, operator: "vector", inputs: { start: "q", direction: [direction, 0], length: 2 }, outputs: [String(id)] }))];
      doc.assertions = []; doc.requiredEntityIds = ["q", "E", "F"]; doc.revealGroups[0]!.entityIds = ["q", "E", "F"];
    }
    const ownPlan = { ...segmentPlan, question: source };
    assert(validateProductionSceneCandidate({ question: source, turnPlan: ownPlan, candidate: { ...doc } }).valid, "a position or segment constraint does not request a full function plot");
    assert.equal(sceneSaveAdmissionFailure({ question: source, document: doc, turnPlan: ownPlan, tier: "qualitative_verified" }), null);
  }
  const wrongBodies = graph("Plot y=x^2 and y=4.", ["x", "0"], ["y=x^2", "y=4"], false);
  assert(compileSceneDocument(wrongBodies).ok, "the axes-free regression must reach source admission");
  const wrongPlan = { ...segmentPlan, question: String(wrongBodies.source.question) };
  assert(!validateProductionSceneCandidate({ question: wrongPlan.question, turnPlan: wrongPlan, candidate: { ...wrongBodies } }).valid, "labels cannot vouch for wrong curve bodies when axes are absent");
  assert.match(sceneSaveAdmissionFailure({ question: wrongPlan.question, document: wrongBodies, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/);
  const yielded = graph("Plot y=x^2.", ["x^2"], ["y=x^2"]);
  delete yielded.entities.find(entity => entity.id === "curve_0")!.label;
  yielded.source.diagramYieldPolicy = "verified_parts";
  const yieldedPlan = { ...segmentPlan, question: "Plot y=x^2." };
  const yieldedSave = await canonicalizeTurnSceneMetadata({ question: yieldedPlan.question, sceneDocument: yielded, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: yieldedPlan, representationTier: "qualitative_verified", nonMetric: true, diagramResultStatus: "ready" }, segments: [] });
  assert(yieldedSave.ok, "the opted-in omission of a label does not discard its independently source-proved curve");
  const falseYield = structuredClone(wrongBodies);
  falseYield.source.diagramYieldPolicy = "verified_parts";
  for (const entity of falseYield.entities) delete entity.label;
  assert.match(sceneSaveAdmissionFailure({ question: wrongPlan.question, document: falseYield, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/, "a yield flag cannot establish curve truth");
  async function admitted(source: string, doc: SceneDocument, tier: "exact_verified" | "qualitative_verified" | "question_representation" = "qualitative_verified") {
    const ownPlan = { ...segmentPlan, question: source };
    assert(validateProductionSceneCandidate({ question: source, turnPlan: ownPlan, candidate: { ...doc } }).valid, source);
    const live = selectProductionScene({ question: source, turnPlan: ownPlan, problemIR: null, candidate: { ...doc }, policy: { preferPlanner: true, allowedFigureSources: ["planner"] } });
    assert.equal(live.visualStatus, "validated", source);
    const saved = await canonicalizeTurnSceneMetadata({ question: source, sceneDocument: doc, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: ownPlan, representationTier: tier, nonMetric: tier !== "exact_verified", diagramResultStatus: "ready" }, segments: [] });
    assert(saved.ok, saved.ok ? "" : saved.error);
    assert(admitStoredScene({ sceneDocument: JSON.parse(JSON.stringify(saved.value.sceneDocument)), sceneQuestion: source, turnPlan: ownPlan, submittedTier: tier }).ok);
  }
  for (const [source, body, label] of [
    ["Plot y=x+1e-3.", "x+1e-3", "y=x+1e-3"],
    ["Plot y=x+2e1.", "x+20", "y=x+2e1"],
    ["Plot y=x+2 e + 1.", "x+2*e+1", "y=x+2 e + 1"],
    ["Plot y=sin(x).", "sin(x)", "y-sin(x)=0"],
    ["Plot y=1/(x^2+1).", "1/(x^2+1)", "y-1/(x^2+1)=0"],
  ]) await admitted(source!, graph(source!, [body!], [label!]));
  await admitted("Plot y=sin(2*x).", graph("Plot y=sin(2*x).", ["sin(2.0*x)"], ["y=sin(2e0*x)"]));
  const radicalSource = "Sketch y=sqrt(2)*x^2 and its tangent at x=1.";
  const radicalTangent = graph(radicalSource, ["sqrt(2)*x^2", "2*sqrt(2)*x-sqrt(2)"], ["y=sqrt(2)*x^2", "T"]);
  radicalTangent.annotations.push({ id: "tangent_equation", kind: "callout", targetIds: ["curve_1"], text: "y=2*sqrt(2)*x-sqrt(2)" });
  await admitted(radicalSource, radicalTangent);
  const radicalNormal = "Sketch y=sqrt(2)*x^2 and its normal at x=1.";
  const radicalNormalDocument = graph(radicalNormal, ["sqrt(2)*x^2", "-x/(2*sqrt(2))+sqrt(2)+1/(2*sqrt(2))"], ["y=sqrt(2)*x^2", "N"]);
  radicalNormalDocument.annotations.push({ id: "normal_equation", kind: "callout", targetIds: ["curve_1"], text: "y=-x/(2*sqrt(2))+sqrt(2)+1/(2*sqrt(2))" });
  await admitted(radicalNormal, radicalNormalDocument);
  const degree16Source = "Plot y=x^16/sqrt(2)+1.";
  const degree16 = graph(degree16Source, ["1+x^16/sqrt(2)"], ["C"]);
  degree16.constructions[0]!.inputs.xMin = -1; degree16.constructions[0]!.inputs.xMax = 1;
  degree16.constructions[1]!.inputs.xMin = -1; degree16.constructions[1]!.inputs.xMax = 1;
  degree16.annotations.push({ id: "curve_equation", kind: "callout", targetIds: ["curve_0"], text: "y=x^16/sqrt(2)+1" });
  await admitted(degree16Source, degree16);
  const scientificWrong = graph("Plot y=x+1e-3.", ["x+e-3"], ["y=x+1e-3"], false);
  assert.match(sceneSaveAdmissionFailure({ question: "Plot y=x+1e-3.", document: scientificWrong, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/, "scientific literals cannot become Euler-constant products");
  const eulerWrong = graph("Plot y=x+2 e + 1.", ["x+20"], ["y=x+2 e + 1"], false);
  assert.match(sceneSaveAdmissionFailure({ question: "Plot y=x+2 e + 1.", document: eulerWrong, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/, "separated Euler tokens cannot become an exponent");
  for (const condition of ["at y=0.", "where y=0. A=1."]) {
    const source = "Plot y=x^2 and mark its vertex " + condition;
    const doc = graph(source, ["x^2"], ["y=x^2"]);
    doc.entities.push({ id: "vertex", kind: "point", role: "vertex" });
    doc.constructions.push({ id: "make_vertex", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["vertex"] });
    doc.requiredEntityIds.push("vertex"); doc.revealGroups[0]!.entityIds.push("vertex");
    await admitted(source, doc);
  }
  const lineSource = "Plot y=2*x+1.";
  const line = unrelated(lineSource);
  line.entities.find(entity => entity.id === "ab")!.kind = "line";
  line.entities.find(entity => entity.id === "ab")!.label = "y=2*x+1";
  line.constructions[0]!.inputs = { x: -1, y: -1 }; line.constructions[1]!.inputs = { x: 1, y: 3 };
  line.constructions[2]!.operator = "line";
  const lineBefore = compileSceneDocument(line), lineProof = compileSceneDocument(line, { sourceFunctionChecks: [{ entityId: "ab", expression: "2*x+1" }] });
  assert(lineBefore.ok && lineProof.ok);
  assert.deepEqual(lineProof.renderScene, lineBefore.renderScene, "source witnesses never become drawn or stored marks");
  await admitted(lineSource, line);
  const precisionLine = structuredClone(line);
  precisionLine.constructions[0]!.inputs = { x: 0, y: 0 }; precisionLine.constructions[1]!.inputs = { x: 1, y: 1 };
  precisionLine.entities.find(entity => entity.id === "ab")!.label = "T";
  assert(compileSceneDocument(precisionLine).ok);
  assert(!compileSceneDocument(precisionLine, { sourceFunctionChecks: [{ entityId: "ab", expression: "x", adjunct: { role: "tangent", at: 1e12 }, equation: { lhs: "y", rhs: "sqrt(1.0000000000000001)*x" } }] }).ok, "coefficient uncertainty is checked at the actual source point");

  const segmentLine = structuredClone(line);
  segmentLine.entities.find(entity => entity.id === "ab")!.kind = "segment";
  segmentLine.constructions[2]!.operator = "segment";
  await admitted(lineSource, segmentLine);
  const distantSegment = structuredClone(segmentLine);
  distantSegment.constructions[0]!.inputs = { x: 2, y: 5 }; distantSegment.constructions[1]!.inputs = { x: 3, y: 7 };
  await admitted(lineSource, distantSegment);
  const annotated = graph("Plot y=x^2.", ["x^2"], ["y=x^2"]);
  delete annotated.entities.find(entity => entity.id === "curve_0")!.label;
  annotated.annotations.push({ id: "curve_equation", kind: "label", targetIds: ["curve_0"], text: "y=x^2" });
  await admitted("Plot y=x^2.", annotated);
  const wrongAnnotated = structuredClone(annotated);
  wrongAnnotated.constructions.find(item => item.operator === "function_curve")!.inputs.expression = "x";
  assert.match(sceneSaveAdmissionFailure({ question: "Plot y=x^2.", document: wrongAnnotated, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/);
  await admitted("Sketch y=sin(x)/2.", graph("Sketch y=sin(x)/2.", ["sin(x)/2"], ["sin(x)=2y"]));
  const systemSource = "Plot y=2*x+1 and y=-x+2.";
  const system = buildLinearSourceDocument(systemSource);
  assert(system);
  assert(system.constructions.some(item => item.operator === "linear_system"), "the existing source-only linear builder supplies the regression");
  await admitted(systemSource, system, "exact_verified");
  const wrongLine = structuredClone(line); wrongLine.constructions[1]!.inputs = { x: 1, y: 4 };
  assert(!compileSceneDocument(wrongLine, { sourceFunctionChecks: [{ entityId: "ab", expression: "2*x+1" }] }).ok, "axes-free straight-line ownership is independently proved");
  for (const role of ["tangent", "normal"] as const) {
    const source = `Sketch y=x^2 and its ${role} at x=1.`;
    const body = role === "tangent" ? "2*x-1" : "-x/2+3/2";
    const doc = graph(source, ["x^2", body], ["y=x^2", `y=${body}`]);
    await admitted(source, doc);
    for (const wrong of ["2*x+1", "0.5*x+0.5", "x^2+2*(x-1)^2"]) {
      const bad = graph(source, ["x^2", wrong], ["y=x^2", `y=${wrong}`]);
      assert.match(sceneSaveAdmissionFailure({ question: source, document: bad, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/, "an adjunct needs source incidence, analytic direction and affine geometry");
    }
  }
  for (const source of ["Plot y=x^2. Do not draw its tangent at x=1.", "Plot y=x^2. If we drew a tangent at x=1, what would its slope be?", "Plot y=x^2. Draw a tangent at x=1 to the circle centered at (1,0) with radius 1."]) {
    const doc = graph(source, ["x^2", "2*x-1"], ["y=x^2", "y=2*x-1"]);
    assert(!validateProductionSceneCandidate({ question: source, turnPlan: { ...segmentPlan, question: source }, candidate: { ...doc } }).valid);
    assert.match(sceneSaveAdmissionFailure({ question: source, document: doc, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/, "an adjunct mention is not an affirmative request bound to this curve");
  }
  for (const source of ["Plot y=x^2 and please draw its tangent at x=1.", "Plot y=x^2 and its tangent at x=1 on the curve.", "Plot y=x^2 and find its tangent at x=1.", "Plot y=x^2. Determine its tangent at x=1."]) await admitted(source, graph(source, ["x^2", "2*x-1"], ["y=x^2", "y=2*x-1"]));
  const verticalSource = "Plot y=x^2 and its normal at x=0.";
  const vertical = graph(verticalSource, ["x^2"], ["y=x^2"]);
  vertical.entities.push({ id: "a", kind: "point", role: "normal point" }, { id: "b", kind: "point", role: "normal point" }, { id: "normal", kind: "line", role: "normal", label: "x=0" });
  vertical.constructions.push({ id: "make_a", operator: "point", inputs: { x: 0, y: -1 }, outputs: ["a"] }, { id: "make_b", operator: "point", inputs: { x: 0, y: 1 }, outputs: ["b"] }, { id: "make_normal", operator: "line", inputs: { start: "a", end: "b" }, outputs: ["normal"] });
  vertical.requiredEntityIds.push("a", "b", "normal"); vertical.revealGroups[0]!.entityIds.push("a", "b", "normal");
  await admitted(verticalSource, vertical);
  const wrongVerticalLabel = structuredClone(vertical);
  wrongVerticalLabel.entities = wrongVerticalLabel.entities.filter(entity => entity.id !== "axes"); wrongVerticalLabel.constructions = wrongVerticalLabel.constructions.filter(construction => construction.operator !== "axes");
  wrongVerticalLabel.requiredEntityIds = wrongVerticalLabel.requiredEntityIds.filter(id => id !== "axes"); wrongVerticalLabel.revealGroups[0]!.entityIds = wrongVerticalLabel.revealGroups[0]!.entityIds.filter(id => id !== "axes");
  wrongVerticalLabel.entities.find(entity => entity.id === "normal")!.label = "x=1e-400*y^2";
  assert.match(sceneSaveAdmissionFailure({ question: verticalSource, document: wrongVerticalLabel, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/);
  wrongVerticalLabel.entities.find(entity => entity.id === "normal")!.label = "x=1";
  assert.match(sceneSaveAdmissionFailure({ question: verticalSource, document: wrongVerticalLabel, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/, "an axes-free normal cannot carry a false complete line equation");
  const proseCallout = graph("Plot y=x^2.", ["x^2"], ["y=x^2"], false);
  proseCallout.annotations.push({ id: "evaluation_note", kind: "callout", targetIds: ["curve_0"], text: "At x=1" });
  await admitted("Plot y=x^2.", proseCallout);
  const proseEntity = graph("Plot y=x^2.", ["x^2"], ["Curve y=x^2"], false);
  proseEntity.annotations.push({ id: "curve_equation", kind: "label", targetIds: ["curve_0"], text: "y=x^2" });
  await admitted("Plot y=x^2.", proseEntity);
  const wrongProseBody = structuredClone(proseEntity);
  wrongProseBody.constructions[0]!.inputs.expression = "x^3";
  assert.match(sceneSaveAdmissionFailure({ question: "Plot y=x^2.", document: wrongProseBody, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/, "prose cannot substitute for literal body proof");
  const conflictingGraph = graph("Plot y=x^2.", ["x^2"], ["y=x^3"], false);
  conflictingGraph.annotations.push({ id: "correct_callout", kind: "callout", targetIds: ["curve_0"], text: "y=x^2" });
  const conflictingNormal = structuredClone(wrongVerticalLabel);
  conflictingNormal.annotations.push({ id: "correct_callout", kind: "callout", targetIds: ["normal"], text: "x=0" });
  for (const [source, doc] of [["Plot y=x^2.", conflictingGraph], [verticalSource, conflictingNormal]] as const) {
    assert(compileSceneDocument(doc, { figureConsistency: true }).ok, "axes-free conflicts must reach source admission");
    const ownPlan = { ...segmentPlan, question: source };
    assert(!validateProductionSceneCandidate({ question: source, turnPlan: ownPlan, candidate: { ...doc } }).valid, "one true equation cannot authorize a conflicting retained equation");
    const live = selectProductionScene({ question: source, turnPlan: ownPlan, problemIR: null, candidate: { ...doc }, policy: { preferPlanner: true, allowedFigureSources: ["planner"] } });
    assert.notEqual(live.visualStatus, "validated");
    for (const retainedPlan of [ownPlan, null]) for (const tier of ["exact_verified", "qualitative_verified", "question_representation"] as const) {
      const saved = await canonicalizeTurnSceneMetadata({ question: source, sceneDocument: doc, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: retainedPlan, representationTier: tier, nonMetric: tier !== "exact_verified", diagramResultStatus: "ready" }, segments: [] });
      assert(!saved.ok, "a conflicting equation cannot be persisted in any tier or without a plan");
      assert(!admitStoredScene({ sceneDocument: JSON.parse(JSON.stringify(doc)), sceneQuestion: source, turnPlan: retainedPlan, submittedTier: tier }).ok, "a previously persisted conflicting equation cannot reopen");
    }
  }
  for (const equation of ["y=x/(1+sqrt(1-1.0000000000000000001))-0.25", "y=x/(1+acos(1.0000000000000000001))-0.25", "y=1e-12*x/(sqrt(1.0000000000000001)-1+1e-12)-0.25"]) {
    const source = "Sketch y=x^2 and its tangent at x=0.5.";
    const doc = graph(source, ["x^2", "x-0.25"], ["y=x^2", "T"]);
    doc.annotations.push({ id: "tangent_equation", kind: "callout", targetIds: ["curve_1"], text: equation });
    assert(compileSceneDocument(doc, { figureConsistency: true }).ok, "the historical numeric gap reaches source admission");
    const ownPlan = { ...segmentPlan, question: source };
    assert(!validateProductionSceneCandidate({ question: source, turnPlan: ownPlan, candidate: { ...doc } }).valid, "invalid domains and unproved cancellation cannot authorize a tangent label");
    const selected = selectProductionScene({ question: source, turnPlan: ownPlan, problemIR: null, candidate: { ...doc }, policy: { preferPlanner: true, allowedFigureSources: ["planner"] } });
    assert.notEqual(selected.visualStatus, "validated");
    for (const retainedPlan of [ownPlan, null]) for (const tier of ["exact_verified", "qualitative_verified", "question_representation"] as const) {
      const saved = await canonicalizeTurnSceneMetadata({ question: source, sceneDocument: doc, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: retainedPlan, representationTier: tier, nonMetric: tier !== "exact_verified", diagramResultStatus: "ready" }, segments: [] });
      assert(!saved.ok);
      assert(!admitStoredScene({ sceneDocument: JSON.parse(JSON.stringify(doc)), sceneQuestion: source, turnPlan: retainedPlan, submittedTier: tier }).ok);
    }
  }
  console.log("planner function inventory: production selection, exact selection, all-tier/no-plan save, native curves and JSON reopen controls passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
