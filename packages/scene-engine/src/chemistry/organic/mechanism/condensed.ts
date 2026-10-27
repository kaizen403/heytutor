/**
 * A strict reader for the condensed structures a board or a stem writes:
 * CH2=CH2, R-C(=O)-OH, HS-C(=O)-SH, (CH3)3CBr, CH3CH2OH, OH-, Br-.
 *
 * - Bond orders above one must be written (=, #). A group that only closes
 *   with an unwritten double bond (COOH, CHO) is not read, and neither is a
 *   molecular formula (C2H4).
 * - Each heavy atom bonds to the heavy atom before it in its chain.
 * - A parenthesised group after an atom hangs on that atom; one at the start
 *   of a chain, (CH3)3C, hangs on the atom after it. A count repeats it.
 * - Hydrogens after a heavy atom belong to it; hydrogens that open a chain
 *   (HS, H2O, HBr) belong to the heavy atom after them.
 * - A trailing charge must be carried by the one atom whose bonds differ
 *   from its neutral valence, and every shell must close.
 * Anything else declines.
 */
import { VALENCE_ELECTRONS, bondSum, shellViolations, type MechState } from "./state";

const NEUTRAL_VALENCE: Readonly<Record<string, number>> = { H: 1, R: 1, C: 4, N: 3, O: 2, S: 2, F: 1, Cl: 1, Br: 1, I: 1 };
const ELEMENT = /^(?:Cl|Br|C|N|O|S|F|I|H|R)/;
const SUBSCRIPT_DIGITS: Readonly<Record<string, string>> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" };

/** Board notation to plain text: subscripts, `_2`, `^-`, braces and dash variants. */
export function plainCondensed(raw: string): string {
  return raw
    .replace(/[₀-₉]/g, (digit) => SUBSCRIPT_DIGITS[digit]!)
    .replace(/[–−]/g, "-")
    .replace(/≡/g, "#")
    .replace(/\^\(?([+-])\)?$/, "$1")
    .replace(/[_{}]/g, "")
    .trim();
}

interface Draft { elements: string[]; hydrogens: number[]; bonds: Array<{ a: number; b: number; order: number }> }

/** The largest count a condensed formula may state, and the most heavy atoms it may expand to: question text never makes a reader allocate more. */
const MAX_COUNT = 12;
const MAX_HEAVY_ATOMS = 48;

class Reader {
  at = 0;
  readonly draft: Draft = { elements: [], hydrogens: [], bonds: [] };
  constructor(readonly text: string) {}

  private rest(): string { return this.text.slice(this.at); }

  /** The count after an atom or group, 1 when none, or -1 past `MAX_COUNT`. */
  private count(): number {
    const match = /^\d+/.exec(this.rest());
    if (!match) return 1;
    this.at += match[0].length;
    const value = Number(match[0]);
    return value > MAX_COUNT ? -1 : value;
  }

  private bondSymbol(): number {
    const ch = this.text[this.at];
    const order = ch === "=" ? 2 : ch === "#" ? 3 : ch === "-" ? 1 : 0;
    if (order) this.at += 1;
    return order;
  }

  private heavy(element: string): number {
    this.draft.elements.push(element);
    this.draft.hydrogens.push(0);
    return this.draft.elements.length - 1;
  }

  private copy(atoms: readonly number[], bonds: Draft["bonds"], root: number): number {
    const map = new Map<number, number>();
    for (const atom of atoms) {
      const twin = this.heavy(this.draft.elements[atom]!);
      this.draft.hydrogens[twin] = this.draft.hydrogens[atom]!;
      map.set(atom, twin);
    }
    for (const bond of bonds) this.draft.bonds.push({ a: map.get(bond.a)!, b: map.get(bond.b)!, order: bond.order });
    return map.get(root)!;
  }

