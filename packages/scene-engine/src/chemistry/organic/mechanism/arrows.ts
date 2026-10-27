/**
 * Curly arrows: each moves one electron pair from its tail to its head.
 *
 * - A lone pair tail forms (or raises) a bond from its own atom.
 * - A bond tail either ends on one of its own atoms, which keeps the pair
 *   as a lone pair, or moves to a bond that shares exactly one of its atoms.
 *
 * The arrows of one step act together (a concerted step), so the shells are
 * judged on the state the whole step leaves. Every check is fatal: a step
 * that breaks one draws nothing.
 */
import { bondOrder, cloneState, findBond, shellViolations, totalCharge, totalElectrons, type MechState } from "./state";

export type ArrowTail = { kind: "lone_pair"; atom: number } | { kind: "bond"; a: number; b: number };
export type ArrowHead = { kind: "atom"; atom: number } | { kind: "bond"; a: number; b: number };
export interface CurlyArrow { readonly tail: ArrowTail; readonly head: ArrowHead }
export interface MechanismStep {
  readonly arrows: readonly CurlyArrow[];
  /** Carbons this step may leave with six electrons and a positive charge (a declared carbocation). */
  readonly sextets?: readonly number[];
}
export type StepResult = { ok: true; state: MechState } | { ok: false; reason: string };

const pairKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** Why this arrow cannot be drawn on `state`, or null. Untouchable atoms (R) are named by the caller. */
export function arrowShapeProblem(state: MechState, arrow: CurlyArrow): string | null {
  const { tail, head } = arrow;
  const exists = (atom: number): boolean => Number.isInteger(atom) && atom >= 0 && atom < state.atoms.length;
  const atoms = [tail.kind === "lone_pair" ? [tail.atom] : [tail.a, tail.b], head.kind === "atom" ? [head.atom] : [head.a, head.b]].flat();
  if (!atoms.every(exists)) return "arrow names an atom that is not in the species";
  if (atoms.some((atom) => state.atoms[atom]!.element === "R")) return "an arrow may not touch the generic group R";
  if (tail.kind === "lone_pair") {
    if (head.kind !== "bond" || (head.a !== tail.atom && head.b !== tail.atom) || head.a === head.b) return "a lone pair can only form a bond from its own atom";
    return null;
  }
  if (tail.a === tail.b) return "a bond tail needs two atoms";
  if (head.kind === "atom") return head.atom === tail.a || head.atom === tail.b ? null : "a bond pair can only stay on one of its own atoms";
  if (head.a === head.b) return "a bond head needs two atoms";
  const shared = [head.a, head.b].filter((atom) => atom === tail.a || atom === tail.b).length;
  return shared === 1 ? null : "a bond pair can only move to a bond that shares one of its atoms";
}

export function applyStep(state: MechState, step: MechanismStep): StepResult {
  if (!step.arrows.length) return { ok: false, reason: "a step needs at least one arrow" };
  // Tails are electrons that exist before the step: a lone pair or a bond order used twice must be there twice.
  const lonePairUse = new Map<number, number>();
  const bondUse = new Map<string, number>();
  for (const arrow of step.arrows) {
    const problem = arrowShapeProblem(state, arrow);
    if (problem) return { ok: false, reason: problem };
    if (arrow.tail.kind === "lone_pair") lonePairUse.set(arrow.tail.atom, (lonePairUse.get(arrow.tail.atom) ?? 0) + 1);
    else bondUse.set(pairKey(arrow.tail.a, arrow.tail.b), (bondUse.get(pairKey(arrow.tail.a, arrow.tail.b)) ?? 0) + 1);
  }
  for (const [atom, used] of lonePairUse) if (state.atoms[atom]!.lonePairs < used) return { ok: false, reason: `atom ${atom} has no lone pair to give` };
  for (const [key, used] of bondUse) {
    const [a, b] = key.split(":").map(Number) as [number, number];
    if (bondOrder(state, a, b) < used) return { ok: false, reason: `bond ${key} has no pair to give` };
  }
  const next = cloneState(state);
  const raise = (a: number, b: number): void => {
    const bond = findBond(next, a, b);
    if (bond) bond.order += 1;
    else next.bonds.push({ a, b, order: 1 });
  };
  for (const { tail, head } of step.arrows) {
    if (tail.kind === "lone_pair") next.atoms[tail.atom]!.lonePairs -= 1;
    else findBond(next, tail.a, tail.b)!.order -= 1;
    if (head.kind === "atom") next.atoms[head.atom]!.lonePairs += 1;
    else raise(head.a, head.b);
  }
  next.bonds = next.bonds.filter((bond) => bond.order > 0);
  if (totalElectrons(next) !== totalElectrons(state)) return { ok: false, reason: "electrons are not conserved" };
  if (totalCharge(next) !== totalCharge(state)) return { ok: false, reason: "charge is not conserved" };
  const shells = shellViolations(next, step.sextets ?? []);
  if (shells.length) return { ok: false, reason: `shell rule broken: ${shells.join("; ")}` };
  return { ok: true, state: next };
}

/** Run every step from `start`; the states list begins with `start`. */
export function runMechanism(start: MechState, steps: readonly MechanismStep[]): { ok: true; states: MechState[] } | { ok: false; reason: string; step: number } {
  const startShells = shellViolations(start);
  if (startShells.length) return { ok: false, reason: `starting species break the shell rule: ${startShells.join("; ")}`, step: -1 };
  const states = [start];
  for (const [index, step] of steps.entries()) {
    const result = applyStep(states[index]!, step);
    if (!result.ok) return { ok: false, reason: result.reason, step: index };
    states.push(result.state);
  }
  return { ok: true, states };
}

/**
 * The ring a concerted step's arrows travel: the atoms they touch, joined by
 * the bonds they start with and the bonds they form. Null unless those atoms
 * make exactly one simple cycle.
 */
export function arrowRing(state: MechState, step: MechanismStep): number[] | null {
  const touched = new Set<number>();
  const edges = new Set<string>();
  for (const { tail, head } of step.arrows) {
    for (const atom of tail.kind === "lone_pair" ? [tail.atom] : [tail.a, tail.b]) touched.add(atom);
    for (const atom of head.kind === "atom" ? [head.atom] : [head.a, head.b]) touched.add(atom);
    if (head.kind === "bond") edges.add(pairKey(head.a, head.b));
  }
  for (const bond of state.bonds) if (touched.has(bond.a) && touched.has(bond.b)) edges.add(pairKey(bond.a, bond.b));
  const adjacency = new Map<number, number[]>([...touched].map((atom) => [atom, []]));
  for (const key of edges) {
    const [a, b] = key.split(":").map(Number) as [number, number];
    adjacency.get(a)!.push(b);
    adjacency.get(b)!.push(a);
  }
  if ([...adjacency.values()].some((list) => list.length !== 2)) return null;
  const start = [...touched][0]!;
  const ring = [start];
  let previous = -1;
  let at = start;
  for (;;) {
    const next = adjacency.get(at)!.find((other) => other !== previous)!;
    if (next === start) break;
    if (ring.includes(next)) return null;
    ring.push(next);
    previous = at;
    at = next;
  }
  return ring.length === touched.size ? ring : null;
}
