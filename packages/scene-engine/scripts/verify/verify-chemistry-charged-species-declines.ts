/**
 * Charged species that main drew wrong, from the #304 post merge review
 * (section 2). Every fix here only makes a figure decline; none makes a
 * figure draw.
 *
 *   tsx scripts/verify/verify-chemistry-charged-species-declines.ts [--root <scene-engine dir>] [--no-mutants] [--no-sweep] [--json]
 *
 * Checks:
 *  - negator: "NO with a charge of +1" drew neutral NO (Lewis, MO, and the
 *    hydrogenic radial curves), because the charge guard read the formula
 *    NO as the negator "no" and set the charge aside. The negator words are
 *    now case sensitive. Each row declines in every chemistry builder and on
 *    the family path.
 *  - diatomic: "MO diagram of NO2-" drew an NO^(2-) ladder. The MO builder
 *    declines a token that is not a diatomic once its whole formula is read
 *    (nitrite, nitrate, nitronium, CO2+), and the stem keeps its MO cue.
 *  - lane: "Shape of CO3 2- and its dipole moment", "shape of NH4 + and show
 *    its dipole", "Is NO2 - paramagnetic?" left the chemistry lane for the
 *    physics point_field dipole and the chi against T curve. Each now stays
 *    in the chemistry lane (isChemistryQuestion, the lane production's
 *    chemistryLane reads) and draws nothing.
 *  - control: neutral NO, CO, N2, O2 MO diagrams and Lewis structures draw;
 *    NO+, O2^2-, O22-, He2+, H2+ and CN- draw their true MO; negators in
 *    lower case and a clause opening "No" still set a charge aside; stems
 *    with no charge keep their lane (the uncharged NO2 paramagnetic stem
 *    stays where main has it, and physics dipole stems stay physics).
 *  - determinism: the gate rows give the same result with the regex
 *    interpreter only (node --regexp-interpret-all), and in one process
 *    after the first 2,000 sweep stems (warm) as before them (cold). On
 *    main the negator and the "negatively charged" reader used inline case
 *    modifier groups whose result changed once V8 compiled them to native
 *    code, so a cold process drew neutral NO and a warm one did not, and a
 *    warm one drew neutral NO2 under "Negatively charged NO2". No inline
 *    modifier group is left in scene-engine src, and the gate fails on one.
 *  - sweep: every syllabus probe, every data/diagram-eval stem, the checked
 *    in question bank (and the built bank when present) and a charged grid
 *    run here and on a copy of src with the four fixes switched off (main's
 *    behaviour). A figure drawn here is drawn there with the same document;
 *    no stem leaves the chemistry lane; a stem that writes no charge routes
 *    exactly as there.
 *  - mutants: each fix switched off alone turns its own rows red.
 *
 * Fixture values are oracles only; no builder reads them.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "../..");
const argv = process.argv.slice(2);
const rootFlag = argv.indexOf("--root");
const root = rootFlag >= 0 ? resolve(argv[rootFlag + 1]!) : packageRoot;
const jsonOut = argv.includes("--json");
const child = rootFlag >= 0 || argv.includes("--child");
const withMutants = !argv.includes("--no-mutants") && !child;
const withSweep = !argv.includes("--no-sweep") && !child;
// A child asked only for the sweep writes it to this file and stops.
const sweepFlag = argv.indexOf("--sweep-only");
const sweepOut = sweepFlag >= 0 ? resolve(argv[sweepFlag + 1]!) : null;
// A child asked to run warm reads the first WARM_STEMS sweep stems, then the gate rows, and writes their reads to this file.
const warmFlag = argv.indexOf("--warm");
const warmOut = warmFlag >= 0 ? resolve(argv[warmFlag + 1]!) : null;
const WARM_STEMS = 2000;

await import(`${root}/src/chemistry/families.ts`);
const { CHEMISTRY_SCENE_FAMILIES, chemistryFamilyBuilder, isChemistryQuestion, inferChemistryFamilies } = await import(`${root}/src/chemistry/index.ts`);
const { isChemistryStem } = await import(`${root}/src/chemistry/classify.ts`);
const { readChargeMarkers } = await import(`${root}/src/chemistry/chargeMarker.ts`);
const { readWrittenCharges, stemChargesRead } = await import(`${root}/src/chemistry/speciesChargeGuard.ts`);
const { synthesizeFamilyScene } = await import(`${root}/src/synthesize/familyScene.ts`);

type Doc = { entities?: Array<{ label?: string }>; title?: string };

/** Every document a chemistry builder draws for the stem, plain and schematic. */
function drawnDocuments(question: string): Array<[string, Doc]> {
  const drawn: Array<[string, Doc]> = [];
  for (const family of CHEMISTRY_SCENE_FAMILIES as readonly string[]) {
    for (const schematic of [false, true]) {
      const document = chemistryFamilyBuilder(family)?.(question, [], schematic) as Doc | null | undefined;
      if (document) drawn.push([`${family}${schematic ? "/schematic" : ""}`, document]);
    }
  }
  return drawn;
}

