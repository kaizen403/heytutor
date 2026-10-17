/** Family facts must survive the real figure → lesson/resume prompt boundary.
 * Chemistry references (accessed 18 Oct 2026):
 * https://ncert.nic.in/textbook/pdf/lech102.pdf §2.4.2, pp46–50
 * https://interaktiv.chemie.uni-mainz.de/vpcgp/ml-man.en.html
 * https://sathee.iitk.ac.in/ncert-books/udaan/udaan-che-12/chem-12-unit-03-electrochemistry/
 * These are prompt/verified-family gates, not a claim about a new paid lesson.
 */
import assert from "node:assert/strict";
import {
  chemistryFamilyBuilder, compileSceneDocument, validateSceneDocument,
} from "@heytutor/scene-engine";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { buildResumeTeachingPrompt, buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";

const build = chemistryFamilyBuilder("chem_electrochem");
assert(build);
const question = "Kohlrausch law simple Hinglish mein samjhao. Strong electrolyte ke liye molar conductivity vs sqrt(c) graph kaisa hota hai? Explanation chhoti rakhna, please.";
const requirements: ReadonlyArray<[string, RegExp]> = [
  ["dilute strong-electrolyte domain", /strong-electrolyte[\s\S]*dilute, low-concentration limit/],
  ["solvent and temperature fixed", /fixed solvent and temperature/],
  ["approximation is not universal", /not an exact law for arbitrary or concentrated solutions/],
  ["distinct quantities", /Λ_m is molar conductivity, κ is conductivity, and c is molar concentration/],
  ["unit-correct relation", /consistent SI units Λ_m = κ\/c/],
  ["SI units", /κ is in S m\^-1, c in mol m\^-3, and Λ_m in S m\^2 mol\^-1/],
  ["litre/centimetre conversion", /Λ_m = 1000κ\/c/],
  ["opposite dilution trends", /conductivity κ decreases[\s\S]*molar conductivity Λ_m increases/],
  ["independent migration is a limiting law", /independent migration concerns this limit: Λ_m° = ν_\+λ_\+° \+ ν_-λ_-°/],
  ["weak electrolyte caveat", /weak-electrolyte curve is not linear in √c/],
  ["no physical readings from schematic coordinates", /schematic normalized coordinates, not a calibrated concentration scale/],
  ["arbitrary one is not proof of dilute validity", /arbitrary √c = 1 does not establish dilute validity/],
];
for (const stem of [question, "Plot molar conductivity against square root of concentration for strong and weak electrolytes."]) {
  const candidate = build(stem, [], false);
  assert(candidate, `the existing family still builds the source-grounded plot: ${stem}`);
  const validated = validateSceneDocument(candidate);
  assert(validated.document, JSON.stringify(validated.report.issues));
  const compiled = compileSceneDocument(validated.document);
  assert(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
  assert(compiled.renderScene.primitives.some(p => p.entityId === "strong"));
  assert(compiled.renderScene.primitives.some(p => p.entityId === "weak"));
  assert(compiled.renderScene.primitives.some(p => p.text === "√c"), "symbolic radical axis remains whole");
  const caption = validated.document.annotations.find(a => a.id === "figure_caption")?.text;
  assert.match(caption ?? "", /dilute strong electrolyte[\s\S]*approximation/);
  const notes = validated.document.source.teachingNotes;
  assert(Array.isArray(notes) && notes.every(note => typeof note === "string"));
  const context = notes.join("\n");
  for (const [name, pattern] of requirements) assert.match(context, pattern, name);

  const presentation = buildVerifiedDiagramPresentation(validated.document, compiled.renderScene, { figureFamily: "chem_electrochem" });
  const lesson = buildTurnTeachingPrompt({
    question: stem, diagramPromptAddon: presentation.diagram.promptAddon ?? null,
    turnPlan: null, solverProjection: null, codeLesson: null, isDsa: false,
    familiarity: "normal", fastMode: false, narrationLanguage: "hinglish",
  });
  const resume = buildResumeTeachingPrompt({
    lessonQuestion: stem, boardRows: [{ text: "Λ_m = κ/c" }], rowsLeftOnPage: 5,
    nextRowY: 336, diagramPromptAddon: presentation.diagram.promptAddon ?? null,
    codePanelShowing: false, turnPlan: null, solverProjection: null,
    familiarity: "normal", fastMode: false, narrationLanguage: "hinglish",
  });
  for (const [flow, prompt] of [
    ["initial", lesson.systemPrompt], ["continuation", lesson.continuationPrompt],
    ["resume", resume.systemPrompt], ["resumed continuation", resume.continuationPrompt],
  ]) {
    for (const [name, pattern] of requirements) assert.match(prompt!, pattern, `${flow}: ${name}`);
    assert.match(prompt!, /define its quantities and units/);
    assert.match(prompt!, /numerical example needs stated units, parameters and a justified validity range/);
  }
  // Teaching metadata is not a new geometry or numeric authority path.
  const withoutNotes = structuredClone(validated.document);
  delete withoutNotes.source.teachingNotes;
  const without = buildVerifiedDiagramPresentation(withoutNotes, compiled.renderScene);
  assert.deepEqual(presentation.diagram.commands, without.diagram.commands);
  assert.deepEqual(presentation.introSegments, without.introSegments);
}
console.log("verify-conductance-teaching: family/compiled plot → initial, continuation and resume carry conditions, definitions and schematic limits; zero providers");
