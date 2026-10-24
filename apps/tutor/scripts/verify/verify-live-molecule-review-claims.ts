/** Independent review regressions: real source-derived figures and native admission. */
import assert from "node:assert/strict";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { compileSceneDocument, validateTurnPlanV3, type TurnPlanV3, type SceneDocument, type RenderScene } from "@heytutor/scene-engine";
import { buildVseprFigure, vseprPlanConflict } from "../../../../packages/scene-engine/src/chemistry/vsepr";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";

type ClaimRow = { id: string; question: string; expected: string; draw: boolean; family: "electron-geometry" | "radical-count" | "control" };
const sf4 = "Show the molecular shape of SF4.";
const no2 = "Show the molecular shape of NO2.";
const planFor = (question: string, expected?: string): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], unknowns: [], derived: [], lawIds: [], assumptions: [],
  qualitativeClaims: expected ? [{ id: "source_claim", claim: "Valence-shell description", expected, relatedEntityHints: [question.includes("NO2") ? "NO2" : "SF4"] }] : [],
});
const claimRows: ClaimRow[] = [
  ...[
    "SF4 has a trigonal bipyramidal arrangement of electron domains.",
    "The electron domains in SF4 adopt a trigonal bipyramidal arrangement.",
    "The arrangement of electron pairs around sulfur in SF4 is trigonal bipyramidal.",
    "For SF4, trigonal bipyramidal describes the arrangement of the electron domains.",
    "The five electron-pair domains around S in SF4 have a trigonal bipyramidal arrangement.",
    "SF4 has trigonal bipyramidal geometry of its electron domains.",
  ].map((expected, index): ClaimRow => ({ id: `electron-${index + 1}`, question: sf4, expected, draw: true, family: "electron-geometry" })),
  ...[
    "Nitrogen has no lone pairs and one unpaired electron.",
    "In NO2, the central nitrogen has zero lone pairs and one unpaired electron.",
    "The nitrogen atom in NO2 has 0 lone pairs and a single unpaired electron.",
    "There are no lone pairs on N in NO2; the central atom has one unpaired electron.",
    "NO2 has zero lone pairs on the nitrogen atom and one unpaired electron.",
    "N in NO2 carries no lone pair; one electron remains unpaired.",
  ].map((expected, index): ClaimRow => ({ id: `radical-${index + 1}`, question: no2, expected, draw: true, family: "radical-count" })),
  { id: "existing-electron-prefix", question: sf4, expected: "The electron-domain geometry of SF4 is trigonal bipyramidal.", draw: true, family: "control" },
  { id: "correct-molecular-shape", question: sf4, expected: "SF4 has a seesaw molecular shape.", draw: true, family: "control" },
  { id: "correct-combined-property-scopes", question: sf4, expected: "SF4 has a seesaw molecular shape and trigonal-bipyramidal electron-domain geometry.", draw: true, family: "control" },
  { id: "correct-compound-while", question: sf4, expected: "SF4 has a seesaw molecular shape, while its electron geometry is trigonal bipyramidal.", draw: true, family: "control" },
  { id: "correct-compound-whereas", question: sf4, expected: "The molecular geometry of SF4 is seesaw whereas the arrangement of its electron domains is trigonal bipyramidal.", draw: true, family: "control" },
  { id: "correct-compound-and-reversed", question: sf4, expected: "SF4 has trigonal bipyramidal electron-domain geometry and a seesaw molecular shape.", draw: true, family: "control" },
  { id: "correct-electron-role-before-noun-list", question: sf4, expected: "The electron geometry, including bonding and lone pairs, is trigonal bipyramidal.", draw: true, family: "control" },
  { id: "correct-electron-role-before-domain-list", question: sf4, expected: "The electron-domain arrangement involving bonding and nonbonding pairs is trigonal bipyramidal.", draw: true, family: "control" },
  { id: "wrong-compound-and-electron", question: sf4, expected: "SF4 has a seesaw molecular shape and tetrahedral electron geometry.", draw: false, family: "control" },
  { id: "wrong-compound-while-molecular", question: sf4, expected: "SF4 has trigonal bipyramidal electron-domain geometry while its molecular shape is square planar.", draw: false, family: "control" },
  { id: "wrong-compound-whereas-electron", question: sf4, expected: "SF4 has tetrahedral electron geometry whereas its molecular geometry is seesaw.", draw: false, family: "control" },
  { id: "correct-negated-molecular-shape", question: sf4, expected: "SF4 is not trigonal bipyramidal in molecular shape.", draw: true, family: "control" },
  { id: "correct-unbound-with-electron-domain-count", question: sf4, expected: "SF4 is seesaw with five electron domains.", draw: true, family: "control" },
  { id: "correct-unbound-negated-impossible-shape", question: sf4, expected: "SF4 is not tetrahedral with five electron domains.", draw: true, family: "control" },
  { id: "correct-terminal-and-central-names", question: sf4, expected: "Each fluorine has three lone pairs; sulfur has one lone pair.", draw: true, family: "control" },
  { id: "correct-terminal-and-central-symbols", question: sf4, expected: "Each F atom has three lone pairs; S has one lone pair.", draw: true, family: "control" },
  { id: "correct-terminal-only-name-undecided", question: sf4, expected: "Fluorine has three lone pairs.", draw: true, family: "control" },
  { id: "correct-terminal-only-symbol-undecided", question: sf4, expected: "F has three lone pairs.", draw: true, family: "control" },
  { id: "correct-central-before-terminal-name", question: sf4, expected: "Sulfur has one lone pair, while each fluorine has three lone pairs.", draw: true, family: "control" },
  { id: "correct-central-before-terminal-symbol", question: sf4, expected: "S has one lone pair, while each F atom has three lone pairs.", draw: true, family: "control" },
  { id: "wrong-central-after-terminal-name", question: sf4, expected: "Each fluorine has three lone pairs; sulfur has two lone pairs.", draw: false, family: "control" },
  { id: "wrong-central-after-terminal-symbol", question: sf4, expected: "Each F atom has three lone pairs; S has two lone pairs.", draw: false, family: "control" },
  { id: "correct-plural-terminal-before-central", question: sf4, expected: "The fluorine atoms have three lone pairs; sulfur has one lone pair.", draw: true, family: "control" },
  { id: "wrong-central-after-plural-terminal", question: sf4, expected: "The fluorine atoms have three lone pairs; sulfur has two lone pairs.", draw: false, family: "control" },
  { id: "wrong-electron-shape", question: sf4, expected: "The electron-domain geometry of SF4 is tetrahedral.", draw: false, family: "control" },
  { id: "wrong-molecular-shape", question: sf4, expected: "The molecular shape of SF4 is trigonal bipyramidal.", draw: false, family: "control" },
  { id: "wrong-square-planar-shape", question: sf4, expected: "SF4 has a square planar molecular shape.", draw: false, family: "control" },
  { id: "wrong-unbound-with-electron-domains", question: sf4, expected: "SF4 is tetrahedral with five electron domains.", draw: false, family: "control" },
  { id: "wrong-unbound-square-with-electron-domains", question: sf4, expected: "SF4 has square planar geometry, with five electron domains.", draw: false, family: "control" },
  { id: "wrong-explicit-molecular-with-electron-pairs", question: sf4, expected: "SF4 has a molecular shape described by a tetrahedral arrangement of its electron pairs.", draw: false, family: "control" },
  { id: "wrong-no2-lone-pair", question: no2, expected: "Nitrogen in NO2 has one lone pair and one unpaired electron.", draw: false, family: "control" },
  { id: "wrong-no2-two-unpaired", question: no2, expected: "Nitrogen in NO2 has no lone pairs and two unpaired electrons.", draw: false, family: "control" },
  { id: "wrong-no2-no-unpaired", question: no2, expected: "Nitrogen in NO2 has no lone pairs and no unpaired electron.", draw: false, family: "control" },
  { id: "wrong-no2-not-one-unpaired", question: no2, expected: "Nitrogen in NO2 has no lone pairs and not one unpaired electron.", draw: false, family: "control" },
  { id: "wrong-no2-not-single-unpaired", question: no2, expected: "NO2 has zero lone pairs on N and not a single unpaired electron.", draw: false, family: "control" },
  { id: "wrong-no2-not-1-unpaired", question: no2, expected: "The nitrogen atom in NO2 has 0 lone pairs and not 1 unpaired electron.", draw: false, family: "control" },
  { id: "wrong-no2-later-unpaired-count", question: no2, expected: "Nitrogen in NO2 has no lone pairs, one unpaired electron and two unpaired electrons.", draw: false, family: "control" },
  { id: "wrong-no2-later-negated-unpaired", question: no2, expected: "Nitrogen in NO2 has no lone pairs and one unpaired electron, but not one unpaired electron.", draw: false, family: "control" },
  { id: "wrong-no2-later-lone-pair-count", question: no2, expected: "Nitrogen in NO2 has no lone pairs and one unpaired electron, but also one lone pair.", draw: false, family: "control" },
  { id: "correct-no2-agreeing-repeated-unpaired", question: no2, expected: "Nitrogen in NO2 has no lone pairs, one unpaired electron and one unpaired electron.", draw: true, family: "control" },
  { id: "correct-no2-negated-other-count", question: no2, expected: "Nitrogen in NO2 has no lone pairs and one unpaired electron, but not two unpaired electrons.", draw: true, family: "control" },
  { id: "correct-no2-agreeing-lone-pair-count", question: no2, expected: "Nitrogen in NO2 has no lone pairs and one unpaired electron; its central atom has zero lone pairs.", draw: true, family: "control" },
  { id: "wrong-sf4-lone-pair-count", question: sf4, expected: "Sulfur in SF4 has two lone pairs.", draw: false, family: "control" },
  { id: "wrong-sf4-hybridisation", question: sf4, expected: "Sulfur in SF4 is sp3 hybridised.", draw: false, family: "control" },
  ...[
    "SF4 is seesaw, not square planar or tetrahedral.",
    "SF4 is neither square planar nor tetrahedral; its molecular shape is seesaw.",
    "SF4 is not square planar, tetrahedral, or octahedral.",
    "The molecular shape is seesaw, not a square planar or a tetrahedral shape.",
    "SF4 is not tetrahedral or square planar, but it is seesaw.",
    "SF4 has seesaw molecular geometry, not tetrahedral nor octahedral.",
  ].map((expected, index): ClaimRow => ({ id: `joined-negative-valid-${index + 1}`, question: sf4, expected, draw: true, family: "control" })),
  ...[
    "SF4 is not square planar or seesaw.",
    "SF4 is neither tetrahedral nor seesaw.",
    "SF4 is seesaw, not square planar, but its molecular shape is tetrahedral.",
    "SF4 is not square planar or tetrahedral; its molecular shape is octahedral.",
  ].map((expected, index): ClaimRow => ({ id: `joined-negative-invalid-${index + 1}`, question: sf4, expected, draw: false, family: "control" })),
  ...[
    "Sulfur has one lone pair; the fluorine atoms each have three lone pairs.",
    "The F atoms each have three lone pairs and sulfur has one lone pair.",
    "The fluorine atoms all have three lone pairs; S has one lone pair.",
    "Sulfur has one lone pair while the F atoms individually carry three lone pairs.",
    "Each of the fluorine atoms has three lone pairs; the central atom has one lone pair.",
    "The central sulfur atom has one lone pair, but the fluorine atoms each contain three lone pairs.",
  ].map((expected, index): ClaimRow => ({ id: `distributive-terminal-valid-${index + 1}`, question: sf4, expected, draw: true, family: "control" })),
  ...[
    "Sulfur has two lone pairs; the fluorine atoms each have three lone pairs.",
    "The fluorine atoms all have three lone pairs; S has two lone pairs.",
    "Fluorine atoms each have three lone pairs and sulfur has two lone pairs.",
    "The central atom has two lone pairs while F atoms individually carry three lone pairs.",
  ].map((expected, index): ClaimRow => ({ id: `distributive-terminal-invalid-${index + 1}`, question: sf4, expected, draw: false, family: "control" })),
  ...[
    "The two axial F atoms both have three lone pairs; sulfur has one lone pair.",
    "Sulfur has one lone pair and the axial F atoms each have three lone pairs.",
    "The axial F atoms each have three lone pairs; the central lone pair occupies an equatorial site.",
    "The sulfur lone pair is not axial; the axial fluorine atoms each have three lone pairs.",
  ].map((expected, index): ClaimRow => ({ id: `terminal-position-valid-${index + 1}`, question: sf4, expected, draw: true, family: "control" })),
  ...[
    "The lone pair is axial.",
    "The lone pair on sulfur is in an axial site.",
    "SF4 has an axial lone pair.",
    "The lone pair occupies one of the axial sites.",
    "The lone pair on sulfur occupies one of the two axial sites.",
    "The central lone pair is located in either of the axial positions.",
    "Sulfur has one lone pair placed at one of its axial sites.",
    "The lone pair sits in one of the axial sites.",
    "The lone pair prefers either axial position.",
    "The lone pair occupies one axial site.",
    "The lone pair occupies the first axial site.",
    "The lone pair occupies the second axial position.",
    "The lone pair lies in 1 axial site.",
    "The lone pair on sulfur is at one axial position.",
  ].map((expected, index): ClaimRow => ({ id: `central-position-invalid-${index + 1}`, question: sf4, expected, draw: false, family: "control" })),
  ...[
    "The lone pair does not occupy one of the axial sites.",
    "The lone pair is not in either of the axial positions.",
    "The lone pair is equatorial; the two axial F atoms each have three lone pairs.",
    "The axial fluorine atoms each have three lone pairs; sulfur has one equatorial lone pair.",
    "The fluorine atoms each have three lone pairs; sulfur has one lone pair in an equatorial site.",
    "The lone pair is equatorial and the fluorine atoms occupy the axial sites.",
    "The lone pair is not in one axial site.",
    "The lone pair on sulfur is not at the first axial site.",
    "The axial F atoms each have three lone pairs and sulfur has one equatorial lone pair.",
    "The lone pair is located at one equatorial site.",
    "The lone pair occupies one equatorial site and the F atoms occupy the axial sites.",
  ].map((expected, index): ClaimRow => ({ id: `quantified-position-valid-${index + 1}`, question: sf4, expected, draw: true, family: "control" })),
];
const unresolvedRows = [
  "Show the shape of SF4. Include water.",
  "Draw the molecular shape of SF4. Include water as well.",
  "Show the geometry of SF4. Also include water.",
  "Sketch the shape of SF4. Please include water.",
  "Show the shape of SF4. Include water in the comparison.",
  "Show the molecular shape of SF4. Include water too.",
  "Show the shape of SF4. Add water.",
  "Show the shape of SF4. Include ammonia.",
  "Show the shape of SF4. Include an unspecified second molecule.",
];
const rows: unknown[] = [];
const failures: Array<{ name: string; message: string }> = [];
let passed = 0;
function test(name: string, run: () => void): void {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); failures.push({ name, message }); console.error(`FAIL ${name}: ${message}`); }
}
function molecularLabels(scene: RenderScene): string[] {
  return scene.primitives.flatMap(primitive => primitive.kind === "label" && primitive.text ? [primitive.text] : []);
}
function assertNO2(document: SceneDocument, scene: RenderScene): void {
  assert.equal(document.entities.filter(entity => entity.role === "unpaired electron").length, 1, "NO2 has one singly occupied electron mark");
  assert.equal(document.entities.filter(entity => entity.role === "lone pair electron").length, 0, "an unpaired electron is not a lone pair");
  const lonePairIds = new Set(document.entities.filter(entity => entity.role === "lone pair electron").map(entity => entity.id));
  assert.equal(scene.primitives.filter(primitive => lonePairIds.has(primitive.entityId) && primitive.kind === "point").length, 0);
  const oddIds = new Set(document.entities.filter(entity => entity.role === "unpaired electron").map(entity => entity.id));
  assert.equal(scene.primitives.filter(primitive => oddIds.has(primitive.entityId) && primitive.kind === "point").length, 1);
  const caption = document.annotations.find(annotation => annotation.id === "figure_caption")?.text ?? "";
  assert.match(caption, /\b0\s+lone pairs?\b/, "NO2 caption must state the actual zero electron-pair count");
  assert(!/\b1\s+lone pair\b/.test(caption), "radical domain must never be captioned as a lone pair");
  assert.match(scene.caption ?? "", /\b0\s+lone pairs?\b/, "compiled caption must preserve the zero-pair account");
  assert.match(scene.caption ?? "", /\b(?:1|one)\s+unpaired electron\b/, "compiled caption must preserve the single-electron account");
}

