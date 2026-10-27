/**
 * Thermal syn eliminations through a cyclic transition state (Ei).
 *
 * - Ester pyrolysis: the carbonyl O takes a beta H through a six atom ring
 *   (H, Cbeta, Calpha, O, C, O) and leaves an alkene and a carboxylic acid.
 * - Xanthate (Chugaev) pyrolysis: the same ring with the thione S taking
 *   the H, from an O-alkyl S-alkyl xanthate, RO-C(=S)-SR'.
 * - Cope elimination: the oxide O of a tertiary amine oxide takes the H
 *   through a five atom ring (H, Cbeta, Calpha, N, O).
 *
 * The site is found on the graph. When the stem states only the products,
 * the substrate is rebuilt from them, and then the forward arrows must give
 * exactly those products again. More than one inequivalent site or rebuild
 * declines.
 */
import { arrowRing, runMechanism, type MechanismStep } from "./arrows";
import { bondOrder, bondSum, cloneState, combineStates, findBond, formalCharge, fragments, neighbourAtoms, sameSpecies, shellViolations, type MechState } from "./state";

export type CyclicEliminationKind = "ester_pyrolysis" | "xanthate_pyrolysis" | "cope_elimination";
export const CYCLIC_RING_SIZE: Readonly<Record<CyclicEliminationKind, number>> = { ester_pyrolysis: 6, xanthate_pyrolysis: 6, cope_elimination: 5 };

/** Atoms by role. `acceptor` takes the H; `leaving` is the atom bonded to Calpha that departs; `centre` is the C (or N) between them. */
export interface CyclicRoles { hydrogen: number; beta: number; alpha: number; leaving: number; centre: number; acceptor: number }
export interface CyclicElimination {
  kind: CyclicEliminationKind;
  substrate: MechState;
  step: MechanismStep;
  products: MechState;
  ring: number[];
  roles: CyclicRoles;
}
export type CyclicRead = { ok: true; model: CyclicElimination } | { ok: false; reason: string };

const CARBON_LIKE: ReadonlySet<string> = new Set(["C", "R"]);
const singleOnly = (state: MechState, atom: number): boolean =>
  state.bonds.every((bond) => (bond.a !== atom && bond.b !== atom) || bond.order === 1);
const element = (state: MechState, atom: number): string => state.atoms[atom]!.element;
const hydrogensOn = (state: MechState, atom: number): number[] => neighbourAtoms(state, atom).filter((other) => element(state, other) === "H");

function sites(state: MechState, kind: CyclicEliminationKind): CyclicRoles[] {
  const out: CyclicRoles[] = [];
  for (let leaving = 0; leaving < state.atoms.length; leaving += 1) {
    const around = neighbourAtoms(state, leaving);
    let centre = -1;
    let acceptor = -1;
    if (kind === "cope_elimination") {
      if (element(state, leaving) !== "N" || formalCharge(state, leaving) !== 1 || !singleOnly(state, leaving) || around.length !== 4) continue;
      const oxide = around.filter((other) => element(state, other) === "O" && formalCharge(state, other) === -1 && neighbourAtoms(state, other).length === 1);
      if (oxide.length !== 1) continue;
      // A tertiary amine oxide: an N-H oxide is a hydroxylamine tautomer, not a Cope substrate.
      if (!around.every((other) => other === oxide[0] || CARBON_LIKE.has(element(state, other)))) continue;
      centre = leaving;
      acceptor = oxide[0]!;
    } else {
      if (element(state, leaving) !== "O" || around.length !== 2 || !singleOnly(state, leaving)) continue;
      const wantThione = kind === "xanthate_pyrolysis";
      for (const candidate of around) {
        if (element(state, candidate) !== "C" || neighbourAtoms(state, candidate).length !== 3) continue;
        const doubly = neighbourAtoms(state, candidate).filter((other) => other !== leaving && bondOrder(state, candidate, other) === 2);
        const third = neighbourAtoms(state, candidate).filter((other) => other !== leaving && bondOrder(state, candidate, other) === 1);
        if (doubly.length !== 1 || third.length !== 1) continue;
        const y = doubly[0]!;
        if (neighbourAtoms(state, y).length !== 1) continue;
        const zAtom = third[0]!;
        const z = element(state, zAtom);
        const ester = element(state, y) === "O" && (z === "C" || z === "R" || z === "H");
        // An S-alkyl xanthate: the free xanthic acid and its salt fall apart to the alcohol and CS2 instead.
        const zTail = neighbourAtoms(state, zAtom).filter((other) => other !== candidate);
        const xanthate = element(state, y) === "S" && z === "S" && zTail.length === 1 && CARBON_LIKE.has(element(state, zTail[0]!));
        if (wantThione ? !xanthate : !ester) continue;
        centre = candidate;
        acceptor = y;
      }
      if (centre < 0) continue;
    }
    // The alkene carbons carry only carbon and hydrogen: a heteroatom there gives an enol or enamine, drawn as if stable.
    const hydrocarbon = (atom: number, except: readonly number[]): boolean =>
      neighbourAtoms(state, atom).every((other) => except.includes(other) || element(state, other) === "H" || CARBON_LIKE.has(element(state, other)));
    for (const alpha of around) {
      if (alpha === centre || alpha === acceptor || element(state, alpha) !== "C" || !singleOnly(state, alpha) || bondSum(state, alpha) !== 4) continue;
      if (!hydrocarbon(alpha, [leaving])) continue;
      for (const beta of neighbourAtoms(state, alpha)) {
        if (beta === leaving || element(state, beta) !== "C" || !singleOnly(state, beta) || !hydrocarbon(beta, [])) continue;
        const hydrogens = hydrogensOn(state, beta);
        if (hydrogens.length) out.push({ hydrogen: hydrogens[0]!, beta, alpha, leaving, centre, acceptor });
      }
    }
  }
  return out;
}

