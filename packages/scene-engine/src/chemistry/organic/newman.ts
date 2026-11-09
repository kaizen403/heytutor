/**
 * Newman projections of one molecule, computed from its graph. The molecule is the
 * organic parser's own reading of the stem; the bond looked along is computed from
 * the graph; every distinct conformer is drawn and named from its computed dihedral
 * (anti, gauche, eclipsed, fully eclipsed, staggered). The stem never picks a
 * conformer: a stem naming one still sees all of them, each named truly.
 *
 * Declines when no single molecule is bound, when the molecule has a ring, a multiple
 * bond on the carbons looked along, or a group it cannot label, when the bond is not
 * determined by the graph, or when the stem names a bond in locants that is not the
 * computed one. Locants are read only to decline, never to choose the bond.
 */
import type { SceneDocument } from "../../types";
import { requiresConformationProjection } from "../foundation/conformationRequest";
import { ChemScene, type Vec2 } from "../sceneKit";
import { findMentions } from "./namedMentions";
import type { Molecule } from "./smiles";

const ORGANIC_FAMILY = "chem_organic";

/** One group on a carbon looked along, labelled for the board. */
interface Group { readonly label: string; readonly heavy: boolean }

export type NewmanBinding =
  | { status: "bound"; name: string; front: Group[]; back: Group[] }
  | { status: "declined"; reason: string };

const HALOGENS = new Set(["F", "Cl", "Br", "I"]);

function neighbours(molecule: Molecule, atom: number): number[] {
  return molecule.bonds.flatMap((bond) => bond.a === atom ? [bond.b] : bond.b === atom ? [bond.a] : []);
}

function bondsOf(molecule: Molecule, atom: number) {
  return molecule.bonds.filter((bond) => bond.a === atom || bond.b === atom);
}

/** Canonical text of the branch from `atom` away from `parent`, for symmetry classes. Acyclic only. */
function branch(molecule: Molecule, atom: number, parent: number): string {
  const a = molecule.atoms[atom]!;
  const children = neighbours(molecule, atom).filter((n) => n !== parent).map((n) => branch(molecule, n, atom)).sort();
  return `${a.element}${a.hydrogens}(${children.join(",")})`;
}

/** The board label of the group at `atom` seen from `parent`, or null when it has none. */
function groupLabel(molecule: Molecule, atom: number, parent: number): string | null {
  const a = molecule.atoms[atom]!;
  const rest = neighbours(molecule, atom).filter((n) => n !== parent);
  if (HALOGENS.has(a.element) && rest.length === 0 && a.hydrogens === 0) return a.element;
  if (a.element === "O" && rest.length === 0 && a.hydrogens === 1) return "OH";
  if (a.element !== "C") return null;
  if (rest.length === 0 && a.hydrogens === 3) return "CH_3";
  if (rest.length === 1 && a.hydrogens === 2) {
    const next = molecule.atoms[rest[0]!]!;
    if (next.element === "C" && next.hydrogens === 3 && neighbours(molecule, rest[0]!).length === 1) return "C_2H_5";
  }
  return null;
}

/** The groups on one carbon of the bond, H first or the one heavy group, or null when it cannot be drawn. */
function endGroups(molecule: Molecule, carbon: number, partner: number): Group[] | null {
  const groups: Group[] = [];
  for (const n of neighbours(molecule, carbon).filter((other) => other !== partner)) {
    const label = groupLabel(molecule, n, carbon);
    if (!label) return null;
    groups.push({ label, heavy: true });
  }
  for (let i = 0; i < molecule.atoms[carbon]!.hydrogens; i += 1) groups.push({ label: "H", heavy: false });
  if (groups.length !== 3 || groups.filter((group) => group.heavy).length > 1) return null;
  return groups.sort((x, y) => Number(y.heavy) - Number(x.heavy));
}

/** Carbon positions along an unbranched chain, 1 to n from one end, or null when it branches. */
function chainPositions(molecule: Molecule): Map<number, number> | null {
  const carbons = molecule.atoms.filter((atom) => atom.element === "C").map((atom) => atom.index);
  const carbonDegree = (c: number) => neighbours(molecule, c).filter((n) => molecule.atoms[n]!.element === "C").length;
  if (carbons.some((c) => carbonDegree(c) > 2)) return null;
  const end = carbons.find((c) => carbonDegree(c) <= 1);
  if (end === undefined) return null;
  const positions = new Map<number, number>();
  let previous = -1;
  let current = end;
  while (current !== undefined && !positions.has(current)) {
    positions.set(current, positions.size + 1);
    const next = neighbours(molecule, current).find((n) => n !== previous && molecule.atoms[n]!.element === "C");
    previous = current;
    current = next as number;
  }
  return positions.size === carbons.length ? positions : null;
}

