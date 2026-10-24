/**
 * Chemistry body identity in the visual-obligation check.
 *
 * ProblemIR names chemistry bodies in model words ("NH3 molecule", "central P
 * atom", "Period 3 elements"). These rows are short authored asks with
 * minimal ProblemIR fixtures in the shape the planner writes; they are not
 * student text. Each positive row must draw through the family loop with its
 * ProblemIR, and each control must keep declining: a species the figure does
 * not draw, a wrong element or centre, a wrong period or group, a missing
 * isomer, an abstract body, a tampered figure, a nonchemistry document.
 *
 * A rebuild proves only the builder's own reading of the stem, and builders
 * draw the neutral species for many charge spellings (SO3 2-, NO2 minus,
 * Cu II, with charge -1). So any charge-like token in the stem (a sign, a
 * superscript, a charge word, a Roman numeral, an ion name; see
 * chargeEvidence.ts) removes the identity: the charge rows decline whether
 * the builder read the charge or not, and bond dashes and hyphens (C-H,
 * sp3-) decline too. The reader table covers every deny item.
 *
 * The final checks copy the engine source and prove this gate goes red on
 * that copy: with the binder call removed; with the charge-like token rule
 * removed (every charge control the builder draws goes red);
 * with the formula key flattening
 * atom counts and charge into one string (so O^(2-) oxide would match an
 * O_2^(-) superoxide figure); and with the key merging repeated atoms (so
 * the isomer CH3OCHO would match a CH3COOH figure).
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "../..");
const engineRoot = process.env.CHEM_OBLIGATION_ENGINE_ROOT ?? join(packageRoot, "src");
const mutant = process.env.CHEM_OBLIGATION_MUTANT === "1";
const engine = await import(pathToFileURL(join(engineRoot, "index.ts")).href) as typeof import("../../src/index");
const { synthesizeFamilyScene, checkVisualObligations, deriveVisualObligations, validateProblemIR } = engine;
type ProblemIR = import("../../src/ir/problemIR").ProblemIR;
type SceneDocument = import("../../src/types").SceneDocument;

let passed = 0;
const failures: string[] = [];
function test(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

type Kind = ProblemIR["entities"][number]["kind"];
interface Body { id: string; kind: Kind; label: string }

function problem(question: string, bodies: readonly Body[], connections: ReadonlyArray<readonly [string, string]> = []): ProblemIR {
  const raw = {
    schemaVersion: "problem-ir/v1",
    id: "problem",
    question,
    facts: [{ id: "fAsk", kind: "requested", statement: `${question} requested`,
      evidence: { source: "question", start: 0, end: question.length, quote: question } }],
    entities: bodies.map((body) => ({ ...body, evidenceFactIds: ["fAsk"] })),
    expressions: [],
    constraints: connections.map(([a, b], index) => ({ id: `bond${index + 1}`, kind: "connected", entityIds: [a, b], evidenceFactIds: ["fAsk"] })),
    representationIntents: [{ id: "iAsk", kind: "conceptual", entityIds: bodies.map((body) => body.id), evidenceFactIds: ["fAsk"] }],
    solveRequests: [],
  };
  const validated = validateProblemIR(raw, question);
  assert.ok(validated.valid && validated.problem, JSON.stringify(validated.issues));
  return validated.problem;
}

function draw(question: string, family: string, ir: ProblemIR | null): string | null {
  return synthesizeFamilyScene({ question, families: [family as never], problemIR: ir ?? undefined })?.family ?? null;
}

const CO2_BODIES: Body[] = [
  { id: "co2", kind: "other", label: "CO2 molecule" },
  { id: "carbon", kind: "point", label: "central carbon atom" },
  { id: "oxygen1", kind: "point", label: "oxygen atom" },
  { id: "oxygen2", kind: "point", label: "oxygen atom" },
];

const SO3_ATOMS: Body[] = [{ id: "s", kind: "point", label: "central S atom" }, { id: "o", kind: "point", label: "oxygen atoms" }];
const NO2_ATOMS: Body[] = [{ id: "n", kind: "point", label: "central N atom" }, { id: "o", kind: "point", label: "oxygen atoms" }];

interface Row { name: string; question: string; family: string; bodies: Body[]; connections?: Array<readonly [string, string]> }

const POSITIVE: Row[] = [
  { name: "shape-nh3", question: "shape of NH3 molecule", family: "chem_vsepr", bodies: [{ id: "nh3", kind: "other", label: "NH3 molecule" }] },
  { name: "geometry-pcl5", question: "geometry of PCl5", family: "chem_vsepr", bodies: [
    { id: "pcl5", kind: "other", label: "PCl5 molecule" },
    { id: "p", kind: "point", label: "central P atom" },
    { id: "cl", kind: "point", label: "Cl atoms" },
  ] },
  { name: "bf3-hybrid", question: "hybridisation of BF3", family: "chem_vsepr", bodies: [
    { id: "bf3", kind: "other", label: "BF3 molecule" },
    { id: "boron", kind: "other", label: "Boron central atom" },
    { id: "fluorine", kind: "other", label: "Fluorine atoms" },
  ] },
  { name: "co2-linear", question: "why is CO2 linear", family: "chem_vsepr", bodies: CO2_BODIES },
  { name: "lewis-co2", question: "lewis structure of CO2", family: "chem_lewis", bodies: CO2_BODIES,
    connections: [["carbon", "oxygen1"], ["carbon", "oxygen2"]] },
  { name: "bond-order-n2", question: "bond order of N2", family: "chem_mo", bodies: [{ id: "n2", kind: "other", label: "N2 molecule" }] },
  { name: "lewis-acetic-acid", question: "Lewis structure of CH3COOH", family: "chem_lewis", bodies: [{ id: "x", kind: "other", label: "CH_3COOH molecule" }] },
  { name: "config-iron", question: "electron configuration of iron", family: "chem_orbital", bodies: [{ id: "fe", kind: "other", label: "iron atom" }] },
  { name: "radius-period-3", question: "trend of atomic radius in period 3", family: "chem_periodic", bodies: [{ id: "p3", kind: "other", label: "Period 3 elements" }] },
  { name: "ie-period-2", question: "ionisation energy trend across period 2", family: "chem_periodic", bodies: [{ id: "p2", kind: "other", label: "Period 2 elements" }] },
  { name: "en-group-17", question: "electronegativity down group 17", family: "chem_periodic", bodies: [{ id: "g17", kind: "other", label: "Group 17 halogens" }] },
  { name: "nh3-counted-hydrogens", question: "shape of NH3 molecule", family: "chem_vsepr", bodies: [
    { id: "nh3", kind: "other", label: "ammonia molecule" },
    { id: "n", kind: "point", label: "central nitrogen atom" },
    { id: "h", kind: "other", label: "three hydrogen atoms" },
  ] },
];

for (const row of POSITIVE) {
  test(`positive ${row.name}: draws ${row.family} with its ProblemIR`, () => {
    assert.equal(draw(row.question, row.family, null), row.family, "the family must draw before ProblemIR is passed");
    assert.equal(draw(row.question, row.family, problem(row.question, row.bodies, row.connections)), row.family);
  });
}

interface Control { name: string; question: string; family: string; bodies: Body[]; connections?: Array<readonly [string, string]>; charge?: true }

const CONTROLS: Control[] = [
  { name: "species the figure does not draw", question: "shape of NH3 molecule", family: "chem_vsepr", bodies: [{ id: "x", kind: "other", label: "PH3 molecule" }] },
  { name: "wrong element as central atom", question: "why is CO2 linear", family: "chem_vsepr", bodies: [{ id: "x", kind: "point", label: "central N atom" }] },
  { name: "terminal element named central", question: "lewis structure of CO2", family: "chem_lewis", bodies: [{ id: "x", kind: "point", label: "central oxygen atom" }] },
  { name: "atom count the figure does not draw", question: "shape of NH3 molecule", family: "chem_vsepr", bodies: [{ id: "x", kind: "other", label: "four hydrogen atoms" }] },
  { name: "plural atoms of a single drawn atom", question: "shape of NH3 molecule", family: "chem_vsepr", bodies: [{ id: "x", kind: "other", label: "nitrogen atoms" }] },
  { name: "three oxygen atoms on CO2", question: "why is CO2 linear", family: "chem_vsepr", bodies: [
    { id: "o1", kind: "point", label: "oxygen atom" }, { id: "o2", kind: "point", label: "oxygen atom" }, { id: "o3", kind: "point", label: "oxygen atom" },
  ] },
  { name: "wrong species on an MO diagram", question: "bond order of N2", family: "chem_mo", bodies: [{ id: "x", kind: "other", label: "O2 molecule" }] },
  { name: "oxide named on a superoxide MO diagram", question: "MO diagram of O2^-", family: "chem_mo", bodies: [{ id: "x", kind: "other", label: "O^(2-) ion" }] },
  { name: "neutral molecule named on an ion MO diagram", question: "MO diagram of O2^-", family: "chem_mo", bodies: [{ id: "x", kind: "other", label: "O2 molecule" }] },
  { name: "peroxide named on a superoxide MO diagram", question: "MO diagram of O2^-", family: "chem_mo", bodies: [{ id: "x", kind: "other", label: "O2^(2-) ion" }] },
  { name: "isomer named on an acetic acid Lewis figure", question: "Lewis structure of CH3COOH", family: "chem_lewis", bodies: [{ id: "x", kind: "other", label: "CH3OCHO molecule" }] },
  { name: "central atom where the family places none", question: "bond order of N2", family: "chem_mo", bodies: [{ id: "x", kind: "point", label: "central nitrogen atom" }] },
  { name: "wrong element on an orbital box figure", question: "electron configuration of iron", family: "chem_orbital", bodies: [{ id: "x", kind: "other", label: "cobalt atom" }] },
  { name: "ion the orbital figure does not draw", question: "electron configuration of iron", family: "chem_orbital", bodies: [{ id: "x", kind: "other", label: "Fe3+ ion" }] },
  { name: "wrong period", question: "trend of atomic radius in period 3", family: "chem_periodic", bodies: [{ id: "x", kind: "other", label: "Period 2 elements" }] },
  { name: "wrong group", question: "electronegativity down group 17", family: "chem_periodic", bodies: [{ id: "x", kind: "other", label: "Group 16 elements" }] },
  { name: "group number contradicting its family name", question: "electronegativity down group 17", family: "chem_periodic", bodies: [{ id: "x", kind: "other", label: "Group 1 halogens" }] },
  { name: "period set on a group plot", question: "electronegativity down group 17", family: "chem_periodic", bodies: [{ id: "x", kind: "other", label: "Period 2 elements" }] },
  { name: "abstract body on a molecule", question: "shape of NH3 molecule", family: "chem_vsepr", bodies: [{ id: "x", kind: "other", label: "VSEPR theory" }] },
  { name: "energy levels stay unbound", question: "MO diagram of O2", family: "chem_mo", bodies: [
    { id: "o2", kind: "other", label: "O2 molecule" }, { id: "levels", kind: "field", label: "molecular orbital energy levels" },
  ] },
  { name: "a property stays unbound", question: "trend in first ionisation energy down group 1", family: "chem_periodic", bodies: [
    { id: "g1", kind: "other", label: "Group 1 alkali metals" }, { id: "ie", kind: "state", label: "first ionisation energy" },
  ] },
  { name: "bonds as bodies stay unbound", question: "sigma and pi bonds in ethene", family: "chem_lewis", bodies: [
    { id: "c1", kind: "point", label: "carbon atom 1" }, { id: "c2", kind: "point", label: "carbon atom 2" },
    { id: "cc", kind: "line", label: "C=C double bond" },
  ] },
  { name: "hybrid orbitals stay unbound", question: "sp3 hybridisation in methane", family: "chem_organic", bodies: [
    { id: "ch4", kind: "other", label: "methane molecule CH4" }, { id: "sp3", kind: "other", label: "four equivalent sp3 hybrid orbitals" },
  ] },
  { name: "isomer the organic figure does not draw", question: "draw isomers of butane", family: "chem_organic", bodies: [
    { id: "n", kind: "other", label: "n-butane straight chain" }, { id: "iso", kind: "other", label: "2-methylpropane branched" },
  ] },
  { name: "species name under a structural kind", question: "shape of NH3 molecule", family: "chem_vsepr", bodies: [{ id: "x", kind: "field", label: "NH3 molecule" }] },
  { name: "atom name under a line kind", question: "why is CO2 linear", family: "chem_vsepr", bodies: [{ id: "x", kind: "line", label: "central carbon atom" }] },
  // A charge the builder drops: the neutral species is drawn, so nothing binds.
  // Since round 2 any charge-like token in the stem removes the identity.
  { name: "charge spaced sulfite drawn as SO3", question: "shape of SO3 2-", charge: true, family: "chem_vsepr", bodies: [
    { id: "s", kind: "point", label: "central S atom" }, { id: "o", kind: "point", label: "oxygen atoms" },
  ] },
  { name: "charge spaced nitrite drawn as NO2", question: "shape of NO2 -", charge: true, family: "chem_vsepr", bodies: [
    { id: "n", kind: "point", label: "central N atom" }, { id: "o", kind: "point", label: "oxygen atoms" },
  ] },
  { name: "charge spaced nitrite hybridisation", question: "hybridisation of NO2 -", charge: true, family: "chem_vsepr", bodies: [{ id: "n", kind: "point", label: "central N atom" }] },
  { name: "charge spaced copper ion drawn as Cu", question: "electron configuration of Cu 2+", charge: true, family: "chem_orbital", bodies: [{ id: "cu", kind: "other", label: "copper atom" }] },
  { name: "charge spaced sodium ion drawn as Na", question: "electron configuration of Na +", charge: true, family: "chem_orbital", bodies: [{ id: "na", kind: "other", label: "sodium atom" }] },
  { name: "charge sign first O2+1 drawn as O2", question: "MO diagram of O2+1", charge: true, family: "chem_mo", bodies: [{ id: "o2", kind: "other", label: "O2 molecule" }] },
  { name: "charge spaced superoxide drawn as O2", question: "MO diagram of O2 -", charge: true, family: "chem_mo", bodies: [{ id: "o2", kind: "other", label: "O2 molecule" }] },
  { name: "charge bracketed peroxide drawn as O2", question: "MO diagram of O2 (2-)", charge: true, family: "chem_mo", bodies: [{ id: "o2", kind: "other", label: "oxygen molecule" }] },
  { name: "charge spaced peroxide bond order", question: "bond order of O2 2-", charge: true, family: "chem_mo", bodies: [{ id: "o2", kind: "other", label: "O2 molecule" }] },
  { name: "charge spaced N2 anion bond order", question: "bond order of N2 -", charge: true, family: "chem_mo", bodies: [{ id: "n2", kind: "other", label: "N2 molecule" }] },
  { name: "charge spaced nitrite Lewis atoms", question: "lewis structure of NO2 -", charge: true, family: "chem_lewis", bodies: [
    { id: "n", kind: "point", label: "central N atom" }, { id: "o", kind: "point", label: "oxygen atoms" },
  ] },
  { name: "charge spaced nitrite Lewis species", question: "draw the lewis structure of NO2 -", charge: true, family: "chem_lewis", bodies: [{ id: "no2", kind: "other", label: "NO2 molecule" }] },
  { name: "charge spaced peroxide Lewis", question: "lewis structure of O2 2-", charge: true, family: "chem_lewis", bodies: [{ id: "o2", kind: "other", label: "O2 molecule" }] },
  { name: "charge word two minus", question: "shape of SO3 two minus", charge: true, family: "chem_vsepr", bodies: SO3_ATOMS },
  { name: "charge word minus 2", question: "shape of SO3 minus 2", charge: true, family: "chem_vsepr", bodies: SO3_ATOMS },
  { name: "charge bracketed sulfite", question: "shape of SO3 (2-)", charge: true, family: "chem_vsepr", bodies: SO3_ATOMS },
  { name: "charge word nitrite minus", question: "shape of NO2 minus", charge: true, family: "chem_vsepr", bodies: NO2_ATOMS },
  { name: "charge word nitrite minus hybridisation", question: "hybridisation of NO2 minus", charge: true, family: "chem_vsepr", bodies: [{ id: "n", kind: "point", label: "central N atom" }] },
  { name: "charge word negative", question: "shape of NO2 negative", charge: true, family: "chem_vsepr", bodies: NO2_ATOMS },
  { name: "charge phrase with a negative charge", question: "shape of NO2 with a negative charge", charge: true, family: "chem_vsepr", bodies: NO2_ATOMS },
  { name: "charge phrase with charge -1", question: "shape of NO2 with charge -1", charge: true, family: "chem_vsepr", bodies: NO2_ATOMS },
  { name: "charge Roman numeral Cu II", question: "electron configuration of Cu II", charge: true, family: "chem_orbital", bodies: [{ id: "cu", kind: "other", label: "copper atom" }] },
  { name: "charge bracketed Roman numeral Cu(II)", question: "electron configuration of Cu(II)", charge: true, family: "chem_orbital", bodies: [{ id: "cu", kind: "other", label: "copper atom" }] },
  { name: "charge spaced iron 3+", question: "electron configuration of Fe 3+", charge: true, family: "chem_orbital", bodies: [{ id: "fe", kind: "other", label: "iron atom" }] },
  { name: "charge word O2 minus MO", question: "MO diagram of O2 minus", charge: true, family: "chem_mo", bodies: [{ id: "o2", kind: "other", label: "O2 molecule" }] },
  { name: "charge words O2 radical anion", question: "MO diagram of O2 radical anion", charge: true, family: "chem_mo", bodies: [{ id: "o2", kind: "other", label: "O2 molecule" }] },
  { name: "charge name O2 superoxide", question: "MO diagram of O2 superoxide", charge: true, family: "chem_mo", bodies: [{ id: "o2", kind: "other", label: "O2 molecule" }] },
  { name: "charge word Na plus", question: "electron configuration of Na plus", charge: true, family: "chem_orbital", bodies: [{ id: "na", kind: "other", label: "sodium atom" }] },
  { name: "charge word nitrite minus Lewis", question: "lewis structure of NO2 minus", charge: true, family: "chem_lewis", bodies: NO2_ATOMS },
  { name: "charge word nitrite negative Lewis", question: "lewis structure of NO2 negative", charge: true, family: "chem_lewis", bodies: NO2_ATOMS },
  { name: "charge word nitrite minus Lewis species", question: "lewis structure of NO2 minus", charge: true, family: "chem_lewis", bodies: [{ id: "no2", kind: "other", label: "NO2 molecule" }] },
  { name: "charge word N2 plus bond order", question: "bond order of N2 plus", charge: true, family: "chem_mo", bodies: [{ id: "n2", kind: "other", label: "N2 molecule" }] },
  { name: "dash before a word SF4", question: "shape of SF4 - see-saw?", charge: true, family: "chem_vsepr", bodies: [{ id: "s", kind: "point", label: "central S atom" }] },
  { name: "dash before a word NH3", question: "draw NH3 - explain", charge: true, family: "chem_vsepr", bodies: [{ id: "nh3", kind: "other", label: "NH3 molecule" }] },
  // Charged species the builders read right decline too: an identity needs
  // a stem with no charge-like token at all.
  { name: "charged ammonium ion", question: "shape of NH4+ ion", charge: true, family: "chem_vsepr", bodies: [
    { id: "nh4", kind: "other", label: "NH4+ ion" }, { id: "n", kind: "point", label: "central N atom" },
  ] },
  { name: "charged ammonium", question: "shape of NH4+", charge: true, family: "chem_vsepr", bodies: [{ id: "n", kind: "point", label: "central N atom" }] },
  { name: "charged sulfate caret", question: "shape of SO4^2-", charge: true, family: "chem_vsepr", bodies: [
    { id: "s", kind: "point", label: "central S atom" }, { id: "o", kind: "point", label: "oxygen atoms" },
  ] },
  { name: "charged sulfite caret", question: "shape of SO3^2-", charge: true, family: "chem_vsepr", bodies: [{ id: "s", kind: "point", label: "central S atom" }] },
  { name: "charged sulfite superscript", question: "shape of SO\u2083\u00b2\u207b", charge: true, family: "chem_vsepr", bodies: SO3_ATOMS },
  { name: "charged nitrite caret", question: "shape of NO2^-", charge: true, family: "chem_vsepr", bodies: [{ id: "n", kind: "point", label: "central N atom" }] },
  { name: "charged nitrite attached", question: "shape of NO2-", charge: true, family: "chem_vsepr", bodies: [{ id: "n", kind: "point", label: "central N atom" }] },
  { name: "charged iron two plus", question: "electron configuration of Fe2+", charge: true, family: "chem_orbital", bodies: [{ id: "fe", kind: "other", label: "Fe2+ ion" }] },
  { name: "charged copper two plus", question: "electron configuration of Cu2+", charge: true, family: "chem_orbital", bodies: [{ id: "cu", kind: "other", label: "Cu2+ ion" }] },
  { name: "charged superoxide caret", question: "MO diagram of O2^-", charge: true, family: "chem_mo", bodies: [{ id: "o2", kind: "other", label: "O_2^(-) ion" }] },
  { name: "charged peroxide caret", question: "MO diagram of O2^2-", charge: true, family: "chem_mo", bodies: [{ id: "o2", kind: "other", label: "O2^(2-) ion" }] },
  { name: "charged ammonium Lewis", question: "lewis structure of NH4+", charge: true, family: "chem_lewis", bodies: [
    { id: "nh4", kind: "other", label: "NH4+ ion" }, { id: "n", kind: "point", label: "central N atom" },
  ] },
  { name: "charged nitrite caret Lewis", question: "lewis structure of NO2^-", charge: true, family: "chem_lewis", bodies: NO2_ATOMS },
  // Bond dashes and hyphenated words are read as signs: a decline only.
  { name: "hyphen C-H bond", question: "lewis structure of CH4 showing each C-H bond", charge: true, family: "chem_lewis", bodies: [{ id: "ch4", kind: "other", label: "CH4 molecule" }] },
  { name: "hyphen sp3-hybridised", question: "shape of CH4 with sp3-hybridised carbon", charge: true, family: "chem_vsepr", bodies: [{ id: "ch4", kind: "other", label: "CH4 molecule" }] },
  { name: "unbonded atoms claimed connected", question: "lewis structure of CO2", family: "chem_lewis", bodies: CO2_BODIES.slice(1),
    connections: [["oxygen1", "oxygen2"]] },
];

/** Charge controls whose builder draws nothing for the ProblemIR, rule or no rule. */
const BUILDER_DECLINES = new Set<string>(["charge bracketed Roman numeral Cu(II)"]);