function stepFor(kind: CyclicEliminationKind, roles: CyclicRoles): MechanismStep {
  const { hydrogen, beta, alpha, leaving, centre, acceptor } = roles;
  const take = kind === "cope_elimination"
    ? { tail: { kind: "lone_pair" as const, atom: acceptor }, head: { kind: "bond" as const, a: acceptor, b: hydrogen } }
    : { tail: { kind: "bond" as const, a: centre, b: acceptor }, head: { kind: "bond" as const, a: acceptor, b: hydrogen } };
  const release = kind === "cope_elimination"
    ? { tail: { kind: "bond" as const, a: alpha, b: leaving }, head: { kind: "atom" as const, atom: leaving } }
    : { tail: { kind: "bond" as const, a: alpha, b: leaving }, head: { kind: "bond" as const, a: leaving, b: centre } };
  return { arrows: [take, { tail: { kind: "bond", a: beta, b: hydrogen }, head: { kind: "bond", a: beta, b: alpha } }, release] };
}

/** The forward mechanism on a substrate: one site (up to equivalent outcomes), checked arrows, the right ring. */
export function cyclicElimination(substrate: MechState, kind: CyclicEliminationKind): CyclicRead {
  const found = sites(substrate, kind);
  if (!found.length) return { ok: false, reason: `no ${kind.replace(/_/g, " ")} site` };
  const runs = found.map((roles) => {
    const step = stepFor(kind, roles);
    const run = runMechanism(substrate, [step]);
    return run.ok ? { roles, step, products: run.states[1]! } : null;
  });
  if (runs.some((run) => run === null)) return { ok: false, reason: "a site breaks the electron bookkeeping" };
  const first = runs[0]!;
  if (runs.some((run) => !sameSpecies(run!.products, [first.products]))) return { ok: false, reason: "more than one inequivalent site" };
  const ring = arrowRing(substrate, first.step);
  if (!ring || ring.length !== CYCLIC_RING_SIZE[kind]) return { ok: false, reason: "the arrows do not travel the class's ring" };
  if (fragments(first.products).length !== 2) return { ok: false, reason: "an elimination leaves exactly two species" };
  return { ok: true, model: { kind, substrate, step: first.step, products: first.products, ring, roles: first.roles } };
}

/**
 * Rebuild the substrate from an alkene and the H-acid the stem states, then
 * require the forward arrows to give back exactly those two species.
 */
export function cyclicEliminationFromProducts(stated: readonly MechState[], kind: CyclicEliminationKind): CyclicRead {
  if (stated.length !== 2) return { ok: false, reason: "two stated products required" };
  const proposals: MechState[] = [];
  for (const [alkeneIndex, acidIndex] of [[0, 1], [1, 0]] as const) {
    const { state, offsets } = combineStates([stated[alkeneIndex]!, stated[acidIndex]!]);
    const alkeneAtoms = new Set(Array.from({ length: stated[alkeneIndex]!.atoms.length }, (_, index) => index + offsets[0]!));
    const pi = state.bonds.filter((bond) => bond.order === 2 && alkeneAtoms.has(bond.a) && element(state, bond.a) === "C" && element(state, bond.b) === "C");
    if (pi.length !== 1) continue;
    for (const [alpha, beta] of [[pi[0]!.a, pi[0]!.b], [pi[0]!.b, pi[0]!.a]] as const) {
      for (let donor = 0; donor < state.atoms.length; donor += 1) {
        if (alkeneAtoms.has(donor) || !["O", "S"].includes(element(state, donor))) continue;
        for (const hydrogen of hydrogensOn(state, donor)) {
          for (const centre of neighbourAtoms(state, donor)) {
            if (centre === hydrogen) continue;
            if (kind === "cope_elimination") {
              // R2N-OH: the O donor is bonded to N, which takes Calpha.
              if (element(state, centre) !== "N" || element(state, donor) !== "O") continue;
              const next = cloneState(state);
              next.bonds = next.bonds.filter((bond) => bond !== findBond(next, donor, hydrogen));
              next.atoms[donor]!.lonePairs += 1;
              next.atoms[centre]!.lonePairs -= 1;
              next.bonds.push({ a: centre, b: alpha, order: 1 }, { a: beta, b: hydrogen, order: 1 });
              findBond(next, alpha, beta)!.order = 1;
              if (!shellViolations(next).length) proposals.push(next);
              continue;
            }
            if (element(state, centre) !== "C") continue;
            for (const leaving of neighbourAtoms(state, centre)) {
              if (leaving === donor || bondOrder(state, centre, leaving) !== 2) continue;
              const next = cloneState(state);
              next.bonds = next.bonds.filter((bond) => bond !== findBond(next, donor, hydrogen));
              findBond(next, centre, donor)!.order = 2;
              findBond(next, centre, leaving)!.order = 1;
              findBond(next, alpha, beta)!.order = 1;
              next.bonds.push({ a: leaving, b: alpha, order: 1 }, { a: beta, b: hydrogen, order: 1 });
              if (!shellViolations(next).length) proposals.push(next);
            }
          }
        }
      }
    }
  }
  const verified: CyclicElimination[] = [];
  for (const proposal of proposals) {
    const forward = cyclicElimination(proposal, kind);
    if (forward.ok && sameSpecies(forward.model.products, stated)) verified.push(forward.model);
  }
  if (!verified.length) return { ok: false, reason: `the stated products do not come from a ${kind.replace(/_/g, " ")}` };
  const first = verified[0]!;
  if (verified.some((model) => !sameSpecies(model.substrate, [first.substrate]))) return { ok: false, reason: "the stated products fit more than one substrate" };
  return { ok: true, model: first };
}
