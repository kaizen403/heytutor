/**
 * A SMILES subset reader for the organic family: atoms (element, aromatic
 * flag, charge, explicit hydrogens), bonds (single, double, triple,
 * aromatic, with / and \ stereo marks), branches, and ring closures by
 * single digits. Aromatic rings are Kekulized by a backtracking matching so
 * every atom has a definite valence, and implicit hydrogens follow the
 * standard valence of the element. Anything outside the subset makes the
 * parse fail: a molecule is drawn from a graph the reader fully understood
 * or not at all.
 */

export type BondOrder = 1 | 2 | 3;

export interface Atom {
  readonly index: number;
  readonly element: string;
  readonly aromatic: boolean;
  readonly charge: number;
  /** Hydrogens on the atom, explicit from a bracket or implied by valence. */
  hydrogens: number;
  /** True when the hydrogen count came from a bracket, so valence rules do not touch it. */
  readonly explicitH: boolean;
}

export interface Bond {
  readonly index: number;
  readonly a: number;
  readonly b: number;
  order: BondOrder;
  /** True when the bond was written between two aromatic atoms; `order` then holds the Kekulé order. */
  readonly aromatic: boolean;
  /** Stereo mark as written: `/` or `\`, read in the direction from `a` to `b`. */
  readonly direction?: "/" | "\\";
}

export interface Molecule {
  readonly atoms: Atom[];
  readonly bonds: Bond[];
  /** Display name when the molecule came from a name. */
  name?: string;
  smiles?: string;
  /** A formula to show instead of the computed one (a salt drawn as its cation). */
  formulaOverride?: string;
  /** Requested geometry of one C=C, set from a cis-/trans- name prefix. */
  stereo?: { bond: number; kind: "cis" | "trans" };
}

const STANDARD_VALENCE: Record<string, number> = {
  C: 4, N: 3, O: 2, S: 2, P: 3, B: 3, Si: 4,
  F: 1, Cl: 1, Br: 1, I: 1,
  Mg: 2, Li: 1, Na: 1, K: 1, Zn: 2,
};

const ORGANIC_SUBSET = ["Cl", "Br", "B", "C", "N", "O", "S", "P", "F", "I"];
const AROMATIC_SUBSET = ["c", "n", "o", "s", "p"];

interface ParsedAtom {
  element: string;
  aromatic: boolean;
  charge: number;
  hydrogens: number | null;
}

function readBracketAtom(text: string): ParsedAtom | null {
  const match = /^(\d+)?([A-Z][a-z]?|[cnosp])(@@?)?(H\d*)?([+-]\d*|[+]+|[-]+)?$/.exec(text);
  if (!match) return null;
  const symbolRaw = match[2]!;
  const aromatic = symbolRaw === symbolRaw.toLowerCase();
  const element = aromatic ? symbolRaw.toUpperCase() : symbolRaw;
  if (!STANDARD_VALENCE[element] && !["Mg", "Li", "Na", "K", "Zn"].includes(element)) return null;
  let hydrogens = 0;
  if (match[4]) hydrogens = match[4].length === 1 ? 1 : Number(match[4].slice(1));
  let charge = 0;
  const chargeText = match[5];
  if (chargeText) {
    if (/^[+-]\d+$/.test(chargeText)) charge = Number(chargeText);
    else charge = (chargeText[0] === "+" ? 1 : -1) * chargeText.length;
  }
  return { element, aromatic, charge, hydrogens };
}

/**
 * Parse a SMILES string into a molecular graph. Returns null when the
 * string uses anything outside the subset, when a ring closure is left
 * open, or when Kekulization fails.
 */
