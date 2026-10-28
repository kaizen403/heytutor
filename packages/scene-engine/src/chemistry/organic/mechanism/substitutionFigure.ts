/**
 * SN2, SN1 and E2 drawn the way a board draws them, one row per example
 * reaction and one reveal group per step, left to right: the reactants with
 * their curly arrows, then the SN2 transition state or the SN1
 * intermediates (each with the arrows of its own step), then the products.
 *
 * Every mark comes from the checked model. The figure runs the model's
 * arrows again and draws nothing unless they give exactly its states.
 * Every label is written from the graph and read back by the condensed
 * reader: a group, a folded atom or a whole species whose text does not
 * read back as exactly that piece declines the figure. Each panel must draw
 * every atom of its species exactly once and every bond between its labels.
 * A row wider than the board zone wraps after a panel; a figure taller than
 * the zone declines.
 */
import { BOARD_TYPE_SCALE, measureTextWidth } from "@heytutor/drawing";
import type { SceneDocument } from "../../../types";
import { ChemScene, type BondStyle, type Vec2 } from "../../sceneKit";
import { runMechanism, type CurlyArrow, type MechanismStep } from "./arrows";
import { readCondensed } from "./condensed";
import { curlyArrow, curvePoints } from "./curlyInk";
import { bondOrder, formalCharge, fragments, neighbourAtoms, sameSpecies, type MechState } from "./state";
import { substituentKey, type StatedEquation, type SubstitutionClass, type SubstitutionModel } from "./substitution";

/**
 * Board pixels per world unit the layout assumes. A figure is kept only when
 * its fitted span is no larger than the zone at this scale, so the compiler
 * draws it at this scale or larger and the label boxes measured here never
 * grow against the ink. A figure that does not fit is laid out again at the
 * next smaller scale (shorter bonds), down to the last.
 */
const SCALES = [50, 46, 42];
let PX = SCALES[0]!;
/** The anchor box the compiler fits pinned labels into: 740 x 555 less 64 px of label padding each side. */
const FIT_WIDTH_PX = 612;
const FIT_HEIGHT_PX = 427;
const LABEL_PADDING_PX = 4;
const LABEL_HEIGHT_PX = BOARD_TYPE_SCALE.label + 2 * LABEL_PADDING_PX;
/** Visible bond between two label boxes, and the gap a forming bond keeps for its arrow. */
const VISIBLE = 0.36;
/** A wedge's triangle must stay at least 12 px across both ways on the canvas, or the compiler refuses it as collapsed. */
const WEDGE_VISIBLE = 0.52;
const ATTACK_GAP = 0.9;
const ARROW_LENGTH = 0.6;
const ARROW_GAP = 0.1;
const LINE_GAP = 0.15;
const TITLE_GAP = 0.25;
const LONE_PAIR_TURN = 50;
const MAX_LABEL = 16;

export const SUBSTITUTION_TITLES: Readonly<Record<SubstitutionClass, string>> = { SN2: "SN2 (example)", SN1: "SN1 (example)", E2: "E2 (example)" };

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const mid = (a: Vec2, b: Vec2): Vec2 => scale(add(a, b), 0.5);
const unit = (a: Vec2): Vec2 => scale(a, 1 / (Math.hypot(a.x, a.y) || 1));
const dir = (degrees: number): Vec2 => ({ x: Math.cos((degrees * Math.PI) / 180), y: Math.sin((degrees * Math.PI) / 180) });
const rotate = (a: Vec2, degrees: number): Vec2 => {
  const r = (degrees * Math.PI) / 180;
  return { x: a.x * Math.cos(r) - a.y * Math.sin(r), y: a.x * Math.sin(r) + a.y * Math.cos(r) };
};
const element = (state: MechState, atom: number): string => state.atoms[atom]!.element;
const hydrogensOn = (state: MechState, atom: number): number[] => neighbourAtoms(state, atom).filter((other) => element(state, other) === "H");
const signOf = (charge: number): string => (charge > 0 ? "+" : charge < 0 ? "-" : "");

/* ------------------------------------------------------------------------- */
/* Text                                                                      */
/* ------------------------------------------------------------------------- */

/** Condensed text in the board's script: counts as subscripts, a final charge as a superscript. */
export function scriptText(plain: string): string {
  const sign = /([+-])$/.exec(plain);
  const body = sign ? plain.slice(0, -1) : plain;
  return `${body.replace(/([A-Za-z)])(\d+)/g, "$1_$2")}${sign ? `^(${sign[1]})` : ""}`;
}

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";
/** Condensed text for a caption or a cue: CH₃Br, OH⁻. */
export function unicodeText(plain: string): string {
  const sign = /([+-])$/.exec(plain);
  const body = sign ? plain.slice(0, -1) : plain;
  return `${body.replace(/([A-Za-z)])(\d+)/g, (_, before: string, digits: string) => before + [...digits].map((digit) => SUBSCRIPT[Number(digit)]).join(""))}${sign ? (sign[1] === "+" ? "⁺" : "⁻") : ""}`;
}

/** A label's box as the compiler reserves it: the board measure of its glyphs at label size, 4 px padding a side, and 2 px to spare. */
function labelWidthPx(text: string): number {
  return measureTextWidth(text, BOARD_TYPE_SCALE.label) + 2 * LABEL_PADDING_PX + 2;
}
const halfWidth = (text: string): number => labelWidthPx(text) / 2 / PX;
let HALF_HEIGHT = LABEL_HEIGHT_PX / 2 / PX;
/** Distance from a label's centre to its box edge along `direction`. */
function extent(text: string, direction: Vec2): number {
  const d = unit(direction);
  const w = halfWidth(text);
  return Math.min(Math.abs(d.x) > 1e-6 ? w / Math.abs(d.x) : Infinity, Math.abs(d.y) > 1e-6 ? HALF_HEIGHT / Math.abs(d.y) : Infinity);
}

const hydrogenText = (count: number): string => (count ? `H${count > 1 ? count : ""}` : "");
const baseText = (state: MechState, atom: number): string => `${element(state, atom)}${hydrogenText(hydrogensOn(state, atom).length)}`;
const heavyAround = (state: MechState, atom: number, except: readonly number[]): number[] =>
  neighbourAtoms(state, atom).filter((other) => !except.includes(other) && element(state, other) !== "H");
const bondSymbol = (order: number): string => (order === 2 ? "=" : order === 3 ? "#" : "");

/** Identical children counted together, in a fixed order. */
function buckets(state: MechState, atom: number, children: readonly number[]): Array<{ atoms: number[]; key: string }> | null {
  const byKey = new Map<string, number[]>();
  for (const child of children) {
    const key = substituentKey(state, child, atom);
    if (key === null) return null;
    byKey.set(`${bondOrder(state, atom, child)}${key}`, [...(byKey.get(`${bondOrder(state, atom, child)}${key}`) ?? []), child]);
  }
  return [...byKey.entries()].sort((a, b) => a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1)).map(([key, atoms]) => ({ key, atoms }));
}

/** Root first, children after: C(CH3)3, CH2CH3, C(=O)OH. */
function rightText(state: MechState, root: number, from: readonly number[]): string | null {
  const groups = buckets(state, root, heavyAround(state, root, from));
  if (!groups) return null;
  let out = baseText(state, root);
  for (const [index, group] of groups.entries()) {
    const child = group.atoms[0]!;
    const inner = rightText(state, child, [root]);
    if (inner === null) return null;
    const written = `${bondSymbol(bondOrder(state, root, child))}${inner}`;
    out += index === groups.length - 1 && group.atoms.length === 1 ? written : `(${written})${group.atoms.length > 1 ? group.atoms.length : ""}`;
  }
  return out;
}

