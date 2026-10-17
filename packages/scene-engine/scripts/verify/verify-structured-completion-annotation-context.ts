import assert from "node:assert/strict";
import {
  compileSceneDocument, completeSceneDocument, validateSceneDocument, validateTurnPlanV3,
  type SceneDocument, type TurnPlanV3,
} from "../../src/index";

interface Fixture {
  id: string;
  document: SceneDocument;
  turnPlan: TurnPlanV3;
  expected: { targetId: string; quantityId: string; text: string }[];
  annotationInk?: { id: string; targetId: string; text: string; rendered: boolean };
}
const clone = <T>(value: T): T => structuredClone(value);
function scalarFixture(id: string): Fixture {
  const question = "Draw body B with its given mass m = 3 kg.";
  const quantity = { id: "mass", symbol: "m", value: 3, unit: "kg", provenance: "given" as const };
  const turnPlan: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [quantity],
    unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [],
  };
  const document: SceneDocument = {
    schemaVersion: "scene-document/v2", source: { question },
    visualDecision: { mode: "scene", reason: "source-given finite body" }, quantities: [clone(quantity)],
    entities: [
      { id: "center", kind: "point", role: "body center" },
      { id: "body", kind: "rectangle", role: "given body", label: "B" },
      { id: "otherCenter", kind: "point", role: "second body center" },
      { id: "otherBody", kind: "rectangle", role: "second body", label: "C" },
    ],
    constructions: [
      { id: "makeCenter", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["center"] },
      { id: "makeBody", operator: "rectangle", inputs: { center: "center", width: 2, height: 1 }, outputs: ["body"] },
      { id: "makeOtherCenter", operator: "point", inputs: { x: 5, y: 3, coordinateSpace: "world" }, outputs: ["otherCenter"] },
      { id: "makeOtherBody", operator: "rectangle", inputs: { center: "otherCenter", width: 2, height: 1 }, outputs: ["otherBody"] },
    ], relations: [], assertions: [],
    annotations: [{ id: "massAttachment", kind: "callout", quantityId: "mass", targetIds: ["body"] }],
    requiredEntityIds: ["body", "otherBody"],
    revealGroups: [{ id: "setup", entityIds: ["center", "body", "otherCenter", "otherBody"], dependsOn: [], narrationCue: "Show the given bodies." }],
    teachingTimeline: [],
  };
  return { id, document, turnPlan, expected: [{ targetId: "body", quantityId: "mass", text: "m = 3 kg" }] };
}
const fixtures: Fixture[] = [];
for (const [id, text] of [
  ["owned-rendered-annotation-decimal-typography-does-not-duplicate", "m=3.0 kg"],
  ["owned-rendered-annotation-conflicting-statement-abstains", "m=4 kg"],
] as const) {
  const fixture = scalarFixture(id);
  fixture.document.annotations[0] = { id: "massStatement", kind: "label", quantityId: "mass", targetIds: ["body"], text };
  fixture.annotationInk = { id: "massStatement", targetId: "body", text, rendered: true };
  fixture.expected = []; fixtures.push(fixture);
}
const bare = scalarFixture("owned-rendered-bare-identifier-remains-completable");
bare.document.annotations[0] = { id: "massIdentifier", kind: "label", quantityId: "mass", targetIds: ["body"], text: "m" };
bare.annotationInk = { id: "massIdentifier", targetId: "body", text: "m", rendered: true }; fixtures.push(bare);
for (const sameOwner of [true, false]) {
  const fixture = scalarFixture(sameOwner ? "other-quantity-id-on-same-owner-does-not-suppress" : "other-owner-statement-does-not-suppress");
  fixture.document.quantities.push(sameOwner
    ? { id: "otherMass", symbol: "q", value: 5, unit: "C" }
    : { id: "otherMass", symbol: "m", value: 3, unit: "kg" });
  const targetId = sameOwner ? "body" : "otherBody";
  const text = sameOwner ? "q=5 C" : "m=3.0 kg";
  fixture.document.annotations.push({ id: "otherStatement", kind: "label", quantityId: "otherMass", targetIds: [targetId], text });
  fixture.annotationInk = { id: "otherStatement", targetId, text, rendered: true }; fixtures.push(fixture);
}
const alias = scalarFixture("same-owner-other-quantity-id-declares-same-symbol-abstains");
alias.document.quantities.push({ id: "otherMass", symbol: "m", value: 3, unit: "kg" });
alias.document.annotations.push({ id: "otherStatement", kind: "label", quantityId: "otherMass", targetIds: ["body"], text: "m=3.0 kg" });
alias.annotationInk = { id: "otherStatement", targetId: "body", text: "m=3.0 kg", rendered: true };
alias.expected = []; fixtures.push(alias);
const narration = scalarFixture("unrendered-quantity-narration-does-not-suppress");
narration.document.annotations[0] = { id: "massNarration", kind: "narration", quantityId: "mass", targetIds: ["body"], text: "m=3.0 kg" };
narration.annotationInk = { id: "massNarration", targetId: "body", text: "m=3.0 kg", rendered: false }; fixtures.push(narration);
for (const operator of ["line", "ray"] as const) for (const placementIntent of ["above", "below", undefined] as const) {
  const fixture = scalarFixture(`unbounded-${operator}-scalar-${placementIntent ?? "omitted"}-intent-has-no-region-authority`);
  fixture.document.entities.find(entity => entity.id === "body")!.kind = operator;
  delete fixture.document.entities.find(entity => entity.id === "body")!.label;
  const construction = fixture.document.constructions.find(item => item.id === "makeBody")!;
  construction.operator = operator; construction.inputs = { start: "center", direction: [1, 0] };
  fixture.document.annotations[0] = { id: "massAttachment", kind: "callout", quantityId: "mass", targetIds: ["body"],
    ...(placementIntent === undefined ? {} : { placementIntent }) };
  fixture.expected = []; fixtures.push(fixture);
}
fixtures.push(scalarFixture("finite-body-without-rendered-statement-remains-completable"));
const segment = scalarFixture("finite-segment-native-line-ink-remains-completable");
segment.document.entities.find(entity => entity.id === "body")!.kind = "segment";
segment.document.entities.find(entity => entity.id === "body")!.label = "S";
const segmentConstruction = segment.document.constructions.find(item => item.id === "makeBody")!;
segmentConstruction.operator = "segment"; segmentConstruction.inputs = { start: "center", end: "otherCenter" };
fixtures.push(segment);