  /** One chain up to `)` or the end; returns its first heavy atom, or null. */
  chain(): number | null {
    let first = -1;
    let previous = -1;
    let pendingOrder = 0;
    let leadingH = 0;
    let prefix: Array<{ root: number; order: number }> = [];
    while (this.at < this.text.length && this.text[this.at] !== ")") {
      const ch = this.text[this.at]!;
      if (ch === "=" || ch === "#" || ch === "-") {
        // "H-C(=O)-OH": one leading H written with its single bond.
        if (ch === "-" && leadingH === 1 && previous < 0 && !pendingOrder && !prefix.length) { this.at += 1; continue; }
        if (pendingOrder || previous < 0 || leadingH) return null;
        pendingOrder = this.bondSymbol();
        continue;
      }
      if (ch === "(") {
        this.at += 1;
        const innerOrder = this.bondSymbol() || 1;
        const atomsBefore = this.draft.elements.length;
        const bondsBefore = this.draft.bonds.length;
        const root = this.chain();
        if (root === null || this.text[this.at] !== ")") return null;
        this.at += 1;
        const count = this.count();
        if (count < 0) return null;
        const atoms = Array.from({ length: this.draft.elements.length - atomsBefore }, (_, index) => atomsBefore + index);
        const bonds = this.draft.bonds.slice(bondsBefore);
        const roots = [root];
        if (this.draft.elements.length + atoms.length * (count - 1) > MAX_HEAVY_ATOMS) return null;
        for (let copy = 1; copy < count; copy += 1) roots.push(this.copy(atoms, bonds, root));
        if (previous >= 0 && !pendingOrder) for (const entry of roots) this.draft.bonds.push({ a: previous, b: entry, order: innerOrder });
        else if (previous < 0 && !pendingOrder && !leadingH) prefix.push(...roots.map((entry) => ({ root: entry, order: innerOrder })));
        else return null;
        continue;
      }
      const match = ELEMENT.exec(this.rest());
      if (!match) return null;
      const element = match[0];
      this.at += element.length;
      if (element === "H") {
        const count = this.count();
        if (count < 0) return null;
        if (previous >= 0 && !pendingOrder) { this.draft.hydrogens[previous] = this.draft.hydrogens[previous]! + count; continue; }
        if (previous < 0 && !prefix.length) { leadingH += count; continue; }
        return null;
      }
      if (/^\d/.test(this.rest())) return null;
      const atom = this.heavy(element);
      this.draft.hydrogens[atom] = leadingH;
      leadingH = 0;
      if (previous >= 0) this.draft.bonds.push({ a: previous, b: atom, order: pendingOrder || 1 });
      for (const entry of prefix) this.draft.bonds.push({ a: entry.root, b: atom, order: entry.order });
      prefix = [];
      pendingOrder = 0;
      if (first < 0) first = atom;
      previous = atom;
    }
    if (pendingOrder || leadingH || prefix.length || first < 0) return null;
    return first;
  }
}

export function readCondensed(raw: string): MechState | null {
  let text = plainCondensed(raw);
  let charge = 0;
  const sign = /([+-])$/.exec(text);
  if (sign) {
    // A species never ends in a bond, so a final sign is its charge.
    charge = sign[1] === "+" ? 1 : -1;
    text = text.slice(0, -1);
  }
  if (!text || /[^A-Za-z0-9()=#-]/.test(text)) return null;
  const reader = new Reader(text);
  if (reader.chain() === null || reader.at !== text.length) return null;
  const { elements, hydrogens, bonds } = reader.draft;
  const state: MechState = { atoms: elements.map((element) => ({ element, lonePairs: 0 })), bonds: bonds.map((bond) => ({ ...bond })) };
  hydrogens.forEach((count, atom) => {
    for (let h = 0; h < count; h += 1) {
      state.atoms.push({ element: "H", lonePairs: 0 });
      state.bonds.push({ a: atom, b: state.atoms.length - 1, order: 1 });
    }
  });
  const seen = new Set<string>();
  for (const bond of state.bonds) {
    const key = [bond.a, bond.b].sort((x, y) => x - y).join(":");
    if (seen.has(key) || bond.a === bond.b) return null;
    seen.add(key);
  }
  const offValence = state.atoms.map((atom, index) => ({ index, delta: bondSum(state, index) - NEUTRAL_VALENCE[atom.element]! }))
    .filter((entry) => entry.delta !== 0);
  let charged = -1;
  if (charge === 0 && offValence.length) return null;
  if (charge !== 0) {
    if (offValence.length !== 1) return null;
    const { index, delta } = offValence[0]!;
    const element = state.atoms[index]!.element;
    const onium = (element === "N" || element === "O" || element === "S") && delta === 1;
    const carbocation = element === "C" && delta === -1;
    if (charge === 1 && !onium && !carbocation) return null;
    if (charge === -1 && (delta !== -1 || element === "H" || element === "R")) return null;
    charged = index;
  }
  for (const [index, atom] of state.atoms.entries()) {
    const nonBonding = VALENCE_ELECTRONS[atom.element]! - (index === charged ? charge : 0) - bondSum(state, index);
    if (nonBonding < 0 || nonBonding % 2 !== 0) return null;
    atom.lonePairs = nonBonding / 2;
  }
  const sextets = charge === 1 && charged >= 0 && state.atoms[charged]!.element === "C" ? [charged] : [];
  if (shellViolations(state, sextets).length) return null;
  return state;
}
