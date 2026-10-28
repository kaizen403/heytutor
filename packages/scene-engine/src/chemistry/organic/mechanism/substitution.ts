/**
 * SN2, SN1 and E2 as class operators on the checked electron state.
 *
 * Each operator finds its site on the graph and declines unless the site is
 * unique: the substrate is one neutral, saturated, acyclic haloalkane with
 * exactly one C-X bond (X = Cl, Br, I) and only C and H besides.
 *
 * - SN2: one step, two arrows (the nucleophile's lone pair to Calpha, the
 *   C-X pair to X). Calpha is methyl or primary, never neopentyl. The
 *   nucleophile is a halide ion, or an anion whose charged O or S has a
 *   lone pair and whose other atoms are C and H only (hydroxide, an
 *   alkoxide, hydrosulfide, a thiolate): IO-, ClO- and HSO- are not drawn.
 *   An alkoxide whose O carbon is secondary or tertiary attacks only a
 *   methyl carbon, and no O- base attacks a primary carbon whose neighbour
 *   is branched: there E2 competes, and the substitution product is not
 *   the outcome.
 * - SN1: Calpha is tertiary. Step 1 ionises (the C-X pair to X, the sextet
 *   declared on Calpha), step 2 a neutral O-H nucleophile's lone pair bonds
 *   to C+, step 3 a second solvent molecule takes the O-H proton (never
 *   the halide: Br- deprotonating an oxonium ion is uphill). The solvent is
 *   water or a primary alcohol; a more branched alcohol's cation product
 *   eliminates instead. A neighbour that could shift a hydride or alkyl
 *   group onto the cation, or a stereocentre at Calpha (attack from both
 *   faces), declines.
 * - E2: one step, three arrows (the base's lone pair to a beta H, that C-H
 *   pair to the C-C bond, the C-X pair to X). The base is a hydroxide or
 *   alkoxide anion. Beta sites that give different alkenes, an alkene with
 *   E and Z isomers, or a stereocentre at either carbon declines.
 *
 * Every step runs through `runMechanism`, so electrons, charge and shells
 * are checked on every state. `substitutionFromEquation` reads a stated
 * equation, requires its reactants to be exactly the operator's inputs and
 * its products to be exactly the species the arrows give.
 */
import { runMechanism, type MechanismStep } from "./arrows";
import { plainCondensed, readCondensed } from "./condensed";
import { bondOrder, combineStates, formalCharge, fragments, neighbourAtoms, sameSpecies, type MechState } from "./state";

export type SubstitutionClass = "SN2" | "SN1" | "E2";

export interface SubstitutionRoles {
  alpha: number;
  leaving: number;
  /** SN2, SN1: the atom that bonds to Calpha. */
  nucleophile?: number;
  /** SN1 step 3 and E2: the atom that takes the proton, and the proton. */
  base?: number;
  proton?: number;
  /** E2: the carbon that loses the proton. */
  beta?: number;
}

export interface SubstitutionModel {
  mechanism: SubstitutionClass;
  /** All reactants in one state: the substrate's atoms first, then each reagent molecule. */
  start: MechState;
  steps: MechanismStep[];
  /** states[0] is `start`; states[i + 1] is the state step i leaves. */
  states: MechState[];
  products: MechState;
  roles: SubstitutionRoles;
  substrateAtoms: number[];
  /** Atoms of each reagent molecule (nucleophile, base, solvent), in `start`. */
  reagentAtoms: number[][];
}

export type SubstitutionRead = { ok: true; model: SubstitutionModel } | { ok: false; reason: string };

const LEAVING = new Set(["Cl", "Br", "I"]);
const SN2_NUCLEOPHILE_ATOMS = new Set(["O", "S", "Cl", "Br", "I"]);
const element = (state: MechState, atom: number): string => state.atoms[atom]!.element;
const hydrogensOn = (state: MechState, atom: number): number[] => neighbourAtoms(state, atom).filter((other) => element(state, other) === "H");
const carbonsOn = (state: MechState, atom: number): number[] => neighbourAtoms(state, atom).filter((other) => element(state, other) === "C");
const fail = (reason: string): SubstitutionRead => ({ ok: false, reason });
const acyclic = (state: MechState): boolean => state.bonds.length === state.atoms.length - fragments(state).length;
const range = (from: number, count: number): number[] => Array.from({ length: count }, (_, index) => from + index);

/**
 * A canonical key for everything hanging off `root` away from `from`; null
 * when the walk meets a ring. Two substituents are the same group exactly
 * when their keys are equal.
 */
