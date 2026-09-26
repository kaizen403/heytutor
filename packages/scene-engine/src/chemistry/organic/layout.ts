/**
 * 2D coordinates for a molecular graph in the skeletal convention: rings as
 * regular polygons with bond length 1, fused rings sharing an edge, chains
 * as 120° zigzags, substituents on the free 120° direction alternating
 * side, branches laid out away from their parent, and a mirror retry when a
 * placed atom would land on another. Nitro, sulphonic acid and diazonium
 * groups collapse to one labelled vertex so the ring stays readable.
 *
 * The layout returns null when it cannot honour the graph (a spiro or
 * bridged ring system, or atoms that still overlap after every retry):
 * a distorted structure would teach the wrong shape.
 */
import { neighbours, type Molecule } from "./smiles";

export interface Vec2 { x: number; y: number }

export interface ExtraLabel {
  /** Atom the label hangs from (an aldehyde carbon's H). */
  readonly atom: number;
  readonly text: string;
  readonly at: Vec2;
}

export interface LaidOutMolecule {
  readonly molecule: Molecule;
  /** Position per atom index; hidden atoms carry their parent's position. */
  readonly positions: Vec2[];
  /** Atoms folded into a group label on their parent (nitro oxygens ...). */
  readonly hidden: Set<number>;
  /** Group label for a collapsed vertex, by atom index. */
  readonly groupLabels: Map<number, string>;
  /** Ring atom cycles in adjacency order. */
  readonly rings: number[][];
  /** Six-membered fully aromatic rings, drawn as a hexagon with an inner circle. */
  readonly aromaticSixRings: number[][];
  readonly extraLabels: ExtraLabel[];
}

const DEG = Math.PI / 180;
const rotate = (v: Vec2, degrees: number): Vec2 => ({
  x: v.x * Math.cos(degrees * DEG) - v.y * Math.sin(degrees * DEG),
  y: v.x * Math.sin(degrees * DEG) + v.y * Math.cos(degrees * DEG),
});
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const length = (a: Vec2): number => Math.hypot(a.x, a.y);
const unit = (a: Vec2): Vec2 => { const l = length(a); return l < 1e-9 ? { x: 1, y: 0 } : scale(a, 1 / l); };
const dist = (a: Vec2, b: Vec2): number => length(sub(a, b));
const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

const MIN_SEPARATION = 0.72;

/* ------------------------------------------------------------------------- */
/* Collapsed groups                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Groups drawn as one labelled vertex: nitro (NO_2), sulphonic acid (SO_3H),
 * diazonium (N_2^+). Returns the hidden atoms and the label per anchor.
 */
function collapsedGroups(molecule: Molecule): { hidden: Set<number>; labels: Map<number, string> } {
  const hidden = new Set<number>();
  const labels = new Map<number, string>();
  for (const atom of molecule.atoms) {
    const around = neighbours(molecule, atom.index);
    if (atom.element === "N" && atom.charge === 1) {
      const oxygens = around.filter((entry) => molecule.atoms[entry.atom]!.element === "O" && neighbours(molecule, entry.atom).length === 1);
      const others = around.filter((entry) => molecule.atoms[entry.atom]!.element !== "O");
      if (oxygens.length === 2 && others.length === 1) {
        oxygens.forEach((entry) => hidden.add(entry.atom));
        labels.set(atom.index, "NO_2");
        continue;
      }
      const terminalN = around.filter((entry) => molecule.atoms[entry.atom]!.element === "N" && entry.bond.order === 3 && neighbours(molecule, entry.atom).length === 1);
      if (terminalN.length === 1 && around.length === 2) {
        hidden.add(terminalN[0]!.atom);
        labels.set(atom.index, "N_2^(+)");
      }
    }
    if (atom.element === "S" && atom.charge === 0) {
      const oxo = around.filter((entry) => molecule.atoms[entry.atom]!.element === "O" && entry.bond.order === 2 && neighbours(molecule, entry.atom).length === 1);
      const hydroxy = around.filter((entry) => molecule.atoms[entry.atom]!.element === "O" && entry.bond.order === 1 && neighbours(molecule, entry.atom).length === 1 && molecule.atoms[entry.atom]!.hydrogens === 1);
      if (oxo.length === 2 && hydroxy.length === 1 && around.length === 4) {
        [...oxo, ...hydroxy].forEach((entry) => hidden.add(entry.atom));
        labels.set(atom.index, "SO_3H");
      }
    }
  }
  return { hidden, labels };
}

