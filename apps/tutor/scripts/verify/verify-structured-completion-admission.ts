import assert from "node:assert/strict";
import { mock } from "node:test";
import * as engine from "@heytutor/scene-engine";
import type { SelectedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";

type Mode = "actual" | "native_good" | "mutate_return" | "mutate_throw" | "regroup_old_label" |
  "false_leader_geometry" | "metadata_without_ink" | "wrong_owner" | "invalid_value" | "throw";
interface Fixture {
  id: string;
  mode: Mode;
  enabled?: boolean;
  blocked?: "solver" | "source";
  expected: "off" | "adopt" | "reject" | "blocked";
  newMarkReveal?: "missing" | "other";
  baseTargetAmbiguous?: boolean;
}
const fixtures: Fixture[] = [
  { id: "omitted-flag-skips-completion-and-retains-reference", mode: "throw", expected: "off" },
  { id: "explicit-flag-off-skips-completion-and-retains-reference", mode: "throw", enabled: false, expected: "off" },
  { id: "actual-engine-legitimate-given-label-crosses-production-save", mode: "actual", enabled: true, expected: "adopt" },
  { id: "native-anchored-label-positive-control", mode: "native_good", enabled: true, expected: "adopt" },
  { id: "proposal-mutation-then-return-cannot-poison-baseline", mode: "mutate_return", enabled: true, expected: "reject" },
  { id: "proposal-mutation-then-throw-cannot-poison-baseline", mode: "mutate_throw", enabled: true, expected: "reject" },
  { id: "old-native-label-cannot-be-reowned-by-later-reveal-membership", mode: "regroup_old_label", enabled: true, expected: "reject" },
  { id: "name-shaped-leader-is-physical-geometry-not-label-leader", mode: "false_leader_geometry", enabled: true, expected: "reject" },
  { id: "addition-metadata-is-not-rendered-ink", mode: "metadata_without_ink", enabled: true, expected: "reject" },
  { id: "rendered-native-label-on-other-owner-is-rejected", mode: "wrong_owner", enabled: true, expected: "reject" },
  { id: "unsupported-number-fails-existing-admission-and-save", mode: "invalid_value", enabled: true, expected: "reject" },
  { id: "proposal-exception-retains-valid-selected-baseline", mode: "throw", enabled: true, expected: "reject" },
  { id: "solver-rejection-precedes-completion", mode: "throw", enabled: true, blocked: "solver", expected: "blocked" },
  { id: "source-policy-rejection-precedes-completion", mode: "throw", enabled: true, blocked: "source", expected: "blocked" },
];
// Appended reveal ownership countercases; the original14 fixture oracles stay intact.
fixtures.push(
  { id: "new-native-label-without-declared-reveal-membership-is-rejected", mode: "native_good", enabled: true, newMarkReveal: "missing", expected: "reject" },
  { id: "new-native-label-in-other-reveal-group-is-rejected", mode: "native_good", enabled: true, newMarkReveal: "other", expected: "reject" },
  { id: "ambiguous-existing-target-reveal-groups-cannot-own-new-label", mode: "native_good", enabled: true, baseTargetAmbiguous: true, expected: "reject" },
);
const clone = <T>(value: T): T => structuredClone(value);
const question = "Draw the labelled given points A and B. The stated scalar m at A is 7.5 kg.";
const turnPlan: engine.TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
  givens: [{ id: "mass", symbol: "m", value: 7.5, unit: "kg", provenance: "given" }],
  unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [],
};
// Native label outputs carry the old names. The two physical point IDs merely
// resemble native leader IDs; neither has provenance.labelLeader === true.
const baseDocument: engine.SceneDocument = {
  schemaVersion: "scene-document/v2", source: { question },
  visualDecision: { mode: "scene", reason: "given labelled points" }, quantities: turnPlan.givens.map(quantity => ({ ...quantity })),
  entities: [
    { id: "A_label_leader", kind: "point", role: "given source point" },
    { id: "B_label_leader", kind: "point", role: "given source point" },
    { id: "A", kind: "label", role: "given point name", label: "A" },
    { id: "B", kind: "label", role: "given point name", label: "B" },
  ],
  constructions: [
    { id: "makePointA", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["A_label_leader"] },
    { id: "makePointB", operator: "point", inputs: { x: 4, y: 3, coordinateSpace: "world" }, outputs: ["B_label_leader"] },
    { id: "makeNameA", operator: "label", inputs: { target: "A_label_leader", text: "A" }, outputs: ["A"] },
    { id: "makeNameB", operator: "label", inputs: { target: "B_label_leader", text: "B" }, outputs: ["B"] },
  ],
  relations: [], assertions: [],
  annotations: [{ id: "givenAttachment", kind: "callout", quantityId: "mass", targetIds: ["A_label_leader"] }],
  requiredEntityIds: ["A_label_leader", "B_label_leader", "A", "B"],
  revealGroups: [{ id: "setup", entityIds: ["A_label_leader", "B_label_leader", "A", "B"], dependsOn: [], narrationCue: "Show the given points." }],
  teachingTimeline: [],
};

