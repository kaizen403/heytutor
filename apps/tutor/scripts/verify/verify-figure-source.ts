import assert from "node:assert/strict";
import {
  compileSceneDocument,
  type SceneArtifactsV3,
  type SceneDocument,
} from "@heytutor/scene-engine";
import {
  selectVerifiedRepresentation,
} from "../../features/tutor-session/lib/scene/representationFallback";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import {
  canonicalizeTurnSceneMetadata,
  type SubmittedTurnSceneMetadata,
} from "../../lib/scene/turnScenePersistence";
import { getSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";

const question = "Show the labelled segment AB.";
const plannerDocument: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "planner fixture" },
  source: { question },
  quantities: [],
  entities: [
    { id: "a", kind: "point", role: "endpoint", label: "A" },
    { id: "b", kind: "point", role: "endpoint", label: "B" },
    { id: "ab", kind: "segment", role: "segment", label: "AB" },
  ],
  constructions: [
    { id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
    { id: "make_b", operator: "point", inputs: { x: 3, y: 0 }, outputs: ["b"] },
    { id: "make_ab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] },
  ],
  relations: [],
  assertions: [{
    id: "segment_exists",
    predicate: "exists",
    entities: ["ab"],
    expected: true,
    severity: "fatal",
  }],
  annotations: [{ id: "label_ab", kind: "label", targetIds: ["ab"], text: "AB" }],
  requiredEntityIds: ["a", "b", "ab"],
  revealGroups: [{
    id: "segment",
    entityIds: ["a", "b", "ab"],
    dependsOn: [],
    narrationCue: "show segment AB",
  }],
  teachingTimeline: [{
    id: "show_segment",
    action: "reveal",
    targetId: "segment",
    dependsOn: [],
    narrationIntent: "show the labelled segment",
  }],
};

async function main(): Promise<void> {
  const compiled = compileSceneDocument(plannerDocument);
  assert.ok(compiled.ok && compiled.renderScene, "planner fixture must compile");

  const selected = selectVerifiedRepresentation({
    question,
    exact: {
      sceneDocument: plannerDocument,
      renderScene: compiled.renderScene,
      validationReport: compiled.report,
    },
  });
  assert.equal(
    (selected as typeof selected & { figureSource?: string }).figureSource,
    "planner",
    "a validated planner document must record planner provenance",
  );

  const presentation = buildVerifiedDiagramPresentation(
    selected.sceneDocument,
    selected.renderScene,
  );
  const artifacts: SceneArtifactsV3 & { figureSource?: string } = {
    schemaVersion: "scene-artifacts/v3",
    turnPlan: null,
    representationTier: selected.tier,
    nonMetric: selected.nonMetric,
    figureSource: "planner",
    candidates: [],
    diagramResultStatus: "ready",
  };
  const submitted: SubmittedTurnSceneMetadata = {
    question,
    sceneDocument: selected.sceneDocument,
    validationReport: selected.validationReport,
    visualStatus: "validated",
    sceneArtifacts: artifacts,
    segments: presentation.introSegments.map((segment, orderIndex) => ({
      orderIndex,
      narration: segment.narration,
      spokenText: segment.narration,
      command: serializeSegmentCommands(getSegmentCommands(segment), {
        trustedDiagramGeometry: true,
      }),
    })),
  };

  const saved = await canonicalizeTurnSceneMetadata(submitted);
  assert.ok(saved.ok, `figure-source turn should save: ${saved.ok ? "" : saved.error}`);
  assert.equal(
    (saved.value.sceneArtifacts as (SceneArtifactsV3 & { figureSource?: string }) | null)?.figureSource,
    "planner",
    "figure source must survive server canonicalization",
  );
  assert.ok(
    restoreVerifiedPresentationFromTurn({
      question,
      sceneDocument: saved.value.sceneDocument,
      sceneArtifacts: saved.value.sceneArtifacts,
    }),
    "the saved figure must restore",
  );

  const oldSubmitted = structuredClone(submitted);
  assert.ok(oldSubmitted.sceneArtifacts && typeof oldSubmitted.sceneArtifacts === "object");
  delete (oldSubmitted.sceneArtifacts as Record<string, unknown>).figureSource;
  const oldSaved = await canonicalizeTurnSceneMetadata(oldSubmitted);
  assert.ok(oldSaved.ok, `an old turn without figureSource should still load: ${oldSaved.ok ? "" : oldSaved.error}`);
  assert.equal(
    (oldSaved.value.sceneArtifacts as (SceneArtifactsV3 & { figureSource?: string }) | null)?.figureSource,
    undefined,
    "old turns must remain unclassified instead of gaining invented provenance",
  );

  const textOnly = selectVerifiedRepresentation({ question: "What is the SI unit of force?" });
  assert.equal(
    (textOnly as typeof textOnly & { figureSource?: string }).figureSource,
    "text_only",
    "a no-figure representation must record text_only provenance",
  );

  console.log("figure source verification passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
