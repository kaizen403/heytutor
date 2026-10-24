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
 * The final checks copy the engine source and prove this gate goes red on
 * that copy: with the binder call removed; with the formula key flattening
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
  { name: "mo-superoxide", question: "MO diagram of O2^-", family: "chem_mo", bodies: [{ id: "o2", kind: "other", label: "O_2^(-) ion" }] },
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

interface Control { name: string; question: string; family: string; bodies: Body[]; connections?: Array<readonly [string, string]> }

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
  { name: "unbonded atoms claimed connected", question: "lewis structure of CO2", family: "chem_lewis", bodies: CO2_BODIES.slice(1),
    connections: [["oxygen1", "oxygen2"]] },
];

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

  test("mutation: a formula key that flattens charge into the characters binds oxide to superoxide", () => {
    const output = runMutant(
      join("chemistry", "obligationIdentity.ts"),
      "  return `${body} | ${charge}`;",
      "  return value.trim().replace(/\\s+/g, \"\").replace(/_(\\d+)/g, \"$1\").replace(/\\^\\(([^)]*)\\)/g, \"$1\").replace(/[\\^()[\\]]/g, \"\");",
    );
    assert.ok(output.includes("FAIL control oxide named on a superoxide MO diagram:"), "the oxide control must go red on the flattened key");
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
console.log(`\nchemistry obligation identity: ${passed} passed (${POSITIVE.length} positive rows, ${CONTROLS.length} controls${mutant ? ", mutant run" : ", 3 mutations"})`);
