/**
 * A hydrogen bond figure draws whole molecules, with the hydrogens the formula
 * gives, near linear at H, and only for a plain ask about one species. It used
 * to draw one O-H under the label H2O, and a pair of ammonia or water for any
 * stem naming them, including "ammonia in water" and "DNA base pairs in water".
 * When it declines, no other family may take the turn.
 *
 *   tsx --tsconfig ../../apps/tutor/tsconfig.json scripts/verify/verify-chemistry-hbond-molecules.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../../src/chemistry/families";
import { hydrogenBondFigureLeads, hydrogenBondSpelledPastLewis, mentionsHydrogenBond, organicStructureCannotAnswer } from "../../src/chemistry/bondingFigures";
import { chemStem } from "../../src/chemistry/sceneKit";
import { buildLewisScene } from "../../src/chemistry/lewis";
import { parseFormula } from "../../src/chemistry/formula";
import { isChemistryQuestion, inferChemistryFamilies } from "../../src/chemistry/router";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";
import subsetFixture from "./fixtures/chemistry-hbond-subset.json";

let failed = 0;
let passed = 0;
function check(id: string, run: () => void): void {
  try {
    run();
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

type Point = { x: number; y: number };

function pointOf(document: SceneDocument, id: string): Point {
  const construction = document.constructions.find((value) => value.outputs.includes(id));
  assert.ok(construction, `no construction for ${id}`);
  if (construction.operator === "label") return pointOf(document, String(construction.inputs.target));
  assert.equal(construction.operator, "point", `${id} is not a point`);
  return { x: Number(construction.inputs.x), y: Number(construction.inputs.y) };
}

const labelOf = (document: SceneDocument, id: string) => document.entities.find((entity) => entity.id === id)?.label;
const atomsOf = (document: SceneDocument, symbol: string) => document.entities.filter((entity) => entity.label === symbol).map((entity) => entity.id);
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** The angle at `vertex`, in degrees, as drawn on the page. */
function angleAt(vertex: Point, a: Point, b: Point): number {
  const raw = Math.abs(Math.atan2(a.y - vertex.y, a.x - vertex.x) - Math.atan2(b.y - vertex.y, b.x - vertex.x)) * 180 / Math.PI;
  return raw > 180 ? 360 - raw : raw;
}

/** The hydrogens on one heavy atom and their bonds, by the ids the figure gives them. */
function moleculeHydrogens(document: SceneDocument, prefix: "a" | "b"): Array<{ hydrogen: string; bond: string }> {
  const rows: Array<{ hydrogen: string; bond: string }> = [];
  for (const entity of document.entities) {
    const match = new RegExp(`^${prefix}_h(\\d*)$`).exec(entity.id);
    if (match && entity.label === "H") rows.push({ hydrogen: entity.id, bond: `${prefix}_b${match[1]}` });
  }
  return rows;
}

const roleOf = (document: SceneDocument, id: string) => String(document.entities.find((entity) => entity.id === id)?.role ?? "");

