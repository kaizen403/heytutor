/**
 * Uniform circular motion through the live selection seam: the engine's
 * source figure wins over a planner scene, a declined source teaches without
 * a figure, and the selected figure produces board ink with FOCUS anchors.
 */
import assert from "node:assert/strict";
import { compileSceneDocument, synthesizeUniformCircularScene, validateSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import { verifiedDiagramHasDrawableInk } from "@heytutor/drawing";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";

/** A planner-style scene with a fixed upward velocity: it implies a sense the source never stated. */
function plannerScene(question: string) {
  const raw: SceneDocument = {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "planner circular motion" },
    source: { question },
    quantities: [],
    entities: [
      { id: "O", kind: "point", role: "centre", label: "O" },
      { id: "P", kind: "point", role: "particle", label: "P" },
      { id: "path", kind: "circle", role: "circular path" },
      { id: "velocity", kind: "vector", role: "velocity", label: "v" },
    ],
    constructions: [
      { id: "make_O", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["O"] },
      { id: "make_P", operator: "point", inputs: { x: 2, y: 0 }, outputs: ["P"] },
      { id: "make_path", operator: "circle", inputs: { center: "O", radius: 2 }, outputs: ["path"] },
      { id: "make_velocity", operator: "vector", inputs: { start: "P", direction: [0, 1], length: 1.3 }, outputs: ["velocity"] },
    ],
    relations: [],
    assertions: [{ id: "path_exists", predicate: "exists", entities: ["path"], expected: true, severity: "fatal" }],
    annotations: [],
    requiredEntityIds: ["O", "P", "path", "velocity"],
    revealGroups: [{ id: "setup", entityIds: ["O", "P", "path", "velocity"], dependsOn: [], narrationCue: "circle" }],
    teachingTimeline: [{ id: "reveal_setup", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "circle" }],
  } as unknown as SceneDocument;
  const validated = validateSceneDocument(raw as unknown as Record<string, unknown>);
  assert.ok(validated.document, JSON.stringify(validated.report.issues));
  const compiled = compileSceneDocument(validated.document);
  if (!compiled.ok) {
    assert.equal(compiled.renderScene, null, "a source-mismatched planner figure must fail atomically");
    assert.ok(compiled.report.issues.some(({ code }) => code === "ucm_source_mismatch"), JSON.stringify(compiled.report.issues));
    return null;
  }
  assert.ok(compiled.ok && compiled.renderScene);
  return { sceneDocument: validated.document, renderScene: compiled.renderScene, validationReport: compiled.report };
}

/** A turn plan that names circular motion; the topic decision comes from it. */
const turnPlan = { schemaVersion: "turn-plan/v3", question: "", givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: ["uniform circular motion: a_c = v^2/r"], assumptions: [], visualRequirement: "required" } as const;

