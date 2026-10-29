/**
 * A cyclic elimination drawn the way a board draws it: the substrate with
 * its reacting atoms on a regular ring and one curly arrow per electron
 * pair, the transition state with every bond that changes drawn as a
 * partial (dashed) bond, and the two products at the same positions.
 *
 * Every mark comes from the checked model: ring positions from the arrow
 * ring, bond orders from the states before and after the step, labels from
 * the atoms and their hydrogens. A substituent the figure cannot write as
 * one short group declines the whole figure.
 */
import type { SceneDocument } from "../../../types";
import { ChemScene, type Vec2 } from "../../sceneKit";
import { arrowRing, type CurlyArrow } from "./arrows";
import { CYCLIC_RING_SIZE, type CyclicElimination, type CyclicEliminationKind } from "./eliminations";
import { bondOrder, formalCharge, fragments, neighbourAtoms, type MechState } from "./state";

/** Board titles; a label holds at most 16 characters. */
export const MECHANISM_TITLES: Readonly<Record<CyclicEliminationKind, string>> = {
  ester_pyrolysis: "Ester pyrolysis",
  xanthate_pyrolysis: "Chugaev reaction",
  cope_elimination: "Cope elimination",
};
const MECHANISM_NAMES: Readonly<Record<CyclicEliminationKind, string>> = {
  ester_pyrolysis: "Ester pyrolysis",
  xanthate_pyrolysis: "Xanthate (Chugaev) pyrolysis",
  cope_elimination: "Cope elimination",
};
const SECOND_PRODUCT: Readonly<Record<CyclicEliminationKind, string>> = {
  ester_pyrolysis: "a carboxylic acid",
  xanthate_pyrolysis: "an S-alkyl dithiocarbonic acid",
  cope_elimination: "a hydroxylamine",
};
const RING_WORDS: Readonly<Record<number, string>> = { 5: "five", 6: "six" };
const CURVE_SAMPLES = 10;
const CURVE_MIN_BOW = 0.36;
const LONE_PAIR_TURN = (50 * Math.PI) / 180;
/** Ring bond length: two "CH_2" labels side by side still leave a visible bond between them. */
const RING_SIDE = 1.5;
const SUBSTITUENT_BOND = 1.1;
const GROUP_PAIR_SPREAD = Math.PI / 3;
/** The clearance `ChemScene.atom` keeps around a label of this length. */
const labelTrim = (text: string): number => 0.24 * Math.max(1, Math.min(2, text.length / 2));

export interface DeclinedReaction { readonly reaction: string; readonly reason: string }

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const mid = (a: Vec2, b: Vec2): Vec2 => scale(add(a, b), 0.5);
const length = (a: Vec2): number => Math.hypot(a.x, a.y);
const unit = (a: Vec2): Vec2 => scale(a, 1 / (length(a) || 1));
const subscript = (count: number): string => (count > 1 ? `_${count}` : "");
const chargeText = (charge: number): string => (charge === 0 ? "" : `^(${charge > 0 ? "+" : "-"})`);

/** Ring order with the H acceptor after the centre and Cbeta, Calpha at the bottom. */
function ringOrder(model: CyclicElimination): number[] | null {
  const { hydrogen, beta, alpha, leaving, centre, acceptor } = model.roles;
  const order = model.kind === "cope_elimination" ? [acceptor, hydrogen, beta, alpha, leaving] : [centre, acceptor, hydrogen, beta, alpha, leaving];
  const ring = arrowRing(model.substrate, model.step);
  if (!ring || ring.length !== order.length || ring.length !== CYCLIC_RING_SIZE[model.kind]) return null;
  // The drawn order must be the arrow ring itself, walked in one direction.
  const at = ring.indexOf(order[0]!);
  if (at < 0) return null;
  const forward = order.every((atom, index) => ring[(at + index) % ring.length] === atom);
  const backward = order.every((atom, index) => ring[(at - index + ring.length * 2) % ring.length] === atom);
  return forward || backward ? order : null;
}

