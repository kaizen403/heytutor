/** Only a measurement's own displayed result may withhold its bar and witnesses. */
import assert from "node:assert/strict";
import fixtures from "./fixtures/given-dimension-cases.json";
import { compileSceneDocument, validateSceneDocument, type SceneDocument, type RenderScene } from "@heytutor/scene-engine";
import { getSegmentCommands, takeDeferredAnnotations, verifiedDiagramCommandToDrawCommand,
  serializeSegmentCommands, type DrawCommand } from "@heytutor/drawing";
import { isAnswerLabel, withoutEarlyAnswerLabels } from "../../features/tutor-session/lib/scene/answerLabelReveal";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { buildLecturePlayerTimeline } from "../../lib/replay/lecturePlayer";
import { drawReplayDiagramTimeline } from "../../features/tutor-session/lib/replay/completeReplayDiagram";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";

function dimensionDocument(kind: "narration" | "callout"): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "synthetic measured span" },
    source: { question: "A synthetic rod has a given length of 2 m and a computed result of 3 N m.", nonMetric: true, representationTier: "qualitative_verified" },
    quantities: [{ id: "given", symbol: "D", value: 2, unit: "m", provenance: "given" },
      { id: "result", symbol: "Z", value: 3, unit: "N m", provenance: "derived" }],
    entities: [{ id: "p0", kind: "point", role: "endpoint" }, { id: "p1", kind: "point", role: "endpoint" },
      { id: "span", kind: "segment", role: "rod" }, { id: "measure", kind: "dimension", role: "length", label: "D" }],
    constructions: [{ id: "start", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["p0"] },
      { id: "end", operator: "point", inputs: { x: 2, y: 0 }, outputs: ["p1"] },
      { id: "rod", operator: "segment", inputs: { start: "p0", end: "p1" }, outputs: ["span"] },
      { id: "dimension", operator: "dimension", inputs: { start: "p0", end: "p1" }, outputs: ["measure"] }],
    relations: [], assertions: [], annotations: [
      { id: "source-value", kind: "label", targetIds: ["measure"], quantityId: "given", text: "D = 2 m" },
      { id: "computed", kind, targetIds: ["measure"], quantityId: "result", text: "Z = 3 N m" }],
    requiredEntityIds: ["span", "measure"],
    revealGroups: [{ id: "setup", entityIds: ["p0", "p1", "span", "measure"], dependsOn: [], narrationCue: "Here is the rod and its measured length D." }],
    teachingTimeline: [],
  };
}
async function verifyDocument(input: SceneDocument, name: string, computedBar = false): Promise<void> {
  const document = validateSceneDocument(input).document;
  assert(document, `${name}: synthetic source must validate`);
  const compiled = compileSceneDocument(document);
  assert(compiled.ok && compiled.renderScene, `${name}: honest measured span must compile`);
  const before = structuredClone(compiled.renderScene);
  const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene);
  const held = presentation.diagram.deferredAnnotations?.filter(batch => batch.revealAfter).flatMap(batch => batch.commands) ?? [];
  const measurement = presentation.diagram.commands.filter(command => command.type === "DIMENSION" || command.visualStyle?.measurementRole === "witness");
  const key = (command: { type: string; semanticRef?: { primitiveId?: string } }) => `${command.type}:${command.semanticRef?.primitiveId}`;
  const measurementKeys = new Set(measurement.map(key));
  const heldKeys = new Set(held.map(key));
  assert.equal(measurement.length, 3, `${name}: actual compiler emits a bar and two independently identified witnesses`);
  assert.equal(held.filter(command => measurementKeys.has(key(command))).length, computedBar ? 3 : 0, `${name}: only the displayed computed measurement owns bar/witness completion`);
  const intro = presentation.introSegments.flatMap(getSegmentCommands);
  assert.equal(intro.filter(command => measurementKeys.has(key(command))).length, computedBar ? 0 : 3, `${name}: named given measurement stays in setup`);
  const visibleResult = document.annotations.find(annotation => annotation.id === "computed" && annotation.kind === "callout");
  if (visibleResult) assert(held.some(command => command.semanticRef?.primitiveId === visibleResult.id), `${name}: the visible result callout stays completion-only independently of the bar`);
  for (const annotation of document.annotations.filter(annotation => annotation.kind === "narration")) {
    assert(!isAnswerLabel(document, { id: annotation.id }), `${name}: no-ink narration cannot own any reveal policy`);
    assert(!presentation.diagram.commands.some(command => command.semanticRef?.primitiveId === annotation.id), `${name}: narration has no compiled ink`);
  }
  const gesture = structuredClone(presentation.diagram);
  const released = takeDeferredAnnotations(gesture, { entityIds: document.entities.map(entity => entity.id) });
  assert(!released.some(command => heldKeys.has(key(command))), `${name}: gestures cannot release computed ink`);
  const commands = presentation.diagram.commands.map(verifiedDiagramCommandToDrawCommand);
  const projected = withoutEarlyAnswerLabels(document, commands);
  for (const command of measurement) assert.equal(projected.some(item => item.semanticRef?.primitiveId === command.semanticRef?.primitiveId), !computedBar, `${name}: historical measurement policy matches live`);
  assert(typeof document.source.question === "string", `${name}: synthetic source retains a question string`);
  const saved = await canonicalizeTurnSceneMetadata({ question: document.source.question!, sceneDocument: document, visualStatus: "validated", segments: [],
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: null, representationTier: "qualitative_verified", nonMetric: true, diagramResultStatus: "ready" } });
  assert(saved.ok, `${name}: current save boundary admits unchanged geometry: ${saved.ok ? "" : saved.error}`);
  const recorded = { id: `${name}-intro`, orderIndex: 0, narration: "The synthetic diagram is shown.", spokenText: "The synthetic diagram is shown.",
    command: serializeSegmentCommands(commands, { trustedDiagramGeometry: true }), durationMs: 100 };
  const turn = { id: name, question: document.source.question!, status: "complete", kind: "lesson", visualStatus: "validated", sceneDocument: document,
    sceneArtifacts: saved.value.sceneArtifacts, segments: [recorded] } as StoredTurn;
  const original = structuredClone(turn);
  const replay = buildReplayTimeline([turn]);
  assert.deepEqual(buildLecturePlayerTimeline([turn]).cues.map(cue => cue.commands), replay.cues.map(cue => cue.commands), `${name}: reopen/replay/finished player agree on historical setup`);
  const emitted: DrawCommand[] = []; let clock = 0;
  await drawReplayDiagramTimeline({ cues: replay.cues, getTurn: () => turn, getDiagram: () => presentation.diagram,
    executeCommand: async command => { emitted.push(command); }, getClockMs: () => clock,
    waitForAdvance: async () => { clock += 50; }, shouldCancel: () => false });
  for (const command of commands) assert.equal(emitted.filter(item => item.type === command.type && item.semanticRef?.primitiveId === command.semanticRef?.primitiveId).length, 1, `${name}: replay/export produces every exact verified command once`);
  assert.deepEqual(compiled.renderScene, before, `${name}: reveal policy never changes verified geometry`);
  assert.deepEqual(turn, original, `${name}: projection never changes stored content`);
}
function recordedStructures(): void {
  let bars = 0;
  assert.equal(fixtures.cases.length, 14, "retain every recovered source document, including the conservative extra case");
  for (const fixture of fixtures.cases) {
    const document = fixture.document as SceneDocument;
    const scene = fixture.renderScene as RenderScene;
    const geometry = structuredClone(scene);
    const presentation = buildVerifiedDiagramPresentation(document, scene);
    const measured = presentation.diagram.commands.filter(command => fixture.givenEntities.includes(command.semanticRef?.entityId ?? "") &&
      (command.type === "DIMENSION" || command.visualStyle?.measurementRole === "witness"));
    bars += measured.filter(command => command.type === "DIMENSION").length;
    const held = presentation.diagram.deferredAnnotations?.filter(batch => batch.revealAfter).flatMap(batch => batch.commands) ?? [];
    for (const command of measured) assert(!held.some(item => item.type === command.type && item.semanticRef?.primitiveId === command.semanticRef?.primitiveId), `${fixture.id}: exact given bar/witness cannot inherit result ownership`);
    const setup = [...presentation.introSegments.flatMap(getSegmentCommands), ...takeDeferredAnnotations(presentation.diagram, { entityIds: fixture.givenEntities })];
    for (const command of measured) assert(setup.some(item => item.type === command.type && item.semanticRef?.primitiveId === command.semanticRef?.primitiveId), `${fixture.id}: given measurement remains intro/FOCUS setup`);
    const recorded = presentation.diagram.commands.map(verifiedDiagramCommandToDrawCommand);
    const projected = withoutEarlyAnswerLabels(document, recorded);
    for (const command of measured) assert(projected.some(item => item.type === command.type && item.semanticRef?.primitiveId === command.semanticRef?.primitiveId), `${fixture.id}: historical projection keeps exact given measurement`);
    assert.deepEqual(scene, geometry, `${fixture.id}: no geometry mutation`);
  }
  assert.equal(bars, 16, "all sixteen reviewed given bars have durable structural regression coverage");
}