// Plain asks: the figure draws and each molecule has its formula's hydrogens.
const WATER = { formula: "H2O", heavy: "O", label: "H_2O" };
const AMMONIA = { formula: "NH3", heavy: "N", label: "NH_3" };
const HF = { formula: "HF", heavy: "F", label: "HF" };
const DRAWS: ReadonlyArray<{ question: string; formula: string; heavy: string; label: string }> = [
  { question: "hydrogen bonding in water", ...WATER },
  { question: "Draw the hydrogen bond between two water molecules.", ...WATER },
  { question: "show hydrogen bonding in H2O", ...WATER },
  { question: "show hydrogen bonding in H₂O", ...WATER },
  { question: "Why does water form hydrogen bonds? Draw a diagram.", ...WATER },
  { question: "hydrogen bonding in liquid water", ...WATER },
  { question: "Draw a diagram to show hydrogen bonding between two water molecules", ...WATER },
  { question: "Draw a labelled diagram of hydrogen bonding in water", ...WATER },
  { question: "Explain hydrogen bonding in water with a neat diagram", ...WATER },
  { question: "Can water form hydrogen bonds?", ...WATER },
  { question: "Teach me hydrogen bonding in water", ...WATER },
  { question: "Please explain hydrogen bonding in water", ...WATER },
  { question: "What is hydrogen bonding in water?", ...WATER },
  { question: "Explain hydrogen bonding using water as an example", ...WATER },
  { question: "Do water molecules form hydrogen bonds with each other?", ...WATER },
  { question: "What type of hydrogen bonding is present in water?", ...WATER },
  { question: "1. Explain hydrogen bonding in water.", ...WATER },
  { question: "(b) Explain hydrogen bonding in water.", ...WATER },
  { question: "Explain hydrogen bonding in water. (2 marks)", ...WATER },
  { question: "Hydrogen bond in H2O(l)", ...WATER },
  { question: "Water me hydrogen bonding explain karo", ...WATER },
  { question: "Hydrogen bonding in water kya hota hai", ...WATER },
  { question: "Draw hydrogen bonds between 2 water molecules.", ...WATER },
  { question: "Show the hydrogen bond between two molecules of water.", ...WATER },
  { question: "Explain hydrogen bonding in a water molecule.", ...WATER },
  { question: "Explain hydrogen bonding in water with the help of a diagram.", ...WATER },
  { question: "Explain hydrogen bonding in water, with a neat diagram.", ...WATER },
  { question: "Draw and explain hydrogen bonding in water.", ...WATER },
  { question: "Draw the structure of water showing hydrogen bonding.", ...WATER },
  { question: "Show how hydrogen bonds form between water molecules.", ...WATER },
  { question: "How do hydrogen bonds form between water molecules?", ...WATER },
  { question: "How are hydrogen bonds formed in water?", ...WATER },
  { question: "What do you mean by hydrogen bonding in water?", ...WATER },
  { question: "Write a note on hydrogen bonding in water", ...WATER },
  { question: "Can you explain hydrogen bonding in water?", ...WATER },
  { question: "Is there hydrogen bonding in water?", ...WATER },
  { question: "Is hydrogen bonding present in water?", ...WATER },
  { question: "What is hydrogen bonding? Explain with the example of water.", ...WATER },
  { question: "Explain hydrogen bonding taking water as an example", ...WATER },
  { question: "Water mein hydrogen bond kaise banta hai?", ...WATER },
  { question: "Hydrogen bonding kya hai water me", ...WATER },
  { question: "Can you show hydrogen bonding in ammonia?", ...AMMONIA },
  { question: "What do you understand by hydrogen bonding in HF?", ...HF },
  { question: "Explain hydrogen bonding with example of HF.", ...HF },
  { question: "Draw the hydrogen bond between two molecules of HF.", ...HF },
  { question: "hydrogen bonding in ammonia", ...AMMONIA },
  { question: "Draw hydrogen bonds between NH3 molecules.", ...AMMONIA },
  { question: "Show the intermolecular hydrogen bond in ammonia.", ...AMMONIA },
  { question: "Can ammonia form hydrogen bonds?", ...AMMONIA },
  { question: "Draw a neat diagram of hydrogen bonding in ammonia", ...AMMONIA },
  { question: "What is meant by hydrogen bonding in ammonia?", ...AMMONIA },
  { question: "hydrogen bonding in HF", ...HF },
  { question: "Show the intermolecular hydrogen bond in hydrogen fluoride.", ...HF },
  { question: "Show me hydrogen bonding in HF", ...HF },
  { question: "Draw a labelled diagram to show hydrogen bonding in HF", ...HF },
];