for (const row of claimRows) {
  const plan = planFor(row.question, row.expected);
  const valid = validateTurnPlanV3(plan, row.question);
  assert(valid.valid, `${row.id}: fixture plan must be valid`);
  const conflict = vseprPlanConflict(row.question, plan);
  const selected = selectProductionScene({ question: row.question, turnPlan: plan, problemIR: null });
  rows.push({ ...row, planValid: true, conflict, nativeFamily: selected.representation?.family ?? null, nativeReason: selected.reason });
  test(`${row.id}/source-claim`, () => { if (row.draw) assert.equal(conflict, null); else assert(conflict, "explicit false source claim must be rejected"); });
  test(`${row.id}/native`, () => {
    if (!row.draw) { assert.equal(selected.representation, null, "a contradictory plan cannot accompany an admitted figure"); return; }
    assert(selected.representation, selected.reason);
    assert.equal(selected.representation.family, "chem_vsepr");
    const labels = molecularLabels(selected.representation.renderScene);
    if (row.question === sf4) { assert.equal(labels.filter(label => label === "S").length, 1); assert.equal(labels.filter(label => label === "F").length, 4); }
    else { assert.equal(labels.filter(label => label === "N").length, 1); assert.equal(labels.filter(label => label === "O").length, 2); assertNO2(selected.representation.sceneDocument, selected.representation.renderScene); }
  });
}