function polygon(count: number): Vec2[] {
  const radius = RING_SIDE / (2 * Math.sin(Math.PI / count));
  const base = (540 - (360 * (2 * count - 5)) / count) / 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = ((base + (360 * index) / count) * Math.PI) / 180;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
}

/** A one group label for everything hanging off `root` away from `from`, or null. */
function groupLabel(state: MechState, root: number, from: number): string | null {
  const element = state.atoms[root]!.element;
  if (element === "R") return "R";
  const heavy = neighbourAtoms(state, root).filter((other) => other !== from && state.atoms[other]!.element !== "H");
  const hydrogens = neighbourAtoms(state, root).filter((other) => state.atoms[other]!.element === "H").length;
  const charge = chargeText(formalCharge(state, root));
  if (bondOrder(state, root, from) !== 1) return null;
  if (heavy.length === 0) return `${element}${hydrogens ? `H${subscript(hydrogens)}` : ""}${charge}`;
  if (heavy.length === 1 && !charge && hydrogens === 0 && ["O", "S", "N"].includes(element)) {
    const tip = heavy[0]!;
    const tipHeavy = neighbourAtoms(state, tip).filter((other) => other !== root && state.atoms[other]!.element !== "H");
    const tipH = neighbourAtoms(state, tip).filter((other) => state.atoms[other]!.element === "H").length;
    if (tipHeavy.length || bondOrder(state, root, tip) !== 1 || formalCharge(state, tip) !== 0) return null;
    if (state.atoms[tip]!.element === "R") return `${element}R`;
    if (state.atoms[tip]!.element === "C" && tipH === 3) return `${element}CH_3`;
  }
  return null;
}

interface Layout {
  positions: Map<number, Vec2>;
  /** Substituent group roots: label and the ring atom they hang on. */
  groups: Array<{ root: number; on: number; label: string }>;
  /** Hydrogens drawn as their own atom (the moving H). */
  explicitH: Set<number>;
  centre: Vec2;
}

function layout(model: CyclicElimination, order: number[]): Layout | null {
  const state = model.substrate;
  const corners = polygon(order.length);
  const positions = new Map<number, Vec2>();
  order.forEach((atom, index) => positions.set(atom, corners[index]!));
  const ringSet = new Set(order);
  const groups: Layout["groups"] = [];
  for (const atom of order) {
    if (atom === model.roles.hydrogen) continue;
    const outward = unit(positions.get(atom)!);
    // Hydrogens are folded into the ring atom's label (`ringLabel`), never drawn again as groups.
    const hanging = neighbourAtoms(state, atom).filter((other) => !ringSet.has(other) && state.atoms[other]!.element !== "H");
    if (hanging.length > 2) return null;
    hanging.forEach((root, index) => {
      const label = groupLabel(state, root, atom);
      if (!label) return;
      // A pair splits 120 degrees, as drawn on paper: two CH_3 labels at less than that collide.
      const spread = hanging.length === 1 ? 0 : (index === 0 ? -1 : 1) * GROUP_PAIR_SPREAD;
      const direction = unit({ x: outward.x * Math.cos(spread) - outward.y * Math.sin(spread), y: outward.x * Math.sin(spread) + outward.y * Math.cos(spread) });
      positions.set(root, add(positions.get(atom)!, scale(direction, SUBSTITUENT_BOND)));
      groups.push({ root, on: atom, label });
    });
    if (groups.filter((group) => group.on === atom).length !== hanging.length) return null;
  }
  return { positions, groups, explicitH: new Set([model.roles.hydrogen]), centre: { x: 0, y: 0 } };
}

/** Label of a ring atom in a state: its symbol, the hydrogens folded onto a carbon, and its charge. */
function ringLabel(state: MechState, atom: number, explicitH: ReadonlySet<number>, charged: boolean): string {
  const element = state.atoms[atom]!.element;
  const folded = neighbourAtoms(state, atom).filter((other) => state.atoms[other]!.element === "H" && !explicitH.has(other)).length;
  return `${element}${folded ? `H${subscript(folded)}` : ""}${charged ? chargeText(formalCharge(state, atom)) : ""}`;
}

