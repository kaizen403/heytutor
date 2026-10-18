import assert from "node:assert/strict";
import type { RenderScene, SceneDocument } from "@heytutor/scene-engine";
import { buildDsaOpeningSegments, findSpokenToken, mathToSpeech } from "@heytutor/tutor-core";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import englishFigureBaseline from "./fixtures/english-figure-narration.json";

// The captured river lesson opened in Hinglish, then its two verified figure
// groups spoke English. Keep those groups independent of paid planner output.
const document: SceneDocument = {
  schemaVersion: "scene-document/v2", source: { question: "A boat crosses a river flowing east." },
  visualDecision: { mode: "scene", reason: "verified fixture" }, quantities: [],
  entities: [
    { id: "bank", kind: "segment", role: "bank" },
    { id: "boat", kind: "point", role: "boat", label: "B" },
    { id: "current", kind: "vector", role: "current", label: "u" },
    { id: "heading", kind: "vector", role: "upstream boat heading", label: "v" },
  ],
  constructions: [], relations: [], assertions: [], annotations: [], requiredEntityIds: ["bank", "boat", "current", "heading"],
  revealGroups: [
    { id: "setup", entityIds: ["bank", "boat", "current"], dependsOn: [], narrationCue: "show scene" },
    { id: "heading", entityIds: ["heading"], dependsOn: ["setup"], narrationCue: "show the physical setup" },
  ], teachingTimeline: [],
};
const renderScene: RenderScene = {
  engineVersion: "scene-engine/2.0.0", revealGroups: document.revealGroups, timeline: [],
  primitives: [
    { id: "bank_line", entityId: "bank", groupId: "setup", kind: "line", points: [{ x: 450, y: 450 }, { x: 1000, y: 450 }] },
    { id: "boat_point", entityId: "boat", groupId: "setup", kind: "point", points: [{ x: 700, y: 450 }] },
    { id: "current_arrow", entityId: "current", groupId: "setup", kind: "vector", points: [{ x: 700, y: 300 }, { x: 900, y: 300 }] },
    { id: "heading_arrow", entityId: "heading", groupId: "heading", kind: "vector", points: [{ x: 700, y: 450 }, { x: 600, y: 200 }] },
  ], entityBounds: {},
};

const english = buildVerifiedDiagramPresentation(document, renderScene);
assert.deepEqual(buildVerifiedDiagramPresentation(document, renderScene, { narrationLanguage: "english" }), english, "the default English figure presentation remains byte-identical");
const hinglish = buildVerifiedDiagramPresentation(document, renderScene, { narrationLanguage: "hinglish" });
assert.equal(hinglish.introSegments.length, 2, "the captured failure has two independently narrated figure groups");
for (const segment of hinglish.introSegments) {
  assert.match(segment.narration, /\p{Script=Devanagari}/u, `a Hinglish figure opening must not speak an English sentence: ${segment.narration}`);
  for (const command of segment.commands ?? []) {
    assert(command.spokenCue?.token && segment.narration.includes(command.spokenCue.token), "localized figure ink keeps its real spoken cue");
    assert(findSpokenToken(mathToSpeech(segment.narration), mathToSpeech(command.spokenCue.token)) >= 0, "the actual speech scheduler can locate every localized figure cue as a word");
  }
}
assert.deepEqual(hinglish.diagram.commands, english.diagram.commands, "changing opening language preserves every verified diagram mark");

// A complete explanation carries a relationship, not just the names of its
// parts. This is the principal-ray cue emitted by the mirror scene family.
const mirrorDocument: SceneDocument = {
  ...document, source: { question: "Show the principal rays from an object to its image in a mirror." },
  entities: [
    { id: "object", kind: "vector", role: "object", label: "O" },
    { id: "image", kind: "vector", role: "image", label: "I" },
    { id: "rays", kind: "segment", role: "principal rays" },
  ], requiredEntityIds: ["object", "image", "rays"],
  revealGroups: [{ id: "rays", entityIds: ["object", "image", "rays"], dependsOn: [], narrationCue: "Follow the principal rays from the object to the image." }],
};
const mirrorScene: RenderScene = {
  ...renderScene, revealGroups: mirrorDocument.revealGroups,
  primitives: [
    { id: "object_arrow", entityId: "object", groupId: "rays", kind: "vector", points: [{ x: 500, y: 400 }, { x: 500, y: 250 }] },
    { id: "image_arrow", entityId: "image", groupId: "rays", kind: "vector", points: [{ x: 950, y: 400 }, { x: 950, y: 450 }] },
    { id: "principal_ray", entityId: "rays", groupId: "rays", kind: "line", points: [{ x: 500, y: 250 }, { x: 800, y: 250 }, { x: 950, y: 450 }] },
  ],
};
const mirrorHinglish = buildVerifiedDiagramPresentation(mirrorDocument, mirrorScene, { narrationLanguage: "hinglish" });
assert(mirrorHinglish.introSegments.some(segment => segment.narration.includes("principal rays को object से image तक follow करो.")),
  "Hinglish must retain the complete instruction: follow the principal rays from the object to the image");