export function substituentKey(state: MechState, root: number, from: number, seen: Set<number> = new Set([from])): string | null {
  if (seen.has(root)) return null;
  seen.add(root);
  const parts: string[] = [];
  for (const next of neighbourAtoms(state, root)) {
    if (next === from) continue;
    const key = substituentKey(state, next, root, seen);
    if (key === null) return null;
    parts.push(`${bondOrder(state, root, next)}${key}`);
  }
  return `${element(state, root)}${formalCharge(state, root)}(${parts.sort().join(",")})`;
}

/** True when four different groups sit on the atom; null when a ring stops the comparison. */
export function isStereocentre(state: MechState, atom: number): boolean | null {
  const around = neighbourAtoms(state, atom);
  const keys = around.map((other) => substituentKey(state, other, atom));
  if (keys.some((key) => key === null)) return null;
  return around.length === 4 && new Set(keys).size === 4;
}

/** True when the C=C between `a` and `b` has E and Z isomers: each end carries two different groups. */
export function alkeneHasStereoisomers(state: MechState, a: number, b: number): boolean {
  const twoDifferent = (end: number, partner: number): boolean => {
    const others = neighbourAtoms(state, end).filter((other) => other !== partner);
    const keys = others.map((other) => substituentKey(state, other, end));
    return others.length === 2 && (keys[0] === null || keys[0] !== keys[1]);
  };
  return twoDifferent(a, b) && twoDifferent(b, a);
}

type Site = { ok: true; alpha: number; leaving: number } | { ok: false; reason: string };

/** The one C-X site of a neutral, saturated, acyclic haloalkane made of C, H and one halogen. */
export function haloalkaneSite(state: MechState): Site {
  if (fragments(state).length !== 1) return { ok: false, reason: "the substrate is not one species" };
  if (!acyclic(state)) return { ok: false, reason: "the substrate has a ring" };
  if (state.atoms.some((atom) => atom.element !== "C" && atom.element !== "H" && !LEAVING.has(atom.element))) return { ok: false, reason: "the substrate carries an atom other than C, H and one Cl, Br or I" };
  if (state.bonds.some((bond) => bond.order !== 1)) return { ok: false, reason: "the substrate is not saturated" };
  if (state.atoms.some((_, index) => formalCharge(state, index) !== 0)) return { ok: false, reason: "the substrate is charged" };
  const halogens = state.atoms.flatMap((atom, index) => (LEAVING.has(atom.element) ? [index] : []));
  if (halogens.length !== 1) return { ok: false, reason: halogens.length ? "more than one C-X bond: the site is not unique" : "no C-Cl, C-Br or C-I bond" };
  const leaving = halogens[0]!;
  const around = neighbourAtoms(state, leaving);
  if (around.length !== 1 || element(state, around[0]!) !== "C") return { ok: false, reason: "the halogen is not on a carbon" };
  return { ok: true, alpha: around[0]!, leaving };
}

type Centre = { ok: true; atom: number } | { ok: false; reason: string };

/** The charged atom of an anion made of C, H, O, S and halogens, single bonded and acyclic. */
function anionCentre(state: MechState, allowed: ReadonlySet<string>, speciesElements: ReadonlySet<string>): Centre {
  if (fragments(state).length !== 1 || !acyclic(state)) return { ok: false, reason: "the reagent is not one acyclic species" };
  if (state.atoms.some((atom) => !speciesElements.has(atom.element)) || state.bonds.some((bond) => bond.order !== 1)) return { ok: false, reason: "the reagent is not a simple anion" };
  const charged = state.atoms.flatMap((_, index) => (formalCharge(state, index) !== 0 ? [index] : []));
  if (charged.length !== 1 || formalCharge(state, charged[0]!) !== -1) return { ok: false, reason: "the reagent is not an anion with one charged atom" };
  const atom = charged[0]!;
  if (!allowed.has(element(state, atom)) || state.atoms[atom]!.lonePairs < 1) return { ok: false, reason: `the charged ${element(state, atom)} is not an attacking atom this class draws` };
  if (neighbourAtoms(state, atom).length > 1) return { ok: false, reason: "the charged atom has more than one neighbour" };
  return { ok: true, atom };
}