export function parseSmiles(input: string): Molecule | null {
  const smiles = input.trim();
  if (!smiles) return null;
  const atoms: Atom[] = [];
  const bonds: Bond[] = [];
  const stack: number[] = [];
  const ringOpen = new Map<number, { atom: number; order: BondOrder | null; direction?: "/" | "\\"; aromatic: boolean }>();
  let previous: number | null = null;
  let pendingOrder: BondOrder | null = null;
  let pendingDirection: "/" | "\\" | undefined;
  let pendingExplicitSingle = false;

  const addAtom = (parsed: ParsedAtom): number => {
    const index = atoms.length;
    atoms.push({
      index,
      element: parsed.element,
      aromatic: parsed.aromatic,
      charge: parsed.charge,
      hydrogens: parsed.hydrogens ?? 0,
      explicitH: parsed.hydrogens !== null,
    });
    return index;
  };
  const addBond = (a: number, b: number, order: BondOrder | null, direction: "/" | "\\" | undefined, explicitSingle: boolean): void => {
    const aromatic = order === null && !explicitSingle && atoms[a]!.aromatic && atoms[b]!.aromatic;
    bonds.push({ index: bonds.length, a, b, order: order ?? 1, aromatic, ...(direction ? { direction } : {}) });
  };

  let i = 0;
  while (i < smiles.length) {
    const ch = smiles[i]!;
    let parsed: ParsedAtom | null = null;
    if (ch === "[") {
      const close = smiles.indexOf("]", i);
      if (close < 0) return null;
      parsed = readBracketAtom(smiles.slice(i + 1, close));
      if (!parsed) return null;
      i = close + 1;
    } else if (/[A-Z]/.test(ch)) {
      const two = smiles.slice(i, i + 2);
      const symbol = ORGANIC_SUBSET.includes(two) ? two : ORGANIC_SUBSET.includes(ch) ? ch : null;
      if (!symbol) return null;
      parsed = { element: symbol, aromatic: false, charge: 0, hydrogens: null };
      i += symbol.length;
    } else if (AROMATIC_SUBSET.includes(ch)) {
      parsed = { element: ch.toUpperCase(), aromatic: true, charge: 0, hydrogens: null };
      i += 1;
    } else if (ch === "(") {
      if (previous === null) return null;
      stack.push(previous);
      i += 1;
      continue;
    } else if (ch === ")") {
      const back = stack.pop();
      if (back === undefined) return null;
      previous = back;
      i += 1;
      continue;
    } else if (ch === "=" || ch === "#" || ch === "-" || ch === "/" || ch === "\\") {
      if (ch === "=") pendingOrder = 2;
      else if (ch === "#") pendingOrder = 3;
      else if (ch === "-") pendingExplicitSingle = true;
      else pendingDirection = ch;
      i += 1;
      continue;
    } else if (/\d/.test(ch)) {
      if (previous === null) return null;
      const digit = Number(ch);
      const open = ringOpen.get(digit);
      if (open) {
        const order = open.order ?? pendingOrder;
        // A direction on the closing side reads from the closing atom towards the opening atom.
        const direction = open.direction ?? (pendingDirection ? (pendingDirection === "/" ? "\\" : "/") : undefined);
        addBond(open.atom, previous, order, direction, pendingExplicitSingle);
        ringOpen.delete(digit);
      } else {
        ringOpen.set(digit, { atom: previous, order: pendingOrder, direction: pendingDirection, aromatic: atoms[previous]!.aromatic });
      }
      pendingOrder = null;
      pendingDirection = undefined;
      pendingExplicitSingle = false;
      i += 1;
      continue;
    } else if (ch === "." ) {
      // Disconnected fragments are outside the subset: a salt is drawn as one ion.
      return null;
    } else {
      return null;
    }
    const index = addAtom(parsed);
    if (previous !== null) addBond(previous, index, pendingOrder, pendingDirection, pendingExplicitSingle);
    previous = index;
    pendingOrder = null;
    pendingDirection = undefined;
    pendingExplicitSingle = false;
  }
  if (ringOpen.size > 0 || stack.length > 0) return null;
  if (atoms.length === 0) return null;
  const molecule: Molecule = { atoms, bonds, smiles };
  if (!kekulize(molecule)) return null;
  assignImplicitHydrogens(molecule);
  return molecule;
}

/** Neighbour list: bond index and the atom at the other end. */
export function neighbours(molecule: Molecule, atom: number): Array<{ atom: number; bond: Bond }> {
  const out: Array<{ atom: number; bond: Bond }> = [];
  for (const bond of molecule.bonds) {
    if (bond.a === atom) out.push({ atom: bond.b, bond });
    else if (bond.b === atom) out.push({ atom: bond.a, bond });
  }
  return out;
}

/** Sum of bond orders at an atom (aromatic bonds count by their Kekulé order). */
function bondOrderSum(molecule: Molecule, atom: number): number {
  return neighbours(molecule, atom).reduce((sum, entry) => sum + entry.bond.order, 0);
}

function valenceFor(atom: Atom): number {
  const base = STANDARD_VALENCE[atom.element] ?? 0;
  if (atom.element === "N" || atom.element === "P") return base + atom.charge;
  if (atom.element === "O" || atom.element === "S") return base + atom.charge;
  if (atom.element === "C" || atom.element === "B") return base - Math.abs(atom.charge);
  return base;
}

/**
 * Give every aromatic atom that needs one exactly one double bond, using a
 * backtracking perfect matching on the aromatic bond graph. An aromatic
 * atom needs a double bond when its standard valence is not yet used up by
 * its sigma bonds and explicit hydrogens: a ring carbon with a substituent
 * needs one, a pyrrole [nH] does not, a pyridine n does, a furan o does not.
 */