test("NO2/source-compiled-electron-membership-and-caption", () => {
  const figure = buildVseprFigure(no2, [], false); assert(figure);
  const compiled = compileSceneDocument(figure.document); assert(compiled.ok && compiled.renderScene);
  assertNO2(figure.document, compiled.renderScene);
});

for (const [index, question] of unresolvedRows.entries()) {
  const figure = buildVseprFigure(question, [], false);
  const selected = selectProductionScene({ question, turnPlan: planFor(question), problemIR: null });
  rows.push({ id: `unresolved-${index + 1}`, question, sourceSpecies: figure?.structures.length ?? 0, nativeFamily: selected.representation?.family ?? null, nativeReason: selected.reason });
  test(`unresolved-${index + 1}/source-atomic`, () => {
    if (!figure) return;
    // A future source reader may resolve water through ordinary formula
    // parsing; a supported SF4-only subset can never satisfy this request.
    assert.equal(figure.structures.length, 2, "the requested second molecule may not disappear");
    assert(question.includes("water"), "unknown second members cannot be invented");
    assert.deepEqual(figure.structures.map(structure => structure.atomIds.length), [5, 3]);
  });
  test(`unresolved-${index + 1}/native-atomic`, () => {
    if (!selected.representation) return;
    const labels = molecularLabels(selected.representation.renderScene);
    assert(question.includes("water"), "unresolved non-water members must decline");
    assert(labels.includes("SF_4") && labels.includes("H_2O"), "admission must contain both requested molecular shapes");
    assert.equal(labels.filter(label => label === "F").length, 4);
    assert.equal(labels.filter(label => label === "H").length, 2);
    assert.equal(labels.filter(label => label === "O").length, 1);
  });
}