function labels(document: Doc | undefined): string[] {
  return (document?.entities ?? []).map((entity) => entity.label ?? "").filter(Boolean);
}

/* --------------------------------------------------------------------- rows */

interface DeclineRow { readonly id: string; readonly fix: "negator" | "diatomic" | "lane-vsepr" | "lane-magnetism" | "case-blind"; readonly question: string; readonly charge: string }

const DECLINE: DeclineRow[] = [
  // #304 post merge review, section 2 row 1: neutral NO drawn under NO+.
  { id: "lewis-NO-charge-of-plus-1", fix: "negator", question: "Draw the Lewis structure of NO with a charge of +1", charge: "+" },
  { id: "lewis-NO-positive-charge", fix: "negator", question: "Draw the Lewis structure of NO with a positive charge", charge: "+" },
  { id: "mo-NO-charge-of-plus-1", fix: "negator", question: "Draw the MO diagram of NO with a charge of +1", charge: "+" },
  { id: "mo-NO-positive-charge", fix: "negator", question: "Draw the MO diagram of NO with a positive charge", charge: "+" },
  { id: "bond-order-NO-positive-charge", fix: "negator", question: "What is the bond order of NO with a positive charge? Draw the MO diagram", charge: "+" },
  { id: "para-NO-charge-of-plus-1", fix: "negator", question: "Is NO with a charge of +1 paramagnetic? Show its MO diagram", charge: "+" },
  { id: "radial-NO-charge-of-plus-1", fix: "negator", question: "Sketch the radial probability distribution of 1s and 2s for NO with a charge of +1", charge: "+" },
  // Row 2: nitrite, nitrate and nitronium drawn as NO^(2-), NO^(3-), NO^(2+) diatomics.
  { id: "mo-NO2-minus", fix: "diatomic", question: "Draw the MO diagram of NO2-", charge: "-" },
  { id: "mo-NO3-minus", fix: "diatomic", question: "Draw the MO diagram of NO3-", charge: "-" },
  { id: "mo-NO2-plus", fix: "diatomic", question: "Draw the MO diagram of NO2+", charge: "+" },
  { id: "bond-order-NO2-minus", fix: "diatomic", question: "What is the bond order of NO2-? Draw the MO diagram", charge: "-" },
  { id: "para-NO3-minus", fix: "diatomic", question: "Is NO3- paramagnetic? Show its MO diagram", charge: "-" },
  { id: "mo-CO2-plus", fix: "diatomic", question: "Draw the MO diagram of CO2+", charge: "+" },
  // Row 3: charged shape and dipole stems drawn as the physics point_field dipole.
  { id: "lane-CO3-2-dipole", fix: "lane-vsepr", question: "Shape of CO3 2- and its dipole moment", charge: "2-" },
  { id: "lane-NH4-plus-dipole", fix: "lane-vsepr", question: "Draw the shape of NH4 + and show its dipole", charge: "+" },
  { id: "lane-NO2-1-dipole", fix: "lane-vsepr", question: "Draw the dipole moment of NO2-1 and its shape", charge: "-" },
  { id: "lane-CO3-ion-dipole", fix: "lane-vsepr", question: "Draw the dipole moment of the CO3 ion and its shape", charge: "2-" },
  { id: "lane-NH4-positive-dipole", fix: "lane-vsepr", question: "Draw the dipole moment of NH4 with a positive charge and its shape", charge: "+" },
  { id: "lane-NH4-plus-word-dipole", fix: "lane-vsepr", question: "Draw the dipole moment of NH4 plus and its shape", charge: "+" },
  // Row 4: the chi against T curve under a charged MO question.
  { id: "lane-NO2-minus-para", fix: "lane-magnetism", question: "Is NO2 - paramagnetic? Show its MO diagram", charge: "-" },
  { id: "lane-NO2-minus-word-para", fix: "lane-magnetism", question: "Is NO2 minus paramagnetic? Show its MO diagram", charge: "-" },
  { id: "lane-NO2-caret-para", fix: "lane-magnetism", question: "Is NO2^- paramagnetic? Show its MO diagram", charge: "-" },
  { id: "lane-SO3-2-para", fix: "lane-magnetism", question: "Is SO3 2- paramagnetic? Show its MO diagram", charge: "2-" },
  // PR #309 review, fix 2: on main a warm process lost the case blind read of these and drew neutral NO2.
  { id: "case-Negatively-charged-NO2", fix: "case-blind", question: "Draw the shape of Negatively charged NO2", charge: "-" },
  { id: "case-NEGATIVELY-CHARGED-NO2", fix: "case-blind", question: "Draw the shape of NEGATIVELY CHARGED NO2", charge: "-" },
];

