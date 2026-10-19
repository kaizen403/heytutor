import assert from "node:assert/strict";
import { compileSceneDocument, completeSceneDocument, sceneUnitSignature, validateSceneDocument, validateTurnPlanV3 } from "../../src/index";
import { completionOwnershipFixtures, coordinateFixture, worldPointFixture, threeWorldPointsFixture, attachmentFixture } from "./fixtures/structured-completion-proof-ownership";

let passed = 0;
for (const fixture of completionOwnershipFixtures) {
  try {
    assert.ok(validateTurnPlanV3(fixture.turnPlan, fixture.turnPlan.question).valid, "invalid source plan fixture");
    const compiled = compileSceneDocument(fixture.document);
    assert.ok(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
    const before = structuredClone(fixture);
    const result = completeSceneDocument(fixture.document, { enabled: true, turnPlan: fixture.turnPlan, baseRenderScene: compiled.renderScene });
    assert.deepEqual(fixture, before, "mutated source inputs");
    assert.equal(result.additions.length, fixture.expectedAdditions, "wrong number of proved source additions");
    if (fixture.annotationOnly) {
      assert.equal(result.addedEntityIds.length, 0, "angle text must not use the vertex label constructor");
      assert.equal(result.addedAnnotationIds.length, fixture.expectedAdditions, "missing native owner annotation");
      for (const addition of result.additions) {
        const annotation = result.document.annotations.find(annotation => annotation.id === addition.id);
        assert.deepEqual(annotation, { id: addition.id, kind: "label", targetIds: addition.targetIds, text: addition.text, labelMode: "append" });
      }
    }
    if (fixture.expectedText) assert.equal(result.additions[0]?.text, fixture.expectedText);
    const proposed = compileSceneDocument(result.document);
    assert.ok(proposed.ok && proposed.renderScene, JSON.stringify(proposed.report.issues));
    if (fixture.annotationOnly) for (const addition of result.additions) {
      assert.ok(proposed.renderScene.primitives.some(primitive => primitive.id === addition.id && primitive.entityId === addition.targetIds[0] && primitive.kind === "label" && primitive.text === addition.text), "native append label did not survive");
      for (const prior of compiled.renderScene.primitives.filter(primitive => primitive.kind === "label"))
        assert.ok(proposed.renderScene.primitives.some(next => next.id === prior.id && next.text === prior.text && next.entityId === prior.entityId && next.groupId === prior.groupId), "append replaced a native owner label");
    }
    if (!fixture.expectedAdditions) assert.equal(result.document, fixture.document, "unproved addition changed the document");
    passed++;
  } catch (error) { console.error(`FAIL ${fixture.id}: ${error instanceof Error ? error.message : String(error)}`); }
}
let directChecks = 0;
function direct(name: string, check: () => void): void {
  directChecks++;
  try { check(); passed++; } catch (error) { console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
direct("absent-mode-is-original-replace", () => {
  const { document } = coordinateFixture("native default identity");
  document.annotations.push({ id: "direct", kind: "label", targetIds: ["P"], text: "source value" });
  const absent = compileSceneDocument(document);
  document.annotations[0]!.labelMode = "replace";
  const explicit = compileSceneDocument(document);
  assert.ok(absent.ok && explicit.ok); assert.deepEqual(explicit.renderScene, absent.renderScene);
});
direct("append-does-not-invent-baseline-angle-measure", () => {
  const { document } = attachmentFixture("unlabelled native arc with opt-in text", "arc");
  document.annotations = [];
  const base = compileSceneDocument(document);
  assert.ok(base.ok && base.renderScene);
  assert.equal(base.renderScene.primitives.filter(primitive => primitive.entityId === "arc" && primitive.kind === "label").length, 0, "fixture arc already had a native label");
  document.annotations.push({ id: "literal_append", kind: "label", targetIds: ["arc"], text: "θ = 45°", labelMode: "append" });
  const proposed = compileSceneDocument(document);
  assert.ok(proposed.ok && proposed.renderScene, JSON.stringify(proposed.report.issues));
  const labels = proposed.renderScene.primitives.filter(primitive => primitive.entityId === "arc" && primitive.kind === "label");
  assert.equal(labels.length, 1, "append text must not feed an automatic second angle label");
  assert.equal(labels[0]!.id, "literal_append");
});
direct("native-append-freezes-entire-existing-render", () => {
  const fixture = threeWorldPointsFixture("three exact source points keep all old native ink");
  assert.ok(validateTurnPlanV3(fixture.turnPlan, fixture.turnPlan.question).valid);
  const base = compileSceneDocument(fixture.document);
  assert.ok(base.ok && base.renderScene, JSON.stringify(base.report.issues));
  const result = completeSceneDocument(fixture.document, { enabled: true, turnPlan: fixture.turnPlan, baseRenderScene: base.renderScene });
  assert.equal(result.addedAnnotationIds.length, 3, "missing owned coordinate gains");
  const proposed = compileSceneDocument(result.document);
  assert.ok(proposed.ok && proposed.renderScene, JSON.stringify(proposed.report.issues));
  for (const prior of base.renderScene.primitives)
    assert.deepEqual(proposed.renderScene.primitives.find(next => next.id === prior.id), prior, `append moved existing primitive ${prior.id}`);
});
for (const [id, value] of [["invalid-mode", "other"], ["quantity-summary-append", "append"], ["empty-text-append", "append"], ["multi-owner-append", "append"]]) direct(id!, () => {
  const { document } = coordinateFixture(id!);
  const annotation = { id: "direct", kind: "label", targetIds: id === "multi-owner-append" ? ["P", "L"] : ["P"], text: id === "empty-text-append" ? "" : "source value" };
  Reflect.set(annotation, "labelMode", value);
  if (id === "quantity-summary-append") Reflect.set(annotation, "quantityId", "px");
  document.annotations.push(annotation);
  const validated = validateSceneDocument(document);
  assert.equal(validated.document, null, "invalid append mode normalized into ordinary label authority");
  assert.ok(validated.report.issues.some(issue => issue.code === "invalid_annotation_label_mode"));
});
direct("framed-world-label-remains-main-refusal", () => {
  const { document } = worldPointFixture("direct MAIN world-label refusal");
  assert.ok(compileSceneDocument(document).ok);
  document.entities.push({ id: "illegal", kind: "label", role: "ungated world label", label: "P" });
  document.constructions.push({ id: "make_illegal", operator: "label", inputs: { target: "P", frame: "frame", text: "P" }, outputs: ["illegal"] });
  document.requiredEntityIds.push("illegal"); document.revealGroups[0]!.entityIds.push("illegal");
  const compiled = compileSceneDocument(document);
  assert.equal(compiled.ok, false); assert.equal(compiled.renderScene, null);
  assert.ok(compiled.report.issues.some(issue => issue.code === "construction_failed" && /world metadata/.test(issue.message)), JSON.stringify(compiled.report.issues));
});
direct("property-unit-signature-is-known-and-finite-only", () => {
  assert.equal(sceneUnitSignature("kg"), "kg^1");
  assert.equal(sceneUnitSignature("μF"), "F^1");
  assert.equal(sceneUnitSignature("m/s^2"), "m^1·s^-2");
  assert.equal(sceneUnitSignature("widgets"), null);
  assert.equal(sceneUnitSignature("km^99999"), null, "overflowing scale must be unproved");
  assert.equal(sceneUnitSignature("cm^99999"), null, "underflowing scale must be unproved");
  assert.equal(sceneUnitSignature(`m^${"9".repeat(400)}`), null, "overflowing spatial power must be unproved");
  assert.equal(sceneUnitSignature("dimensionless"), "");
});
const total = completionOwnershipFixtures.length + directChecks;
console.log(`completion-proof-ownership: ${passed}/${total} passed`);
if (passed !== total) process.exitCode = 1;