for (const operator of ["line", "ray", "rectangle", "segment"] as const) {
  const unbounded = operator === "line" || operator === "ray";
  const fixture = scalarFixture(`explicit-unknown-${operator}-${unbounded ? "has-no-region-owner" : "finite-owner-remains-completable"}`);
  const question = unbounded
    ? "Draw a straight boundary between two regions. The scalar property n of the region above the boundary is undetermined."
    : "Draw bodies B and C with the unknown property n attached to B. The value of n is undetermined.";
  fixture.turnPlan.question = question;
  fixture.turnPlan.givens = [];
  fixture.turnPlan.unknowns = [{ id: "property", symbol: "n" }];
  fixture.turnPlan.qualitativeClaims = [{ id: "undeterminedProperty", claim: "The value of n is undetermined",
    expected: "undetermined", relatedQuantityIds: ["property"] }];
  fixture.document.source.question = question;
  fixture.document.quantities = [{ id: "property", symbol: "n" }];
  fixture.document.annotations = [{ id: "unknownAttachment", kind: "callout", quantityId: "property", targetIds: ["body"] }];
  const owner = fixture.document.entities.find(entity => entity.id === "body")!;
  const construction = fixture.document.constructions.find(item => item.id === "makeBody")!;
  owner.kind = operator;
  if (unbounded) {
    delete owner.label;
    construction.operator = operator; construction.inputs = { start: "center", direction: [1, 0] };
    fixture.document.constructions.find(item => item.id === "makeOtherCenter")!.inputs = { x: 0, y: 0, coordinateSpace: "world" };
  } else if (operator === "segment") {
    construction.operator = operator; construction.inputs = { start: "center", end: "otherCenter" };
  }
  fixture.expected = unbounded ? [] : [{ targetId: "body", quantityId: "property", text: "n = ?" }];
  fixtures.push(fixture);
}