for (const control of CONTROLS) {
  test(`control ${control.name}: declines`, () => {
    assert.equal(draw(control.question, control.family, problem(control.question, control.bodies, control.connections)), null);
  });
}

function figure(question: string, family: string): SceneDocument {
  const scene = synthesizeFamilyScene({ question, families: [family as never] });
  assert.ok(scene, `${question} must draw`);
  return scene.document;
}

const nh3Question = "shape of NH3 molecule";
const nh3Set = deriveVisualObligations(problem(nh3Question, [{ id: "nh3", kind: "other", label: "NH3 molecule" }]));

test("control a tampered figure has no identity", () => {
  const document = structuredClone(figure(nh3Question, "chem_vsepr"));
  assert.ok(checkVisualObligations(nh3Set, document, nh3Question).satisfied, "untampered copy binds by recomputation");
  document.entities.push({ id: "forged_caption", kind: "label", label: "NH3 molecule shown", role: "caption" } as SceneDocument["entities"][number]);
  assert.equal(checkVisualObligations(nh3Set, document, nh3Question).satisfied, false);
});

test("control a source question swapped onto NH3 ink has no PH3 identity", () => {
  const document = structuredClone(figure(nh3Question, "chem_vsepr"));
  const swapped = "shape of PH3 molecule";
  document.source.question = swapped;
  const set = deriveVisualObligations(problem(swapped, [{ id: "ph3", kind: "other", label: "PH3 molecule" }]));
  assert.equal(checkVisualObligations(set, document, swapped).satisfied, false);
});