const denseMirrorScene: RenderScene = {
  ...mirrorScene,
  primitives: [
    ...mirrorScene.primitives.slice(0, 2),
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `principal_ray_${index}`, entityId: "rays", groupId: "rays", kind: "line" as const,
      points: [{ x: 500, y: 200 + index * 10 }, { x: 800, y: 200 + index * 10 }, { x: 950, y: 450 - index * 5 }],
    })),
  ],
};
const denseMirrorHinglish = buildVerifiedDiagramPresentation(mirrorDocument, denseMirrorScene, { narrationLanguage: "hinglish" });
assert(denseMirrorHinglish.introSegments.some(segment => segment.narration.includes("इतना setup तैयार है.")), "the dense fixture must actually exercise the spoken walkthrough used when ink outlasts its cue");
assert(denseMirrorHinglish.introSegments.some(segment => segment.narration.includes("principal rays को object से image तक follow करो.")), "the ink-duration walkthrough must also preserve the complete explanatory instruction");
const denseMirrorEnglish = buildVerifiedDiagramPresentation(mirrorDocument, denseMirrorScene);
assert.deepEqual(buildVerifiedDiagramPresentation(mirrorDocument, denseMirrorScene, { narrationLanguage: "english" }), denseMirrorEnglish, "meaning preservation leaves the existing English presentation unchanged");
assert.deepEqual(denseMirrorHinglish.diagram.commands, denseMirrorEnglish.diagram.commands, "preserving the explanation cannot alter any verified figure geometry or label");
for (const segment of denseMirrorHinglish.introSegments) {
  for (const command of segment.commands ?? []) {
    assert(command.spokenCue?.token && findSpokenToken(mathToSpeech(segment.narration), mathToSpeech(command.spokenCue.token)) >= 0, "dense explanation retains schedulable spoken cue words");
  }
}
const explanatoryCue = "O is the object in front of the mirror, and I is the image.";
const explainedMirrorDocument: SceneDocument = {
  ...mirrorDocument, revealGroups: [{ ...mirrorDocument.revealGroups[0]!, narrationCue: explanatoryCue }],
};
const explainedMirror = buildVerifiedDiagramPresentation(explainedMirrorDocument, { ...denseMirrorScene, revealGroups: explainedMirrorDocument.revealGroups }, { narrationLanguage: "hinglish" });
assert(explainedMirror.introSegments.some(segment => segment.narration.includes("O mirror के सामने object है, और I image है.")), "the complete object/mirror/image relationship uses Hindi grammar, not a Hindi prefix on an English sentence");
for (const [cue, expected] of [
  ["At 5 km/h east, the girl observes vertical rain.", "5 km/h east पर girl के observation में vertical rain है."],
  ["At 20 km/h east, rain from the front appears 60° from vertical.", "20 km/h east पर front से rain का apparent view vertical से 60° पर है."],
  ["The unchanged true rain velocity is 10 km/h, downward and eastward at 30° to the vertical.", "unchanged true rain velocity 10 km/h, downward और eastward vertical से 30° पर है."],
  ["The ball leaves O horizontally above the descending slope.", "ball O से horizontally descending slope के ऊपर निकलता है."],
  ["Show the ball's path toward the slope.", "slope की ओर ball's path देखो."],
  ["The ball strikes after 3 s, 75 m down the slope from O.", "ball का impact 3 s के बाद, O से slope के along 75 m नीचे होता है."],
  ["If the switch is open, the current is not zero.", "अगर switch open है, तो current zero नहीं है."],
  ["Unless the switch is open, the current is not zero.", "अगर ऐसा नहीं है कि switch open है, तो current zero नहीं है."],
  ["O is 3.5 m above I. I is not the image.", "O 3.5 m I के ऊपर है. I image नहीं है."],
  ["The current is Not zero.", "current zero नहीं है."],
  ["The activation energy is the climb from the reactant level to the top of the barrier.", "ध्यान दो: The activation energy is the climb from the reactant level to the top of the barrier."],
  ["The car is moving from A to B.", "ध्यान दो: The car is moving from A to B."],
  ["The displacement is the arrow from P to Q.", "ध्यान दो: The displacement is the arrow from P to Q."],
  ["The rain appears to fall from the front.", "ध्यान दो: The rain appears to fall from the front."],
  ["Reactant and reagent dil. HNO_3", "ध्यान दो: Reactant and reagent dil. HNO_3."],
  ["Nitration with conc. H_2SO_4 and conc. HNO_3.", "ध्यान दो: Nitration with conc. H_2SO_4 and conc. HNO_3."],
  ["Use aq. HCl and approx. Equal volumes.", "ध्यान दो: Use aq. HCl and approx. Equal volumes."],
  ["Compare e.g. HCl vs. HNO_3, i.e. Acids in Fig. A etc. Before heating.", "ध्यान दो: Compare e.g. HCl vs. HNO_3, i.e. Acids in Fig. A etc. Before heating."],
  ["Nitration with dil. HNO_3. O is the object.", "ध्यान दो: Nitration with dil. HNO_3. O object है."],
] as const) {
  const cueDocument = { ...mirrorDocument, revealGroups: [{ ...mirrorDocument.revealGroups[0]!, narrationCue: cue }] };
  const cueScene = { ...denseMirrorScene, revealGroups: cueDocument.revealGroups };
  const translated = buildVerifiedDiagramPresentation(cueDocument, cueScene, { narrationLanguage: "hinglish" });
  assert(translated.introSegments.some(segment => segment.narration.includes(expected)), `${cue}: preserve the complete explanation in Hinglish grammar`);
  assert.deepEqual(buildVerifiedDiagramPresentation(cueDocument, cueScene, { narrationLanguage: "english" }), buildVerifiedDiagramPresentation(cueDocument, cueScene), "English output remains byte-identical");
  assert.deepEqual(translated.diagram.commands, buildVerifiedDiagramPresentation(cueDocument, cueScene).diagram.commands, "localizing prose preserves verified ink");
  for (const segment of translated.introSegments) for (const command of segment.commands ?? [])
    assert(command.spokenCue?.token && findSpokenToken(mathToSpeech(segment.narration), mathToSpeech(command.spokenCue.token)) >= 0, "translated clauses retain schedulable ink cues");
}
const lostUnknownCues: string[] = [];
for (const unknownCue of [
  "If impedance varies nonlinearly, X tracks the spectral envelope without losing phase.",
  "Unless impedance varies nonlinearly, X is not zero.",
  "The reflected beam does not change phase unless impedance varies nonlinearly.",
  "The ball leaves the point O horizontally above the slope.",
  "The force is not only vertical but also upward.",
  "The image is above O and below I.",
  "The image is above O and to the left of I.",
  "The image is above O and also slightly to the right of I.",
  "The image is above O and I.",
  "The image is above O when the object is below the axis.",
  "The image is above O, which is below the mirror.",
  "The force is not zero but positive.",
  "The force is not necessarily vertical.",
  "The force is not always vertical.",
  "Follow the ray from O to I when the switch is open.",
  "Show the object above O, which is below the mirror.",
  "Trace the ray from O to I and then extend it backward.",
]) {
  const unknownDocument = { ...mirrorDocument, revealGroups: [{ ...mirrorDocument.revealGroups[0]!, narrationCue: unknownCue }] };
  const unknownPresentation = buildVerifiedDiagramPresentation(unknownDocument, { ...mirrorScene, revealGroups: unknownDocument.revealGroups }, { narrationLanguage: "hinglish" });
  if (!unknownPresentation.introSegments.some(segment => segment.narration.includes(unknownCue))) lostUnknownCues.push(unknownCue);
}
assert.deepEqual(lostUnknownCues, [], "unsupported technical grammar preserves its entire condition, relationship and negation; it is not replaced by an entity list");