/** Neutral and attached species that draw on main and must draw the same here. */
const DRAWS: Array<{ id: string; question: string; family: string; shows: string[] }> = [
  { id: "mo-NO", question: "Draw the MO diagram of NO", family: "chem_mo", shows: ["NO"] },
  { id: "mo-CO", question: "Draw the MO diagram of CO", family: "chem_mo", shows: ["CO"] },
  { id: "mo-N2", question: "Draw the MO diagram of N2", family: "chem_mo", shows: ["N_2"] },
  { id: "mo-O2", question: "Draw the MO diagram of O2", family: "chem_mo", shows: ["O_2"] },
  { id: "mo-NO-plus", question: "Draw the MO diagram of NO+", family: "chem_mo", shows: ["NO^(+)"] },
  { id: "mo-O2-caret-2-minus", question: "Draw the MO diagram of O2^2-", family: "chem_mo", shows: ["O_2^(2-)"] },
  { id: "mo-O22-minus", question: "Draw the MO diagram of O22-", family: "chem_mo", shows: ["O_2^(2-)"] },
  { id: "mo-He2-plus", question: "What is the bond order of He2+? Draw the MO diagram", family: "chem_mo", shows: ["He_2^(+)"] },
  { id: "mo-H2-plus", question: "Draw the MO diagram of H2+", family: "chem_mo", shows: ["H_2^(+)"] },
  { id: "mo-CN-minus", question: "Draw the MO diagram of CN-", family: "chem_mo", shows: ["CN^(-)"] },
  { id: "lewis-NO", question: "Draw the Lewis structure of NO", family: "chem_lewis", shows: ["NO"] },
  { id: "lewis-CO", question: "Draw the Lewis structure of CO", family: "chem_lewis", shows: ["CO"] },
  { id: "lewis-N2", question: "Draw the Lewis structure of N2", family: "chem_lewis", shows: ["N_2"] },
  { id: "lewis-O2", question: "Draw the Lewis structure of O2", family: "chem_lewis", shows: ["O_2"] },
  // Negators that are words still set the charge aside.
  { id: "negator-not-lower", question: "Draw the Lewis structure of NO2, not NO2 -.", family: "chem_lewis", shows: ["NO_2"] },
  { id: "negator-No-clause-start", question: "No He+ or Li2+ participate; draw the Lewis structure of H2O.", family: "chem_lewis", shows: ["H_2O"] },
  { id: "vsepr-NH4-plus-attached", question: "Draw the shape of NH4+ and show its dipole", family: "chem_vsepr", shows: ["NH_4^(+)"] },
];

