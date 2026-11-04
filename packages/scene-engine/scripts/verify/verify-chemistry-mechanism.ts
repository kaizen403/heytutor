/**
 * Curly arrow mechanisms: the electron bookkeeping, the cyclic syn
 * eliminations built on it, and the source reader that binds them to a
 * question.
 *
 *   tsx scripts/verify/verify-chemistry-mechanism.ts [--root <scene-engine dir>] [--no-mutants] [--json]
 *
 * Checks:
 *  - arrows: a lone pair tail must be a lone pair the atom has; a lone pair
 *    only forms a bond from its own atom; a bond pair only moves to a bond
 *    sharing one of its atoms; a step that leaves an atom above an octet is
 *    refused; a carbocation sextet passes only where the step declares it.
 *    SN2 and SN1 ionisation run with formal charges that agree before and
 *    after and give exactly the expected species. Electron and charge totals
 *    are invariants of the arrow algebra and are asserted on every row.
 *  - eliminations: ester and xanthate pyrolysis run through a six atom ring
 *    and the Cope elimination through five. A xanthate is O-alkyl and
 *    S-alkyl (no free xanthic acid, no salt); a Cope amine oxide is
 *    tertiary; the alkene carbons carry only C and H (no enol or enamine);
 *    a ring opening that leaves one species declines. Products that fit two
 *    substrates, and a substrate with two inequivalent beta sites, decline.
 *  - source: the two photographed note pages (paraphrased; no student text
 *    is checked in) draw every reaction whose stated products follow from
 *    the arrows and none whose products do not. A declined reaction is
 *    recorded as a demotion and never named in the caption or a title. A
 *    stated substrate must agree with the stated products and needs an ask
 *    for the mechanism; a pairing the text states (verb, colon, arrow, or
 *    "formed in" after the set) is held to, and a reaction whose own
 *    stated products fail takes no other set; any stated ring size must be
 *    the drawn ring, and two sizes decline. Option stems in every mark
 *    style, sets offered with "or", negated stems, stems with another task,
 *    and any asking clause that leaves the named reaction out decline.
 *    Textbook substrates with branched groups lay out and compile.
 *  - figure: the narration counts the checked arrows and names each class's
 *    by-product.
 *  - lone row: a mechanism ask the reader cannot verify draws nothing in the
 *    organic family, never a product row without arrows.
 *  - cue: a mechanism written only in condensed formulas reaches the organic
 *    family.
 *  - compile: every drawn figure validates and compiles, with one multi
 *    point curly arrow per checked arrow.
 *  - mutants: each guard switched off alone turns its own rows red.
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
const { inferChemistryFamilies } = await import(`${root}/src/chemistry/router.ts`);
const { buildOrganicScene } = await import(`${root}/src/chemistry/organic/index.ts`);
const { readCondensed } = await import(`${root}/src/chemistry/organic/mechanism/condensed.ts`);
const { applyStep, arrowRing } = await import(`${root}/src/chemistry/organic/mechanism/arrows.ts`);
const { combineStates, formalCharge, sameSpecies, totalCharge, totalElectrons } = await import(`${root}/src/chemistry/organic/mechanism/state.ts`);
const { cyclicElimination, cyclicEliminationFromProducts } = await import(`${root}/src/chemistry/organic/mechanism/eliminations.ts`);
const { readMechanismSource } = await import(`${root}/src/chemistry/organic/mechanism/source.ts`);
const { pruneDeadSceneEntities, validateSceneDocument } = await import(`${root}/src/document/validation.ts`);
const { compileSceneDocument } = await import(`${root}/src/compile/compiler.ts`);

type State = ReturnType<typeof readCondensed> & object;
type Doc = { entities: Array<{ id: string; kind: string; role?: string; label?: string }>; annotations: Array<{ id: string; text?: string }>; source: Record<string, unknown> };

const results: Array<{ id: string; ok: boolean; message?: string }> = [];
function check(id: string, body: () => void): void {
  try {
    body();
    results.push({ id, ok: true });
  } catch (error) {
    results.push({ id, ok: false, message: error instanceof Error ? error.message : String(error) });
  }
}

function species(text: string): State {
  const state = readCondensed(text);
  assert.ok(state, `${text} reads as a checked structure`);
  return state;
}
const atomsOf = (state: State, element: string): number[] => state.atoms.flatMap((atom, index) => (atom.element === element ? [index] : []));

function labels(doc: Doc): string[] {
  return doc.entities.filter((entity) => entity.kind === "label" && entity.label).map((entity) => entity.label!);
}
function caption(doc: Doc): string {
  return doc.annotations.find((annotation) => annotation.id === "figure_caption")?.text ?? "";
}
function demotions(doc: Doc): Array<{ code: string; message: string }> {
  return (doc.source.yieldDemotions as Array<{ code: string; message: string }> | undefined) ?? [];
}

/** The figure validates and compiles, and draws one curly arrow per checked arrow. */
function compiles(doc: Doc, arrows: number): void {
  const validated = validateSceneDocument(pruneDeadSceneEntities(doc as unknown as Record<string, unknown>));
  assert.ok(validated.document, `validates: ${validated.report.issues.filter((issue: { severity: string }) => issue.severity === "fatal").map((issue: { code: string }) => issue.code).join(", ")}`);
  const compiled = compileSceneDocument(validated.document);
  assert.ok(compiled.ok, `compiles: ${compiled.report.issues.filter((issue: { severity: string }) => issue.severity === "fatal").map((issue: { code: string; message: string }) => `${issue.code} ${issue.message}`).join("; ")}`);
  const curly = compiled.renderScene!.primitives.filter((primitive: { kind: string; entityId: string; points: unknown[] }) => primitive.kind === "vector" && /_arrow\d+$/.test(primitive.entityId) && primitive.points.length > 2);
  assert.equal(curly.length, arrows, "one multi point curly arrow per checked arrow");
}

function drawn(question: string): Doc {
  const read = readMechanismSource(question);
  assert.equal(read.status, "source", `draws (${read.status}: ${"reason" in read ? read.reason : ""})`);
  const doc = buildOrganicScene(question, [], false) as Doc | null;
  assert.ok(doc, "the organic builder returns the mechanism figure");
  return doc;
}

/* ------------------------------------------------------------------------- */
/* Arrows                                                                    */
/* ------------------------------------------------------------------------- */

const bromomethane = species("CH3Br");
const carbon = atomsOf(bromomethane, "C")[0]!;
const bromine = atomsOf(bromomethane, "Br")[0]!;
const hydrogen = atomsOf(bromomethane, "H")[0]!;

check("condensed/bounded", () => {
  // Question text never makes the reader allocate: huge counts and nested copies are refused before expanding.
  // Defensive, with no mutant: a mutant would have to allocate the memory the bound prevents.
  const started = Date.now();
  for (const text of ["CH999999999", "C(CH3)999999999", "((((((CH2)12)12)12)12)12)12", "CH13"]) assert.equal(readCondensed(text), null, text);
  assert.ok(Date.now() - started < 200, "refused at once");
  assert.ok(readCondensed("(CH3)3C-O-C(=O)-CH3"), "ordinary counts still read");
  // Deep nesting never reaches the recursive reader: a long token and a deep bracket both decline, through the whole question reader too.
  const deep = `${"(".repeat(5000)}CH3${")".repeat(5000)}`;
  assert.equal(readCondensed(deep), null);
  assert.equal(readCondensed("C(C(C(C(C(C(C(CH3)))))))"), null, "seven levels");
  assert.equal(readMechanismSource(`Show the ester pyrolysis of ${deep} on heating.`).status, "declined");
});
check("arrows/lone-pair-must-exist", () => {
  const result = applyStep(bromomethane, { arrows: [{ tail: { kind: "lone_pair", atom: carbon }, head: { kind: "bond", a: carbon, b: hydrogen } }] });
  assert.equal(result.ok, false, "a carbon with no lone pair cannot give one");
  assert.match(result.reason, /has no lone pair to give/, "refused by the lone pair count, before any shell check");
});
check("arrows/lone-pair-own-atom", () => {
  const result = applyStep(bromomethane, { arrows: [{ tail: { kind: "lone_pair", atom: bromine }, head: { kind: "bond", a: carbon, b: hydrogen } }] });
  assert.equal(result.ok, false, "a bromine lone pair cannot form a C-H bond");
  assert.match(result.reason, /from its own atom/, "refused by the arrow shape, before any shell check");
});
check("arrows/bond-pair-adjacent", () => {
  const otherH = atomsOf(bromomethane, "H")[1]!;
  const result = applyStep(bromomethane, { arrows: [{ tail: { kind: "bond", a: carbon, b: hydrogen }, head: { kind: "bond", a: bromine, b: otherH } }] });
  assert.equal(result.ok, false, "a C-H pair cannot jump to a bond it shares no atom with");
  assert.match(result.reason, /shares one of its atoms/, "refused by the arrow shape, before any shell check");
});