test("control a document without an engine chemistry family keeps exact binding", () => {
  const document = structuredClone(figure(nh3Question, "chem_vsepr"));
  delete (document.source as Record<string, unknown>).chemistryFamily;
  assert.equal(checkVisualObligations(nh3Set, document, nh3Question).satisfied, false);
});

test("control no original question means no identity", () => {
  const document = figure(nh3Question, "chem_vsepr");
  assert.equal(checkVisualObligations(nh3Set, document).satisfied, false);
});

const charges = await import(pathToFileURL(join(engineRoot, "chemistry", "chargeMarker.ts")).href)
  .catch(() => null) as typeof import("../../src/chemistry/chargeMarker") | null;

const MARKED: ReadonlyArray<readonly [string, string, number]> = [
  ["shape of SO3 2-", "SO3", -2], ["shape of NO2 -", "NO2", -1], ["electron configuration of Cu 2+", "Cu", 2],
  ["electron configuration of Na +", "Na", 1], ["MO diagram of O2+1", "O2", 1], ["MO diagram of O2 (2-)", "O2", -2],
  ["bond order of O2 2-", "O2", -2], ["O2 -2", "O2", -2], ["SO4^2-", "SO4", -2], ["SO4^(2-)", "SO4", -2], ["SO₄²⁻", "SO4", -2],
  ["SO_4^{2-}", "SO4", -2], ["SO42-", "SO4", -2], ["NH4+", "NH4", 1], ["Fe3+", "Fe", 3], ["[Fe(CN)6]3-", "[Fe(CN)6]", -3],
];
const UNMARKED = [
  "C-H bond", "sp3-hybridised carbon", "pH 3-4", "2-methylpropane", "CH3-CH3", "C - H bond", "BF3 + NH3",
  "H2 + O2 -> H2O", "x = 3 - 2", "Group 1-2 trend", "ionisation energy trend across period 2", "ionic radius in period 3",
];

