import assert from "node:assert/strict";
import { captureCommandInk, parseStoredSegmentCommands, serializeSegmentCommands, verifiedDiagramCommandToDrawCommand,
  type VerifiedDiagramPresentation } from "@heytutor/drawing";
import { applyScientificStyleToPresentation, parseScientificStyleLecture, prepareScientificCommandInk } from "../../lib/scene/scientificStyleLecture";

const style = { schema: "scientific-style-lecture/v1", paletteId: "teal", sampleHash: "a".repeat(64) };
assert.deepEqual(parseScientificStyleLecture(style), style);
assert.equal(parseScientificStyleLecture({ ...style, paletteId: "#ff0000" }), null);
assert.equal(parseScientificStyleLecture({ ...style, geometry: [] }), null);
const geometry = { type: "DRAW_LINE" as const, params: [450, 200, 700, 400], semanticRef: { entityId: "body", primitiveId: "body_line" } };
const label = { type: "LABEL" as const, params: [460, 180, 24], text: "body", semanticRef: { entityId: "body" } };
const answer = { type: "LABEL" as const, params: [700, 430, 24], text: "x = 5 m" };
const presentation: VerifiedDiagramPresentation = {
  diagram: { id: "verified_scene", name: "body", commands: [geometry, label], anchors: [], reveals: [], promptAddon: "source authority",
    deferredAnnotations: [{ entityId: "answer", revealAfter: "teaching_complete", commands: [answer] }] },
  introSegments: [{ narration: "The body", command: verifiedDiagramCommandToDrawCommand(geometry), verifiedDiagramIntro: true }],
};
const before = structuredClone(presentation);
applyScientificStyleToPresentation(presentation, style);
assert.equal(presentation.diagram.commands[0]!.visualStyle?.scientificPalette, "teal", "native geometry must acquire the validated palette");
assert.deepEqual(presentation.diagram.commands[0]!.params, before.diagram.commands[0]!.params);
assert.deepEqual(presentation.diagram.commands[1], before.diagram.commands[1], "label text and black ink are unchanged");
assert.deepEqual(presentation.diagram.deferredAnnotations, before.diagram.deferredAnnotations, "answer ink remains deferred and unchanged");
assert.equal(presentation.diagram.id, "verified_scene");
assert.equal(presentation.diagram.promptAddon, before.diagram.promptAddon);
const draw = verifiedDiagramCommandToDrawCommand(presentation.diagram.commands[0]!);
const settings = { markerColor: "#ff0000", pencilColor: "#222222", markerThickness: 3, pencilThickness: 2 };
prepareScientificCommandInk(draw, settings);
captureCommandInk(draw, settings);
assert.equal(draw.inkSettings?.pencilColor, "#0b4a48");
prepareScientificCommandInk(draw, { ...settings, pencilColor: "#ffff00" });
assert.equal(draw.inkSettings?.pencilColor, "#0b4a48", "recorded colors stay fixed after settings change");
const stored = parseStoredSegmentCommands(serializeSegmentCommands([draw]));
assert.deepEqual(stored[0]?.inkSettings, draw.inkSettings, "replay keeps the drawn palette");
const disabled = structuredClone(before);
applyScientificStyleToPresentation(disabled, null);
assert.deepEqual(disabled, before, "disabled or malformed style must preserve the original presentation");
console.log("scientific style lecture: fixed palette, unchanged geometry/labels/answers and recorded ink pass");