for (const row of DRAWS) {
  const document = buildLewisScene(row.question, [], false);
  const expected = parseFormula(row.formula)?.atoms.find((atom) => atom.symbol === "H")?.count ?? 0;
  check(`draws: ${row.question}`, () => assert.ok(document, "declined"));
  if (!document) continue;
  check(`hydrogens from the formula: ${row.question}`, () => {
    assert.equal(atomsOf(document, "H").length, expected * 2, `${atomsOf(document, "H").length} H drawn for two ${row.formula}`);
    assert.equal(labelOf(document, "a_x"), row.heavy);
    assert.equal(labelOf(document, "b_x"), row.heavy);
    for (const [prefix, heavy] of [["a", "a_x"], ["b", "b_x"]] as const) {
      const hydrogens = moleculeHydrogens(document, prefix);
      assert.equal(hydrogens.length, expected, `${prefix} molecule has ${hydrogens.length} H`);
      for (const { hydrogen, bond } of hydrogens) {
        assert.ok(roleOf(document, bond).includes(`${row.heavy}-H bond`), `${bond} is not a covalent bond`);
        const length = distance(pointOf(document, heavy), pointOf(document, hydrogen));
        const foreshortened = roleOf(document, bond).includes("dash");
        assert.ok(length > (foreshortened ? 0.7 : 1) && length < 1.25, `${hydrogen} is ${length.toFixed(2)} from ${heavy}`);
      }
    }
  });
  check(`the hydrogen bond is dashed, not covalent, and near linear at H: ${row.question}`, () => {
    const link = document.entities.find((entity) => entity.id === "hb");
    assert.ok(link && link.provenance?.dashed === true, "dashed link");
    const [donor, hydrogen, acceptor] = ["a_x", "a_h", "b_x"].map((id) => pointOf(document, id));
    assert.ok(angleAt(hydrogen!, donor!, acceptor!) > 170, "bent at H");
    assert.ok(distance(hydrogen!, acceptor!) > distance(donor!, hydrogen!), "shorter than the covalent bond");
  });
  check(`no two atoms collide: ${row.question}`, () => {
    const atoms = [...atomsOf(document, "H"), "a_x", "b_x"].map((id) => pointOf(document, id));
    for (let i = 0; i < atoms.length; i += 1) for (let j = i + 1; j < atoms.length; j += 1) {
      assert.ok(distance(atoms[i]!, atoms[j]!) > 0.8, `atoms ${i} and ${j} are ${distance(atoms[i]!, atoms[j]!).toFixed(2)} apart`);
    }
  });
  check(`compiles and names the bond and the species: ${row.question}`, () => {
    const compiled = compileSceneDocument(document);
    const labels = compiled.renderScene.primitives.filter((p) => p.kind === "label" && p.text).map((p) => p.text);
    assert.ok(labels.includes(row.label), `no ${row.label} label`);
    assert.ok(labels.includes("hydrogen bond"), "no hydrogen bond label");
    assert.ok(!compiled.report.issues.some((issue) => issue.severity === "fatal"), "fatal compile issue");
  });
  check(`family path draws it: ${row.question}`, () => {
    assert.equal(synthesizeFamilyScene({ question: row.question })?.family, "chem_lewis");
  });
}

// Each species has the shape it really has. Read from the geometry and the bond marks.
const water = buildLewisScene("hydrogen bonding in water", [], false)!;
const ammonia = buildLewisScene("hydrogen bonding in ammonia", [], false)!;
const hf = buildLewisScene("hydrogen bonding in HF", [], false)!;
check("water is bent on both molecules", () => {
  for (const [centre, first, second] of [["a_x", "a_h", "a_h2"], ["b_x", "b_h", "b_h2"]] as const) {
    const inner = angleAt(pointOf(water, centre), pointOf(water, first), pointOf(water, second));
    assert.ok(inner > 95 && inner < 115, `${centre} H-O-H is ${inner.toFixed(1)} degrees`);
  }
});
check("water's acceptor takes the bond between its two hydrogens", () => {
  const o = pointOf(water, "b_x");
  const first = angleAt(o, pointOf(water, "a_h"), pointOf(water, "b_h"));
  const second = angleAt(o, pointOf(water, "a_h"), pointOf(water, "b_h2"));
  assert.ok(Math.abs(first - second) < 3, `${first.toFixed(1)} against ${second.toFixed(1)}`);
});
check("ammonia is marked as a pyramid on both molecules, never flat or T shaped", () => {
  for (const [prefix, centre] of [["a", "a_x"], ["b", "b_x"]] as const) {
    const hydrogens = moleculeHydrogens(ammonia, prefix);
    const roles = hydrogens.map(({ bond }) => roleOf(ammonia, bond));
    assert.equal(roles.filter((role) => role.includes("wedge")).length, 1, `${prefix} wedge`);
    assert.equal(roles.filter((role) => role.includes("dash")).length, 1, `${prefix} dash`);
    const points = hydrogens.map(({ hydrogen }) => pointOf(ammonia, hydrogen));
    for (let i = 0; i < points.length; i += 1) for (let j = i + 1; j < points.length; j += 1) {
      assert.ok(angleAt(pointOf(ammonia, centre), points[i]!, points[j]!) < 170, `${prefix} has a straight H-N-H`);
    }
  }
});
check("ammonia's wedge and dash sit on the same side of its plain bond, as a tripod", () => {
  for (const [prefix, centre] of [["a", "a_x"], ["b", "b_x"]] as const) {
    const hydrogens = moleculeHydrogens(ammonia, prefix);
    const n = pointOf(ammonia, centre);
    const byMark = (mark: string) => hydrogens.find(({ bond }) => roleOf(ammonia, bond).includes(mark))!;
    const plain = hydrogens.find(({ bond }) => !/wedge|dash/.test(roleOf(ammonia, bond)))!;
    const toPlain = pointOf(ammonia, plain.hydrogen);
    const side = (hydrogen: string) => {
      const at = pointOf(ammonia, hydrogen);
      return Math.sign((toPlain.x - n.x) * (at.y - n.y) - (toPlain.y - n.y) * (at.x - n.x));
    };
    assert.equal(side(byMark("wedge").hydrogen), side(byMark("dash").hydrogen), `${prefix} straddles its plain bond`);
  }
});
check("ammonia's lone pair side faces the donor", () => {
  const n = pointOf(ammonia, "b_x");
  const donorSide = pointOf(ammonia, "a_h");
  for (const { hydrogen } of moleculeHydrogens(ammonia, "b")) {
    assert.ok(angleAt(n, donorSide, pointOf(ammonia, hydrogen)) > 100, `${hydrogen} crowds the hydrogen bond`);
  }
});
check("HF zigzags at the acceptor", () => {
  const inner = angleAt(pointOf(hf, "b_x"), pointOf(hf, "a_h"), pointOf(hf, "b_h"));
  assert.ok(inner > 100 && inner < 140, `H-F...H is ${inner.toFixed(1)} degrees`);
});