/** Lane rows: a stem with no charge keeps main's lane; a row already right on main stays right. */
/** A lane row owned by a fix stays in chemistry only through it: that fix's mutant must turn it red. */
const LANE: Array<{ id: string; question: string; chemistry: boolean; fix?: DeclineRow["fix"] }> = [
  { id: "neutral-NO2-para", question: "Is NO2 paramagnetic? Show its MO diagram", chemistry: false },
  { id: "neutral-CO2-dipole", question: "Shape of CO2 and its dipole moment", chemistry: true },
  { id: "neutral-NH3-dipole", question: "Draw the shape of NH3 and show its dipole", chemistry: true },
  { id: "physics-charges-dipole", question: "Find the dipole moment of charges +2 μC and -2 μC separated by 3 cm and its direction.", chemistry: false },
  { id: "physics-paramagnetic-sample", question: "A paramagnetic sample with susceptibility χ: draw χ against T.", chemistry: false },
  { id: "physics-normal-force", question: "N2 - mg = ma; draw the free body diagram of the block.", chemistry: false },
  { id: "main-already-NO2-dipole", question: "Dipole moment of NO2 - and its shape", chemistry: true },
  // PR #309 review, fix 1: a charge phrase whose formula owner is written after it (the
  // coulomb C, a field B, a point P, a pole N) is not ion magnetism; these stay physics.
  { id: "physics-para-sphere-coulomb", question: "A paramagnetic sphere carrying a charge of +5 C is cooled. Sketch χ against T.", chemistry: false },
  { id: "physics-para-grain-field-B", question: "A paramagnetic dust grain has a negative charge and sits in field B. Plot χ against T.", chemistry: false },
  { id: "physics-para-sample-coulomb", question: "Is a sample with a charge of +2 C paramagnetic? Plot it against T", chemistry: false },
  { id: "physics-para-bead-point-P", question: "A paramagnetic bead with a positive charge sits at point P. Draw χ against T.", chemistry: false },
  { id: "physics-dia-rod-pole-N", question: "A diamagnetic rod with a negative charge is placed near pole N. Draw the field.", chemistry: false },
  { id: "physics-para-sphere-microcoulomb", question: "A paramagnetic sphere has a charge of -3 μC at C. Sketch χ vs T.", chemistry: false },
  // Greptile on #309: a one letter label written before the charge (point P, P2, C) or carrying a
  // sign word or numeral (B positively charged, S II, region B II) is not a species; these stay physics.
  { id: "physics-para-sphere-point-P-before", question: "A paramagnetic sphere at point P with a charge of +5 C is cooled. Sketch χ against T.", chemistry: false },
  { id: "physics-para-bead-P2-before", question: "A paramagnetic bead at P2 with a positive charge is cooled. Draw χ against T.", chemistry: false },
  { id: "physics-para-sphere-at-C-before", question: "A paramagnetic sphere at C carrying a negative charge is cooled. Sketch χ vs T.", chemistry: false },
  { id: "physics-para-ball-B-sign-word", question: "A paramagnetic ball at B positively charged P sits still. Draw χ against T.", chemistry: false },
  { id: "physics-para-sample-S-II", question: "Sample S II is paramagnetic; draw χ against T", chemistry: false },
  { id: "physics-para-region-B-II", question: "Is the material in region B II paramagnetic?", chemistry: false },
  // Species written in words keep the chemistry lane: a diatomic, a formula, an oxidation state.
  { id: "chem-O2-negative-charge-para", question: "Is O2 with a negative charge paramagnetic? Show its MO diagram", chemistry: true },
  { id: "chem-O2-minus-para", question: "Is O2 minus paramagnetic? Show its MO diagram", chemistry: true },
  { id: "chem-C2-negative-charge-para", question: "Is C2 with a negative charge paramagnetic? Show its MO diagram", chemistry: true },
  { id: "chem-NO2-negative-charge-para", question: "Is NO2 with a negative charge paramagnetic? Show its MO diagram", chemistry: true, fix: "lane-magnetism" },
  { id: "chem-Fe-II-para", question: "Is Fe II paramagnetic?", chemistry: true, fix: "lane-magnetism" },
];