/** Children first, root last, for a group written to the left of its bond: CH3CH2, (CH3)3C, (CH3)2CH. */
function leftText(state: MechState, root: number, from: readonly number[]): string | null {
  const children = heavyAround(state, root, from);
  if (children.some((child) => bondOrder(state, root, child) !== 1)) return null;
  const groups = buckets(state, root, children);
  if (!groups || groups.length > 1) return null;
  if (!groups.length) return baseText(state, root);
  const inner = leftText(state, groups[0]!.atoms[0]!, [root]);
  if (inner === null) return null;
  return groups[0]!.atoms.length === 1 ? `${inner}${baseText(state, root)}` : `(${inner})${groups[0]!.atoms.length}${baseText(state, root)}`;
}

/** The atoms hanging off `root` away from `from`. */
function subtree(state: MechState, root: number, from: number): number[] {
  const out = [root];
  const stack = [root];
  const seen = new Set([from, root]);
  while (stack.length) {
    const at = stack.pop()!;
    for (const next of neighbourAtoms(state, at)) if (!seen.has(next)) { seen.add(next); out.push(next); stack.push(next); }
  }
  return out;
}

function fragmentState(state: MechState, atoms: readonly number[]): MechState {
  const index = new Map(atoms.map((atom, position) => [atom, position]));
  return {
    atoms: atoms.map((atom) => ({ ...state.atoms[atom]! })),
    bonds: state.bonds.filter((bond) => index.has(bond.a) && index.has(bond.b)).map((bond) => ({ a: index.get(bond.a)!, b: index.get(bond.b)!, order: bond.order })),
  };
}

/** A whole species' text reads back as exactly that species. */
export function readsAsSpecies(plain: string, piece: MechState): boolean {
  const read = readCondensed(plain);
  return read !== null && fragments(read).length === 1 && sameSpecies(read, [piece]);
}

/**
 * A group's text reads back as exactly the group: written left of its bond
 * it is read before an I, written right after one ("(CH3)3C" + "I",
 * "I" + "CH2CH3").
 */
export function readsAsGroup(plain: string, side: "left" | "right", state: MechState, root: number, from: number): boolean {
  const read = readCondensed(side === "left" ? `${plain}I` : `I${plain}`);
  if (!read) return false;
  const iodine = read.atoms.findIndex((atom) => atom.element === "I");
  const around = iodine >= 0 ? neighbourAtoms(read, iodine) : [];
  if (around.length !== 1 || read.atoms.filter((atom) => atom.element === "I").length !== state.atoms.filter((atom, index) => atom.element === "I" && subtree(state, root, from).includes(index)).length + 1) return false;
  return substituentKey(read, around[0]!, iodine) === substituentKey(state, root, from);
}

/** A substituent group's label, verified; "H" for a hydrogen. */
function groupLabel(state: MechState, root: number, from: number, side: "left" | "right"): string | null {
  if (element(state, root) === "H") return "H";
  if (subtree(state, root, from).some((atom) => formalCharge(state, atom) !== 0)) return null;
  const plain = side === "left" ? leftText(state, root, [from]) : rightText(state, root, [from]);
  if (!plain || !readsAsGroup(plain, side, state, root, from)) return null;
  const text = scriptText(plain);
  return text.length <= MAX_LABEL ? text : null;
}