for (const question of [
  "Show the shapes of SF4 and H2O.",
  "Show the shape of SF4. Include H2O.",
]) test(`resolved-second-member/${question}`, () => {
  const figure = buildVseprFigure(question, [], false); assert(figure); assert.equal(figure.structures.length, 2);
  const selected = selectProductionScene({ question, turnPlan: planFor(question), problemIR: null });
  assert(selected.representation, selected.reason);
  const labels = molecularLabels(selected.representation.renderScene);
  assert(labels.includes("SF_4") && labels.includes("H_2O"));
});

// Since #258 (548fa9521, certify native VSEPR source labels) the engine
// letters SF4's equatorial angle with the true bound <120° (measured about
// 102°), computed from the formula, so "label its bond angle" is served
// honestly instead of refused. It must stay a bound: no exact SF4 angle.
test("bound-angle/Show the shape of SF4 and label its bond angle.", () => {
  const question = "Show the shape of SF4 and label its bond angle.";
  const selected = selectProductionScene({ question, turnPlan: planFor(question), problemIR: null });
  assert(selected.representation, selected.reason);
  const document = selected.representation.sceneDocument;
  const angles = document.entities.filter((entity) => entity.role === "bond angle");
  assert.deepEqual(angles.map((entity) => entity.label), ["<120°"], "the only lettered SF4 angle is the equatorial bound");
  const texts = selected.representation.renderScene.primitives.map((primitive) => primitive.text ?? "");
  assert(!texts.some((text) => /^\d+(?:\.\d+)?°$/.test(text)), `no exact SF4 angle is drawn: ${texts.join(" | ")}`);
  const arc = document.constructions.find((construction) => construction.outputs.includes(angles[0]!.id));
  const span = Number(arc?.inputs.endAngle) - Number(arc?.inputs.startAngle);
  assert(span > 90 && span < 120, `the bound sits on the equatorial pair, drawn span ${span}`);
});