const { state: sn2Start, offsets: sn2Offsets } = combineStates([species("OH-"), bromomethane]);
const oxygen = sn2Offsets[0]! + 0;
const sn2Carbon = sn2Offsets[1]! + carbon;
const sn2Bromine = sn2Offsets[1]! + bromine;

check("arrows/octet", () => {
  const result = applyStep(sn2Start, { arrows: [{ tail: { kind: "lone_pair", atom: oxygen }, head: { kind: "bond", a: oxygen, b: sn2Carbon } }] });
  assert.equal(result.ok, false, "attack without the C-Br bond breaking leaves carbon with ten electrons");
});
check("arrows/sn2-bookkeeping", () => {
  const result = applyStep(sn2Start, { arrows: [
    { tail: { kind: "lone_pair", atom: oxygen }, head: { kind: "bond", a: oxygen, b: sn2Carbon } },
    { tail: { kind: "bond", a: sn2Carbon, b: sn2Bromine }, head: { kind: "atom", atom: sn2Bromine } },
  ] });
  assert.ok(result.ok, "the concerted SN2 step runs");
  assert.equal(formalCharge(sn2Start, oxygen), -1);
  assert.equal(formalCharge(result.state, oxygen), 0, "the hydroxide O is neutral once bonded");
  assert.equal(formalCharge(result.state, sn2Bromine), -1, "bromide leaves with the pair");
  assert.equal(totalCharge(result.state), totalCharge(sn2Start));
  assert.equal(totalElectrons(result.state), totalElectrons(sn2Start));
  assert.ok(sameSpecies(result.state, [species("CH3OH"), species("Br-")]), "the arrows give methanol and bromide");
});

const tertiary = species("(CH3)3CBr");
const centralCarbon = atomsOf(tertiary, "C").find((atom) => tertiary.bonds.some((bond) => (bond.a === atom || bond.b === atom) && tertiary.atoms[bond.a === atom ? bond.b : bond.a]!.element === "Br"))!;
const tertiaryBromine = atomsOf(tertiary, "Br")[0]!;
const ionise = { arrows: [{ tail: { kind: "bond" as const, a: centralCarbon, b: tertiaryBromine }, head: { kind: "atom" as const, atom: tertiaryBromine } }] };

check("arrows/sn1-declared-sextet", () => {
  const result = applyStep(tertiary, { ...ionise, sextets: [centralCarbon] });
  assert.ok(result.ok, "ionisation runs when the step declares the carbocation");
  assert.equal(formalCharge(result.state, centralCarbon), 1);
  assert.ok(sameSpecies(result.state, [species("(CH3)3C+"), species("Br-")]), "the arrows give the tert-butyl cation and bromide");
});
check("arrows/sn1-undeclared-sextet", () => {
  assert.equal(applyStep(tertiary, ionise).ok, false, "a carbon left with six electrons needs a declared carbocation");
});

/* ------------------------------------------------------------------------- */
/* Cyclic eliminations                                                       */
/* ------------------------------------------------------------------------- */

check("eliminations/ester-ring", () => {
  const read = cyclicElimination(species("CH3-C(=O)-O-CH2CH3"), "ester_pyrolysis");
  assert.ok(read.ok, "ethyl acetate pyrolyses");
  assert.equal(arrowRing(read.model.substrate, read.model.step)?.length, 6);
  assert.ok(sameSpecies(read.model.products, [species("CH2=CH2"), species("CH3-C(=O)-OH")]), "ethene and acetic acid");
});
check("eliminations/cope-ring", () => {
  const read = cyclicEliminationFromProducts([species("CH2=CH2"), species("HO-N(CH3)2")], "cope_elimination");
  assert.ok(read.ok, "ethene and N,N-dimethylhydroxylamine come from the amine oxide");
  assert.equal(read.model.ring.length, 5);
});
check("eliminations/xanthate-from-products", () => {
  const read = cyclicEliminationFromProducts([species("CH2=CH2"), species("HS-C(=O)-SCH3")], "xanthate_pyrolysis");
  assert.ok(read.ok, "the O-ethyl S-methyl xanthate gives ethene and HS-C(=O)-SCH3");
  assert.equal(read.model.ring.length, 6);
});
check("eliminations/xanthate-is-s-alkyl", () => {
  const acid = cyclicEliminationFromProducts([species("CH2=CH2"), species("HS-C(=O)-SH")], "xanthate_pyrolysis");
  assert.equal(acid.ok, false, "HS-C(=O)-SH needs the free xanthic acid, which loses CS2 instead");
  assert.equal(cyclicElimination(species("CH3CH2-O-C(=S)-SH"), "xanthate_pyrolysis").ok, false, "the free xanthic acid is no Chugaev substrate");
  assert.equal(cyclicElimination(species("CH3CH2-O-C(=S)-S^-"), "xanthate_pyrolysis").ok, false, "nor is the xanthate salt");
});
check("eliminations/cope-is-tertiary", () => {
  for (const acid of ["HO-NH2", "HO-NH-CH3"]) {
    assert.equal(cyclicEliminationFromProducts([species("CH2=CH2"), species(acid)], "cope_elimination").ok, false, `${acid} needs an N-H amine oxide, not a Cope substrate`);
  }
});
check("eliminations/no-enol-beta", () => {
  assert.equal(cyclicElimination(species("CH3-C(=O)-O-CH2CH2OH"), "ester_pyrolysis").ok, false, "an O on Cbeta would give an enol");
});
check("eliminations/no-enol-alpha", () => {
  assert.equal(cyclicElimination(species("CH3-C(=O)-O-CH(OCH3)CH3"), "ester_pyrolysis").ok, false, "an O on Calpha would give an enol ether");
});

/** Join two carbons of one state into a ring, each giving up one H. */
function closeRing(state: State, a: number, b: number): State {
  const drop = [a, b].map((atom) => state.bonds.find((bond) => (bond.a === atom && state.atoms[bond.b]!.element === "H") || (bond.b === atom && state.atoms[bond.a]!.element === "H"))!)
    .map((bond) => (state.atoms[bond.a]!.element === "H" ? bond.a : bond.b));
  const keep = state.atoms.map((_, index) => index).filter((index) => !drop.includes(index));
  const renumber = new Map(keep.map((old, index) => [old, index]));
  return {
    ...state,
    atoms: keep.map((index) => ({ ...state.atoms[index]! })),
    bonds: [...state.bonds.filter((bond) => !drop.includes(bond.a) && !drop.includes(bond.b)), { a, b, order: 1 }]
      .map((bond) => ({ ...bond, a: renumber.get(bond.a)!, b: renumber.get(bond.b)! })),
  } as State;
}
check("eliminations/one-product-lactone", () => {
  // Propyl acetate closed acyl CH3 to the propyl CH3: delta-valerolactone. Its elimination gives one species.
  const open = species("CH3-C(=O)-O-CH2CH2CH3");
  const carbons = atomsOf(open, "C");
  const lactone = closeRing(open, carbons[0]!, carbons.at(-1)!);
  const read = cyclicElimination(lactone, "ester_pyrolysis");
  assert.equal(read.ok, false, "a ring opening leaves one species, not an alkene and an acid");
  assert.match(read.reason, /exactly two species/, "refused by the product count");
});
check("eliminations/xanthate-is-o-alkyl", () => {
  // S-methyl, so only the O-alkyl rule can refuse it.
  const read = cyclicEliminationFromProducts([species("CH2=CH2"), species("HS-C(=S)-SCH3")], "xanthate_pyrolysis");
  assert.equal(read.ok, false, "HS-C(=S)-SCH3 would need a trithiocarbonate, not a xanthate");
});
check("eliminations/two-substrates", () => {
  const read = cyclicEliminationFromProducts([species("CH2=CH-CH3"), species("R-C(=O)-OH")], "ester_pyrolysis");
  assert.equal(read.ok, false, "propene comes from the 1-propyl and the 2-propyl ester");
});
check("eliminations/inequivalent-sites", () => {
  const read = cyclicElimination(species("CH3-C(=O)-O-CH(CH3)CH2CH3"), "ester_pyrolysis");
  assert.equal(read.ok, false, "the 2-butyl ester gives but-1-ene and but-2-ene");
});