/** The O of a neutral O-H nucleophile (water or a primary alcohol) of C, H and one O. */
function oxygenNucleophile(state: MechState): Centre {
  if (fragments(state).length !== 1 || !acyclic(state)) return { ok: false, reason: "the solvent is not one acyclic species" };
  if (state.atoms.some((atom) => !["C", "H", "O"].includes(atom.element)) || state.bonds.some((bond) => bond.order !== 1)) return { ok: false, reason: "the solvent is not water or a saturated alcohol" };
  const oxygens = state.atoms.flatMap((atom, index) => (atom.element === "O" ? [index] : []));
  if (oxygens.length !== 1) return { ok: false, reason: "the solvent has no single O" };
  const atom = oxygens[0]!;
  // Neutral O-H: two bonds, one of them to H. An alkoxide (one bond) or an oxonium ion (three) is refused here.
  if (!hydrogensOn(state, atom).length || neighbourAtoms(state, atom).length !== 2) return { ok: false, reason: "SN1 is drawn with a neutral O-H nucleophile (water or an alcohol)" };
  // Water or a primary alcohol: a secondary or tertiary alcohol's ether product is not the outcome (the cation eliminates).
  const oxygenCarbon = carbonsOn(state, atom)[0];
  if (oxygenCarbon !== undefined && carbonsOn(state, oxygenCarbon).length >= 2) return { ok: false, reason: "the solvent is a secondary or tertiary alcohol: the cation eliminates rather than give the ether, so SN1 is drawn with water or a primary alcohol" };
  return { ok: true, atom };
}

function modelFrom(mechanism: SubstitutionClass, start: MechState, steps: MechanismStep[], roles: SubstitutionRoles, substrateAtoms: number[], reagentAtoms: number[][]): SubstitutionRead {
  const run = runMechanism(start, steps);
  if (!run.ok) return fail(`step ${run.step + 1} breaks the electron bookkeeping: ${run.reason}`);
  return { ok: true, model: { mechanism, start, steps, states: run.states, products: run.states.at(-1)!, roles, substrateAtoms, reagentAtoms } };
}

export function sn2(substrate: MechState, nucleophile: MechState): SubstitutionRead {
  const site = haloalkaneSite(substrate);
  if (!site.ok) return fail(site.reason);
  const carbons = carbonsOn(substrate, site.alpha);
  if (carbons.length > 1) return fail(`a ${carbons.length === 2 ? "secondary" : "tertiary"} carbon: SN2 is drawn only at a methyl or primary carbon`);
  if (carbons.length === 1 && carbonsOn(substrate, carbons[0]!).filter((other) => other !== site.alpha).length === 3) return fail("a neopentyl carbon: the crowded back side blocks SN2");
  const centre = anionCentre(nucleophile, SN2_NUCLEOPHILE_ATOMS, new Set(["C", "H", "O", "S", "Cl", "Br", "I"]));
  if (!centre.ok) return fail(centre.reason);
  const attacker = element(nucleophile, centre.atom);
  const rest = nucleophile.atoms.filter((_, index) => index !== centre.atom);
  // A halide ion is the bare atom; a charged O or S carries only C and H (no IO-, ClO-, HSO-).
  if (LEAVING.has(attacker) ? rest.length > 0 : rest.some((atom) => atom.element !== "C" && atom.element !== "H")) return fail(`the ${attacker}- nucleophile carries atoms other than C and H: only halide ions, hydroxide, alkoxides, hydrosulfide and thiolates are drawn`);
  if (attacker === "O") {
    const oxygenCarbon = carbonsOn(nucleophile, centre.atom)[0];
    const branched = oxygenCarbon !== undefined && carbonsOn(nucleophile, oxygenCarbon).length >= 2;
    if (branched && carbons.length > 0) return fail("a secondary or tertiary alkoxide is a bulky strong base: at a primary carbon E2 competes, so it is drawn only on a methyl halide");
    if (carbons.length === 1 && carbonsOn(substrate, carbons[0]!).length - 1 >= 2) return fail("a branched carbon next to the C-X carbon: with an O- base E2 competes, so the substitution product is not the outcome");
  }
  const { state, offsets } = combineStates([substrate, nucleophile]);
  const alpha = site.alpha, leaving = site.leaving, attack = offsets[1]! + centre.atom;
  const step: MechanismStep = { arrows: [
    { tail: { kind: "lone_pair", atom: attack }, head: { kind: "bond", a: attack, b: alpha } },
    { tail: { kind: "bond", a: alpha, b: leaving }, head: { kind: "atom", atom: leaving } },
  ] };
  // One substrate and one nucleophile, each a single species (haloalkaneSite, anionCentre): the arrows join them and cut X- off, so exactly two species leave.
  return modelFrom("SN2", state, [step], { alpha, leaving, nucleophile: attack }, range(0, substrate.atoms.length), [range(offsets[1]!, nucleophile.atoms.length)]);
}

