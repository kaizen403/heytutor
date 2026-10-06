import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { compileSceneDocument, type RenderScene, type SceneDocument } from "@heytutor/scene-engine";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { verifiedLayoutNarration } from "../../features/tutor-session/lib/scene/verifiedLayoutNarration";
import { buildTurnTeachingPrompt, figureAddonForDoubt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";
import { serverChatBody } from "../../lib/llm/chatRequest";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/verified-layout-ohm-live.json", import.meta.url), "utf8"));
const document: SceneDocument = fixture.sceneDocument;
const originalDocument = JSON.stringify(document);
const originalFixture = JSON.stringify(fixture);
const compiled = compileSceneDocument(document);
assert(compiled.ok && compiled.renderScene, "saved actual Ohm scene must compile");
const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene);
const transport = { ...presentation, diagram: { ...presentation.diagram, promptAddon: undefined } };
const snapshotPath = process.argv[process.argv.indexOf("--snapshot") + 1];
if (process.argv.includes("--snapshot")) writeFileSync(snapshotPath, JSON.stringify(transport, null, 2));
if (process.argv.includes("--baseline")) {
  const baselinePath = process.argv[process.argv.indexOf("--baseline") + 1];
  assert.deepEqual(JSON.parse(JSON.stringify(transport)), JSON.parse(readFileSync(baselinePath, "utf8")), "all original ink, anchors, reveal timing and intro narration must remain identical");
}
assert.match(presentation.diagram.promptAddon ?? "", /\[FOCUS:R1\] is above \[FOCUS:battery\]/,
  "the real teaching brief must carry the compiled above/below layout, rather than leaving the model to guess left/right");
const addon = presentation.diagram.promptAddon!;
const layoutLine = (text: string) => text.split("\n").find((line) => line.startsWith("Verified screen layout facts"))!;
assert.doesNotMatch(layoutLine(addon), /left of/, "overlapping horizontal envelopes cannot prove left/right");
assert.match(addon, /Describe screen placement only using these facts/);
assert.match(addon, /If no fact establishes a placement, omit that placement/);
assert.match(addon, /"resistor 6 Ω" = \[FOCUS:R1\]/);
assert.match(addon, /"battery 12 V" = \[FOCUS:battery\]/);
assert.match(addon, /\[FOCUS:battery\] means battery/);

// Transform the actual construction inputs, then recompile through the engine.
// A customary circuit description cannot pass both orientations.
for (const [name, transform, expected, absent] of [
  ["translated and scaled", (x: number, y: number) => [3 * x + 17, 3 * y - 11], /\[FOCUS:R1\] is above \[FOCUS:battery\]/, /left of/],
  ["quarter turn", (x: number, y: number) => [-y + 17, x - 11], /\[FOCUS:R1\] is left of \[FOCUS:battery\]/, /is above/],
  ["half turn", (x: number, y: number) => [-x + 17, -y - 11], /\[FOCUS:battery\] is above \[FOCUS:R1\]/, /left of/],
] as const) {
  const moved = structuredClone(document);
  for (const construction of moved.constructions) {
    const { x, y } = construction.inputs;
    if (construction.operator === "point" && typeof x === "number" && typeof y === "number") {
      [construction.inputs.x, construction.inputs.y] = transform(x, y);
    }
  }
  const result = compileSceneDocument(moved);
  assert(result.ok && result.renderScene, `${name} actual scene must compile`);
  const text = buildVerifiedDiagramPresentation(moved, result.renderScene).diagram.promptAddon!;
  assert.match(layoutLine(text), expected, name);
  assert.doesNotMatch(layoutLine(text), absent, name);
}

// Independent generic marks: bounds, rather than component names or centres,
// must decide whether a spatial statement is justified.
const genericScene: RenderScene = {
  engineVersion: "scene-engine/2.0.0",
  primitives: [
    { id: "a", entityId: "alpha", groupId: "g", kind: "circle", points: [{ x: 600, y: 200 }], radius: 40 },
    { id: "b", entityId: "beta", groupId: "g", kind: "circle", points: [{ x: 800, y: 400 }], radius: 40 },
    { id: "label", entityId: "textOnly", groupId: "g", kind: "label", points: [{ x: 1100, y: 100 }], text: "T" },
  ],
  entityBounds: {
    alpha: { x: 560, y: 160, width: 80, height: 80 },
    beta: { x: 760, y: 360, width: 80, height: 80 },
    textOnly: { x: 1100, y: 100, width: 20, height: 20 },
  },
  revealGroups: [], timeline: [],
};
const genericFacts = layoutLine(verifiedLayoutNarration(genericScene, ["alpha", "beta", "textOnly", "missing", "alpha"]));
assert.match(genericFacts, /\[FOCUS:alpha\] is left of \[FOCUS:beta\]/);
assert.match(genericFacts, /\[FOCUS:alpha\] is above \[FOCUS:beta\]/);
assert.doesNotMatch(genericFacts, /textOnly|missing/);
const overlap = structuredClone(genericScene);
overlap.entityBounds.beta = { x: 600, y: 200, width: 80, height: 80 };
assert.match(layoutLine(verifiedLayoutNarration(overlap, ["alpha", "beta"])), /: none$/, "overlap must not become a centre-based direction");
const touching = structuredClone(genericScene);
touching.entityBounds.beta = { x: 640, y: 240, width: 80, height: 80 };
assert.match(layoutLine(verifiedLayoutNarration(touching, ["alpha", "beta"])), /: none$/, "touching envelopes do not prove strict separation");
for (const bounds of [
  { x: NaN, y: 0, width: 10, height: 10 },
  { x: 0, y: 0, width: -10, height: 10 },
  { x: Infinity, y: 0, width: 10, height: 10 },
]) {
  const invalid = structuredClone(genericScene);
  invalid.entityBounds.beta = bounds;
  assert.match(layoutLine(verifiedLayoutNarration(invalid, ["alpha", "beta"])), /: none$/);
}
const annotation = structuredClone(genericScene);
annotation.primitives[1]!.provenance = { annotation: "highlight" };
assert.match(layoutLine(verifiedLayoutNarration(annotation, ["alpha", "beta"])), /: none$/);
annotation.primitives[1]!.provenance = { dsaExtent: true };
assert.match(layoutLine(verifiedLayoutNarration(annotation, ["alpha", "beta"])), /: none$/);