// The complete literal contract is printable before any validation or runtime call.
if (process.argv.includes("--print-fixtures")) {
  console.log(JSON.stringify({ schemaVersion: "structured-completion-annotation-context-fixtures/v1", fixtures }, null, 2));
} else {
  let failed = 0;
  for (const fixture of fixtures) {
    try {
      const document = clone(fixture.document), turnPlan = clone(fixture.turnPlan);
      assert.equal(validateTurnPlanV3(turnPlan, String(document.source.question)).valid, true, "native fixture plan must be valid");
      const normalized = validateSceneDocument(document);
      assert.ok(normalized.document, JSON.stringify(normalized.report.issues));
      const base = compileSceneDocument(normalized.document);
      assert.ok(base.ok && base.renderScene, `native baseline: ${JSON.stringify(base.report.issues)}`);
      if (fixture.annotationInk) {
        const expected = fixture.annotationInk;
        const ink = base.renderScene.primitives.find(primitive => primitive.id === expected.id && primitive.kind === "label" &&
          primitive.entityId === expected.targetId && primitive.text === expected.text);
        assert.equal(Boolean(ink), expected.rendered, "fixture must independently establish whether the exact native annotation ink exists");
      }
      const before = clone({ document: normalized.document, turnPlan, renderScene: base.renderScene });
      const result = completeSceneDocument(normalized.document, { enabled: true, turnPlan, baseRenderScene: base.renderScene });
      assert.deepEqual({ document: normalized.document, turnPlan, renderScene: base.renderScene }, before, "completion mutated caller authority");
      assert.equal(result.additions.length, fixture.expected.length, "unexpected completion count for annotation ownership/context");
      if (!fixture.expected.length) {
        assert.deepEqual(result.document, before.document, "abstention changed native source document");
        assert.deepEqual(result.addedEntityIds, []); assert.deepEqual(result.addedAnnotationIds, []); continue;
      }
      for (const expected of fixture.expected) {
        const additions = result.additions.filter(addition => addition.targetIds.length === 1 && addition.targetIds[0] === expected.targetId &&
          addition.quantityIds.length === 1 && addition.quantityIds[0] === expected.quantityId && addition.text === expected.text);
        assert.equal(additions.length, 1, "legitimate finite-owner statement lost exact source ID, owner or value");
        const addition = additions[0]!;
        const native = compileSceneDocument(result.document);
        assert.ok(native.ok && native.renderScene, JSON.stringify(native.report.issues));
        assert.ok(native.renderScene.primitives.some(primitive => primitive.kind === "label" && primitive.entityId === addition.id && primitive.text === expected.text),
          "specific proposed statement did not survive as native ink");
        for (const old of base.renderScene.primitives.filter(primitive => primitive.kind !== "label" && primitive.provenance?.labelLeader !== true))
          assert.deepEqual(native.renderScene.primitives.find(primitive => primitive.id === old.id), old, "annotation completion changed physical geometry");
        const again = completeSceneDocument(result.document, { enabled: true, turnPlan, baseRenderScene: native.renderScene });
        assert.deepEqual(again.additions, [], "native completion was not idempotent");
        assert.deepEqual(again.document, result.document, "second completion changed accepted document");
      }
      console.log(`PASS ${fixture.id}`);
    } catch (error) {
      failed += 1; console.error(`FAIL ${fixture.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`structured-completion annotation context: ${fixtures.length - failed}/${fixtures.length} fixtures passed`);
  if (failed) process.exitCode = 1;
}