export function sn1(substrate: MechState, solvent: readonly MechState[]): SubstitutionRead {
  const site = haloalkaneSite(substrate);
  if (!site.ok) return fail(site.reason);
  const carbons = carbonsOn(substrate, site.alpha);
  if (carbons.length !== 3) return fail(`a ${["methyl", "primary", "secondary"][carbons.length]} carbon: SN1 is drawn only at a tertiary carbon`);
  // A hydride or alkyl shift from a neighbour with two more carbons gives another tertiary cation, and so other products.
  if (carbons.some((next) => carbonsOn(substrate, next).length - 1 >= 2)) return fail("a neighbouring carbon could shift a hydride or alkyl group onto the carbocation: rearranged products are possible");
  const chiral = isStereocentre(substrate, site.alpha);
  if (chiral !== false) return fail("the carbon is a stereocentre: attack on both faces of the planar cation (racemisation) would have to be drawn");
  // The second solvent molecule takes the proton; the halide never does (Br- deprotonating an oxonium ion is uphill).
  if (solvent.length !== 2) return fail("SN1 is drawn with two solvent molecules: one bonds to the cation and the second takes the O-H proton (the halide is too weak a base)");
  if (!sameSpecies(solvent[0]!, [solvent[1]!])) return fail("the two solvent molecules differ");
  const centres = solvent.map(oxygenNucleophile);
  const bad = centres.find((centre) => !centre.ok);
  if (bad && !bad.ok) return fail(bad.reason);
  const { state, offsets } = combineStates([substrate, ...solvent]);
  const alpha = site.alpha, leaving = site.leaving;
  const oxygen = offsets[1]! + (centres[0] as { atom: number }).atom;
  const base = offsets[2]! + (centres[1] as { atom: number }).atom;
  const stepsFor = (proton: number): MechanismStep[] => [
    { arrows: [{ tail: { kind: "bond", a: alpha, b: leaving }, head: { kind: "atom", atom: leaving } }], sextets: [alpha] },
    { arrows: [{ tail: { kind: "lone_pair", atom: oxygen }, head: { kind: "bond", a: oxygen, b: alpha } }] },
    { arrows: [
      { tail: { kind: "lone_pair", atom: base }, head: { kind: "bond", a: base, b: proton } },
      { tail: { kind: "bond", a: oxygen, b: proton }, head: { kind: "atom", atom: oxygen } },
    ] },
  ];
  const reagents = solvent.map((entry, index) => range(offsets[index + 1]!, entry.atoms.length));
  const runs = hydrogensOn(state, oxygen).map((proton) => modelFrom("SN1", state, stepsFor(proton), { alpha, leaving, nucleophile: oxygen, base, proton }, range(0, substrate.atoms.length), reagents));
  const first = runs[0];
  if (!first) return fail("the solvent O carries no O-H proton");
  if (!first.ok) return first;
  if (runs.some((run) => !run.ok || !sameSpecies(run.model.products, [first.model.products]))) return fail("the O-H protons give different products");
  return first;
}

