/**
 * SN2, SN1 and E2 drawn from a turn plan's example reaction: the class
 * operators on the checked electron state, the figure built from them, and
 * the closed reader that binds a plan example to a topic question.
 *
 *   tsx scripts/verify/verify-chemistry-substitution.ts [--root <scene-engine dir>] [--no-mutants] [--json]
 *
 * Checks:
 *  - operators: SN2 runs one step of two arrows at a methyl or primary
 *    carbon only (secondary, tertiary and neopentyl decline) with a halide
 *    ion or an O- or S- anion carrying only C and H (IO-, ClO-, HSO-
 *    decline; a charged atom with two neighbours declines); a bulky
 *    alkoxide attacks only a methyl carbon and no O- base a primary carbon
 *    with a branched neighbour. SN1 runs ionisation (the sextet declared),
 *    capture and proton transfer at a tertiary carbon only, with two of
 *    one neutral solvent (water or a primary alcohol), the second taking
 *    the proton (the halide never does); a neighbour that could shift onto
 *    the cation, or a stereocentre, declines. E2 runs one step of three arrows with a hydroxide or
 *    alkoxide base; beta sites giving different alkenes, an E/Z alkene, or
 *    a stereocentre at a reacting carbon declines. The substrate is one
 *    saturated haloalkane with one C-X bond. The stated products must be
 *    exactly the species the arrows give.
 *  - arrows: a forged arrow either breaks the bookkeeping or gives other
 *    states, and the figure refuses the forged model.
 *  - figure: every drawn figure validates and compiles inside the board
 *    zone with one curly arrow per checked arrow; SN2 shows inversion and
 *    a transition state with exactly its forming and breaking bonds dashed
 *    and δ- on the atoms its charge moves between (every panel's shown
 *    charges add up to its species' total);
 *    SN1 shows the carbocation and the oxonium ion; narration counts the
 *    checked arrows; labels read back as their species; a product "+"
 *    never sits beside carbon; a figure too tall for the zone declines.
 *  - plan: the production question bcf546ce with a two reaction plan draws
 *    both rows with the plan provenance; the reader is closed (condition
 *    words, symbols, E1, species named in the question, a non chemistry
 *    question decline; dropped words, a kind word untrue of a named class,
 *    and anything after a class name outside a closed set decline), the
 *    plan gives exactly one example per class the
 *    question names, and one failing example declines the whole figure.
 *  - audit: board script subscripts in condensed formulas are not read as
 *    measured values by the shared displayed quantity audit; real values
 *    still are.
 *  - mutants: each guard switched off alone turns exactly its own rows red.
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
const child = rootFlag >= 0;
const jsonOut = argv.includes("--json") || child;
const withMutants = !argv.includes("--no-mutants") && !child;

await import(`${root}/src/chemistry/families.ts`);
const { readCondensed } = await import(`${root}/src/chemistry/organic/mechanism/condensed.ts`);
const { runMechanism } = await import(`${root}/src/chemistry/organic/mechanism/arrows.ts`);
const { formalCharge, neighbourAtoms, totalCharge, totalElectrons } = await import(`${root}/src/chemistry/organic/mechanism/state.ts`);
const { readEquation, sn2, substitutionFromEquation } = await import(`${root}/src/chemistry/organic/mechanism/substitution.ts`);
const { displayedSceneQuantityTexts, validateSceneQuantityAgreement } = await import(`${root}/src/contracts/contractsV3.ts`);
const { buildSubstitutionFigure, chargeShown, readsAsGroup, readsAsSpecies } = await import(`${root}/src/chemistry/organic/mechanism/substitutionFigure.ts`);
const { buildPlanExampleReactionDocument } = await import(`${root}/src/chemistry/organic/mechanism/planReaction.ts`);
const { pruneDeadSceneEntities, validateSceneDocument } = await import(`${root}/src/document/validation.ts`);
const { compileSceneDocument } = await import(`${root}/src/compile/compiler.ts`);

type Model = { mechanism: string; start: State; steps: Array<{ arrows: Array<{ tail: Record<string, number | string>; head: Record<string, number | string> }>; sextets?: number[] }>; states: State[]; products: State; roles: Record<string, number>; substrateAtoms: number[]; reagentAtoms: number[][] };
type State = { atoms: Array<{ element: string; lonePairs: number }>; bonds: Array<{ a: number; b: number; order: number }> };
type Doc = { entities: Array<{ id: string; kind: string; role?: string; label?: string }>; constructions: Array<{ id: string; operator: string; inputs: Record<string, unknown>; outputs: string[] }>; annotations: Array<{ id: string; text?: string }>; revealGroups: Array<{ id: string; entityIds: string[]; narrationCue: string }>; source: Record<string, unknown> };

const results: Array<{ id: string; ok: boolean; message?: string }> = [];
function check(id: string, body: () => void): void {
  try {
    body();
    results.push({ id, ok: true });
  } catch (error) {
    results.push({ id, ok: false, message: error instanceof Error ? error.message : String(error) });
  }
}

function ok(mechanism: string, equation: string): Model {
  const read = substitutionFromEquation(mechanism, equation);
  assert.ok(read.ok, `${mechanism} ${equation} draws (${read.ok ? "" : read.reason})`);
  const model = read.model as Model;
  for (const state of model.states) {
    assert.equal(totalElectrons(state), totalElectrons(model.start), "electrons are conserved");
    assert.equal(totalCharge(state), totalCharge(model.start), "charge is conserved");
  }
  return model;
}
function no(mechanism: string, equation: string, reason: RegExp): void {
  const read = substitutionFromEquation(mechanism, equation);
  assert.equal(read.ok, false, `${mechanism} ${equation} declines`);
  assert.match(read.reason, reason, `${mechanism} ${equation}: ${read.reason}`);
}
const reaction = (mechanism: string, equation: string) => {
  const read = substitutionFromEquation(mechanism, equation);
  assert.ok(read.ok, `${equation} reads`);
  return { model: read.model, equation: read.equation };
};
const plan = (...entries: Array<[string, string]>) => ({ exampleReactions: entries.map(([mechanism, equation]) => ({ mechanism, equation })) });

/** The figure validates and compiles, draws one multi point curve per checked arrow, and keeps every label in the board zone. */
function compiles(doc: Doc, arrows: number) {
  const validated = validateSceneDocument(pruneDeadSceneEntities(doc as unknown as Record<string, unknown>));
  assert.ok(validated.document, `validates: ${validated.report.issues.filter((issue: { severity: string }) => issue.severity === "fatal").map((issue: { code: string }) => issue.code).join(", ")}`);
  const compiled = compileSceneDocument(validated.document);
  assert.ok(compiled.ok, `compiles: ${compiled.report.issues.filter((issue: { severity: string }) => issue.severity === "fatal").map((issue: { code: string; message: string }) => `${issue.code} ${issue.message}`).join("; ")}`);
  const primitives = compiled.renderScene!.primitives as Array<{ kind: string; entityId: string; points: Array<{ x: number; y: number }>; provenance?: { labelBounds?: { x: number; y: number; width: number; height: number } } }>;
  const curly = primitives.filter((primitive) => primitive.kind === "vector" && /_arrow\d+$/.test(primitive.entityId) && primitive.points.length > 2);
  assert.equal(curly.length, arrows, "one multi point curly arrow per checked arrow");
  const boxes = primitives.flatMap((primitive) => (primitive.provenance?.labelBounds ? [{ id: primitive.entityId, box: primitive.provenance.labelBounds }] : []));
  boxes.forEach((a, index) => boxes.slice(index + 1).forEach((b) => {
    const apart = a.box.x + a.box.width <= b.box.x + 0.5 || b.box.x + b.box.width <= a.box.x + 0.5 || a.box.y + a.box.height <= b.box.y + 0.5 || b.box.y + b.box.height <= a.box.y + 0.5;
    assert.ok(apart, `labels ${a.id} and ${b.id} do not overlap`);
  }));
  for (const primitive of primitives) {
    const box = primitive.provenance?.labelBounds;
    if (box) assert.ok(box.x >= 400 && box.x + box.width <= 1160 && box.y >= 0 && box.y + box.height <= 700, `label ${primitive.entityId} inside the zone`);
    for (const point of primitive.points ?? []) assert.ok(point.x >= 400 && point.x <= 1160 && point.y >= 0 && point.y <= 700, `${primitive.entityId} inside the zone`);
  }
  return primitives;
}
function built(question: string, turnPlan: unknown): { doc: Doc; equations: string } {
  const read = buildPlanExampleReactionDocument(question, turnPlan);
  assert.equal(read.status, "built", `draws (${read.status}: ${"reason" in read ? read.reason : ""})`);
  return { doc: read.document as Doc, equations: read.equations };
}
function declined(question: string, turnPlan: unknown, reason?: RegExp): void {
  const read = buildPlanExampleReactionDocument(question, turnPlan);
  assert.equal(read.status, "declined", `${question} declines`);
  if (reason) assert.match(read.reason, reason, `${question}: ${read.reason}`);
}
const at = (doc: Doc, id: string): { x: number; y: number } => {
  const helper = doc.constructions.find((construction) => construction.outputs.includes(`${id}_p`));
  assert.ok(helper, `${id} has an anchor`);
  return helper.inputs as { x: number; y: number };
};
const labelOf = (doc: Doc, id: string): string => doc.entities.find((entity) => entity.id === id)?.label ?? "";
const atomsOf = (state: State, element: string): number[] => state.atoms.flatMap((atom, index) => (atom.element === element ? [index] : []));