const restoredDocument: SceneDocument = {
  schemaVersion: "scene-document/v2", source: { question: "In Cartesian coordinates, A=(0,0), B=(3,4). Show the distance AB." },
  visualDecision: { mode: "scene", reason: "source-grounded distance" }, quantities: [],
  entities: [{ id: "distance", kind: "segment", role: "distance AB" }],
  constructions: [{ id: "distanceConstruction", operator: "coordinate_distance", inputs: { a: { x: 0, y: 0 }, b: { x: 3, y: 4 } }, outputs: ["distance"] }],
  relations: [], assertions: [], annotations: [], requiredEntityIds: ["distance"],
  revealGroups: [{ id: "distanceGroup", entityIds: ["distance"], dependsOn: [], narrationCue: "distance AB" }], teachingTimeline: [],
};
const restoredEnglish = restoreVerifiedPresentationFromTurn({ sceneDocument: restoredDocument });
const restoredHinglish = restoreVerifiedPresentationFromTurn({ sceneDocument: restoredDocument }, "hinglish");
assert(restoredEnglish && restoredHinglish, "an undrawn saved figure must actually compile through public source validation and restore");
assert.deepEqual(restoredHinglish.diagram.commands, restoredEnglish.diagram.commands, "Hinglish restore rebuilds exactly the same source-grounded ink");
for (const segment of restoredHinglish.introSegments) {
  assert.match(segment.narration, /\p{Script=Devanagari}/u, "a freshly rebuilt missing intro follows the current turn voice");
}
const codeFigure = buildVerifiedDiagramPresentation(document, renderScene, { layout: "code_lesson", narrationLanguage: "hinglish" });
for (const segment of codeFigure.introSegments) {
  assert.match(segment.narration, /\p{Script=Devanagari}/u, "code figure openings follow the same lesson language");
}
for (const reveal of codeFigure.diagram.reveals ?? []) {
  assert.doesNotMatch(reveal.narration, /The rest of this setup|Let’s begin|Next comes|The labels|The label /, "code reveal templates also follow the lesson language");
}
const captionedCode = buildVerifiedDiagramPresentation(mirrorDocument, { ...mirrorScene, caption: explanatoryCue }, { layout: "code_lesson", narrationLanguage: "hinglish" });
assert(captionedCode.introSegments.some(segment => segment.narration.includes("O mirror के सामने object है, और I image है.")), "code caption prose is localized completely too");
const chunkedCodeScene: RenderScene = { ...mirrorScene, primitives: [
  ...mirrorScene.primitives,
  ...Array.from({ length: 20 }, (_, index) => ({ id: `code_line_${index}`, entityId: "rays", groupId: "rays", kind: "line" as const, points: [{ x: 500, y: 220 + index }, { x: 800, y: 220 + index }] })),
] };
const chunkedCode = buildVerifiedDiagramPresentation(mirrorDocument, chunkedCodeScene, { layout: "code_lesson", narrationLanguage: "hinglish" });
assert((chunkedCode.diagram.reveals?.length ?? 0) > 1, "the code fixture must actually reach the continuation template");
assert(chunkedCode.diagram.reveals?.slice(1).every(reveal => reveal.narration === "अब setup का बाकी हिस्सा पूरा करते हैं."), "every code chunk continuation uses Hindi grammar");
// Fixed narration captured through origin/main's presenter at sourceCommit in
// the fixture. Comparing default with explicit English alone misses a shared
// wrong-language branch, including the independent code-caption opening path.
const unlabelledCodeDocument: SceneDocument = {
  ...mirrorDocument, entities: mirrorDocument.entities.map(entity => ({ ...entity, label: undefined })),
  revealGroups: [{ ...mirrorDocument.revealGroups[0]!, narrationCue: explanatoryCue }],
};
const unlabelledCodeScene = { ...mirrorScene, revealGroups: unlabelledCodeDocument.revealGroups };
assert(buildVerifiedDiagramPresentation(unlabelledCodeDocument, unlabelledCodeScene, { layout: "code_lesson" }).diagram.commands.every(command => command.type !== "LABEL"),
  "the fixed code structure baseline must exercise a figure without label narration");