export function e2(substrate: MechState, base: MechState): SubstitutionRead {
  const site = haloalkaneSite(substrate);
  if (!site.ok) return fail(site.reason);
  const betas = carbonsOn(substrate, site.alpha).filter((beta) => hydrogensOn(substrate, beta).length > 0);
  if (!betas.length) return fail("no hydrogen on a carbon next to the C-X carbon");
  const centre = anionCentre(base, new Set(["O"]), new Set(["C", "H", "O"]));
  if (!centre.ok) return fail(`${centre.reason}: E2 is drawn with a hydroxide or alkoxide base`);
  if (base.atoms.filter((atom) => atom.element === "O").length !== 1) return fail("the base has more than one O");
  // On a primary (or methyl) halide an unhindered base mostly substitutes, so E2 is the outcome only with a tertiary alkoxide.
  const baseCarbon = carbonsOn(base, centre.atom)[0];
  const bulkyBase = baseCarbon !== undefined && carbonsOn(base, baseCarbon).length === 3;
  if (carbonsOn(substrate, site.alpha).length <= 1 && !bulkyBase) return fail("on a primary halide an unhindered base gives mostly substitution: E2 is drawn there only with a tertiary alkoxide");
  const { state, offsets } = combineStates([substrate, base]);
  const alpha = site.alpha, leaving = site.leaving, attack = offsets[1]! + centre.atom;
  const runs = betas.map((beta) => {
    const proton = hydrogensOn(state, beta)[0]!;
    const step: MechanismStep = { arrows: [
      { tail: { kind: "lone_pair", atom: attack }, head: { kind: "bond", a: attack, b: proton } },
      { tail: { kind: "bond", a: beta, b: proton }, head: { kind: "bond", a: beta, b: alpha } },
      { tail: { kind: "bond", a: alpha, b: leaving }, head: { kind: "atom", atom: leaving } },
    ] };
    return modelFrom("E2", state, [step], { alpha, leaving, base: attack, proton, beta }, range(0, substrate.atoms.length), [range(offsets[1]!, base.atoms.length)]);
  });
  const first = runs[0]!;
  if (!first.ok) return first;
  if (runs.some((run) => !run.ok || !sameSpecies(run.model.products, [first.model.products]))) return fail("the beta carbons give different alkenes");
  const beta = first.model.roles.beta!;
  if (alkeneHasStereoisomers(first.model.products, beta, alpha)) return fail("the alkene has E and Z isomers, which the equation does not say");
  if (isStereocentre(substrate, alpha) !== false || isStereocentre(substrate, beta) !== false) return fail("a reacting carbon is a stereocentre: the drawn conformation would choose a configuration the equation does not state");
  if (fragments(first.model.products).length !== 3) return fail("E2 leaves exactly three species");
  return first;
}

export interface StatedSpecies { readonly text: string; readonly state: MechState }
export interface StatedEquation { readonly reactants: StatedSpecies[]; readonly products: StatedSpecies[] }

/** Spaced arrows only: "OH- -> CH3OH" keeps the anion's sign apart from the arrow. */
const EQUATION_ARROW = /\s+(?:->|→|⟶)\s+/;
const MAX_COEFFICIENT = 3;

function readSide(side: string): StatedSpecies[] | null {
  const out: StatedSpecies[] = [];
  for (const term of side.trim().split(/\s+\+\s+/)) {
    const match = /^(?:([1-9])\s*)?([^\s]+)$/.exec(term.trim());
    if (!match) return null;
    const count = match[1] ? Number(match[1]) : 1;
    if (count > MAX_COEFFICIENT) return null;
    const text = match[2]!.replace(/⁻$/, "-").replace(/⁺$/, "+");
    const state = readCondensed(text);
    if (!state || fragments(state).length !== 1) return null;
    for (let copy = 0; copy < count; copy += 1) out.push({ text: plainCondensed(text), state });
  }
  return out;
}

/** "CH3Br + OH- -> CH3OH + Br-": condensed species, optional small coefficients, one spaced arrow. */
export function readEquation(raw: string): StatedEquation | null {
  const sides = raw.trim().split(EQUATION_ARROW);
  if (sides.length !== 2) return null;
  const reactants = readSide(sides[0]!);
  const products = readSide(sides[1]!);
  return reactants && products && reactants.length && products.length ? { reactants, products } : null;
}

const charged = (state: MechState): boolean => state.atoms.some((_, index) => formalCharge(state, index) !== 0);

/** The class's checked arrows on the equation's reactants, drawn only when they give exactly its products. */
export function substitutionFromEquation(mechanism: SubstitutionClass, equation: string): SubstitutionRead & { equation?: StatedEquation } {
  const read = readEquation(equation);
  if (!read) return fail("the equation does not read as condensed structures with one arrow");
  const substrates = read.reactants.filter((entry) => entry.state.atoms.some((atom) => LEAVING.has(atom.element)) && !charged(entry.state));
  if (substrates.length !== 1) return fail("the equation needs exactly one neutral haloalkane reactant");
  const others = read.reactants.filter((entry) => entry !== substrates[0]);
  let result: SubstitutionRead;
  if (mechanism === "SN1") {
    result = sn1(substrates[0]!.state, others.map((entry) => entry.state));
  } else {
    if (others.length !== 1) return fail(`${mechanism} takes exactly one ${mechanism === "E2" ? "base" : "nucleophile"} besides the substrate`);
    result = mechanism === "SN2" ? sn2(substrates[0]!.state, others[0]!.state) : e2(substrates[0]!.state, others[0]!.state);
  }
  if (!result.ok) return result;
  if (!sameSpecies(result.model.products, read.products.map((entry) => entry.state))) return fail("the stated products are not the species the arrows give");
  return { ...result, equation: read };
}