async function main(): Promise<void> {
  recordedStructures();
  for (const kind of ["narration", "callout"] as const) await verifyDocument(dimensionDocument(kind), kind);
  const entityGiven = dimensionDocument("callout");
  entityGiven.annotations = entityGiven.annotations.filter(annotation => annotation.id !== "source-value");
  await verifyDocument(entityGiven, "given-entity-label");
  const computed = dimensionDocument("narration");
  computed.entities.find(entity => entity.id === "measure")!.label = "D = 2 m";
  computed.quantities.find(quantity => quantity.id === "given")!.provenance = "derived";
  computed.annotations = [];
  await verifyDocument(computed, "computed-bar", true);
  const annotated = dimensionDocument("narration");
  delete annotated.entities.find(entity => entity.id === "measure")!.label;
  annotated.quantities.find(quantity => quantity.id === "given")!.provenance = "derived";
  annotated.annotations = annotated.annotations.filter(annotation => annotation.id === "source-value");
  await verifyDocument(annotated, "computed-measurement-label", true);
  annotated.annotations[0]!.text = "2 m";
  await verifyDocument(annotated, "bound-numeric-measurement-label", true);
  computed.entities.find(entity => entity.id === "measure")!.label = "D = a + b";
  await verifyDocument(computed, "formula-measurement-label", true);
  console.log("given dimension ownership: narration/callout separation, actual computed bar and live/save/replay/export parity pass");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