/* ------------------------------------------------------------------- checks */

const results: Array<{ id: string; passed: boolean; error?: string }> = [];
function check(id: string, body: () => void): void {
  try { body(); results.push({ id, passed: true }); } catch (error) { results.push({ id, passed: false, error: error instanceof Error ? error.message : String(error) }); }
}

function rowsOnly(): void {
  for (const row of DECLINE) {
    check(`decline/${row.id}`, () => {
      assert.ok(readChargeMarkers(row.question).length + readWrittenCharges(row.question).length > 0, "the stem writes a charge");
      // A builder called directly (no cue) may draw the ion asked; none may draw it without its charge.
      const want = [`^(${row.charge})`, `^{${row.charge}}`];
      const wrong = drawnDocuments(row.question).filter(([, document]) => !want.some((text) => JSON.stringify(document).includes(text))).map(([who]) => who);
      assert.deepEqual(wrong, [], "no chemistry builder draws the species without the asked charge");
      const scene = synthesizeFamilyScene({ question: row.question });
      assert.equal(scene, null, `the family path draws nothing (drew ${scene?.family})`);
      if (row.fix.startsWith("lane")) assert.equal(isChemistryQuestion(row.question), true, "the stem stays in the chemistry lane");
      if (row.fix === "negator") assert.equal(stemChargesRead(row.question, ["NO"]), false, "the charge on NO is not set aside");
    });
  }
  for (const row of DRAWS) {
    check(`draws/${row.id}`, () => {
      const scene = synthesizeFamilyScene({ question: row.question });
      assert.ok(scene, "the species still draws");
      assert.equal(scene.family, row.family);
      const shown = labels(scene.document as Doc).join(" ");
      for (const text of row.shows) assert.ok(shown.includes(text), `${text} shown in ${shown.slice(0, 120)}`);
    });
  }
  for (const row of LANE) {
    check(`lane/${row.id}`, () => assert.equal(isChemistryQuestion(row.question), row.chemistry));
  }
}

/* -------------------------------------------------------------------- sweep */

const repoRoot = resolve(packageRoot, "../..");

/** A small charged grid over the species of the review rows, in the spellings students use. */
function chargedGrid(): string[] {
  const species: Array<[string, number]> = [["NO", 1], ["NO", -1], ["NO2", -1], ["NO2", 1], ["NO3", -1], ["CO3", -2], ["SO3", -2], ["NH4", 1], ["O2", -2], ["O2", -1], ["CN", -1], ["CO", 1]];
  const frames = ["Draw the shape of X", "Draw the Lewis structure of X", "Draw the MO diagram of X", "Shape of X and its dipole moment", "Is X paramagnetic? Show its MO diagram", "Sketch the radial probability distribution of 1s and 2s for X"];
  const out: string[] = [];
  for (const [body, q] of species) {
    const m = Math.abs(q); const s = q < 0 ? "-" : "+"; const mm = m === 1 ? "" : String(m);
    const spellings = [`${body}${mm}${s}`, `${body} ${mm}${s}`, `${body} ${s}${mm}`, `${body}^(${mm}${s})`, `${body} ${q < 0 ? "minus" : "plus"}`, `${body} with a charge of ${s}${m}`, `${body} with a ${q < 0 ? "negative" : "positive"} charge`, `the ${body} ion`, `${body}${s}${m}`];
    for (const spelling of spellings) for (const frame of frames) out.push(frame.replace("X", spelling));
  }
  return out;
}