/** Candidate texts for a whole species, verified; the stated texts first, then the shortest. */
function speciesLabel(state: MechState, atoms: readonly number[], stated: readonly string[], max = MAX_LABEL): string | null {
  const piece = fragmentState(state, atoms);
  const charge = signOf(atoms.reduce((sum, atom) => sum + formalCharge(state, atom), 0));
  const heavy = atoms.filter((atom) => element(state, atom) !== "H");
  const generated: string[] = [];
  if (heavy.length === 1) {
    const x = heavy[0]!;
    const h = hydrogenText(hydrogensOn(state, x).length);
    const pair = [`${h}${element(state, x)}${charge}`, `${element(state, x)}${h}${charge}`];
    generated.push(...(charge === "-" ? pair.reverse() : pair));
  } else {
    for (const root of heavy) {
      const right = rightText(state, root, []);
      if (right) generated.push(`${right}${charge}`);
      for (const before of heavyAround(state, root, [])) {
        const left = leftText(state, before, [root]);
        const rest = rightText(state, root, [before]);
        if (left && rest) generated.push(`${left}${rest}${charge}`);
      }
    }
    generated.sort((a, b) => a.length - b.length || Number(!/^[(C]/.test(a)) - Number(!/^[(C]/.test(b)));
  }
  for (const plain of [...stated, ...generated]) {
    if (!readsAsSpecies(plain, piece)) continue;
    const text = scriptText(plain);
    if (text.length <= max) return text;
  }
  return null;
}

type Fold = "left" | "right";
interface AtomSpec { at: Vec2; fold?: Fold }

/**
 * The label of an atom drawn on its own: its symbol and charge, or with its
 * hydrogens and heavy groups folded onto one side ("HO", "(CH3)3C", "OH2").
 * A folded label is read back like a group (one drawn neighbour) or a whole
 * species (none). Returns the label and the atoms it covers.
 */
function atomLabel(state: MechState, atom: number, spec: AtomSpec, drawn: ReadonlySet<number>, shown: string): { text: string; covers: number[] } | null {
  const charge = formalCharge(state, atom);
  if (!spec.fold) return { text: script(`${element(state, atom)}`, shown), covers: [atom] };
  const neighbours = neighbourAtoms(state, atom);
  const drawnNeighbours = neighbours.filter((other) => drawn.has(other));
  const folded = neighbours.filter((other) => !drawn.has(other));
  const hydrogens = folded.filter((other) => element(state, other) === "H");
  const heavy = folded.filter((other) => element(state, other) !== "H");
  const covers = [atom, ...folded.flatMap((other) => subtree(state, other, atom))];
  // Hydrogens alone fold as a count: CH2, OH2, HO.
  if (!heavy.length) {
    const h = hydrogenText(hydrogens.length);
    const text = script(spec.fold === "left" ? `${h}${element(state, atom)}` : `${element(state, atom)}${h}`, shown);
    return text.length <= MAX_LABEL ? { text, covers } : null;
  }
  let plain: string | null;
  if (spec.fold === "left") {
    // Hydrogens and groups both before the atom cannot be read: "CH3HO" gives the H to the carbon.
    if (heavy.length && hydrogens.length) return null;
    const groups = buckets(state, atom, heavy);
    if (!groups || groups.length > 1) return null;
    const left = groups.length ? leftText(state, groups[0]!.atoms[0]!, [atom]) : "";
    if (left === null) return null;
    const groupText = groups.length ? (groups[0]!.atoms.length > 1 ? `(${left})${groups[0]!.atoms.length}` : left) : "";
    plain = `${groupText}${hydrogenText(hydrogens.length)}${element(state, atom)}`;
  } else {
    const copy = fragmentState(state, [atom, ...folded.flatMap((other) => subtree(state, other, atom))]);
    plain = rightText(copy, 0, []);
    if (plain === null) return null;
  }
  if (drawnNeighbours.length === 0) {
    const fragment = fragments(state).find((piece) => piece.includes(atom))!;
    if (fragment.length !== covers.length || !readsAsSpecies(`${plain}${signOf(charge)}`, fragmentState(state, fragment))) return null;
  } else {
    if (drawnNeighbours.length !== 1 || charge !== 0 || bondOrder(state, atom, drawnNeighbours[0]!) !== 1) return null;
    if (!readsAsGroup(plain, spec.fold === "left" ? "left" : "right", state, atom, drawnNeighbours[0]!)) return null;
  }
  const text = script(plain, shown);
  return text.length <= MAX_LABEL ? { text, covers } : null;
}

/** Condensed text with its shown charge sign, if any. */
const script = (plain: string, shown: string): string => scriptText(`${plain}${shown}`);

/* ------------------------------------------------------------------------- */
/* Panels                                                                    */
/* ------------------------------------------------------------------------- */

interface GroupSpec { root: number; on: number; angle: number; style?: BondStyle }
interface PanelSpec {
  state: MechState;
  /** Formal charges on every label, or none (a transition state). */
  charges: boolean;
  atoms: Map<number, AtomSpec>;
  groups: GroupSpec[];
  species: Array<{ atoms: number[]; at: Vec2 }>;
  plus: Vec2[];
  /** Transition state bonds, drawn dashed: exactly the bonds its step changes. */
  partial: Array<[number, number]>;
  /** Every atom this panel draws: whole species of its state. */
  covers: number[];
  arrows?: { step: MechanismStep; bulges: Vec2[] };
  /** A transition state: the state its step leaves. Each drawn atom whose charge moves in the step carries a δ mark, and the marks account for the total charge. */
  after?: MechState;
  dagger?: boolean;
}

type Mark =
  | { kind: "atom"; key: string; element: string; text: string; at: Vec2; role: string }
  | { kind: "bond"; key: string; a: string; b: string; order: 1 | 2 | 3; style: BondStyle; trimA: number; trimB: number }
  | { kind: "partial"; key: string; from: Vec2; to: Vec2 }
  | { kind: "text"; key: string; at: Vec2; text: string; role: string }
  | { kind: "dots"; key: string; at: Vec2; angle: number; distance: number }
  | { kind: "curve"; key: string; points: Vec2[] };

interface Box { minX: number; maxX: number; minY: number; maxY: number }
interface Ink { marks: Mark[]; arrows: Mark[]; box: Box; texts: Map<number, string>; positions: Map<number, Vec2>; dagger?: Vec2 }

const emptyBox = (): Box => ({ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
function grow(box: Box, at: Vec2, w = 0, h = 0): void {
  box.minX = Math.min(box.minX, at.x - w); box.maxX = Math.max(box.maxX, at.x + w);
  box.minY = Math.min(box.minY, at.y - h); box.maxY = Math.max(box.maxY, at.y + h);
}

/** Where a group's label sits: its bond leaves the atom's box, runs VISIBLE, and meets the group's box. */
function groupCentre(onAt: Vec2, onText: string, angle: number, text: string, style: BondStyle = "plain"): Vec2 {
  const d = dir(angle);
  return add(onAt, scale(d, extent(onText, d) + (style === "wedge" ? WEDGE_VISIBLE : VISIBLE) + extent(text, d)));
}

/** The label text and covered atoms of every drawn atom, or null when one cannot be written truly. */
function atomTexts(spec: PanelSpec): Map<number, { text: string; covers: number[] }> | null {
  const drawn = new Set(spec.atoms.keys());
  const out = new Map<number, { text: string; covers: number[] }>();
  for (const [atom, atomSpec] of spec.atoms) {
    const shown = spec.charges ? signOf(formalCharge(spec.state, atom)) : "";
    const label = atomLabel(spec.state, atom, atomSpec, drawn, shown);
    if (!label) return null;
    out.set(atom, label);
  }
  return out;
}

function inkPanel(key: string, spec: PanelSpec, stated: readonly string[]): Ink | string {
  const state = spec.state;
  const marks: Mark[] = [];
  const arrows: Mark[] = [];
  const box = emptyBox();
  const owner = new Map<number, string>();
  const claim = (atoms: readonly number[], who: string): boolean => atoms.every((atom) => !owner.has(atom) && (owner.set(atom, who), true));
  const labels = atomTexts(spec);
  if (!labels) return "an atom label cannot be written as a checked condensed group";
  const texts = new Map<number, string>();
  const positions = new Map<number, Vec2>();
  const atomId = (atom: number): string => `${key}_a${atom}`;
  for (const [atom, { text, covers }] of labels) {
    const at = spec.atoms.get(atom)!.at;
    if (!claim(covers, `atom${atom}`)) return "an atom is drawn twice";
    texts.set(atom, text);
    positions.set(atom, at);
    marks.push({ kind: "atom", key: atomId(atom), element: element(state, atom), text, at, role: `${element(state, atom)} atom` });
    grow(box, at, halfWidth(text), HALF_HEIGHT);
  }
  const groupOf = new Map<number, GroupSpec>();
  for (const group of spec.groups) {
    if (!spec.atoms.has(group.on) || !neighbourAtoms(state, group.on).includes(group.root)) return "a group is not on a drawn atom";
    const side = Math.cos((group.angle * Math.PI) / 180) < -0.3 ? "left" : "right";
    const text = groupLabel(state, group.root, group.on, side);
    if (!text) return "a group cannot be written as a checked condensed group";
    const atoms = subtree(state, group.root, group.on);
    if (atoms.some((atom) => spec.atoms.has(atom)) || !claim(atoms, `group${group.root}`)) return "a group overlaps a drawn atom";
    const at = groupCentre(positions.get(group.on)!, texts.get(group.on)!, group.angle, text, group.style);
    texts.set(group.root, text);
    positions.set(group.root, at);
    groupOf.set(group.root, group);
    marks.push({ kind: "atom", key: atomId(group.root), element: element(state, group.root), text, at, role: text === "H" ? "H atom" : "substituent group" });
    grow(box, at, halfWidth(text), HALF_HEIGHT);
  }
  for (const [index, entry] of spec.species.entries()) {
    const text = speciesLabel(state, entry.atoms, stated);
    if (!text) return "a species cannot be written as a checked condensed formula";
    const fragment = fragments(state).find((piece) => piece.includes(entry.atoms[0]!));
    if (!fragment || fragment.length !== entry.atoms.length || !claim(entry.atoms, `species${index}`)) return "a species label is not one whole species";
    marks.push({ kind: "text", key: `${key}_s${index}`, at: entry.at, text, role: "species formula" });
    grow(box, entry.at, halfWidth(text), HALF_HEIGHT);
  }
  // Every atom of the panel's species is drawn exactly once, and nothing else is.
  const covers = new Set(spec.covers);
  if (owner.size !== covers.size || [...owner.keys()].some((atom) => !covers.has(atom))) return "the panel does not draw exactly its species";
  for (const piece of fragments(state)) if (piece.some((atom) => covers.has(atom)) && !piece.every((atom) => covers.has(atom))) return "the panel draws part of a species";
  const charge = chargeShown(spec, labels);
  if (typeof charge === "string") return charge;
  for (const [atom, sign] of charge) {
    const at = positions.get(atom)!;
    const text = `δ^(${sign < 0 ? "-" : "+"})`;
    const where = { x: at.x, y: at.y + 2 * HALF_HEIGHT + 0.04 };
    marks.push({ kind: "text", key: `${key}_d${atom}`, at: where, text, role: "partial charge in the transition state" });
    grow(box, where, halfWidth(text), HALF_HEIGHT);
  }
  const partialKeys = new Set(spec.partial.map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`)));
  for (const [a, b] of spec.partial) {
    if (!spec.atoms.has(a) || !spec.atoms.has(b)) return "a partial bond is not between drawn atoms";
    const pa = positions.get(a)!, pb = positions.get(b)!;
    const d = unit(sub(pb, pa));
    marks.push({ kind: "partial", key: `${key}_b${Math.min(a, b)}_${Math.max(a, b)}_partial`, from: add(pa, scale(d, extent(texts.get(a)!, d) + 0.05)), to: sub(pb, scale(d, extent(texts.get(b)!, scale(d, -1)) + 0.05)) });
  }
  for (const bond of state.bonds) {
    if (!covers.has(bond.a)) continue;
    const pair = bond.a < bond.b ? `${bond.a}:${bond.b}` : `${bond.b}:${bond.a}`;
    const ownA = owner.get(bond.a)!, ownB = owner.get(bond.b)!;
    const drawnA = spec.atoms.has(bond.a), drawnB = spec.atoms.has(bond.b);
    if (partialKeys.has(pair)) continue;
    if (ownA === ownB) continue;
    const groupEnd = drawnA && groupOf.get(bond.b)?.on === bond.a ? bond.b : drawnB && groupOf.get(bond.a)?.on === bond.b ? bond.a : -1;
    if (!(drawnA && drawnB) && groupEnd < 0) return "a bond between two labels is not drawn";
    const [a, b] = groupEnd === bond.a ? [bond.b, bond.a] : [bond.a, bond.b];
    const pa = positions.get(a)!, pb = positions.get(b)!;
    const d = unit(sub(pb, pa));
    const style = groupEnd >= 0 ? groupOf.get(groupEnd)!.style ?? "plain" : "plain";
    marks.push({ kind: "bond", key: `${key}_b${Math.min(a, b)}_${Math.max(a, b)}`, a: atomId(a), b: atomId(b), order: bond.order as 1 | 2 | 3, style, trimA: extent(texts.get(a)!, d) + 0.04, trimB: extent(texts.get(b)!, scale(d, -1)) + 0.04 });
  }
  for (const [index, at] of spec.plus.entries()) {
    marks.push({ kind: "text", key: `${key}_plus${index}`, at, text: "+", role: "plus sign" });
    grow(box, at, halfWidth("+"), HALF_HEIGHT);
  }
  if (spec.arrows) {
    for (const [index, arrow] of spec.arrows.step.arrows.entries()) {
      const drawn = arrowInk(`${key}_arrow${index}`, `${key}_lp${index}`, arrow, spec.arrows.bulges[index] ?? { x: 0, y: 1 }, positions, texts, spec.atoms);
      if (typeof drawn === "string") return drawn;
      arrows.push(...drawn);
      for (const mark of drawn) {
        if (mark.kind === "curve") for (const point of mark.points) grow(box, point);
        if (mark.kind === "dots") grow(box, add(mark.at, scale(dir(mark.angle), mark.distance)), 0.12, 0.12);
      }
    }
  }
  let dagger: Vec2 | undefined;
  if (spec.dagger) {
    // The transition state mark sits beside the panel's top right corner, inside its box.
    dagger = { x: box.maxX + halfWidth("‡") + 0.04, y: box.maxY - HALF_HEIGHT };
    grow(box, dagger, halfWidth("‡"), HALF_HEIGHT);
  }
  return { marks, arrows, box, texts, positions, dagger };
}

const chargeSum = (state: MechState, atoms: readonly number[]): number => atoms.reduce((sum, atom) => sum + formalCharge(state, atom), 0);

/**
 * The charge the panel's labels show must be the charge its species carry.
 * With formal charges, each label's sign is the charge of every atom it
 * covers, and the signs add up to the total. A transition state shows no
 * formal charge: each drawn atom whose charge moves in the step (from or to
 * zero) carries δ of the moving sign, every other atom is neutral on both
 * sides, and the δ signs account for the total (all of its sign when it is
 * charged, both signs or none when it is neutral). Returns the δ marks.
 */
export interface ChargePanel {
  readonly state: MechState;
  readonly charges: boolean;
  readonly covers: readonly number[];
  readonly species: ReadonlyArray<{ readonly atoms: readonly number[] }>;
  readonly after?: MechState;
}
export function chargeShown(spec: ChargePanel, labels: ReadonlyMap<number, { readonly covers: readonly number[] }>): Map<number, number> | string {
  const state = spec.state;
  const total = chargeSum(state, spec.covers);
  const deltas = new Map<number, number>();
  if (spec.charges) {
    let shown = 0;
    for (const [atom, { covers }] of labels) {
      const sign = Math.sign(formalCharge(state, atom));
      if (chargeSum(state, covers) !== sign || covers.some((other) => other !== atom && formalCharge(state, other) !== 0)) return "a label's sign is not the charge of the atoms it covers";
      shown += sign;
    }
    for (const entry of spec.species) {
      const sum = chargeSum(state, entry.atoms);
      if (Math.abs(sum) > 1) return "a species label's sign is not its charge";
      shown += sum;
    }
    return shown === total ? deltas : "the labels' charges do not add up to the species' total charge";
  }
  const after = spec.after;
  if (!after || spec.species.length) return "a panel without formal charges is a transition state with its step's after state";
  for (const atom of spec.covers) {
    const from = formalCharge(state, atom), to = formalCharge(after, atom);
    if (from === to) {
      if (from !== 0) return "a charged atom keeps its charge through the transition state, which shows none";
      continue;
    }
    if ((from !== 0 && to !== 0) || Math.abs(from + to) !== 1) return "a charge in the transition state is not one unit moving from or to a neutral atom";
    if (!labels.has(atom)) return "a charge moves on an atom the transition state does not label";
    deltas.set(atom, Math.sign(from + to));
  }
  const signs = new Set(deltas.values());
  const accounted = total === 0 ? signs.size !== 1 : signs.size === 1 && signs.has(Math.sign(total));
  return accounted ? deltas : "the transition state's partial charges do not account for its total charge";
}

/** One curly arrow: lone pair dots or a bond midpoint at its tail, a bond midpoint or beside an atom at its head. */
function arrowInk(id: string, dotsId: string, arrow: CurlyArrow, bulge: Vec2, positions: Map<number, Vec2>, texts: Map<number, string>, drawn: Map<number, AtomSpec>): Mark[] | string {
  const atoms = [arrow.tail.kind === "lone_pair" ? [arrow.tail.atom] : [arrow.tail.a, arrow.tail.b], arrow.head.kind === "atom" ? [arrow.head.atom] : [arrow.head.a, arrow.head.b]].flat();
  if (atoms.some((atom) => !drawn.has(atom))) return "an arrow touches an atom the panel does not draw on its own";
  const b = unit(bulge);
  const at = (atom: number): Vec2 => positions.get(atom)!;
  const marks: Mark[] = [];
  let tail: Vec2;
  if (arrow.tail.kind === "lone_pair") {
    const atom = arrow.tail.atom;
    const partner = arrow.head.kind === "bond" ? (arrow.head.a === atom ? arrow.head.b : arrow.head.a) : arrow.head.atom;
    const towards = unit(sub(at(partner), at(atom)));
    const turn = towards.x * b.y - towards.y * b.x >= 0 ? 1 : -1;
    const out = rotate(towards, turn * LONE_PAIR_TURN);
    const distance = extent(texts.get(atom)!, out) + 0.1;
    const angle = (Math.atan2(out.y, out.x) * 180) / Math.PI;
    marks.push({ kind: "dots", key: dotsId, at: at(atom), angle, distance });
    tail = add(at(atom), scale(out, distance + 0.14));
  } else {
    tail = add(mid(at(arrow.tail.a), at(arrow.tail.b)), scale(b, 0.14));
  }
  // Beside an atom: the atom a pair moves onto, or the atom a lone pair attacks (from the attacker's side), as boards draw it.
  const beside = (atom: number, bulgeWeight: number): Vec2 => {
    const toward = unit(add(scale(b, bulgeWeight), scale(unit(sub(tail, at(atom))), 1 - bulgeWeight)));
    return add(at(atom), scale(toward, extent(texts.get(atom)!, toward) + 0.06));
  };
  let head: Vec2;
  if (arrow.head.kind === "atom") head = beside(arrow.head.atom, 0.75);
  else if (arrow.tail.kind === "lone_pair") head = beside(arrow.head.a === arrow.tail.atom ? arrow.head.b : arrow.head.a, 0.4);
  else head = add(mid(at(arrow.head.a), at(arrow.head.b)), scale(b, 0.14));
  const along = unit(sub(head, tail));
  const side = -along.y * b.x + along.x * b.y >= 0 ? 1 : -1;
  marks.push({ kind: "curve", key: id, points: curvePoints(tail, head, side) });
  return marks;
}

/* ------------------------------------------------------------------------- */
/* Class layouts                                                             */
/* ------------------------------------------------------------------------- */

interface StepPanels { panels: PanelSpec[]; cues: string[]; arrowCues: string[] }

const widthOrder = (state: MechState) => (a: number, b: number): number =>
  (element(state, b) === "H" ? 0 : 1) - (element(state, a) === "H" ? 0 : 1) || a - b;
const name = (state: MechState, a: number, b: number, order = 1): string => `${element(state, a)}${order === 2 ? "=" : "–"}${element(state, b)}`;
const countText = (count: number): string => `${count} curly arrow${count === 1 ? "" : "s"}`;

/** Text of an atom as `atomLabel` would write it, for layout distances. */
function textFor(spec: PanelSpec, atom: number): string {
  return atomTexts(spec)?.get(atom)?.text ?? element(spec.state, atom);
}
function placeRight(spec: PanelSpec, from: number, atom: number, gap: number, angle = 0, fold?: Fold): void {
  spec.atoms.set(atom, { at: { x: 0, y: 0 }, fold });
  const d = dir(angle);
  const fromAt = spec.atoms.get(from)!.at;
  spec.atoms.set(atom, { at: add(fromAt, scale(d, extent(textFor(spec, from), d) + gap + extent(textFor(spec, atom), d))), fold });
}
function groupBox(spec: PanelSpec, group: GroupSpec): Box {
  const box = emptyBox();
  const on = spec.atoms.get(group.on)!.at;
  const side = Math.cos((group.angle * Math.PI) / 180) < -0.3 ? "left" : "right";
  const text = groupLabel(spec.state, group.root, group.on, side) ?? "CH_3";
  grow(box, groupCentre(on, textFor(spec, group.on), group.angle, text, group.style), halfWidth(text), HALF_HEIGHT);
  return box;
}
/** The nearest x a label on the reacting axis may reach beside `on`: the atom's own box, or a group box crossing the axis band. */
function axisClearance(spec: PanelSpec, on: number, side: -1 | 1, band = HALF_HEIGHT + 0.1): number {
  const at = spec.atoms.get(on)!.at;
  let edge = at.x + side * halfWidth(textFor(spec, on));
  for (const group of spec.groups.filter((entry) => entry.on === on)) {
    const box = groupBox(spec, group);
    if (box.maxY > at.y - band && box.minY < at.y + band) edge = side > 0 ? Math.max(edge, box.maxX) : Math.min(edge, box.minX);
  }
  return edge;
}
const groupsBox = (spec: PanelSpec, on: number): Box => spec.groups.filter((group) => group.on === on).map((group) => groupBox(spec, group))
  .reduce((all, one) => ({ minX: Math.min(all.minX, one.minX), maxX: Math.max(all.maxX, one.maxX), minY: Math.min(all.minY, one.minY), maxY: Math.max(all.maxY, one.maxY) }), emptyBox());

/** Products as an equation writes them: the one with Calpha first, the halide ion last. */
function productOrder(state: MechState, alpha: number, leaving: number): number[][] {
  const rank = (piece: number[]): number => (piece.includes(alpha) ? 0 : piece.length === 1 && piece[0] === leaving ? 2 : 1);
  return fragments(state).sort((a, b) => rank(a) - rank(b) || a[0]! - b[0]!);
}

function blank(state: MechState, covers: number[], charges = true): PanelSpec {
  return { state, charges, atoms: new Map(), groups: [], species: [], plus: [], partial: [], covers };
}

function sn2Layout(model: SubstitutionModel, labels: (state: MechState, atoms: number[]) => string): StepPanels | null {
  const { alpha, leaving, nucleophile } = model.roles;
  if (nucleophile === undefined) return null;
  const [s0, s1] = model.states as [MechState, MechState];
  const all = [...model.substrateAtoms, ...model.reagentAtoms[0]!];
  const others = neighbourAtoms(s0, alpha).filter((atom) => atom !== leaving).sort(widthOrder(s0));
  if (others.length !== 3) return null;
  // A wedge never runs near the horizontal or vertical, where its triangle would be too thin to draw.
  const before: Array<[number, BondStyle]> = [[110, "plain"], [225, "wedge"], [265, "dash"]];
  const ts: Array<[number, BondStyle]> = [[90, "plain"], [225, "wedge"], [315, "dash"]];
  // Inversion: each group keeps its wedge or dash and swings to the mirror side of carbon.
  const after: Array<[number, BondStyle]> = before.map(([angle, style]) => [(540 - angle) % 360, style]);

  const p0 = blank(s0, all);
  p0.atoms.set(alpha, { at: { x: 0, y: 0 } });
  placeRight(p0, alpha, leaving, VISIBLE);
  p0.groups = others.map((root, index) => ({ root, on: alpha, angle: before[index]![0], style: before[index]![1] }));
  p0.atoms.set(nucleophile, { at: { x: 0, y: 0 }, fold: "left" });
  // The nucleophile on the axis, opposite the leaving group, clear of the groups' labels.
  p0.atoms.set(nucleophile, { at: { x: axisClearance(p0, alpha, -1) - ATTACK_GAP * 0.65 - halfWidth(textFor(p0, nucleophile)), y: 0 }, fold: "left" });
  p0.arrows = { step: model.steps[0]!, bulges: [{ x: 0, y: 1 }, { x: 0, y: -1 }] };

  const p1 = blank(s0, all, false);
  p1.atoms.set(alpha, { at: { x: 0, y: 0 } });
  p1.atoms.set(nucleophile, { at: { x: 0, y: 0 }, fold: "left" });
  p1.atoms.set(leaving, { at: { x: 0, y: 0 } });
  placeRight(p1, alpha, leaving, ATTACK_GAP * 0.8);
  placeRight(p1, alpha, nucleophile, ATTACK_GAP * 0.8, 180, "left");
  p1.groups = others.map((root, index) => ({ root, on: alpha, angle: ts[index]![0], style: ts[index]![1] }));
  p1.partial = [[nucleophile, alpha], [alpha, leaving]];
  p1.after = s1;
  p1.dagger = true;

  const p2 = blank(s1, all);
  p2.atoms.set(alpha, { at: { x: 0, y: 0 } });
  placeRight(p2, alpha, nucleophile, VISIBLE, 180, "left");
  p2.groups = others.map((root, index) => ({ root, on: alpha, angle: after[index]![0], style: after[index]![1] }));
  // The plus clears every group, so it never sits beside carbon as a charge.
  const right2 = groupsBox(p2, alpha).maxX;
  p2.plus.push({ x: right2 + 0.22, y: 0 });
  p2.atoms.set(leaving, { at: { x: right2 + 0.44 + halfWidth(scriptText(`${element(s1, leaving)}-`)), y: 0 } });

  const nu = element(s0, nucleophile), x = element(s0, leaving);
  const shared = formalCharge(s0, nucleophile) === -1 && formalCharge(s0, leaving) === 0 && formalCharge(s1, nucleophile) === 0 && formalCharge(s1, leaving) === -1;
  const reactants = [labels(s0, model.reagentAtoms[0]!), labels(s0, model.substrateAtoms)];
  const products = fragments(s1).map((piece) => labels(s1, piece));
  return {
    panels: [p0, p1, p2],
    cues: [
      `SN2 example: the reactants, ${reactants.join(" and ")}.`,
      `The transition state (‡): the ${nu}–C bond forms as the C–${x} bond breaks, and the other three groups on carbon lie flat.${shared ? ` The negative charge is shared: δ− on ${nu} and on ${x}.` : ""}`,
      `The products: ${products.join(" and ")}. The three groups on carbon have flipped over like an umbrella: inversion.`,
    ],
    arrowCues: [`${countText(model.steps[0]!.arrows.length)}, in one step: a lone pair on ${nu} forms the new ${nu}–C bond from the side opposite ${x}, as the C–${x} bond pair leaves on ${x}.`],
  };
}

function sn1Layout(model: SubstitutionModel, labels: (state: MechState, atoms: number[]) => string): StepPanels | null {
  const { alpha, leaving, nucleophile, base, proton } = model.roles;
  if (nucleophile === undefined || base === undefined || proton === undefined) return null;
  const [s0, s1, s2, s3] = model.states as [MechState, MechState, MechState, MechState];
  const [solvent, second] = model.reagentAtoms as [number[], number[] | undefined];
  const groups = neighbourAtoms(s0, alpha).filter((atom) => atom !== leaving).sort(widthOrder(s0));
  if (groups.length !== 3) return null;
  const x = element(s0, leaving);

  // Step 1 on the substrate, its groups folded into one condensed label.
  const p0 = blank(s0, model.substrateAtoms);
  p0.atoms.set(alpha, { at: { x: 0, y: 0 }, fold: "left" });
  placeRight(p0, alpha, leaving, VISIBLE);
  p0.arrows = { step: model.steps[0]!, bulges: [{ x: 0, y: -1 }] };

  // Step 2: the flat carbocation, its three groups at 120 degrees, and the solvent O.
  const p1 = blank(s1, [...model.substrateAtoms, ...solvent]);
  p1.atoms.set(alpha, { at: { x: 0, y: 0 } });
  p1.groups = groups.map((root, index) => ({ root, on: alpha, angle: [90, 210, 330][index]! }));
  const right1 = groupsBox(p1, alpha).maxX;
  // Water folds to OH2 with its O facing the cation; an alcohol keeps its O apart, its H and R groups behind it.
  const alcohol = neighbourAtoms(s1, nucleophile).some((other) => element(s1, other) !== "H");
  const fold: Fold | undefined = alcohol ? undefined : "right";
  p1.atoms.set(nucleophile, { at: { x: 0, y: 0 }, fold });
  p1.atoms.set(nucleophile, { at: { x: right1 + 0.55 + halfWidth(textFor(p1, nucleophile)), y: 0 }, fold });
  const oxygenAt1 = p1.atoms.get(nucleophile)!.at;
  if (alcohol) p1.groups.push(...neighbourAtoms(s1, nucleophile).sort(widthOrder(s1)).reverse().map((root, index) => ({ root, on: nucleophile, angle: [35, 325][index]! })));
  // The halide just left waits below the nucleophile, clear of its groups.
  const below = Math.min(oxygenAt1.y - HALF_HEIGHT, alcohol ? groupsBox(p1, nucleophile).minY : Infinity);
  p1.species.push({ atoms: [leaving], at: { x: oxygenAt1.x + (alcohol ? 0 : 0.3), y: below - HALF_HEIGHT - 0.08 } });
  p1.arrows = { step: model.steps[1]!, bulges: [{ x: 0, y: 1 }] };

  // Step 3: the oxonium ion, its moving proton drawn apart, and the base beside it.
  const p2 = blank(s2, [...model.substrateAtoms, ...solvent, ...(second ?? [])]);
  p2.atoms.set(alpha, { at: { x: 0, y: 0 }, fold: "left" });
  p2.atoms.set(nucleophile, { at: { x: 0, y: 0 } });
  p2.atoms.set(proton, { at: { x: 0, y: 0 } });
  placeRight(p2, alpha, nucleophile, VISIBLE);
  placeRight(p2, nucleophile, proton, VISIBLE, -35);
  const rest = neighbourAtoms(s2, nucleophile).filter((atom) => atom !== alpha && atom !== proton);
  if (rest.length !== 1) return null;
  p2.groups = [{ root: rest[0]!, on: nucleophile, angle: 35 }];
  if (!second) return null;
  // Water folds to OH2; an alcohol base keeps its O apart, its H and R groups behind it, as in step 2.
  const alcoholBase = neighbourAtoms(s2, base).some((other) => element(s2, other) !== "H");
  const baseFold: Fold | undefined = alcoholBase ? undefined : "right";
  p2.atoms.set(base, { at: { x: 0, y: 0 }, fold: baseFold });
  placeRight(p2, proton, base, ATTACK_GAP, 0, baseFold);
  if (alcoholBase) p2.groups.push(...neighbourAtoms(s2, base).sort(widthOrder(s2)).reverse().map((root, index) => ({ root, on: base, angle: [35, 325][index]! })));
  // The halide waits above the base, clear of the lone pair the base gives and of its groups.
  const baseAt = p2.atoms.get(base)!.at;
  p2.species.push({ atoms: [leaving], at: { x: baseAt.x, y: (alcoholBase ? groupsBox(p2, base).maxY + HALF_HEIGHT + 0.08 : baseAt.y + 0.85) } });
  p2.arrows = { step: model.steps[2]!, bulges: [{ x: 0, y: -1 }, unit({ x: -1, y: -0.55 })] };

  // Products, each written as one checked condensed formula; a product too long for one label keeps its C-O bond drawn.
  const pieces = productOrder(s3, alpha, leaving);
  const p3 = blank(s3, pieces.flat());
  let cursor = 0;
  for (const [index, piece] of pieces.entries()) {
    if (index) { p3.plus.push({ x: cursor + 0.25, y: 0 }); cursor += 0.5; }
    if (index === 0 && !speciesLabel(s3, piece, [])) {
      const tail = neighbourAtoms(s3, nucleophile).filter((atom) => atom !== alpha);
      if (tail.length !== 1) return null;
      p3.atoms.set(alpha, { at: { x: 0, y: 0 }, fold: "left" });
      p3.atoms.set(nucleophile, { at: { x: 0, y: 0 } });
      placeRight(p3, alpha, nucleophile, VISIBLE);
      p3.groups.push({ root: tail[0]!, on: nucleophile, angle: 0 });
      const left = -halfWidth(textFor(p3, alpha));
      for (const atom of [alpha, nucleophile]) p3.atoms.get(atom)!.at.x -= left;
      cursor = groupsBox(p3, nucleophile).maxX;
      continue;
    }
    const width = halfWidth(scriptText(labels(s3, piece)));
    p3.species.push({ atoms: piece, at: { x: cursor + width, y: 0 } });
    cursor += 2 * width;
  }

  const solventText = labels(s0, solvent);
  const baseText = labels(s0, second);
  return {
    panels: [p0, p1, p2, p3],
    cues: [
      `SN1 example: the substrate, ${labels(s0, model.substrateAtoms)}.`,
      `A carbocation: the carbon is flat, carries the positive charge and has only six electrons; ${x}⁻ has left and ${solventText} is the nucleophile.`,
      `An oxonium ion: the O now carries the positive charge.`,
      `The products: ${pieces.map((piece) => labels(s3, piece)).join(" and ")}.`,
    ],
    arrowCues: [
      `${countText(model.steps[0]!.arrows.length)}, the slow step: the C–${x} bond pair leaves on ${x}.`,
      `${countText(model.steps[1]!.arrows.length)}: a lone pair on the O of ${solventText} forms a bond to the carbocation.`,
      `${countText(model.steps[2]!.arrows.length)}: ${baseText} takes the proton from O, and the O–H bond pair stays on O.`,
    ],
  };
}

function e2Layout(model: SubstitutionModel, labels: (state: MechState, atoms: number[]) => string): StepPanels | null {
  const { alpha, leaving, base, proton, beta } = model.roles;
  if (base === undefined || proton === undefined || beta === undefined) return null;
  const [s0, s1] = model.states as [MechState, MechState];
  const all = [...model.substrateAtoms, ...model.reagentAtoms[0]!];
  const x = element(s0, leaving);
  const heavyOn = (state: MechState, atom: number, except: number[]): number[] => neighbourAtoms(state, atom).filter((other) => !except.includes(other) && element(state, other) !== "H");
  const betaGroups = heavyOn(s0, beta, [alpha]);
  const alphaGroups = heavyOn(s0, alpha, [beta, leaving]);
  if (betaGroups.length > 2 || alphaGroups.length > 2) return null;

  // H and X anti to each other in the page, the rest folded or hanging off as groups.
  const p0 = blank(s0, all);
  p0.atoms.set(beta, { at: { x: 0, y: 0 }, fold: betaGroups.length ? undefined : "right" });
  p0.atoms.set(alpha, { at: { x: 0, y: 0 }, fold: alphaGroups.length ? undefined : "right" });
  p0.atoms.set(proton, { at: { x: 0, y: 0 } });
  p0.atoms.set(leaving, { at: { x: 0, y: 0 } });
  placeRight(p0, beta, alpha, VISIBLE * 1.4);
  placeRight(p0, beta, proton, VISIBLE, 90);
  placeRight(p0, alpha, leaving, VISIBLE, 270);
  p0.atoms.set(base, { at: { x: 0, y: 0 }, fold: "left" });
  placeRight(p0, proton, base, ATTACK_GAP, 180, "left");
  const unfoldedH = (atom: number, except: number[]): number[] => neighbourAtoms(s0, atom).filter((other) => !except.includes(other) && element(s0, other) === "H");
  const hang = (atom: number, except: number[], angles: number[]): GroupSpec[] => {
    const roots = [...heavyOn(s0, atom, except), ...(p0.atoms.get(atom)!.fold ? [] : unfoldedH(atom, except))];
    return roots.map((root, index) => ({ root, on: atom, angle: angles[index]! }));
  };
  // One group bisects the free side; two spread 70 degrees so their labels clear each other.
  if (!p0.atoms.get(beta)!.fold) p0.groups.push(...hang(beta, [alpha, proton], hang(beta, [alpha, proton], []).length === 1 ? [225] : [190, 260]));
  if (!p0.atoms.get(alpha)!.fold) p0.groups.push(...hang(alpha, [beta, leaving], hang(alpha, [beta, leaving], []).length === 1 ? [45] : [10, 80]));
  if (p0.groups.some((group) => group.angle === undefined)) return null;
  p0.arrows = { step: model.steps[0]!, bulges: [{ x: 0, y: 1 }, unit({ x: 1, y: 1 }), { x: 1, y: 0 }] };

  const p1 = blank(s1, all);
  const betaFold1 = heavyOn(s1, beta, [alpha]).length ? undefined : "right";
  const alphaFold1 = heavyOn(s1, alpha, [beta]).length ? undefined : "right";
  p1.atoms.set(beta, { at: { x: 0, y: 0 }, fold: betaFold1 });
  p1.atoms.set(alpha, { at: { x: 0, y: 0 }, fold: alphaFold1 });
  placeRight(p1, beta, alpha, VISIBLE * 1.4, 0, alphaFold1);
  const hang1 = (atom: number, other: number, angles: number[]): GroupSpec[] => neighbourAtoms(s1, atom).filter((root) => root !== other)
    .map((root, index) => ({ root, on: atom, angle: angles[index]! }));
  if (!betaFold1) p1.groups.push(...hang1(beta, alpha, [140, 220]));
  if (!alphaFold1) p1.groups.push(...hang1(alpha, beta, [40, 320]));
  let cursor = Math.max(groupsBox(p1, alpha).maxX, p1.atoms.get(alpha)!.at.x + halfWidth(textFor(p1, alpha)));
  const others = productOrder(s1, alpha, leaving).slice(1);
  for (const piece of others) {
    const width = halfWidth(scriptText(labels(s1, piece)));
    p1.plus.push({ x: cursor + 0.25, y: 0 });
    cursor += 0.5;
    p1.species.push({ atoms: piece, at: { x: cursor + width, y: 0 } });
    cursor += 2 * width;
  }
  const alkene = fragments(s1).find((piece) => piece.includes(alpha))!;
  return {
    panels: [p0, p1],
    cues: [
      `E2 example: the reactants, ${labels(s0, model.reagentAtoms[0]!)} and ${labels(s0, model.substrateAtoms)}, with the H and the ${x} anti to each other.`,
      `The products: ${[labels(s1, alkene), ...others.map((piece) => labels(s1, piece))].join(", ")}.`,
    ],
    arrowCues: [`${countText(model.steps[0]!.arrows.length)}, in one step: a lone pair on the base's ${element(s0, base)} takes the H, that C–H bond pair becomes the new ${name(s1, beta, alpha, 2)} bond, and the C–${x} bond pair leaves on ${x}.`],
  };
}

/* ------------------------------------------------------------------------- */
/* Figure                                                                    */
/* ------------------------------------------------------------------------- */

export interface SubstitutionReaction { readonly model: SubstitutionModel; readonly equation: StatedEquation }
export interface SubstitutionFigureInput { readonly question: string; readonly reactions: readonly SubstitutionReaction[] }

function sameState(a: MechState, b: MechState): boolean {
  if (a.atoms.length !== b.atoms.length || a.bonds.length !== b.bonds.length) return false;
  if (a.atoms.some((atom, index) => atom.element !== b.atoms[index]!.element || atom.lonePairs !== b.atoms[index]!.lonePairs)) return false;
  return a.bonds.every((bond) => bondOrder(b, bond.a, bond.b) === bond.order);
}

/** The model's arrows run again from its start and give exactly its states and products. */
export function modelHolds(model: SubstitutionModel): boolean {
  const run = runMechanism(model.start, model.steps);
  return run.ok && run.states.length === model.states.length && run.states.every((state, index) => sameState(state, model.states[index]!)) && sameState(model.products, run.states.at(-1)!);
}

/** The TS draws dashed exactly the bonds its step makes or breaks. */
function partialIsStep(panel: PanelSpec, before: MechState, after: MechState): boolean {
  const changed = new Set<string>();
  for (const bond of [...before.bonds, ...after.bonds]) {
    if (bondOrder(before, bond.a, bond.b) !== bondOrder(after, bond.a, bond.b)) changed.add(bond.a < bond.b ? `${bond.a}:${bond.b}` : `${bond.b}:${bond.a}`);
  }
  const drawn = new Set(panel.partial.map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`)));
  return changed.size === drawn.size && [...changed].every((key) => drawn.has(key));
}

const LAYOUTS: Readonly<Record<SubstitutionClass, typeof sn2Layout>> = { SN2: sn2Layout, SN1: sn1Layout, E2: e2Layout };

/** "2 H2O" for two copies, in the equation's order. */
function sideText(side: StatedEquation["reactants"]): string {
  const out: Array<{ text: string; count: number }> = [];
  for (const entry of side) {
    const last = out.at(-1);
    if (last && last.text === entry.text) last.count += 1;
    else out.push({ text: entry.text, count: 1 });
  }
  return out.map((entry) => `${entry.count > 1 ? `${entry.count} ` : ""}${unicodeText(entry.text)}`).join(" + ");
}

export function buildSubstitutionFigure(input: SubstitutionFigureInput, onDecline?: (reason: string) => void): SceneDocument | null {
  let reason = "no scale tried";
  try {
    for (const scale of SCALES) {
      PX = scale;
      HALF_HEIGHT = LABEL_HEIGHT_PX / 2 / PX;
      const built = layoutFigure(input, (why) => { reason = why; });
      if (built.document) return built.document;
      if (!built.retry) break;
    }
  } finally {
    PX = SCALES[0]!;
    HALF_HEIGHT = LABEL_HEIGHT_PX / 2 / PX;
  }
  onDecline?.(reason);
  return null;
}

/** One layout at the current scale; `retry` when only the zone was too small for it. */
function layoutFigure(input: SubstitutionFigureInput, onDecline: (reason: string) => void): { document: SceneDocument | null; retry: boolean } {
  const decline = (reason: string, retry = false): { document: null; retry: boolean } => { onDecline(reason); return { document: null, retry }; };
  if (!input.reactions.length || input.reactions.length > 2) return decline("one or two reactions are drawn");
  const c = new ChemScene(input.question, "plan example curly arrow mechanism with checked electron bookkeeping", "chem_organic");
  // Label boxes may overhang the fitted span by half a label at each end.
  const limit = (FIT_WIDTH_PX + LABEL_HEIGHT_PX) / PX;
  let rowTop = 0;
  let previousGroup: string | null = null;
  const lineHeights: number[] = [];
  const panelWidths: string[] = [];
  for (const [rowIndex, { model, equation }] of input.reactions.entries()) {
    if (!modelHolds(model)) return decline("the model's arrows do not give its states");
    const stated = [...equation.reactants, ...equation.products].map((entry) => entry.text);
    const labelCache = new Map<string, string>();
    let unwritable = false;
    const labels = (state: MechState, atoms: number[]): string => {
      const cacheKey = `${model.states.indexOf(state)}:${atoms.join(",")}`;
      if (!labelCache.has(cacheKey)) {
        // A cue is spoken, not a board label: no length limit.
        const text = speciesLabel(state, atoms, stated, Infinity);
        if (!text) unwritable = true;
        // Back to plain condensed text for the cue: the script marks come off.
        labelCache.set(cacheKey, unicodeText((text ?? "").replace(/_(\d+)/g, "$1").replace(/\^\(([+-])\)$/, "$1")));
      }
      return labelCache.get(cacheKey)!;
    };
    const layout = LAYOUTS[model.mechanism](model, labels);
    if (!layout || unwritable) return decline(`the ${model.mechanism} layout cannot place or name every species`);
    if (model.mechanism === "SN2" && !partialIsStep(layout.panels[1]!, model.states[0]!, model.states[1]!)) return decline("the transition state's dashed bonds are not the bonds its step changes");
    const prefix = `rx${rowIndex}`;
    const inks: Ink[] = [];
    for (const [index, panel] of layout.panels.entries()) {
      const ink = inkPanel(`${prefix}p${index}`, panel, stated);
      if (typeof ink === "string") return decline(`${model.mechanism} panel ${index + 1}: ${ink}`);
      inks.push(ink);
    }
    // Flow the panels left to right, wrapping a line that would leave the zone.
    const title = SUBSTITUTION_TITLES[model.mechanism];
    const titleWidth = 2 * halfWidth(title);
    const origins: Vec2[] = [];
    const lines: number[][] = [[]];
    let cursor = 0;
    for (const [index, ink] of inks.entries()) {
      const width = ink.box.maxX - ink.box.minX;
      const lead = index === 0 ? 0 : 2 * ARROW_GAP + ARROW_LENGTH;
      if (index > 0 && cursor + lead + width > limit) { lines.push([]); cursor = 0; }
      cursor += lead;
      origins[index] = { x: cursor - ink.box.minX, y: 0 };
      cursor += width;
      lines.at(-1)!.push(index);
    }
    const lineWidth = (line: number[]): number => origins[line.at(-1)!]!.x + inks[line.at(-1)!]!.box.maxX;
    // The title goes before the first panel when its line has room, above the row otherwise.
    const inline = lineWidth(lines[0]!) + titleWidth + TITLE_GAP <= limit;
    if (inline) for (const index of lines[0]!) origins[index] = { x: origins[index]!.x + titleWidth + TITLE_GAP, y: 0 };
    let lineTop = inline ? rowTop : rowTop - 2 * HALF_HEIGHT - 0.1;
    const lineBaselines: number[] = [];
    for (const line of lines) {
      const top = Math.max(...line.map((index) => inks[index]!.box.maxY));
      const bottom = Math.min(...line.map((index) => inks[index]!.box.minY));
      for (const index of line) origins[index] = { x: origins[index]!.x, y: lineTop - top };
      lineBaselines.push(lineTop - top);
      lineHeights.push(Math.round((top - bottom) * PX));
      panelWidths.push(line.map((index) => Math.round((inks[index]!.box.maxX - inks[index]!.box.minX) * PX)).join("+"));
      lineTop = lineTop - (top - bottom) - LINE_GAP;
    }
    const titleId = c.text(`${prefix}_title`, { x: halfWidth(title), y: inline ? lineBaselines[0]! : rowTop - HALF_HEIGHT }, title, "mechanism name (example)");
    c.scene.labelled(titleId);
    const emit = (marks: Mark[], origin: Vec2): string[] => marks.flatMap((mark) => {
      const o = (at: Vec2): Vec2 => add(at, origin);
      switch (mark.kind) {
        case "atom": return [c.atom(mark.key, mark.element, o(mark.at), { text: mark.text, role: mark.role })];
        case "bond": return c.bond(mark.key, mark.a, mark.b, { order: mark.order, style: mark.style, trimStart: mark.trimA, trimEnd: mark.trimB, spacing: 0.13 });
        case "partial": return [c.link(mark.key, o(mark.from), o(mark.to), "partial bond in the transition state")];
        case "text": { const id = c.text(mark.key, o(mark.at), mark.text, mark.role); c.scene.labelled(id); return [id]; }
        case "dots": return c.lonePair(mark.key, o(mark.at), mark.angle, mark.distance);
        case "curve": return [curlyArrow(c, mark.key, mark.points.map(o))];
      }
    });
    let stepIndex = 0;
    for (const [index, ink] of inks.entries()) {
      const origin = origins[index]!;
      const ids: string[] = index === 0 ? [titleId] : [];
      if (index > 0) {
        const sameLine = lines.some((line) => line.includes(index) && line.includes(index - 1));
        const from = sameLine ? origins[index - 1]!.x + inks[index - 1]!.box.maxX + ARROW_GAP : origin.x + ink.box.minX - ARROW_GAP - ARROW_LENGTH;
        ids.push(c.arrow(`${prefix}_to${index}`, { x: from, y: origin.y }, { x: from + ARROW_LENGTH, y: origin.y }, "reaction arrow"));
      }
      ids.push(...emit(ink.marks, origin));
      if (ink.dagger) {
        const dagger = c.text(`${prefix}_dagger`, add(origin, ink.dagger), "‡", "transition state mark");
        c.scene.labelled(dagger);
        ids.push(dagger);
      }
      const groupId = `${prefix}_panel${index}`;
      c.scene.group(groupId, ids, layout.cues[index]!, previousGroup ? [previousGroup] : []);
      previousGroup = groupId;
      if (ink.arrows.length) {
        const arrowGroup = `${prefix}_arrows${stepIndex}`;
        c.scene.group(arrowGroup, emit(ink.arrows, origin), layout.arrowCues[stepIndex]!, [groupId]);
        previousGroup = arrowGroup;
        stepIndex += 1;
      }
    }
    if (stepIndex !== model.steps.length) return decline("a step has no panel for its arrows");
    rowTop = lineTop - 0.1;
  }
  // The compiler fits label anchors and ink, not label boxes: measure exactly that span.
  const points = c.scene.constructions.filter((construction) => construction.operator === "point").map((construction) => construction.inputs as { x: number; y: number });
  const fitWidth = (Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x))) * PX;
  const fitHeight = (Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y))) * PX;
  if (fitWidth > FIT_WIDTH_PX + 0.5 || fitHeight > FIT_HEIGHT_PX + 0.5) {
    return decline(`the figure spans ${Math.round(fitWidth)} x ${Math.round(fitHeight)} px at ${PX} px per unit, more than the ${FIT_WIDTH_PX} x ${FIT_HEIGHT_PX} px zone (lines ${lineHeights.join(", ")} px; panels ${panelWidths.join(" | ")} px)`, true);
  }
  const caption = `${input.reactions.map(({ model, equation }) => `${model.mechanism} example: ${sideText(equation.reactants)}`).join("; ")}. Each curly arrow moves one electron pair.`;
  const document = c.build({ caption });
  document.source = {
    ...document.source,
    nonMetric: true,
    mechanism: { reactions: input.reactions.map(({ model }) => model.mechanism), declined: [] },
  };
  return { document, retry: false };
}