type Stage = "reactant" | "ts" | "products";

interface PanelResult {
  ids: string[];
  minX: number; maxX: number; minY: number; maxY: number;
  /** Right edge of the widest label, for marks set beside the panel. */
  labelMaxX: number;
}

function drawPanel(c: ChemScene, prefix: string, model: CyclicElimination, order: number[], laid: Layout, origin: Vec2, stage: Stage): PanelResult {
  const before = model.substrate;
  const after = model.products;
  const state = stage === "products" ? after : before;
  const ids: string[] = [];
  const shift = new Map<number, Vec2>();
  if (stage === "products") {
    // The two products part a little so they read as two species.
    const pieces = fragments(after);
    const alkene = pieces.find((piece) => piece.includes(model.roles.alpha))!;
    for (const piece of pieces) for (const atom of piece) shift.set(atom, piece === alkene ? { x: 0, y: -0.4 } : { x: 0, y: 0.25 });
  }
  const at = (atom: number): Vec2 => add(add(origin, laid.positions.get(atom)!), shift.get(atom) ?? { x: 0, y: 0 });
  const atomId = (atom: number): string => `${prefix}_a${atom}`;
  const drawnAtoms: number[] = [...order, ...laid.groups.map((group) => group.root)];
  const texts = new Map<number, string>();
  for (const atom of drawnAtoms) {
    const group = laid.groups.find((entry) => entry.root === atom);
    // Charges in the transition state are partial: only the ends carry formal charges.
    const text = group ? group.label : atom === model.roles.hydrogen ? "H" : ringLabel(state, atom, laid.explicitH, stage !== "ts");
    texts.set(atom, text);
    ids.push(c.atom(atomId(atom), state.atoms[atom]!.element, at(atom), { text, role: group ? "substituent group" : `${state.atoms[atom]!.element} atom` }));
  }
  const edges: Array<[number, number]> = [];
  for (let index = 0; index < order.length; index += 1) edges.push([order[index]!, order[(index + 1) % order.length]!]);
  for (const group of laid.groups) edges.push([group.on, group.root]);
  for (const [a, b] of edges) {
    const was = bondOrder(before, a, b);
    const now = bondOrder(after, a, b);
    const key = `${prefix}_b${Math.min(a, b)}_${Math.max(a, b)}`;
    if (stage !== "ts") {
      const order2 = stage === "reactant" ? was : now;
      if (order2 > 0) ids.push(...c.bond(key, atomId(a), atomId(b), { order: order2 as 1 | 2 | 3, spacing: 0.13 }));
      continue;
    }
    const solid = Math.min(was, now);
    if (solid > 0) ids.push(...c.bond(key, atomId(a), atomId(b), { order: solid as 1 | 2 | 3, spacing: 0.13, role: "bond kept through the transition state" }));
    if (was !== now) {
      // The changing pair: a dashed stroke, inside the ring beside any kept stroke.
      const pa = at(a), pb = at(b);
      const inward = unit(sub(add(origin, laid.centre), mid(pa, pb)));
      const offset = solid > 0 ? scale(inward, 0.13) : { x: 0, y: 0 };
      const direction = unit(sub(pb, pa));
      const start = add(add(pa, scale(direction, labelTrim(texts.get(a)!))), offset);
      const end = add(sub(pb, scale(direction, labelTrim(texts.get(b)!))), offset);
      ids.push(c.link(`${key}_partial`, start, end, "partial bond in the transition state"));
    }
  }
  const xs = drawnAtoms.map((atom) => at(atom).x), ys = drawnAtoms.map((atom) => at(atom).y);
  const labelMaxX = Math.max(...drawnAtoms.map((atom) => at(atom).x + labelTrim(texts.get(atom)!) + 0.25));
  return { ids, minX: Math.min(...xs) - 0.35, maxX: Math.max(...xs) + 0.35, minY: Math.min(...ys) - 0.3, maxY: Math.max(...ys) + 0.3, labelMaxX };
}