function kekulize(molecule: Molecule): boolean {
  const aromaticAtoms = molecule.atoms.filter((atom) => atom.aromatic).map((atom) => atom.index);
  if (aromaticAtoms.length === 0) return true;
  const needs = new Set<number>();
  for (const index of aromaticAtoms) {
    const atom = molecule.atoms[index]!;
    const sigma = neighbours(molecule, index).reduce((sum, entry) => sum + (entry.bond.aromatic ? 1 : entry.bond.order), 0);
    let hydrogens = atom.explicitH ? atom.hydrogens : 0;
    if (!atom.explicitH && atom.element === "C") hydrogens = Math.max(0, 3 - sigma);
    const used = sigma + hydrogens;
    const valence = valenceFor(atom);
    if (atom.element === "C") { if (used < valence) needs.add(index); }
    else if (atom.element === "N" || atom.element === "P") { if (!atom.explicitH && used < valence) needs.add(index); }
    // o and s in a ring donate a lone pair; they take no double bond.
  }
  const aromaticBonds = molecule.bonds.filter((bond) => bond.aromatic);
  const matched = new Set<number>();
  const chosen: Bond[] = [];
  const order = [...needs];
  const tryMatch = (position: number): boolean => {
    while (position < order.length && matched.has(order[position]!)) position += 1;
    if (position >= order.length) return true;
    const atom = order[position]!;
    for (const bond of aromaticBonds) {
      const other = bond.a === atom ? bond.b : bond.b === atom ? bond.a : null;
      if (other === null || matched.has(other) || !needs.has(other)) continue;
      matched.add(atom);
      matched.add(other);
      chosen.push(bond);
      if (tryMatch(position + 1)) return true;
      chosen.pop();
      matched.delete(atom);
      matched.delete(other);
    }
    return false;
  };
  if (!tryMatch(0)) return false;
  for (const bond of chosen) bond.order = 2;
  return true;
}

function assignImplicitHydrogens(molecule: Molecule): void {
  for (const atom of molecule.atoms) {
    if (atom.explicitH) continue;
    const valence = valenceFor(atom);
    const used = bondOrderSum(molecule, atom.index);
    atom.hydrogens = Math.max(0, valence - used);
  }
}

/** Element counts in Hill order (C, H, then alphabetical), hydrogens included. */
export function elementCounts(molecule: Molecule): Map<string, number> {
  const counts = new Map<string, number>();
  for (const atom of molecule.atoms) {
    counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1);
    if (atom.hydrogens > 0) counts.set("H", (counts.get("H") ?? 0) + atom.hydrogens);
  }
  const ordered = new Map<string, number>();
  if (counts.has("C")) ordered.set("C", counts.get("C")!);
  if (counts.has("H")) ordered.set("H", counts.get("H")!);
  for (const symbol of [...counts.keys()].sort()) {
    if (symbol !== "C" && symbol !== "H") ordered.set(symbol, counts.get(symbol)!);
  }
  return ordered;
}

/** Molecular formula with `_` subscripts (C_6H_6) or plain (C6H6). */
export function molecularFormula(molecule: Molecule, subscripts = true): string {
  if (molecule.formulaOverride) return molecule.formulaOverride;
  let text = "";
  for (const [symbol, count] of elementCounts(molecule)) {
    text += symbol + (count > 1 ? (subscripts ? `_${count}` : String(count)) : "");
  }
  const charge = molecule.atoms.reduce((sum, atom) => sum + atom.charge, 0);
  if (charge !== 0) text += subscripts ? `^(${Math.abs(charge) > 1 ? Math.abs(charge) : ""}${charge > 0 ? "+" : "-"})` : `${Math.abs(charge) > 1 ? Math.abs(charge) : ""}${charge > 0 ? "+" : "-"}`;
  return text;
}

/**
 * A fresh copy of `molecule` with `fragment` bonded on: the fragment's atom
 * `fragmentAtom` joins `atom` with a bond of `order`. A null fragment just
 * copies the molecule. Hydrogen counts are recomputed on every atom whose
 * count was not written explicitly, since the new bond consumes valence.
 */
export function attachMolecule(molecule: Molecule, atom: number, fragment: Molecule | null, fragmentAtom: number, order: BondOrder): Molecule | null {
  const atoms: Atom[] = molecule.atoms.map((entry) => ({ ...entry }));
  const bonds: Bond[] = molecule.bonds.map((bond) => ({ ...bond }));
  if (fragment) {
    if (atom < 0 || atom >= molecule.atoms.length) return null;
    if (fragmentAtom < 0 || fragmentAtom >= fragment.atoms.length) return null;
    const offset = molecule.atoms.length;
    for (const entry of fragment.atoms) atoms.push({ ...entry, index: entry.index + offset });
    for (const bond of fragment.bonds) bonds.push({ ...bond, index: bonds.length, a: bond.a + offset, b: bond.b + offset });
    bonds.push({ index: bonds.length, a: atom, b: fragmentAtom + offset, order, aromatic: false });
  }
  const joined: Molecule = { atoms, bonds };
  if (molecule.name) joined.name = molecule.name;
  if (molecule.stereo) joined.stereo = molecule.stereo;
  if (molecule.formulaOverride) joined.formulaOverride = molecule.formulaOverride;
  for (const entry of joined.atoms) {
    if (entry.explicitH) continue;
    entry.hydrogens = Math.max(0, valenceFor(entry) - bondOrderSum(joined, entry.index));
  }
  return joined;
}

/** True when every atom has a chemically possible valence (no five-bonded carbon). */
export function valenceOk(molecule: Molecule): boolean {
  for (const atom of molecule.atoms) {
    const valence = valenceFor(atom);
    const used = bondOrderSum(molecule, atom.index) + (atom.explicitH ? atom.hydrogens : 0);
    if (used > valence) return false;
  }
  return true;
}

export function heavyAtomCount(molecule: Molecule): number {
  return molecule.atoms.length;
}