const dense = structuredClone(genericScene);
dense.primitives = [];
dense.entityBounds = {};
for (let i = 0; i < 100; i++) {
  const id = `part_${i}`;
  dense.primitives.push({ id, entityId: id, groupId: "g", kind: "point", points: [{ x: i * 10, y: i * 10 }] });
  dense.entityBounds[id] = { x: i * 10, y: i * 10, width: 0, height: 0 };
}
const denseFacts = layoutLine(verifiedLayoutNarration(dense, Object.keys(dense.entityBounds)));
assert.equal(denseFacts.split("; ").length, 32, "dense scenes have a bounded brief rather than quadratic prompt growth");

// The saved tier metadata travels separately from the document. Test its
// non-metric contract too, without changing the captured document or ink.
const nonMetricDocument = structuredClone(document);
nonMetricDocument.source = { ...nonMetricDocument.source, nonMetric: fixture.nonMetric, representationTier: fixture.representationTier };
const nonMetricPresentation = buildVerifiedDiagramPresentation(nonMetricDocument, compiled.renderScene);
assert.match(nonMetricPresentation.diagram.promptAddon!, /intentionally non-metric/);
assert.match(nonMetricPresentation.diagram.promptAddon!, /question_representation/);
assert.match(nonMetricPresentation.diagram.promptAddon!, /establishes no physical direction, polarity, connection, scale, distance, or solved value/);
assert.deepEqual(nonMetricPresentation.diagram.commands, presentation.diagram.commands);
assert.deepEqual(nonMetricPresentation.diagram.anchors, presentation.diagram.anchors);

const prompt = buildTurnTeachingPrompt({
  question: fixture.question, diagramPromptAddon: addon,
  turnPlan: fixture.turnPlan, solverProjection: null, codeLesson: null,
  isDsa: false, familiarity: "normal", fastMode: false,
});
const factLine = layoutLine(addon);
assert(prompt.systemPrompt.includes(factLine), "normal teacher receives compiled layout facts");
assert(prompt.continuationPrompt.includes(factLine), "continuations retain the layout contract");
assert(figureAddonForDoubt(addon).includes(factLine), "doubts retain screen facts when lesson-flow lines are removed");
const providerBody = serverChatBody({ messages: [{ role: "system", content: prompt.systemPrompt }, { role: "user", content: fixture.question }] });
assert.deepEqual(providerBody.messages, [{ role: "system", content: prompt.systemPrompt }, { role: "user", content: fixture.question }], "provider normalization preserves the actual system prompt byte for byte");
assert.equal(JSON.stringify(document), originalDocument, "presentation and prompt assembly must not mutate the captured source document");
assert.equal(JSON.stringify(fixture), originalFixture, "captured plan, ProblemIR and solver result remain unchanged");
if (process.argv.includes("--report")) {
  const reportPath = process.argv[process.argv.indexOf("--report") + 1];
  writeFileSync(reportPath, JSON.stringify({
    scope: "Offline reconstruction from saved scene and turn plan; not a captured live provider request. Solver projection was not supplied to this harness.",
    sourceEvidence: fixture.sourceEvidence,
    failedNarration: fixture.failedNarration,
    savedTier: fixture.representationTier,
    savedNonMetric: fixture.nonMetric,
    savedDocumentSource: document.source,
    compiledEntityBounds: compiled.renderScene.entityBounds,
    diagramPromptAddon: addon,
    nonMetricPromptAddon: nonMetricPresentation.diagram.promptAddon,
    providerBody,
  }, null, 2));
}
console.log("PASS verified layout narration: saved Ohm, moved/rotated layouts, independent marks, conservative negatives, unchanged transport and prompt delivery (offline only; model compliance requires fresh live review)");
