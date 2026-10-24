/**
 * A charge the stem writes apart from the formula ("NO2 -", "O2 2-",
 * "Cu 2+", "Na +", "O2+1", "O2 (2-)") is one a builder that reads only the
 * attached spelling drops, and it would draw the neutral species under a
 * question about the ion. Every chemistry builder that reads species from
 * the stem declines unless each written charge is carried by a species it
 * read (chargeMarker.ts finds the charges, speciesChargeGuard.ts matches them).
 *
 *   tsx scripts/verify/verify-chemistry-spaced-charge.ts [--root <scene-engine dir>] [--no-mutants] [--json]
 *
 * Checks:
 *  - decline: each reproduction stem from the #284, #286 and #287 reviews
 *    (and the same misread in the periodic, hydrogen bond and hydrogenic
 *    builders) draws nothing in any chemistry builder, plain or schematic,
 *    and nothing on the family path. Every row drew a neutral figure on
 *    origin/main.
 *  - attached: the attached spellings still draw, and the figure is right
 *    for the charged species: Lewis electron totals, MO bond orders, VSEPR
 *    lone pairs and configurations are recomputed here from the formula.
 *  - control: hyphens that are not charges (C-H bond, 2-methylpropane,
 *    sp3-hybridised, pH 3-4, O2 -> O3) carry no charge marker and draw.
 *  - mutants: the script reruns itself on a copy of src with the shared
 *    reader switched off, and with each builder's guard switched off one at
 *    a time; each mutant must turn that builder's decline rows red.
 *
 * Fixture values are oracles only; no builder reads them.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "../..");
const argv = process.argv.slice(2);
const rootFlag = argv.indexOf("--root");
const root = rootFlag >= 0 ? resolve(argv[rootFlag + 1]!) : packageRoot;
const jsonOut = argv.includes("--json");
const withMutants = !argv.includes("--no-mutants") && rootFlag < 0;

await import(`${root}/src/chemistry/families.ts`);
const { CHEMISTRY_SCENE_FAMILIES, chemistryFamilyBuilder } = await import(`${root}/src/chemistry/index.ts`);
const { synthesizeFamilyScene } = await import(`${root}/src/synthesize/familyScene.ts`);
// Both readers are absent on origin/main: the rows then fail on what the builders draw, not on an import.
const markerModule = await import(`${root}/src/chemistry/chargeMarker.ts`).catch(() => null);
const readChargeMarkers: ((text: string) => unknown[]) | null = markerModule?.readChargeMarkers ?? null;
const guardModule = await import(`${root}/src/chemistry/speciesChargeGuard.ts`).catch(() => null);
const readWrittenCharges: ((text: string) => unknown[]) | null = guardModule?.readWrittenCharges ?? null;

type Doc = { entities: Array<{ label?: string }>; annotations: Array<{ text?: string }> };

/** Every text the figure shows: entity labels and callouts. */
function texts(document: Doc): string[] {
  return [...document.entities.map((entity) => entity.label ?? ""), ...document.annotations.map((note) => note.text ?? "")].filter(Boolean);
}

