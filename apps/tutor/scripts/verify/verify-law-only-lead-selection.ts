/**
 * #271 round 3: a stem whose archetype match came only from its plan's laws
 * draws nothing on the current lane, planner candidate included. Replay row
 * de79bfcc40ab (a glass sphere with an air bubble, matched only through a
 * spherical refraction law) drew a planner figure with an "image" point
 * floating far below the axis once the deterministic figure was refused.
 * Strict, which prefers the planner, keeps its behaviour. Synthetic text.
 */
import assert from "node:assert/strict";
import { FIGURE_SOURCES, lawOnlyArchetypeLead, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";

const question = "A small air bubble sits inside a glass sphere of radius 5 cm, 3 cm from its surface. Where does it appear when viewed from outside?";
const turnPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
  givens: [], unknowns: [], derived: [], qualitativeClaims: [], assumptions: [],
  lawIds: ["refraction at a spherical surface", "spherical refraction formula"],
};
assert.equal(lawOnlyArchetypeLead(question, { turnPlan, problemIR: null }), true, "the fixture must be a law only lead");

const candidate: SceneDocument = {
  schemaVersion: "scene-document/v2", source: { question },
  visualDecision: { mode: "scene", reason: "a labelled axis segment" }, quantities: [],
  entities: [{ id: "a", kind: "point", role: "endpoint", label: "A" }, { id: "b", kind: "point", role: "endpoint", label: "B" },
    { id: "ab", kind: "segment", role: "segment", label: "AB" }],
  constructions: [{ id: "pa", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
    { id: "pb", operator: "point", inputs: { x: 3, y: 0 }, outputs: ["b"] },
    { id: "sab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] }],
  relations: [], assertions: [{ id: "exists", predicate: "exists", entities: ["ab"], expected: true, severity: "fatal" }],
  annotations: [], requiredEntityIds: ["a", "b", "ab"],
  revealGroups: [{ id: "setup", entityIds: ["a", "b", "ab"], dependsOn: [], narrationCue: "Draw AB." }],
  teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Draw AB." }],
};
const select = (preferPlanner: boolean) => selectProductionScene({
  question, turnPlan, problemIR: null, candidate: candidate as unknown as Record<string, unknown>, requiredRetryEnabled: true,
  ...(preferPlanner ? { policy: { preferPlanner: true, allowedFigureSources: ["planner", "verified_recovery", "linear_source", "text_only"] } } : {}),
} as Parameters<typeof selectProductionScene>[0]);

const current = select(false);
assert.equal(current.representation, null, "the current lane draws nothing for a law only lead, planner included");
assert.equal(current.visualStatus, "retry_required", "a required figure that declines still reports as required");
assert.equal(current.droppedCandidate?.code, "law_only_archetype_lead", "the dropped planner candidate names why");

const strict = select(true);
assert.notEqual(strict.reason, current.reason, "strict does not take the current lane decline");

console.log("law only lead selection: current lane draws nothing and names the drop; strict keeps its own path");