/* ------------------------------------------------------------------------- */
/* Source                                                                    */
/* ------------------------------------------------------------------------- */

const BOTH_PAGES = "Notes: xanthate pyrolysis and ester pyrolysis, each through a six membered T.S. on heat.\nCH2=CH2 + HS-C(=O)-SCH3\nCH2=CH2 + R-C(=O)-OH";
const cues = (doc: Doc): string[] => ((doc as unknown as { revealGroups?: Array<{ narrationCue: string }> }).revealGroups ?? []).map((group) => group.narrationCue);
const panelLabels = (doc: Doc, prefix: string): string[] => doc.entities.filter((entity) => entity.id.startsWith(`${prefix}_a`) && entity.label).map((entity) => entity.label!);
const CONTRADICTED_PAGE = "COPE ELIMINATION. Ester pyrolysis: a six membered T.S., heat, CH_2=CH_2 + R-C(=O)-OH. Xanthate pyrolysis: a six membered T.S., heat, CH_2=CH_2 + HS-C(=S)-SH. The cope elimination involves";

check("source/textbook-substrates", () => {
  for (const question of [
    "Draw the mechanism of the Chugaev reaction of CH3CH2-O-C(=S)-S-CH3.",
    "Show the ester pyrolysis of CH3-C(=O)-O-C(CH3)3.",
    "Show the ester pyrolysis of CH3-C(=O)-O-CH2CH(CH3)2.",
  ]) compiles(drawn(question), 3);
});
check("figure/narration", () => {
  const doc = drawn("Cope elimination: CH2=CH2 + HO-N(CH3)2");
  assert.ok(cues(doc).some((cue) => cue.startsWith("3 curly arrows")), "the arrow count is the checked arrows, not the lone pair dots");
  assert.ok(cues(doc).some((cue) => /an alkene and a hydroxylamine/.test(cue)), "the Cope by-product is a hydroxylamine, not an acid");
  assert.ok(!cues(doc).some((cue) => /acid/.test(cue)));
});
const ESTER = "CH3-C(=O)-O-CH2CH3";
const ESTER_SET = "CH2=CH2 + R-C(=O)-OH";
const XANTHATE_SET = "CH2=CH2 + HS-C(=O)-SCH3";
const COPE_SET = "CH2=CH2 + HO-N(CH3)2";
/** Outside both shapes, so each declines; every one would draw from a looser reading. */
const OUTSIDE_STEMS = [
  // options, assertions, matches
  `Assertion (A): Ester pyrolysis of ${ESTER} gives CH2=CH2 + CH3-C(=O)-OH. Reason (R): it is a syn elimination.`,
  `Statement I: Ester pyrolysis gives ${ESTER_SET}. Statement II: it is syn.`,
  `Ester pyrolysis gives ${ESTER_SET} through a a) four b) six membered TS`,
  `Ester pyrolysis gives ${ESTER_SET} through a ____ membered TS (1) four (2) five (3) six (4) seven`,
  `In ester pyrolysis of ${ESTER} (i) the TS is cyclic (ii) it is syn. Show the mechanism.`,
  `Match the column: ester pyrolysis, Cope elimination. ${ESTER_SET}`,
  `True or false: ester pyrolysis gives ${ESTER_SET}`,
  `Ester pyrolysis gives ${ESTER_SET} T/F`,
  `Ester pyrolysis gives [A] ${ESTER_SET} [B] ${XANTHATE_SET}`,
  `Ester pyrolysis gives A: ${ESTER_SET}, B: ${XANTHATE_SET}`,
  `Ester pyrolysis gives ① ${ESTER_SET} ② ${XANTHATE_SET}`,
  `What does ester pyrolysis give?\nA ${ESTER_SET}\nB ${XANTHATE_SET}`,
  `Choose the products of ester pyrolysis: ${ESTER_SET} or ${XANTHATE_SET}`,
  `Choose the ester pyrolysis products: ${ESTER_SET}.`,
  `Ester pyrolysis gives ${ESTER_SET} or ${XANTHATE_SET}`,
  // negations, in any apostrophe
  `Ester pyrolysis of ${ESTER} is not possible below 300 C. Explain.`,
  `It is false that ester pyrolysis gives ${ESTER_SET}.`,
  `Ester pyrolysis doesnt give ${ESTER_SET}.`,
  `Ester pyrolysis doesn’t give ${ESTER_SET}.`,
  `Ester pyrolysis can't give ${ESTER_SET}.`,
  `Ester pyrolysis won't give ${ESTER_SET}.`,
  `Ester pyrolysis gives no ${ESTER_SET}.`,
  `Ester pyrolysis is impossible: ${ESTER_SET}.`,
  `Disprove: ester pyrolysis gives ${ESTER_SET}.`,
  // another reaction, reagent or task beside the named one
  `Unlike ester pyrolysis, explain the mechanism by which ${ESTER} reacts with aqueous NaOH.`,
  `Show the mechanism by which ${ESTER} reacts with CH3MgBr and how it differs from ester pyrolysis.`,
  `Explain the base-induced elimination from ${ESTER} with KOtBu and compare ester pyrolysis.`,
  `Ester pyrolysis of ${ESTER} on heating. Draw the mechanism of the acid-catalysed reaction with water.`,
  `Show the ester pyrolysis of ${ESTER} and the McLafferty rearrangement.`,
  `Show the ester pyrolysis of ${ESTER} and the Norrish type II reaction.`,
  "Draw the mechanism of the Hofmann elimination and the Cope elimination: CH2=CH2 + HO-N(CH3)2",
  `Show the ester pyrolysis of ${ESTER} and compare it with its hydrolysis.`,
  `Name the ester ${ESTER} and show its ester pyrolysis.`,
  `Ester pyrolysis of ${ESTER} gives ethene. Show the E2 mechanism for CH3CH2Br with ethoxide.`,
  `Write the rate law for the ester pyrolysis of ${ESTER} and show its mechanism.`,
  `Draw the Lewis structure of ${ESTER} and its ester pyrolysis.`,
  `Show the ester pyrolysis of ${ESTER} and plot a graph of its rate against temperature.`,
  `Unlike ester pyrolysis, explain how ${ESTER} reacts with aqueous NaOH (saponification).`,
  `Explain the esterification that makes ${ESTER} and then its ester pyrolysis.`,
  `Explain the Claisen condensation of ${ESTER} and show its ester pyrolysis.`,
  `${ESTER_SET} react on heating to give an ester, the reverse of ester pyrolysis. Explain.`,
  `Ester pyrolysis is slow. Explain how ${ESTER} behaves in water.`,
  `Ester pyrolysis needs 400 C, but explain how ${ESTER} is made from ethanol.`,
  `Show the ester pyrolysis of ${ESTER}. How is the ester made from ethanol?`,
  // the third review: a mechanism of something else asked beside the name
  `Rather than ester pyrolysis, show the mechanism of the aminolysis of ${ESTER}.`,
  `Instead of ester pyrolysis, draw the mechanism of the methanolysis of ${ESTER}.`,
  `Ester pyrolysis aside, explain the mechanism of aminolysis of ${ESTER}.`,
  `Besides ester pyrolysis, give the mechanism of the alcoholysis of ${ESTER}.`,
  `Ester pyrolysis is well known. Now draw the mechanism for the aminolysis of ${ESTER}.`,
  `Ester pyrolysis of ${ESTER} is known. What is the mechanism in aqueous acid?`,
  `Forget ester pyrolysis; draw the mechanism of ${ESTER} in aqueous acid.`,
  `Draw the mechanism of ester pyrolysis of ${ESTER} and of its aminolysis.`,
  `Draw the mechanism of the Hofmann degradation and of ester pyrolysis of ${ESTER}.`,
  `Draw the mechanism of ester pyrolysis of ${ESTER} and of the photochemical cleavage of it.`,
  `Ester pyrolysis affords ${XANTHATE_SET}; the Chugaev reaction affords ${ESTER_SET}.`,
  // species words are not checked against the figure, so they are not read (the fourth review)
  `Show the ester pyrolysis of CH3-C(=O)-O-CH2CH2CH3 to give ethene.`,
  `Show the ester pyrolysis of ${ESTER} giving an alkene and hydroxylamine.`,
  "Show the Chugaev reaction of the ester CH3CH2-O-C(=S)-S-CH3.",
  `Show the ester pyrolysis of ${ESTER} and the amine oxide.`,
  `What does ester pyrolysis give?\n(a) ${ESTER_SET}\n(c) ${XANTHATE_SET}\nWhat does the Chugaev reaction give?`,
  // a number that is not a temperature or a ring size
  `Show the ester pyrolysis of ${ESTER} through a (1) 4 (2) 6 membered TS.`,
  // the fourth review
  `${XANTHATE_SET} is the product of ester pyrolysis. ${ESTER_SET} is the product of the Chugaev reaction.`,
  `What does ester pyrolysis give? ${XANTHATE_SET}. What does the Chugaev reaction give? ${ESTER_SET}.`,
  `CH3-C(=O)-O-CH2CH3 is formed from CH2=CH2 + CH3-C(=O)-OH by ester pyrolysis.`,
  `Show how ${ESTER} forms from CH2=CH2 + CH3-C(=O)-OH in ester pyrolysis.`,
  `Show how ${ESTER} is formed in ester pyrolysis.`,
  `Ester pyrolysis of ${ESTER} on heating`,
  // the fifth review: reverse direction, the substrate as product, swapped substrates, false attribution
  "Show the ester pyrolysis of CH2=CH2 + CH3-C(=O)-OH.",
  `Show how CH2=CH2 + CH3-C(=O)-OH gives ${ESTER} in ester pyrolysis.`,
  `Ester pyrolysis: CH2=CH2 + CH3-C(=O)-OH -> ${ESTER}`,
  `CH2=CH2 + CH3-C(=O)-OH forms ${ESTER} by ester pyrolysis.`,
  "The substrate of ester pyrolysis is CH2=CH2 + CH3-C(=O)-OH. Show the mechanism.",
  `Ester pyrolysis gives ${ESTER}. Show the mechanism.`,
  `Show how ester pyrolysis forms ${ESTER}.`,
  `The product of ester pyrolysis is ${ESTER}. Show the mechanism.`,
  `Show the ester pyrolysis that produces ${ESTER}.`,
  `Show the ester pyrolysis of CH3CH2-O-C(=S)-S-CH3 and the Chugaev reaction of ${ESTER}.`,
  `Ester pyrolysis: CH3CH2-O-C(=S)-S-CH3\nChugaev reaction: ${ESTER}\nShow the mechanisms.`,
  `Show the mechanism of ester pyrolysis. Show the Chugaev reaction of ${ESTER}.`,
  `Ester pyrolysis and the Chugaev reaction\nThe Chugaev reaction products\n${ESTER_SET}`,
  `Ester pyrolysis gives ${ESTER_SET} via the Chugaev reaction.`,
  `${ESTER_SET} is formed in ester pyrolysis and the Chugaev reaction.`,
  `Ester pyrolysis gives ${ESTER_SET} and hydrogen.`,
  `The Cope elimination of an amine gives ${COPE_SET}.`,
  `Show the ester pyrolysis of ${ESTER} in steps.`,
  `Ester pyrolysis of ${ESTER_SET}`,
  `Ester pyrolysis gives a six membered TS\n${ESTER_SET}`,
  `Ester pyrolysis\n${ESTER_SET} trans`,
];
check("source/outside-shapes", () => {
  for (const question of OUTSIDE_STEMS) assert.equal(readMechanismSource(question).status, "declined", question);
});
check("source/ask-shape", () => {
  for (const question of [
    `Show the ester pyrolysis of ${ESTER} on heating.`,
    `Show the ester pyrolysis of ${ESTER} with curly arrows.`,
    "Draw the mechanism of the Chugaev reaction of CH3CH2-O-C(=S)-S-CH3.",
    `Explain the ester pyrolysis of ${ESTER} with mechanism.`,
    `What is the mechanism of the ester pyrolysis of ${ESTER}?`,
    `Show the ester pyrolysis of ${ESTER} via a six membered cyclic transition state.`,
  ]) compiles(drawn(question), 3);
});
check("source/stated-substrate", () => {
  const doc = drawn(`Show the ester pyrolysis of ${ESTER} on heating.`);
  compiles(doc, 3);
  assert.ok(labels(doc).includes("CH_3"), "the acetyl methyl is drawn");
  assert.equal(panelLabels(doc, "rx0p").filter((label) => label === "CH_2").length, 2, "the ethyl CH3 is Cbeta: the alkene is ethene");
});
check("source/ring-size-read", () => {
  for (const question of [`Show the ester pyrolysis of ${ESTER} through a 4-centre TS.`, `Show the ester pyrolysis of ${ESTER} through a seven membered TS.`]) {
    assert.equal(readMechanismSource(question).status, "declined", question);
  }
  drawn(`Show the ester pyrolysis of ${ESTER} through a six-centre TS.`);
});
check("source/temperature", () => {
  drawn(`Show the ester pyrolysis of ${ESTER} at 500 C. Draw the arrows.`);
  for (const question of [`Show the ester pyrolysis of ${ESTER} at 50 C.`, `Show the ester pyrolysis of ${ESTER} at 120 C.`, `Show the ester pyrolysis of ${ESTER} at 5000 C.`]) {
    assert.equal(readMechanismSource(question).status, "declined", question);
  }
});
check("source/temperature-sign", () => {
  assert.equal(readMechanismSource(`Show the ester pyrolysis of ${ESTER} at -300 C.`).status, "declined", "a minus sign is read");
  assert.equal(readMechanismSource(`Show the ester pyrolysis of ${ESTER} at −300 °C.`).status, "declined");
  for (const question of [`Show the ester pyrolysis of ${ESTER} at - 300 C`, `Show the ester pyrolysis of ${ESTER} at -- 500 C`, "Show the Chugaev reaction of CH3CH2-O-C(=S)-S-CH3 at - 150 C"]) {
    assert.equal(readMechanismSource(question).status, "declined", `${question}: a spaced sign is not dropped`);
  }
});
check("source/one-reaction-one-substrate", () => {
  for (const question of [
    `Show the mechanism of ester pyrolysis of ${ESTER} and CH3-C(=O)-O-C(CH3)3.`,
    `Show the ester pyrolysis of ${ESTER} and the Chugaev reaction of CH3CH2-O-C(=S)-S-CH3.`,
  ]) assert.equal(readMechanismSource(question).status, "declined", question);
});
check("source/notes-words", () => {
  // Read words in every other place: only the notes vocabulary refuses these.
  for (const question of [
    `Ester pyrolysis is not syn.\n${ESTER_SET}`,
    `Ester pyrolysis\n${ESTER_SET}\nRather the Chugaev reaction`,
  ]) assert.equal(readMechanismSource(question).status, "declined", question);
});
check("source/cleavage-of", () => {
  assert.equal(readMechanismSource(`Ester pyrolysis of ${ESTER_SET}`).status, "declined", "the set after \"of\" is the reactants");
});
check("source/pairing-verb", () => {
  compiles(drawn(`Ester pyrolysis gives ${ESTER_SET}.`), 3);
  assert.equal(readMechanismSource(`Ester pyrolysis gives a six membered TS\n${ESTER_SET}`).status, "declined", "a pairing verb stands only between a heading and its set");
});
check("source/cope-words", () => {
  assert.equal(readMechanismSource(`Ester pyrolysis involves the cleavage of amine oxides.\n${ESTER_SET}`).status, "declined", "amine oxides are read only beside the Cope elimination");
  assert.equal(readMechanismSource(`The Cope elimination gives ${COPE_SET} and the amine oxide.`).status, "declined", "an amine oxide is read only as the cleaved substrate");
});
check("source/both-reactions", () => {
  const doc = drawn(BOTH_PAGES);
  compiles(doc, 6);
  assert.ok(labels(doc).includes("Ester pyrolysis") && labels(doc).includes("Chugaev reaction"), "both rows titled");
  assert.match(caption(doc), /Ester pyrolysis and Xanthate/);
  assert.deepEqual(demotions(doc), [], "nothing declined");
});
check("source/contradicted-reaction-declines", () => {
  const doc = drawn(CONTRADICTED_PAGE);
  compiles(doc, 3);
  assert.ok(!doc.entities.some((entity) => entity.role === "S atom" || /^S|SH$/.test(entity.label ?? "")), "no sulfur anywhere: the xanthate row is not drawn");
  assert.doesNotMatch(caption(doc), /xanthate|chugaev|cope/i, "the caption names only what is drawn");
  assert.ok(!labels(doc).some((label) => /chugaev|xanthate|cope/i.test(label)), "no title for a declined reaction");
  const codes = demotions(doc);
  assert.equal(codes.length, 3, "xanthate, Cope and the contradicted product set are recorded");
  assert.ok(codes.every((entry) => entry.code === "mechanism_reaction_declined"));
  assert.ok(codes.some((entry) => /HS-C\(=S\)-SH/.test(entry.message)), "the contradicted products are named in the demotion");
});
/** The stored 051f3436 notes: each product set runs straight into the next heading on its line. */
const NOTES_051 = "COPE ELIMINATION Ester pyrolysis\nA six membered T.S.\nHeat\nCH_2=CH_2 + R-C(=O)-OH xanthate pyrolysis\nA six membered T.S.\nHeat\nCH_2=CH_2 + HS-C(=S)-SH The cope elimination involves the cleavage of amine oxid";
check("source/notes-051", () => {
  const doc = drawn(NOTES_051);
  compiles(doc, 3);
  assert.deepEqual(labels(doc).filter((label) => /pyrolysis|chugaev|cope/i.test(label)), ["Ester pyrolysis"], "the ester row only");
  assert.equal(demotions(doc).length, 3, "xanthate, Cope and the contradicted set are recorded");
});
check("source/truncated-tail", () => {
  assert.equal(readMechanismSource(NOTES_051.replace(/oxid$/, "oxid and the")).status, "declined", "a cut word inside the stem is not read");
  assert.equal(readMechanismSource(`Ester pyrolysis\n${ESTER_SET}\nThe Cope elimination not`).status, "declined", "\"not\" is never read as the start of \"note\"");
});
check("source/headings", () => {
  for (const question of [
    // swapped headings, each set under its own
    `Ester pyrolysis\nA six membered T.S.\n${XANTHATE_SET} xanthate pyrolysis\nA six membered T.S.\n${ESTER_SET}`,
    `Ester pyrolysis:\n${XANTHATE_SET}\nChugaev reaction:\n${ESTER_SET}`,
    `Ester pyrolysis gives ${XANTHATE_SET}. Xanthate pyrolysis gives CH2=CH2 + CH3-C(=O)-OH.`,
    `Ester pyrolysis and the Chugaev reaction\nChugaev reaction:\n${ESTER_SET}`,
    `Xanthate pyrolysis. Ester pyrolysis on heating ${XANTHATE_SET}.`,
  ]) assert.equal(readMechanismSource(question).status, "declined", question);
  compiles(drawn(`Ester pyrolysis:\n${ESTER_SET}\nChugaev reaction:\n${XANTHATE_SET}`), 6);
  compiles(drawn(`Ester pyrolysis: ${ESTER_SET}. Chugaev reaction: ${XANTHATE_SET}.`), 6);
  compiles(drawn(`Ester pyrolysis gives CH2=CH2 + CH3-C(=O)-OH and xanthate pyrolysis gives ${XANTHATE_SET}.`), 6);
});
check("source/heading-group-sentence", () => {
  // Two headings split by a full stop: the set is under the second only.
  assert.equal(readMechanismSource(`Ester pyrolysis. Chugaev reaction ${ESTER_SET}`).status, "declined");
});
check("source/linked-after", () => {
  for (const question of [
    `${XANTHATE_SET} via ester pyrolysis. ${ESTER_SET} via the Chugaev reaction.`,
    `${XANTHATE_SET} (ester pyrolysis). ${ESTER_SET} (Chugaev reaction).`,
    `${XANTHATE_SET} for ester pyrolysis. ${ESTER_SET} for the Chugaev reaction.`,
    `${XANTHATE_SET}: ester pyrolysis.\n${ESTER_SET}: Chugaev reaction.`,
    `${XANTHATE_SET} - ester pyrolysis\n${ESTER_SET} - Chugaev reaction`,
  ]) assert.equal(readMechanismSource(question).status, "declined", question);
});
check("source/drawn-set-elsewhere", () => {
  for (const question of [
    `Ester pyrolysis\n${ESTER_SET}\nChugaev reaction\n${ESTER_SET}`,
    `Ester pyrolysis gives ${ESTER_SET} and the Cope elimination gives ${ESTER_SET}`,
  ]) assert.equal(readMechanismSource(question).status, "declined", `${question}: the drawn panel would answer the contradicted reaction`);
});
check("source/cope-phrase-scope", () => {
  for (const question of [
    `Ester pyrolysis involves the cleavage of amine oxides and the Cope elimination\n${ESTER_SET}`,
    `Ester pyrolysis involves the cleavage of amine oxides, Cope elimination\n${ESTER_SET}`,
    `Ester pyrolysis\n${ESTER_SET}\nThe Cope elimination involves cleavage of the arrow`,
    // Two names, neither joined nor listed: only the one name rule keeps the phrase from ester pyrolysis.
    `The Cope elimination: ester pyrolysis involves the cleavage of amine oxides\n${ESTER_SET}`,
  ]) assert.equal(readMechanismSource(question).status, "declined", question);
});
check("source/symbols", () => {
  for (const question of [
    `Ester pyrolysis ← ${ESTER_SET}`, `Ester pyrolysis <- ${ESTER_SET}`, `Ester pyrolysis ⇌ ${ESTER_SET}`, `Ester pyrolysis ≠ ${ESTER_SET}`,
    `Ester pyrolysis -/-> ${ESTER_SET}`, `Ester pyrolysis ✗ ${ESTER_SET}`,
    `Ester pyrolysis -\n${ESTER_SET}`, `Ester pyrolysis\n${ESTER_SET} (-)`,
    `Show the ester pyrolysis of ${ESTER} at <250 °C`, `Show the ester pyrolysis of ${ESTER} at ≤ 300 C`, "Show the Chugaev reaction of CH3CH2-O-C(=S)-S-CH3 at > 700 C",
  ]) assert.equal(readMechanismSource(question).status, "declined", question);
});
check("source/joined-heading", () => {
  for (const question of [
    `Cope elimination and ester pyrolysis\nA six membered cyclic transition state\nHeat\n${ESTER_SET}`,
    `Ester pyrolysis and the Cope elimination\nA five membered T.S.\n${COPE_SET}`,
  ]) assert.equal(readMechanismSource(question).status, "declined", `${question}: one set under two joined names`);
});
check("source/comma-after-set", () => {
  assert.equal(readMechanismSource(`Ester pyrolysis: ${ESTER_SET}, Chugaev reaction`).status, "declined");
});
check("source/lower-case-ts", () => {
  // "t.s." does not end a sentence, so both names stay one heading over both sets.
  compiles(drawn(`Ester pyrolysis via a six membered t.s. xanthate pyrolysis\n${ESTER_SET}\n${XANTHATE_SET}`), 6);
});
check("source/listing", () => {
  const read = readMechanismSource(`Ester pyrolysis and the Chugaev reaction: ${XANTHATE_SET} and ${ESTER_SET}`);
  assert.equal(read.status, "declined", "a listing's order is not read, so it is not silently re-paired by chemistry");
  assert.match((read as { reason: string }).reason, /which gives which/);
});
check("source/paired-products-fail", () => {
  // The text gives ester pyrolysis the xanthate set; the ester set below it is not taken instead.
  assert.equal(readMechanismSource(`Ester pyrolysis: ${XANTHATE_SET}\n${ESTER_SET}\nChugaev reaction`).status, "declined");
});
check("source/spare-set", () => {
  const read = readMechanismSource(`Ester pyrolysis and the Chugaev reaction\n${ESTER_SET}\n${XANTHATE_SET}\nCH2=CH2 + HS-C(=O)-SH`);
  assert.equal(read.status, "declined");
  assert.match((read as { reason: string }).reason, /stated product set that no named reaction gives/);
});
check("source/ring-sizes-swapped", () => {
  assert.equal(readMechanismSource(`Ester pyrolysis via a five-membered TS: ${ESTER_SET}\nCope elimination via a six-membered TS: ${COPE_SET}`).status, "declined", "two stated sizes cannot be bound to one reaction each");
});
check("source/cope", () => {
  const doc = drawn(`Cope elimination: ${COPE_SET}`);
  compiles(doc, 3);
  assert.ok(labels(doc).includes("N^(+)") && labels(doc).includes("O^(-)"), "the amine oxide charges are drawn");
  assert.ok(labels(doc).includes("five-membered TS"));
});
check("source/ring-size-disagrees", () => {
  assert.equal(readMechanismSource(`Cope elimination through a six membered T.S.: ${COPE_SET}`).status, "declined");
});
check("source/two-substrates-decline", () => {
  assert.equal(readMechanismSource("Ester pyrolysis gives CH2=CH-CH3 + R-C(=O)-OH").status, "declined");
});

