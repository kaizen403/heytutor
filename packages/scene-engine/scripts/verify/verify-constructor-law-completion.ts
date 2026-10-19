import assert from "node:assert/strict";
import {
  compileSceneDocument, completeSceneDocument, validateSceneDocument, validateTurnPlanV3,
  type SceneDocument, type TurnPlanV3,
} from "../../src/index";

/** Authored geometric controls only; no recorded question text or fixture lookup. */
interface Fixture { id: string; document: SceneDocument; expectedOwners: string[][] }
const clone = <T>(value: T): T => structuredClone(value);
function document(): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "authored constructor-law control" },
    source: { question: "Show the constructed geometry inside its reference frame.", nonMetric: true }, quantities: [],
    entities: [{ id: "center", kind: "point", role: "reference frame center" }, { id: "frame", kind: "rectangle", role: "reference frame" }],
    constructions: [
      { id: "make_center", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["center"] },
      { id: "make_frame", operator: "rectangle", inputs: { center: "center", width: 8, height: 8 }, outputs: ["frame"] },
    ], relations: [], assertions: [], annotations: [], requiredEntityIds: ["frame"],
    revealGroups: [{ id: "setup", entityIds: ["frame"], dependsOn: [], narrationCue: "Show the construction." }], teachingTimeline: [],
  };
}
function point(doc: SceneDocument, id: string, x: number, y: number): void {
  doc.entities.push({ id, kind: "point", role: "constructed point" });
  doc.constructions.push({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] });
  doc.revealGroups[0]!.entityIds.push(id);
}
function construction(doc: SceneDocument, id: string, operator: string, inputs: Record<string, unknown>, kind = "line"): void {
  doc.entities.push({ id, kind, role: "constructed geometry" });
  doc.constructions.push({ id: `make_${id}`, operator, inputs, outputs: [id] });
  doc.requiredEntityIds.push(id); doc.revealGroups[0]!.entityIds.push(id);
}
function projected(): Fixture {
  const doc = document(); point(doc, "L", -3, 0); point(doc, "R", 3, 0); point(doc, "P", 1, 2);
  construction(doc, "base", "segment", { start: "L", end: "R" }, "segment");
  construction(doc, "foot", "project", { point: "P", line: "base" }, "point");
  construction(doc, "drop", "segment", { start: "P", end: "foot" }, "segment");
  return { id: "project-foot-and-visible-connector", document: doc, expectedOwners: [["base", "drop"]] };
}
function analytic(): Fixture {
  const doc = document(); remove(doc, "frame"); remove(doc, "center");
  construction(doc, "curve", "function_curve", { expression: "x^2", xMin: -2, xMax: 2 }, "polyline");
  construction(doc, "P", "curve_anchor", { curve: "curve", at: 0.5 }, "point");
  construction(doc, "tangent", "tangent_line", { curve: "curve", at: 0.5, span: 3 });
  construction(doc, "normal", "normal_line", { curve: "curve", at: 0.5, span: 3 });
  return { id: "same-curve-parameter-and-anchor", document: doc, expectedOwners: [["tangent", "normal"]] };
}
function optical(mode: "reflect_at" | "refract_at"): Fixture {
  const doc = document(); point(doc, "L", -3, 0); point(doc, "R", 3, 0); point(doc, "O", 0, 0);
  construction(doc, "surface", "segment", { start: "L", end: "R" }, "segment");
  doc.entities.push(...["incoming", "normal", "outgoing"].map(id => ({ id, kind: id === "normal" ? "line" : "ray", role: "ray-bundle output" })));
  doc.constructions.push({ id: "make_bundle", operator: mode, inputs: { point: "O", surface: "surface", incidentAngleDeg: 35,
    ...(mode === "refract_at" ? { n1: 1, n2: 1.5 } : {}) }, outputs: ["incoming", "normal", "outgoing"] });
  doc.requiredEntityIds.push("incoming", "normal", "outgoing"); doc.revealGroups[0]!.entityIds.push("incoming", "normal", "outgoing");
  return { id: `straight-surface-${mode}`, document: doc, expectedOwners: [["surface", "normal"]] };
}
function vary(base: Fixture, id: string, edit: (doc: SceneDocument) => void, expectedOwners: string[][] = []): Fixture {
  const doc = clone(base.document); edit(doc); return { id, document: doc, expectedOwners };
}
function remove(doc: SceneDocument, id: string): void {
  doc.entities = doc.entities.filter(entity => entity.id !== id);
  doc.constructions = doc.constructions.filter(candidate => !candidate.outputs.includes(id));
  doc.requiredEntityIds = doc.requiredEntityIds.filter(candidate => candidate !== id);
  for (const group of doc.revealGroups) group.entityIds = group.entityIds.filter(candidate => candidate !== id);
}
const project = projected(), curve = analytic(), reflection = optical("reflect_at"), refraction = optical("refract_at");
const fixtures: Fixture[] = [project, curve, reflection, refraction,
  vary(project, "reversed-connector-endpoints", doc => { doc.constructions.find(c => c.outputs.includes("drop"))!.inputs = { start: "foot", end: "P" }; }, project.expectedOwners),
  vary(curve, "same-quantity-reference-and-native-aliases", doc => {
    doc.quantities.push({ id: "t", symbol: "t", value: 0.5 });
    doc.constructions.find(c => c.outputs.includes("P"))!.inputs.at = "t";
    doc.constructions.find(c => c.outputs.includes("tangent"))!.inputs = { target: "curve", parameter: "t", span: 3 };
    doc.constructions.find(c => c.outputs.includes("normal"))!.inputs = { curve: "curve", atX: "t", span: 3 };
  }, curve.expectedOwners),
  vary(reflection, "constructed-contact-does-not-require-a-point-dot", doc => {
    doc.revealGroups[0]!.entityIds = doc.revealGroups[0]!.entityIds.filter(id => id !== "O");
  }, reflection.expectedOwners),
  vary(project, "projection-without-a-visible-connector", doc => remove(doc, "drop")),
  vary(project, "separately-revealed-arms-remain-deferred", doc => {
    doc.revealGroups[0]!.entityIds = doc.revealGroups[0]!.entityIds.filter(id => id !== "drop");
    doc.revealGroups.push({ id: "later", entityIds: ["drop"], dependsOn: ["setup"], narrationCue: "Show the connector." });
  }),
  vary(curve, "different-curve-reference-does-not-join", doc => {
    construction(doc, "other_curve", "function_curve", { expression: "x^2+0.5", xMin: -1.8, xMax: 1.8 }, "polyline");
    doc.constructions.find(c => c.outputs.includes("normal"))!.inputs.curve = "other_curve";
  }),
  vary(curve, "different-parameter-does-not-join", doc => { doc.constructions.find(c => c.outputs.includes("normal"))!.inputs.at = 0.75; }),
  vary(curve, "equal-valued-distinct-parameter-ids-do-not-join", doc => {
    doc.quantities.push({ id: "t1", symbol: "t_1", value: 0.5 }, { id: "t2", symbol: "t_2", value: 0.5 });
    doc.constructions.find(c => c.outputs.includes("P"))!.inputs.at = "t1";
    doc.constructions.find(c => c.outputs.includes("tangent"))!.inputs.at = "t1";
    doc.constructions.find(c => c.outputs.includes("normal"))!.inputs.at = "t2";
  }),
  vary(curve, "multiple-matching-normals-are-ambiguous", doc => { construction(doc, "other_normal", "normal_line", { curve: "curve", at: 0.5, span: 3 }); }),
  vary(curve, "multiple-matching-tangents-are-ambiguous", doc => { construction(doc, "other_tangent", "tangent_line", { curve: "curve", at: 0.5, span: 4 }); }),
  vary(curve, "missing-existing-anchor-is-not-invented", doc => remove(doc, "P")),
  vary(curve, "native-minimum-extent-is-not-relaxed", doc => {
    point(doc, "box_center", 0, 0);
    construction(doc, "box", "rectangle", { center: "box_center", width: 8, height: 8 }, "rectangle");
  }),
  vary(curve, "mark-that-moves-the-native-view-is-rejected", doc => {
    doc.constructions.find(c => c.outputs.includes("curve"))!.inputs.expression = "-x^2";
    for (const candidate of doc.constructions.filter(c => ["curve_anchor", "tangent_line", "normal_line"].includes(c.operator))) candidate.inputs.at = 0;
  }),
  vary(reflection, "hidden-normal-owner-is-not-revealed", doc => {
    doc.requiredEntityIds = doc.requiredEntityIds.filter(id => id !== "normal");
    doc.revealGroups[0]!.entityIds = doc.revealGroups[0]!.entityIds.filter(id => id !== "normal");
  }),
  vary(reflection, "existing-mark-is-not-duplicated", doc => {
    construction(doc, "old_mark", "right_angle_mark", { vertex: "O", a: "R", b: "normal", size: 0.5 }, "right_angle_mark");
  }),
  vary(reflection, "curved-surface-does-not-authorize-a-straight-corner", doc => {
    remove(doc, "surface"); point(doc, "C", 0, -2);
    construction(doc, "surface", "circle", { center: "C", radius: 2 }, "circle");
  }),
];

