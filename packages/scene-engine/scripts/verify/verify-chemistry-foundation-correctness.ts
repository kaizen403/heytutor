/** Installed-source F5 chemistry oracles; private proposal overlays are rejected. */
import baseAssert from "node:assert/strict";
let engineAssertions = 0;
const assert: typeof baseAssert = new Proxy(baseAssert, { get(target, key, receiver) { const value = Reflect.get(target, key, receiver); return typeof value === "function" ? (...args: unknown[]) => { engineAssertions += 1; return Reflect.apply(value, target, args); } : value; } });
import { createHash } from "node:crypto";
import "../../src/chemistry/families";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import { renderSceneSvg } from "../lib/renderSceneSvg";
import { ChemScene } from "../../src/chemistry/sceneKit";
import { renderMolecule } from "../../src/chemistry/organic/render";
import { moleculeFromName } from "../../src/chemistry/organic/names";
import { parseSmiles } from "../../src/chemistry/organic/smiles";
import { attachedRingCoordinates } from "../../src/chemistry/foundation/attachedRing";
import { removeCationElectrons } from "../../src/chemistry/foundation/cationRemoval";
import { checkVisualObligations, deriveVisualObligations, visualObligationRejection } from "../../src/synthesize/visualObligations";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import type { ProblemIR } from "../../src/ir/problemIR";
import type { ElectronConfiguration } from "../../src/chemistry/electronConfiguration";
import type { LewisResult } from "../../src/chemistry/lewis";
import type { CftResult } from "../../src/chemistry/crystalField";
import type { LaidOutMolecule } from "../../src/chemistry/organic/layout";
import type { SceneDocument } from "../../src/types";

assert.ok(!process.env.F5_CANDIDATE_MODULE, "F5_CANDIDATE_MODULE private overlays are not an installed-source gate");
assert.ok(!process.argv.some((arg) => /^--(?:patch-root|candidate-module|candidate-root)(?:=|$)/.test(arg)), "private overlay arguments are not accepted");
const moduleNames = ["electronConfiguration", "lewis", "vsepr", "crystalField", "coordination", "moDiagram", "orbitalBox", "organic/layout", "organic/index", "router", "classify"] as const;
// The closed list resolves only this gate's own installed public source. No input selects modules.
const api = Object.assign({}, ...await Promise.all(moduleNames.map((name) => import(`../../src/chemistry/${name}`))));
const outputArg = process.argv.indexOf("--out");
const output = outputArg >= 0 ? resolve(process.argv[outputArg + 1]!) : null;
const changedArg = process.argv.indexOf("--changed-from");
const priorRenders = changedArg >= 0 ? resolve(process.argv[changedArg + 1]!) : null;
if (output) mkdirSync(output, { recursive: true });
const failures: string[] = [];
let passed = 0;
let renders = 0;
let writtenRenders = 0;
function check(name: string, run: () => void): void {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
function compiled(name: string, document: SceneDocument | null): string[] {
  assert.ok(document, `${name} declined`);
  const valid = validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string, unknown>));
  assert.ok(valid.document, JSON.stringify(valid.report.issues));
  const result = compileSceneDocument(valid.document);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  assert.equal(result.report.issues.filter((issue) => issue.severity === "fatal").length, 0);
  assert.equal(valid.document.source?.chemistryFamily, document.source?.chemistryFamily);
  if (output) {
    const svg = renderSceneSvg(result.renderScene!, { title: name, subtitle: "F5 offline candidate; captured QA pending" });
    const prior = priorRenders ? resolve(priorRenders, `${name}.svg`) : null;
    if (!prior || !existsSync(prior) || readFileSync(prior, "utf8") !== svg) {
      writeFileSync(resolve(output, `${name}.svg`), svg);
      writtenRenders++;
    }
  }
  renders++;
  return result.renderScene!.primitives.filter((primitive) => (primitive.kind === "label" || primitive.kind === "dimension") && primitive.text).map((primitive) => primitive.text!);
}

