import assert from "node:assert/strict";
import type { RenderScene, SceneDocument } from "@heytutor/scene-engine";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";

// Minimized from the production incline scene: reveal prose targets entities,
// while the renderer batches their ink in a group without a narration cue.
const document: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "concept" },
  source: { question: "Explain the forces." },
  quantities: [], constructions: [], relations: [], assertions: [], annotations: [],
  requiredEntityIds: ["weight", "component"],
  entities: [
    { id: "weight", kind: "vector", role: "force", label: "mg" },
    { id: "component", kind: "vector", role: "force_component", label: "mg sin θ" },
  ],
  revealGroups: [{ id: "scene", narrationCue: "scene", entityIds: ["weight", "component"], dependsOn: [] }],
  teachingTimeline: [
    { id: "reveal_weight", action: "reveal", targetId: "weight", dependsOn: [], narrationIntent: "The weight mg points straight down from the block." },
    { id: "reveal_component", action: "reveal", targetId: "component", dependsOn: [], narrationIntent: "Its component mg sin θ acts down the slope." },
  ],
};
const render: RenderScene = {
  engineVersion: "scene-engine/2.0.0", entityBounds: {},
  revealGroups: document.revealGroups, timeline: document.teachingTimeline,
  primitives: document.entities.map((entity, index) => ({
    id: `p_${entity.id}`, entityId: entity.id, groupId: "scene", kind: "vector",
    points: [{ x: 750, y: 250 }, { x: 750 - index * 100, y: 350 }],
  })),
};
const presentation = buildVerifiedDiagramPresentation(document, render);
const intro = presentation.introSegments.map((segment) => segment.narration).join(" ");
assert(intro.includes("points straight down") && intro.includes("acts down the slope"),
  `entity reveal explanations must survive group batching: ${intro}`);
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