const failures: string[] = [];
for (const fixture of fixtures) {
  try {
    const question = String(fixture.document.source.question);
    const turnPlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [],
      qualitativeClaims: [{ id: "construction", claim: "constructed incidence", expected: true }], lawIds: [], assumptions: [], visualRequirement: "required" };
    assert.ok(validateTurnPlanV3(turnPlan, question).valid, "authored qualitative plan is valid");
    const validation = validateSceneDocument(fixture.document);
    assert.ok(validation.document, JSON.stringify(validation.report.issues));
    const original = clone(validation.document), baseline = compileSceneDocument(validation.document);
    assert.ok(baseline.ok && baseline.renderScene, `baseline must draw: ${JSON.stringify(baseline.report.issues)}`);
    const off = completeSceneDocument(validation.document, { turnPlan, baseRenderScene: baseline.renderScene });
    assert.equal(off.document, validation.document); assert.deepEqual(off.additions, [], "flag defaults off");
    const labelsOnly = completeSceneDocument(validation.document, { enabled: true, turnPlan, baseRenderScene: baseline.renderScene });
    assert.equal(labelsOnly.document, validation.document); assert.deepEqual(labelsOnly.additions, [], "existing completion opt-in alone retains its original contract");
    const completed = completeSceneDocument(validation.document, { enabled: true, constructorLawsEnabled: true, turnPlan, baseRenderScene: baseline.renderScene });
    assert.deepEqual(validation.document, original, "completion cannot mutate caller-owned input");
    assert.deepEqual(completed.additions.map(addition => addition.targetIds), fixture.expectedOwners, `only the law-bound original stroke owners may gain a mark: ${JSON.stringify(completed.skipped)}`);
    assert.ok(completed.additions.every(addition => addition.kind === "right_angle" && addition.quantityIds.length === 0), "no force, axes or quantity feature");
    if (!fixture.expectedOwners.length) {
      assert.equal(completed.document, validation.document, "unsafe or unavailable additions retain the original document");
    } else {
      for (const key of ["entities", "constructions", "annotations", "assertions", "requiredEntityIds"] as const)
        assert.deepEqual(completed.document[key].slice(0, original[key].length), original[key], `old ${key} prefix is immutable`);
      const compiled = compileSceneDocument(completed.document);
      assert.ok(compiled.ok && compiled.renderScene, `completed mark must draw: ${JSON.stringify(compiled.report.issues)}`);
      for (const prior of baseline.renderScene.primitives)
        assert.deepEqual(compiled.renderScene.primitives.find(next => next.id === prior.id), prior, "all old ink, labels and metadata are exact");
      for (const addition of completed.additions) {
        assert.ok(compiled.renderScene.primitives.some(primitive => primitive.entityId === addition.id && primitive.kind !== "label"), "new native right-angle ink survives");
        assert.equal(completed.document.assertions.filter(a => a.id.startsWith(`assert_${addition.id}_`) && a.severity === "fatal").length, 3, "native perpendicular and both incidence proofs are fatal");
      }
      const again = completeSceneDocument(completed.document, { enabled: true, constructorLawsEnabled: true, turnPlan, baseRenderScene: compiled.renderScene });
      assert.deepEqual(again.additions, [], "constructor-law completion is idempotent");
    }
    console.log(`PASS ${fixture.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(fixture.id); console.error(`FAIL ${fixture.id}: ${message}`);
  }
}
console.log(`constructor-law-completion: ${fixtures.length - failures.length}/${fixtures.length} passed`);
assert.deepEqual(failures, [], "constructor-law completion cases failed");