const BCF = "Teach me SN1 and SN2 reactions from the very basics like a patient chemistry teacher. Draw the reaction mechanism on a whiteboard, show the structures of the molecules, use arrows to explain electron movement, and explain each step aloud in simple English. Compare SN1 and SN2 with examples and finish with a few viva questions.";
const SN2_METHYL = "CH3Br + OH- -> CH3OH + Br-";
/** The halide as the base: Br- deprotonating an oxonium ion is uphill, so this form declines. */
const SN1_ONE_WATER = "(CH3)3CBr + H2O -> (CH3)3COH + HBr";
const SN1_TBU = "(CH3)3CBr + 2 H2O -> (CH3)3COH + H3O+ + Br-";
const SN1_METHANOL = "(CH3)3CBr + 2 CH3OH -> (CH3)3COCH3 + CH3OH2+ + Br-";
const E2_PROPYL = "CH3CH(Br)CH3 + OH- -> CH3CH=CH2 + H2O + Br-";

/* ------------------------------------------------------------------------- */
/* Operators                                                                 */
/* ------------------------------------------------------------------------- */

check("sn2/methyl-draws", () => {
  const model = ok("SN2", SN2_METHYL);
  assert.equal(model.steps.length, 1, "one concerted step");
  const [attack, leave] = model.steps[0]!.arrows as [Model["steps"][0]["arrows"][0], Model["steps"][0]["arrows"][0]];
  assert.deepEqual(attack, { tail: { kind: "lone_pair", atom: model.roles.nucleophile }, head: { kind: "bond", a: model.roles.nucleophile, b: model.roles.alpha } }, "the nucleophile's lone pair to carbon");
  assert.deepEqual(leave, { tail: { kind: "bond", a: model.roles.alpha, b: model.roles.leaving }, head: { kind: "atom", atom: model.roles.leaving } }, "the C-Br pair to Br");
});
check("sn2/primary-draws", () => {
  for (const equation of ["CH3CH2Br + OH- -> CH3CH2OH + Br-", "CH3CH2Cl + CH3O- -> CH3CH2OCH3 + Cl-", "CH3Cl + I- -> CH3I + Cl-", "CH3CH2I + HS- -> CH3CH2SH + I-", "OH⁻ + CH3Br -> Br⁻ + CH3OH"]) ok("SN2", equation);
});
check("sn2/tertiary-declines", () => no("SN2", "(CH3)3CBr + OH- -> (CH3)3COH + Br-", /tertiary/));
check("sn2/secondary-declines", () => no("SN2", "CH3CH(Br)CH3 + OH- -> CH3CH(OH)CH3 + Br-", /secondary/));
check("sn2/neopentyl-declines", () => no("SN2", "(CH3)3CCH2Br + OH- -> (CH3)3CCH2OH + Br-", /neopentyl/));
check("sn2/neutral-nucleophile-declines", () => no("SN2", "CH3Br + H2O -> CH3OH2+ + Br-", /anion/));
check("sn2/two-sites-declines", () => no("SN2", "BrCH2CH2Br + OH- -> BrCH2CH2OH + Br-", /not unique/));
check("sn2/heteroatom-substrate-declines", () => no("SN2", "HOCH2CH2Br + OH- -> HOCH2CH2OH + Br-", /other than C, H/));
check("sn2/unsaturated-declines", () => no("SN2", "CH2=CHCH2Br + OH- -> CH2=CHCH2OH + Br-", /not saturated/));
check("sn2/nucleophile-atoms-declines", () => {
  for (const equation of ["CH3Br + IO- -> CH3OI + Br-", "CH3Br + ClO- -> CH3OCl + Br-", "CH3Br + BrO- -> CH3OBr + Br-", "CH3Br + HSO- -> CH3OSH + Br-"]) no("SN2", equation, /other than C and H/);
});
check("sn2/charged-atom-one-neighbour", () => {
  // ICl2-: the charged I has two neighbours. The condensed reader does not write it, so the state is built by hand.
  const dichloroiodate = { atoms: [{ element: "I", lonePairs: 3 }, { element: "Cl", lonePairs: 3 }, { element: "Cl", lonePairs: 3 }], bonds: [{ a: 0, b: 1, order: 1 }, { a: 0, b: 2, order: 1 }] };
  assert.equal(formalCharge(dichloroiodate, 0), -1, "the forged anion is charged on I");
  const read = sn2(readCondensed("CH3Br")!, dichloroiodate);
  assert.equal(read.ok, false, "a charged atom with two neighbours is not drawn");
  assert.match(read.reason, /more than one neighbour/);
});
check("sn2/bulky-alkoxide-declines", () => {
  for (const equation of ["CH3CH2Br + (CH3)3CO- -> CH3CH2OC(CH3)3 + Br-", "CH3CH2Br + (CH3)2CHO- -> CH3CH2OCH(CH3)2 + Br-"]) no("SN2", equation, /bulky/);
  ok("SN2", "CH3Br + (CH3)3CO- -> CH3OC(CH3)3 + Br-");
  ok("SN2", "CH3CH2Br + CH3CH2CH2O- -> CH3CH2OCH2CH2CH3 + Br-");
});
check("sn2/beta-branched-declines", () => {
  for (const equation of ["(CH3)2CHCH2Br + CH3O- -> (CH3)2CHCH2OCH3 + Br-", "(CH3)2CHCH2Br + OH- -> (CH3)2CHCH2OH + Br-"]) no("SN2", equation, /branched carbon next/);
  no("SN2", "(CH3)2CHCH2Br + (CH3)3CO- -> (CH3)2CHCH2OC(CH3)3 + Br-", /bulky|branched carbon next/);
  ok("SN2", "(CH3)2CHCH2Br + I- -> (CH3)2CHCH2I + Br-");
  ok("SN2", "(CH3)2CHCH2Br + HS- -> (CH3)2CHCH2SH + Br-");
});
check("sn2/wrong-product-declines", () => {
  no("SN2", "CH3Br + OH- -> CH3O- + HBr", /stated products/);
  no("SN2", "CH3CH2Br + OH- -> CH2=CH2 + H2O + Br-", /stated products/);
});