let checks = 0;
for (const question of [
  "A car moves with a constant speed of 20 m/s on a circular track of radius 50 m. Find its centripetal acceleration.",
  "A stone is whirled clockwise in a horizontal circle of radius 0.8 m with a period of 2 s. Find its speed and acceleration.",
  "For a particle in uniform circular motion, the acceleration a at any point P(R,θ) on the circular path of radius R is (when θ is measured from the positive x-axis and v is uniform speed):",
]) {
  const engine = synthesizeUniformCircularScene(question, { turnPlan });
  assert.ok(engine?.status === "drawn");
  const selected = selectVerifiedRepresentation({ question, turnPlan, families: ["contact_body"], exact: plannerScene(question) });
  assert.equal(selected.family, "vector_diagram", "the source figure must win over the planner scene");
  assert.deepEqual(selected.renderScene, engine.scene.renderScene);
  assert.equal(selected.tier, "qualitative_verified");
  const withoutPlanner = selectVerifiedRepresentation({ question, turnPlan, families: ["bounded_region"] });
  assert.deepEqual(withoutPlanner.renderScene, engine.scene.renderScene, "no lexical family may replace the source figure");
  const presentation = buildVerifiedDiagramPresentation(selected.sceneDocument, selected.renderScene, { figureFamily: "vector_diagram" });
  assert.ok(presentation && verifiedDiagramHasDrawableInk(presentation.diagram), "the figure must produce board ink");
  assert.ok(presentation.diagram.anchors.some((anchor) => anchor.id === "accel"), "FOCUS can trace the acceleration");
  checks += 7;
}
for (const question of [
  "A particle moves uniformly on a circle of radius 0 m with speed 3 m/s.",
  "A particle moves in uniform circular motion on a circle of radius 2 m with speed 6 m/s and angular speed 4 rad/s.",
]) {
  const selected = selectVerifiedRepresentation({ question, turnPlan, families: ["contact_body"], exact: plannerScene(question) });
  assert.equal(selected.tier, "question_representation");
  assert.ok(!selected.renderScene.primitives.some((p) => p.kind === "circle" || p.kind === "vector"), "a declined source draws no circle or arrow");
  checks += 2;
}
// A stale planner value never reaches the board with this figure: the turn is text only.
{
  const question = "A car moves with a constant speed of 20 m/s on a circular track of radius 50 m. Find its centripetal acceleration.";
  const stalePlan = { ...turnPlan, derived: [{ id: "a", symbol: "a_c", value: 10, unit: "m/s^2", provenance: "derived" as const }] };
  const selected = selectVerifiedRepresentation({ question, turnPlan: stalePlan, families: ["contact_body"], exact: plannerScene(question) });
  assert.equal(selected.tier, "question_representation");
  assert.ok(!selected.renderScene.primitives.some((p) => p.kind === "vector" || p.text?.includes("a=")), "no figure beside a stale a_c");
  // A plan that does not name circular motion does not select this source program.
  const linearPlan = { ...turnPlan, lawIds: ["average speed v = d / t"] };
  const unadmitted = selectVerifiedRepresentation({ question, turnPlan: linearPlan, families: ["contact_body"], exact: plannerScene(question) });
  assert.notEqual(unadmitted.family, "vector_diagram", "keywords alone must not select the UCM figure");
  // Mock plan, no planner scene: the legacy static circle is declined, not replaced by the UCM figure.
  const mockPlan = { ...turnPlan, lawIds: [], visualRequirement: "optional" as const };
  const mock = selectVerifiedRepresentation({ question, turnPlan: mockPlan, families: ["bounded_region", "contact_body"] });
  assert.ok(!mock.renderScene.primitives.some((p) => p.kind === "circle" || p.kind === "vector"), "no legacy circle under a mock plan");
  checks += 4;
}
// #5 repro: a river plan naming the width w must keep the river figure, not hand the turn to UCM.
{
  const question = "A river is 100 m wide. A boat can travel at 4 m/s in still water and the river flows at 3 m/s. The boat heads straight across. Find the time to cross and the drift downstream.";
  const riverPlan = { ...turnPlan, lawIds: ["relative velocity", "t = w / v_b"], givens: [
    { id: "w", symbol: "w", value: 100, unit: "m", provenance: "given" as const },
    { id: "vb", symbol: "v_b", value: 4, unit: "m/s", provenance: "given" as const },
    { id: "vr", symbol: "v_r", value: 3, unit: "m/s", provenance: "given" as const },
  ] };
  const selected = selectVerifiedRepresentation({ question, turnPlan: riverPlan, families: ["vector_diagram"] });
  assert.equal(selected.sceneDocument.source.archetype, "river_boat", "river figure kept");
  assert.notEqual(selected.tier, "question_representation");
  checks += 2;
}
// #9 core case: a plan with only r, v and a plain derived a (no law name) still draws, admitted by a = v^2/r.
{
  const question = "A car moves on a circular track of radius 50 m at 20 m/s. Find its acceleration.";
  const plainPlan = { ...turnPlan, lawIds: [], givens: [
    { id: "r", symbol: "r", value: 50, unit: "m", provenance: "given" as const },
    { id: "v", symbol: "v", value: 20, unit: "m/s", provenance: "given" as const },
  ], derived: [{ id: "a", symbol: "a", value: 8, unit: "m/s^2", provenance: "derived" as const }] };
  const selected = selectVerifiedRepresentation({ question, turnPlan: plainPlan, families: ["bounded_region"] });
  assert.equal(selected.family, "vector_diagram");
  assert.ok(selected.renderScene.primitives.some((p) => p.text === "a=8 m/s^2"));
  checks += 2;
}
console.log(`verify-ucm-selection: ${checks} checks passed`);