/** Every data/diagram-eval stem, files in name order. */
function evalStems(): string[] {
  const stems: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".jsonl")) {
        for (const line of readFileSync(path, "utf8").split("\n")) {
          if (!line.trim()) continue;
          const row = JSON.parse(line) as { question?: unknown };
          if (typeof row.question === "string" && row.question.trim()) stems.push(row.question);
        }
      }
    }
  };
  walk(join(repoRoot, "data/diagram-eval"));
  return stems;
}

/**
 * The sweep stems: the gate rows, every syllabus probe, every diagram-eval stem, the bank, the
 * charged grid. With evalFirst the diagram-eval stems lead (the order the PR #309 review warmed
 * main in, where a warm process lost the case blind read).
 */
function sweepStems(evalFirst = false): string[] {
  const stems = new Set<string>(evalFirst ? evalStems() : []);
  for (const row of [...DECLINE, ...DRAWS, ...LANE]) stems.add(row.question);
  const probes = join(repoRoot, "data/syllabus-probes");
  for (const name of readdirSync(probes).filter((file) => file.endsWith(".json")).sort()) {
    const unit = JSON.parse(readFileSync(join(probes, name), "utf8")) as { questions?: Array<{ question?: string }> };
    for (const row of unit.questions ?? []) if (row.question) stems.add(row.question);
  }
  for (const stem of evalStems()) stems.add(stem);
  for (const bank of ["data/question-bank/questions.jsonl", "data/question-bank/build/questions.all.jsonl"]) {
    if (!existsSync(join(repoRoot, bank))) continue;
    for (const line of readFileSync(join(repoRoot, bank), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as { text?: unknown };
      if (typeof row.text === "string" && row.text.trim()) stems.add(row.text);
    }
  }
  for (const stem of chargedGrid()) stems.add(stem);
  return [...stems];
}

interface SweepRow { route: string; chemistry: boolean; charged: boolean; drawn: string | null }

function sweepRow(question: string): SweepRow {
  const families = inferChemistryFamilies(question);
  const scene = synthesizeFamilyScene({ question });
  return {
    route: JSON.stringify([isChemistryStem(question), isChemistryQuestion(question), families]),
    chemistry: isChemistryQuestion(question),
    charged: readChargeMarkers(question).length + readWrittenCharges(question).length > 0,
    drawn: scene ? `${scene.family} ${createHash("sha1").update(JSON.stringify(scene.document)).digest("hex").slice(0, 12)}` : null,
  };
}

if (sweepOut) {
  writeFileSync(sweepOut, JSON.stringify(sweepStems().map(sweepRow)));
  process.exit(0);
}

/**
 * The gate rows read cold: first thing in a fresh process, before any sweep stem. Reading them
 * here, before a warm up, hides the flip, so the warm run is a separate process.
 */
const rowStems = [...DECLINE, ...DRAWS, ...LANE].map((row) => row.question);
const coldRows = warmOut ? [] : rowStems.map(sweepRow);
/** One stem through every reader a sweep touches: routing, the family path (inferred and default), every builder. */
function exercise(question: string): void {
  try {
    sweepRow(question);
    synthesizeFamilyScene({ question, families: inferChemistryFamilies(question) });
    drawnDocuments(question);
  } catch {
    // A stem a builder throws on still warms the readers it reached.
  }
}
if (warmOut) for (const stem of sweepStems(true).slice(0, WARM_STEMS)) exercise(stem);

rowsOnly();

if (warmOut) writeFileSync(warmOut, JSON.stringify(rowStems.map(sweepRow)));

/* --------------------------------------------------------- source checks */

/** Every file under a directory, sorted. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]);
}

if (!child) {
  check("source/no-inline-modifier-groups", () => {
    // (?i:...), (?-i:...), (?m:...), (?i-s:...): V8 gave an inline case modifier group a different
    // answer once it tiered the regex up to native code. Write the casings out ([Mm][Ii]...).
    const inline = /\(\?-?[ims]+(?:-[ims]+)?:/;
    const hits = filesUnder(join(root, "src")).flatMap((path) => readFileSync(path, "utf8").split("\n")
      .flatMap((line, i) => inline.test(line) ? [`${path.slice(root.length + 1)}:${i + 1}`] : []));
    assert.deepEqual(hits, [], "no inline regex modifier group in scene-engine src");
  });
}

/* ------------------------------------------------------------------ mutants */

function patchFile(path: string, from: string, to: string): void {
  const text = readFileSync(path, "utf8");
  assert.ok(text.includes(from), `mutation anchor ${from.slice(0, 60)} in ${path}`);
  const next = text.split(from).join(to);
  assert.notEqual(next, text, `mutation of ${path} changed nothing`);
  writeFileSync(path, next);
}

/** Each fix switched off, as main had it (the negator case blind, written deterministically). */
const FIXES: Record<DeclineRow["fix"], (src: string) => void> = {
  negator: (src) => patchFile(join(src, "chemistry/speciesChargeGuard.ts"),
    "const NEGATOR = String.raw`(?:\\b(?:no|not|without|excluding|except|nor|neither)|^\\s*(?:No|Not|Without|Excluding|Except|Nor|Neither))`;",
    "const NEGATOR = String.raw`\\b(?:[Nn][Oo]|[Nn][Oo][Tt]|[Ww][Ii][Tt][Hh][Oo][Uu][Tt]|[Ee][Xx][Cc][Ll][Uu][Dd][Ii][Nn][Gg]|[Ee][Xx][Cc][Ee][Pp][Tt]|[Nn][Oo][Rr]|[Nn][Ee][Ii][Tt][Hh][Ee][Rr])`;"),
  diatomic: (src) => patchFile(join(src, "chemistry/moDiagram.ts"), "if (nonDiatomicSpeciesWritten(question)) return null;", "if ((() => false)()) return null;"),
  "lane-vsepr": (src) => patchFile(join(src, "chemistry/vsepr.ts"), "  return chargedRoutingSpecies(question);\n}", "  return [];\n}"),
  "lane-magnetism": (src) => patchFile(join(src, "chemistry/classify.ts"), "else if (ionMagnetismContext(stem, originalQuestion))", "else if ((() => false)())"),
  // Not main's behaviour (main was case blind through an inline group); the sweep leaves it on.
  "case-blind": (src) => patchFile(join(src, "chemistry/speciesChargeGuard.ts"), "return [...word].map((letter) => `[${letter.toUpperCase()}${letter.toLowerCase()}]`).join(\"\");", "return word;"),
};

function copyWith(name: string, patch: (src: string) => void): string {
  const dir = mkdtempSync(join(packageRoot, `.charged-declines-${name}-`));
  cpSync(join(packageRoot, "src"), join(dir, "src"), { recursive: true });
  patch(join(dir, "src"));
  return dir;
}

function runChild(dir: string, extra: string[], nodeFlags: string[] = []): { stdout: string; stderr: string } {
  const out = spawnSync(process.execPath, [...nodeFlags, ...process.execArgv, fileURLToPath(import.meta.url), "--root", dir, ...extra], { encoding: "utf8", cwd: packageRoot, maxBuffer: 1 << 28 });
  return { stdout: out.stdout, stderr: out.stderr };
}

function failedIds(dir: string, nodeFlags: string[] = [], extra: string[] = []): string[] {
  const { stdout, stderr } = runChild(dir, ["--json", ...extra], nodeFlags);
  const report = JSON.parse(stdout.trim().split("\n").pop() ?? "{}") as { results?: Array<{ id: string; passed: boolean }> };
  assert.ok(report.results, `child produced no report: ${stderr.slice(0, 300)}`);
  return report.results.filter((row) => !row.passed).map((row) => row.id);
}

if (!child) {
  check("determinism/regex-interpreter-only", () => {
    const failed = failedIds(packageRoot, ["--regexp-interpret-all"]);
    assert.deepEqual(failed, [], "the rows give the same result with the regex interpreter only");
  });
  check("determinism/warm-after-sweep-stems", () => {
    const file = join(mkdtempSync(join(packageRoot, ".charged-declines-warm-")), "warm.json");
    try {
      const failed = failedIds(packageRoot, [], ["--warm", file]);
      assert.deepEqual(failed, [], `the rows pass after ${WARM_STEMS} sweep stems in one process`);
      const warmRows = JSON.parse(readFileSync(file, "utf8")) as SweepRow[];
      const moved = rowStems.filter((_, i) => JSON.stringify(warmRows[i]) !== JSON.stringify(coldRows[i]));
      assert.deepEqual(moved, [], "each row reads the same warm as cold");
    } finally {
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });
}

if (withMutants) {
  for (const [fix, patch] of Object.entries(FIXES) as Array<[DeclineRow["fix"], (src: string) => void]>) {
    check(`mutant/${fix}-off`, () => {
      const dir = copyWith(fix, patch);
      try {
        const failed = failedIds(dir);
        const owned = DECLINE.filter((row) => row.fix === fix);
        for (const row of owned) assert.ok(failed.includes(`decline/${row.id}`), `${fix} off must turn decline/${row.id} red`);
        const ownedLane = LANE.filter((row) => row.fix === fix).map((row) => `lane/${row.id}`);
        for (const id of ownedLane) assert.ok(failed.includes(id), `${fix} off must turn ${id} red`);
        assert.ok(failed.every((id) => id.startsWith("decline/") || ownedLane.includes(id)), `${fix} off touches only decline rows and its own lane rows: ${failed.join(", ")}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}

if (withSweep) {
  check("sweep/only-figures-lost", () => {
    const stems = sweepStems();
    const mine = stems.map(sweepRow);
    const dir = copyWith("off", (src) => { for (const [fix, patch] of Object.entries(FIXES)) if (fix !== "case-blind") patch(src); });
    let off: SweepRow[];
    try {
      const file = join(dir, "sweep.json");
      const { stderr } = runChild(dir, ["--sweep-only", file]);
      assert.ok(existsSync(file), `the fixes-off sweep wrote nothing: ${stderr.slice(0, 300)}`);
      off = JSON.parse(readFileSync(file, "utf8")) as SweepRow[];
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    assert.equal(off.length, stems.length, "sweep sizes agree");
    const gained: string[] = []; const leftLane: string[] = []; const unchargedMoved: string[] = []; let lost = 0;
    stems.forEach((stem, i) => {
      const a = mine[i]!; const b = off[i]!;
      if (a.drawn !== null && a.drawn !== b.drawn) gained.push(`${stem.slice(0, 70)}: ${b.drawn} -> ${a.drawn}`);
      if (a.drawn === null && b.drawn !== null) lost++;
      if (b.chemistry && !a.chemistry) leftLane.push(stem.slice(0, 70));
      if (!a.charged && a.route !== b.route) unchargedMoved.push(`${stem.slice(0, 70)}: ${b.route} -> ${a.route}`);
    });
    assert.deepEqual(gained, [], `figures gained or changed: ${gained.slice(0, 5).join("; ")}`);
    assert.deepEqual(leftLane, [], `stems that left the chemistry lane: ${leftLane.slice(0, 5).join("; ")}`);
    assert.deepEqual(unchargedMoved, [], `stems with no charge that route differently: ${unchargedMoved.slice(0, 5).join("; ")}`);
    assert.ok(lost >= DECLINE.length, `the sweep sees the review rows decline: ${lost} lost`);
  });
}

const report = {
  scope: "Charged species main drew wrong (NO read as the negator no, nitrite drawn as a diatomic, charged shape and magnetism stems sent to physics) decline; neutral and attached species still draw; only figures lost in the sweep.",
  passed: results.filter((row) => row.passed).length,
  failed: results.filter((row) => !row.passed).length,
  results,
};
if (jsonOut) console.log(JSON.stringify(report));
else {
  for (const row of results.filter((item) => !item.passed)) console.error(`FAIL ${row.id}: ${row.error}`);
  console.log(`verify-chemistry-charged-species-declines: ${report.passed} passed, ${report.failed} failed`);
}
if (report.failed) process.exitCode = 1;
