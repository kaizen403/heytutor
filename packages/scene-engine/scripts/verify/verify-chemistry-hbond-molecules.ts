/**
 * A hydrogen bond figure draws whole molecules, with the hydrogens the formula
 * gives, and only for a plain ask about one species. It used to draw one O-H
 * under the label H2O, and drew a pair of ammonia or water for any stem naming
 * them, including "ammonia in water" and "DNA base pairs in water".
 *
 *   tsx --tsconfig ../../apps/tutor/tsconfig.json scripts/verify/verify-chemistry-hbond-molecules.ts
 */
import assert from "node:assert/strict";
import { buildLewisScene } from "../../src/chemistry/lewis";
import { parseFormula } from "../../src/chemistry/formula";
import { buildOrganicScene } from "../../src/chemistry/organic";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";

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

function pointOf(document: SceneDocument, id: string): { x: number; y: number } {
  const construction = document.constructions.find((value) => value.outputs.includes(id));
  assert.ok(construction, `no construction for ${id}`);
  if (construction.operator === "label") return pointOf(document, String(construction.inputs.target));
  assert.equal(construction.operator, "point", `${id} is not a point`);
  return { x: Number(construction.inputs.x), y: Number(construction.inputs.y) };
}

function isAtom(document: SceneDocument, id: string, heavy: string): boolean {
  return document.entities.find((entity) => entity.id === id)?.label === heavy;
}