// Anything but a plain ask about one species: this figure must not answer it, and nothing else may.
const DECLINES: readonly string[] = [
  // A second substance.
  "hydrogen bonding between water and ammonia",
  "Draw the hydrogen bond between NH3 and H2O.",
  "hydrogen bonding between HF and water",
  "Compare hydrogen bonding in HF, H2O and NH3.",
  "Which is stronger, the hydrogen bond in water or in ammonia?",
  "Why is ammonia very soluble in water? Show the hydrogen bond.",
  "hydrogen bonding in an aqueous solution of ammonia",
  "hydrogen bonding in liquid ammonia and liquid HF",
  "Hydrogen bonding in hydrazine and ammonia",
  "Hydrogen bonding in hydrogen peroxide and water",
  "Show the hydrogen bond between phenol and water.",
  "Draw the hydrogen bond between ethanol and water.",
  "Show hydrogen bonds between methanol molecules.",
  "Does methane form hydrogen bonds with water?",
  "hydrogen bonding in acetic acid dimer in water",
  "hydrogen bonds between DNA base pairs in water",
  "hydrogen bonds in a protein helix in water",
  "hydrogen bonding in cellulose and water",
  "Hydrogen bonds between glucose and water molecules.",
  "hydrogen bonding in sugar water",
  "hydrogen bonds in nylon and water",
  "hydrogen bonding in heavy water D2O",
  "water of crystallisation and hydrogen bonds in CuSO4.5H2O",
  "Why does ice float on water? Show the hydrogen bonds.",
  "hydrogen bonding of water in the structure of ice",
  "Water boils higher than H2Se because of hydrogen bonding. Explain.",
  "Why does H2S not form hydrogen bonds but water does?",
  "Water boils far above hydrogen sulfide. Explain the difference using hydrogen bonding, and say why H2S does not form hydrogen bonds of the same kind.",
  // Word order: a bag of allowed words let these through.
  "Show the hydrogen bond between water and hydrogen",
  "Show the hydrogen bond between a water molecule and a hydrogen molecule",
  "Does hydrogen form a hydrogen bond with water?",
  "Why do hydrogen and water form a hydrogen bond?",
  "Hydrogen bonding in pure hydrogen and water",
  "How is a hydrogen bond formed between liquid hydrogen and HF?",
  "Show the hydrogen bond between water and molecule A",
  "Does A form a hydrogen bond with water?",
  "Do A and water form hydrogen bonds?",
  "Show the hydrogen bond between water and molecule 2",
  "Does structure 2 have a hydrogen bond with water?",
  "Does the molecule in figure 2 form hydrogen bonds with HF?",
  // Counts: the figure draws exactly one bond.
  "Show two hydrogen bonds in water",
  "Show 2 hydrogen bonds of a water molecule",
  "Show a pair of hydrogen bonds in ammonia",
  "Draw two hydrogen bonds between two molecules of ammonia",
  "How many hydrogen bonds can one water molecule form?",
  // Formula spellings and charges.
  "Hydrogen bond in H2O 2",
  "Hydrogen bond in H2O(2)",
  "Explain the hydrogen bond in HF 2",
  "Explain the hydrogen bond in HF(2)",
  "Hydrogen bonding in ² H₂O",
  "hydrogen bonding in hydronium ion H3O+ in water",
  "hydrogen bonding in water^(+)",
  "hydrogen bonding in NH3+",
  "hydrogen bonding in the ammonium ion",
  "hydrogen bond in the HF2- ion",
  // Negations and false premises.
  "intramolecular hydrogen bonding in water",
  "Water has no hydrogen bonds. True or false?",
  "Water does not form hydrogen bonds. Explain.",
  "Explain hydrogen bonding in HCl.",
  // Another family used to take these when the figure refused.
  "Energy profile of hydrogen bond formation in water",
  "Energy profile of hydrogen bond formation in HF",
  "Draw the energy profile for hydrogen bonding in water",
  "Hydrogen bonding in water is endothermic. Draw the energy profile.",
  "Potential energy diagram of a hydrogen bond in water",
  "Energy profile of hydrogen bond formation",
  "Electron configuration of O in H2O and its hydrogen bonding",
  "Electron configuration of H2O and hydrogen bonding",
  "Orbital box diagram for hydrogen bond in water",
  "Draw the orbital diagram of hydrogen bonding in water",
  "Is liquid water a simple cubic lattice with hydrogen bonds?",
  "Show fcc packing of HF with hydrogen bonds",
  "Electrolysis of pure water without acid, and its hydrogen bonds",
  "Raoult law plot of ammonia and water, hydrogen bonds",
  "Water and ethanol hydrogen bonds Raoult law plot",
  // Hyphens must not skip the guards.
  "Draw the orbital diagram for hydrogen-bonding in water.",
  "Draw an exothermic energy profile for hydrogen-bond formation.",
  "Draw the energy profile for H-bond formation in water.",
  "Draw the hydrogen-bonded dimer of acetic acid.",
  "Draw the hydrogen-bonding in o-nitrophenol.",
  "Hydrogen-bond between ethanol and water",
  // Hafnium, whatever case it loses later.
  "Does Hf form hydrogen bonds?",
  // One acetic acid is not a dimer, and one methanol is not two.
  "Draw the dimer of acetic acid formed by hydrogen bonds.",
  "Draw acetic acid dimer with hydrogen bonds.",
  "Why do carboxylic acids exist as dimers? Show the structure of benzoic acid dimer through hydrogen bonding.",
  "Draw two methanol molecules joined by a hydrogen bond.",
  "Draw formamide showing hydrogen bonding between two molecules.",
  // A lone structure, or an arrow to a "?", where the stem needs the bond or a second molecule.
  "Acetic acid forms a pair held by two hydrogen bonds. Draw this.",
  "Ethanol forms hydrogen bonds with itself. Explain.",
  "Acetic acid forms hydrogen bonds. Draw a diagram.",
  "Phenol forms hydrogen bonds. Show this.",
  "Salicylic acid forms an intramolecular hydrogen bond. Draw it.",
  "Draw the structure of ethanol showing hydrogen bonding.",
  "Show how hydrogen bonds form between ethanol molecules.",
  "Explain hydrogen bonding between 2 molecules of ethanol.",
  "Draw the inter-molecular hydrogen bond between methanol molecules.",
  "Draw ethanol molecules joined by hydrogen bonds.",
  "Draw a diagram of hydrogen bonding in ethylene glycol.",
  "Draw a diagram showing intramolecular hydrogen bonding in salicylaldehyde.",
  "Draw the structure of salicylic acid showing the intramolecular hydrogen bond.",
  "Acetic acid exists as a hydrogen-bonded pair in benzene. Draw the pair.",
  "Ethanol molecules form a chain through hydrogen bonds. Draw the chain.",
  "Methanol molecules form a hydrogen bonded network. Draw it.",
  // A partial name reads as a different compound.
  "Explain hydrogen bonding in ortho nitro phenol.",
  "Explain hydrogen bonding in para nitro phenol.",
  "Explain hydrogen bonding in o-nitro phenol and p-nitro phenol.",
  "Why is ortho nitro phenol more volatile than para nitro phenol? Explain with hydrogen bonding.",
  "Explain hydrogen bonding in ortho chloro phenol.",
  "Explain the intramolecular hydrogen bonding in ortho hydroxy benzaldehyde.",
  "Draw the structure of ortho nitro phenol and explain its hydrogen bonding.",
  // A false direction must not get a figure that reads as its verified answer.
  "Why is p-nitrophenol more volatile than o-nitrophenol? Explain with hydrogen bonding.",
  "Why is p-nitrophenol more steam volatile than o-nitrophenol? Explain in terms of hydrogen bonding.",
  "Why is o-nitrophenol more soluble in water than p-nitrophenol? Explain using hydrogen bonding.",
  "Explain why p-nitrophenol is less soluble in water than o-nitrophenol. Explain on the basis of hydrogen bonding.",
  "Why is o-nitrophenol less volatile than p-nitrophenol? Explain with hydrogen bonding.",
  "Why is o-nitrophenol more acidic than p-nitrophenol? Explain with hydrogen bonding.",
  "Why is p-nitrophenol less acidic than o-nitrophenol? Explain in terms of hydrogen bonding.",
  "o-Nitrophenol is less steam volatile than p-nitrophenol. Explain this with hydrogen bonding.",
  "p-Nitrophenol is more volatile than o-nitrophenol. Explain the difference using hydrogen bonding.",
  // Both isomers named, so only the closed pair sentences can refuse these.
  "Compare hydrogen bonding in the anions of o-nitrophenol and p-nitrophenol.",
  "Compare hydrogen bonding in the sodium salts of o-nitrophenol and p-nitrophenol.",
  "Compare hydrogen bonding in the phenoxide ions of o-nitrophenol and p-nitrophenol.",
  "Compare hydrogen bonding in sodium o-nitrophenol and sodium p-nitrophenol.",
  "Compare hydrogen bonding in o-nitrophenol and p-nitrophenol after reaction with NaOH.",
  "Compare hydrogen bonding in the methyl ethers of o-nitrophenol and p-nitrophenol.",
  "Compare hydrogen bonding in tert butyl o-nitrophenol and tert butyl p-nitrophenol.",
  "Draw the hydrogen bonds that o-nitrophenol and p-nitrophenol form with H2O.",
  "Draw the hydrogen bonds that o-nitrophenol and p-nitrophenol form to water molecules.",
  "Show the hydrogen bonds of o-nitrophenol and p-nitrophenol with acetone.",
  "Show the hydrogen bonds of o-nitrophenol and p-nitrophenol with NH3.",
  "Show the hydrogen bonds of o-nitrophenol and p-nitrophenol with alcohols.",
  "Draw the hydrogen bond between o-nitrophenol and p-nitrophenol.",
  "Hydrogen bonding of o-nitrophenol with each other.",
  "Compare hydrogen bonding in the o-nitrophenol anion and the p-nitrophenol anion.",
  "Compare hydrogen bonding in o-nitrophenolate and p-nitrophenolate.",
  "Hydrogen bonding in the conjugate bases of o-nitrophenol and p-nitrophenol.",
  "Compare hydrogen bonding in 4-chloro-o-nitrophenol and 4-chloro-p-nitrophenol.",
  "Compare hydrogen bonding in 5-methyl o-nitrophenol and 3-methyl p-nitrophenol.",
  "Draw the hydrogen bonds of o-nitrophenol and p-nitrophenol with water.",
  "Show the hydrogen bond between water and o-nitrophenol, and between water and p-nitrophenol.",
  // Nitrophenol asks that figure would answer wrongly.
  "Can p-nitrophenol molecules form hydrogen bonds with each other?",
  "Does p-nitrophenol form hydrogen bonds?",
  "Draw the hydrogen bonds among p-nitrophenol molecules.",
  "Show inter-molecular hydrogen bonding in p-nitrophenol.",
  "Draw the hydrogen bond in the p-nitrophenol dimer.",
  "Which of o- and p-nitrophenol has intramolecular hydrogen bonding?",
  "Explain hydrogen bonding in o- and p-nitrophenol.",
  "Compare hydrogen bonding in ortho and para nitrophenol.",
  "Draw the hydrogen bond between water and o-nitrophenol.",
  "Hydrogen bonding in water and p-nitrophenol.",
  "Does p-nitrophenol form hydrogen bonds with water?",
  "Hydrogen bonding between o-nitrophenol and HF.",
  "Draw the intermolecular hydrogen bond between two o-nitrophenol molecules.",
  "Hydrogen bonding in the o-nitrophenol anion.",
  "Hydrogen bonding in the conjugate base of o-nitrophenol.",
  "Hydrogen bonding in deprotonated p-nitrophenol.",
  "Draw the sodium salt of o-nitrophenol and its hydrogen bonds.",
  "Hydrogen bonding in 4-chloro o-nitrophenol.",
  "Show the hydrogen bond between o-nitrophenol and water",
  "Show the hydrogen bond between p-nitrophenol and water",
  "hydrogen bond in ortho nitrophenol and water",
  "Hydrogen bonding in the o-nitrophenolate ion",
  "Hydrogen bonding in p-nitrophenolate",
  "Show the hydrogen bond in 5-methyl-o-nitrophenol",
  "Show the hydrogen bond in 3-chloro-p-nitrophenol",
  "Show the intermolecular hydrogen bond in p-nitrophenol",
  "Show the intermolecular hydrogen bond between two p-nitrophenol molecules",
];
for (const question of DECLINES) {
  check(`declines everywhere: ${question}`, () => {
    assert.equal(buildLewisScene(question, [], false), null, "the Lewis figure drew");
    const scene = synthesizeFamilyScene({ question }) ?? synthesizeLastResortScene({ question });
    assert.equal(scene, null, `${scene?.family ?? ""} took the turn`);
  });
}
// A hyphen or "H-bond" reaches the plain Lewis route, not the hydrogen bond builder, so only the family guard stops it.
for (const question of [
  "Draw Lewis structures to show the hydrogen-bond between two water molecules.",
  "Explain the Lewis structure of water and show the H-bond between two water molecules.",
  "Compare the O-H bond length with the hydrogen-bond length in water.",
]) {
  check(`no plain Lewis figure for: ${question}`, () => {
    const scene = synthesizeFamilyScene({ question }) ?? synthesizeLastResortScene({ question });
    assert.equal(scene, null, `${scene?.family ?? ""} took the turn`);
  });
}