function curlyArrows(c: ChemScene, prefix: string, model: CyclicElimination, laid: Layout, origin: Vec2): string[] {
  const ids: string[] = [];
  const at = (atom: number): Vec2 => add(origin, laid.positions.get(atom)!);
  const centre = add(origin, laid.centre);
  model.step.arrows.forEach((arrow: CurlyArrow, index) => {
    let tail: Vec2;
    // A lone pair sits outside the ring and its arrow wraps round to the bond it forms.
    const fromLonePair = arrow.tail.kind === "lone_pair";
    if (arrow.tail.kind === "lone_pair") {
      const atom = at(arrow.tail.atom);
      const towards = arrow.head.kind === "bond" ? at(arrow.head.a === arrow.tail.atom ? arrow.head.b : arrow.head.a) : centre;
      const outward = Math.atan2(atom.y - centre.y, atom.x - centre.x);
      const partner = Math.atan2(towards.y - atom.y, towards.x - atom.x);
      const turn = Math.sin(partner - outward) >= 0 ? 1 : -1;
      const angle = ((outward + turn * LONE_PAIR_TURN) * 180) / Math.PI;
      // Clear of the label ("O^(-)" is wide), so the dots never read as part of the symbol.
      const distance = Math.max(0.36, labelTrim(ringLabel(model.substrate, arrow.tail.atom, laid.explicitH, true)) + 0.1);
      ids.push(...c.lonePair(`${prefix}_lp${index}`, atom, angle, distance));
      const rad = (angle * Math.PI) / 180;
      tail = add(atom, { x: Math.cos(rad) * (distance + 0.14), y: Math.sin(rad) * (distance + 0.14) });
    } else {
      tail = add(mid(at(arrow.tail.a), at(arrow.tail.b)), scale(unit(sub(centre, mid(at(arrow.tail.a), at(arrow.tail.b)))), 0.12));
    }
    let head: Vec2;
    if (arrow.head.kind === "bond") {
      const middle = mid(at(arrow.head.a), at(arrow.head.b));
      head = add(middle, scale(unit(sub(centre, middle)), 0.12));
    } else {
      const atom = at(arrow.head.atom);
      head = add(atom, scale(unit(sub(tail, atom)), 0.36));
    }
    // The compiler holds any curved path to 12 px across; the bow keeps a
    // short arrow clear of that at board scale.
    const bow = Math.max(CURVE_MIN_BOW, length(sub(head, tail)) * 0.35);
    const along = unit(sub(head, tail));
    const inward = sub(centre, mid(tail, head));
    const side = (-along.y * inward.x + along.x * inward.y >= 0 ? 1 : -1) * (fromLonePair ? -1 : 1);
    const control = add(mid(tail, head), scale({ x: -along.y * side, y: along.x * side }, 2 * bow));
    const points: string[] = [];
    for (let step = 0; step <= CURVE_SAMPLES; step += 1) {
      const t = step / CURVE_SAMPLES;
      const point = add(add(scale(tail, (1 - t) ** 2), scale(control, 2 * (1 - t) * t)), scale(head, t * t));
      points.push(c.scene.helper(`${prefix}_arrow${index}_p${step}`, point, "curly arrow path helper"));
    }
    const id = `${prefix}_arrow${index}`;
    c.scene.entities.push({ id, kind: "vector", role: "curly arrow: one electron pair moves from tail to head" });
    c.scene.constructions.push({ id: `make_${id}`, operator: "polyline", inputs: { points }, outputs: [id] });
    ids.push(id);
  });
  return ids;
}

export interface MechanismFigureInput { question: string; reactions: readonly CyclicElimination[]; declined: readonly DeclinedReaction[] }

