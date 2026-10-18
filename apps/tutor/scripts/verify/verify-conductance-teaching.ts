/** Family facts must survive the real figure → lesson/resume prompt boundary.
 * Chemistry references (accessed 18 Oct 2026):
 * https://ncert.nic.in/textbook/pdf/lech102.pdf §2.4.2, pp46–50
 * https://interaktiv.chemie.uni-mainz.de/vpcgp/ml-man.en.html
 * https://sathee.iitk.ac.in/ncert-books/udaan/udaan-che-12/chem-12-unit-03-electrochemistry/
 * These are prompt/verified-family gates, not a claim about a new paid lesson.
 */
import assert from "node:assert/strict";
import {
  chemistryFamilyBuilder, chemistryFamilyTeachingNotes, chemistryTeachingFamilyId,
  CONDUCTANCE_TEACHING_FAMILY, compileSceneDocument, validateSceneDocument,
} from "@heytutor/scene-engine";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { buildResumeTeachingPrompt, buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";
import { normalizeSceneDocumentModelOutput } from "@heytutor/tutor-core";
import { SceneBuilder } from "../../../../packages/scene-engine/src/archetypes/document";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

async function injectedPlannerNotes(): Promise<void> {
  const question = "Draw a closed circuit with one battery and one resistor.";
  const builder = new SceneBuilder(question, "closed battery and resistor circuit", "circuit_network");
  builder.helper("a", { x: 0, y: 0 }); builder.helper("b", { x: 4, y: 0 });
  builder.helper("c", { x: 4, y: 3 }); builder.helper("d", { x: 0, y: 3 });
  builder.symbol("r", "resistor", "a", "b", "resistor", "R");
  builder.symbol("v", "battery", "d", "c", "battery", "V");
  builder.connect("right", "b", "c"); builder.connect("left", "d", "a");
  const clean = builder.build();
  clean.source = { question, nonMetric: true, representationTier: "qualitative_verified" };
  const phrase = "INJECTED_UNVERIFIED_FAMILY_NOTE";
  const injected = structuredClone(clean); injected.source.teachingNotes = [phrase];
  injected.source.chemistryFamily = "chem_electrochem";
  injected.source.chemistryTeachingFamilyId = CONDUCTANCE_TEACHING_FAMILY;
  const normalized = normalizeSceneDocumentModelOutput({ ...injected }, question);
  assert(!Object.hasOwn(normalized.source as Record<string, unknown>, "teachingNotes"), "actual planner normalization strips injected family prose");
  assert(!Object.hasOwn(normalized.source as Record<string, unknown>, "chemistryFamily"));
  assert(!Object.hasOwn(normalized.source as Record<string, unknown>, "chemistryTeachingFamilyId"), "planner cannot spoof an engine teaching-family id");
  const validated = validateSceneDocument(normalized);
  assert(validated.document, JSON.stringify(validated.report.issues));
  const compiled = compileSceneDocument(validated.document);
  assert(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
  const presented = buildVerifiedDiagramPresentation(validated.document, compiled.renderScene);
  assert(!presented.diagram.promptAddon?.includes(phrase), "normalized circuit never teaches injected prose");
  const oldCompiled = compileSceneDocument(injected);
  assert(oldCompiled.ok && oldCompiled.renderScene);
  const oldPresented = buildVerifiedDiagramPresentation(injected, oldCompiled.renderScene);
  assert(!oldPresented.diagram.promptAddon?.includes(phrase), "old injected document cannot regain prose authority on reopen");
  assert(!oldPresented.diagram.promptAddon?.includes("Family teaching context"), "a circuit with spoofed family ids cannot borrow conductance context");
  const cleanCompiled = compileSceneDocument(clean); assert(cleanCompiled.ok && cleanCompiled.renderScene);
  const cleanPresented = buildVerifiedDiagramPresentation(clean, cleanCompiled.renderScene);
  assert.deepEqual(compiled.renderScene.primitives, cleanCompiled.renderScene.primitives, "stripping prose preserves exact compiled circuit geometry");
  assert.deepEqual(presented.diagram.commands, cleanPresented.diagram.commands, "stripping prose preserves exact circuit ink");
  for (const document of [validated.document, injected]) {
    const saved = await canonicalizeTurnSceneMetadata({ question, sceneDocument: document, visualStatus: "validated", segments: [],
      sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: null, representationTier: "qualitative_verified", nonMetric: true, diagramResultStatus: "ready" } });
    assert(saved.ok, saved.ok ? "" : saved.error);
    assert(!JSON.stringify(saved.value).includes(phrase), "canonical save strips injected prose including legacy submitted documents and artifact copies");
    assert(!Object.hasOwn(saved.value.sceneDocument!.source, "teachingNotes"));
    assert(!Object.hasOwn(saved.value.sceneDocument!.source, "chemistryTeachingFamilyId"), "canonical circuit save has no conductance teaching-family marker");
  }
}

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
function assertTeachingFlows(stem: string, presentation: ReturnType<typeof buildVerifiedDiagramPresentation>): void {
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
}
const familySaves: Array<{ question: string; document: import("@heytutor/scene-engine").SceneDocument }> = [];
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
  assert(!Object.hasOwn(validated.document.source, "teachingNotes"), "engine emits an id, never stored teaching prose");
  assert.equal(validated.document.source.chemistryTeachingFamilyId, CONDUCTANCE_TEACHING_FAMILY);
  const notes = chemistryFamilyTeachingNotes(chemistryTeachingFamilyId(validated.document));
  assert(Object.isFrozen(notes), "the engine registry cannot be rewritten by consumers");
  const context = notes.join("\n");
  for (const [name, pattern] of requirements) assert.match(context, pattern, name);

  const presentation = buildVerifiedDiagramPresentation(validated.document, compiled.renderScene, { figureFamily: "chem_electrochem" });
  assertTeachingFlows(stem, presentation);
  // Teaching metadata is not a new geometry or numeric authority path.
  const oldDocument = structuredClone(validated.document);
  delete oldDocument.source.chemistryTeachingFamilyId;
  oldDocument.source.teachingNotes = ["OLD_UNVERIFIED_PROSE_MUST_BE_IGNORED"];
  const before = structuredClone(oldDocument);
  const oldCompiled = compileSceneDocument(oldDocument);
  assert(oldCompiled.ok && oldCompiled.renderScene);
  const without = buildVerifiedDiagramPresentation(oldDocument, oldCompiled.renderScene);
  assert(!without.diagram.promptAddon?.includes("OLD_UNVERIFIED_PROSE_MUST_BE_IGNORED"));
  for (const [name, pattern] of requirements) assert.match(without.diagram.promptAddon!, pattern, `legacy id recovery: ${name}`);
  assert.deepEqual(oldCompiled.renderScene.primitives, compiled.renderScene.primitives, "legacy id recovery does not regenerate or replace accepted geometry");
  assert.deepEqual(oldDocument, before, "presentation does not mutate old saved documents");
  assertTeachingFlows(stem, without);
  familySaves.push({ question: stem, document: validated.document }, { question: stem, document: oldDocument });
  assert.deepEqual(presentation.diagram.commands, without.diagram.commands);
  assert.deepEqual(presentation.introSegments, without.introSegments);
}
async function savedFamilyFacts(): Promise<void> {
  for (const { question, document } of familySaves) {
    const before = structuredClone(document);
    const saved = await canonicalizeTurnSceneMetadata({ question, sceneDocument: document, visualStatus: "validated", segments: [],
      sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: null, representationTier: "qualitative_verified", nonMetric: true, diagramResultStatus: "ready" } });
    assert(saved.ok, saved.ok ? "" : saved.error);
    assert(!Object.hasOwn(saved.value.sceneDocument!.source, "teachingNotes"));
    assert.equal(saved.value.sceneDocument!.source.chemistryTeachingFamilyId, CONDUCTANCE_TEACHING_FAMILY);
    const compiled = compileSceneDocument(saved.value.sceneDocument!); assert(compiled.ok && compiled.renderScene);
    assertTeachingFlows(question, buildVerifiedDiagramPresentation(saved.value.sceneDocument!, compiled.renderScene));
    assert.deepEqual(document, before, "canonical save never mutates old document callers");
    assert(!JSON.stringify(saved.value).includes("OLD_UNVERIFIED_PROSE_MUST_BE_IGNORED"));
  }
  for (const question of ["Draw the Daniell cell Zn|Zn2+||Cu2+|Cu.", "Explain the Nernst equation for the Daniell cell Zn|Zn2+||Cu2+|Cu."]) {
    const document = build!(question, [], false); assert(document);
    assert(!Object.hasOwn(document.source, "teachingNotes"));
    assert(!Object.hasOwn(document.source, "chemistryTeachingFamilyId"), "cell/Nernst builder never stamps the conductance teaching-family id");
    for (const legacy of [false, true]) {
      const candidate = structuredClone(document);
      if (legacy) { delete candidate.source.chemistryTeachingFamilyId; candidate.source.teachingNotes = ["UNTRUSTED_CELL_NOTES"]; }
      const before = structuredClone(candidate);
      const compiled = compileSceneDocument(candidate); assert(compiled.ok && compiled.renderScene);
      assert.equal(chemistryTeachingFamilyId(candidate), null, "cell/Nernst family is not a conductance teaching family");
      const presentation = buildVerifiedDiagramPresentation(candidate, compiled.renderScene);
      assert(!presentation.diagram.promptAddon?.includes("Family teaching context"), "normal/legacy cell and Nernst figures never get Kohlrausch plot facts");
      assert(!presentation.diagram.promptAddon?.includes("UNTRUSTED_CELL_NOTES"));
      const saved = await canonicalizeTurnSceneMetadata({ question, sceneDocument: candidate, visualStatus: "validated", segments: [],
        sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: null, representationTier: "qualitative_verified", nonMetric: true, diagramResultStatus: "ready" } });
      assert(saved.ok, saved.ok ? "" : saved.error);
      assert(!Object.hasOwn(saved.value.sceneDocument!.source, "teachingNotes"));
      assert(!Object.hasOwn(saved.value.sceneDocument!.source, "chemistryTeachingFamilyId"), "canonical cell/Nernst saves never acquire conductance family facts");
      assert(!JSON.stringify(saved.value).includes("UNTRUSTED_CELL_NOTES"), "legacy cell/Nernst prose is absent from canonical documents and artifact copies");
      const savedCompiled = compileSceneDocument(saved.value.sceneDocument!); assert(savedCompiled.ok && savedCompiled.renderScene);
      const reopened = buildVerifiedDiagramPresentation(saved.value.sceneDocument!, savedCompiled.renderScene);
      assert(!reopened.diagram.promptAddon?.includes("Family teaching context"), "reopened normal/legacy cell and Nernst figures remain outside the conductance family");
      assert.deepEqual(candidate, before, "cell/Nernst canonicalization does not mutate the submitted document");
    }
  }
  assert.deepEqual(chemistryFamilyTeachingNotes("unknown_family"), []);
}
void injectedPlannerNotes().then(savedFamilyFacts).then(() => {
  console.log("verify-conductance-teaching: trusted family facts survive; planner/legacy prose cannot enter prompts or saves; zero providers");
}).catch(error => { console.error(error); process.exitCode = 1; });