/* ------------------------------------------------------------------------- */
/* Lone product row and cue                                                  */
/* ------------------------------------------------------------------------- */

const UNVERIFIED_ASKS = [
  "Show the SN2 mechanism: bromoethane reacts with hydroxide ion to give ethanol.",
  "Draw the reaction mechanism for the conversion of ethanol to ethene with conc. H2SO4.",
  "Explain the mechanism of xanthate pyrolysis of ethyl xanthate to give ethene.",
  "Ester pyrolysis: ethyl acetate on heating gives ethene and acetic acid. Show the mechanism.",
  "Show the curly arrows for 2-bromo-2-methylpropane reacting with water by SN1 to give 2-methylpropan-2-ol.",
  "mechanism of nitration of benzene",
  "Explain with arrows how bromoethane reacts with hydroxide ion to give ethanol.",
  "Show how bromoethane undergoes S_N2 substitution with hydroxide ion.",
  "Show how 2-bromo-2-methylpropane gives 2-methylpropan-2-ol in an SN¹ reaction.",
  "E2 of 2-bromopropane with ethoxide gives propene. Show how the alkene forms.",
  "Show the syn elimination of ethyl acetate via a cyclic transition state.",
  "Draw the S_N2 reaction of bromoethane with hydroxide ion.",
  "Draw the SN-2 reaction of bromoethane with hydroxide ion.",
  "The S_N2 reaction of bromoethane with hydroxide gives ethanol. Explain.",
  "Give the steps of the SN¹ reaction of 2-bromo-2-methylpropane with water.",
  "Explain the Cope rearrangement of hexa-1,5-diene.",
  // the third review: every spelling and the plainer ask words
  "Explain the sn2 reaction of bromoethane with hydroxide ion.",
  "Explain the Sn2 reaction of bromoethane with hydroxide ion.",
  "Show the e2 reaction of 2-bromopropane with ethoxide.",
  "How does bromoethane react with hydroxide ion by SN2?",
  "Explain the mechanisim of nitration of benzene.",
  "Explain the mechansim of nitration of benzene.",
  "Explain the mecanism of nitration of benzene.",
  "Explain Claisen rearrangement of allyl phenyl ether.",
  "Draw the arrows for the reaction of bromoethane with hydroxide ion.",
  "Show the movement of electrons when bromoethane reacts with hydroxide ion.",
];
const loneRow = (question: string): string => `lone-row/${UNVERIFIED_ASKS.indexOf(question) + 1}`;
UNVERIFIED_ASKS.forEach((question, index) => {
  check(`lone-row/${index + 1}`, () => {
    assert.ok(inferChemistryFamilies(question).includes("chem_organic"), "the organic family is tried");
    assert.equal(buildOrganicScene(question, [], false), null, "a mechanism ask draws no product row without arrows");
  });
});
check("lone-row/reactivity-order-keeps-structures", () => {
  const question = "Arrange 1-bromopentane, 2-bromopentane and 2-bromo-2-methylbutane in increasing order of reactivity towards the SN2 reaction and towards the SN1 reaction.";
  assert.equal(readMechanismSource(question).status, "not_applicable", "naming SN1 and SN2 is not an ask for arrows");
  assert.ok(buildOrganicScene(question, [], false), "the three substrates still draw");
});
check("lone-row/reactivity-explain-keeps-structures", () => {
  const question = "Explain why 2-bromo-2-methylbutane is more reactive than 1-bromopentane towards SN1.";
  assert.equal(readMechanismSource(question).status, "not_applicable", "a reactivity comparison is not an ask for arrows");
  assert.ok(buildOrganicScene(question, [], false), "the two substrates still draw");
});
check("lone-row/rearrangement-needs-a-name", () => {
  const question = "Addition of HBr to 3-methylbut-1-ene first forms a secondary carbocation, which rearranges before bromide bonds. What rearrangement occurs, and which cation is captured?";
  assert.equal(readMechanismSource(question).status, "not_applicable", "'What rearrangement' names no rearrangement");
  assert.ok(buildOrganicScene(question, [], false), "the reactant row still draws");
});
check("lone-row/show-how-is-not-a-mechanism", () => {
  // "show how" asks for many things; the Hofmann carbon count keeps its checked reaction figure.
  const question = "Benzamide is treated with Br2 and aqueous NaOH. Show the amine product and show how the carbon count changes.";
  assert.equal(readMechanismSource(question).status, "not_applicable");
  assert.ok(buildOrganicScene(question, [], false), "the reaction figure still draws");
});
check("lone-row/tin-is-not-sn2", () => {
  assert.equal(readMechanismSource("Explain why Sn2+ reduces Fe3+ to Fe2+.").status, "not_applicable", "Sn2+ is the tin(II) ion");
  assert.ok(buildOrganicScene("Explain why SnCl2 is a reducing agent for nitrobenzene.", [], false), "a tin reagent beside an organic name keeps its row");
});
check("cue/condensed-only", () => {
  assert.ok(inferChemistryFamilies("Show the ester pyrolysis of CH3-C(=O)-O-CH2CH3 on heating.").includes("chem_organic"));
  assert.ok(inferChemistryFamilies("Cope elimination: CH2=CH2 + HO-N(CH3)2").includes("chem_organic"));
});