for (const [id, baselineDocument, baselineScene, options] of [
  ["river", document, renderScene, {}],
  ["mirror", mirrorDocument, mirrorScene, {}],
  ["dense-mirror", mirrorDocument, denseMirrorScene, {}],
  ["captioned-code", mirrorDocument, { ...mirrorScene, caption: explanatoryCue }, { layout: "code_lesson" }],
  ["chunked-code", mirrorDocument, chunkedCodeScene, { layout: "code_lesson" }],
  ["unlabelled-code", unlabelledCodeDocument, unlabelledCodeScene, { layout: "code_lesson" }],
] as const) {
  const expected = englishFigureBaseline.rows.find(row => row.id === id);
  assert(expected, `fixed English baseline exists for ${id}`);
  for (const narrationLanguage of [undefined, "english"] as const) {
    const presentation = buildVerifiedDiagramPresentation(baselineDocument, baselineScene, { ...options, narrationLanguage });
    assert.deepEqual({
      intro: presentation.introSegments.map(segment => segment.narration),
      reveals: (presentation.diagram.reveals ?? []).map(reveal => reveal.narration),
    }, { intro: expected.intro, reveals: expected.reveals }, `${id}: English intro and reveals match the fixed main baseline`);
  }
}
for (const [labelDocument, labels, expected] of [
  [mirrorDocument, ["O", "I"], "O object है, और I image है."],
  [{ ...mirrorDocument, entities: mirrorDocument.entities.map(entity => ({ ...entity, role: "part" })) }, ["X", "Y"], "X और Y labels से figure के ये parts पहचानते हैं."],
] as const) {
  const labelScene: RenderScene = { ...mirrorScene, primitives: [
    ...mirrorScene.primitives,
    { id: "object_label", entityId: "object", groupId: "rays", kind: "label", text: labels[0], points: [{ x: 500, y: 230 }], labelPlacement: "absolute" },
    { id: "image_label", entityId: "image", groupId: "rays", kind: "label", text: labels[1], points: [{ x: 950, y: 470 }], labelPlacement: "absolute" },
  ] };
  const labeled = buildVerifiedDiagramPresentation(labelDocument, labelScene, { layout: "code_lesson", narrationLanguage: "hinglish" });
  assert(labeled.diagram.reveals?.some(reveal => reveal.narration === expected), "both identified-point and generic-label code templates are localized");
  assert.deepEqual(buildVerifiedDiagramPresentation(labelDocument, labelScene, { layout: "code_lesson", narrationLanguage: "english" }), buildVerifiedDiagramPresentation(labelDocument, labelScene, { layout: "code_lesson" }), "default/explicit English code reveals are byte-identical");
}
const lesson = {
  question: "A ball has speed u = 20 m/s. Find the distance after 4 s.",
  diagramPromptAddon: null, turnPlan: null, solverProjection: null, codeLesson: null,
  isDsa: false, familiarity: "normal" as const, fastMode: true,
};
const englishProblem = buildTurnTeachingPrompt(lesson);
assert.deepEqual(buildTurnTeachingPrompt({ ...lesson, narrationLanguage: "english" }), englishProblem, "default English problem opening and prompts remain byte-identical");
const hinglishProblem = buildTurnTeachingPrompt({ ...lesson, narrationLanguage: "hinglish" });
assert(hinglishProblem.givenSegments.length > 0, "the opening gate must include actual Given rows");
for (const segment of hinglishProblem.givenSegments) {
  assert.match(segment.narration, /\p{Script=Devanagari}/u, "runtime Given rows must not restart a Hinglish lesson in English");
}
assert.deepEqual(hinglishProblem.givenSegments.map(segment => segment.command?.text), englishProblem.givenSegments.map(segment => segment.command?.text), "the Given board text stays English and byte-identical");
const codeInput = { title: "Binary search", question: "Find the target in a sorted array. Return -1 if it is absent.", example: { nums: [2, 5, 8], target: 5 } };
const englishCodeRows = buildDsaOpeningSegments(codeInput);
assert.deepEqual(buildDsaOpeningSegments({ ...codeInput, language: "english" }), englishCodeRows, "default English code opening rows remain byte-identical");
const hinglishCodeRows = buildDsaOpeningSegments({ ...codeInput, language: "hinglish" });
assert(hinglishCodeRows[0]?.narration.replace(/\s+/g, " ").includes("Find the target in a sorted array. Return -1 if it is absent."), "the Hinglish framing preserves the complete original ask and its absent-target condition");
for (const segment of hinglishCodeRows) {
  assert.match(segment.narration, /\p{Script=Devanagari}/u, "the runtime code problem and example rows open in Hinglish too");
}
assert.deepEqual(hinglishCodeRows.map(segment => segment.command?.text), englishCodeRows.map(segment => segment.command?.text), "code opening ink stays unchanged");
console.log("verify-hinglish-opening: both figure opening groups use Hinglish, with unchanged verified geometry and valid ink cues");