for (const [text, formula, charge] of MARKED) {
  test(`charge reader: "${text}" writes ${formula} with charge ${charge}`, () => {
    assert.ok(charges, "the charge marker reader must exist");
    const markers = charges.readChargeMarkers(text).filter((marker) => marker.formula !== null);
    assert.deepEqual(markers.map((marker) => [marker.formula, marker.charge]), [[formula, charge]]);
  });
}
for (const text of UNMARKED) {
  test(`charge reader: "${text}" writes no charge`, () => {
    assert.ok(charges, "the charge marker reader must exist");
    assert.deepEqual(charges.readChargeMarkers(text), []);
  });
}
test("charge reader: the words ion, cation and anion need a charged species of that sign", () => {
  assert.ok(charges, "the charge marker reader must exist");
  assert.equal(charges.chargeMarkersCarried("shape of the nitrite ion", ["NO2"]), false);
  assert.equal(charges.chargeMarkersCarried("shape of the nitrite ion", ["NO_2^(-)"]), true);
  assert.equal(charges.chargeMarkersCarried("the ammonium cation", ["NO_2^(-)"]), false);
  assert.equal(charges.chargeMarkersCarried("the ammonium cation", ["NH4^+"]), true);
  assert.equal(charges.chargeMarkersCarried("an anion", ["NH4^+"]), false);
  assert.equal(charges.chargeMarkersCarried("shape of NO2 -", ["NO2"]), false);
  assert.equal(charges.chargeMarkersCarried("shape of NH3 molecule", ["NH3"]), true);
});

