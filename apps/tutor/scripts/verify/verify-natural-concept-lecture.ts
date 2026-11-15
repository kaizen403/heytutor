import assert from "node:assert/strict";
import { compileSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import { remainingDeferredAnnotations } from "@heytutor/drawing";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";

// Minimized from the production incline scene: reveal prose targets entities,
// while the renderer batches their ink in a group without a narration cue.
const document: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "concept" },
  source: { question: "Explain the forces." },
  quantities: [],
  constructions: [
    { id: "make_origin", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["origin"] },
    { id: "make_weight_tip", operator: "point", inputs: { x: 0, y: -2 }, outputs: ["weight_tip"] },
    { id: "make_component_tip", operator: "point", inputs: { x: -1, y: -1 }, outputs: ["component_tip"] },
    { id: "weight_vector", operator: "vector", inputs: { start: "origin", end: "weight_tip" }, outputs: ["weight"] },
    { id: "component_vector", operator: "vector", inputs: { start: "origin", end: "component_tip" }, outputs: ["component"] },
  ],
  relations: [], assertions: [], annotations: [],
  requiredEntityIds: ["weight", "component"],
  entities: [
    { id: "origin", kind: "point", role: "force origin" },
    { id: "weight_tip", kind: "point", role: "weight tip" },
    { id: "component_tip", kind: "point", role: "component tip" },
    { id: "weight", kind: "vector", role: "force", label: "mg" },
    { id: "component", kind: "vector", role: "force_component", label: "mg sin θ" },
  ],
  revealGroups: [{ id: "scene", narrationCue: "scene", entityIds: ["weight", "component"], dependsOn: [] }],
  teachingTimeline: [
    { id: "reveal_weight", action: "reveal", targetId: "weight", dependsOn: [], narrationIntent: "The weight mg points straight down from the block." },
    { id: "reveal_component", action: "reveal", targetId: "component", dependsOn: [], narrationIntent: "Its component mg sin θ acts down the slope." },
  ],
};
const compiled = compileSceneDocument(document, { figureConsistency: true });
assert(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
const render = compiled.renderScene;
const presentation = buildVerifiedDiagramPresentation(document, render);
const intro = presentation.introSegments.map((segment) => segment.narration).join(" ");
assert(/setup/i.test(intro) && !/points straight down|acts down the slope/.test(intro),
  `the opening names setup parts and leaves physical explanation to teaching: ${intro}`);
const completed = [...presentation.introSegments.flatMap(s => s.commands ?? []), ...remainingDeferredAnnotations(presentation.diagram)];
for (const label of ["mg", "mg sin θ"]) assert(completed.some(command => command.type === "LABEL" && command.text === label), `${label} survives completion`);
for (const id of ["weight", "component"]) {
  const arrow = render.primitives.find(primitive => primitive.entityId === id && primitive.kind === "vector");
  assert(arrow && arrow.points[1]!.y > arrow.points[0]!.y, `${id} points down on the board`);
  assert(id !== "weight" || arrow.points[1]!.x === arrow.points[0]!.x, "weight remains vertical");
}
assert(!/force_component|begin with scene|comes scene/.test(intro), "internal scene names must not be narrated");
for (const segment of presentation.introSegments) {
  for (const command of segment.commands ?? []) {
    assert(command.spokenCue && segment.narration.includes(command.spokenCue.token), "ink must retain a spoken anchor");
  }
}
const question = "Explain how to draw a free-body diagram for a block on a rough incline, and show how friction enters Newton's second law.";
const prompt = buildTurnTeachingPrompt({
  question, diagramPromptAddon: presentation.diagram.promptAddon, turnPlan: null,
  solverProjection: null, codeLesson: null, isDsa: false, familiarity: "new", fastMode: true,
});
assert(prompt.lessonBudget.maxSteps <= 18, "one concept must not expand into thirty repetitive board rows");
assert(prompt.runtimeAddon.includes("static friction"), "the prompt must distinguish a law's conditions instead of treating every friction force as μN");
assert(prompt.runtimeAddon.lastIndexOf("Do not pad") > prompt.runtimeAddon.indexOf("SUBJECT FAMILIARITY"),
  "natural concept pacing must override the familiarity instruction to fill every step");
assert(prompt.runtimeAddon.includes("Say every = as equals"), "a concept step must speak relations as equals");
assert(prompt.runtimeAddon.includes("[EMPHASIZE:last] immediately after that [WRITE]"),
  "the governing relation and the result must be boxed");
assert(!prompt.runtimeAddon.includes("two or three natural sentences"),
  "a long reason before the row leaves the pen writing during the explanation");
console.log("verified concept lecture prose, physical conditions, and pacing");