// Methane forms no hydrogen bond, so the figure must not draw one. A lone true CH4 stays, as on dev.
check("no hydrogen bond drawn for methane", () => {
  assert.equal(buildLewisScene("Explain hydrogen bonding in methane.", [], false), null);
  assert.ok(!(synthesizeFamilyScene({ question: "Explain hydrogen bonding in methane." })?.renderScene.primitives ?? [])
    .some((primitive) => primitive.kind === "label" && primitive.text === "hydrogen bond"), "a hydrogen bond was labelled");
});

// Yielding moves figures, never routing, and only where the Lewis figure led. A family that
// answers the question keeps it when the hydrogen bond only gives the reason.
for (const [question, family] of [
  ["Draw the structure of phenol.", "chem_organic"],
  ["Energy profile diagram of an exothermic reaction with Ea = 50 kJ/mol and ΔH = -20 kJ/mol.", "chem_thermo"],
  ["Explain why a mixture of chloroform and acetone shows negative deviation from Raoult's law in terms of hydrogen bonding. Sketch the vapour pressure against mole fraction graph.", "chem_solutions"],
  ["A mixture of phenol and aniline shows negative deviation because of hydrogen bonding. Draw the vapour pressure composition graph.", "chem_solutions"],
  ["Sketch positive deviation from Raoult's law. Why does breaking hydrogen bonds in ethanol cause it?", "chem_solutions"],
  ["What is the shape of NH3? Does it form hydrogen bonds?", "chem_vsepr"],
  ["Draw the VSEPR shape of H2O and explain why it can make hydrogen bonds.", "chem_vsepr"],
  ["Draw the structure of ethanol. Why does it form hydrogen bonds?", "chem_organic"],
  ["Draw the structure of acetone. Can it act as a hydrogen bond acceptor?", "chem_organic"],
  // Not the ortho or para isomers this figure draws.
  ["Draw the structure of m-nitrophenol and explain its hydrogen bonding.", "chem_organic"],
  ["Draw the structure of 2,4-dinitrophenol and explain its hydrogen bonding.", "chem_organic"],
] as const) {
  check(`keeps its own figure: ${question}`, () => assert.equal(synthesizeFamilyScene({ question })?.family, family));
}
// A covalent bond to hydrogen is not a hydrogen bond: "C-H bond" must not trip any guard.
check("covalent X-H bonds are not hydrogen bond asks", () => {
  for (const stem of ["sigma c-h bonds in ethene", "the o-h bond in ethanol", "n-h bonds in methanamine", "s-h bond", "h-h bond in h2", "c-h bond"]) {
    assert.equal(mentionsHydrogenBond(stem), false, stem);
  }
  for (const stem of ["h-bond in water", "an h-bond", "(h-bond)", "hydrogen-bond", "hydrogen bond", "hydrogen bonding"]) {
    assert.equal(mentionsHydrogenBond(stem), true, stem);
  }
});
for (const [question, family] of [
  ["How many hyperconjugation structures involving C-H bonds can be written for the tert-butyl carbocation, (CH3)3C+, and for propene, CH3-CH=CH2? Which of the two is stabilised more by hyperconjugation?", "chem_organic"],
  ["How many O-H bonds does ethanol have? Draw its structure.", "chem_organic"],
  ["How many sigma C-H bonds does ethene have? Draw its structure.", "chem_organic"],
  ["lewis structure of water showing its O-H bonds", "chem_lewis"],
] as const) {
  check(`an X-H bond keeps its figure: ${question}`, () => assert.equal(synthesizeFamilyScene({ question })?.family, family));
}
check("declined asks keep their chemistry route and family inference", () => {
  const question = "Energy profile of hydrogen bond formation in water";
  assert.equal(isChemistryQuestion(question), true);
  assert.deepEqual(inferChemistryFamilies(question), ["chem_lewis", "chem_thermo"]);
});