/* ------------------------------------------------------------------------- */
/* Mutants                                                                   */
/* ------------------------------------------------------------------------- */

interface Mutant { name: string; file: string; from: string; to: string; red: string[] }
const MUTANTS: Mutant[] = [
  { name: "lone-pair-count", file: "chemistry/organic/mechanism/arrows.ts", from: "if (state.atoms[atom]!.lonePairs < used) return", to: "if (false) return", red: ["arrows/lone-pair-must-exist"] },
  { name: "lone-pair-own-atom", file: "chemistry/organic/mechanism/arrows.ts", from: "if (head.kind !== \"bond\" || (head.a !== tail.atom && head.b !== tail.atom) || head.a === head.b) return", to: "if (head.kind !== \"bond\" || head.a === head.b) return", red: ["arrows/lone-pair-own-atom"] },
  { name: "bond-pair-adjacent", file: "chemistry/organic/mechanism/arrows.ts", from: "return shared === 1 ? null :", to: "return shared <= 1 ? null :", red: ["arrows/bond-pair-adjacent"] },
  { name: "octet", file: "chemistry/organic/mechanism/state.ts", from: "if (electrons > 8) out.push", to: "if (electrons > 10) out.push", red: ["arrows/octet"] },
  { name: "sextet-declared", file: "chemistry/organic/mechanism/state.ts", from: "&& allowedSextets.includes(index)", to: "", red: ["arrows/sn1-undeclared-sextet"] },
  { name: "xanthate-leaving-o", file: "chemistry/organic/mechanism/eliminations.ts", from: "if (element(state, leaving) !== \"O\" || around.length !== 2", to: "if (![\"O\", \"S\"].includes(element(state, leaving)) || around.length !== 2", red: ["eliminations/xanthate-is-o-alkyl"] },
  { name: "one-substrate", file: "chemistry/organic/mechanism/eliminations.ts", from: "if (verified.some((model) => !sameSpecies(model.substrate, [first.substrate]))) return", to: "if (false) return", red: ["eliminations/two-substrates", "source/two-substrates-decline"] },
  { name: "equivalent-sites", file: "chemistry/organic/mechanism/eliminations.ts", from: "if (runs.some((run) => !sameSpecies(run!.products, [first.products]))) return", to: "if (false) return", red: ["eliminations/inequivalent-sites"] },
  { name: "type-with-verb", file: "chemistry/organic/mechanism/source.ts", from: "return MECHANISM_TYPE.test(question) && ASK_VERB.test(question) && !COMPARISON.test(question);", to: "return false;", red: [
    "Show how bromoethane undergoes S_N2 substitution with hydroxide ion.",
    "Show how 2-bromo-2-methylpropane gives 2-methylpropan-2-ol in an SN¹ reaction.",
    "E2 of 2-bromopropane with ethoxide gives propene. Show how the alkene forms.",
    "Draw the S_N2 reaction of bromoethane with hydroxide ion.",
    "Draw the SN-2 reaction of bromoethane with hydroxide ion.",
    "The S_N2 reaction of bromoethane with hydroxide gives ethanol. Explain.",
    "Give the steps of the SN¹ reaction of 2-bromo-2-methylpropane with water.",
    "Explain the sn2 reaction of bromoethane with hydroxide ion.",
    "Explain the Sn2 reaction of bromoethane with hydroxide ion.",
    "Show the e2 reaction of 2-bromopropane with ethoxide.",
    "How does bromoethane react with hydroxide ion by SN2?",
  ].map((question) => `lone-row/${UNVERIFIED_ASKS.indexOf(question) + 1}`) },
  { name: "type-comparison", file: "chemistry/organic/mechanism/source.ts", from: "&& !COMPARISON.test(question);", to: ";", red: ["lone-row/reactivity-explain-keeps-structures"] },
  { name: "named-rearrangement", file: "chemistry/organic/mechanism/source.ts", from: "if (NAMED_REARRANGEMENT.test(question)) return true;", to: "", red: ["Explain the Cope rearrangement of hexa-1,5-diene.", "Explain Claisen rearrangement of allyl phenyl ether."].map(loneRow) },
  { name: "rearrangement-article", file: "chemistry/organic/mechanism/source.ts", from: "/\\b(?:the|a|[Ee]xplain|[Ss]how|[Dd]raw|[Dd]escribe|[Gg]ive)\\s+[A-Z][a-z]+", to: "/\\b[A-Z][a-z]+", red: ["lone-row/rearrangement-needs-a-name"] },
  { name: "rearrangement-verb", file: "chemistry/organic/mechanism/source.ts", from: "(?:the|a|[Ee]xplain|[Ss]how|[Dd]raw|[Dd]escribe|[Gg]ive)\\s+[A-Z]", to: "(?:the|a)\\s+[A-Z]", red: [loneRow("Explain Claisen rearrangement of allyl phenyl ether.")] },
  { name: "type-case", file: "chemistry/organic/mechanism/source.ts", from: "/\\b[Ss]\\s?_?\\s?[Nn]\\s?-?\\s?[12¹²](?![0-9+⁺])|\\b[Ee]\\s?", to: "/\\bS\\s?_?\\s?N\\s?-?\\s?[12¹²](?![0-9+⁺])|\\bE\\s?", red: ["Explain the sn2 reaction of bromoethane with hydroxide ion.", "Explain the Sn2 reaction of bromoethane with hydroxide ion.", "Show the e2 reaction of 2-bromopropane with ethoxide."].map(loneRow) },
  { name: "tin-charge", file: "chemistry/organic/mechanism/source.ts", from: "[Nn]\\s?-?\\s?[12¹²](?![0-9+⁺])", to: "[Nn]\\s?-?\\s?[12¹²]", red: ["lone-row/tin-is-not-sn2"] },
  { name: "ask-how", file: "chemistry/organic/mechanism/source.ts", from: "|steps|how)\\b/i;", to: "|steps)\\b/i;", red: [loneRow("How does bromoethane react with hydroxide ion by SN2?")] },
  { name: "mechanism-spelling", file: "chemistry/organic/mechanism/source.ts", from: "/\\bmec?h?ani?s[ia]?m|", to: "/\\bmechanisms?\\b|", red: ["Explain the mechanisim of nitration of benzene.", "Explain the mechansim of nitration of benzene.", "Explain the mecanism of nitration of benzene."].map(loneRow) },
  { name: "draw-arrows", file: "chemistry/organic/mechanism/source.ts", from: "|\\b(?:draw|show|add|mark)\\s+(?:in\\s+)?(?:the\\s+)?arrows?\\b", to: "", red: [loneRow("Draw the arrows for the reaction of bromoethane with hydroxide ion.")] },
  { name: "electron-movement", file: "chemistry/organic/mechanism/source.ts", from: "|\\bmovement\\s+of\\s+(?:the\\s+)?electrons?\\b", to: "", red: [loneRow("Show the movement of electrons when bromoethane reacts with hydroxide ion.")] },
  { name: "token-punctuation", file: "chemistry/organic/mechanism/source.ts", from: "replace(/[,;:.?!]+$/, \"\")", to: "replace(/[,;:.]+$/, \"\")", red: ["source/ask-shape"] },
  { name: "ask-shape", file: "chemistry/organic/mechanism/source.ts", from: "if (!ASK_SHAPE.test(words.join(\" \"))) return", to: "if (false) return", red: ["source/outside-shapes", "source/one-reaction-one-substrate"] },
  { name: "temperature-range", file: "chemistry/organic/mechanism/source.ts", from: "if (temperatures.some((value) => value < low || value > high)) return", to: "if (false) return", red: ["source/temperature"] },
  { name: "notes-words", file: "chemistry/organic/mechanism/source.ts", from: "    if (outside) return declinedRead(", to: "    if (false) return declinedRead(", red: ["source/outside-shapes", "source/notes-words", "source/cleavage-of", "source/cope-words", "source/cope-phrase-scope", "source/pairing-verb", "source/truncated-tail"] },
  { name: "pairing-verb", file: "chemistry/organic/mechanism/source.ts", from: "if (PAIRING_VERB.has(word) && words[at - 1]! in NAME_TOKEN_KINDS && words[at + 1] === \"zset\") continue;", to: "if (PAIRING_VERB.has(word)) continue;", red: ["source/pairing-verb", "source/outside-shapes"] },
  { name: "linked-after", file: "chemistry/organic/mechanism/source.ts", from: "    if (linkedAfter) return declinedRead(", to: "    if (false) return declinedRead(", red: ["source/linked-after", "source/outside-shapes", "source/comma-after-set"] },
  { name: "heading-sentence", file: "chemistry/organic/mechanism/source.ts", from: "const split = breaksIn(between) ||", to: "const split = between.includes(\"\\n\") ||", red: ["source/contradicted-reaction-declines"] },
  { name: "heading-line", file: "chemistry/organic/mechanism/source.ts", from: "const split = breaksIn(between) ||", to: "const split = /[.?!;]/.test(between) ||", red: ["cue/condensed-only", "figure/narration", "source/both-reactions", "source/contradicted-reaction-declines", "source/cope", "source/drawn-set-elsewhere", "source/heading-group-sentence", "source/headings", "source/joined-heading", "source/listing", "source/lower-case-ts", "source/notes-051", "source/paired-products-fail", "source/pairing-verb", "source/ring-size-disagrees", "source/spare-set", "source/two-substrates-decline"] },
  { name: "listing", file: "chemistry/organic/mechanism/source.ts", from: "if (headings.some((heading) => heading.sameLine && heading.kinds.length > 1)) return", to: "if (false) return", red: ["source/listing"] },
  { name: "paired-products-fail", file: "chemistry/organic/mechanism/source.ts", from: "if (headings.some((heading, index) => heading.kinds.length === 1 && heading.kinds[0] === kind && !verifies[index]!.has(kind))) decline(", to: "if (false) decline(", red: ["source/paired-products-fail"] },
  { name: "spare-set", file: "chemistry/organic/mechanism/source.ts", from: "    if (unbound.length > named.length - drawn.length) return", to: "    if (false) return", red: ["source/spare-set"] },
  { name: "unbound-demotion", file: "chemistry/organic/mechanism/source.ts", from: "    for (const set of unbound) {\n", to: "    for (const set of unbound.slice(1)) {\n", red: ["source/contradicted-reaction-declines", "source/notes-051"] },
  { name: "ring-size", file: "chemistry/organic/mechanism/source.ts", from: "if (sizes.size && !sizes.has(CYCLIC_RING_SIZE[model.kind]))", to: "if (false)", red: ["source/ring-size-disagrees", "source/ring-size-read"] },
  { name: "ring-sizes-distinct", file: "chemistry/organic/mechanism/source.ts", from: "if (sizes.size > 1) return", to: "if (false) return", red: ["source/ring-sizes-swapped"] },
  { name: "ring-size-centre", file: "chemistry/organic/mechanism/source.ts", from: "|cent(?:re|er)(?:d|ed)?", to: "", red: ["source/ring-size-read"] },
  { name: "cope-phrase-only-name", file: "chemistry/organic/mechanism/source.ts", from: "if (names.length && names.every((name) => name === NAME_TOKEN.cope_elimination)) {", to: "if (names.includes(NAME_TOKEN.cope_elimination)) {", red: ["source/cope-phrase-scope"] },
  { name: "cope-phrase-cut", file: "chemistry/organic/mechanism/source.ts", from: "      if (index === lastSentence && /\\p{L}$/u.test(question)) sentence =", to: "      if (false) sentence =", red: ["source/notes-051", "source/contradicted-reaction-declines"] },
  { name: "cope-phrase-cut-at-end", file: "chemistry/organic/mechanism/source.ts", from: "(?: (?:oxide|oxid|oxi|ox|o)?)?$/;", to: "(?: (?:oxide|oxid|oxi|ox|o)?)?/;", red: ["source/truncated-tail"] },
  { name: "shape-characters", file: "chemistry/organic/mechanism/source.ts", from: "  if (!SHAPE_CHARACTERS.test(text.replace(/->/g, \"→\"))) return", to: "  if (false) return", red: ["source/symbols", "source/temperature-sign"] },
  { name: "joined-heading", file: "chemistry/organic/mechanism/source.ts", from: "if (headings.some((heading) => heading.joined && setsUnder(heading.group) < heading.kinds.length)) return", to: "if (false) return", red: ["source/joined-heading"] },
  { name: "comma-after-set", file: "chemistry/organic/mechanism/source.ts", from: "!/^\\s*(?:and\\s+)?(?:the\\s+)?$/i.test(between)", to: "!/^[\\s,]*(?:and\\s+)?(?:the\\s+)?$/i.test(between)", red: ["source/comma-after-set"] },
  { name: "drawn-set-elsewhere", file: "chemistry/organic/mechanism/source.ts", from: "    if (sets.some((set, index) => !drawnFrom.has(index) && set.species && drawn.some(", to: "    if (false && sets.some((set, index) => !drawnFrom.has(index) && set.species && drawn.some(", red: ["source/drawn-set-elsewhere"] },
  { name: "ts-case", file: "chemistry/organic/mechanism/source.ts", from: "text.replace(/\\bT\\.\\s?S\\./gi, \"TS\")", to: "text.replace(/\\bT\\.\\s?S\\./g, \"TS\")", red: ["source/lower-case-ts"] },
  { name: "bare-sign", file: "chemistry/organic/mechanism/source.ts", from: "→⟶⇒Δ]*$/u;", to: "→⟶⇒Δ-]*$/u;", red: ["source/temperature-sign", "source/symbols"] },
  { name: "show-how-cue", file: "chemistry/organic/mechanism/source.ts", from: "|\\btransition\\s+state\\b/i;", to: "|\\btransition\\s+state\\b|\\bshow\\s+how\\b/i;", red: ["lone-row/show-how-is-not-a-mechanism"] },
  { name: "cope-tertiary", file: "chemistry/organic/mechanism/eliminations.ts", from: "if (!around.every((other) => other === oxide[0] || CARBON_LIKE.has(element(state, other)))) continue;", to: "", red: ["eliminations/cope-is-tertiary"] },
  { name: "xanthate-s-alkyl", file: "chemistry/organic/mechanism/eliminations.ts", from: "&& zTail.length === 1 && CARBON_LIKE.has(element(state, zTail[0]!))", to: "", red: ["eliminations/xanthate-is-s-alkyl", "source/spare-set"] },
  { name: "alpha-hydrocarbon", file: "chemistry/organic/mechanism/eliminations.ts", from: "if (!hydrocarbon(alpha, [leaving])) continue;", to: "", red: ["eliminations/no-enol-alpha"] },
  { name: "beta-hydrocarbon", file: "chemistry/organic/mechanism/eliminations.ts", from: " || !hydrocarbon(beta, [])) continue;", to: ") continue;", red: ["eliminations/no-enol-beta"] },
  { name: "two-products", file: "chemistry/organic/mechanism/eliminations.ts", from: "if (fragments(first.products).length !== 2) return", to: "if (false) return", red: ["eliminations/one-product-lactone"] },
  { name: "group-pair-spread", file: "chemistry/organic/mechanism/figure.ts", from: "const GROUP_PAIR_SPREAD = Math.PI / 3;", to: "const GROUP_PAIR_SPREAD = 0.5;", red: ["source/textbook-substrates"] },
  { name: "dagger-clear", file: "chemistry/organic/mechanism/figure.ts", from: "{ x: Math.max(ts.maxX, ts.labelMaxX) + 0.15,", to: "{ x: ts.maxX + 0.15,", red: ["source/textbook-substrates", "source/ask-shape", "source/both-reactions", "source/headings", "source/lower-case-ts"] },
  { name: "arrow-count", file: "chemistry/organic/mechanism/figure.ts", from: "`${model.step.arrows.length} curly arrows;", to: "`${arrows.length} curly arrows;", red: ["figure/narration"] },
  { name: "second-product", file: "chemistry/organic/mechanism/figure.ts", from: "an alkene and ${SECOND_PRODUCT[model.kind]}.", to: "an alkene and the eliminated acid.", red: ["figure/narration"] },
  { name: "hook-declined", file: "chemistry/organic/index.ts", from: "  if (mechanism.status === \"declined\") return null;\n", to: "", red: UNVERIFIED_ASKS.map((_, index) => `lone-row/${index + 1}`) },
  { name: "mechanism-ask-scope", file: "chemistry/organic/mechanism/source.ts", from: "const MECHANISM_ASK = /", to: "const MECHANISM_ASK = /\\bS\\s?N\\s?[12]\\b|", red: ["lone-row/reactivity-order-keeps-structures", "lone-row/reactivity-explain-keeps-structures", "lone-row/tin-is-not-sn2"] },
  { name: "cue", file: "chemistry/organic/index.ts", from: "  if (readMechanismSource(question).status === \"source\") return true;\n", to: "", red: ["cue/condensed-only"] },
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
      const dir = mkdtempSync(join(packageRoot, `.mechanism-mutant-${mutant.name}-`));
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