function documentForFixture(fixture: Fixture): engine.SceneDocument {
  const candidate = clone(baseDocument);
  if (fixture.baseTargetAmbiguous) candidate.revealGroups.push({
    id: "secondBaseGroup", entityIds: ["A_label_leader"], dependsOn: ["setup"], narrationCue: "Existing duplicated target membership.",
  });
  return candidate;
}

// Literal inputs and fault oracles can be sealed before public selection,
// compiler, admission, save, module-proxy or completion behavior executes.
if (process.argv.includes("--print-fixtures")) {
  console.log(JSON.stringify({ schemaVersion: "structured-completion-admission-fixtures/v1", question, turnPlan, baseDocument, fixtures,
    resolvedDocuments: fixtures.map(fixture => ({ id: fixture.id, document: documentForFixture(fixture) })),
    faultOracle: {
      targetId: "A_label_leader", quantityIds: ["mass"], text: "m = 7.5 kg", newEntityId: "newGiven",
      mutation: "point A x changes from0 to99 before return or throw; all caller data and fallback must remain exact",
      regroup: "append old native label A to later group; old group ownership must survive",
      falseLeader: "append far native point, causing old physical points to refit; names ending _leader cannot exempt real geometry",
      survival: "exact new native label entity+constructor target+text and its own compiled primitive, then unchanged admission/save",
    } }, null, 2));
} else {
  async function main(): Promise<void> {
    let mode: Mode = "actual", calls = 0;
    let activeFixture: Fixture | undefined;
    const noOp = (document: engine.SceneDocument): engine.SceneCompletionResult =>
      ({ document, addedEntityIds: [], addedAnnotationIds: [], additions: [], skipped: [] });
    function proposal(document: engine.SceneDocument, current: Mode): engine.SceneCompletionResult {
      if (current === "throw") throw new Error("controlled completion exception");
      if (current === "mutate_return" || current === "mutate_throw") {
        document.constructions[0]!.inputs.x = 99;
        if (current === "mutate_throw") throw new Error("controlled exception after nested mutation");
        return noOp(document);
      }
      const next = clone(document), target = "A_label_leader", id = "newGiven";
      const text = current === "invalid_value" ? "m = 999 kg" : "m = 7.5 kg";
      const result: engine.SceneCompletionResult = {
        document: next, addedEntityIds: [id], addedAnnotationIds: [], skipped: [],
        additions: [{ id, kind: "given_label", quantityIds: ["mass"], targetIds: [target], text }],
      };
      if (current === "metadata_without_ink") return result;
      if (current === "false_leader_geometry") {
        next.entities.push({ id: "farPoint", kind: "point", role: "helper point" });
        next.constructions.push({ id: "makeFarPoint", operator: "point", inputs: { x: 9, y: 7, coordinateSpace: "world" }, outputs: ["farPoint"] });
        next.requiredEntityIds.push("farPoint"); next.revealGroups[0]!.entityIds.push("farPoint");
        result.addedEntityIds.push("farPoint");
      }
      next.entities.push({ id, kind: "label", role: "given scalar statement", label: text });
      next.constructions.push({ id: "makeNewGiven", operator: "label", inputs: {
        target: current === "wrong_owner" ? "B_label_leader" : target, text,
      }, outputs: [id] });
      next.requiredEntityIds.push(id); next.revealGroups[0]!.entityIds.push(id);
      if (activeFixture?.newMarkReveal) {
        next.revealGroups.forEach(group => { group.entityIds = group.entityIds.filter(entityId => entityId !== id); });
        if (activeFixture.newMarkReveal === "other") next.revealGroups.push({
          id: "wrongNewMarkGroup", entityIds: [id], dependsOn: ["setup"], narrationCue: "New label in a different scope.",
        });
      }
      if (current === "regroup_old_label") next.revealGroups.push({
        id: "later", entityIds: ["A"], dependsOn: ["setup"], narrationCue: "Unpermitted regrouping of old name.",
      });
      return result;
    }
    // Replace only the public proposal function. All native compilation,
    // normalization, candidate admission, selection and save functions are real.
    mock.module("@heytutor/scene-engine", { namedExports: { ...engine,
      completeSceneDocument(document: engine.SceneDocument, input: engine.SceneCompletionInput) {
        calls += 1;
        return mode === "actual" ? engine.completeSceneDocument(document, input) : proposal(document, mode);
      },
    } });
    const { selectProductionScene, validateProductionSceneCandidate } = await import("../../features/tutor-session/lib/scene/productionSceneSelection");
    const { liveSceneSaveFailure } = await import("../../lib/scene/sceneSaveAdmission");
    let checks = 0, failed = 0;
    for (const fixture of fixtures) {
      checks += 1;
      try {
        const plan = clone(turnPlan);
        assert.equal(engine.validateTurnPlanV3(plan, question).valid, true);
        const validation = validateProductionSceneCandidate({ candidate: documentForFixture(fixture) as unknown as Record<string, unknown>, question, turnPlan: plan });
        assert.ok(validation.valid && validation.value, JSON.stringify(validation.errors));
        const value = validation.value;
        const selected: SelectedRepresentation = {
          tier: "qualitative_verified", nonMetric: true, figureSource: "planner", reason: "stock admitted baseline",
          sceneDocument: value.document, renderScene: value.renderScene, validationReport: value.report,
        };
        assert.equal(liveSceneSaveFailure({ document: selected.sceneDocument, question, turnPlan: plan, tier: selected.tier }), null, "fault fixture baseline must pass normal save");
        for (const owner of ["A_label_leader", "B_label_leader"]) {
          const primitive = selected.renderScene.primitives.find(item => item.entityId === owner && item.kind !== "label");
          assert.ok(primitive && primitive.provenance?.labelLeader !== true, "physical-name guard fixture must contain actual nonleader geometry");
          const oldLabel = selected.renderScene.primitives.find(item => item.entityId === owner[0] && item.kind === "label");
          assert.equal(primitive.id, `${oldLabel?.id}_leader`, "fixture must exercise exact misleading native leader name");
        }
        const before = clone({ selected, plan });
        mode = fixture.mode; calls = 0; activeFixture = fixture;
        const output = selectProductionScene({
          question, turnPlan: plan, problemIR: null, fastRepresentation: selected,
          completionEnabled: fixture.enabled, solverAuthorityBlocked: fixture.blocked === "solver",
          ...(fixture.blocked === "source" ? { policy: { allowedFigureSources: ["text_only" as const] } } : {}),
        });
        assert.deepEqual({ selected, plan }, before, "completion proposal poisoned caller or fallback baseline");
        if (fixture.expected === "blocked") {
          assert.equal(calls, 0, "completion ran before solver/source rejection"); assert.equal(output.representation, null); continue;
        }
        assert.ok(output.representation, output.reason);
        assert.equal(output.visualStatus, "validated"); assert.equal(output.saveFailure, null);
        assert.equal(output.representation.tier, selected.tier); assert.equal(output.representation.nonMetric, selected.nonMetric);
        if (fixture.expected === "off") {
          assert.equal(calls, 0); assert.equal(output.representation, selected); assert.equal(output.completion, undefined); continue;
        }
        assert.equal(calls, 1, "valid selected baseline must call completion exactly once");
        if (fixture.expected === "reject") {
          assert.equal(output.completion?.adopted, false, "unsafe proposal was adopted");
          assert.deepEqual(output.representation, before.selected, "rejection failed to retain exact valid baseline"); continue;
        }
        assert.equal(output.completion?.adopted, true, "legitimate native given label must be adopted after ordinary admission/save");
        const adopted = output.representation;
        const additions = output.completion!.additions.filter(item => item.quantityIds.includes("mass") && item.targetIds.length === 1 && item.targetIds[0] === "A_label_leader");
        assert.equal(additions.length, 1, "adopted given attachment must keep exact source ID and owner");
        const addition = additions[0]!;
        assert.ok(adopted.renderScene.primitives.some(item => item.kind === "label" && item.entityId === addition.id && item.text === addition.text), "specific new native ink did not survive");
        for (const old of before.selected.renderScene.primitives.filter(item => item.kind !== "label" && item.provenance?.labelLeader !== true))
          assert.deepEqual(adopted.renderScene.primitives.find(item => item.id === old.id), old, "adoption changed old physical geometry");
        for (const old of before.selected.renderScene.primitives.filter(item => item.kind === "label"))
          assert.ok(adopted.renderScene.primitives.some(item => item.kind === "label" && item.entityId === old.entityId && item.text === old.text && item.groupId === old.groupId), "adoption changed old label ownership/group/text");
        const reopened = engine.validateSceneDocument(JSON.parse(JSON.stringify(adopted.sceneDocument)));
        assert.ok(reopened.document); assert.deepEqual(JSON.parse(JSON.stringify(reopened.document)), JSON.parse(JSON.stringify(adopted.sceneDocument)));
        const native = engine.compileSceneDocument(reopened.document); assert.ok(native.ok && native.renderScene);
        assert.deepEqual(JSON.parse(JSON.stringify(native.renderScene)), JSON.parse(JSON.stringify(adopted.renderScene)), "serialized accepted document reopened to different ink");
        assert.equal(liveSceneSaveFailure({ document: reopened.document, question, turnPlan: plan, tier: adopted.tier }), null);
      } catch (error) {
        failed += 1; console.error(`FAIL ${fixture.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(`structured-completion admission: ${checks - failed}/${checks} fixtures passed`);
    if (failed) process.exitCode = 1;
  }
  void main().catch(error => { console.error(error); process.exitCode = 1; });
}
