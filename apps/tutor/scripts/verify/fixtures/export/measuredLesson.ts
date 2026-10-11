import {
  getSegmentCommands,
  serializeSegmentCommands,
  type DrawCommand,
} from "@heytutor/drawing";
import { compileSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import type { StoredTurn } from "../../../../lib/boards/boardsClient";
import { buildVerifiedDiagramPresentation } from "../../../../features/tutor-session/lib/scene/verifiedScenePresentation";

/** Engine-compiled measurement whose narration never names its final marks. */
export function measuredLesson(id = "rod", vertical = true): StoredTurn {
  const question = vertical ? "A rod has length L. Show the vertical span." : "A segment has length L. Show the horizontal span.";
  const ids = ["a", "b", "edge", "length"];
  const document: SceneDocument = {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "measured span" },
    source: { question, nonMetric: true, representationTier: "qualitative_verified" }, quantities: [],
    entities: [
      { id: "a", kind: "point", role: "start" }, { id: "b", kind: "point", role: "end" },
      { id: "edge", kind: "segment", role: "span" }, { id: "length", kind: "dimension", role: "length", label: "L" },
    ],
    constructions: [
      { id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
      { id: "make_b", operator: "point", inputs: vertical ? { x: 0, y: 4 } : { x: 4, y: 0 }, outputs: ["b"] },
      { id: "make_edge", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["edge"] },
      { id: "make_length", operator: "dimension", inputs: { start: "a", end: "b" }, outputs: ["length"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "Here is the segment." }], teachingTimeline: [],
  };
  const compiled = compileSceneDocument(document);
  if (!compiled.ok || !compiled.renderScene) throw new Error("Measurement fixture did not compile");
  const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene);
  const work: DrawCommand = { type: "WRITE", text: "L = 4", params: [30, 100, 24], charPosition: 0, narrationBefore: "" };
  return {
    id, orderIndex: 0, status: "complete", kind: "lesson", question, rawResponse: "", speedMultiplier: 1, traceId: null,
    sceneDocument: document, sceneEngineVersion: compiled.renderScene.engineVersion, validationReport: compiled.report,
    visualStatus: "validated", sceneArtifacts: { representationTier: "qualitative_verified", nonMetric: true },
    segments: [...presentation.introSegments, { narration: "", command: work }].map((segment, index) => ({
      id: `${id}-s${index}`, orderIndex: index, narration: segment.narration, spokenText: segment.narration,
      command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: segment.verifiedDiagramIntro === true }),
      audioUrl: null, durationMs: 100, timings: null,
    })),
  };
}