for (const question of [
  "Show the shape of SF4. Include water at 5 N.",
  "Show the shapes of SF4 and a molecule whose identity is unknown.",
]) test(`unsafe-or-unresolved/${question}`, () => {
  const selected = selectProductionScene({ question, turnPlan: planFor(question), problemIR: null });
  assert.equal(selected.representation, null, "an unsupported angle, physical number or unresolved member cannot vanish");
});


/** Boolean claim truth and every local hybridisation occurrence. */
const polarityRows = [
  {
    "id": "shape-wrong-expected-true",
    "question": "Show the molecular shape of SF4.",
    "claim": "SF4 is tetrahedral.",
    "expected": true,
    "draw": false
  },
  {
    "id": "shape-wrong-expected-false",
    "question": "Show the molecular shape of SF4.",
    "claim": "SF4 is tetrahedral.",
    "expected": false,
    "draw": true
  },
  {
    "id": "shape-right-expected-true",
    "question": "Show the molecular shape of SF4.",
    "claim": "SF4 is seesaw.",
    "expected": true,
    "draw": true
  },
  {
    "id": "shape-right-expected-false",
    "question": "Show the molecular shape of SF4.",
    "claim": "SF4 is seesaw.",
    "expected": false,
    "draw": false
  },
  {
    "id": "electron-shape-right-expected-true",
    "question": "Show the molecular shape of SF4.",
    "claim": "The electron geometry of SF4 is trigonal bipyramidal.",
    "expected": true,
    "draw": true
  },
  {
    "id": "electron-shape-right-expected-false",
    "question": "Show the molecular shape of SF4.",
    "claim": "The electron geometry of SF4 is trigonal bipyramidal.",
    "expected": false,
    "draw": false
  },
  {
    "id": "electron-shape-wrong-expected-true",
    "question": "Show the molecular shape of SF4.",
    "claim": "The electron geometry of SF4 is tetrahedral.",
    "expected": true,
    "draw": false
  },
  {
    "id": "electron-shape-wrong-expected-false",
    "question": "Show the molecular shape of SF4.",
    "claim": "The electron geometry of SF4 is tetrahedral.",
    "expected": false,
    "draw": true
  },
  {
    "id": "shape-negated-wrong-expected-true",
    "question": "Show the molecular shape of SF4.",
    "claim": "SF4 is not tetrahedral.",
    "expected": true,
    "draw": true
  },
  {
    "id": "shape-negated-wrong-expected-false",
    "question": "Show the molecular shape of SF4.",
    "claim": "SF4 is not tetrahedral.",
    "expected": false,
    "draw": false
  },
  {
    "id": "shape-negated-right-expected-true",
    "question": "Show the molecular shape of SF4.",
    "claim": "SF4 is not seesaw.",
    "expected": true,
    "draw": false
  },
  {
    "id": "shape-negated-right-expected-false",
    "question": "Show the molecular shape of SF4.",
    "claim": "SF4 is not seesaw.",
    "expected": false,
    "draw": true
  },
  {
    "id": "hybrid-wrong-expected-true",
    "question": "Show the molecular shape of SF4.",
    "claim": "Sulfur is sp3 hybridised.",
    "expected": true,
    "draw": false
  },
  {
    "id": "hybrid-wrong-expected-false",
    "question": "Show the molecular shape of SF4.",
    "claim": "Sulfur is sp3 hybridised.",
    "expected": false,
    "draw": true
  },
  {
    "id": "hybrid-right-expected-true",
    "question": "Show the molecular shape of SF4.",
    "claim": "Sulfur is sp3d hybridised.",
    "expected": true,
    "draw": true
  },
  {
    "id": "hybrid-right-expected-false",
    "question": "Show the molecular shape of SF4.",
    "claim": "Sulfur is sp3d hybridised.",
    "expected": false,
    "draw": false
  },
  {
    "id": "hybrid-negated-wrong-expected-true",
    "question": "Show the molecular shape of SF4.",
    "claim": "Sulfur is not sp3 hybridised.",
    "expected": true,
    "draw": true
  },
  {
    "id": "hybrid-negated-wrong-expected-false",
    "question": "Show the molecular shape of SF4.",
    "claim": "Sulfur is not sp3 hybridised.",
    "expected": false,
    "draw": false
  },
  {
    "id": "hybrid-negated-right-expected-true",
    "question": "Show the molecular shape of SF4.",
    "claim": "Sulfur is not sp3d hybridised.",
    "expected": true,
    "draw": false
  },
  {
    "id": "hybrid-negated-right-expected-false",
    "question": "Show the molecular shape of SF4.",
    "claim": "Sulfur is not sp3d hybridised.",
    "expected": false,
    "draw": true
  },
  {
    "id": "count-right-expected-true",
    "question": "Show the molecular shape of SF4.",
    "claim": "Sulfur has one lone pair.",
    "expected": true,
    "draw": true
  },
  {
    "id": "count-right-expected-false",
    "question": "Show the molecular shape of SF4.",
    "claim": "Sulfur has one lone pair.",
    "expected": false,
    "draw": false
  },
  {
    "id": "count-wrong-expected-true",
    "question": "Show the molecular shape of SF4.",
    "claim": "Sulfur has two lone pairs.",
    "expected": true,
    "draw": false
  },
  {
    "id": "count-wrong-expected-false",
    "question": "Show the molecular shape of SF4.",
    "claim": "Sulfur has two lone pairs.",
    "expected": false,
    "draw": true
  },
  {
    "id": "radical-pair-right-expected-true",
    "question": "Show the molecular shape of NO2.",
    "claim": "Nitrogen has no lone pairs.",
    "expected": true,
    "draw": true
  },
  {
    "id": "radical-pair-right-expected-false",
    "question": "Show the molecular shape of NO2.",
    "claim": "Nitrogen has no lone pairs.",
    "expected": false,
    "draw": false
  },
  {
    "id": "radical-pair-wrong-expected-true",
    "question": "Show the molecular shape of NO2.",
    "claim": "Nitrogen has one lone pair.",
    "expected": true,
    "draw": false
  },
  {
    "id": "radical-pair-wrong-expected-false",
    "question": "Show the molecular shape of NO2.",
    "claim": "Nitrogen has one lone pair.",
    "expected": false,
    "draw": true
  },
  {
    "id": "radical-odd-right-expected-true",
    "question": "Show the molecular shape of NO2.",
    "claim": "Nitrogen has one unpaired electron.",
    "expected": true,
    "draw": true
  },
  {
    "id": "radical-odd-right-expected-false",
    "question": "Show the molecular shape of NO2.",
    "claim": "Nitrogen has one unpaired electron.",
    "expected": false,
    "draw": false
  },
  {
    "id": "radical-odd-wrong-expected-true",
    "question": "Show the molecular shape of NO2.",
    "claim": "Nitrogen has no unpaired electron.",
    "expected": true,
    "draw": false
  },
  {
    "id": "radical-odd-wrong-expected-false",
    "question": "Show the molecular shape of NO2.",
    "claim": "Nitrogen has no unpaired electron.",
    "expected": false,
    "draw": true
  },
  {
    "id": "position-wrong-expected-true",
    "question": "Show the molecular shape of SF4.",
    "claim": "The lone pair occupies an axial site.",
    "expected": true,
    "draw": false
  },
  {
    "id": "position-wrong-expected-false",
    "question": "Show the molecular shape of SF4.",
    "claim": "The lone pair occupies an axial site.",
    "expected": false,
    "draw": true
  },
  {
    "id": "position-right-expected-true",
    "question": "Show the molecular shape of SF4.",
    "claim": "The lone pair occupies an equatorial site.",
    "expected": true,
    "draw": true
  },
  {
    "id": "position-right-expected-false",
    "question": "Show the molecular shape of SF4.",
    "claim": "The lone pair occupies an equatorial site.",
    "expected": false,
    "draw": false
  },
  {
    "id": "exact-negated-hybrid",
    "question": "Show the molecular shape of SF4.",
    "claim": "Valence-shell description",
    "expected": "Sulfur is not sp3 hybridised.",
    "draw": true
  },
  {
    "id": "negated-hybrid-false",
    "question": "Show the molecular shape of SF4.",
    "claim": "Valence-shell description",
    "expected": "Sulfur is not sp3d hybridised.",
    "draw": false
  },
  {
    "id": "hybrid-siblings-both-correct",
    "question": "Show the molecular shape of SF4.",
    "claim": "Valence-shell description",
    "expected": "Sulfur is not sp3 hybridised and sulfur is sp3d hybridised.",
    "draw": true
  },
  {
    "id": "hybrid-siblings-one-wrong",
    "question": "Show the molecular shape of SF4.",
    "claim": "Valence-shell description",
    "expected": "Sulfur is sp3d hybridised and sulfur is sp3 hybridised.",
    "draw": false
  }
] as const;
for (const row of polarityRows) {
  const plan = planFor(row.question);
  plan.qualitativeClaims = [{ id: row.id, claim: row.claim, expected: row.expected }];
  assert.equal(plan.qualitativeClaims.length, 1);
  assert.equal(plan.qualitativeClaims[0]!.expected, row.expected);
  assert(validateTurnPlanV3(plan, row.question).valid);
  test(`polarity/${row.id}/guard`, () => assert.equal(vseprPlanConflict(row.question, plan) === null, row.draw));
  test(`polarity/${row.id}/native`, () => {
    const selected = selectProductionScene({ question: row.question, turnPlan: plan, problemIR: null });
    assert.equal(!!selected.representation, row.draw, selected.reason);
  });
}