const LOCANT_PAIR = /\bC\s*-?\s*(\d+)\s*(?:[-–—−]|to|and)\s*C\s*-?\s*(\d+)\b/gi;
/**
 * Read only to decline. A sawhorse ask is a different drawing, and an exclusion may
 * strike out Newman itself or a conformer the figure always draws beside the rest.
 */
const SAWHORSE = /\bsawhorse\b/i;
const EXCLUSION = /\b(?:no|not|never|neither|nor|without|except|excluding|excluded|exclude|omit|ignore|rather\s+than|instead\s+of)\b|n['’]t\b/i;

export function newmanBinding(question: string): NewmanBinding {
  if (!requiresConformationProjection(question)) return { status: "declined", reason: "no conformation projection asked" };
  const stem = question.normalize("NFKC");
  if (SAWHORSE.test(stem)) return { status: "declined", reason: "a sawhorse projection is another drawing" };
  if (EXCLUSION.test(stem)) return { status: "declined", reason: "the stem excludes a projection or a conformer" };
  const keys = new Map<string, { molecule: Molecule; text: string }>();
  for (const mention of findMentions(question)) {
    if (!mention.weak && !keys.has(mention.key)) keys.set(mention.key, { molecule: mention.molecule, text: mention.text });
  }
  if (keys.size !== 1) return { status: "declined", reason: keys.size === 0 ? "no molecule is bound" : "more than one molecule is named" };
  const [{ molecule, text }] = [...keys.values()];
  if (molecule.atoms.some((atom) => atom.aromatic || atom.charge !== 0)) return { status: "declined", reason: "aromatic or charged" };
  if (molecule.bonds.length !== molecule.atoms.length - 1) return { status: "declined", reason: "the molecule has a ring" };

  // Rotatable bonds: C-C single bonds between two carbons with no multiple bond.
  const saturated = (c: number) => molecule.atoms[c]!.element === "C" && bondsOf(molecule, c).every((bond) => bond.order === 1 && !bond.aromatic);
  const candidates = molecule.bonds.filter((bond) => bond.order === 1 && saturated(bond.a) && saturated(bond.b));
  if (candidates.length === 0) return { status: "declined", reason: "no single bond between saturated carbons" };
  const signature = (bond: { a: number; b: number }) => [branch(molecule, bond.a, bond.b), branch(molecule, bond.b, bond.a)].sort().join("|");
  const classes = new Map<string, Array<{ a: number; b: number }>>();
  for (const bond of candidates) classes.set(signature(bond), [...(classes.get(signature(bond)) ?? []), bond]);
  const heavyBothEnds = (bond: { a: number; b: number }) =>
    neighbours(molecule, bond.a).some((n) => n !== bond.b) && neighbours(molecule, bond.b).some((n) => n !== bond.a);
  let chosen: { a: number; b: number } | null = null;
  if (classes.size === 1) chosen = candidates[0]!;
  else {
    const central = [...classes.values()].filter((members) => heavyBothEnds(members[0]!));
    if (central.length === 1) chosen = central[0]![0]!;
  }
  if (!chosen) return { status: "declined", reason: "the bond to look along is not determined" };

  const front = endGroups(molecule, chosen.a, chosen.b);
  const back = endGroups(molecule, chosen.b, chosen.a);
  if (!front || !back) return { status: "declined", reason: "a group the figure cannot label, or two heavy groups on one carbon" };
  // The title carries the name exactly, both to be true and to bind the plan's species;
  // a board label holds 16 characters, so a longer name declines rather than shortens.
  const name = molecule.name ?? text;
  if (name.length > 16) return { status: "declined", reason: "the name does not fit one board label" };

  // Locants are read only to decline: a stated bond must be the computed one. Each carbon of
  // the bond carries at most one group, CH3 or C2H5 at most, so a bound molecule is an
  // unbranched chain of at most six carbons and always has chain positions.
  const positions = chainPositions(molecule);
  // Unreachable by the group rule above; a decline, not a throw, if that rule ever changes.
  if (!positions) return { status: "declined", reason: "locants on a branched molecule" };
  for (const match of question.normalize("NFKC").matchAll(LOCANT_PAIR)) {
    const stated = [Number(match[1]), Number(match[2])].sort((x, y) => x - y);
    const n = positions.size;
    const here = [positions.get(chosen.a)!, positions.get(chosen.b)!].sort((x, y) => x - y);
    const mirror = here.map((p) => n + 1 - p).sort((x, y) => x - y);
    const same = (p: number[]) => p[0] === stated[0] && p[1] === stated[1];
    if (!same(here) && !same(mirror)) return { status: "declined", reason: "the stem names another bond" };
  }
  return { status: "bound", name, front, back };
}

/** Every distinct conformer and its name, from the dihedral between the leading groups. */
function conformers(binding: Extract<NewmanBinding, { status: "bound" }>): Array<{ dihedral: number; name: string }> {
  const leading = binding.front[0]!.heavy && binding.back[0]!.heavy;
  return leading
    ? [{ dihedral: 180, name: "anti" }, { dihedral: 60, name: "gauche" }, { dihedral: 120, name: "eclipsed" }, { dihedral: 0, name: "fully eclipsed" }]
    : [{ dihedral: 60, name: "staggered" }, { dihedral: 0, name: "eclipsed" }];
}

const RADIUS = 0.55;
/** Front bonds stop short and back bonds reach further, so the two rings of labels never meet. */
const FRONT_REACH = 1.0;
const FRONT_LABEL = 1.3;
const BACK_REACH = 1.6;
const BACK_LABEL = 2.05;
/** Eclipsed back bonds are drawn turned this far so they show beside the front ones, as in print. */
const ECLIPSED_SHOW = 18;
/** In an eclipsed panel each front label turns this far away from the back bond beside it, which would cross it. */
const ECLIPSED_LABEL_TURN = 14;
const PANEL_GAP = 5.2;
/** Leaves room for each conformer's name between its lowest label and the panel below. */
const ROW_GAP = 6.0;
const NAME_BELOW = 2.9;

const toward = (centre: Vec2, degrees: number, distance: number): Vec2 => ({
  x: centre.x + distance * Math.cos((degrees * Math.PI) / 180),
  y: centre.y + distance * Math.sin((degrees * Math.PI) / 180),
});

export function buildNewmanScene(question: string): SceneDocument | null {
  const binding = newmanBinding(question);
  if (binding.status !== "bound") return null;
  const c = new ChemScene(question, `Newman projections of ${binding.name}`, ORGANIC_FAMILY);
  const list = conformers(binding);
  // Two conformers sit in a row; four in a two by two grid, so the board scale keeps
  // every label clear of the bonds.
  const columns = list.length > 2 ? 2 : list.length;
  const rows = Math.ceil(list.length / columns);
  const centreOf = (index: number): Vec2 => ({
    x: (index % columns) * PANEL_GAP - ((columns - 1) * PANEL_GAP) / 2,
    y: -Math.floor(index / columns) * ROW_GAP + ((rows - 1) * ROW_GAP) / 2,
  });
  const top = ((rows - 1) * ROW_GAP) / 2;
  c.text("title", { x: 0, y: top + NAME_BELOW }, binding.name, "molecule name", { preserveText: true });
  list.forEach((conformer, index) => {
    const tag = `p${index + 1}`;
    const centre = centreOf(index);
    const ids: string[] = [];
    const ring = c.scene.helper(`${tag}_c`, centre, "back carbon centre helper");
    c.scene.circle(`${tag}_back`, ring, RADIUS, "back carbon");
    ids.push(`${tag}_back`);
    const eclipsed = conformer.dihedral % 120 === 0;
    const shown = eclipsed ? conformer.dihedral + ECLIPSED_SHOW : conformer.dihedral;
    binding.front.forEach((group, k) => {
      const angle = 90 + 120 * k;
      const labelAngle = eclipsed ? angle + ECLIPSED_LABEL_TURN : angle;
      ids.push(...c.bond(`${tag}_f${k}`, centre, toward(centre, angle, FRONT_REACH), { role: "front carbon bond" }));
      ids.push(c.text(`${tag}_fl${k}`, toward(centre, labelAngle, FRONT_LABEL), group.label, "front group", { preserveText: true }));
    });
    binding.back.forEach((group, k) => {
      const angle = 90 - shown + 120 * k;
      ids.push(...c.bond(`${tag}_b${k}`, toward(centre, angle, RADIUS), toward(centre, angle, BACK_REACH), { role: "back carbon bond" }));
      ids.push(c.text(`${tag}_bl${k}`, toward(centre, angle, BACK_LABEL), group.label, "back group", { preserveText: true }));
    });
    ids.push(c.text(`${tag}_name`, { x: centre.x, y: centre.y - NAME_BELOW }, conformer.name, "conformation name", { preserveText: true }));
    c.scene.group(`conformer_${index + 1}`, ids, `${conformer.name} conformation of ${binding.name}, viewed along the C–C bond`);
  });
  return c.build({ caption: `${binding.name}: ${list.map((item) => item.name).join(", ")}; Newman projections along the C–C bond` });
}