// These complete closed-shell references are independent of aufbau/charge-removal implementation.
const xenonCore: Record<string, number> = { "1s": 2, "2s": 2, "2p": 6, "3s": 2, "3p": 6, "3d": 10, "4s": 2, "4p": 6, "4d": 10, "5s": 2, "5p": 6 };
const radonCore = { ...xenonCore, "4f": 14, "5d": 10, "6s": 2, "6p": 6 };
function occupancy(configuration: ElectronConfiguration | null, expected: Record<string, number>, z: number, charge: number): void {
  assert.ok(configuration);
  assert.deepEqual(Object.fromEntries(configuration.subshells.map((shell) => [`${shell.n}${shell.l}`, shell.electrons])), expected);
  assert.equal(configuration.subshells.reduce((sum, shell) => sum + shell.electrons, 0), z - charge);
  assert.equal(configuration.electrons, z - charge);
  assert.equal(configuration.charge, charge);
}
for (const [symbol, z, charge, core, valence, unpaired] of [
  ["Nd", 60, 3, xenonCore, { "4f": 3 }, 3],
  ["Eu", 63, 3, xenonCore, { "4f": 6 }, 6],
  ["Ce", 58, 4, xenonCore, {}, 0],
  ["U", 92, 4, radonCore, { "5f": 2 }, 2],
  // Independent ground-state references: NIST Ce II energy zero and
  // Flambaum/Porsev, Phys. Rev. A 80, 064502 (2009), Th IV 5f ground level.
  ["Ce", 58, 1, xenonCore, { "4f": 1, "5d": 2 }, 3],
  ["Th", 90, 3, radonCore, { "5f": 1 }, 1],
] as const) check(`configuration-${symbol}${charge}`, () => {
  const result: ElectronConfiguration = api.electronConfiguration(symbol, charge);
  occupancy(result, { ...core, ...valence }, z, charge);
  if (symbol === "Ce" && charge === 4) assert.equal(result.condensed, "[Xe]");
  assert.equal(result.unpairedElectrons, unpaired);
  const mutant = { ...result, subshells: result.subshells.map((shell) => shell.n === 5 && shell.l === "p" ? { ...shell, electrons: 5 } : shell) };
  assert.throws(() => occupancy(mutant, { ...core, ...valence }, z, charge));
  const doc = api.buildOrbitalScene(`Draw the orbital box diagram of ${symbol}${charge}+ and calculate its spin-only magnetic moment.`, [], false);
  compiled(`configuration-${symbol}${charge}`, doc);
  assert.match(doc.annotations.find((a: {id: string}) => a.id === "figure_caption")?.text, /spin.only/i, "moment must be labelled spin-only rather than experimental f-block moment");
  assert.ok(doc.entities.some((entity: { label?: string }) => entity.label?.includes("μ(spin)")), "f-block moment must visibly identify the spin-only approximation");
  if (symbol === "Ce" && charge === 4) assert.ok(doc.entities.some((entity: { label?: string }) => entity.label === "[Xe]"), "closed-core Ce4+ must keep its complete configuration label");
});
check("preserve-neighboring-ion-complete-occupancies", () => {
  for (const [symbol, z, charge, expected] of [
    ["Ce", 58, 3, { ...xenonCore, "4f": 1 }],
    ["Th", 90, 4, radonCore],
    ["Gd", 64, 3, { ...xenonCore, "4f": 7 }],
    ["Lu", 71, 3, { ...xenonCore, "4f": 14 }],
    ["Pa", 91, 4, { ...radonCore, "5f": 1 }],
    ["U", 92, 5, { ...radonCore, "5f": 1 }],
  ] as const) occupancy(api.electronConfiguration(symbol, charge), expected, z, charge);
});
check("preserve-Fe-Cr-Cu-anion-and-invalid-charge", () => {
  const fe = api.electronConfiguration("Fe", 2);
  assert.equal(fe.subshells.find((shell: { n: number; l: string }) => shell.n === 3 && shell.l === "d").electrons, 6);
  assert.ok(!fe.subshells.some((shell: { n: number; l: string }) => shell.n === 4 && shell.l === "s"));
  assert.match(api.electronConfiguration("Cr").full, /3d5.*4s1/);
  assert.match(api.electronConfiguration("Cu").full, /3d10.*4s1/);
  assert.equal(api.electronConfiguration("Cl", -1).electrons, 18);
  assert.equal(api.electronConfiguration("Nd", 0.5), null);
  assert.equal(api.electronConfiguration("U", Number.NaN), null);
});
check("helper-invalid-charge-and-ring-inputs", () => {
  assert.throws(() => removeCationElectrons(new Map([["1s", 2]]), 0.5, new Map()));
  const at = { x: 0, y: 0 }; const outward = { x: 1, y: 0 };
  for (const ring of [[0, 1], [0, 1, 1], [0, 1, -1], [0, 1, 2, 3, 4, 5, 6, 7, 8]]) assert.equal(attachedRingCoordinates(ring, 0, at, outward), null);
  assert.equal(attachedRingCoordinates([0, 1, 2], 0, at, { x: 0, y: 0 }), null);
  assert.equal(attachedRingCoordinates([0, 1, 2], 0, { x: Number.NaN, y: 0 }, outward), null);
});