// The nitrophenol figures are a separate branch: a plain comparison must not move.
for (const question of [
  "o-Nitrophenol is steam volatile but p-nitrophenol is not. Explain this difference in terms of hydrogen bonding.",
  "Why is o-nitrophenol less soluble in water than p-nitrophenol? Explain with hydrogen bonding.",
  "Compare the hydrogen bonding in o-nitrophenol and p-nitrophenol.",
  "Why is p-nitrophenol less volatile than o-nitrophenol? Explain using intramolecular and intermolecular hydrogen bonding.",
  "Explain the difference in hydrogen bonding of ortho nitrophenol and para nitrophenol.",
]) {
  check(`nitrophenol still draws: ${question}`, () => {
    const document = buildLewisScene(question, [], false);
    assert.ok(document, "declined");
    const labels = document.entities.map((entity) => entity.label);
    assert.ok(labels.includes("intra") && labels.includes("no intra") && labels.includes("inter"), "intra and inter labels");
  });
}

check("one ortho draws for a plain ask about its own bond", () => {
  const document = buildLewisScene("Explain the intramolecular hydrogen bonding in o-nitrophenol.", [], false);
  assert.ok(document, "declined");
  assert.ok(document.entities.some((entity) => entity.label === "intra"), "no intra label");
});

// The subset: on stems mentioning a hydrogen bond, head draws only where dev drew, in the same family.
// Dev's family for each stem is recorded in the fixture. The drawing itself may be corrected.
{
  let drawn = 0;
  for (const [question, devFamily] of subsetFixture.rows as Array<[string, string | null]>) {
    const family = (synthesizeFamilyScene({ question }) ?? synthesizeLastResortScene({ question }))?.family ?? null;
    if (family === null) continue;
    drawn += 1;
    check(`subset of dev: ${question}`, () => assert.equal(family, devFamily, `head draws ${family}, dev drew ${devFamily}`));
  }
  check("the subset check covered figures, not only declines", () => assert.ok(drawn >= 100, `only ${drawn} drawn`));
}

// A stem that does not mention a hydrogen bond meets no guard here, so its figure cannot move.
check("stems with no hydrogen bond mention meet no guard", () => {
  const rows = readFileSync(new URL("../../../../data/diagram-eval/v1/chemistry.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean);
  let unmentioned = 0;
  for (const line of rows) {
    const stem = chemStem((JSON.parse(line) as { question: string }).question);
    if (mentionsHydrogenBond(stem)) continue;
    unmentioned += 1;
    assert.equal(hydrogenBondFigureLeads(stem), false, stem);
    assert.equal(organicStructureCannotAnswer(stem), false, stem);
    assert.equal(hydrogenBondSpelledPastLewis(stem), false, stem);
  }
  assert.ok(unmentioned > 400, `only ${unmentioned} stems`);
});

console.log(`verify-chemistry-hbond-molecules: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