/* ------------------------------------------------------------------------- */
/* Rings                                                                     */
/* ------------------------------------------------------------------------- */

/** Simple cycles of size 3..8 kept greedily by size so each adds a new bond (an SSSR stand-in). */
function perceiveRings(molecule: Molecule, visible: (atom: number) => boolean): number[][] {
  const adjacency = new Map<number, number[]>();
  for (const atom of molecule.atoms) {
    if (!visible(atom.index)) continue;
    adjacency.set(atom.index, neighbours(molecule, atom.index).map((entry) => entry.atom).filter(visible));
  }
  const cycles: number[][] = [];
  const seen = new Set<string>();
  const dfs = (start: number, current: number, path: number[]): void => {
    if (path.length > 8) return;
    for (const next of adjacency.get(current) ?? []) {
      if (next === start && path.length >= 3) {
        const key = [...path].sort((a, b) => a - b).join(",");
        if (!seen.has(key)) { seen.add(key); cycles.push([...path]); }
        continue;
      }
      if (next < start || path.includes(next)) continue;
      dfs(start, next, [...path, next]);
    }
  };
  for (const start of adjacency.keys()) dfs(start, start, [start]);
  cycles.sort((a, b) => a.length - b.length);
  const covered = new Set<string>();
  const kept: number[][] = [];
  for (const cycle of cycles) {
    const edges = cycle.map((atom, index) => edgeKey(atom, cycle[(index + 1) % cycle.length]!));
    if (edges.every((edge) => covered.has(edge))) continue;
    edges.forEach((edge) => covered.add(edge));
    kept.push(cycle);
  }
  return kept;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/* ------------------------------------------------------------------------- */
/* Layout                                                                    */
/* ------------------------------------------------------------------------- */

export function layoutMolecule(molecule: Molecule): LaidOutMolecule | null {
  const { hidden, labels } = collapsedGroups(molecule);
  const visible = (atom: number): boolean => !hidden.has(atom);
  const n = molecule.atoms.length;
  const positions: Array<Vec2 | null> = Array(n).fill(null);
  const rings = perceiveRings(molecule, visible);
  const ringsOf = new Map<number, number[][]>();
  for (const ring of rings) for (const atom of ring) ringsOf.set(atom, [...(ringsOf.get(atom) ?? []), ring]);
  const placed = (): Vec2[] => positions.filter((p): p is Vec2 => p !== null);
  const tooClose = (at: Vec2, ignore: number[] = []): number => {
    let best = Infinity;
    positions.forEach((p, index) => { if (p && !ignore.includes(index)) best = Math.min(best, dist(at, p)); });
    return best;
  };

  // Ring systems first: place one ring as a regular polygon, then every ring
  // that shares an edge with a placed ring on the far side of that edge.
  const ringPlaced = new Set<number[]>();
  const placeRing = (ring: number[], center: Vec2, first: number, direction: 1 | -1): void => {
    const size = ring.length;
    const step = (360 / size) * direction;
    const startIndex = ring.indexOf(first);
    const base = sub(positions[first]!, center);
    for (let k = 1; k < size; k += 1) {
      const atom = ring[(startIndex + k) % size]!;
      if (positions[atom]) continue;
      positions[atom] = add(center, rotate(base, step * k));
    }
    ringPlaced.add(ring);
  };
  const circumradius = (size: number): number => 1 / (2 * Math.sin(Math.PI / size));
  const apothem = (size: number): number => 1 / (2 * Math.tan(Math.PI / size));
  let progress = true;
  while (progress) {
    progress = false;
    for (const ring of rings) {
      if (ringPlaced.has(ring)) continue;
      const placedAtoms = ring.filter((atom) => positions[atom]);
      if (placedAtoms.length === 0) {
        if (ringPlaced.size > 0) continue;
        const radius = circumradius(ring.length);
        const center = { x: 0, y: 0 };
        // Vertex 0 at the top so a substituent at position 1 points straight
        // up; a four-ring starts at 45° so cyclobutane is a square.
        positions[ring[0]!] = ring.length === 4 ? { x: -radius * Math.SQRT1_2, y: radius * Math.SQRT1_2 } : { x: 0, y: radius };
        placeRing(ring, center, ring[0]!, -1);
        progress = true;
        continue;
      }
      if (placedAtoms.length !== 2) {
        if (placedAtoms.length === ring.length) { ringPlaced.add(ring); progress = true; continue; }
        return null; // spiro or bridged: not a fused system
      }
      const [p, q] = placedAtoms as [number, number];
      const ip = ring.indexOf(p);
      const iq = ring.indexOf(q);
      const adjacent = Math.abs(ip - iq) === 1 || Math.abs(ip - iq) === ring.length - 1;
      if (!adjacent) return null;
      const pp = positions[p]!;
      const pq = positions[q]!;
      const mid = scale(add(pp, pq), 0.5);
      const normal = unit({ x: -(pq.y - pp.y), y: pq.x - pp.x });
      // Away from the ring that already owns the edge.
      const owner = rings.find((other) => ringPlaced.has(other) && other.includes(p) && other.includes(q));
      const ownerCentroid = owner ? centroid(owner.map((atom) => positions[atom]!)) : { x: 0, y: 0 };
      const candidateA = add(mid, scale(normal, apothem(ring.length)));
      const candidateB = sub(mid, scale(normal, apothem(ring.length)));
      const center = dist(candidateA, ownerCentroid) > dist(candidateB, ownerCentroid) ? candidateA : candidateB;
      // Rotation direction: stepping from p must reach q.
      const base = sub(pp, center);
      const trial = add(center, rotate(base, 360 / ring.length));
      const direction: 1 | -1 = dist(trial, pq) < 0.1 ? 1 : -1;
      const startIndex = ring.indexOf(p);
      const nextIndex = (startIndex + 1) % ring.length;
      const ordered = ring[nextIndex] === q ? ring : [...ring].reverse();
      placeRing(ordered, center, p, direction);
      progress = true;
    }
  }
  if (rings.some((ring) => !ringPlaced.has(ring))) return null;

  // Chains: breadth-first from what is placed, or from a chain end.
  const heavyNeighbours = (atom: number): number[] => neighbours(molecule, atom).map((entry) => entry.atom).filter(visible);
  const subtreeSize = (from: number, via: number): number => {
    const seen = new Set<number>([via]);
    const stack = [from];
    let count = 0;
    while (stack.length) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      count += 1;
      for (const next of heavyNeighbours(current)) if (!seen.has(next)) stack.push(next);
    }
    return count;
  };
  const isLinear = (atom: number): boolean => {
    const orders = neighbours(molecule, atom).filter((entry) => visible(entry.atom)).map((entry) => entry.bond.order);
    return orders.includes(3) || orders.filter((order) => order === 2).length >= 2;
  };
  const turn = new Map<number, number>();
  const parentOf = new Map<number, number>();
  const queue: number[] = [];
  if (placed().length === 0) {
    const start = chainEnd(molecule, visible);
    if (start === null) return null;
    positions[start] = { x: 0, y: 0 };
    turn.set(start, 1);
    queue.push(start);
  } else {
    for (const ring of rings) for (const atom of ring) if (!queue.includes(atom)) queue.push(atom);
  }
  const directionFrom = (atom: number): Vec2 => {
    const inRings = ringsOf.get(atom);
    if (inRings && inRings.length > 0) {
      const center = centroid(inRings.flatMap((ring) => ring.map((member) => positions[member]!)));
      return unit(sub(positions[atom]!, center));
    }
    const parent = parentOf.get(atom);
    if (parent !== undefined) return unit(sub(positions[atom]!, positions[parent]!));
    return rotate({ x: 1, y: 0 }, -30);
  };
  while (queue.length) {
    const atom = queue.shift()!;
    const at = positions[atom]!;
    const children = heavyNeighbours(atom).filter((next) => !positions[next]);
    if (children.length === 0) continue;
    children.sort((a, b) => subtreeSize(b, atom) - subtreeSize(a, atom));
    const v = directionFrom(atom);
    const inRing = (ringsOf.get(atom)?.length ?? 0) > 0;
    const hasParent = parentOf.has(atom) || inRing;
    const sign = -(turn.get(atom) ?? 1);
    let slots: Array<{ dir: Vec2; sign: number }>;
    if (isLinear(atom)) {
      slots = [{ dir: v, sign: 0 }, { dir: rotate(v, 180), sign: 0 }];
    } else if (inRing) {
      slots = children.length === 1 ? [{ dir: v, sign: 1 }] : [{ dir: rotate(v, 55), sign: 1 }, { dir: rotate(v, -55), sign: -1 }];
    } else if (!hasParent) {
      slots = children.length >= 4
        ? [{ dir: { x: 0, y: 1 }, sign: 1 }, { dir: { x: 1, y: 0 }, sign: -1 }, { dir: { x: 0, y: -1 }, sign: 1 }, { dir: { x: -1, y: 0 }, sign: -1 }]
        : children.length === 3
          ? [{ dir: rotate(v, 60), sign: 1 }, { dir: rotate(v, -60), sign: -1 }, { dir: rotate(v, 180), sign: 1 }]
          : [{ dir: rotate(v, 60), sign: 1 }, { dir: rotate(v, 180), sign: -1 }];
    } else if (children.length === 1) {
      slots = [{ dir: rotate(v, sign * 60), sign }];
    } else if (children.length === 2) {
      slots = [{ dir: rotate(v, sign * 60), sign }, { dir: rotate(v, -sign * 60), sign: -sign }];
    } else {
      slots = [{ dir: rotate(v, 90), sign: 1 }, { dir: rotate(v, -90), sign: -1 }, { dir: v, sign }];
    }
    const alternates = [60, -60, 0, 90, -90, 120, -120, 150, -150, 180].map((deg) => ({ dir: rotate(v, deg), sign: deg > 0 ? 1 : deg < 0 ? -1 : sign }));
    children.forEach((child, index) => {
      const preferred = slots[index] ?? alternates[index]!;
      const options = [preferred, ...alternates].filter((option, position, all) =>
        all.findIndex((other) => dist(other.dir, option.dir) < 1e-6) === position);
      let chosen: { dir: Vec2; sign: number } | null = null;
      let bestScore = -Infinity;
      for (const option of options) {
        const candidate = add(at, option.dir);
        const separation = tooClose(candidate, [atom]);
        if (separation >= MIN_SEPARATION) { chosen = option; break; }
        if (separation > bestScore) { bestScore = separation; chosen = option; }
      }
      positions[child] = add(at, chosen!.dir);
      parentOf.set(child, atom);
      turn.set(child, chosen!.sign === 0 ? (turn.get(atom) ?? 1) : chosen!.sign);
      queue.push(child);
    });
  }
  if (positions.some((p, index) => !p && visible(index))) return null;
  for (const index of hidden) {
    const anchor = neighbours(molecule, index).find((entry) => visible(entry.atom));
    positions[index] = anchor ? positions[anchor.atom]! : { x: 0, y: 0 };
  }
  const coordinates = positions.map((p) => p!);

  enforceStereo(molecule, coordinates, rings, visible);
  orient(molecule, coordinates, rings, visible);

  // Reject overlaps the retries could not clear.
  for (let a = 0; a < n; a += 1) {
    if (!visible(a)) continue;
    for (let b = a + 1; b < n; b += 1) {
      if (!visible(b)) continue;
      if (dist(coordinates[a]!, coordinates[b]!) < 0.5) return null;
    }
  }

  const aromaticSixRings = rings.filter((ring) => ring.length === 6 && ring.every((atom, index) => {
    const next = ring[(index + 1) % ring.length]!;
    const bond = molecule.bonds.find((entry) => (entry.a === atom && entry.b === next) || (entry.a === next && entry.b === atom));
    return bond?.aromatic === true;
  }));

  const extraLabels = aldehydeHydrogens(molecule, coordinates, visible);
  return { molecule, positions: coordinates, hidden, groupLabels: labels, rings, aromaticSixRings, extraLabels };
}