/** Builders that draw the stem, plain or schematic. */
function drawingBuilders(question: string): string[] {
  const out: string[] = [];
  for (const family of CHEMISTRY_SCENE_FAMILIES as readonly string[]) {
    for (const schematic of [false, true]) {
      const document = chemistryFamilyBuilder(family)!(question, [], schematic);
      if (document) out.push(`${family}${schematic ? "/schematic" : ""}`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ oracles */

const VALENCE: Record<string, number> = { H: 1, He: 2, B: 3, C: 4, N: 5, O: 6, F: 7, S: 6, Se: 6, Cl: 7, P: 5 };
const Z: Record<string, number> = { H: 1, He: 2, Li: 3, N: 7, O: 8, Ne: 10, Na: 11, Mg: 12, Al: 13, Ar: 18, Fe: 26, Cu: 29 };
const CORE: Record<string, number> = { "[He]": 2, "[Ne]": 10, "[Ar]": 18 };

/** Atom counts of a plain formula body: NO2 -> {N: 1, O: 2}. */
function atoms(body: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [, symbol, count] of body.matchAll(/([A-Z][a-z]?)(\d*)/g)) out.set(symbol!, (out.get(symbol!) ?? 0) + Number(count || "1"));
  return out;
}

function valenceTotal(body: string, charge: number): number {
  let total = 0;
  for (const [symbol, count] of atoms(body)) total += VALENCE[symbol]! * count;
  return total - charge;
}

/** Bond order of a homonuclear or period 2 diatomic from its electron count: bonding and antibonding fill in pairs of shells. */
function bondOrder(body: string, charge: number): number {
  let electrons = -charge;
  for (const [symbol, count] of atoms(body)) electrons += Z[symbol]! * count;
  const shells: Array<[number, 1 | -1]> = electrons <= 4 ? [[2, 1], [2, -1]] : [[2, 1], [2, -1], [2, 1], [2, -1], [6, 1], [6, -1]];
  let left = electrons; let order = 0;
  for (const [size, sign] of shells) { const take = Math.min(size, left); order += sign * take; left -= take; }
  return order / 2;
}

/** Lone pairs on the centre by the VSEPR count: valence, less charge, less one per H or halogen and two per O. */
function centralLonePairs(central: string, ligands: Record<string, number>, charge: number): number {
  let electrons = VALENCE[central]! - charge;
  for (const [symbol, count] of Object.entries(ligands)) electrons -= (symbol === "O" || symbol === "S" ? 2 : 1) * count;
  return electrons / 2;
}

/** Electrons a written configuration holds: [Ar] 3d^9 -> 27. */
function configurationElectrons(text: string): number {
  const core = /^\[(\w+)\]/.exec(text);
  let total = core ? CORE[`[${core[1]}]`]! : 0;
  for (const [, count] of text.matchAll(/\d[spdf]\^(\d+)/g)) total += Number(count);
  return total;
}

/* --------------------------------------------------------------------- rows */

interface DeclineRow { readonly id: string; readonly question: string; readonly owners: readonly string[]; readonly words?: true }

/** Stems from the reviews (pr-284, pr-286, pr-287) plus the same misread in the other builders. `owners` drew the neutral species on origin/main. */
const DECLINE: readonly DeclineRow[] = [
  { id: "287-shape-NO2-space-minus", question: "shape of NO2 -", owners: ["chem_vsepr"] },
  { id: "287-shape-SO3-space-2minus", question: "shape of SO3 2-", owners: ["chem_vsepr"] },
  { id: "287-shape-the-SO3-ion", question: "shape of the SO3 2- ion", owners: ["chem_vsepr"] },
  { id: "287-shape-SeO3", question: "shape of SeO3 2-", owners: ["chem_vsepr"] },
  { id: "287-shape-SO3-sign-first", question: "shape of SO3 -2", owners: ["chem_vsepr"] },
  { id: "287-shape-SO3-unicode-minus", question: "shape of SO3 2−", owners: ["chem_vsepr"] },
  { id: "284-hybridisation-NO2", question: "hybridisation of NO2 -", owners: ["chem_vsepr"] },
  { id: "284-config-Cu-2plus", question: "electron configuration of Cu 2+", owners: ["chem_orbital"] },
  { id: "284-config-Na-plus", question: "electron configuration of Na +", owners: ["chem_orbital"] },
  { id: "284-mo-O2-plus1", question: "MO diagram of O2+1", owners: ["chem_mo"] },
  { id: "284-mo-O2-space-minus", question: "MO diagram of O2 -", owners: ["chem_mo"] },
  { id: "284-mo-O2-bracket", question: "MO diagram of O2 (2-)", owners: ["chem_mo"] },
  { id: "284-bond-order-O2-2minus", question: "bond order of O2 2-", owners: ["chem_mo"] },
  { id: "284-bond-order-N2-minus", question: "bond order of N2 -", owners: ["chem_mo"] },
  { id: "284-lewis-NO2", question: "lewis structure of NO2 -", owners: ["chem_lewis", "chem_vsepr"] },
  { id: "286-draw-lewis-NO2", question: "draw the lewis structure of NO2 -", owners: ["chem_lewis", "chem_vsepr"] },
  { id: "286-lewis-O2-2minus", question: "lewis structure of O2 2-", owners: ["chem_lewis"] },
  { id: "brief-mo-O2-2minus", question: "MO diagram of O2 2-", owners: ["chem_mo"] },
  { id: "orbital-box-Fe-3plus", question: "orbital box diagram of Fe 3+", owners: ["chem_orbital"] },
  { id: "periodic-position-Na-plus", question: "position of Na + in the periodic table", owners: ["chem_periodic"] },
  { id: "hbond-HF2-minus", question: "Explain hydrogen bonding in HF and the HF2 - ion", owners: ["chem_lewis"] },
  { id: "hbond-NH4-plus", question: "Show hydrogen bonding between NH4 + and water", owners: ["chem_lewis"] },
  { id: "hydrogenic-He-plus", question: "Draw the radial probability distribution for the 2s orbital of He +", owners: ["chem_orbital"] },
  { id: "hydrogenic-Li-2plus", question: "Draw the radial probability distribution for the 2s orbital of Li2+", owners: ["chem_orbital"] },
  // A second clause writes the ion of the species the first one asks for.
  { id: "clauses-lewis-NO2-then-NO2-minus", question: "Draw the Lewis structure of NO2. Then draw it for NO2 -.", owners: ["chem_lewis"] },
  { id: "clauses-shape-SO3-compare-SO3-2minus", question: "What is the shape of SO3? Compare it with SO3 2-.", owners: ["chem_vsepr"] },
  { id: "clauses-mo-O2-compare-O2-minus", question: "MO diagram of O2; compare O2 minus", owners: ["chem_mo"], words: true },
  // Review threads on #304: a phrase belongs to its own formula, a compared ion still counts, a counted phrase keeps its count.
  { id: "thread-phrase-owner-O2-vs-N2-minus", question: "MO diagram of N2-. Draw O2 with charge -1.", owners: ["chem_mo"], words: true },
  { id: "hydrogenic-thread-compared-He-plus", question: "Draw the radial probability distribution for the 2s orbital of He+. Compare with H.", owners: ["chem_orbital"] },
  { id: "thread-double-negative-O2-minus", question: "MO diagram of O2- with a double negative charge", owners: ["chem_mo"], words: true },
  // Round 2: each occurrence is judged where it stands, so an excluded mention cannot hide a later request.
  { id: "thread-later-request-NO2-minus", question: "Draw the Lewis structure of NO2, not NO2 minus. Then draw NO2 minus.", owners: ["chem_lewis"], words: true },
  { id: "later-request-NO2-sign", question: "Draw the Lewis structure of NO2, not NO2 -. Then draw NO2 -.", owners: ["chem_lewis"] },
  // Round 4: a phrase binds to its own owner's reading; another occurrence cannot satisfy it.
  { id: "thread-phrase-other-occurrence-O2-2minus", question: "MO diagram of O2- with a double negative charge. Compare with O2^2-.", owners: ["chem_mo"], words: true },
  { id: "phrase-bare-owner-other-occurrence", question: "MO diagram of O2 with charge -1. Compare with O2-.", owners: ["chem_mo"], words: true },
  // Charges in words and Roman numerals (pr-284-delta, pr-286-delta): no sign for the shared reader.
  { id: "words-shape-SO3-two-minus", question: "shape of SO3 two minus", owners: ["chem_vsepr"], words: true },
  { id: "words-shape-SO3-minus-2", question: "shape of SO3 minus 2", owners: ["chem_vsepr"], words: true },
  { id: "words-shape-NO2-minus", question: "shape of NO2 minus", owners: ["chem_vsepr"], words: true },
  { id: "words-hybridisation-NO2-minus", question: "hybridisation of NO2 minus", owners: ["chem_vsepr"], words: true },
  { id: "words-shape-NO2-negative", question: "shape of NO2 negative", owners: ["chem_vsepr"], words: true },
  { id: "words-shape-NO2-negative-charge", question: "shape of NO2 with a negative charge", owners: ["chem_vsepr"], words: true },
  { id: "words-shape-NO2-charge-minus-1", question: "shape of NO2 with charge -1", owners: ["chem_vsepr"], words: true },
  { id: "words-config-Cu-II", question: "electron configuration of Cu II", owners: ["chem_orbital"], words: true },
  { id: "words-mo-O2-minus", question: "MO diagram of O2 minus", owners: ["chem_mo"], words: true },
  { id: "words-config-Na-plus", question: "electron configuration of Na plus", owners: ["chem_orbital"], words: true },
  { id: "words-lewis-NO2-minus", question: "lewis structure of NO2 minus", owners: ["chem_lewis", "chem_vsepr"], words: true },
  { id: "words-draw-lewis-NO2-minus", question: "draw the lewis structure of NO2 minus", owners: ["chem_lewis", "chem_vsepr"], words: true },
  { id: "words-lewis-NO2-negative", question: "lewis structure of NO2 negative", owners: ["chem_lewis", "chem_vsepr"], words: true },
  { id: "words-bond-order-N2-plus", question: "bond order of N2 plus", owners: ["chem_mo"], words: true },
];

/** Which guard each owner's rows depend on, for the per-builder mutants. */
const GUARD_FILES: Record<string, { file: string; call: string; to?: string; also?: { call: string; to: string }; rows: (row: DeclineRow) => boolean }> = {
  vsepr: {
    file: "chemistry/vsepr.ts", call: "chargeMarkersCarried(",
    also: { call: "speciesWithWrittenCharges(", to: "((_text: string, species: VseprResult[]) => species)(" },
    rows: (row) => row.owners.includes("chem_vsepr"),
  },
  lewis: { file: "chemistry/lewis.ts", call: "stemChargesRead(", rows: (row) => row.owners.includes("chem_lewis") && !row.id.startsWith("hbond") },
  mo: { file: "chemistry/moDiagram.ts", call: "stemChargesRead(", rows: (row) => row.owners.includes("chem_mo") },
  orbital: { file: "chemistry/orbitalBox.ts", call: "stemChargesRead(", rows: (row) => row.owners.includes("chem_orbital") && !row.id.startsWith("hydrogenic") },
  periodic: { file: "chemistry/periodicTrend.ts", call: "stemChargesRead(", rows: (row) => row.owners.includes("chem_periodic") },
  hbond: { file: "chemistry/bondingFigures.ts", call: "stemChargesRead(", rows: (row) => row.id.startsWith("hbond") },
  hydrogenic: { file: "chemistry/hydrogenicRadial.ts", call: "stemChargesRead(", rows: (row) => row.id.startsWith("hydrogenic") },
};

interface AttachedRow { readonly id: string; readonly question: string; readonly family: string; readonly check: (shown: string[]) => void }

function shownMatch(shown: string[], pattern: RegExp, what: string): RegExpExecArray {
  for (const text of shown) { const match = pattern.exec(text); if (match) return match; }
  throw new Error(`${what} not shown: ${shown.join(" | ").slice(0, 200)}`);
}

function lewisCheck(label: string, body: string, charge: number): (shown: string[]) => void {
  return (shown) => {
    const escaped = label.replace(/[\\^()+]/g, (c) => `\\${c}`);
    const match = shownMatch(shown, new RegExp(`^${escaped}: σ = (\\d+), π = (\\d+), lone pairs = (\\d+)$`), `${label} Lewis counts`);
    const [sigma, pi, lonePairs] = [Number(match[1]), Number(match[2]), Number(match[3])];
    assert.equal(2 * (sigma + pi + lonePairs), valenceTotal(body, charge), `${label}: electrons drawn must be the valence total of the charged species`);
  };
}

function moCheck(label: string, body: string, charge: number): (shown: string[]) => void {
  return (shown) => {
    const match = shownMatch(shown, new RegExp(`^${label.replace(/[\\^()+]/g, (c) => `\\${c}`)}: BO = ([\\d.]+)`), `${label} bond order`);
    assert.equal(Number(match[1]), bondOrder(body, charge), `${label}: bond order of the charged species`);
  };
}

function vseprCheck(formula: string, central: string, ligands: Record<string, number>, charge: number, shape: string): (shown: string[]) => void {
  return (shown) => {
    const match = shownMatch(shown, new RegExp(`^${formula.replace(/[+^()]/g, (c) => `\\${c}`)}: [^,]+, ([a-z. ]+), (\\d+) lone pairs?$`), `${formula} VSEPR caption`);
    assert.equal(match[1], shape, `${formula}: shape`);
    assert.equal(Number(match[2]), centralLonePairs(central, ligands, charge), `${formula}: lone pairs on ${central}`);
  };
}

function configurationCheck(label: string, symbol: string, charge: number, expected: string): (shown: string[]) => void {
  return (shown) => {
    const match = shownMatch(shown, new RegExp(`^${label.replace(/[\\^()+]/g, (c) => `\\${c}`)}: (\\[[A-Za-z]+\\][^,]*)`), `${label} configuration`);
    assert.equal(match[1]!.trim(), expected, `${label}: configuration`);
    assert.equal(configurationElectrons(match[1]!.trim()), Z[symbol]! - charge, `${label}: electrons = Z - charge`);
  };
}

const ATTACHED: readonly AttachedRow[] = [
  { id: "lewis-NO2-minus", question: "lewis structure of NO2-", family: "chem_lewis", check: lewisCheck("NO_2^(-)", "NO2", -1) },
  { id: "lewis-NH4-plus", question: "What is the formal charge on nitrogen in the Lewis structure of NH4+?", family: "chem_lewis", check: lewisCheck("NH_4^(+)", "NH4", 1) },
  { id: "lewis-SO4-caret", question: "Draw the Lewis structure of SO4^2- and state the formal charge on sulphur.", family: "chem_lewis", check: lewisCheck("SO_4^(2-)", "SO4", -2) },
  { id: "lewis-O2-caret", question: "lewis structure of O2^2-", family: "chem_lewis", check: lewisCheck("O_2^(2-)", "O2", -2) },
  { id: "mo-O2-caret-2minus", question: "MO diagram of O2^2-", family: "chem_mo", check: moCheck("O_2^(2-)", "O2", -2) },
  { id: "mo-O2-superoxide", question: "MO diagram of O2-", family: "chem_mo", check: moCheck("O_2^(-)", "O2", -1) },
  { id: "mo-O2-plus", question: "bond order of O2+", family: "chem_mo", check: moCheck("O_2^(+)", "O2", 1) },
  { id: "mo-N2-minus", question: "bond order of N2-", family: "chem_mo", check: moCheck("N_2^(-)", "N2", -1) },
  { id: "mo-He2-plus", question: "bond order of He2+", family: "chem_mo", check: moCheck("He_2^(+)", "He2", 1) },
  { id: "vsepr-SO3-caret", question: "shape of SO3^2-", family: "chem_vsepr", check: vseprCheck("SO3^2-", "S", { O: 3 }, -2, "trigonal pyramidal") },
  { id: "vsepr-NO2-minus", question: "shape of NO2-", family: "chem_vsepr", check: vseprCheck("NO2-", "N", { O: 2 }, -1, "bent") },
  { id: "vsepr-NH4-plus", question: "shape of NH4+", family: "chem_vsepr", check: vseprCheck("NH4+", "N", { H: 4 }, 1, "tetrahedral") },
  { id: "config-Cu-2plus", question: "electron configuration of Cu2+", family: "chem_orbital", check: configurationCheck("Cu^(2+)", "Cu", 2, "[Ar] 3d^9") },
  { id: "config-Fe-3plus", question: "electron configuration of Fe3+", family: "chem_orbital", check: configurationCheck("Fe^(3+)", "Fe", 3, "[Ar] 3d^5") },
  { id: "config-Na-plus", question: "electron configuration of Na+", family: "chem_orbital", check: configurationCheck("Na^(+)", "Na", 1, "[He] 2s^2 2p^6") },
  { id: "roman-Cu-II-bracket", question: "electron configuration of Cu(II)", family: "chem_orbital", check: configurationCheck("Cu^(2+)", "Cu", 2, "[Ar] 3d^9") },
  { id: "roman-Fe-III-bracket", question: "electron configuration of Fe(III)", family: "chem_orbital", check: configurationCheck("Fe^(3+)", "Fe", 3, "[Ar] 3d^5") },
  { id: "roman-copper-II-name", question: "electron configuration of copper(II)", family: "chem_orbital", check: configurationCheck("Cu^(2+)", "Cu", 2, "[Ar] 3d^9") },
  // A negator governing the charged formula sets it aside; nothing else does.
  {
    id: "excluded-ion-not-NO2-minus", question: "Draw the Lewis structure of NO2, not NO2 -.", family: "chem_lewis", check: (shown) => {
      assert.ok(shown.includes("NO_2: σ = 2, π = 1, lone pairs = 5"), "neutral NO2, the species asked");
    },
  },
  { id: "thread-phrase-owner-keeps-charge-Cu", question: "electron configuration of Cu2+ with a charge of +2", family: "chem_orbital", check: configurationCheck("Cu^(2+)", "Cu", 2, "[Ar] 3d^9") },
  // Round 3: an ambiguous attached owner keeps both readings (O2- is superoxide here, He2+ the molecule ion).
  { id: "thread-phrase-owner-O2-minus-both-readings", question: "MO diagram of O2- with a charge of -1", family: "chem_mo", check: moCheck("O_2^(-)", "O2", -1) },
  { id: "thread-phrase-owner-He2-plus-both-readings", question: "bond order of He2+ with a charge of +1", family: "chem_mo", check: moCheck("He_2^(+)", "He2", 1) },
  { id: "phrase-carried-SO4", question: "shape of SO4^2- with a charge of 2-", family: "chem_vsepr", check: vseprCheck("SO4^2-", "S", { O: 4 }, -2, "tetrahedral") },
  // An excluded ion in another clause does not bear on the species read.
  { id: "unrelated-clause-charge", question: "No He+ or Li2+ participate; draw the Lewis structure of H2O.", family: "chem_lewis", check: lewisCheck("H_2O", "H2O", 0) },
  {
    id: "periodic-ionic-radii", question: "Plot the ionic radii of Na+, Mg2+ and Al3+", family: "chem_periodic", check: (shown) => {
      for (const ion of ["Na^+", "Mg^(2+)", "Al^(3+)"]) assert.ok(shown.includes(ion), `${ion} plotted`);
    },
  },
];

interface ControlRow { readonly id: string; readonly question: string; readonly family: string; readonly shows: readonly string[] }

const CONTROL: readonly ControlRow[] = [
  { id: "C-H-bond", question: "Draw the Lewis structure of CH4 and count the C-H bonds.", family: "chem_lewis", shows: ["CH_4: σ = 4, π = 0, lone pairs = 0"] },
  { id: "2-methylpropane", question: "Draw the structure of 2-methylpropane.", family: "chem_organic", shows: ["isobutane"] },
  { id: "sp3-hybridised", question: "What is the shape of CH4? Its carbon is sp3-hybridised.", family: "chem_vsepr", shows: ["CH4: sp3, tetrahedral, 0 lone pairs"] },
  { id: "pH-3-4", question: "Sketch the titration curve of 25 mL of 0.1 M HCl titrated with 0.1 M NaOH and mark where the pH changes from 3-4.", family: "chem_solutions", shows: ["V_eq = 25 mL", "pH = 7"] },
  { id: "O2-arrow-O3", question: "Draw the energy profile for the reaction 3 O2 -> 2 O3 with ΔH = +284 kJ/mol.", family: "chem_thermo", shows: ["3 O_2", "2 O_3"] },
];

/* ------------------------------------------------------------------- checks */

const results: Array<{ id: string; passed: boolean; error?: string }> = [];
function check(id: string, body: () => void): void {
  try { body(); results.push({ id, passed: true }); } catch (error) { results.push({ id, passed: false, error: error instanceof Error ? error.message : String(error) }); }
}

for (const row of DECLINE) {
  check(`decline/${row.id}`, () => {
    if (row.words) { if (readWrittenCharges) assert.ok(readWrittenCharges(row.question).length > 0, "the stem writes a charge in words"); }
    else if (readChargeMarkers) assert.ok(readChargeMarkers(row.question).length > 0, "the stem writes a charge marker");
    assert.deepEqual(drawingBuilders(row.question), [], "no chemistry builder may draw the neutral species");
    assert.equal(synthesizeFamilyScene({ question: row.question }), null, "the family path draws nothing");
  });
}
for (const row of ATTACHED) {
  check(`attached/${row.id}`, () => {
    const scene = synthesizeFamilyScene({ question: row.question });
    assert.ok(scene, "the attached charge still draws");
    assert.equal(scene.family, row.family);
    row.check(texts(scene.document));
  });
}
for (const row of CONTROL) {
  check(`control/${row.id}`, () => {
    if (readChargeMarkers) assert.deepEqual(readChargeMarkers(row.question), [], "a hyphen that is not a charge is no marker");
    if (readWrittenCharges) assert.deepEqual(readWrittenCharges(row.question), [], "and no charge in words");
    const scene = synthesizeFamilyScene({ question: row.question });
    assert.ok(scene, "the control still draws");
    assert.equal(scene.family, row.family);
    const shown = texts(scene.document);
    for (const text of row.shows) assert.ok(shown.includes(text), `${text} shown`);
  });
}

/* ------------------------------------------------------------------ mutants */

/** Run this script on a copy of src with `patch` applied; return the ids that failed. */
function runMutant(name: string, patch: (src: string) => void): string[] {
  const dir = mkdtempSync(join(packageRoot, `.spaced-charge-mutant-${name}-`));
  try {
    cpSync(join(packageRoot, "src"), join(dir, "src"), { recursive: true });
    patch(join(dir, "src"));
    const child = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), "--root", dir, "--json"], { encoding: "utf8", cwd: packageRoot });
    const line = child.stdout.trim().split("\n").pop() ?? "{}";
    const report = JSON.parse(line) as { results?: Array<{ id: string; passed: boolean }> };
    assert.ok(report.results, `mutant ${name} produced no report: ${child.stderr.slice(0, 300)}`);
    return report.results.filter((row) => !row.passed).map((row) => row.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function patchFile(path: string, from: string, to: string): void {
  const text = readFileSync(path, "utf8");
  assert.ok(text.includes(from), `mutation anchor ${from} in ${path}`);
  const next = text.split(from).join(to);
  assert.notEqual(next, text, `mutation of ${path} changed nothing`);
  writeFileSync(path, next);
}

if (withMutants) {
  check("mutant/reader-off", () => {
    const failed = runMutant("reader", (src) => patchFile(join(src, "chemistry/chargeMarker.ts"), "const markers: ChargeMarker[] = [];\n  for (const match of folded.matchAll(SIGN_MARKER)) {", "const markers: ChargeMarker[] = [];\n  for (const match of ([] as RegExpMatchArray[])) {"));
    for (const row of DECLINE.filter((item) => !item.words && !item.id.startsWith("hbond-HF2") && !item.question.includes(" ion"))) {
      assert.ok(failed.includes(`decline/${row.id}`), `reader off must turn decline/${row.id} red`);
    }
  });
  check("mutant/word-reader-off", () => {
    const failed = runMutant("words", (src) => patchFile(join(src, "chemistry/speciesChargeGuard.ts"), "const written = readWrittenCharges(text);", "const written: WrittenCharge[] = [];"));
    for (const row of DECLINE.filter((item) => item.words)) {
      assert.ok(failed.includes(`decline/${row.id}`), `word reader off must turn decline/${row.id} red`);
    }
    const wordIds = new Set(DECLINE.filter((item) => item.words).map((item) => `decline/${item.id}`));
    assert.ok(failed.every((id) => wordIds.has(id)), `word reader off touches only word rows: ${failed.join(", ")}`);
  });
  for (const [name, guard] of Object.entries(GUARD_FILES)) {
    check(`mutant/${name}-guard-off`, () => {
      const failed = runMutant(name, (src) => {
        patchFile(join(src, guard.file), guard.call, "(() => true)(");
        if (guard.also) patchFile(join(src, guard.file), guard.also.call, guard.also.to);
      });
      const owned = DECLINE.filter(guard.rows);
      assert.ok(owned.length > 0, `${name} owns rows`);
      for (const row of owned) assert.ok(failed.includes(`decline/${row.id}`), `${name} guard off must turn decline/${row.id} red`);
      assert.ok(!failed.some((id) => !id.startsWith("decline/")), `${name} guard off must not touch attached or control rows: ${failed.join(", ")}`);
    });
  }
}

const report = {
  scope: "Spaced, sign first and bracketed charges decline in every chemistry builder; attached charges draw and are recomputed; hyphen controls untouched; guard mutants go red.",
  passed: results.filter((row) => row.passed).length,
  failed: results.filter((row) => !row.passed).length,
  results,
};
if (jsonOut) console.log(JSON.stringify(report));
else {
  for (const row of results.filter((item) => !item.passed)) console.error(`FAIL ${row.id}: ${row.error}`);
  console.log(`verify-chemistry-spaced-charge: ${report.passed} passed, ${report.failed} failed`);
}
if (report.failed) process.exitCode = 1;
