/**
 * Physics prompt classes from the strict diagnosis: field operators reach the
 * planner with contracts, worked examples never compact the contracts, named
 * physics setups may be one symbolic representative, and the offer carries
 * the operators the guidance names.
 */
import assert from "node:assert/strict";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";
import { buildSceneDocumentPlannerPrompt, SCENE_DOCUMENT_PLANNER_PROMPT, selectConstructionInputContracts } from "../../src/planners/scenePlannerV2Prompt";

// Field operators used to be named by an unparseable "Dipole packet" line and reached the planner with no contract.
for (const operator of ["coulomb_pair", "point_charge_field", "dipole_field", "dipole_torque", "dipole_energy", "field_lines", "equipotential"]) {
  const contract = selectConstructionInputContracts([operator]);
  assert(new RegExp(`^- (?:[a-z_]+/)?${operator}(?:/[a-z_]+)?: \\{`, "m").test(contract), `${operator} has its own input contract`);
}
// Field requests now see a contract for every field operator they are offered.
const fieldQuestion = "Draw the field lines and an equipotential of a point charge.";
const fieldPrompt = buildSceneDocumentPlannerPrompt(fieldQuestion, inferSceneCapabilities(fieldQuestion));
for (const operator of ["field_lines", "equipotential", "point_charge_field"]) assert(new RegExp(`^- ${operator}: \\{`, "m").test(fieldPrompt), `${operator} contract reaches a field request`);
// Worked examples are not contracts: a request detailed without examples stays detailed with a long one.
const question = "Draw the refraction of a ray at a plane glass surface and mark the normal.";
const capabilities = inferSceneCapabilities(question);
const plain = buildSceneDocumentPlannerPrompt(question, capabilities);
const longExample = { id: "long", sourceKind: "synthesized" as const, question: null, depicts: "a long worked example ".repeat(1_000), document: { schemaVersion: "scene-document/v2" } };
const withExamples = buildSceneDocumentPlannerPrompt(question, { ...capabilities, workedExamples: [longExample] });
assert(!plain.includes("Compact types:"), `the plain optics request is detailed (${plain.length} chars, ${capabilities.families})`);
assert(!withExamples.includes("Compact types:"), "a long worked example does not compact the contracts");
// Named physics setups may be one standard representative, labelled without invented numbers.
assert(/charge,field,magnet,lens,mirror,circuit,wave/.test(SCENE_DOCUMENT_PLANNER_PROMPT), "the symbolic rule names physics setups");
assert(SCENE_DOCUMENT_PLANNER_PROMPT.includes("never invented numbers"), "representatives never print invented numbers");
assert(SCENE_DOCUMENT_PLANNER_PROMPT.includes("an unstated sense or direction is chosen once"), "an unstated direction is chosen once");
const promptFor = (text: string) => { const caps = inferSceneCapabilities(text); return { caps, prompt: buildSceneDocumentPlannerPrompt(text, caps) }; };
const magnet = promptFor("Draw the magnetic field lines of a bar magnet.");
assert(magnet.prompt.includes("SELECTED VISUAL INVARIANTS") && !magnet.prompt.includes("only with explicit source values"), `point_field guidance no longer forbids a normalized magnet (${magnet.caps.families})`);
const bridge = promptFor("Draw the circuit of a metre bridge used to find an unknown resistance.");
assert(bridge.caps.families.includes("circuit_network") && bridge.prompt.includes("with no stated balance"), `a bridge with no stated balance draws its topology (${bridge.caps.families})`);
assert(SCENE_DOCUMENT_PLANNER_PROMPT.includes("narration and endpoint marks are not labels"), "a scene needs a real on-figure label");
// Offer gaps: symbol-only plans get axes with their curves; point fields get arcs.
const symbolic = inferSceneCapabilities("Explain simple harmonic motion energy.", { lawIds: ["shm_energy"], turnPlan: { lawIds: ["shm_energy"], visualRequirement: "required", givens: [] } });
assert(symbolic.constructionOperators.includes("axes") && symbolic.constructionOperators.includes("function_curve"), "symbol-only plans get axes with function_curve");
const arc = inferSceneCapabilities("Find the magnetic field at the centre of a circular arc of wire carrying current I.");
if (arc.families.includes("point_field")) assert(arc.constructionOperators.includes("arc"), "point_field offers arc");
console.log("physics prompt classes: field contracts, uncompacted contracts with examples, physics representatives and offer gaps verified");