function centroid(points: Vec2[]): Vec2 {
  const sum = points.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
  return scale(sum, 1 / Math.max(1, points.length));
}

/** A leaf at the far end of the longest path, so the main chain runs as one zigzag. */
function chainEnd(molecule: Molecule, visible: (atom: number) => boolean): number | null {
  const atoms = molecule.atoms.filter((atom) => visible(atom.index)).map((atom) => atom.index);
  if (atoms.length === 0) return null;
  const farthest = (from: number): number => {
    const distance = new Map<number, number>([[from, 0]]);
    const queue = [from];
    let last = from;
    while (queue.length) {
      const current = queue.shift()!;
      last = current;
      for (const entry of neighbours(molecule, current)) {
        if (!visible(entry.atom) || distance.has(entry.atom)) continue;
        distance.set(entry.atom, distance.get(current)! + 1);
        queue.push(entry.atom);
      }
    }
    return last;
  };
  return farthest(farthest(atoms[0]!));
}

/**
 * Honour cis/trans on double bonds outside rings: from SMILES `/` `\`
 * marks, or from a name prefix recorded on the molecule. When the drawn
 * sides disagree, the subtree beyond the second carbon is reflected across
 * the double bond's line.
 */
function enforceStereo(molecule: Molecule, positions: Vec2[], rings: number[][], visible: (atom: number) => boolean): void {
  const inRing = (a: number, b: number): boolean => rings.some((ring) => ring.includes(a) && ring.includes(b));
  const requirements: Array<{ a: number; b: number; x: number; y: number; kind: "cis" | "trans" }> = [];
  for (const bond of molecule.bonds) {
    if (bond.order !== 2 || bond.aromatic || inRing(bond.a, bond.b)) continue;
    const sideA = neighbours(molecule, bond.a).filter((entry) => entry.atom !== bond.b && visible(entry.atom));
    const sideB = neighbours(molecule, bond.b).filter((entry) => entry.atom !== bond.a && visible(entry.atom));
    if (sideA.length === 0 || sideB.length === 0) continue;
    if (molecule.stereo && molecule.stereo.bond === bond.index) {
      requirements.push({ a: bond.a, b: bond.b, x: sideA[0]!.atom, y: sideB[0]!.atom, kind: molecule.stereo.kind });
      continue;
    }
    const markedA = sideA.find((entry) => entry.bond.direction);
    const markedB = sideB.find((entry) => entry.bond.direction);
    if (!markedA || !markedB) continue;
    // A mark reads from bond.a to bond.b: "/" puts b above a in the writing frame.
    const sideOf = (entry: { atom: number; bond: { a: number; b: number; direction?: "/" | "\\" } }, centre: number): number => {
      const up = entry.bond.direction === "/" ? 1 : -1;
      // Substituent written before the alkene carbon: the mark says where the carbon sits relative to it.
      return entry.bond.b === centre ? -up : up;
    };
    const sx = sideOf(markedA, bond.a);
    const sy = sideOf(markedB, bond.b);
    requirements.push({ a: bond.a, b: bond.b, x: markedA.atom, y: markedB.atom, kind: sx === sy ? "cis" : "trans" });
  }
  for (const requirement of requirements) {
    const pa = positions[requirement.a]!;
    const pb = positions[requirement.b]!;
    const axis = sub(pb, pa);
    const side = (atom: number): number => Math.sign(cross(axis, sub(positions[atom]!, pa)));
    const same = side(requirement.x) === side(requirement.y);
    const wanted = requirement.kind === "cis";
    if (same === wanted) continue;
    // Reflect everything reachable from b without crossing a.
    const seen = new Set<number>([requirement.a]);
    const stack = [requirement.b];
    while (stack.length) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const entry of neighbours(molecule, current)) if (!seen.has(entry.atom)) stack.push(entry.atom);
    }
    seen.delete(requirement.a);
    seen.delete(requirement.b);
    const dir = unit(axis);
    for (const atom of seen) {
      const rel = sub(positions[atom]!, pa);
      const along = rel.x * dir.x + rel.y * dir.y;
      const perp = cross(dir, rel);
      positions[atom] = add(pa, add(scale(dir, along), scale({ x: -dir.y, y: dir.x }, -perp)));
    }
  }
}

