/**
 * Only a label with no place on the board is a refusal. Any other error the
 * presentation throws reaches the save as that error, never as a refusal or a
 * text save, so both routes let it out (verify-presentation-label-refusal
 * shows they do). Run with --experimental-test-module-mocks.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
assert.equal(typeof mock.module, "function", "run with --experimental-test-module-mocks");
console.warn = () => {};

class PresentationBroke extends TypeError {}
const broke = () => { throw new PresentationBroke("presentation failed"); };
mock.module(resolve(root, "features/tutor-session/lib/scene/verifiedScenePresentation.ts"), { namedExports: {
  presentVerifiedDiagram: broke,
  buildVerifiedDiagramPresentation: broke,
} });

const { SCENE_DOCUMENT_VERSION } = load("@heytutor/scene-engine") as typeof import("@heytutor/scene-engine");
const { admitStoredScene } = load(resolve(root, "lib/scene/sceneAdmission.ts")) as typeof import("../../lib/scene/sceneAdmission");
const { canonicalizeTurnSceneMetadata } = load(resolve(root, "lib/scene/turnScenePersistence.ts")) as typeof import("../../lib/scene/turnScenePersistence");
const { boardContinuationArtifacts } = load(resolve(root, "lib/boards/boardContinuation.ts")) as typeof import("../../lib/boards/boardContinuation");

const QUESTION = "Join the two points.";
const plan = { schemaVersion: "turn-plan/v3", question: QUESTION, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
const artifacts = { schemaVersion: "scene-artifacts/v3", turnPlan: plan, diagramResultStatus: "ready", representationTier: "qualitative_verified", nonMetric: true };
const figure = {
  schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "figure" },
  source: { question: QUESTION, nonMetric: true, representationTier: "qualitative_verified" },
  entities: [{ id: "a", kind: "point", role: "point", label: "A" }, { id: "b", kind: "point", role: "point", label: "B" }, { id: "s", kind: "segment", role: "segment" }],
  constructions: [
    { id: "ca", operator: "point", inputs: { x: 500, y: 200, coordinateSpace: "layout" }, outputs: ["a"] },
    { id: "cb", operator: "point", inputs: { x: 800, y: 200, coordinateSpace: "layout" }, outputs: ["b"] },
    { id: "cs", operator: "segment", inputs: { a: "a", b: "b" }, outputs: ["s"] },
  ],
  requiredEntityIds: ["a", "b", "s"],
  revealGroups: [{ id: "g", dependsOn: [], entityIds: ["a", "b", "s"], narrationCue: "the points" }],
  assertions: [], annotations: [], quantities: [], relations: [], teachingTimeline: [],
};
const rows = [{ orderIndex: 0, narration: "Here are the points.", spokenText: "Here are the points.", command: null }];
const metadataOf = (extra: Record<string, unknown> = {}) => ({
  question: QUESTION, rawResponse: "Here are the points.", segments: rows, visualStatus: "validated", sceneDocument: figure, sceneArtifacts: artifacts, ...extra,
}) as never;
// The checkpoint route's options, with page loaders that find nothing.
const checkpointOptions = (kind: "lesson" | "resume") => ({
  loadPageFigure: async () => null, checkDoubtFigurePage: async () => false, storedQuestion: undefined,
  loadPageLessonFigureQuestion: async () => null, lessonFigureStart: async () => "figure_1", kind,
}) as never;

async function main() {
  assert.throws(
    () => admitStoredScene({ sceneDocument: figure, sceneQuestion: QUESTION, turnPlan: null, submittedTier: "qualitative_verified" }),
    PresentationBroke,
    "admission lets another presentation error out instead of refusing the figure",
  );
  await assert.rejects(canonicalizeTurnSceneMetadata(metadataOf()), PresentationBroke, "so does the lesson route's save");
  await assert.rejects(canonicalizeTurnSceneMetadata(metadataOf(), checkpointOptions("lesson")), PresentationBroke, "and the checkpoint route's save");
  await assert.rejects(
    canonicalizeTurnSceneMetadata(metadataOf({ sceneArtifacts: { ...artifacts, ...boardContinuationArtifacts(QUESTION) } }), checkpointOptions("resume")),
    PresentationBroke,
    "and a resume save",
  );
  // A text lesson never presents a figure, so it still saves.
  const text = await canonicalizeTurnSceneMetadata(metadataOf({ visualStatus: "text_only", sceneDocument: null, sceneArtifacts: null }));
  assert(text.ok && text.value.visualStatus === "text_only", "a text lesson still saves");
  console.log("PASS presentation throw escapes: admission and every save path let another error out; a text lesson saves");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
