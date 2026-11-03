/**
 * Explicit electron bookkeeping for curly arrow mechanisms. Every hydrogen
 * is an atom, every lone pair is counted, and a formal charge is always
 * recomputed from valence electrons, lone pairs and bonds, never declared.
 * `R` is a generic one bond group: no arrow may touch it.
 */
import type { Molecule } from "../smiles";
import { sameMolecularGraph } from "../reactionGraph";

export interface MechAtom { readonly element: string; lonePairs: number }
export interface MechBond { a: number; b: number; order: number }
export interface MechState { atoms: MechAtom[]; bonds: MechBond[] }

export const VALENCE_ELECTRONS: Readonly<Record<string, number>> = { H: 1, R: 1, C: 4, N: 5, O: 6, S: 6, F: 7, Cl: 7, Br: 7, I: 7 };
const DUET = new Set(["H", "R"]);

export function cloneState(state: MechState): MechState {
  return { atoms: state.atoms.map((atom) => ({ ...atom })), bonds: state.bonds.map((bond) => ({ ...bond })) };
}

export function findBond(state: MechState, a: number, b: number): MechBond | undefined {
  return state.bonds.find((bond) => (bond.a === a && bond.b === b) || (bond.a === b && bond.b === a));
}

export function bondOrder(state: MechState, a: number, b: number): number {
  return findBond(state, a, b)?.order ?? 0;
}

export function bondSum(state: MechState, atom: number): number {
  return state.bonds.reduce((sum, bond) => sum + (bond.a === atom || bond.b === atom ? bond.order : 0), 0);
}

export function neighbourAtoms(state: MechState, atom: number): number[] {
  return state.bonds.flatMap((bond) => bond.a === atom ? [bond.b] : bond.b === atom ? [bond.a] : []);
}

export function formalCharge(state: MechState, atom: number): number {
  const entry = state.atoms[atom]!;
  return VALENCE_ELECTRONS[entry.element]! - 2 * entry.lonePairs - bondSum(state, atom);
}

/** Electrons around an atom: its lone pairs plus every pair it shares. */
export function electronCount(state: MechState, atom: number): number {
  return 2 * state.atoms[atom]!.lonePairs + 2 * bondSum(state, atom);
}

export function totalElectrons(state: MechState): number {
  return state.atoms.reduce((sum, atom) => sum + 2 * atom.lonePairs, 0) + state.bonds.reduce((sum, bond) => sum + 2 * bond.order, 0);
}

export function totalCharge(state: MechState): number {
  return state.atoms.reduce((sum, _atom, index) => sum + formalCharge(state, index), 0);
}

/** Atoms the state cannot hold: an unknown element, an over full shell, a bare proton or a stray electron. */
export function shellViolations(state: MechState, allowedSextets: readonly number[] = []): string[] {
  const out: string[] = [];
  state.atoms.forEach((atom, index) => {
    if (VALENCE_ELECTRONS[atom.element] === undefined) { out.push(`${index}: unknown element ${atom.element}`); return; }
    if (atom.lonePairs < 0) { out.push(`${index}: negative lone pairs`); return; }
    const electrons = electronCount(state, index);
    if (DUET.has(atom.element)) {
      if (electrons !== 2) out.push(`${index}: ${atom.element} with ${electrons} electrons`);
      if (atom.element === "R" && (atom.lonePairs !== 0 || bondSum(state, index) !== 1)) out.push(`${index}: R must keep one single bond`);
      return;
    }
    if (electrons > 8) out.push(`${index}: ${atom.element} with ${electrons} electrons`);
    else if (electrons < 8) {
      const sextet = electrons === 6 && atom.element === "C" && formalCharge(state, index) === 1 && allowedSextets.includes(index);
      if (!sextet) out.push(`${index}: ${atom.element} with ${electrons} electrons`);
    }
  });
  for (const bond of state.bonds) if (bond.order < 1 || bond.order > 3 || bond.a === bond.b) out.push(`bond ${bond.a}-${bond.b} order ${bond.order}`);
  return out;
}

/** Connected pieces of a state (products leave as separate species). */
export function fragments(state: MechState): number[][] {
  const seen = new Set<number>();
  const out: number[][] = [];
  for (let start = 0; start < state.atoms.length; start += 1) {
    if (seen.has(start)) continue;
    const piece: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const at = stack.pop()!;
      piece.push(at);
      for (const next of neighbourAtoms(state, at)) if (!seen.has(next)) { seen.add(next); stack.push(next); }
    }
    out.push(piece.sort((a, b) => a - b));
  }
  return out;
}

/** The heavy atom graph of one fragment (hydrogens folded into counts) for the shared isomorphism check. */
export function fragmentMolecule(state: MechState, atoms: readonly number[]): Molecule {
  const heavy = atoms.filter((atom) => state.atoms[atom]!.element !== "H");
  const keep = heavy.length > 0 ? heavy : [...atoms];
  const index = new Map(keep.map((atom, position) => [atom, position]));
  return {
    atoms: keep.map((atom, position) => ({
      index: position,
      element: state.atoms[atom]!.element,
      aromatic: false,
      charge: formalCharge(state, atom),
      hydrogens: heavy.length > 0 ? neighbourAtoms(state, atom).filter((other) => state.atoms[other]!.element === "H").length : 0,
      explicitH: true,
    })),
    bonds: state.bonds.filter((bond) => index.has(bond.a) && index.has(bond.b))
      .map((bond, position) => ({ index: position, a: index.get(bond.a)!, b: index.get(bond.b)!, order: bond.order as 1 | 2 | 3, aromatic: false })),
  };
}

/** True when the fragments of `state` are exactly `species` (same multiset of graphs, charges included). */
export function sameSpecies(state: MechState, species: readonly MechState[]): boolean {
  const mine = fragments(state).map((piece) => fragmentMolecule(state, piece));
  const theirs = species.flatMap((entry) => fragments(entry).map((piece) => fragmentMolecule(entry, piece)));
  if (mine.length !== theirs.length) return false;
  const used = new Set<number>();
  return mine.every((molecule) => {
    const match = theirs.findIndex((other, index) => !used.has(index) && sameMolecularGraph(molecule, other));
    if (match < 0) return false;
    used.add(match);
    return true;
  });
}

/** Disjoint union, so separate reactants share one state; returns the offset of each part. */
export function combineStates(parts: readonly MechState[]): { state: MechState; offsets: number[] } {
  const state: MechState = { atoms: [], bonds: [] };
  const offsets: number[] = [];
  for (const part of parts) {
    const offset = state.atoms.length;
    offsets.push(offset);
    state.atoms.push(...part.atoms.map((atom) => ({ ...atom })));
    state.bonds.push(...part.bonds.map((bond) => ({ a: bond.a + offset, b: bond.b + offset, order: bond.order })));
  }
  return { state, offsets };
}