function rotateAll(positions: Vec2[], degrees: number): void {
  for (let i = 0; i < positions.length; i += 1) positions[i] = rotate(positions[i]!, degrees);
}

function flipY(positions: Vec2[]): void {
  for (let i = 0; i < positions.length; i += 1) positions[i] = { x: positions[i]!.x, y: -positions[i]!.y };
}

/**
 * Turn the whole drawing the way a textbook does: a fused ring system with
 * its shared edge vertical (rings side by side), an acyclic alkene with its
 * one C=C horizontal and, for a cis pair, both substituents above the bond.
 */
function orient(molecule: Molecule, positions: Vec2[], rings: number[][], visible: (atom: number) => boolean): void {
  for (let i = 0; i < rings.length; i += 1) {
    for (let j = i + 1; j < rings.length; j += 1) {
      const shared = rings[i]!.filter((atom) => rings[j]!.includes(atom));
      if (shared.length !== 2) continue;
      const [p, q] = shared as [number, number];
      const edge = sub(positions[q]!, positions[p]!);
      const angle = Math.atan2(edge.y, edge.x) / DEG;
      rotateAll(positions, 90 - angle);
      return;
    }
  }
  if (rings.length > 0) return;
  const alkenes = molecule.bonds.filter((bond) => bond.order === 2 && !bond.aromatic
    && molecule.atoms[bond.a]!.element === "C" && molecule.atoms[bond.b]!.element === "C");
  if (alkenes.length !== 1) return;
  const bond = alkenes[0]!;
  const subA = neighbours(molecule, bond.a).filter((entry) => entry.atom !== bond.b && visible(entry.atom));
  const subB = neighbours(molecule, bond.b).filter((entry) => entry.atom !== bond.a && visible(entry.atom));
  if (subA.length === 0 || subB.length === 0) return;
  const axis = sub(positions[bond.b]!, positions[bond.a]!);
  rotateAll(positions, -Math.atan2(axis.y, axis.x) / DEG);
  const above = (atom: number): boolean => positions[atom]!.y > positions[bond.a]!.y + 1e-6;
  const upCount = [...subA, ...subB].filter((entry) => above(entry.atom)).length;
  const downCount = subA.length + subB.length - upCount;
  if (downCount > upCount || (downCount === upCount && !above(subA[0]!.atom))) flipY(positions);
}

