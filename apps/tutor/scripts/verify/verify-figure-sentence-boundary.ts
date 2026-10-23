import assert from "node:assert/strict";
import type { RenderScene, SceneDocument } from "@heytutor/scene-engine";
import { findSpokenToken, mathToSpeech } from "@heytutor/tutor-core";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { hinglishFigureNarration } from "../../features/tutor-session/lib/scene/figureNarrationLanguage";

const cases = [
  ["The labels are O, I, etc. The current is not zero.", "labels O, I, etc हैं. current zero नहीं है."],
  ["The labels are O, I, etc. If the switch is open, the current is not zero.", "अगर switch open है, तो current zero नहीं है."],
  ["The labels are O, I, etc. Follow the ray from O to I.", "ray को O से I तक follow करो."],
  ["The labels are O, I, etc. This setup depends on an unspecified material.", "labels O, I, etc हैं. ध्यान दो: This setup depends on an unspecified material."],
  ["The labels are O, I, etc. If impedance varies nonlinearly, X tracks the spectral envelope without losing phase.", "labels O, I, etc हैं. ध्यान दो: If impedance varies nonlinearly, X tracks the spectral envelope without losing phase."],
  ["Compare e.g. HCl vs. HNO_3, i.e. Acids in Fig. A etc. Before heating.", "ध्यान दो: Compare e.g. HCl vs. HNO_3, i.e. Acids in Fig. A etc. Before heating."],
  ["Nitration with dil. HNO_3. The current is not zero.", "ध्यान दो: Nitration with dil. HNO_3. current zero नहीं है."],
  ["Use aq. HCl and approx. Equal volumes.", "ध्यान दो: Use aq. HCl and approx. Equal volumes."],
  ["Nitration with conc. H_2SO_4 and conc. HNO_3.", "ध्यान दो: Nitration with conc. H_2SO_4 and conc. HNO_3."],
] as const;
for (const [cue, expected] of cases) {
  assert(hinglishFigureNarration(cue).includes(expected), cue);
  const document: SceneDocument = {
    schemaVersion: "scene-document/v2", source: { question: "Explain the verified figure." },
    visualDecision: { mode: "scene", reason: "sentence boundary regression" }, quantities: [],
    entities: [{ id: "ray", kind: "segment", role: "ray" }],
    constructions: [], relations: [], assertions: [], annotations: [], requiredEntityIds: ["ray"],
    revealGroups: [{ id: "setup", entityIds: ["ray"], dependsOn: [], narrationCue: cue }], teachingTimeline: [],
  };
  const scene: RenderScene = {
    engineVersion: "scene-engine/2.0.0", revealGroups: document.revealGroups, timeline: [], entityBounds: {},
    primitives: [{ id: "ray_line", entityId: "ray", groupId: "setup", kind: "line", points: [{ x: 500, y: 300 }, { x: 800, y: 300 }] }],
  };
  const english = buildVerifiedDiagramPresentation(document, scene);
  const hinglish = buildVerifiedDiagramPresentation(document, scene, { narrationLanguage: "hinglish" });
  // Main's rule (#183): planner cue prose is never an opening narration
  // channel, translated or not. The figure sentence above stays for captions
  // and code lesson cues, which still translate through this function.
  const spoken = hinglish.introSegments.map(segment => segment.narration).join(" ");
  assert(!spoken.includes(hinglishFigureNarration(cue)), `presenter must not speak the translated planner cue: ${cue}`);
  assert(!spoken.includes(cue), `presenter must not speak the planner cue: ${cue}`);
  assert(!spoken.includes(expected), `presenter must not speak the translated clause: ${cue}`);
  assert.deepEqual(hinglish.diagram.commands, english.diagram.commands, "sentence handling preserves verified ink");
  for (const segment of hinglish.introSegments) for (const command of segment.commands ?? []) {
    assert(command.spokenCue?.token && findSpokenToken(mathToSpeech(segment.narration), mathToSpeech(command.spokenCue.token)) >= 0);
  }
}
console.log("verify-figure-sentence-boundary: etc-ending sentences localize independently; reagent/modifier abbreviations and real ink cues survive; openings never speak planner cue prose");