check("sn1/tertiary-draws", () => {
  const model = ok("SN1", SN1_TBU);
  assert.equal(model.steps.length, 3, "ionisation, capture, proton transfer");
  assert.deepEqual(model.steps.map((step) => step.arrows.length), [1, 1, 2]);
  assert.deepEqual(model.steps[0]!.sextets, [model.roles.alpha], "the carbocation is declared in step 1 only");
  assert.ok(!model.steps[1]!.sextets && !model.steps[2]!.sextets);
  assert.equal(formalCharge(model.states[1]!, model.roles.alpha), 1, "C+ after ionisation");
  assert.equal(formalCharge(model.states[2]!, model.roles.nucleophile), 1, "an oxonium ion after capture");
  assert.ok(model.reagentAtoms[1]!.includes(model.roles.base), "the second water takes the proton");
});
check("sn1/halide-base-declines", () => {
  no("SN1", SN1_ONE_WATER, /two solvent molecules/);
  no("SN1", "(CH3)3CBr + CH3OH -> (CH3)3COCH3 + HBr", /two solvent molecules/);
});
check("sn1/solvents-differ-declines", () => no("SN1", "(CH3)3CBr + H2O + CH3OH -> (CH3)3COH + CH3OH2+ + Br-", /differ/));
check("sn1/branched-alcohol-declines", () => {
  no("SN1", "(CH3)3CBr + 2 (CH3)3COH -> (CH3)3COC(CH3)3 + (CH3)3COH2+ + Br-", /secondary or tertiary alcohol/);
  no("SN1", "(CH3)3CBr + 2 (CH3)2CHOH -> (CH3)3COCH(CH3)2 + (CH3)2CHOH2+ + Br-", /secondary or tertiary alcohol/);
});
check("sn1/second-solvent-takes-proton", () => {
  const model = ok("SN1", SN1_TBU);
  assert.notEqual(model.roles.base, model.roles.leaving, "the second water takes the proton");
});
check("sn1/alcohol-draws", () => {
  ok("SN1", SN1_METHANOL);
  ok("SN1", "(CH3)3CBr + 2 CH3CH2OH -> (CH3)3COCH2CH3 + CH3CH2OH2+ + Br-");
  ok("SN1", "CH3CH2C(CH3)2Br + 2 H2O -> CH3CH2C(CH3)2OH + H3O+ + Br-");
});
check("sn1/primary-declines", () => no("SN1", "CH3CH2Br + 2 H2O -> CH3CH2OH + H3O+ + Br-", /primary/));
check("sn1/secondary-declines", () => no("SN1", "CH3CH(Br)CH3 + 2 H2O -> CH3CH(OH)CH3 + H3O+ + Br-", /secondary/));
check("sn1/shift-declines", () => no("SN1", "(CH3)2CHC(CH3)2Br + 2 H2O -> (CH3)2CHC(CH3)2OH + H3O+ + Br-", /shift/));
check("sn1/chiral-declines", () => no("SN1", "CH3CH2C(CH3)(Br)CH2CH2CH3 + 2 H2O -> CH3CH2C(CH3)(OH)CH2CH2CH3 + H3O+ + Br-", /stereocentre/));
check("sn1/anion-nucleophile-declines", () => no("SN1", "(CH3)3CBr + 2 OH- -> (CH3)3COH + H2O + Br-", /neutral O-H/));
check("sn1/wrong-product-declines", () => {
  no("SN1", "(CH3)3CBr + 2 H2O -> (CH3)3COH + HBr + H2O", /stated products/);
  no("SN1", "(CH3)3CBr + 2 H2O -> (CH3)2C=CH2 + H3O+ + H2O + Br-", /stated products/);
});

check("e2/draws", () => {
  const model = ok("E2", E2_PROPYL);
  const { base, proton, beta, alpha, leaving } = model.roles;
  assert.deepEqual(model.steps[0]!.arrows, [
    { tail: { kind: "lone_pair", atom: base }, head: { kind: "bond", a: base, b: proton } },
    { tail: { kind: "bond", a: beta, b: proton }, head: { kind: "bond", a: beta, b: alpha } },
    { tail: { kind: "bond", a: alpha, b: leaving }, head: { kind: "atom", atom: leaving } },
  ], "base to H, C-H to C=C, C-Br to Br");
  ok("E2", "(CH3)3CBr + CH3CH2O- -> (CH3)2C=CH2 + CH3CH2OH + Br-");
  ok("E2", "CH3CH2CH2Br + (CH3)3CO- -> CH3CH=CH2 + (CH3)3COH + Br-");
  ok("E2", "(CH3)3CBr + OH- -> (CH3)2C=CH2 + H2O + Br-");
});
check("e2/primary-unhindered-declines", () => {
  // Bromoethane with hydroxide or ethoxide gives mostly substitution: E2 is not the outcome.
  for (const equation of ["CH3CH2Br + OH- -> CH2=CH2 + H2O + Br-", "CH3CH2Br + CH3CH2O- -> CH2=CH2 + CH3CH2OH + Br-", "CH3CH2CH2Br + CH3O- -> CH3CH=CH2 + CH3OH + Br-"]) {
    no("E2", equation, /mostly substitution/);
  }
});
check("e2/two-alkenes-declines", () => no("E2", "CH3CH2CH(Br)CH3 + OH- -> CH3CH=CHCH3 + H2O + Br-", /different alkenes/));
check("e2/ez-declines", () => no("E2", "CH3CH2CH(Br)CH2CH3 + OH- -> CH3CH=CHCH2CH3 + H2O + Br-", /E and Z/));
check("e2/stereocentre-declines", () => no("E2", "CH3CH2CH(CH3)CH2Br + (CH3)3CO- -> CH3CH2C(CH3)=CH2 + (CH3)3COH + Br-", /stereocentre/));
check("e2/no-beta-declines", () => no("E2", SN2_METHYL, /no hydrogen/));
check("e2/weak-base-declines", () => no("E2", "CH3CH(Br)CH3 + I- -> CH3CH=CH2 + HI + Br-", /hydroxide or alkoxide/));
check("e2/wrong-product-declines", () => no("E2", "CH3CH(Br)CH3 + OH- -> CH3CH(OH)CH3 + Br-", /stated products/));

check("equation/reader", () => {
  assert.equal(readEquation("CH3Br+OH-->CH3OH+Br-"), null, "an unspaced arrow is not read");
  assert.equal(readEquation("CH3Br + 4 H2O -> CH3OH + HBr"), null, "a coefficient above three is not read");
  assert.equal(readEquation("CH3Br + OH- -> CH3OH + Br- -> X"), null, "one arrow");
  assert.equal(readEquation("C2H5Br + OH- -> C2H5OH + Br-"), null, "a molecular formula names no structure");
  assert.ok(readEquation("CH₃Br + OH⁻ → CH₃OH + Br⁻"), "board notation reads");
  no("SN2", "CH3Br + NaOH -> CH3OH + NaBr", /does not read/);
});

/* ------------------------------------------------------------------------- */
/* Arrows                                                                    */
/* ------------------------------------------------------------------------- */

check("arrows/forged-arrow-refused", () => {
  const { model, equation } = reaction("SN2", SN2_METHYL);
  const m = model as Model;
  const hydrogen = neighbourAtoms(m.start, m.roles.alpha).find((atom: number) => m.start.atoms[atom]!.element === "H")!;
  // A C-H pair to H instead of the C-Br pair to Br: the bookkeeping holds (a hydride leaves), but the states differ.
  const swapped = { ...m, steps: [{ arrows: [m.steps[0]!.arrows[0]!, { tail: { kind: "bond", a: m.roles.alpha, b: hydrogen }, head: { kind: "atom", atom: hydrogen } }] }] };
  assert.ok(runMechanism(m.start, swapped.steps).ok, "the forged step itself runs");
  // A lone pair carbon does not have.
  const impossible = { ...m, steps: [{ arrows: [{ tail: { kind: "lone_pair", atom: m.roles.alpha }, head: { kind: "bond", a: m.roles.alpha, b: m.roles.nucleophile } }, m.steps[0]!.arrows[1]!] }] };
  assert.equal(runMechanism(m.start, impossible.steps).ok, false, "carbon has no lone pair to give");
  for (const forged of [swapped, impossible]) assert.equal(buildSubstitutionFigure({ question: "Explain the SN2 mechanism.", reactions: [{ model: forged, equation }] }), null, "the figure refuses a forged model");
  assert.ok(buildSubstitutionFigure({ question: "Explain the SN2 mechanism.", reactions: [{ model, equation }] }), "the true model draws");
});

/* ------------------------------------------------------------------------- */
/* Figure                                                                    */
/* ------------------------------------------------------------------------- */

const figure = (question: string, ...entries: Array<[string, string]>): Doc => {
  const doc = buildSubstitutionFigure({ question, reactions: entries.map(([mechanism, equation]) => reaction(mechanism, equation)) }, (why: string) => { throw new Error(`figure declined: ${why}`); });
  assert.ok(doc);
  return doc as Doc;
};