const polarityNeighborRows = [
  {
    "id": "terminal-hybrid-correct",
    "question": "Show the molecular shape of SF4.",
    "claim": "Valence-shell description",
    "expected": "Fluorine is sp3 hybridised.",
    "draw": true
  },
  {
    "id": "terminal-plus-central-correct",
    "question": "Show the molecular shape of SF4.",
    "claim": "Valence-shell description",
    "expected": "Fluorine is sp3 hybridised and sulfur is sp3d hybridised.",
    "draw": true
  },
  {
    "id": "terminal-plus-central-wrong",
    "question": "Show the molecular shape of SF4.",
    "claim": "Valence-shell description",
    "expected": "Fluorine is sp3 hybridised and sulfur is sp3 hybridised.",
    "draw": false
  },
  {
    "id": "uppercase-hybrid-correct",
    "question": "Show the molecular shape of SF4.",
    "claim": "Valence-shell description",
    "expected": "Sulfur is SP3D hybridised.",
    "draw": true
  },
  {
    "id": "joined-hybrid-negation-correct",
    "question": "Show the molecular shape of SF4.",
    "claim": "Valence-shell description",
    "expected": "Sulfur is not sp2 or sp3 hybridised.",
    "draw": true
  },
  {
    "id": "joined-hybrid-negation-wrong",
    "question": "Show the molecular shape of SF4.",
    "claim": "Valence-shell description",
    "expected": "Sulfur is not sp2 or sp3d hybridised.",
    "draw": false
  },
  {
    "id": "unicode-hybrid-correct",
    "question": "Show the molecular shape of SF4.",
    "claim": "Valence-shell description",
    "expected": "Sulfur is sp\u00b3d hybridised.",
    "draw": true
  },
  {
    "id": "unicode-hybrid-correct-caret",
    "question": "Show the molecular shape of SF4.",
    "claim": "Valence-shell description",
    "expected": "Sulfur is sp^3d hybridised.",
    "draw": true
  },
  {
    "id": "unicode-hybrid-negated-actual",
    "question": "Show the molecular shape of SF4.",
    "claim": "Valence-shell description",
    "expected": "Sulfur is not sp\u00b3d hybridised.",
    "draw": false
  },
  {
    "id": "terminal-unicode-plus-central-correct",
    "question": "Show the molecular shape of SF4.",
    "claim": "Valence-shell description",
    "expected": "Fluorine is sp\u00b3 hybridised and sulfur is sp\u00b3d hybridised.",
    "draw": true
  },
  {
    "id": "booleanfalse-compound-conservative",
    "question": "Show the molecular shape of SF4.",
    "claim": "SF4 is tetrahedral and square planar.",
    "expected": false,
    "draw": false
  },
  {
    "id": "booleanfalse-unknown-undecided",
    "question": "Show the molecular shape of SF4.",
    "claim": "SF4 has an unspecified descriptive property.",
    "expected": false,
    "draw": true
  }
] as const;
for (const row of polarityNeighborRows) {
  const plan = planFor(row.question);
  plan.qualitativeClaims = [{id:row.id,claim:row.claim,expected:row.expected}];
  assert(validateTurnPlanV3(plan,row.question).valid);
  test(`polarity-neighbor/${row.id}/guard`,()=>assert.equal(vseprPlanConflict(row.question,plan)===null,row.draw));
  test(`polarity-neighbor/${row.id}/native`,()=>assert.equal(!!selectProductionScene({question:row.question,turnPlan:plan,problemIR:null}).representation,row.draw));
}