function oxoacid(result: LewisResult | null, oxygens: number, phosphorusHydrogens: number, hydroxyls: number): void {
  assert.ok(result);
  assert.equal(result.atoms.filter((atom) => atom.symbol === "H").length, 3);
  assert.equal(result.atoms.filter((atom) => atom.symbol === "O").length, oxygens);
  const p = result.atoms.find((atom) => atom.symbol === "P")!;
  const symbol = (id: string) => result.atoms.find((atom) => atom.id === id)!.symbol;
  const adjacent = (id: string) => result.bonds.filter((bond) => bond.a === id || bond.b === id).map((bond) => ({ other: bond.a === id ? bond.b : bond.a, order: bond.order }));
  assert.equal(adjacent(p.id).filter((edge) => symbol(edge.other) === "H" && edge.order === 1).length, phosphorusHydrogens);
  const oxygenEdges = adjacent(p.id).filter((edge) => symbol(edge.other) === "O");
  assert.equal(oxygenEdges.filter((edge) => edge.order === 2).length, 1);
  assert.equal(oxygenEdges.filter((edge) => edge.order === 1 && adjacent(edge.other).some((child) => symbol(child.other) === "H" && child.order === 1)).length, hydroxyls);
  assert.equal(result.atoms.reduce((sum, atom) => sum + atom.formalCharge, 0), 0);
  assert.ok(result.atoms.every((atom) => atom.formalCharge === 0));
  assert.equal(result.bonds.reduce((sum, bond) => sum + bond.order * 2, 0) + result.atoms.reduce((sum, atom) => sum + 2 * atom.lonePairs + atom.unpaired, 0), 3 + 5 + 6 * oxygens);
}
for (const [formula, oxygen, ph, oh] of [["H3PO2", 2, 2, 1], ["H3PO3", 3, 1, 2], ["H3PO4", 4, 0, 3]] as const) check(`lewis-${formula}`, () => {
  const result = api.lewisStructure(formula);
  oxoacid(result, oxygen, ph, oh);
  assert.throws(() => oxoacid({ ...result, bonds: result.bonds.map((bond: { order: number }) => ({ ...bond, order: 1 })) }, oxygen, ph, oh));
  compiled(`lewis-${formula}`, api.buildLewisScene(`Draw the Lewis structure of ${formula}.`, [], false));
});
check("Lewis-unsupported-declines", () => {
  for (const formula of ["N2O5", "[Fe(CN)6]3-"]) assert.equal(api.lewisStructure(formula), null, formula);
});
for (const formula of ["MgCl2", "CaF2", "PbO2", "SiO2"]) check(`VSEPR-solid-${formula}`, () => assert.equal(api.vseprGeometry(formula), null));
check("VSEPR-per-species-filter-preserves-CO2", () => {
  assert.equal(api.vseprGeometry("CO2").shape, "linear");
  assert.equal(api.vseprGeometry("BeCl2").shape, "linear");
  assert.equal(api.vseprGeometry("XeF4").shape, "square planar");
  const results = api.vseprSpecies("Compare the shapes of SiO2 and CO2.");
  assert.equal(results.length, 1);
  assert.equal(results[0].central.symbol, "C");
  compiled("VSEPR-CO2-option", api.buildVseprScene("Compare the shapes of SiO2 and CO2.", [], false));
});
for (const [complex, geometry, unpaired, boxes] of [
  ["[NiCl2(PPh3)2]", "tetrahedral", 2, [[2, 2], [2, 1, 1]]],
  ["[Ni(CN)4]2-", "square_planar", 0, [[2, 2], [2], [2], [0]]],
  ["[NiCl4]2-", "tetrahedral", 2, [[2, 2], [2, 1, 1]]],
  ["[Zn(CN)4]2-", "tetrahedral", 0, [[2, 2], [2, 2, 2]]],
] as const) check(`CFT-${complex}`, () => {
  const result: CftResult = api.crystalFieldAnalysis(complex);
  const expected = (candidate: CftResult) => {
    assert.ok(candidate);
    assert.equal(candidate.geometry, geometry);
    assert.equal(candidate.unpaired, unpaired);
    assert.equal(candidate.magnetism, unpaired ? "paramagnetic" : "diamagnetic");
    assert.deepEqual(candidate.levels.map((level) => level.boxes), boxes);
  };
  expected(result);
  assert.throws(() => expected({ ...result, levels: result.levels.map((level, index) => index === 0 ? { ...level, boxes: level.boxes.map(() => 0) } : level) }));
  assert.equal(api.coordinationIsomers(complex).geometry, geometry.replace("_", " "));
  compiled(`CFT-${complex.replace(/[^A-Za-z0-9]/g, "")}`, api.buildCrystalFieldScene(`Draw the crystal field splitting and magnetic character of ${complex}.`, [], false));
});
check("CFT-unsupported-declines", () => {
  assert.equal(api.crystalFieldAnalysis("[Ni(CN)4]"), null);
  assert.equal(api.crystalFieldAnalysis("[Fe(CO)5]"), null);
});

