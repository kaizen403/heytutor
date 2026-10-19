import assert from "node:assert/strict";
import { mock } from "node:test";
import * as engine from "@heytutor/scene-engine";
import type { SelectedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";

interface Fixture {
  id: string;
  mode: "actual" | "native_proposal";
  document: engine.SceneDocument;
  turnPlan: engine.TurnPlanV3;
  expected: "reject_crossing" | "adopt_preserving_labels";
  oldLabelId: string;
  targetId: string;
}
const clone = <T>(value: T): T => structuredClone(value);
function reflectionFixture(id: string, incidence: number, boundaryDegrees = 0, mode: Fixture["mode"] = "actual"): Fixture {
  const question = `Draw a reflection setup with the given incidence i = ${incidence} degrees and label air and diamond.`;
  const quantity = { id: "incidence", symbol: "i", value: incidence, unit: "°", provenance: "given" as const };
  const turnPlan: engine.TurnPlanV3 = {
    schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [quantity],
    unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [],
  };
  const angle = boundaryDegrees * Math.PI / 180;
  const document: engine.SceneDocument = {
    schemaVersion: "scene-document/v2", source: { question, representationTier: "qualitative_verified", nonMetric: true },
    visualDecision: { mode: "scene", reason: "source-given incidence at a straight boundary" }, quantities: [clone(quantity)],
    entities: [
      { id: "contact", kind: "point", role: "contact" },
      { id: "boundary", kind: "line", role: "interface" },
      { id: "incoming", kind: "ray", role: "incident" },
      { id: "perpendicular", kind: "line", role: "normal" },
      { id: "outgoing", kind: "ray", role: "reflected" },
      { id: "givenAngle", kind: "angle_mark", role: "incidence", label: "i" },
    ],
    constructions: [
      { id: "makeContact", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["contact"] },
      { id: "makeBoundary", operator: "line", inputs: { start: "contact", direction: [Math.cos(angle), Math.sin(angle)] }, outputs: ["boundary"] },
      { id: "makeReflection", operator: "reflect_at", inputs: { point: "contact", surface: "boundary", incidentAngleDeg: "incidence" }, outputs: ["incoming", "perpendicular", "outgoing"] },
      { id: "makeAngle", operator: "angle_mark", inputs: { vertex: "contact", a: "incoming", b: "perpendicular" }, outputs: ["givenAngle"] },
    ], relations: [], assertions: [
      { id: "contactOnBoundary", predicate: "on", entities: ["contact", "boundary"], expected: true, severity: "fatal" },
      { id: "normalToBoundary", predicate: "perpendicular", entities: ["perpendicular", "boundary"], expected: true, severity: "fatal" },
      { id: "equalReflectionAngles", predicate: "equal_angle", entities: ["incoming", "perpendicular", "outgoing", "perpendicular"], expected: true, severity: "fatal" },
    ], annotations: [
      { id: "firstRegion", kind: "label", targetIds: ["boundary"], text: "air", placementIntent: "above" },
      { id: "secondRegion", kind: "label", targetIds: ["incoming"], text: "diamond", placementIntent: "below" },
      { id: "givenIncidence", kind: "callout", targetIds: ["givenAngle"], quantityId: "incidence" },
    ], requiredEntityIds: ["contact", "boundary", "incoming", "perpendicular", "outgoing", "givenAngle"],
    revealGroups: [{ id: "setup", entityIds: ["contact", "boundary", "incoming", "perpendicular", "outgoing", "givenAngle"], dependsOn: [], narrationCue: "Show the given reflection setup." }],
    teachingTimeline: [],
  };
  // Historical fixture names preserve the original repros. Native append now
  // fixes their old placements; the injected old constructor must still fail.
  return { id, mode, document, turnPlan, expected: mode === "native_proposal" ? "reject_crossing" : "adopt_preserving_labels", oldLabelId: "firstRegion", targetId: "boundary" };
}
const fixtures: Fixture[] = [
  reflectionFixture("actual-native-angle-completion-cannot-cross-old-annotation-boundary-36", 36),
  reflectionFixture("actual-native-angle-completion-cannot-cross-old-annotation-boundary-41", 41),
  reflectionFixture("injected-native-proposal-cannot-cross-old-annotation-boundary", 36, 0, "native_proposal"),
  reflectionFixture("same-side-old-annotation-motion-remains-adoptable", 36, 15),
];
function nativeProposal(document: engine.SceneDocument, turnPlan: engine.TurnPlanV3): engine.SceneCompletionResult {
  const next = clone(document), id = "nativeGiven", text = `i = ${turnPlan.givens[0]!.value} °`;
  next.entities.push({ id, kind: "label", role: "given incidence statement", label: text });
  next.constructions.push({ id: "makeNativeGiven", operator: "label", inputs: { target: "givenAngle", text }, outputs: [id] });
  next.assertions.push({ id: "nativeGivenExists", predicate: "exists", entities: [id], expected: true, severity: "fatal" });
  next.requiredEntityIds.push(id); next.revealGroups[0]!.entityIds.push(id);
  return { document: next, addedEntityIds: [id], addedAnnotationIds: [], skipped: [],
    additions: [{ id, kind: "given_angle", quantityIds: ["incidence"], targetIds: ["givenAngle"], text }] };
}

// Export literal fixture inputs and independent effect oracles before runtime calls.
if (process.argv.includes("--print-fixtures")) {
  console.log(JSON.stringify({ schemaVersion: "structured-completion-boundary-admission-fixtures/v1", fixtures,
    nativeProposals: fixtures.filter(fixture => fixture.mode === "native_proposal").map(fixture => ({ id: fixture.id, proposal: nativeProposal(fixture.document, fixture.turnPlan) })),
    oracle: { epsilonPx: 0.5, box: "all four native provenance.labelBounds corners", boundary: "unchanged exact own native straight target", rejected: "exact selected baseline retained", positive: "every old native primitive, label box and leader stays exact; new own native ink survives admission/save/reopen" },
  }, null, 2));
} else {
  async function main(): Promise<void> {
    let active: Fixture | undefined, calls = 0;
    mock.module("@heytutor/scene-engine", { namedExports: { ...engine,
      completeSceneDocument(document: engine.SceneDocument, input: engine.SceneCompletionInput) {
        calls += 1;
        return active?.mode === "native_proposal" ? nativeProposal(document, input.turnPlan) : engine.completeSceneDocument(document, input);
      },
    } });
    const { selectProductionScene, validateProductionSceneCandidate } = await import("../../features/tutor-session/lib/scene/productionSceneSelection");
    const { liveSceneSaveFailure } = await import("../../lib/scene/sceneSaveAdmission");
    function label(render: engine.RenderScene, id: string, owner: string): engine.RenderScene["primitives"][number] {
      const candidates = render.primitives.filter(primitive => primitive.id === id && primitive.entityId === owner && primitive.kind === "label");
      assert.equal(candidates.length, 1, "old annotation must have its exact own native label ID and owner"); return candidates[0]!;
    }
    function side(render: engine.RenderScene, labelId: string, owner: string): number {
      const ink = label(render, labelId, owner), bounds = ink.provenance?.labelBounds;
      assert.ok(bounds && typeof bounds === "object" &&
        "x" in bounds && typeof bounds.x === "number" && "y" in bounds && typeof bounds.y === "number" &&
        "width" in bounds && typeof bounds.width === "number" && "height" in bounds && typeof bounds.height === "number" &&
        [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite), "native label box is required");
      const box = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      const targets = render.primitives.filter(primitive => primitive.entityId === owner && ["line", "ray"].includes(primitive.kind) && primitive.provenance?.labelLeader !== true);
      assert.equal(targets.length, 1, "fixture must have one physical own straight boundary");
      const points = targets[0]!.points; assert.equal(points.length, 2);
      const [a, b] = points, dx = b!.x - a!.x, dy = b!.y - a!.y, length = Math.hypot(dx, dy);
      assert.ok(length > 0);
      const distances = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
        .map(([x, y]) => (dx * (y! - a!.y) - dy * (x! - a!.x)) / length);
      return distances.every(value => value > 0.5) ? 1 : distances.every(value => value < -0.5) ? -1 : 0;
    }
    let failed = 0;
    for (const fixture of fixtures) {
      try {
        const plan = clone(fixture.turnPlan), source = clone(fixture.document), question = String(source.source.question);
        assert.equal(engine.validateTurnPlanV3(plan, question).valid, true);
        const baseline = validateProductionSceneCandidate({ candidate: source as unknown as Record<string, unknown>, question, turnPlan: plan });
        assert.ok(baseline.valid && baseline.value, `baseline admission: ${JSON.stringify(baseline.errors)}`);
        const value = baseline.value;
        const selected: SelectedRepresentation = { tier: "qualitative_verified", nonMetric: true, figureSource: "planner", reason: "native admitted baseline",
          sceneDocument: value.document, renderScene: value.renderScene, validationReport: value.report };
        assert.equal(liveSceneSaveFailure({ document: selected.sceneDocument, question, turnPlan: plan, tier: selected.tier }), null, "baseline must pass ordinary production save");
        const baseSide = side(selected.renderScene, fixture.oldLabelId, fixture.targetId);
        assert.notEqual(baseSide, 0, "old native annotation box must start wholly in a strict physical half-plane");
        const before = clone({ selected, plan });
        const proposal = fixture.mode === "native_proposal" ? nativeProposal(clone(value.document), plan)
          : engine.completeSceneDocument(clone(value.document), { enabled: true, turnPlan: plan, baseRenderScene: clone(value.renderScene) });
        assert.equal(proposal.additions.length, 1, "fixture must propose one source-given native angle label");
        const ordinary = validateProductionSceneCandidate({ candidate: proposal.document as unknown as Record<string, unknown>, question, turnPlan: plan });
        assert.ok(ordinary.valid && ordinary.value, `proposal must pass pre-existing ordinary admission: ${JSON.stringify(ordinary.errors)}`);
        assert.equal(liveSceneSaveFailure({ document: ordinary.value.document, question, turnPlan: plan, tier: selected.tier }), null, "proposal must pass ordinary save before the retention guard");
        for (const old of selected.renderScene.primitives.filter(primitive => primitive.kind !== "label" && primitive.provenance?.labelLeader !== true))
          assert.deepEqual(ordinary.value.renderScene.primitives.find(primitive => primitive.id === old.id), old, "native proposal changed physical geometry");
        const proposalSide = side(ordinary.value.renderScene, fixture.oldLabelId, fixture.targetId);
        if (fixture.expected === "reject_crossing") assert.notEqual(proposalSide, baseSide, "fixture must independently reproduce a whole-box crossing or straddle");
        else {
          assert.equal(proposalSide, baseSide, "positive proposal must keep its full box in the baseline half-plane");
          for (const old of selected.renderScene.primitives) assert.deepEqual(ordinary.value.renderScene.primitives.find(primitive => primitive.id === old.id), old,
            "native append must retain every old primitive, label, box and leader before selection");
        }
        active = fixture; calls = 0;
        const output = selectProductionScene({ question, turnPlan: plan, problemIR: null, fastRepresentation: selected, completionEnabled: true });
        assert.equal(calls, 1); assert.deepEqual({ selected, plan }, before, "proposal mutated caller or selected fallback");
        assert.ok(output.representation); assert.equal(output.visualStatus, "validated"); assert.equal(output.saveFailure, null);
        if (fixture.expected === "reject_crossing") {
          assert.equal(output.completion?.adopted, false, "completion adopted an old annotation across its native physical boundary");
          assert.deepEqual(output.representation, before.selected, "boundary rejection must retain the exact valid selected baseline");
          assert.match(output.completion?.rejection ?? "", /annotation.*boundary|boundary.*annotation/i, "rejection must identify the annotation boundary retention failure");
        } else {
          assert.equal(output.completion?.adopted, true, "native append that preserves all old ink should remain adoptable");
          const adopted = output.representation;
          assert.equal(side(adopted.renderScene, fixture.oldLabelId, fixture.targetId), baseSide);
          for (const old of selected.renderScene.primitives) assert.deepEqual(adopted.renderScene.primitives.find(primitive => primitive.id === old.id), old,
            "adoption cannot move or replace any old native primitive");
          for (const addition of output.completion!.additions) {
            const annotation = proposal.addedAnnotationIds.includes(addition.id);
            const owner = annotation ? addition.targetIds[0] : addition.id;
            const marks = adopted.renderScene.primitives.filter(primitive => primitive.kind === "label" && primitive.entityId === owner && primitive.text === addition.text);
            assert.equal(marks.length, 1, "specific new native statement ink was lost or duplicated");
            assert.equal(marks[0]!.groupId, selected.sceneDocument.revealGroups.find(group => group.entityIds.includes(addition.targetIds[0]!))?.id);
            if (annotation) {
              assert.equal(marks[0]!.id, addition.id);
              const record = adopted.sceneDocument.annotations.find(candidate => candidate.id === addition.id);
              assert.ok(record); assert.equal(record.labelMode, "append"); assert.equal(record.quantityId, undefined);
              assert.deepEqual(record.targetIds, addition.targetIds); assert.equal(record.text, addition.text);
            }
          }
          const reopened = engine.validateSceneDocument(JSON.parse(JSON.stringify(adopted.sceneDocument)));
          assert.ok(reopened.document);
          const native = engine.compileSceneDocument(reopened.document); assert.ok(native.ok && native.renderScene);
          assert.deepEqual(JSON.parse(JSON.stringify(native.renderScene)), JSON.parse(JSON.stringify(adopted.renderScene)), "accepted serialized document reopened to different ink");
          assert.equal(liveSceneSaveFailure({ document: reopened.document, question, turnPlan: plan, tier: adopted.tier }), null);
        }
        console.log(`PASS ${fixture.id}`);
      } catch (error) {
        failed += 1; console.error(`FAIL ${fixture.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(`structured-completion boundary admission: ${fixtures.length - failed}/${fixtures.length} fixtures passed`);
    if (failed) process.exitCode = 1;
  }
  void main().catch(error => { console.error(error); process.exitCode = 1; });
}