check("figure/compiles", () => {
  compiles(figure("Explain the SN2 mechanism.", ["SN2", "CH3CH2Br + OH- -> CH3CH2OH + Br-"]), 2);
  compiles(figure("Explain the SN2 mechanism.", ["SN2", "CH3CH2Cl + CH3O- -> CH3CH2OCH3 + Cl-"]), 2);
  compiles(figure("Explain the SN1 mechanism.", ["SN1", SN1_TBU]), 4);
  compiles(figure("Explain the SN1 mechanism.", ["SN1", SN1_METHANOL]), 4);
  compiles(figure("Explain the E2 mechanism.", ["E2", E2_PROPYL]), 3);
  compiles(figure("Explain the E2 mechanism.", ["E2", "(CH3)3CBr + CH3CH2O- -> (CH3)2C=CH2 + CH3CH2OH + Br-"]), 3);
  compiles(figure("Compare SN2 and E2.", ["SN2", "CH3Cl + I- -> CH3I + Cl-"], ["E2", E2_PROPYL]), 5);
});
check("figure/inversion", () => {
  const { model } = reaction("SN2", "CH3CH2Br + OH- -> CH3CH2OH + Br-");
  const m = model as Model;
  const doc = figure("Explain the SN2 mechanism.", ["SN2", "CH3CH2Br + OH- -> CH3CH2OH + Br-"]);
  const groups = neighbourAtoms(m.start, m.roles.alpha).filter((atom: number) => atom !== m.roles.leaving);
  const styleOf = (panel: string, atom: number): string => {
    const [a, b] = [Math.min(atom, m.roles.alpha), Math.max(atom, m.roles.alpha)];
    return doc.entities.find((entity) => entity.id === `rx0p${panel}_b${a}_${b}`)?.role ?? "";
  };
  for (const group of groups) {
    const before = at(doc, `rx0p0_a${group}`).x - at(doc, `rx0p0_a${m.roles.alpha}`).x;
    const after = at(doc, `rx0p2_a${group}`).x - at(doc, `rx0p2_a${m.roles.alpha}`).x;
    assert.ok(before < 0 && after > 0, "each group swings from the nucleophile's side to the far side");
    assert.equal(/wedge/.test(styleOf("0", group)), /wedge/.test(styleOf("2", group)), "a wedge stays a wedge");
    assert.equal(/dash/.test(styleOf("0", group)), /dash/.test(styleOf("2", group)), "a dash stays a dash");
  }
  assert.ok(at(doc, `rx0p0_a${m.roles.nucleophile}`).x < at(doc, `rx0p0_a${m.roles.alpha}`).x && at(doc, `rx0p0_a${m.roles.leaving}`).x > at(doc, `rx0p0_a${m.roles.alpha}`).x, "attack from the side opposite the leaving group");
});
check("figure/transition-state", () => {
  const { model } = reaction("SN2", SN2_METHYL);
  const m = model as Model;
  const doc = figure("Explain the SN2 mechanism.", ["SN2", SN2_METHYL]);
  const partial = doc.entities.filter((entity) => entity.id.startsWith("rx0p1_") && entity.role === "partial bond in the transition state").map((entity) => entity.id).sort();
  const key = (a: number, b: number): string => `rx0p1_b${Math.min(a, b)}_${Math.max(a, b)}_partial`;
  assert.deepEqual(partial, [key(m.roles.nucleophile, m.roles.alpha), key(m.roles.alpha, m.roles.leaving)].sort(), "exactly the forming and the breaking bond are dashed");
  assert.ok(!doc.entities.some((entity) => entity.id === `rx0p1_b${Math.min(m.roles.alpha, m.roles.leaving)}_${Math.max(m.roles.alpha, m.roles.leaving)}`), "no solid C-Br in the transition state");
  assert.ok(doc.entities.some((entity) => entity.id === "rx0_dagger" && entity.label === "‡"));
  assert.ok(doc.entities.filter((entity) => entity.id.startsWith("rx0p1_a")).every((entity) => !/\^\(/.test(entity.label ?? "")), "no formal charge in the transition state");
  // The reactants carry minus one overall: the transition state shows it as δ- on the atoms the charge moves between.
  const deltas = doc.entities.filter((entity) => /^rx0p1_d\d+$/.test(entity.id)).map((entity) => `${entity.id}=${entity.label}`).sort();
  assert.deepEqual(deltas, [`rx0p1_d${m.roles.nucleophile}=δ^(-)`, `rx0p1_d${m.roles.leaving}=δ^(-)`].sort(), "δ- on the nucleophile and on the leaving group, nowhere else");
  for (const atom of [m.roles.nucleophile, m.roles.leaving]) assert.ok(at(doc, `rx0p1_d${atom}`).y > at(doc, `rx0p1_a${atom}`).y && Math.abs(at(doc, `rx0p1_d${atom}`).x - at(doc, `rx0p1_a${atom}`).x) < 1e-9, "each δ sits over its atom");
  assert.match(doc.revealGroups.find((group) => group.id === "rx0_panel1")?.narrationCue ?? "", /δ− on O and on Br/);
  compiles(doc, 2);
});
/** Forged panels for the charge check: each drawn atom labelled alone unless `labels` says otherwise. */
const sn2States = (): { s0: State; s1: State; m: Model } => {
  const m = reaction("SN2", SN2_METHYL).model as Model;
  return { s0: m.states[0]!, s1: m.states[1]!, m };
};
const alone = (atoms: number[]) => new Map(atoms.map((atom) => [atom, { covers: [atom] }]));
const allAtoms = (state: State): number[] => state.atoms.map((_, index) => index);
const charge = (spec: Record<string, unknown>, labels: Map<number, { covers: number[] }>): Map<number, number> | string => chargeShown({ species: [], ...spec }, labels);
check("figure/charge-label-sign", () => {
  const { s0, m } = sn2States();
  const hydrogen = neighbourAtoms(s0, m.roles.nucleophile).find((atom: number) => s0.atoms[atom]!.element === "H")!;
  const labels = alone(allAtoms(s0).filter((atom) => atom !== m.roles.nucleophile));
  labels.set(hydrogen, { covers: [hydrogen, m.roles.nucleophile] });
  assert.match(String(charge({ state: s0, charges: true, covers: allAtoms(s0) }, labels)), /a label's sign is not the charge/, "an H label covering the O- would hide the charge");
  assert.ok(charge({ state: s0, charges: true, covers: allAtoms(s0) }, alone(allAtoms(s0))) instanceof Map, "true labels hold");
});
check("figure/charge-total", () => {
  const { s0, m } = sn2States();
  assert.match(String(charge({ state: s0, charges: true, covers: allAtoms(s0) }, alone(allAtoms(s0).filter((atom) => atom !== m.roles.nucleophile)))), /do not add up/, "an unlabelled O- leaves the shown charge short of the total");
});
check("figure/charge-species", () => {
  const oxide = { atoms: [{ element: "O", lonePairs: 4 }], bonds: [] };
  assert.equal(formalCharge(oxide, 0), -2);
  assert.match(String(charge({ state: oxide, charges: true, covers: [0], species: [{ atoms: [0] }] }, new Map())), /species label's sign/, "a species label shows only a sign, so a 2- species is not drawn");
});
check("figure/ts-keeps-charge", () => {
  const { s0 } = sn2States();
  assert.match(String(charge({ state: s0, charges: false, covers: allAtoms(s0), after: s0 }, alone(allAtoms(s0)))), /keeps its charge/);
});
check("figure/ts-unit-move", () => {
  const { s0, m } = sn2States();
  const substrate = m.substrateAtoms;
  const after = { atoms: s0.atoms.map((atom, index) => ({ ...atom, lonePairs: index === m.roles.leaving ? 5 : atom.lonePairs })), bonds: s0.bonds };
  assert.match(String(charge({ state: s0, charges: false, covers: substrate, after }, alone(substrate))), /not one unit/);
});
check("figure/ts-unlabelled", () => {
  const { s0, s1, m } = sn2States();
  assert.match(String(charge({ state: s0, charges: false, covers: allAtoms(s0), after: s1 }, alone(allAtoms(s0).filter((atom) => atom !== m.roles.leaving)))), /does not label/);
});
check("figure/ts-accounting", () => {
  const { s0, s1, m } = sn2States();
  // The substrate alone is neutral, yet its Br gains a charge: one δ- cannot account for a neutral total.
  assert.match(String(charge({ state: s0, charges: false, covers: m.substrateAtoms, after: s1 }, alone(m.substrateAtoms))), /do not account/);
  const deltas = charge({ state: s0, charges: false, covers: allAtoms(s0), after: s1 }, alone(allAtoms(s0)));
  assert.ok(deltas instanceof Map && deltas.size === 2 && [...deltas.values()].every((sign) => sign === -1), "the true SN2 transition state: δ- on O and on Br");
});
check("figure/sn1-intermediates", () => {
  const { model } = reaction("SN1", SN1_TBU);
  const m = model as Model;
  const doc = figure("Explain the SN1 mechanism.", ["SN1", SN1_TBU]);
  assert.equal(labelOf(doc, `rx0p1_a${m.roles.alpha}`), "C^(+)", "the carbocation carries the charge");
  assert.equal(labelOf(doc, `rx0p2_a${m.roles.nucleophile}`), "O^(+)", "the oxonium ion carries the charge");
  const centre = at(doc, `rx0p1_a${m.roles.alpha}`);
  const angles = neighbourAtoms(m.states[1]!, m.roles.alpha).map((atom: number) => {
    const p = at(doc, `rx0p1_a${atom}`);
    return (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI;
  }).sort((a: number, b: number) => a - b);
  assert.equal(angles.length, 3);
  for (let index = 0; index < 3; index += 1) assert.ok(Math.abs(((angles[(index + 1) % 3]! - angles[index]! + 360) % 360) - 120) < 1, "the cation is drawn flat, its groups 120 degrees apart");
  assert.equal(labelOf(doc, `rx0p0_a${m.roles.alpha}`), "(CH_3)_3C", "the substrate's groups fold into one checked label");
});
check("figure/narration", () => {
  for (const [mechanism, equation] of [["SN2", SN2_METHYL], ["SN1", SN1_TBU], ["SN1", SN1_TBU], ["E2", E2_PROPYL]] as const) {
    const { model } = reaction(mechanism, equation);
    const doc = figure(`Explain the ${mechanism} mechanism.`, [mechanism, equation]);
    const arrowGroups = doc.revealGroups.filter((group) => /_arrows\d+$/.test(group.id));
    assert.equal(arrowGroups.length, (model as Model).steps.length, "one arrow reveal per step");
    arrowGroups.forEach((group, index) => {
      const count = (model as Model).steps[index]!.arrows.length;
      assert.ok(group.narrationCue.startsWith(`${count} curly arrow${count === 1 ? "" : "s"}`), `${group.narrationCue} counts ${count}`);
      assert.equal(group.entityIds.filter((id) => /_arrow\d+$/.test(id)).length, count, "the group draws exactly its step's arrows");
      const lonePairs = (model as Model).steps[index]!.arrows.filter((arrow) => arrow.tail.kind === "lone_pair").length;
      assert.equal(group.entityIds.filter((id) => /_lp\d+_1$/.test(id)).length, lonePairs, "lone pair dots at every lone pair tail, and nowhere else");
    });
  }
});
check("figure/titles-caption", () => {
  const doc = figure(BCF, ["SN2", SN2_METHYL], ["SN1", SN1_TBU]);
  assert.equal(labelOf(doc, "rx0_title"), "SN2 (example)");
  assert.equal(labelOf(doc, "rx1_title"), "SN1 (example)");
  const caption = doc.annotations.find((annotation) => annotation.id === "figure_caption")?.text ?? "";
  assert.match(caption, /^SN2 example: CH₃Br \+ OH⁻; SN1 example: \(CH₃\)₃CBr \+ 2 H₂O\./);
});
check("figure/species-labels", () => {
  const doc = figure(BCF, ["SN2", SN2_METHYL], ["SN1", SN1_TBU]);
  const species = (prefix: string): string[] => doc.entities.filter((entity) => new RegExp(`^${prefix}_s\\d+$`).test(entity.id)).map((entity) => entity.label ?? "").sort();
  assert.deepEqual(species("rx1p1"), ["Br^(-)"], "the halide that left");
  assert.deepEqual(species("rx1p3"), ["(CH_3)_3COH", "Br^(-)", "H_3O^(+)"].sort(), "the SN1 products");
  const water = doc.entities.filter((entity) => /^rx1p1_a\d+$/.test(entity.id)).map((entity) => entity.label);
  assert.ok(water.includes("OH_2"), "the water nucleophile");
  const methanol = figure("Explain the SN1 mechanism.", ["SN1", SN1_METHANOL]);
  assert.deepEqual(methanol.entities.filter((entity) => /^rx0p3_s\d+$/.test(entity.id)).map((entity) => entity.label).sort(), ["(CH_3)_3COCH_3", "Br^(-)", "CH_3OH_2^(+)"].sort());
});
check("figure/plus-clear", () => {
  const { model } = reaction("SN2", "CH3CH2Br + OH- -> CH3CH2OH + Br-");
  const m = model as Model;
  const primitives = compiles(figure("Explain the SN2 mechanism.", ["SN2", "CH3CH2Br + OH- -> CH3CH2OH + Br-"]), 2);
  const box = (id: string) => primitives.find((primitive) => primitive.entityId === id && primitive.provenance?.labelBounds)!.provenance!.labelBounds!;
  const plus = box("rx0p2_plus0");
  for (const group of neighbourAtoms(m.states[1]!, m.roles.alpha).filter((atom: number) => atom !== m.roles.nucleophile)) {
    const label = box(`rx0p2_a${group}`);
    assert.ok(plus.x > label.x + label.width, "the product plus clears every group, never reading as a charge on carbon");
  }
});
check("figure/label-readback", () => {
  const ethyl = readCondensed("CH3CH2Br")!;
  const bromine = atomsOf(ethyl, "Br")[0]!;
  const alpha = neighbourAtoms(ethyl, bromine)[0]!;
  const methyl = neighbourAtoms(ethyl, alpha).find((atom: number) => ethyl.atoms[atom]!.element === "C")!;
  assert.ok(readsAsGroup("CH3", "right", ethyl, methyl, alpha), "CH3 is the methyl");
  assert.equal(readsAsGroup("CH2CH3", "right", ethyl, methyl, alpha), false, "CH2CH3 is not the methyl");
  const tbu = readCondensed("(CH3)3CBr")!;
  const tertiary = neighbourAtoms(tbu, atomsOf(tbu, "Br")[0]!)[0]!;
  assert.ok(readsAsGroup("(CH3)3C", "left", tbu, tertiary, atomsOf(tbu, "Br")[0]!));
  assert.equal(readsAsGroup("(CH3)2CH", "left", tbu, tertiary, atomsOf(tbu, "Br")[0]!), false);
  assert.ok(readsAsSpecies("CH3OH", readCondensed("CH3OH")!));
  assert.equal(readsAsSpecies("CH3OH", readCondensed("CH3CH2OH")!), false, "methanol is not ethanol");
  assert.equal(readsAsSpecies("H3O+", readCondensed("H2O")!), false);
});
check("figure/too-big-declines", () => {
  let reason = "";
  const doc = buildSubstitutionFigure({ question: "Compare SN1 and SN2.", reactions: [reaction("SN2", "CH3CH2Br + CH3O- -> CH3CH2OCH3 + Br-"), reaction("SN1", SN1_METHANOL)] }, (why: string) => { reason = why; });
  assert.ok(doc === null, "two rows that do not fit the zone at the smallest board scale decline");
  assert.match(reason, /more than the 612 x 427 px zone/);
});

/* ------------------------------------------------------------------------- */
/* Plan                                                                      */
/* ------------------------------------------------------------------------- */

check("plan/bcf546ce-draws-both", () => {
  const { doc, equations } = built(BCF, plan(["SN2", ` ${SN2_METHYL} `], ["SN1", SN1_TBU]));
  assert.equal(equations, `${SN2_METHYL}; ${SN1_TBU}`, "the plan's equations, trimmed, joined by '; '");
  assert.equal(doc.source.figureProvenance, "plan_example");
  assert.equal(doc.source.exampleSpecies, equations);
  assert.equal(doc.source.question, BCF);
  assert.deepEqual((doc.source.mechanism as { reactions: string[] }).reactions, ["SN2", "SN1"]);
  compiles(doc, 2 + 4);
  assert.ok(labelOf(doc, "rx0_title") === "SN2 (example)" && labelOf(doc, "rx1_title") === "SN1 (example)", "one row per reaction");
});
check("plan/none", () => {
  for (const turnPlan of [{}, { exampleReactions: [] }, { exampleReactions: null }, null, "plan"]) assert.equal(buildPlanExampleReactionDocument(BCF, turnPlan).status, "none");
});
check("plan/malformed", () => {
  declined(BCF, plan(["SN2", SN2_METHYL], ["SN1", SN1_TBU], ["E2", E2_PROPYL]), /more than two/);
  declined(BCF, { exampleReactions: [{ mechanism: "SN2" }] }, /lacks/);
  declined(BCF, plan(["E1", SN1_TBU]), /lacks/);
  declined(BCF, { exampleReactions: [{ mechanism: "SN2", equation: `${SN2_METHYL}${" ".repeat(80)}` }] }, /lacks/);
});
check("plan/duplicate-class", () => declined("Explain the SN2 mechanism.", plan(["SN2", SN2_METHYL], ["SN2", "CH3Cl + I- -> CH3I + Cl-"]), /two examples of one class/));
check("plan/not-chemistry", () => declined("Explain the basics.", plan(["SN2", SN2_METHYL]), /not a chemistry question/));
check("plan/species-named", () => {
  declined("Explain the SN2 reaction of CH3Br.", plan(["SN2", SN2_METHYL]), /names its own species/);
  declined("Explain the SN1 reaction of tert-butyl bromide.", plan(["SN1", SN1_TBU]));
});
check("plan/vocabulary-declines", () => {
  for (const question of [
    "Explain SN2 reactions of tertiary halides.",
    "Why does SN2 not happen at a tertiary carbon?",
    "Explain SN1 with racemisation.",
    "Show the inversion in SN2.",
    "Explain the SN1 carbocation rearrangement.",
    "Explain SN1 and SN2 reactions of primary alkyl halides.",
    "Compare the rates of SN1 and SN2.",
    "Explain SN2 in a polar aprotic solvent.",
    "Explain SN2 with 2 examples.",
    "Explain why E2 fails with a weak base.",
    "Explain SN2, not SN1.",
    "Draw the SN2 mechanism with no inversion.",
    "Explain chiral SN2 reactions.",
  ]) {
    const named = /SN1/.test(question) && /SN2/.test(question) ? plan(["SN2", SN2_METHYL], ["SN1", SN1_TBU]) : /E2/.test(question) ? plan(["E2", E2_PROPYL]) : /SN1/.test(question) ? plan(["SN1", SN1_TBU]) : plan(["SN2", SN2_METHYL]);
    declined(question, named);
  }
});
check("plan/symbols-decline", () => {
  declined("Explain SN2 reactions > SN1 reactions.", plan(["SN2", SN2_METHYL], ["SN1", SN1_TBU]), /symbol/);
  declined("Explain the (bimolecular) SN2 reactions.", plan(["SN2", SN2_METHYL]), /symbol/);
  declined("Explain SN2 reactions = SN1 reactions.", plan(["SN2", SN2_METHYL], ["SN1", SN1_TBU]), /symbol/);
});
check("plan/vocabulary-accepts", () => {
  for (const [question, turnPlan] of [
    ["Explain the SN2 mechanism.", plan(["SN2", SN2_METHYL])],
    ["Explain the SN1 mechanism.", plan(["SN1", SN1_TBU])],
    ["Explain SN1 or SN2 reactions, with examples.", plan(["SN1", SN1_TBU], ["SN2", SN2_METHYL])],
    ["Explain E2 elimination reactions.", plan(["E2", E2_PROPYL])],
    ["Explain SN1 and SN2 with examples.", plan(["SN1", SN1_TBU], ["SN2", SN2_METHYL])],
    ["Explain E2 elimination reactions with curly arrows.", plan(["E2", E2_PROPYL])],
    ["Explain sn2 nucleophilic substitution step by step.", plan(["SN2", SN2_METHYL])],
  ] as const) built(question, turnPlan);
});
check("plan/e1-declines", () => declined("Explain SN1 and E1 reactions.", plan(["SN1", SN1_TBU]), /no checked operator/));
check("plan/three-classes", () => declined("Explain SN1, SN2 and E2 reactions.", plan(["SN1", SN1_TBU], ["SN2", SN2_METHYL]), /more than two classes/));
check("plan/class-match", () => {
  declined("Explain the SN2 mechanism.", plan(["SN2", SN2_METHYL], ["SN1", SN1_TBU]), /exactly one for each class/);
  declined(BCF, plan(["SN2", SN2_METHYL]), /exactly one for each class/);
  declined("Explain the SN2 mechanism.", plan(["SN1", SN1_TBU]), /exactly one for each class/);
});
check("plan/tin-is-not-sn2", () => declined("Explain why Sn2+ reduces Fe3+.", plan(["SN2", SN2_METHYL])));
check("plan/bad-example-declines-all", () => {
  declined(BCF, plan(["SN2", SN2_METHYL], ["SN1", "CH3CH2Br + 2 H2O -> CH3CH2OH + H3O+ + Br-"]), /^SN1 example/);
  declined(BCF, plan(["SN2", SN2_METHYL], ["SN1", "(CH3)3CBr + 2 H2O -> (CH3)3COH + HBr + H2O"]), /^SN1 example/);
});
check("plan/one-water-declines", () => declined(BCF, plan(["SN2", SN2_METHYL], ["SN1", SN1_ONE_WATER]), /^SN1 example.*two solvent molecules/));
check("plan/dropped-words-decline", () => {
  // Each declines on its words alone: the class names are followed only by what may follow them, and the kind words fit.
  for (const [question, turnPlan] of [
    ["Explain how all substitution reactions are SN2", plan(["SN2", SN2_METHYL])],
    ["Explain bimolecular nucleophilic substitution SN1", plan(["SN1", SN1_TBU])],
    ["What SN1 reaction is fast?", plan(["SN1", SN1_TBU])],
    ["Explain both SN1 and SN2 reactions.", plan(["SN1", SN1_TBU], ["SN2", SN2_METHYL])],
    ["Explain unimolecular SN1 reactions.", plan(["SN1", SN1_TBU])],
  ] as const) declined(question, turnPlan, /the question says/);
});
check("plan/what-is-frame", () => {
  // The one frame "is" may stand in: at the start, straight before the class.
  built("What is an SN1 reaction?", plan(["SN1", SN1_TBU]));
  built("What is the SN2 mechanism?", plan(["SN2", SN2_METHYL]));
  declined("What is SN2 and how is it unimolecular?", plan(["SN2", SN2_METHYL]), /the question says/);
});
check("plan/basic-declines", () => {
  // SN1 is the weak, neutral nucleophile case: "basic nucleophiles" is a false premise the water example would seem to confirm.
  declined("Explain SN1 with basic nucleophiles", plan(["SN1", SN1_TBU]), /the question says "basic"/);
});
check("plan/step-phrases", () => {
  // SN2 is one concerted step: "with steps" would say it has several.
  declined("Explain SN2 with steps", plan(["SN2", SN2_METHYL]), /the question says "steps"/);
  built("Explain the SN2 mechanism step by step", plan(["SN2", SN2_METHYL]));
  built("Explain SN1 step by step", plan(["SN1", SN1_TBU]));
  built("Explain SN1 and SN2 step by step", plan(["SN1", SN1_TBU], ["SN2", SN2_METHYL]));
});
check("plan/kind-words-decline", () => {
  declined("Explain the SN1 elimination", plan(["SN1", SN1_TBU]), /not true of every class/);
  declined("Explain E2 nucleophilic substitution.", plan(["E2", E2_PROPYL]), /not true of every class/);
  declined("Explain SN2 and E2 elimination reactions.", plan(["SN2", SN2_METHYL], ["E2", E2_PROPYL]), /not true of every class/);
  declined("Explain nucleophilic substitution with SN2 and E2", plan(["SN2", SN2_METHYL], ["E2", E2_PROPYL]), /not true of every class/);
});
check("plan/after-class-declines", () => {
  for (const [question, turnPlan] of [
    ["Explain SN2 with the SN1 molecule", plan(["SN2", SN2_METHYL], ["SN1", SN1_TBU])],
    ["Explain SN2’ mechanism", plan(["SN2", SN2_METHYL])],
    ["Explain SN2' reactions", plan(["SN2", SN2_METHYL])],
    ["Explain the SN2 molecules.", plan(["SN2", SN2_METHYL])],
    ["Explain SN1 steps", plan(["SN1", SN1_TBU])],
  ] as const) declined(question, turnPlan, /is followed by/);
});
check("plan/review-asks-decline", () => {
  // The review's asks, each with a plan that matches its classes: every one declines, whichever guard catches it.
  for (const question of [
    "Explain how all substitution reactions are SN2", "Explain how SN2 is unimolecular", "Explain how SN1 is bimolecular",
    "Explain bimolecular nucleophilic substitution SN1", "Explain the SN1 elimination", "Explain how E2 is a nucleophilic substitution",
    "Explain how SN1 and SN2 are both unimolecular", "Explain SN2 with the SN1 molecule", "Explain SN2’ mechanism", "Explain SN2' reactions", "Explain SN2′ reactions",
  ]) {
    const named = /SN1/.test(question) && /SN2/.test(question) ? plan(["SN2", SN2_METHYL], ["SN1", SN1_TBU]) : /E2/.test(question) ? plan(["E2", E2_PROPYL]) : /SN1/.test(question) ? plan(["SN1", SN1_TBU]) : plan(["SN2", SN2_METHYL]);
    declined(question, named);
  }
});

/* ------------------------------------------------------------------------- */
/* Shared quantity audit                                                     */
/* ------------------------------------------------------------------------- */

const audit = (label: string): string[] => {
  const emptyPlan = { givens: [], derived: [], unknowns: [], qualitativeClaims: [] };
  const texts = displayedSceneQuantityTexts({ entities: [{ id: "t", kind: "label", label }], annotations: [] });
  assert.deepEqual(texts, [label], "the label is a displayed text");
  return validateSceneQuantityAgreement([], emptyPlan, texts).map((issue: { code: string }) => issue.code);
};
check("audit/formula-subscripts-are-not-values", () => {
  for (const label of ["(CH_3)_3C", "(CH_3)_3COH"]) assert.deepEqual(audit(label), [], `${label} is board script, not a measured value`);
});
check("audit/real-values-still-flagged", () => {
  for (const label of ["q = 3 C", "λ_500 nm", "x_2 m", "x_2m", "T_300K", "F_10N", "m_25kg", "q_2C"]) assert.deepEqual(audit(label), ["displayed_quantity_unverified"], `${label} is a measured value the plan does not hold`);
});

/* ------------------------------------------------------------------------- */
/* Mutants                                                                   */
/* ------------------------------------------------------------------------- */

interface Mutant { name: string; file: string; from: string; to: string; red: string[] }
const OPS = "chemistry/organic/mechanism/substitution.ts";
const FIG = "chemistry/organic/mechanism/substitutionFigure.ts";
const PLAN = "chemistry/organic/mechanism/planReaction.ts";
const MUTANTS: Mutant[] = [
  { name: "what-is-frame", file: PLAN, from: "const framed = /^(?:what (?:is|are) (?:an? |the )?zclass\\b)/.test(all.join(\" \")) ? all.slice(2) : all;", to: "const framed = all;", red: ["plan/what-is-frame"] },
  { name: "site-unique", file: OPS, from: "if (halogens.length !== 1) return", to: "if (halogens.length < 1) return", red: ["sn2/two-sites-declines"] },
  { name: "site-elements", file: OPS, from: "if (state.atoms.some((atom) => atom.element !== \"C\" && atom.element !== \"H\" && !LEAVING.has(atom.element))) return", to: "if (false) return", red: ["sn2/heteroatom-substrate-declines"] },
  { name: "site-saturated", file: OPS, from: "if (state.bonds.some((bond) => bond.order !== 1)) return { ok: false, reason: \"the substrate is not saturated\" };", to: "", red: ["sn2/unsaturated-declines"] },
  { name: "sn2-methyl-primary", file: OPS, from: "if (carbons.length > 1) return fail(", to: "if (false) return fail(", red: ["sn2/tertiary-declines", "sn2/secondary-declines"] },
  { name: "sn2-neopentyl", file: OPS, from: "=== 3) return fail(\"a neopentyl", to: "=== 9) return fail(\"a neopentyl", red: ["sn2/neopentyl-declines"] },
  { name: "anion-charge", file: OPS, from: "if (charged.length !== 1 || formalCharge(state, charged[0]!) !== -1) return", to: "if (charged.length > 1) return", red: ["sn2/neutral-nucleophile-declines"] },
  { name: "sn1-tertiary", file: OPS, from: "if (carbons.length !== 3) return fail(", to: "if (carbons.length < 1) return fail(", red: ["sn1/primary-declines", "sn1/secondary-declines", "plan/bad-example-declines-all"] },
  { name: "sn1-shift", file: OPS, from: "if (carbons.some((next) => carbonsOn(substrate, next).length - 1 >= 2)) return fail(", to: "if (false) return fail(", red: ["sn1/shift-declines"] },
  { name: "sn1-stereocentre", file: OPS, from: "if (chiral !== false) return fail(", to: "if (false) return fail(", red: ["sn1/chiral-declines"] },
  { name: "sn1-neutral-oh", file: OPS, from: "if (!hydrogensOn(state, atom).length || neighbourAtoms(state, atom).length !== 2) return", to: "if (!hydrogensOn(state, atom).length) return", red: ["sn1/anion-nucleophile-declines"] },
  { name: "sn1-two-solvents", file: OPS, from: "if (solvent.length !== 2) return fail(", to: "if (solvent.length > 2) return fail(", red: ["sn1/halide-base-declines", "plan/one-water-declines"] },
  { name: "sn1-same-solvent", file: OPS, from: "if (!sameSpecies(solvent[0]!, [solvent[1]!])) return fail(", to: "if (false) return fail(", red: ["sn1/solvents-differ-declines"] },
  { name: "sn1-primary-alcohol", file: OPS, from: "if (oxygenCarbon !== undefined && carbonsOn(state, oxygenCarbon).length >= 2) return { ok: false, reason: \"the solvent is a secondary", to: "if (false) return { ok: false, reason: \"the solvent is a secondary", red: ["sn1/branched-alcohol-declines"] },
  { name: "sn2-nucleophile-atoms", file: OPS, from: "if (LEAVING.has(attacker) ? rest.length > 0 : rest.some((atom) => atom.element !== \"C\" && atom.element !== \"H\")) return fail(", to: "if (false) return fail(", red: ["sn2/nucleophile-atoms-declines"] },
  { name: "sn2-bulky-alkoxide", file: OPS, from: "if (branched && carbons.length > 0) return fail(", to: "if (false) return fail(", red: ["sn2/bulky-alkoxide-declines"] },
  { name: "sn2-beta-branched", file: OPS, from: "if (carbons.length === 1 && carbonsOn(substrate, carbons[0]!).length - 1 >= 2) return fail(", to: "if (false) return fail(", red: ["sn2/beta-branched-declines"] },
  { name: "anion-one-neighbour", file: OPS, from: "if (neighbourAtoms(state, atom).length > 1) return { ok: false, reason: \"the charged atom has more than one neighbour\" };", to: "", red: ["sn2/charged-atom-one-neighbour"] },
  { name: "e2-same-alkene", file: OPS, from: "if (runs.some((run) => !run.ok || !sameSpecies(run.model.products, [first.model.products]))) return fail(\"the beta carbons", to: "if (false) return fail(\"the beta carbons", red: ["e2/two-alkenes-declines"] },
  { name: "e2-ez", file: OPS, from: "if (alkeneHasStereoisomers(first.model.products, beta, alpha)) return fail(", to: "if (false) return fail(", red: ["e2/ez-declines"] },
  { name: "e2-stereocentre", file: OPS, from: "if (isStereocentre(substrate, alpha) !== false || isStereocentre(substrate, beta) !== false) return fail(", to: "if (false) return fail(", red: ["e2/stereocentre-declines"] },
  { name: "e2-base", file: OPS, from: "anionCentre(base, new Set([\"O\"]), new Set([\"C\", \"H\", \"O\"]))", to: "anionCentre(base, SN2_NUCLEOPHILE_ATOMS, new Set([\"C\", \"H\", \"O\", \"S\", \"Cl\", \"Br\", \"I\"]))", red: ["e2/weak-base-declines"] },
  { name: "stated-products", file: OPS, from: "if (!sameSpecies(result.model.products, read.products.map((entry) => entry.state))) return fail(", to: "if (false) return fail(", red: ["sn2/wrong-product-declines", "sn1/wrong-product-declines", "e2/wrong-product-declines", "plan/bad-example-declines-all"] },
  { name: "ts-deltas-drawn", file: FIG, from: "for (const [atom, sign] of charge) {", to: "for (const [atom, sign] of new Map<number, number>()) {", red: ["figure/transition-state"] },
  { name: "charge-label-sign", file: FIG, from: "if (chargeSum(state, covers) !== sign || covers.some((other) => other !== atom && formalCharge(state, other) !== 0)) return", to: "if (false) return", red: ["figure/charge-label-sign"] },
  { name: "charge-total", file: FIG, from: "return shown === total ? deltas :", to: "return true ? deltas :", red: ["figure/charge-total"] },
  { name: "charge-species", file: FIG, from: "if (Math.abs(sum) > 1) return", to: "if (false) return", red: ["figure/charge-species"] },
  { name: "ts-keeps-charge", file: FIG, from: "if (from !== 0) return \"a charged atom keeps", to: "if (false) return \"a charged atom keeps", red: ["figure/ts-keeps-charge"] },
  { name: "ts-unit-move", file: FIG, from: "if ((from !== 0 && to !== 0) || Math.abs(from + to) !== 1) return", to: "if (false) return", red: ["figure/ts-unit-move"] },
  { name: "ts-unlabelled", file: FIG, from: "if (!labels.has(atom)) return \"a charge moves", to: "if (false) return \"a charge moves", red: ["figure/ts-unlabelled"] },
  { name: "ts-accounting", file: FIG, from: "return accounted ? deltas :", to: "return true ? deltas :", red: ["figure/ts-accounting"] },
  { name: "model-holds", file: FIG, from: "if (!modelHolds(model)) return decline(", to: "if (false) return decline(", red: ["arrows/forged-arrow-refused"] },
  { name: "inversion", file: FIG, from: "before.map(([angle, style]) => [(540 - angle) % 360, style]);", to: "before.map(([angle, style]) => [angle, style]);", red: ["figure/inversion", "plan/bcf546ce-draws-both"] },
  { name: "plus-clear", file: FIG, from: "const right2 = groupsBox(p2, alpha).maxX;", to: "const right2 = axisClearance(p2, alpha, 1, HALF_HEIGHT + 0.25);", red: ["figure/plus-clear"] },
  { name: "arrow-count", file: FIG, from: "const countText = (count: number): string => `${count} curly", to: "const countText = (count: number): string => `${count + 1} curly", red: ["figure/narration"] },
  { name: "group-readback", file: FIG, from: "return substituentKey(read, around[0]!, iodine) === substituentKey(state, root, from);", to: "return true;", red: ["figure/label-readback"] },
  { name: "species-readback", file: FIG, from: "return read !== null && fragments(read).length === 1 && sameSpecies(read, [piece]);", to: "return read !== null;", red: ["figure/label-readback", "figure/species-labels", "figure/compiles"] },
  { name: "wedge-length", file: FIG, from: "(style === \"wedge\" ? WEDGE_VISIBLE : VISIBLE)", to: "(style === \"wedge\" ? VISIBLE * 0.6 : VISIBLE)", red: ["figure/compiles", "figure/plus-clear", "figure/transition-state", "plan/bcf546ce-draws-both"] },
  { name: "fit-zone", file: FIG, from: "if (fitWidth > FIT_WIDTH_PX + 0.5 || fitHeight > FIT_HEIGHT_PX + 0.5) {", to: "if (false) {", red: ["figure/too-big-declines"] },
  { name: "plan-chemistry", file: PLAN, from: "if (!isChemistryQuestion(question)) return", to: "if (false) return", red: ["plan/not-chemistry"] },
  { name: "plan-species", file: PLAN, from: "if (questionNamesSpecies(question)) return", to: "if (false) return", red: ["plan/species-named"] },
  { name: "plan-vocabulary", file: PLAN, from: "if (outside) return", to: "if (false) return", red: ["plan/vocabulary-declines", "plan/dropped-words-decline", "plan/review-asks-decline", "plan/what-is-frame", "plan/basic-declines", "plan/step-phrases"] },
  { name: "plan-symbols", file: PLAN, from: "if (!ASK_CHARACTERS.test(text)) return", to: "if (false) return", red: ["plan/symbols-decline"] },
  { name: "plan-e1", file: PLAN, from: "if (named.size !== 1) return", to: "if (named.size > 1) return", red: ["plan/e1-declines"] },
  { name: "plan-two-classes", file: PLAN, from: "if (classes.size > 2) return", to: "if (false) return", red: ["plan/three-classes"] },
  { name: "plan-match", file: PLAN, from: "if (planned.size !== ask.classes.size || [...planned].some((mechanism) => !ask.classes.has(mechanism))) {", to: "if (false) {", red: ["plan/class-match"] },
  { name: "plan-duplicate", file: PLAN, from: "if (new Set(entries.map((entry) => entry.mechanism)).size !== entries.length) return", to: "if (false) return", red: ["plan/duplicate-class"] },
  { name: "plan-all-or-nothing", file: PLAN, from: "    if (!read.ok) return { status: \"declined\", reason: `${entry.mechanism} example", to: "    if (!read.ok) continue;\n    if (false) return { status: \"declined\", reason: `${entry.mechanism} example", red: ["plan/bad-example-declines-all", "plan/one-water-declines"] },
  { name: "plan-after-class", file: PLAN, from: "if (!AFTER_CLASS.test(question.slice(run.index! + run[0].length))) return", to: "if (false) return", red: ["plan/after-class-declines", "plan/review-asks-decline"] },
  { name: "plan-kind-words", file: PLAN, from: "if (kindWord) return", to: "if (false) return", red: ["plan/kind-words-decline", "plan/review-asks-decline"] },
  { name: "audit-subscript", file: "contracts/contractsV3.ts", from: "    if (text.slice(digitsAt - 2, digitsAt) === \")_\") continue;\n", to: "", red: ["audit/formula-subscripts-are-not-values"] },
  { name: "audit-subscript-bracket", file: "contracts/contractsV3.ts", from: "text.slice(digitsAt - 2, digitsAt) === \")_\"", to: "text[digitsAt - 1] === \"_\"", red: ["audit/real-values-still-flagged"] },
  { name: "e2-primary-bulky", file: OPS, from: "  if (carbonsOn(substrate, site.alpha).length <= 1 && !bulkyBase) return fail(", to: "  if (false) return fail(", red: ["e2/primary-unhindered-declines"] },
  { name: "step-phrases", file: PLAN, from: ".replace(/\\b(?:step by step|each step)\\b/g, \" \")", to: "", red: ["plan/step-phrases", "plan/bad-example-declines-all", "plan/bcf546ce-draws-both", "plan/class-match", "plan/one-water-declines", "plan/vocabulary-accepts"] },
  { name: "plan-provenance", file: PLAN, from: "const equations = entries.map((entry) => entry.equation).join(\"; \");", to: "const equations = entries.map((entry) => entry.equation).join(\", \");", red: ["plan/bcf546ce-draws-both"] },
];

function failedIn(dir: string): string[] {
  const out = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), "--root", dir], { encoding: "utf8", cwd: packageRoot, maxBuffer: 1 << 26 });
  const line = out.stdout.trim().split("\n").at(-1) ?? "";
  try {
    return (JSON.parse(line) as { failed: string[] }).failed;
  } catch {
    throw new Error(`mutant child gave no result: ${out.stderr.slice(0, 400)}`);
  }
}

if (withMutants) {
  for (const mutant of MUTANTS) {
    check(`mutant/${mutant.name}`, () => {
      const dir = mkdtempSync(join(packageRoot, `.substitution-mutant-${mutant.name}-`));
      try {
        cpSync(join(packageRoot, "src"), join(dir, "src"), { recursive: true });
        const file = join(dir, "src", mutant.file);
        const text = readFileSync(file, "utf8");
        assert.equal(text.split(mutant.from).length, 2, `the mutant's target appears exactly once in ${mutant.file}`);
        writeFileSync(file, text.replace(mutant.from, mutant.to));
        const failed = failedIn(dir);
        // Exactly its own rows: a mutant that breaks everything proves nothing about its guard.
        assert.deepEqual([...failed].sort(), [...new Set(mutant.red)].sort(), "the failing rows are exactly the mutant's own");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}

const failed = results.filter((result) => !result.ok);
if (jsonOut) {
  console.log(JSON.stringify({ failed: failed.map((result) => result.id) }));
} else {
  for (const result of results) console.log(`${result.ok ? "ok  " : "FAIL"} ${result.id}${result.message ? `: ${result.message}` : ""}`);
  console.log(`${results.length - failed.length}/${results.length} passed`);
}
if (!child && failed.length) process.exitCode = 1;