// Charged stems earn no figure identity, so the species key is checked on a
// superoxide identity directly: oxide and peroxide never share its key.
const binder = await import(pathToFileURL(join(engineRoot, "chemistry", "obligationIdentity.ts")).href) as typeof import("../../src/chemistry/obligationIdentity");
const SUPEROXIDE_IDENTITY = {
  species: [{ formula: "O_2^(-)", entityId: "superoxide", atoms: [], bonds: [], knowsCentral: false }],
  elementSets: [],
};
test("key: a superoxide identity binds its own name", () => {
  assert.equal(binder.bindChemistryBody(SUPEROXIDE_IDENTITY, "other", "O2^- ion", new Set())?.entityId, "superoxide");
});
for (const label of ["O^(2-) ion", "O2^(2-) ion", "O2 molecule"]) {
  test(`control key: ${label} does not bind a superoxide identity`, () => {
    assert.equal(binder.bindChemistryBody(SUPEROXIDE_IDENTITY, "other", label, new Set()), null);
  });
}

const evidence = await import(pathToFileURL(join(engineRoot, "chemistry", "chargeEvidence.ts")).href)
  .catch(() => null) as typeof import("../../src/chemistry/chargeEvidence") | null;

/** Every deny item of the charge-like token reader, one or more rows each. */
const CHARGE_LIKE: ReadonlyArray<readonly [string, string]> = [
  ["sign attached", "shape of NO2-"], ["sign spaced", "shape of NO2 -"], ["sign before a digit", "MO diagram of O2+1"],
  ["sign after a digit spaced", "shape of SO3 2 -"], ["sign in a sentence", "NO2 with charge -1"], ["sign before a word", "draw NH3 - explain"],
  ["sign at the end", "bond in H2 -"], ["plus sign", "Na + Cl2"], ["Unicode minus", "shape of NO2 \u2212"], ["en dash", "shape of NO2 \u2013"],
  ["em dash", "NO2 \u2014 shape"], ["plus minus sign", "charge \u00b1"], ["full width minus", "NO2\uff0d"], ["small hyphen minus", "NO2\ufe63"],
  ["bond dash", "C-H bond"], ["locant hyphen", "2-methylpropane"], ["hybrid hyphen", "sp3-hybridised"], ["element name hyphen", "oxygen-oxygen bond"],
  ["number word hyphen", "copper-two"], ["Roman numeral hyphen", "iron-ii"], ["capital hyphen", "T-shaped"],
  ["superscript minus", "NO2\u207b"], ["superscript plus", "Na\u207a"], ["superscript digit", "SO\u2083\u00b2"], ["superscript three", "Fe\u00b3"],
  ["superscript digit alone", "sp\u00b2 hybridisation"], ["caret", "Fe^3"], ["caret brace", "SO4^{2}"], ["HTML superscript", "Fe<sup>3</sup>"],
  ["radical dot", "NO\u2022"], ["centre dot", "O2\u00b7"],
  ["minus", "SO3 two minus"], ["plus", "Na plus"], ["negative", "NO2 negative"], ["positive", "a positive species"], ["charge", "with a charge of 1"],
  ["charged", "a charged species"], ["ion", "the nitrite ion"], ["ions", "ions in NaCl"], ["ionic", "ionic radius"], ["cation", "the sodium cation"],
  ["cations", "cations and anions"], ["anion", "nitrite anion"], ["anions", "anions"], ["oxidation", "oxidation state of Fe"],
  ["radical", "O2 radical"], ["radicals", "free radicals"], ["valency", "valency of copper"], ["valence state", "valence state of iron"],
  ["electrovalent", "electrovalent bond"], ["capitalised word", "NO2 MINUS"], ["divalent", "divalent copper"], ["ionised", "ionised sodium"],
  ["carbocation", "a carbocation"], ["electron lost", "sodium after it loses one electron"], ["electron gained", "chlorine gains an electron"],
  ["Roman II", "Cu II"], ["Roman III", "Fe III"], ["Roman IV", "Pb IV"], ["Roman V", "P V"], ["Roman VI", "Cr VI"], ["Roman VII", "Mn VII"],
  ["Roman VIII", "Os VIII"], ["Roman lower case", "copper ii"], ["Roman attached", "CuII"],
  ["bracketed Roman", "Cu(II)"], ["bracketed Roman I", "Cu(I)"], ["bracketed signed number", "SO3 (2-)"], ["bracketed sign first", "Cu(+1)"],
  ["bracketed number", "Cu(2)"], ["square bracketed Roman", "Fe[III]"], ["bracketed sign", "NO2(-)"],
  ["ionisation not a property", "configuration of Fe after ionisation"], ["cationic", "a cationic species"], ["anionic", "anionic form"],
  ["formula then a lone digit", "shape of SO3 2"], ["symbol then a lone digit", "electron configuration of Fe 3"],
  ["element name then a digit", "electron configuration of copper 2"], ["element name then a number word", "electron configuration of iron three"],
  ["named ion", "shape of nitrite"], ["named cation", "shape of ammonium"], ["ion name", "MO diagram of superoxide"], ["oxidation state name", "ferric chloride"],
];
/** Stems with no charge-like token: the binding and certificates still apply. */
const CHARGE_FREE: readonly string[] = [
  "shape of NH3 molecule", "geometry of PCl5", "hybridisation of BF3", "why is CO2 linear", "lewis structure of CO2",
  "bond order of N2", "Lewis structure of CH3COOH", "electron configuration of iron", "trend of atomic radius in period 3",
  "ionisation energy trend across period 2", "electronegativity down group 17", "trend in first ionisation energy down group 1",
  "MO diagram of O2", "lewis dot structure of ammonia", "shape of carbon dioxide", "hydrogen peroxide lewis structure",
  "MO diagram of nitric oxide", "electron gain enthalpy of the halogens", "second ionisation energy of sodium", "the B 2p orbital",
  "first ionisation energies Be 899 and B 801", "pressure-volume graph", "see-saw shape of SF4", "classification of elements", "boyle's law graph",
];
for (const [item, text] of CHARGE_LIKE) {
  test(`charge-like token: ${item} ("${text}") removes trust`, () => {
    assert.ok(evidence, "the charge-like token reader must exist");
    assert.equal(evidence.stemHasChargeLikeToken(text), true);
  });
}
for (const text of CHARGE_FREE) {
  test(`charge-like token: "${text}" has none`, () => {
    assert.ok(evidence, "the charge-like token reader must exist");
    assert.equal(evidence.stemHasChargeLikeToken(text), false);
  });
}

