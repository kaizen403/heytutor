/** Compilation alone cannot let a planner replace requested function graphs. */
import assert from "node:assert/strict";
import { buildLinearSourceDocument, compileSceneDocument, mathExpressionsEquivalent, parseMathExpression, tierForForeignDocument, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
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
  async function admitted(source: string, doc: SceneDocument, decision?: ReturnType<typeof tierForForeignDocument>, yieldPolicy?: "verified_parts") {
    const ownPlan = { ...segmentPlan, question: source };
    const { tier, nonMetric } = decision ?? { tier: "qualitative_verified" as const, nonMetric: true };
    if (decision) doc = { ...doc, source: { ...doc.source, representationTier: tier, nonMetric } };
    const validation = validateProductionSceneCandidate({ question: source, turnPlan: ownPlan, candidate: { ...doc }, yieldPolicy });
    assert(validation.valid, `${source}: ${JSON.stringify(validation.errors)}`);
    const live = selectProductionScene({ question: source, turnPlan: ownPlan, problemIR: null, ...(yieldPolicy ? { candidateValidation: validation } : { candidate: { ...doc } }), policy: { preferPlanner: true, allowedFigureSources: ["planner"] } });
    assert.equal(live.visualStatus, "validated", source);
    const saved = await canonicalizeTurnSceneMetadata({ question: source, sceneDocument: doc, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: ownPlan, representationTier: tier, nonMetric, diagramResultStatus: "ready" }, segments: [] });
    assert(saved.ok, saved.ok ? "" : saved.error);
    assert(admitStoredScene({ sceneDocument: JSON.parse(JSON.stringify(saved.value.sceneDocument)), sceneQuestion: source, turnPlan: ownPlan, submittedTier: tier }).ok);
  }
  const annotated = graph("Plot y=x^2.", ["x^2"], ["y=x^2"]);
  delete annotated.entities.find(entity => entity.id === "curve_0")!.label;
  annotated.annotations.push({ id: "curve_equation", kind: "label", targetIds: ["curve_0"], text: "y=x^2" });
  await admitted("Plot y=x^2.", annotated);
  const wrongAnnotated = structuredClone(annotated);
  wrongAnnotated.constructions.find(construction => construction.operator === "function_curve")!.inputs.expression = "x";
  assert.match(sceneSaveAdmissionFailure({ question: "Plot y=x^2.", document: wrongAnnotated, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/,
    "an attached equation cannot license an unrelated curve body");
  assert(mathExpressionsEquivalent("sin(x)-2*y", "y-sin(x)/2", { allowNonzeroScale: true }), "exact scaling of the same function terms preserves its equation");
  assert(!mathExpressionsEquivalent("cos(x)-2*y", "y-sin(x)/2", { allowNonzeroScale: true }), "different function terms cannot become equivalent");
  assert(!mathExpressionsEquivalent("sin(1/x)-sin(1/x)", "0"), "cancelling function terms cannot erase their domain");
  await admitted("Sketch y = sin(x)/2.", graph("Sketch y = sin(x)/2.", ["sin(x)/2"], ["sin(x)=2y"]));
  const linearQuestion = "The graphs y=(3/2)x+4 and y=-(1/2)x+10 cross at P. Show the graphs and find the exact coordinates of P.";
  const linearProgram = buildLinearSourceDocument(linearQuestion);
  assert(linearProgram);
  assert(linearProgram.constructions.some(construction => construction.operator === "linear_system"));
  await admitted(linearQuestion, linearProgram, tierForForeignDocument(linearProgram));
  const unrelatedLinear = structuredClone(linearProgram);
  unrelatedLinear.constructions[0]!.inputs.equations = ["x+y=2", "x-y=1"];
  assert(!compileSceneDocument(unrelatedLinear, { figureConsistency: true }).ok, "the composite source compiler rejects different equations");
  assert(sceneSaveAdmissionFailure({ question: linearQuestion, document: unrelatedLinear, turnPlan: null, tier: tierForForeignDocument(unrelatedLinear).tier }), "an unrelated composite cannot claim source-built authority");
  for (const [source, body, label] of [
    ["Plot y=x+1e-3.", "x+1e-3", "y=x+1e-3"],
    ["Plot y=sin(x).", "sin(x)", "y-sin(x)=0"],
    ["Plot y=1/(x^2+1).", "1/(x^2+1)", "y-1/(x^2+1)=0"],
  ]) await admitted(source!, graph(source!, [body!], [label!]));
  const scientificWrong = graph("Plot y=x+1e-3.", ["x+e-3"], ["y=x+1e-3"], false);
  assert.match(sceneSaveAdmissionFailure({ question: "Plot y=x+1e-3.", document: scientificWrong, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/, "scientific literals cannot become Euler-constant products");
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
  const graphSegment = structuredClone(line);
  graphSegment.entities.find(entity => entity.id === "ab")!.kind = "segment";
  graphSegment.constructions[2]!.operator = "segment";
  graphSegment.constructions[0]!.inputs = { x: 3, y: 7 }; graphSegment.constructions[1]!.inputs = { x: 5, y: 11 };
  await admitted(lineSource, graphSegment);
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
  const conicSource = "Plot y=x^2.";
  const conic = graph(conicSource, ["x^2"], ["y=x^2"]);
  const parabola = conic.constructions.find(construction => construction.operator === "function_curve")!;
  parabola.operator = "conic";
  parabola.inputs = { kind: "parabola", vertex: [0, 0], p: 0.25, rotationDeg: 90, tMin: -4, tMax: 4, samples: 65 };
  const conicBefore = compileSceneDocument(conic, { figureConsistency: true });
  assert(conicBefore.ok && conicBefore.renderScene, "the conic regression must already compile");
  await admitted(conicSource, conic);
  const conicProof = compileSceneDocument(conic, { sourceFunctionChecks: [{ entityId: "curve_0", expression: "x^2" }] });
  assert(conicProof.ok);
  assert.deepEqual(conicProof.renderScene, conicBefore.renderScene, "conic source proofs must not change drawn marks");
  for (const change of [{ p: 0.5 }, { rotationDeg: 0 }, { rotationDeg: 45 }, { rotationDeg: 90.000001 }, { vertex: [1, 0] }]) {
    const bad = structuredClone(conic);
    Object.assign(bad.constructions.find(construction => construction.operator === "conic")!.inputs, change);
    assert.match(sceneSaveAdmissionFailure({ question: conicSource, document: bad, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/,
      "a conic equation label cannot vouch for the wrong parabola");
  }
  for (const [rotationDeg, p, expression] of [[-90, -0.25, "(x-1)^2+2"], [270, 0.25, "-(x-1)^2+2"], [450, 0.075, "(x-1)^2/(3/10)+2"]] as const) {
    const source = `Plot y=${expression}.`;
    const doc = graph(source, [expression], [`y=${expression.replace("(3/10)", ".3")}`], false);
    const construction = doc.constructions[0]!;
    construction.operator = "conic";
    construction.inputs = { kind: "parabola", vertex: [1, 2], p, rotationDeg, tMin: -4, tMax: 4, samples: 65 };
    assert(compileSceneDocument(doc).ok, "the alternate conic must pass the existing label and geometry guards");
    await admitted(source, doc);
    const bad = structuredClone(doc);
    bad.constructions[0]!.inputs.p = p * 2;
    assert.match(sceneSaveAdmissionFailure({ question: source, document: bad, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/,
      "conic ownership is proved without relying on visible Cartesian axes");
  }
  const normalSource = "Sketch y=x^2 and its normal at x=0.";
  const verticalNormal = graph(normalSource, ["x^2"], ["y=x^2"]);
  verticalNormal.entities.push({ id: "normal", kind: "line", role: "normal", label: "x=0" });
  verticalNormal.constructions.push({ id: "make_normal", operator: "line", inputs: { start: [0, -1], end: [0, 3] }, outputs: ["normal"] });
  verticalNormal.requiredEntityIds.push("normal"); verticalNormal.revealGroups[0]!.entityIds.push("normal");
  await admitted(normalSource, verticalNormal);
  const noAxesNormal = structuredClone(verticalNormal);
  noAxesNormal.entities = noAxesNormal.entities.filter(entity => entity.id !== "axes");
  noAxesNormal.constructions = noAxesNormal.constructions.filter(construction => construction.operator !== "axes");
  noAxesNormal.requiredEntityIds = noAxesNormal.requiredEntityIds.filter(id => id !== "axes");
  noAxesNormal.revealGroups[0]!.entityIds = noAxesNormal.revealGroups[0]!.entityIds.filter(id => id !== "axes");
  await admitted(normalSource, noAxesNormal);
  const normalBefore = compileSceneDocument(noAxesNormal);
  const normalProof = compileSceneDocument(noAxesNormal, { sourceFunctionChecks: [{ entityId: "normal", expression: "x^2", adjunct: { role: "normal", at: 0 }, equation: { lhs: "x", rhs: "0" } }] });
  assert(normalBefore.ok && normalProof.ok);
  assert.deepEqual(normalProof.renderScene, normalBefore.renderScene, "normal proofs never draw their private witnesses");
  for (const label of ["2*x=0", "2x=0", "2(x)=0", "2x+0y=0", "2e-3x=0", "0=x", "x=sin(0)", "e*x=0"]) {
    const doc = structuredClone(noAxesNormal);
    doc.entities.find(entity => entity.id === "normal")!.label = label;
    await admitted(normalSource, doc);
  }
  for (const change of ["shift", "tilt", "label"] as const) {
    const bad = structuredClone(noAxesNormal);
    const normal = bad.constructions.find(construction => construction.outputs.includes("normal"))!;
    if (change === "shift") normal.inputs = { start: [1, -1], end: [1, 3] };
    if (change === "tilt") normal.inputs = { start: [-1, -1], end: [1, 1] };
    if (change === "label") bad.entities.find(entity => entity.id === "normal")!.label = "x=1";
    assert.match(sceneSaveAdmissionFailure({ question: normalSource, document: bad, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/,
      "normal incidence, direction and equation labels are independently proved without axes");
  }
  for (const label of ["x=x", "x^2=0", "y=0"]) {
    const doc = structuredClone(noAxesNormal);
    doc.entities.find(entity => entity.id === "normal")!.label = label;
    assert.match(sceneSaveAdmissionFailure({ question: normalSource, document: doc, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/,
      "only a genuine affine equation of the normal may label it");
  }
  const companionSource = "Plot y=x and the circle x^2+y^2=1.";
  const companion = graph(companionSource, ["x"], ["y=x"], false);
  Object.assign(companion.constructions[0]!.inputs, { xMin: -4, xMax: 4 });
  companion.source.diagramYieldPolicy = "verified_parts";
  companion.entities.push({ id: "circle", kind: "polyline", role: "implicit circle" });
  companion.constructions.push({ id: "make_circle", operator: "conic", inputs: { kind: "ellipse", center: [0, 0], a: 1, b: 1, samples: 65 }, outputs: ["circle"] });
  companion.requiredEntityIds.push("circle"); companion.revealGroups[0]!.entityIds.push("circle");
  const companionCompiled = compileSceneDocument(companion);
  assert(companionCompiled.ok, `the unlabelled implicit companion must pass the existing compiler guards: ${JSON.stringify(companionCompiled.report.issues)}`);
  await admitted(companionSource, companion, undefined, "verified_parts");
  const missingFunctionSource = "Plot y=x^2 and the circle x^2+y^2=1.";
  const missingFunction = structuredClone(companion);
  missingFunction.source.question = missingFunctionSource;
  assert.match(sceneSaveAdmissionFailure({ question: missingFunctionSource, document: missingFunction, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/,
    "excluding an implicit companion cannot satisfy a missing explicit function");
  const unlabelledParabola = structuredClone(conic);
  delete unlabelledParabola.entities.find(entity => entity.id === "curve_0")!.label;
  unlabelledParabola.source.diagramYieldPolicy = "verified_parts";
  unlabelledParabola.entities.push({ id: "origin", kind: "point", role: "origin", label: "O" });
  unlabelledParabola.constructions.push({ id: "make_origin", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["origin"] });
  unlabelledParabola.requiredEntityIds.push("origin"); unlabelledParabola.revealGroups[0]!.entityIds.push("origin");
  await admitted(conicSource, unlabelledParabola, undefined, "verified_parts");
  const wrongUnlabelled = structuredClone(unlabelledParabola);
  wrongUnlabelled.constructions.find(construction => construction.operator === "conic")!.inputs.p = 0.5;
  assert.match(sceneSaveAdmissionFailure({ question: conicSource, document: wrongUnlabelled, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/,
    "an unlabelled conic needs a successful source proof to count as the required function");
  for (const [source, expression, at, slope, labels] of [
    ["Sketch y=exp(x) and its tangent at x=1.", "exp(x)", 1, Math.E, ["y=e*x", "pi*y=pi*e*x", "y=exp(1)*x"]],
    ["Sketch y=sin(pi*x) and its tangent at x=0.", "sin(pi*x)", 0, Math.PI, ["y=pi*x"]],
    ["Sketch y=sin(x) and its tangent at x=0.", "sin(x)", 0, 1, ["y=cos(0)*x"]],
    ["Sketch y=2*exp(x) and its tangent at x=1.", "2*exp(x)", 1, 2 * Math.E, ["y=2e*x", "y=2exp(1)x", "y=2e(x)"]],
  ] as const) {
    const doc = graph(source, [expression], [`y=${expression}`], false);
    doc.entities.push({ id: "tangent", kind: "line", role: "source tangent", label: labels[0] });
    doc.constructions.push({ id: "make_tangent", operator: "line", inputs: { start: [0, 0], end: [2, 2 * slope] }, outputs: ["tangent"] });
    doc.requiredEntityIds.push("tangent"); doc.revealGroups[0]!.entityIds.push("tangent");
    for (const label of labels) {
      doc.entities.find(entity => entity.id === "tangent")!.label = label;
      const before = compileSceneDocument(doc);
      assert(before.ok, "the constant-expression tangent regression must already compile");
      const proof = compileSceneDocument(doc, { sourceFunctionChecks: [{ entityId: "tangent", expression, adjunct: { role: "tangent", at }, equation: { lhs: label.split("=")[0]!, rhs: label.split("=")[1]! } }] });
      assert(proof.ok, `the complete tangent label must retain constant-expression support: ${label}`);
      assert.deepEqual(proof.renderScene, before.renderScene, "constant-expression proofs leave rendered marks unchanged");
      await admitted(source, doc);
    }
    assert(!compileSceneDocument(doc, { sourceFunctionChecks: [{ entityId: "tangent", expression, adjunct: { role: "tangent", at }, equation: { lhs: "y", rhs: `(${slope})*x+x*(x-2)` } }] }).ok,
      "a nonlinear equation agreeing at both endpoints is not an affine proof");
    for (const label of ["y=2*x", "y=e*x+1", "y=x^2", "y=1/(x-x)"]) {
      const bad = structuredClone(doc);
      bad.entities.find(entity => entity.id === "tangent")!.label = label;
      assert.match(sceneSaveAdmissionFailure({ question: source, document: bad, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/,
        "constant-expression support cannot license false, nonlinear or undefined tangent equations");
    }
  }
  const implicitTangentSource = "Sketch y=x^2 and its tangent at x=1.";
  const implicitTangent = graph(implicitTangentSource, ["x^2"], ["y=x^2"], false);
  implicitTangent.entities.push({ id: "tangent", kind: "line", role: "source tangent", label: "y=2x-1" });
  implicitTangent.constructions.push({ id: "make_tangent", operator: "line", inputs: { start: [0, -1], end: [2, 3] }, outputs: ["tangent"] });
  implicitTangent.requiredEntityIds.push("tangent"); implicitTangent.revealGroups[0]!.entityIds.push("tangent");
  for (const label of ["y=2x-1", "2x-y=1", "2(x)-1=y", "(2)x-1=y", "y=2(x-.5)", "y=2e0x-1", "y/2=x-.5"]) {
    implicitTangent.entities.find(entity => entity.id === "tangent")!.label = label;
    await admitted(implicitTangentSource, implicitTangent);
  }
  for (const label of ["y=2x+1", "y=2x*x-1", "y=2unknown*x", "y=2/(x-x)"]) {
    const bad = structuredClone(implicitTangent);
    bad.entities.find(entity => entity.id === "tangent")!.label = label;
    assert.match(sceneSaveAdmissionFailure({ question: implicitTangentSource, document: bad, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/,
      "implicit multiplication must retain affine, identifier and domain guards");
  }
  assert.throws(() => parseMathExpression("2x"), "executable curve bodies still require explicit multiplication");
  console.log("planner function inventory: production selection, exact selection, all-tier/no-plan save, native curves and JSON reopen controls passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