function geometry(laid: LaidOutMolecule | null, expectedRings: number): void {
  assert.ok(laid, "layout declined");
  assert.equal(laid.rings.length, expectedRings);
  assert.equal(laid.positions.length, laid.molecule.atoms.length);
  for (const bond of laid.molecule.bonds) {
    if (laid.hidden.has(bond.a) || laid.hidden.has(bond.b)) continue;
    const a = laid.positions[bond.a]!; const b = laid.positions[bond.b]!;
    assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 1) < 1e-6, `bond ${bond.index} distorted`);
  }
  for (let a = 0; a < laid.positions.length; a++) for (let b = a + 1; b < laid.positions.length; b++) {
    if (laid.hidden.has(a) || laid.hidden.has(b)) continue;
    assert.ok(Math.hypot(laid.positions[a]!.x - laid.positions[b]!.x, laid.positions[a]!.y - laid.positions[b]!.y) >= 0.5, `atom ${a}/${b} overlap`);
  }
}
for (const [name, atoms, bonds, rings] of [["biphenyl", 12, 13, 2], ["benzophenone", 14, 15, 2], ["diphenylamine", 13, 14, 2], ["phenyl benzoate", 15, 16, 2], ["naphthalene", 10, 11, 2], ["hexane", 6, 5, 0]] as const) check(`layout-${name}`, () => {
  const molecule = moleculeFromName(name)!;
  assert.ok(molecule, "name parsing declined");
  assert.equal(molecule.atoms.length, atoms); assert.equal(molecule.bonds.length, bonds);
  const laid = api.layoutMolecule(molecule);
  geometry(laid, rings);
  const mutant = { ...laid, positions: laid.positions.map((p: { x: number; y: number }, index: number) => index === 0 ? { x: p.x + 0.7, y: p.y } : p) };
  assert.throws(() => geometry(mutant, rings));
  const c = new ChemScene(`Draw ${name}.`, "resolved graph layout", "chem_organic");
  const drawn = renderMolecule(c, laid, "m", { x: 0, y: 0 }, name, 80);
  c.scene.group("molecule", drawn.ids, `structure of ${name}`);
  compiled(`layout-${name.replaceAll(" ", "-")}`, c.build());
  compiled(`organic-adapter-${name.replaceAll(" ", "-")}`, api.buildOrganicScene(`Draw the skeletal structure of ${name}.`, [], false));
});
check("layout-unsupported-atomic-decline", () => {
  const spiro = parseSmiles("C1CCC2(CC1)CCCC2")!;
  assert.ok(spiro); assert.equal(api.layoutMolecule(spiro), null);
});
for (const [index, question] of [
  "Draw the Newman projections of butane viewed along C2-C3 and compare their stability.",
  "Draw anti and gauche conformations of butane about C2–C3; which is more stable?",
  "Compare the stability of staggered and eclipsed sawhorse projections of butane along C2-C3.",
  "Draw the staggered and eclipsed projections of ethane.",
  "Draw anti and gauche projections of butane about C2-C3.",
  "Do not draw a Newman projection; draw a sawhorse projection of butane.",
  "Draw a Newman projection of butane, but do not draw a sawhorse projection.",
  "Without using Newman projections, draw a sawhorse projection of butane.",
  "Draw staggered projections of ethane, excluding eclipsed projections.",
  "Draw the skeletal structure of butane; also show anti and gauche projections about C2-C3.",
  "Draw anti and gauche conformers of butane.",
  "Draw a Newman projection of ethane to explain why its eclipsed conformation is less stable.",
  "Draw not only a Newman projection of butane but also its skeletal structure.",
  // Fresh public R1 re-review probes: a comma list shares its request/object.
  "Draw the anti, gauche and eclipsed projections of butane about C2-C3.",
  "Draw the staggered, eclipsed projections of ethane.",
  "Draw the Newman projection of butane with no eclipsed interactions.",
  // Punctuation and parenthetical modifiers must retain positive intent.
  "Sketch the anti, gauche, and eclipsed projections of butane.",
  "Show (staggered, eclipsed) projections of ethane.",
  "Draw and explain a Newman projection of butane (with no eclipsed interactions).",
  "Do not show Newman projections, but provide anti, gauche projections of butane.",
  "Draw a Newman projection of butane; the angle is not 0 degrees.",
  // A title or request to explain the projection still needs that figure.
  "Newman projection of butane about C2-C3",
  "Explain the Newman projection of butane about C2-C3",
  "What is the Newman projection of butane?",
  "Draw a projection of butane with no eclipsed interactions, using the Newman convention.",
].entries()) check(`projection-decline-${index}`, () => {
  assert.equal(api.isMoStem(question), false);
  assert.equal(api.buildMoScene(question, [], false), null);
  assert.equal(api.isOrganicStem(question), false);
  assert.equal(api.buildOrganicScene(question, [], false), null, "zigzag is not a projection");
});
for (const [index, question] of [
  "Draw the skeletal structure of ethanol. Do not draw a Newman projection.",
  "Draw the skeletal structure of ethane and explain why it rotates between staggered and eclipsed conformations.",
  "Draw the skeletal structure of ethanol, not a Newman projection.",
  "Draw the skeletal structure of ethanol rather than a Newman projection.",
  "Draw the skeletal structure of ethanol without a Newman projection.",
  "Do not draw Newman or sawhorse projections; draw the skeletal structure of butane.",
  "Newman projections are excluded; draw the skeletal structure of ethanol.",
  "Draw the skeletal structure of ethane and explain the difference between staggered and eclipsed conformations.",
  "Draw the skeletal structure of butane; anti and gauche conformations are only background information.",
  "Draw the skeletal structure of ethanol but no Newman projections.",
  "Draw the skeletal structure of ethane and compare the stability of staggered and eclipsed conformations.",
  // Fresh public R2 re-review probe: descriptive subjects are not requests.
  "Draw only the skeletal structure of ethanol. Newman projections are used to discuss bond rotations.",
  "Draw the skeletal structure of ethane. Staggered and eclipsed conformations explain its rotation.",
  "Draw the skeletal structure of ethanol (Newman projections are background information).",
  "Draw the skeletal structure of ethanol, and explain Newman projections.",
  "Draw the skeletal structure of ethanol; do not show anti, gauche or eclipsed projections.",
  "Draw the skeletal structure of ethanol, not a Newman or sawhorse projection.",
  "Draw the skeletal structure of ethanol, Newman projections are used to discuss bond rotations.",
  "Draw the skeletal structure of ethane and explain why staggered is stable.",
  "Draw the skeletal structure of ethane; show neither staggered, eclipsed nor Newman projections.",
].entries()) check(`preserve-skeleton-projection-mention-${index}`, () => {
  assert.equal(api.isOrganicStem(question), true);
  const doc = api.buildOrganicScene(question, [], false);
  assert.equal(doc?.source?.chemistryFamily, "chem_organic");
  compiled(`preserve-skeleton-projection-mention-${index}`, doc);
});
for (const [index, question] of [
  "Draw the molecular orbital diagram of C2; Newman projections are outside this question.",
  "Draw the molecular orbital diagram of C2; ignore Newman projections.",
  "Draw the molecular orbital diagram of C2, not a Newman projection.",
  "Draw the molecular orbital diagram of C2 (Newman projections are used to discuss bond rotation).",
  "Draw the molecular orbital diagram of C2; never sketch a Newman projection.",
  "Draw the molecular orbital diagram of C2, Newman projections are background information.",
].entries()) check(`preserve-MO-projection-mention-${index}`, () => {
  assert.equal(api.isMoStem(question), true);
  const doc = api.buildMoScene(question, [], false);
  assert.equal(doc?.source?.chemistryFamily, "chem_mo");
  compiled(`preserve-MO-projection-mention-${index}`, doc);
});
check("preserve-actual-C2-MO", () => {
  const stem = "Draw the molecular orbital diagram of C2 and calculate its bond order.";
  assert.ok(api.isMoStem(stem));
  assert.equal(api.moConfiguration("C2").bondOrder, 2);
  compiled("C2-MO", api.buildMoScene(stem, [], false));
});
function speciesProblem(question: string, names: readonly string[]): ProblemIR {
  return {
    schemaVersion: "problem-ir/v1", id: "public-f5-composition", question,
    facts: [{ id: "stem", kind: "given", statement: question, evidence: { source: "question", start: 0, end: question.length, quote: question } }],
    entities: names.map((label, index) => ({ id: `species${index}`, kind: "body", label, evidenceFactIds: ["stem"] })),
    constraints: [], expressions: [], solveRequests: [],
    representationIntents: [{ id: "draw", kind: "conceptual", entityIds: names.map((_, index) => `species${index}`), evidenceFactIds: ["stem"] }],
  };
}
// Existing general authority checks; F2 binding audits are deferred below.
check("standalone-network-whole-IR-refusal", () => {
  const question = "Compare the shapes of SiO2 and CO2.";
  const document: SceneDocument = api.buildVseprScene(question, [], false);
  assert.ok(document, "eligible CO2 per-species geometry must remain");
  compiled("standalone-CO2-eligible-only", document);
  const problem = speciesProblem(question, ["SiO2", "CO2"]);
  const obligations = deriveVisualObligations(problem);
  const result = checkVisualObligations(obligations, document);
  assert.equal(result.satisfied, false);
  assert.ok(result.missing.some((miss) => miss.problemEntityIds.includes("species0")), "SiO2 obligation must remain missing");
  assert.match(visualObligationRejection(obligations, document) ?? "", /SiO2/);
  assert.equal(synthesizeFamilyScene({ question, problemIR: problem }), null, "full source IR must reject a CO2 fragment");
  assert.equal(api.buildVseprScene("Draw the molecular shape of SiO2.", [], false), null);
});
check("standalone-supported-CO2-compiled-positive", () => {
  const question = "Draw the molecular shape of CO2.";
  const document: SceneDocument = api.buildVseprScene(question, [], false);
  assert.ok(document);
  compiled("standalone-supported-CO2", document);
  assert.equal(api.vseprGeometry("CO2").shape, "linear");
  // Ordinary body obligations cannot map a formula label to a whole molecule.
  // Direct compile is not source-bound F2 admission; report that limit honestly.
  const problem = speciesProblem(question, ["CO2"]);
  assert.equal(checkVisualObligations(deriveVisualObligations(problem), document).satisfied, false);
  assert.equal(synthesizeFamilyScene({ question, problemIR: problem }), null);
});
check("composition-main-Pauli-complete-word", () => {
  assert.equal(api.isOrbitalStem("Explain the Pauli exclusion principle in the nitrogen atom."), true);
  assert.equal(api.isOrbitalStem("Explain Pauling's rule in the nitrogen atom."), false);
});