const hybridTokenBoundaryRows = [
  {
    "id": "unknown-caret-letter",
    "expected": "Sulfur is sp^x hybridised.",
    "draw": true
  },
  {
    "id": "unknown-spaced-caret-letter",
    "expected": "Sulfur is sp ^ x hybridised.",
    "draw": true
  },
  {
    "id": "unknown-caret-only",
    "expected": "Sulfur is sp^ hybridised.",
    "draw": true
  },
  {
    "id": "unknown-double-star",
    "expected": "Sulfur is sp**3 hybridised.",
    "draw": true
  },
  {
    "id": "unknown-caret-followed-correct",
    "expected": "Sulfur is sp^x hybridised and sulfur is sp3d hybridised.",
    "draw": true
  },
  {
    "id": "unknown-caret-followed-wrong",
    "expected": "Sulfur is sp^x hybridised and sulfur is sp3 hybridised.",
    "draw": false
  },
  {
    "id": "ordinary-sp-wrong",
    "expected": "Sulfur is sp hybridised.",
    "draw": false
  },
  {
    "id": "caret-supported-correct",
    "expected": "Sulfur is sp^3d hybridised.",
    "draw": true
  },
  {
    "id": "caret-supported-wrong",
    "expected": "Sulfur is sp^3 hybridised.",
    "draw": false
  },
  {
    "id": "spaced-caret-supported-correct",
    "expected": "Sulfur is sp ^ 3 d hybridised.",
    "draw": true
  },
  {
    "id": "unicode-supported-correct-boundary",
    "expected": "Sulfur is sp\u00b3d hybridised.",
    "draw": true
  },
  {
    "id": "unknown-negated-caret",
    "expected": "Sulfur is not sp^x hybridised.",
    "draw": true
  }
] as const;
for (const row of hybridTokenBoundaryRows) {
  const plan = planFor(sf4, row.expected);
  test(`hybrid-token-boundary/${row.id}/guard`, () => assert.equal(vseprPlanConflict(sf4, plan) === null, row.draw));
  test(`hybrid-token-boundary/${row.id}/native`, () => assert.equal(!!selectProductionScene({ question: sf4, turnPlan: plan, problemIR: null }).representation, row.draw));
}

const load = createRequire(import.meta.url);
const enginePath = realpathSync(load.resolve("@heytutor/scene-engine"));
const sourcePaths = ["packages/scene-engine/src/chemistry/vsepr.ts", "packages/scene-engine/src/chemistry/vseprSource.ts", "apps/tutor/features/tutor-session/lib/scene/productionSceneSelection.ts"];
const hashes = Object.fromEntries(sourcePaths.map(path => [path, createHash("sha256").update(readFileSync(new URL(`../../../../${path}`, import.meta.url))).digest("hex")]));
const output = { passed, failures, cases: rows, sourceHashes: hashes, enginePath, engineEntrySha256: createHash("sha256").update(readFileSync(enginePath)).digest("hex"), scope: "Independent source/native regression gate using synthetic full valid plans, null IR, actual production selector and compiler. No provider, DB, server, browser or coverage claim." };
const outAt = process.argv.indexOf("--out");
if (outAt >= 0) writeFileSync(process.argv[outAt + 1]!, JSON.stringify(output, null, 2) + "\n");
console.log(`verify-live-molecule-review-claims: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