function atomsOf(document: SceneDocument, symbol: string): string[] {
  return document.entities.filter((entity) => entity.label === symbol).map((entity) => entity.id);
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** What the figure says, read from its geometry: bonds to each heavy atom, never from the labels alone. */
function bondedHydrogens(document: SceneDocument, heavyId: string, hydrogens: readonly string[]): string[] {
  const heavy = pointOf(document, heavyId);
  return hydrogens.filter((id) => {
    if (document.entities.find((entity) => entity.id === id)?.label !== "H") return false;
    const at = pointOf(document, id);
    return document.entities.some((entity) => {
      if (entity.kind !== "segment" || !String(entity.role ?? "").endsWith("-H bond")) return false;
      const ends = (document.constructions.find((value) => value.outputs.includes(entity.id))?.inputs ?? {}) as Record<string, unknown>;
      const [start, end] = [ends.start ?? ends.from ?? ends.a, ends.end ?? ends.to ?? ends.b].map((value) => pointOf(document, String(value)));
      const onHeavy = distance(start!, heavy) < 0.5 || distance(end!, heavy) < 0.5;
      const onHydrogen = distance(start!, at) < 0.5 || distance(end!, at) < 0.5;
      return onHeavy && onHydrogen;
    });
  });
}

// Plain asks: the figure draws and each molecule has its formula's hydrogens.
const DRAWS: ReadonlyArray<{ question: string; formula: string; heavy: string; label: string }> = [
  { question: "hydrogen bonding in water", formula: "H2O", heavy: "O", label: "H_2O" },
  { question: "Draw the hydrogen bond between two water molecules.", formula: "H2O", heavy: "O", label: "H_2O" },
  { question: "show hydrogen bonding in H2O", formula: "H2O", heavy: "O", label: "H_2O" },
  { question: "show hydrogen bonding in H₂O", formula: "H2O", heavy: "O", label: "H_2O" },
  { question: "Why does water form hydrogen bonds? Draw a diagram.", formula: "H2O", heavy: "O", label: "H_2O" },
  { question: "hydrogen bonding in liquid water", formula: "H2O", heavy: "O", label: "H_2O" },
  { question: "hydrogen bonding in ammonia", formula: "NH3", heavy: "N", label: "NH_3" },
  { question: "Draw hydrogen bonds between NH3 molecules.", formula: "NH3", heavy: "N", label: "NH_3" },
  { question: "Show the intermolecular hydrogen bond in ammonia.", formula: "NH3", heavy: "N", label: "NH_3" },
  { question: "hydrogen bonding in HF", formula: "HF", heavy: "F", label: "HF" },
  { question: "Show the intermolecular hydrogen bond in hydrogen fluoride.", formula: "HF", heavy: "F", label: "HF" },
];

for (const row of DRAWS) {
  const document = buildLewisScene(row.question, [], false);
  const expected = parseFormula(row.formula)?.atoms.find((atom) => atom.symbol === "H")?.count ?? 0;
  check(`draws: ${row.question}`, () => assert.ok(document, "declined"));
  if (!document) continue;
  check(`hydrogens from the formula: ${row.question}`, () => {
    const hydrogens = atomsOf(document, "H");
    assert.equal(hydrogens.length, expected * 2, `${hydrogens.length} H drawn for two ${row.formula}`);
    assert.ok(isAtom(document, "a_x", row.heavy) && isAtom(document, "b_x", row.heavy), "heavy atoms");
    assert.equal(bondedHydrogens(document, "a_x", hydrogens).length, expected, "donor molecule");
    assert.equal(bondedHydrogens(document, "b_x", hydrogens).length, expected, "acceptor molecule");
  });
  check(`hydrogen bond runs from H to the other heavy atom: ${row.question}`, () => {
    const link = document.entities.find((entity) => entity.id === "hb");
    assert.ok(link && link.provenance?.dashed !== false, "dashed link");
    assert.ok(distance(pointOf(document, "a_h"), pointOf(document, "b_x")) > 1, "not a covalent distance");
  });
  check(`no two atoms collide: ${row.question}`, () => {
    const atoms = [...atomsOf(document, "H"), "a_x", "b_x"].map((id) => pointOf(document, id));
    for (let i = 0; i < atoms.length; i += 1) for (let j = i + 1; j < atoms.length; j += 1) {
      assert.ok(distance(atoms[i]!, atoms[j]!) > 0.8, `atoms ${i} and ${j} are ${distance(atoms[i]!, atoms[j]!).toFixed(2)} apart`);
    }
  });
  check(`compiles and names the species: ${row.question}`, () => {
    const compiled = compileSceneDocument(document);
    const labels = compiled.renderScene.primitives.filter((p) => p.kind === "label" && p.text).map((p) => p.text);
    assert.ok(labels.includes(row.label), `no ${row.label} label`);
    assert.ok(labels.includes("inter"), "no inter label");
    assert.ok(!compiled.report.issues.some((issue) => issue.severity === "fatal"), "fatal compile issue");
  });
  check(`family path draws it: ${row.question}`, () => {
    assert.equal(synthesizeFamilyScene({ question: row.question })?.family, "chem_lewis");
  });
}

// HF has one hydrogen, so its figure was already true: it must not change.
check("HF stays one hydrogen per molecule", () => {
  const document = buildLewisScene("hydrogen bonding in HF", [], false);
  assert.ok(document);
  assert.deepEqual(atomsOf(document, "H").sort(), ["a_h", "b_h"]);
});

// Water's drawn angle stays near the true one, on both molecules.
check("water angles read as bent", () => {
  const document = buildLewisScene("hydrogen bonding in water", [], false);
  assert.ok(document);
  for (const [centre, first, second] of [["a_x", "a_h", "a_h2"], ["b_x", "b_h", "b_h2"]] as const) {
    const o = pointOf(document, centre);
    const [a, b] = [pointOf(document, first), pointOf(document, second)];
    const angle = Math.abs(Math.atan2(a.y - o.y, a.x - o.x) - Math.atan2(b.y - o.y, b.x - o.x)) * 180 / Math.PI;
    const inner = angle > 180 ? 360 - angle : angle;
    assert.ok(inner > 95 && inner < 115, `${centre} H-O-H is ${inner.toFixed(1)} degrees`);
  }
});

// Anything but a plain ask about one species: this figure must not answer it.
const DECLINES: readonly string[] = [
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
  "intramolecular hydrogen bonding in water",
  "Water has no hydrogen bonds. True or false?",
  "Water does not form hydrogen bonds. Explain.",
  "Water boils higher than H2Se because of hydrogen bonding. Explain.",
  "Why does H2S not form hydrogen bonds but water does?",
  "Water boils far above hydrogen sulfide. Explain the difference using hydrogen bonding, and say why H2S does not form hydrogen bonds of the same kind.",
  "How many hydrogen bonds can one water molecule form?",
  "hydrogen bonding in hydronium ion H3O+ in water",
  "hydrogen bonding in water^(+)",
  "hydrogen bonding in NH3+",
  "hydrogen bonding in the ammonium ion",
  "hydrogen bond in the HF2- ion",
  "Explain hydrogen bonding in methane.",
  "Explain hydrogen bonding in HCl.",
];
for (const question of DECLINES) {
  check(`declines: ${question}`, () => assert.equal(buildLewisScene(question, [], false), null));
}

// A refused figure must not hand the turn to a lone structure of the other compound.
for (const question of [
  "Show the hydrogen bond between phenol and water.",
  "Hydrogen bonds between glucose and water molecules.",
  "Draw the hydrogen bond between ethanol and water.",
  "Show hydrogen bonds between methanol molecules.",
  "Does methane form hydrogen bonds with water?",
  "hydrogen bonding in acetic acid dimer in water",
]) {
  check(`no runner up: ${question}`, () => {
    assert.equal(buildOrganicScene(question, [], false), null, "organic drew a lone structure");
    assert.equal(synthesizeFamilyScene({ question }) ?? null, null, "another family took the turn");
  });
}
// The organic decline is only for hydrogen bond asks.
check("organic still draws a plain structure ask", () => {
  assert.ok(buildOrganicScene("Draw the structure of phenol.", [], false), "phenol declined");
});

// The nitrophenol figures are a separate branch and must not move.
check("nitrophenol still draws", () => {
  const document = buildLewisScene("o-Nitrophenol is steam volatile but p-nitrophenol is not. Explain this difference in terms of hydrogen bonding.", [], false);
  assert.ok(document, "declined");
  const labels = document.entities.map((entity) => entity.label);
  assert.ok(labels.includes("intra") && labels.includes("no intra") && labels.includes("inter"), "intra and inter labels");
});

console.log(`verify-chemistry-hbond-molecules: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
