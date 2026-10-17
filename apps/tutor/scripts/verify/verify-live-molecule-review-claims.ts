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

for (const question of [
  "Show the shape of SF4 and label its bond angle.",
  "Show the shape of SF4. Include water at 5 N.",
  "Show the shapes of SF4 and a molecule whose identity is unknown.",
]) test(`unsafe-or-unresolved/${question}`, () => {
  const selected = selectProductionScene({ question, turnPlan: planFor(question), problemIR: null });
  assert.equal(selected.representation, null, "an unsupported angle, physical number or unresolved member cannot vanish");
});

const load = createRequire(import.meta.url);
const enginePath = realpathSync(load.resolve("@heytutor/scene-engine"));
const sourcePaths = ["packages/scene-engine/src/chemistry/vsepr.ts", "packages/scene-engine/src/chemistry/vseprSource.ts", "apps/tutor/features/tutor-session/lib/scene/productionSceneSelection.ts"];
const hashes = Object.fromEntries(sourcePaths.map(path => [path, createHash("sha256").update(readFileSync(new URL(`../../../../${path}`, import.meta.url))).digest("hex")]));
const output = { passed, failures, cases: rows, sourceHashes: hashes, enginePath, engineEntrySha256: createHash("sha256").update(readFileSync(enginePath)).digest("hex"), scope: "Independent source/native regression gate using synthetic full valid plans, null IR, actual production selector and compiler. No provider, DB, server, browser or coverage claim." };
const outAt = process.argv.indexOf("--out");
if (outAt >= 0) writeFileSync(process.argv[outAt + 1]!, JSON.stringify(output, null, 2) + "\n");
console.log(`verify-live-molecule-review-claims: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