/** An H label on every aldehyde carbon (C with =O, one other heavy neighbour, one hydrogen). */
function aldehydeHydrogens(molecule: Molecule, positions: Vec2[], visible: (atom: number) => boolean): ExtraLabel[] {
  const labels: ExtraLabel[] = [];
  for (const atom of molecule.atoms) {
    if (atom.element !== "C" || atom.hydrogens !== 1 || !visible(atom.index)) continue;
    const around = neighbours(molecule, atom.index).filter((entry) => visible(entry.atom));
    const oxo = around.find((entry) => entry.bond.order === 2 && molecule.atoms[entry.atom]!.element === "O");
    if (!oxo || around.length !== 2) continue;
    const at = positions[atom.index]!;
    const used = around.map((entry) => unit(sub(positions[entry.atom]!, at)));
    const free = unit(scale(add(used[0]!, used[1]!), -1));
    labels.push({ atom: atom.index, text: "H", at: add(at, scale(free, 0.75)) });
  }
  return labels;
}

/** Axis-aligned bounds of the visible atoms, padded for labels. */
export function layoutBounds(laid: LaidOutMolecule, padding = 0.45): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  laid.positions.forEach((p, index) => {
    if (laid.hidden.has(index)) return;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  });
  for (const extra of laid.extraLabels) {
    minX = Math.min(minX, extra.at.x); maxX = Math.max(maxX, extra.at.x); minY = Math.min(minY, extra.at.y); maxY = Math.max(maxY, extra.at.y);
  }
  return { minX: minX - padding, maxX: maxX + padding, minY: minY - padding, maxY: maxY + padding };
}