// Literal core maps independently expand the printed configuration. Highly
// charged controls certify representation/count consistency, not ground states.
const heliumCore = { "1s": 2 };
const neonCore = { ...heliumCore, "2s": 2, "2p": 6 };
const argonCore = { ...neonCore, "3s": 2, "3p": 6 };
const kryptonCore = { ...argonCore, "3d": 10, "4s": 2, "4p": 6 };
const literalCores: Record<string, Record<string, number>> = {
  He: heliumCore, Ne: neonCore, Ar: argonCore, Kr: kryptonCore, Xe: xenonCore, Rn: radonCore,
};
function expandConfigurationText(text: string): Record<string, number> {
  const prefix = /^\[([A-Za-z]+)\](?:\s|$)/.exec(text);
  const expanded: Record<string, number> = {};
  if (prefix) {
    const core = literalCores[prefix[1]!];
    assert.ok(core, `unknown printed core ${prefix[1]}`);
    Object.assign(expanded, core);
  }
  const rest = (prefix ? text.slice(prefix[0].length) : text).trim();
  const seen = new Set<string>();
  for (const token of rest ? rest.split(/\s+/) : []) {
    const shell = /^(\d[spdf])(\d+)$/.exec(token);
    assert.ok(shell, `incomplete printed subshell ${token}`);
    const key = shell[1]!;
    assert.ok(!seen.has(key), `repeated printed subshell ${key}`);
    seen.add(key);
    const count = Number(shell[2]);
    assert.ok(Number.isInteger(count) && count > 0);
    expanded[key] = (expanded[key] ?? 0) + count;
  }
  return expanded;
}
const printedConfigurationChecks: { symbol: string; z: number; charge: number; full: string; condensed: string; expectedCondensed: string; expectedElectrons: number; expandedElectrons: number; expectedOccupancy: Record<string, number> }[] = [];
for (const [symbol, z, charge, expected, expectedCondensed] of [
  ["Ce", 58, 4, xenonCore, "[Xe]"],
  ["Ce", 58, 3, { ...xenonCore, "4f": 1 }, "[Xe] 4f1"],
  ["Ce", 58, 1, { ...xenonCore, "4f": 1, "5d": 2 }, "[Xe] 4f1 5d2"],
  ["Th", 90, 3, { ...radonCore, "5f": 1 }, "[Rn] 5f1"],
  ["Th", 90, 4, radonCore, "[Rn]"],
  ["Nd", 60, 6, xenonCore, "[Xe]"],
  ["Pd", 46, 0, { ...kryptonCore, "4d": 10 }, "[Kr] 4d10"],
  ["Pd", 46, 10, kryptonCore, "[Kr]"],
  ["Pd", 46, 11, { ...argonCore, "3d": 10, "4s": 2, "4p": 5 }, "[Ar] 3d10 4s2 4p5"],
  ["Xe", 54, 18, kryptonCore, "[Kr]"],
  ["Kr", 36, 18, argonCore, "[Ar]"],
  ["Ar", 18, 8, neonCore, "[Ne]"],
  ["Ne", 10, 8, heliumCore, "[He]"],
  ["He", 2, 2, {}, ""],
  ["Li", 3, 2, { "1s": 1 }, "1s1"],
  ["H", 1, -1, heliumCore, "[He]"],
  ["Cl", 17, -1, argonCore, "[Ar]"],
  ["Cu", 29, 1, { ...argonCore, "3d": 10 }, "[Ar] 3d10"],
  ["Fe", 26, 2, { ...argonCore, "3d": 6 }, "[Ar] 3d6"],
  ["Th", 90, 34, { ...kryptonCore, "4d": 10, "4f": 10 }, "[Kr] 4d10 4f10"],
  ["Th", 90, 35, { ...kryptonCore, "4d": 10, "4f": 9 }, "[Kr] 4d10 4f9"],
  ["Th", 90, 36, { ...kryptonCore, "4d": 10, "4f": 8 }, "[Kr] 4d10 4f8"],
  ["Th", 90, 37, { ...kryptonCore, "4d": 10, "4f": 7 }, "[Kr] 4d10 4f7"],
  ["Th", 90, 53, { ...kryptonCore, "4d": 1 }, "[Kr] 4d1"],
  ["Th", 90, 54, kryptonCore, "[Kr]"],
  ["Th", 90, 55, { ...argonCore, "3d": 10, "4s": 2, "4p": 5 }, "[Ar] 3d10 4s2 4p5"],
] as const) check(`printed-core-${symbol}-${charge}`, () => {
  const configuration: ElectronConfiguration | null = api.electronConfiguration(symbol, charge);
  assert.ok(configuration);
  const expanded = expandConfigurationText(configuration.condensed);
  const expandedElectrons = Object.values(expanded).reduce((sum, count) => sum + count, 0);
  printedConfigurationChecks.push({ symbol, z, charge, full: configuration.full, condensed: configuration.condensed, expectedCondensed, expectedElectrons: z - charge, expandedElectrons, expectedOccupancy: expected });
  occupancy(configuration, expected, z, charge);
  assert.deepEqual(expandConfigurationText(configuration.full), expected, "full printed occupancy must be complete");
  assert.equal(expandedElectrons, z - charge, "condensed printed total must equal literal Z minus charge");
  assert.deepEqual(expanded, expected, "printed core must not invent missing subshell electrons");
  assert.equal(configuration.condensed, expectedCondensed);
});
check("printed-core-oracle-rejects-core-hole-count-and-map-mutants", () => {
  const th36 = { ...kryptonCore, "4d": 10, "4f": 8 };
  const invented = expandConfigurationText("[Xe] 4f8");
  assert.equal(Object.values(invented).reduce((sum, count) => sum + count, 0), 62);
  assert.throws(() => assert.deepEqual(invented, th36));
  assert.throws(() => assert.deepEqual(expandConfigurationText("[Kr] 4d9 4f9"), th36), "same-total wrong occupancy must fail");
  assert.throws(() => expandConfigurationText("[Xe] 4f8 trailing"));
});
let parentComparisonsExecuted = 0;
let parentComparisonRows = 0;
let parentComparisonsSkipped = 1;
const nonchemArg = process.argv.indexOf("--nonchem");
if (nonchemArg >= 0) check("no-new-physics-maths-entry-captures", () => {
  const directory = resolve(process.argv[nonchemArg + 1]!);
  const frozenArg = process.argv.indexOf("--frozen-routes");
  type FrozenRoute = { id: string; questionSha256: string; questionClassifier: boolean; chemistryFamilies: string[] };
  assert.ok(frozenArg >= 0 && process.argv[frozenArg + 1], "--nonchem requires independent --frozen-routes");
  const frozenHashArg = process.argv.indexOf("--frozen-routes-sha256");
  assert.ok(frozenHashArg >= 0 && /^[a-f0-9]{64}$/.test(process.argv[frozenHashArg + 1] ?? ""), "independent parent route SHA256 required");
  const frozenBytes = readFileSync(resolve(process.argv[frozenArg + 1]!));
  const frozenHash = createHash("sha256").update(frozenBytes).digest("hex");
  assert.equal(frozenHash, process.argv[frozenHashArg + 1]);
  const frozen: { routes: FrozenRoute[] } = JSON.parse(frozenBytes.toString("utf8"));
  const expectedCaptures = frozen.routes.filter((row) => row.questionClassifier || row.chemistryFamilies.length).length;
  parentComparisonsExecuted = 1; parentComparisonRows = frozen.routes.length; parentComparisonsSkipped = 0;
  const frozenRoutes = new Map(frozen.routes.map((row) => [row.id, row]));
  const rows = ["physics", "maths"].flatMap((subject) => readFileSync(resolve(directory, `${subject}.jsonl`), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { id: string; question: string }));
  assert.equal(rows.length, 1667);
  if (frozen) assert.equal(frozenRoutes.size, rows.length, "frozen snapshot must cover every corpus row");
  const newIds: string[] = []; const removedIds: string[] = []; const changedBits: string[] = [];
  const afterRoutes: { id: string; questionBit: boolean; families: string[] }[] = [];
  let baselineCaptures = 0; let candidateCaptures = 0;
  for (const row of rows) {
    const prior = frozenRoutes.get(row.id);
    {
      assert.ok(prior, `missing frozen row ${row.id}`);
      assert.equal(createHash("sha256").update(row.question).digest("hex"), prior.questionSha256, `changed corpus stem ${row.id}`);
    }
    const beforeQuestion = prior!.questionClassifier;
    const beforeFamilies = prior!.chemistryFamilies;
    const afterQuestion = api.isChemistryQuestion(row.question); const afterFamilies = api.inferChemistryFamilies(row.question);
    const before = beforeQuestion || beforeFamilies.length > 0; const after = afterQuestion || afterFamilies.length > 0;
    afterRoutes.push({ id: row.id, questionBit: afterQuestion, families: afterFamilies });
    if (before) baselineCaptures++;
    if (after) candidateCaptures++;
    if ((!beforeQuestion && afterQuestion) || afterFamilies.some((family: string) => !beforeFamilies.includes(family as (typeof beforeFamilies)[number]))) newIds.push(row.id);
    if (before && !after) removedIds.push(row.id);
    if (beforeQuestion !== afterQuestion || JSON.stringify(beforeFamilies) !== JSON.stringify(afterFamilies)) changedBits.push(row.id);
  }
  const report = { rows: rows.length, baselineCaptures, candidateCaptures, newIds, removedIds, changedBits, frozenRoutes: frozenArg >= 0 ? resolve(process.argv[frozenArg + 1]!) : null, frozenSha256: frozenHash, expectedParentCaptures: expectedCaptures, scope: "independently pinned parent classifier/every-family arrays; separate rebuilt QA target gate owns capability/native bits" };
  console.log(JSON.stringify(report));
  if (output) writeFileSync(resolve(output, "no-new-captures.json"), JSON.stringify({ ...report, after: afterRoutes }, null, 2));
  assert.deepEqual(newIds, []);
  assert.deepEqual(removedIds, []);
  assert.deepEqual(changedBits, []);
  assert.equal(baselineCaptures, expectedCaptures, "complete independent parent routes must bind the baseline count");
});
if (process.argv.includes("--probes")) check("preserve-existing-touched-family-probes", () => {
  let draws = 0; let declines = 0;
  for (const [probeKey, builderKey] of [["VSEPR_PROBES", "buildVseprScene"], ["LEWIS_PROBES", "buildLewisScene"], ["MO_PROBES", "buildMoScene"], ["ORBITAL_PROBES", "buildOrbitalScene"], ["CFT_PROBES", "buildCrystalFieldScene"], ["COORD_PROBES", "buildCoordinationScene"], ["ORGANIC_PROBES", "buildOrganicScene"]]) {
    for (const [index, probe] of api[probeKey].entries()) {
      const doc = api[builderKey](probe.question, [], false);
      if (probe.expect === "decline") { assert.equal(doc, null, `${probeKey} ${index} expected decline`); declines++; }
      else {
        const labels = compiled(`preserve-${probeKey}-${index}`, doc);
        for (const label of probe.labels ?? []) assert.ok(labels.includes(label), `${probeKey} ${index}: missing ${label}`);
        for (const label of probe.forbidLabels ?? []) assert.ok(!labels.includes(label), `${probeKey} ${index}: forbidden ${label}`);
        draws++;
      }
    }
  }
  console.log(JSON.stringify({ preservedProbeDraws: draws, preservedProbeDeclines: declines }));
});
const report = { mode: "actual installed public source (offline)", candidateGroups: passed + failures.length, engineAssertions, passed, failed: failures.length, renders, writtenRenders, failures, printedConfigurationChecks,
  parentComparisons: { executed: parentComparisonsExecuted, skipped: parentComparisonsSkipped, rows: parentComparisonRows }, historicalOverlayComparisonsExecuted: 0,
  excludedF2Controls: { count: 5, status: "deferred, not executed or passed", names: ["composition-network-whole-source-refusal (F2 binding audit)", "composition-supported-CO2-whole-source (F2 admission)", "composition-bound-H3PO2-source-and-graph", "composition-bound-H3PO3-source-and-graph", "composition-bound-H3PO4-source-and-graph"] },
  deferred: ["F2 species source/graph/compiler binding controls", "app opening/admission/save/reopen/replay/cache", "physical angle/hybrid/spin-only display authority", "captured/judged eval+holdout/images", "advanced-main preservation composition"], capturedQA: "unavailable", sourceModules: moduleNames.map((name) => ({ name, sha256: createHash("sha256").update(readFileSync(new URL(`../../src/chemistry/${name}.ts`, import.meta.url))).digest("hex") })) };
console.log(JSON.stringify(report, null, 2));
const reportArg = process.argv.indexOf("--report");
if (reportArg >= 0) writeFileSync(resolve(process.argv[reportArg + 1]!), JSON.stringify(report, null, 2) + "\n");
process.exitCode = failures.length ? 1 : 0;