/** Run this gate on a copy of the engine with one exact source edit. */
function runMutant(file: string, from: string, to: string): string {
  const scratch = join(packageRoot, "tmp", `chem-obligation-mutant-${process.pid}`);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  try {
    cpSync(join(packageRoot, "src"), join(scratch, "src"), { recursive: true });
    const target = join(scratch, "src", file);
    const source = readFileSync(target, "utf8");
    assert.equal(source.split(from).length, 2, `the mutated text must appear exactly once in ${file}`);
    const mutated = source.replace(from, to);
    assert.notEqual(mutated, source, "the mutation must change the source");
    writeFileSync(target, mutated);
    const child = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), fileURLToPath(import.meta.url)], {
      cwd: packageRoot,
      env: { ...process.env, CHEM_OBLIGATION_ENGINE_ROOT: join(scratch, "src"), CHEM_OBLIGATION_MUTANT: "1" },
      encoding: "utf8",
      timeout: 300_000,
    });
    assert.notEqual(child.status, 0, "the gate must fail on the mutant");
    return `${child.stdout}\n${child.stderr}`;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (!mutant) {
  test("mutation: removing the binder call turns every positive row red", () => {
    const output = runMutant(
      join("synthesize", "visualObligations.ts"),
      "const bound = chemistry ? bindChemistryBody(chemistry, obligation.problemKind, wanted, consumed) : null;",
      "const bound = null as ReturnType<typeof bindChemistryBody>;",
    );
    for (const row of POSITIVE) assert.ok(output.includes(`FAIL positive ${row.name}:`), `${row.name} must go red on the mutant`);
    for (const control of CONTROLS) assert.ok(output.includes(`PASS control ${control.name}:`), `${control.name} still declines on the mutant`);
  });

  test("mutation: removing the charge-like token rule binds every charge control the builder draws", () => {
    const output = runMutant(
      join("chemistry", "obligationIdentity.ts"),
      "  if (stemHasChargeLikeToken(originalQuestion)) return null;\n",
      "",
    );
    for (const control of CONTROLS.filter((item) => item.charge && !BUILDER_DECLINES.has(item.name))) {
      assert.ok(output.includes(`FAIL control ${control.name}:`), `${control.name} must go red without the rule`);
    }
    for (const name of BUILDER_DECLINES) assert.ok(output.includes(`PASS control ${name}:`), `${name} declines in the builder itself`);
    for (const row of POSITIVE) assert.ok(output.includes(`PASS positive ${row.name}:`), `${row.name} still binds without the rule`);
  });

  test("mutation: a formula key that flattens charge into the characters binds oxide to superoxide", () => {
    const output = runMutant(
      join("chemistry", "obligationIdentity.ts"),
      "  return `${body} | ${charge}`;",
      "  return value.trim().replace(/\\s+/g, \"\").replace(/_(\\d+)/g, \"$1\").replace(/\\^\\(([^)]*)\\)/g, \"$1\").replace(/[\\^()[\\]]/g, \"\");",
    );
    assert.ok(output.includes("FAIL control key: O^(2-) ion does not bind a superoxide identity:"), "the oxide control must go red on the flattened key");
  });

  test("mutation: a formula key of merged atom counts binds an isomer", () => {
    const output = runMutant(
      join("chemistry", "obligationIdentity.ts"),
      "  return `${body} | ${charge}`;",
      "  const parsed = parseFormula(text)!;\n  return `${parsed.atoms.map((atom) => `${atom.symbol}${atom.count}`).join(\" \")} | ${charge}`;",
    );
    assert.ok(output.includes("FAIL control isomer named on an acetic acid Lewis figure:"), "the isomer control must go red on the merged key");
  });
}

if (failures.length > 0) {
  console.error(`\nchemistry obligation identity: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nchemistry obligation identity: ${passed} passed (${POSITIVE.length} positive rows, ${CONTROLS.length} controls${mutant ? ", mutant run" : ", 4 mutations"})`);