export function buildCyclicEliminationFigure(input: MechanismFigureInput): SceneDocument | null {
  if (!input.reactions.length || input.reactions.length > 3) return null;
  const c = new ChemScene(input.question, "source-bound curly arrow mechanism with checked electron bookkeeping", "chem_organic");
  let rowTop = 0;
  const titles: string[] = [];
  for (const [index, model] of input.reactions.entries()) {
    const order = ringOrder(model);
    if (!order) return null;
    const laid = layout(model, order);
    if (!laid) return null;
    const prefix = `rx${index}`;
    const xs = [...laid.positions.values()].map((p) => p.x), ys = [...laid.positions.values()].map((p) => p.y);
    const width = Math.max(...xs) - Math.min(...xs) + 0.7;
    const gap = 2.4;
    const top = Math.max(...ys) + 0.3;
    const originY = rowTop - top - 0.9;
    const origins = [0, 1, 2].map((column) => ({ x: column * (width + gap) - Math.min(...xs), y: originY }));
    const title = MECHANISM_TITLES[model.kind];
    titles.push(MECHANISM_NAMES[model.kind]);
    const reactant = drawPanel(c, `${prefix}r`, model, order, laid, origins[0]!, "reactant");
    const titleId = c.text(`${prefix}_title`, { x: (reactant.minX + reactant.maxX) / 2, y: reactant.maxY + 0.45 }, title, "mechanism name");
    c.scene.labelled(titleId);
    c.scene.group(`${prefix}_substrate`, [titleId, ...reactant.ids], `${title}: the substrate, with the atoms that react on one ring.`, index ? [`rx${index - 1}_products`] : []);
    const arrows = curlyArrows(c, `${prefix}r`, model, laid, origins[0]!);
    c.scene.group(`${prefix}_arrows`, arrows, `${model.step.arrows.length} curly arrows; each moves one electron pair from its tail to its head, all at once.`, [`${prefix}_substrate`]);
    const ts = drawPanel(c, `${prefix}t`, model, order, laid, origins[1]!, "ts");
    const ring = CYCLIC_RING_SIZE[model.kind];
    const toTs = c.arrow(`${prefix}_heat`, { x: reactant.maxX + 0.35, y: originY }, { x: ts.minX - 0.35, y: originY }, "reaction arrow", "Δ");
    const dagger = c.text(`${prefix}_dagger`, { x: Math.max(ts.maxX, ts.labelMaxX) + 0.15, y: ts.maxY + 0.1 }, "‡", "transition state mark");
    const ringNote = c.text(`${prefix}_ring`, { x: (ts.minX + ts.maxX) / 2, y: ts.minY - 0.4 }, `${RING_WORDS[ring]}-membered TS`, "cyclic transition state size");
    c.scene.labelled(dagger, ringNote);
    c.scene.group(`${prefix}_ts`, [toTs, ...ts.ids, dagger, ringNote], `On heating: the ${RING_WORDS[ring]}-membered cyclic transition state; dashed bonds are forming or breaking.`, [`${prefix}_arrows`]);
    const products = drawPanel(c, `${prefix}p`, model, order, laid, origins[2]!, "products");
    const toProducts = c.arrow(`${prefix}_to_products`, { x: ts.maxX + 0.35, y: originY }, { x: products.minX - 0.35, y: originY }, "reaction arrow");
    const plus = c.text(`${prefix}_plus`, add(origins[2]!, { x: laid.centre.x + 0.15, y: laid.centre.y - 0.05 }), "+", "plus sign");
    c.scene.group(`${prefix}_products`, [toProducts, ...products.ids, plus], `The products: an alkene and ${SECOND_PRODUCT[model.kind]}.`, [`${prefix}_ts`]);
    rowTop = Math.min(reactant.minY, ts.minY - 0.8, products.minY) - 0.6;
  }
  const document = c.build({ caption: `${titles.join(" and ")}: syn elimination through a cyclic transition state. Each curly arrow moves one electron pair.` });
  const demotions = input.declined.map((entry, index) => ({
    code: "mechanism_reaction_declined",
    severity: "warning",
    path: `source.mechanism.declined[${index}]`,
    expected: "verified_mechanism",
    message: `Not drawn: ${entry.reaction}, because ${entry.reason}.`,
  }));
  document.source = {
    ...document.source,
    nonMetric: true,
    mechanism: { reactions: input.reactions.map((model) => model.kind), declined: input.declined.map((entry) => ({ ...entry })) },
    ...(demotions.length ? { yieldDemotions: demotions } : {}),
  };
  return document;
}
