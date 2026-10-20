import assert from "node:assert/strict";
import { mock } from "node:test";
import * as engine from "@heytutor/scene-engine";
import type { SelectedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";

type Fault = "none" | "replace" | "quantity-routing" | "wrong-target" | "wrong-text" | "missing-record" |
  "undeclared-annotation" | "undeclared-entity" | "duplicate-addition" | "overlapping-ids" | "old-id" |
  "unknown-quantity" | "duplicate-quantity" | "wrong-group" | "ambiguous-owner" | "wrong-native-anchor";
interface Fixture { id: string; space?: boolean; nativeConstructor?: boolean; oldPointName?: boolean; kind?: "motion" | "arcs"; boundaryDeg?: number; mustMoveOldLabel?: boolean; fault?: Fault; expected: "adopt" | "reject" | "preserve-old-ink" }
const fixtures: Fixture[] = [
  { id: "native-append-coordinate-annotation", expected: "adopt" },
  { id: "native-append-world-coordinate-annotation", space: true, expected: "adopt" },
  { id: "existing-native-label-constructor-path", nativeConstructor: true, expected: "adopt" },
  { id: "old-point-name-motion-without-extra-leader-rejects", nativeConstructor: true, oldPointName: true, expected: "reject" },
  { id: "old-label-motion-rejects-whole-source-owned-transaction", kind: "motion", nativeConstructor: true, expected: "preserve-old-ink" },
  { id: "old-label-motion-at-zero-boundary-rejects-whole-source-owned-transaction", kind: "motion", nativeConstructor: true, boundaryDeg: 0, mustMoveOldLabel: true, expected: "reject" },
  { id: "generic-vertex-labels-cannot-swap-own-arc-values", kind: "arcs", nativeConstructor: true, expected: "reject" },
  { id: "native-append-angle-labels-retain-own-arcs", kind: "arcs", expected: "adopt" },
  ...(["replace", "quantity-routing", "wrong-target", "wrong-text", "missing-record", "undeclared-annotation", "undeclared-entity",
    "duplicate-addition", "overlapping-ids", "old-id", "unknown-quantity", "duplicate-quantity", "wrong-group", "ambiguous-owner", "wrong-native-anchor"] as const)
    .map(fault => ({ id: `native-annotation-rejects-${fault}`, fault, expected: "reject" as const })),
];
const clone = <T>(value: T): T => structuredClone(value);
const q = (id: string, symbol: string, value: number): engine.TurnPlanV3["givens"][number] => ({ id, symbol, value, provenance: "given" });
function input(fixture: Fixture): { document: engine.SceneDocument; turnPlan: engine.TurnPlanV3 } {
  if (fixture.kind) return angleInput(fixture.kind, fixture.boundaryDeg);
  const question = fixture.space ? "Show the given point P(2, -1, 3) in its world frame, and the reference Q."
    : "Show the given point P(2, -1) and the reference Q.";
  const givens = [q("px", "P_x", 2), q("py", "P_y", -1), ...(fixture.space ? [q("pz", "P_z", 3)] : [])];
  const turnPlan: engine.TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens, unknowns: [], derived: [], qualitativeClaims: [],
    lawIds: [], assumptions: [], visualRequirement: "required" };
  const document: engine.SceneDocument = { schemaVersion: "scene-document/v2", source: { question },
    visualDecision: { mode: "scene", reason: "source-given coordinate point and readable reference" }, quantities: givens.map(quantity => ({ ...quantity })),
    entities: [{ id: "L", kind: "point", role: "fixed viewport reference" }, { id: "Q", kind: "point", role: "readable reference", label: "Q" },
      { id: "P", kind: "point", role: "source-given coordinate owner" }],
    constructions: [{ id: "makeL", operator: "point", inputs: { x: -6, y: -4, coordinateSpace: "world" }, outputs: ["L"] },
      { id: "makeQ", operator: "point", inputs: { x: 7, y: 5, coordinateSpace: "world" }, outputs: ["Q"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["L", "Q", "P"],
    revealGroups: [{ id: "setup", entityIds: ["L", "Q", "P"], dependsOn: [], narrationCue: "Show the given point and reference." }], teachingTimeline: [] };
  if (fixture.space) {
    document.entities.push({ id: "O", kind: "point", role: "world origin" }, { id: "frame", kind: "polyline", role: "world coordinate frame" });
    document.constructions.push({ id: "makeO", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["O"] },
      { id: "makeFrame", operator: "space_frame", inputs: { origin: "O", scale: 1 }, outputs: ["frame"] },
      { id: "makeP", operator: "space_point", inputs: { frame: "frame", x: "px", y: "py", z: "pz" }, outputs: ["P"] });
    document.requiredEntityIds.push("frame"); document.revealGroups[0]!.entityIds.push("O", "frame");
  } else document.constructions.push({ id: "makeP", operator: "point", inputs: { x: "px", y: "py", coordinateSpace: "world" }, outputs: ["P"] });
  if (fixture.fault === "ambiguous-owner") document.revealGroups.push({ id: "later", entityIds: ["P"], dependsOn: ["setup"], narrationCue: "Ambiguous old owner scope." });
  if (fixture.oldPointName) document.entities.find(entity => entity.id === "P")!.label = "P";
  return { document, turnPlan };
}
function proposal(base: engine.SceneDocument, fixture: Fixture): engine.SceneCompletionResult {
  if (fixture.kind) return angleProposal(base, fixture);
  const document = clone(base), fault = fixture.fault ?? "none";
  const id = fault === "old-id" ? "Q" : "completion_given_point";
  const text = fixture.space ? "P(2, -1, 3)" : "P(2, -1)";
  const addition: engine.SceneCompletionResult["additions"][number] = { id, kind: "given_label", targetIds: ["P"],
    quantityIds: fixture.space ? ["px", "py", "pz"] : ["px", "py"], text };
  const result: engine.SceneCompletionResult = { document, additions: [addition], addedEntityIds: [], addedAnnotationIds: [id], skipped: [] };
  if (fixture.nativeConstructor === true) {
    document.entities.push({ id, kind: "label", role: "proved source coordinate statement", label: text });
    document.constructions.push({ id: "makeCompletion", operator: "label", inputs: { target: "P", text }, outputs: [id] });
    document.requiredEntityIds.push(id); document.revealGroups[0]!.entityIds.push(id);
    result.addedEntityIds = [id]; result.addedAnnotationIds = []; return result;
  }
  const annotation = { id, kind: "label", targetIds: [fault === "wrong-target" ? "Q" : "P"],
    text: fault === "wrong-text" ? "P(99, -1)" : text, labelMode: fault === "replace" ? "replace" as const : "append" as const };
  document.annotations.push(annotation);
  if (fault === "quantity-routing") document.annotations[0]!.quantityId = "px";
  if (fault === "missing-record") document.annotations = [];
  if (fault === "undeclared-annotation") {
    const extra = { id: "unreported", kind: "label", targetIds: ["P"], text: "unreported", labelMode: "append" as const };
    document.annotations.push(extra);
  }
  if (fault === "undeclared-entity") {
    document.entities.push({ id: "unreported", kind: "point", role: "unreported native mark" });
    document.constructions.push({ id: "makeUnreported", operator: "point", inputs: { x: 1, y: 1, coordinateSpace: "world" }, outputs: ["unreported"] });
    document.requiredEntityIds.push("unreported"); document.revealGroups[0]!.entityIds.push("unreported");
  }
  if (fault === "duplicate-addition") result.additions.push(clone(addition));
  if (fault === "overlapping-ids") result.addedEntityIds.push(id);
  if (fault === "unknown-quantity") addition.quantityIds = ["unproved_px", "py"];
  if (fault === "duplicate-quantity") addition.quantityIds.push("px");
  if (fault === "wrong-group") document.revealGroups.push({ id: "unpermitted", entityIds: ["P"], dependsOn: ["setup"], narrationCue: "New scope cannot re-own P." });
  return result;
}
function angleInput(kind: "motion" | "arcs", boundaryDeg = 15): { document: engine.SceneDocument; turnPlan: engine.TurnPlanV3 } {
  const question = kind === "motion" ? "Draw reflection with the given incidence i = 36 degrees. Label the two regions air and diamond."
    : "Show two given cord angles: theta_A = 36 degrees above the left horizontal and theta_B = 62 degrees above the right horizontal.";
  const givens = kind === "motion" ? [{ ...q("incidence", "i", 36), unit: "°" }]
    : [{ ...q("thetaA", "theta_A", 36), unit: "°" }, { ...q("thetaB", "theta_B", 62), unit: "°" }];
  const turnPlan: engine.TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens, unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
  const document: engine.SceneDocument = { schemaVersion: "scene-document/v2", source: { question, representationTier: "qualitative_verified", nonMetric: true },
    visualDecision: { mode: "scene", reason: "native source-given angle geometry" }, quantities: clone(givens), entities: [], constructions: [], relations: [], assertions: [], annotations: [],
    requiredEntityIds: [], revealGroups: [{ id: "setup", entityIds: [], dependsOn: [], narrationCue: "Show the source angles." }], teachingTimeline: [] };
  const point = (id: string, x: number, y: number, label?: string) => {
    document.entities.push({ id, kind: "point", role: "native source point", ...(label ? { label } : {}) });
    document.constructions.push({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] });
  };
  point("O", 0, 0);
  if (kind === "motion") {
    const a = boundaryDeg * Math.PI / 180;
    document.entities.push({ id: "boundary", kind: "line", role: "interface" }, { id: "incoming", kind: "ray", role: "incident" },
      { id: "normal", kind: "line", role: "normal" }, { id: "outgoing", kind: "ray", role: "reflected" }, { id: "arc", kind: "angle_mark", role: "incidence", label: "i" });
    document.constructions.push({ id: "makeBoundary", operator: "line", inputs: { start: "O", direction: [Math.cos(a), Math.sin(a)] }, outputs: ["boundary"] },
      { id: "makeReflection", operator: "reflect_at", inputs: { point: "O", surface: "boundary", incidentAngleDeg: "incidence" }, outputs: ["incoming", "normal", "outgoing"] },
      { id: "makeArc", operator: "angle_mark", inputs: { vertex: "O", a: "incoming", b: "normal" }, outputs: ["arc"] });
    document.annotations.push({ id: "air", kind: "label", targetIds: ["boundary"], text: "air", placementIntent: "above" },
      { id: "diamond", kind: "label", targetIds: ["incoming"], text: "diamond", placementIntent: "below" });
    document.assertions.push({ id: "givenAngleProof", predicate: "angle_between", entities: ["incoming", "normal"], expected: { value: 36, unit: "degree" }, severity: "fatal" });
  } else {
    point("L", -6, -4); point("Q", 7, 5, "Q"); point("left", -3, 0); point("right", 3, 0);
    point("A", -3 * Math.cos(36 * Math.PI / 180), 3 * Math.sin(36 * Math.PI / 180));
    point("B", 3 * Math.cos(62 * Math.PI / 180), 3 * Math.sin(62 * Math.PI / 180));
    for (const [id, end] of [["leftArm", "left"], ["rightArm", "right"], ["cordA", "A"], ["cordB", "B"]]) {
      document.entities.push({ id: id!, kind: "segment", role: "source angle arm" });
      document.constructions.push({ id: `make_${id}`, operator: "segment", inputs: { start: "O", end }, outputs: [id!] });
    }
    for (const [id, arm, cord, degrees] of [["arcA", "leftArm", "cordA", 36], ["arcB", "rightArm", "cordB", 62]] as const) {
      document.entities.push({ id, kind: "angle_mark", role: "source-given cord angle" });
      document.constructions.push({ id: `make_${id}`, operator: "angle_mark", inputs: { vertex: "O", a: arm, b: cord }, outputs: [id] });
      document.assertions.push({ id: `proof_${id}`, predicate: "angle_between", entities: [arm, cord], expected: { value: degrees, unit: "degree" }, severity: "fatal" });
    }
  }
  document.requiredEntityIds = document.entities.map(entity => entity.id); document.revealGroups[0]!.entityIds = [...document.requiredEntityIds];
  return { document, turnPlan };
}
function angleProposal(base: engine.SceneDocument, fixture: Fixture): engine.SceneCompletionResult {
  const document = clone(base), result: engine.SceneCompletionResult = { document, additions: [], addedEntityIds: [], addedAnnotationIds: [], skipped: [] };
  const bindings = fixture.kind === "motion" ? [["arc", "incidence", "i = 36 °"]]
    : [["arcA", "thetaA", "theta_A = 36°"], ["arcB", "thetaB", "theta_B = 62°"]];
  for (const [target, quantity, text] of bindings) {
    const id = `completion_${target}`;
    result.additions.push({ id, kind: "given_angle", quantityIds: [quantity!], targetIds: [target!], text });
    if (fixture.nativeConstructor === true) {
      document.entities.push({ id, kind: "label", role: "source-given angle value", label: text });
      document.constructions.push({ id: `make_${id}`, operator: "label", inputs: { target, text }, outputs: [id] });
      document.requiredEntityIds.push(id); document.revealGroups[0]!.entityIds.push(id); result.addedEntityIds.push(id);
    } else {
      const annotation = { id, kind: "label", targetIds: [target!], text: text!, labelMode: "append" as const };
      document.annotations.push(annotation); result.addedAnnotationIds.push(id);
    }
  }
  return result;
}
function nearerSibling(render: engine.RenderScene, addition: engine.SceneCompletionResult["additions"][number], nativeConstructor: boolean): boolean {
  const own = render.primitives.find(p => p.entityId === addition.targetIds[0] && p.kind === "arc");
  const label = render.primitives.find(p => p.kind === "label" && p.entityId === (nativeConstructor ? addition.id : addition.targetIds[0]) && p.text === addition.text);
  assert(own && label && own.points[0] && label.points[0]);
  const center = own.points[0], position = label.points[0];
  const direction = Math.atan2(position.y - center.y, position.x - center.x);
  const distance = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const middle = (arc: engine.RenderScene["primitives"][number]) => {
    assert(typeof arc.startAngle === "number" && typeof arc.endAngle === "number");
    return arc.startAngle + Math.atan2(Math.sin(arc.endAngle - arc.startAngle), Math.cos(arc.endAngle - arc.startAngle)) / 2;
  };
  return render.primitives.some(other => other.kind === "arc" && other.entityId !== own.entityId && other.points[0] &&
    Math.hypot(other.points[0].x - center.x, other.points[0].y - center.y) < 1e-6 && distance(direction, middle(other)) < distance(direction, middle(own)) - 1e-8);
}
if (process.argv.includes("--print-fixtures")) {
  console.log(JSON.stringify({ schemaVersion: "structured-completion-owner-admission-fixtures/v1", epsilonPx: 1e-6,
    fixtures: fixtures.map(fixture => ({ ...fixture, ...input(fixture), proposal: proposal(input(fixture).document, fixture) })),
    oracle: "Native append annotations and existing label constructors survive ordinary admission/save/reopen. Every old primitive and exact new id/owner/text/group/anchor survives, otherwise retain the whole base object." }, null, 2));
} else {
  async function main(): Promise<void> {
    let active = fixtures[0]!, calls = 0, selecting = false, proposalCompiles = 0, anchorFaults = 0;
    mock.module("@heytutor/scene-engine", { namedExports: { ...engine,
      completeSceneDocument(document: engine.SceneDocument) { calls++; return proposal(document, active); },
      compileSceneDocument(...args: Parameters<typeof engine.compileSceneDocument>) {
        const result = engine.compileSceneDocument(...args);
        if (selecting && active.fault === "wrong-native-anchor" && args[0].annotations.some(a => a.id === "completion_given_point") && ++proposalCompiles === 2) {
          assert(result.ok && result.renderScene, "anchor fault requires an otherwise valid native compilation");
          const changed = clone(result), label = changed.renderScene!.primitives.find(p => p.id === "completion_given_point" && p.kind === "label");
          assert(label?.points[0]); label.points[0].x += 20;
          const bounds = label.provenance?.labelBounds;
          if (bounds && typeof bounds === "object" && "x" in bounds && typeof bounds.x === "number") bounds.x += 20;
          anchorFaults++; return changed;
        }
        return result;
      },
    } });
    const { selectProductionScene, validateProductionSceneCandidate } = await import("../../features/tutor-session/lib/scene/productionSceneSelection");
    const { liveSceneSaveFailure } = await import("../../lib/scene/sceneSaveAdmission");
    const { canonicalizeTurnSceneMetadata } = await import("../../lib/scene/turnScenePersistence");
    let passed = 0;
    for (const fixture of fixtures) {
      try {
        active = fixture; calls = 0; selecting = false; proposalCompiles = 0; anchorFaults = 0;
        const { document, turnPlan } = input(fixture), question = turnPlan.question;
        assert(engine.validateTurnPlanV3(turnPlan, question).valid);
        const admitted = validateProductionSceneCandidate({ candidate: document as unknown as Record<string, unknown>, question, turnPlan });
        assert(admitted.valid && admitted.value, `baseline must be natively admitted: ${JSON.stringify(admitted.errors)}`);
        const selected: SelectedRepresentation = { sceneDocument: admitted.value.document, renderScene: admitted.value.renderScene,
          validationReport: admitted.value.report, tier: "qualitative_verified", nonMetric: true, figureSource: "planner", reason: "native admitted source fixture" };
        assert.equal(liveSceneSaveFailure({ document: selected.sceneDocument, question, turnPlan, tier: selected.tier }), null);
        const before = clone({ selected, turnPlan });
        const proposed = proposal(selected.sceneDocument, fixture);
        if (fixture.expected === "adopt" || fixture.kind || fixture.oldPointName || fixture.fault === "wrong-native-anchor") {
          const native = validateProductionSceneCandidate({ candidate: proposed.document as unknown as Record<string, unknown>, question, turnPlan });
          assert(native.valid && native.value, `effect control must pass ordinary native admission: ${JSON.stringify(native.errors)}`);
          assert.equal(liveSceneSaveFailure({ document: native.value.document, question, turnPlan, tier: selected.tier }), null);
          if (fixture.mustMoveOldLabel) assert(selected.renderScene.primitives.some(old => old.kind === "label" &&
            JSON.stringify(native.value!.renderScene.primitives.find(p => p.id === old.id)?.points) !== JSON.stringify(old.points)),
          "motion countercase must independently move an old native label before the new guard");
          if (fixture.kind === "arcs") assert.equal(proposed.additions.some(a => nearerSibling(native.value!.renderScene, a, fixture.nativeConstructor === true)),
            fixture.expected === "reject", "independent own-arc effect must match the sealed source geometry oracle");
          if (fixture.oldPointName) {
            const old = selected.renderScene.primitives.find(p => p.id === "primitive_P_label"), changed = native.value.renderScene.primitives.find(p => p.id === "primitive_P_label");
            assert(old && changed); assert.notDeepEqual(changed.points, old.points, "short native point name must actually move");
            const ids = new Set(selected.renderScene.primitives.map(p => p.id));
            assert(native.value.renderScene.primitives.every(p => ids.has(p.id) || p.entityId === proposed.additions[0]!.id),
              "point-name movement countercase cannot be rejected merely for an unreported new old-owner leader");
          }
        }
        selecting = true;
        const output = selectProductionScene({ question, turnPlan, problemIR: null, fastRepresentation: selected, completionEnabled: true });
        selecting = false;
        if (fixture.fault === "wrong-native-anchor") assert.equal(anchorFaults, 1, "the native-render fault must actually reach admission after a valid source proposal");
        assert.equal(calls, 1); assert.deepEqual({ selected, turnPlan }, before, "completion cannot mutate caller data");
        assert(output.representation); assert.equal(output.visualStatus, "validated"); assert.equal(output.saveFailure, null);
        // A native layout improvement may make the original 15-degree proposal stable.
        // Adoption still crosses every old-primitive and stock save/reopen check below.
        if (fixture.expected === "reject" || fixture.expected === "preserve-old-ink" && output.completion?.adopted === false) {
          assert.equal(output.completion?.adopted, false, "unproved completion metadata or owner was adopted");
          assert.equal(output.representation, selected, "a rejected transaction retains the whole original object");
        } else {
          assert.equal(output.completion?.adopted, true, output.completion?.rejection ?? "complete native addition should survive");
          const adopted = output.representation;
          for (const expected of proposed.additions) {
            const labels = adopted.renderScene.primitives.filter(p => p.kind === "label" && p.text === expected.text &&
              p.entityId === (fixture.nativeConstructor === true ? expected.id : expected.targetIds[0]));
            assert.equal(labels.length, 1); if (fixture.nativeConstructor !== true) assert.equal(labels[0]!.id, expected.id);
            assert.equal(labels[0]!.groupId, "setup");
          }
          for (const old of before.selected.renderScene.primitives) assert.deepEqual(adopted.renderScene.primitives.find(p => p.id === old.id), old,
            "every old label, physical mark, box, leader and layout field remains identical");
          const saved = await canonicalizeTurnSceneMetadata({ question, sceneDocument: adopted.sceneDocument, visualStatus: "validated", segments: [],
            sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan, representationTier: adopted.tier, nonMetric: adopted.nonMetric,
              figureSource: adopted.figureSource, candidates: [], diagramResultStatus: "ready", completion: output.completion } });
          assert(saved.ok, "accepted native append program must save");
          const reopened = await canonicalizeTurnSceneMetadata(JSON.parse(JSON.stringify({ ...saved.value, question })));
          assert(reopened.ok && reopened.value.sceneDocument, "accepted native append program must reopen");
          const compiled = engine.compileSceneDocument(reopened.value.sceneDocument); assert(compiled.ok && compiled.renderScene);
          assert.deepEqual(JSON.parse(JSON.stringify(compiled.renderScene)), JSON.parse(JSON.stringify(adopted.renderScene)), "full native render and anchors survive save/reopen");
          assert.deepEqual(reopened.value.sceneArtifacts?.completion, output.completion);
        }
        passed++; console.log(`PASS ${fixture.id}`);
      } catch (error) { console.error(`FAIL ${fixture.id}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    console.log(`structured-completion owner admission: ${passed}/${fixtures.length} fixtures passed`);
    if (passed !== fixtures.length) process.exitCode = 1;
  }
  void main().catch(error => { console.error(error); process.exitCode = 1; });
}
