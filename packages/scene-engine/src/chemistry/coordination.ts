/**
 * Coordination compounds: the geometry of a complex and its stereoisomers.
 *
 * The stem's complex is read with `parseComplex`. Geometry follows the JEE
 * rules: CN 6 octahedral; CN 4 square planar for the d8 ions Pt(II), Pd(II),
 * Au(III), Rh(I), Ir(I), for Ni(II) with a strong field ligand (CN, dmg) and
 * for Cu(II) with NH3 or en, else tetrahedral; CN 2 linear.
 *
 * Isomers are not tabulated. Every placement of the ligands on the
 * polyhedron is enumerated and sorted into orbits of the point group: an
 * orbit under the full group (rotations and reflections) is one geometrical
 * isomer, and it is chiral when that orbit splits in two under the proper
 * rotations alone. A bidentate ligand may only span two cis sites, so the
 * same enumeration gives [M(AA)3] its single chiral form and [M(AA)2B2] its
 * cis (chiral) and trans (achiral) forms. Delta and Lambda for a chiral
 * isomer with two or more chelate rings follow the IUPAC skew line rule on
 * the 3D site vectors.
 *
 * Drawing: an octahedron is projected with four in plane bonds (left, right,
 * up, down), a wedge to the front and a dash to the back. Ligand symbols sit
 * just beyond the bond ends, a chelate is a curved bridge between its donor
 * atoms with the ligand name beside it, and every label is pinned so the
 * figure is never refused for a label the solver could not place.
 */
import type { SceneDocument } from "../types";
import { ChemScene, type ChemPlanQuantity, type Vec2 } from "./sceneKit";
import { complexTokens, normalizeChemistryText, parseComplex, type LigandSpec, type ParsedComplex } from "./formula";

export const COORD_FAMILY = "chem_coordination" as const;

export type CoordGeometry = "octahedral" | "square planar" | "tetrahedral" | "linear";

export interface CoordLigand {
  /** Board label of the ligand (NH_3, Cl, en, ox). */
  label: string;
  name: string;
  count: number;
  denticity: number;
}

export interface CoordIsomer {
  /** Name drawn under the figure: cis, trans, fac, mer, all cis, "trans, cis"... Empty when only one form exists. */
  name: string;
  /** True when this geometrical isomer is chiral, so it exists as a pair of optical isomers. */
  optical: boolean;
  /** Delta or Lambda of the drawn representative when two or more chelate rings define it. */
  helicity: "Δ" | "Λ" | null;
  /** The site placement drawn for this isomer. */
  arrangement: Arrangement;
}

export interface CoordIsomerResult {
  complex: ParsedComplex;
  /** The formula as a student writes it: [Co(NH3)4Cl2]+ */
  formula: string;
  geometry: CoordGeometry;
  coordinationNumber: number;
  oxidationState: number;
  ligands: CoordLigand[];
  /** Every geometrical isomer, cis before trans and fac before mer. */
  geometrical: CoordIsomer[];
  geometricalCount: number;
  /** True when at least one geometrical isomer is chiral. */
  opticalIsomers: boolean;
  /** Geometrical isomers counted once, chiral ones twice. */
  stereoisomerCount: number;
}

/* ------------------------------------------------------------------------- */
/* Site sets and point groups                                                */
/* ------------------------------------------------------------------------- */

type Vec3 = [number, number, number];
type Perm = number[];

interface SiteSet {
  count: number;
  vectors: Vec3[];
  adjacent: boolean[][];
  rotations: Perm[];
  full: Perm[];
  /** One improper operation, used to build the mirror image of a placement. */
  mirror: Perm;
}

function permutationParity(perm: Perm): number {
  let swaps = 0;
  for (let i = 0; i < perm.length; i += 1) for (let j = i + 1; j < perm.length; j += 1) if (perm[i]! > perm[j]!) swaps += 1;
  return swaps % 2 === 0 ? 1 : -1;
}

function allPermutations(n: number): Perm[] {
  const out: Perm[] = [];
  const rec = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) { out.push(prefix); return; }
    rest.forEach((value, index) => rec([...prefix, value], [...rest.slice(0, index), ...rest.slice(index + 1)]));
  };
  rec([], Array.from({ length: n }, (_, i) => i));
  return out;
}

/** Octahedral sites: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z. Opposite sites are i and i^1. */
function octahedralSites(): SiteSet {
  const vectors: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const indexOf = (v: Vec3): number => vectors.findIndex((w) => w[0] === v[0] && w[1] === v[1] && w[2] === v[2]);
  const rotations: Perm[] = [];
  const full: Perm[] = [];
  for (const axes of allPermutations(3)) {
    for (let bits = 0; bits < 8; bits += 1) {
      const sign = [bits & 1 ? -1 : 1, bits & 2 ? -1 : 1, bits & 4 ? -1 : 1];
      const det = permutationParity(axes) * sign[0]! * sign[1]! * sign[2]!;
      const perm = vectors.map((v) => indexOf([sign[0]! * v[axes[0]!]!, sign[1]! * v[axes[1]!]!, sign[2]! * v[axes[2]!]!]));
      full.push(perm);
      if (det > 0) rotations.push(perm);
    }
  }
  const adjacent = vectors.map((_, i) => vectors.map((__, j) => i !== j && (i ^ 1) !== j));
  return { count: 6, vectors, adjacent, rotations, full, mirror: [1, 0, 2, 3, 4, 5] };
}

/** Square planar sites in cyclic order: 0 +x, 1 +y, 2 -x, 3 -y. The plane is a mirror, so nothing is chiral. */
function squarePlanarSites(): SiteSet {
  const vectors: Vec3[] = [[1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0]];
  const group: Perm[] = [];
  for (let k = 0; k < 4; k += 1) {
    group.push([0, 1, 2, 3].map((i) => (i + k) % 4));
    group.push([0, 1, 2, 3].map((i) => (k - i + 4) % 4));
  }
  const adjacent = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => j === (i + 1) % 4 || j === (i + 3) % 4));
  return { count: 4, vectors, adjacent, rotations: group, full: group, mirror: [0, 3, 2, 1] };
}

function tetrahedralSites(): SiteSet {
  const vectors: Vec3[] = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
  const full = allPermutations(4);
  const rotations = full.filter((perm) => permutationParity(perm) > 0);
  const adjacent = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => i !== j));
  return { count: 4, vectors, adjacent, rotations, full, mirror: [1, 0, 2, 3] };
}

function linearSites(): SiteSet {
  const group: Perm[] = [[0, 1], [1, 0]];
  return { count: 2, vectors: [[1, 0, 0], [-1, 0, 0]], adjacent: [[false, false], [false, false]], rotations: group, full: group, mirror: [1, 0] };
}

/* ------------------------------------------------------------------------- */
/* Ligand placements                                                         */
/* ------------------------------------------------------------------------- */

interface LigandInstance {
  spec: LigandSpec;
  /** Symmetry key per donor site: "NH3" for a monodentate, "en:N" twice for en, "gly:N" and "gly:O" for glycinate. */
  donorKeys: string[];
  /** Symbol drawn at each donor site: NH_3, Cl, or the donor atom N or O of a chelate. */
  donorLabels: string[];
}

export interface Arrangement {
  /** Symmetry key of the ligand on each site. */
  keys: string[];
  /** Ligand instance index on each site. */
  instanceAt: number[];
  /** Donor index (0 or 1) within the instance on each site. */
  donorAt: number[];
  /** Chelate site pairs, each sorted. */
  pairs: Array<[number, number]>;
}

const DONOR_ATOMS: Record<string, [string, string]> = {
  en: ["N", "N"], C2O4: ["O", "O"], acac: ["O", "O"], gly: ["N", "O"], bipy: ["N", "N"], phen: ["N", "N"], dmg: ["N", "N"],
};

/** NH3 to NH_3 for the board: a digit run after a letter is a subscript. */
function boardLabel(label: string): string {
  return label.replace(/([A-Za-z])(\d+)/g, "$1_$2");
}

function ligandInstances(complex: ParsedComplex): LigandInstance[] | null {
  const instances: LigandInstance[] = [];
  for (const ligand of complex.ligands) {
    const spec = ligand.spec;
    if (spec.denticity > 2) return null;
    for (let i = 0; i < ligand.count; i += 1) {
      if (spec.denticity === 2) {
        const donors = DONOR_ATOMS[spec.key];
        if (!donors) return null;
        instances.push({ spec, donorKeys: donors.map((atom) => `${spec.key}:${atom}`), donorLabels: [...donors] });
      } else {
        instances.push({ spec, donorKeys: [spec.key], donorLabels: [boardLabel(spec.label)] });
      }
    }
  }
  return instances;
}

function arrangementKey(keys: readonly string[], pairs: ReadonlyArray<readonly [number, number]>): string {
  return `${keys.join(",")}|${pairs.map((pair) => `${pair[0]}-${pair[1]}`).sort().join(";")}`;
}

function applyPerm(perm: Perm, arrangement: Arrangement): Arrangement {
  const n = perm.length;
  const keys = new Array<string>(n);
  const instanceAt = new Array<number>(n);
  const donorAt = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    keys[perm[i]!] = arrangement.keys[i]!;
    instanceAt[perm[i]!] = arrangement.instanceAt[i]!;
    donorAt[perm[i]!] = arrangement.donorAt[i]!;
  }
  const pairs = arrangement.pairs.map(([a, b]) => {
    const pa = perm[a]!;
    const pb = perm[b]!;
    return (pa < pb ? [pa, pb] : [pb, pa]) as [number, number];
  });
  return { keys, instanceAt, donorAt, pairs };
}

function canonicalKey(arrangement: Arrangement, group: readonly Perm[]): string {
  let best: string | null = null;
  for (const perm of group) {
    const moved = applyPerm(perm, arrangement);
    const key = arrangementKey(moved.keys, moved.pairs);
    if (best === null || key < best) best = key;
  }
  return best ?? "";
}

/** Every distinct placement of the ligand instances on the sites (chelates on cis pairs only). */
function enumerateArrangements(instances: LigandInstance[], sites: SiteSet): Arrangement[] {
  const found = new Map<string, Arrangement>();
  const keys = new Array<string | null>(sites.count).fill(null);
  const instanceAt = new Array<number>(sites.count).fill(-1);
  const donorAt = new Array<number>(sites.count).fill(-1);
  const pairs: Array<[number, number]> = [];
  const commit = () => {
    const snapshot: Arrangement = {
      keys: keys.map((key) => key ?? ""),
      instanceAt: [...instanceAt],
      donorAt: [...donorAt],
      pairs: pairs.map((pair) => [...pair] as [number, number]),
    };
    found.set(arrangementKey(snapshot.keys, snapshot.pairs), snapshot);
  };
  const place = (index: number) => {
    if (index === instances.length) { commit(); return; }
    const instance = instances[index]!;
    if (instance.donorKeys.length === 1) {
      for (let s = 0; s < sites.count; s += 1) {
        if (keys[s] !== null) continue;
        keys[s] = instance.donorKeys[0]!; instanceAt[s] = index; donorAt[s] = 0;
        place(index + 1);
        keys[s] = null; instanceAt[s] = -1; donorAt[s] = -1;
      }
      return;
    }
    for (let a = 0; a < sites.count; a += 1) {
      if (keys[a] !== null) continue;
      for (let b = 0; b < sites.count; b += 1) {
        if (a === b || keys[b] !== null || !sites.adjacent[a]![b]) continue;
        keys[a] = instance.donorKeys[0]!; keys[b] = instance.donorKeys[1]!;
        instanceAt[a] = index; instanceAt[b] = index; donorAt[a] = 0; donorAt[b] = 1;
        pairs.push(a < b ? [a, b] : [b, a]);
        place(index + 1);
        pairs.pop();
        keys[a] = null; keys[b] = null; instanceAt[a] = -1; instanceAt[b] = -1; donorAt[a] = -1; donorAt[b] = -1;
      }
    }
  };
  place(0);
  return [...found.values()];
}

/* ------------------------------------------------------------------------- */
/* Geometry, names, helicity                                                 */
/* ------------------------------------------------------------------------- */

const SQUARE_PLANAR_METALS = new Map<string, number[]>([["Pt", [2]], ["Pd", [2]], ["Au", [3]], ["Rh", [1]], ["Ir", [1]]]);

function geometryOf(complex: ParsedComplex): CoordGeometry | null {
  const cn = complex.coordinationNumber;
  if (cn === 6) return "octahedral";
  if (cn === 2) return "linear";
  if (cn !== 4) return null;
  const metal = complex.metal.symbol;
  const ox = complex.oxidationState;
  const keys = complex.ligands.map((ligand) => ligand.spec.key);
  if ((SQUARE_PLANAR_METALS.get(metal) ?? []).includes(ox)) return "square planar";
  if (metal === "Ni" && ox === 2 && keys.every((key) => key === "CN" || key === "dmg")) return "square planar";
  if (metal === "Cu" && ox === 2 && keys.every((key) => key === "NH3" || key === "en")) return "square planar";
  return "tetrahedral";
}

function sitesFor(geometry: CoordGeometry): SiteSet {
  switch (geometry) {
    case "octahedral": return octahedralSites();
    case "square planar": return squarePlanarSites();
    case "tetrahedral": return tetrahedralSites();
    case "linear": return linearSites();
  }
}

function isOpposite(sites: SiteSet, a: number, b: number): boolean {
  return a !== b && !sites.adjacent[a]![b];
}

/**
 * cis/trans for a ligand present twice, fac/mer for one present three times.
 * Only monodentate ligands and unsymmetric donors carry a descriptor; the
 * four donor sites of two en ligands say nothing the other pair does not.
 */
function descriptors(arrangement: Arrangement, sites: SiteSet, instances: LigandInstance[]): Array<{ label: string; word: string; sites: number }> {
  const out: Array<{ label: string; word: string; sites: number }> = [];
  const singles: Array<{ label: string; site: number }> = [];
  const seen = new Set<string>();
  // Ligand types in the order the formula writes them, so "cis, trans" of
  // [Co(en)(NH3)2Cl2]+ always reads NH3 then Cl whichever sites they hold.
  const orderedKeys = instances.flatMap((instance) => instance.donorKeys).filter((key, index, all) => all.indexOf(key) === index);
  for (const key of orderedKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const at = arrangement.keys.flatMap((k, site) => (k === key ? [site] : []));
    if (at.length === 0) continue;
    const instance = instances[arrangement.instanceAt[at[0]!]!]!;
    const chelate = instance.donorKeys.length === 2;
    const label = chelate ? instance.donorLabels[arrangement.donorAt[at[0]!]!]! : instance.spec.label;
    if (at.length === 1) {
      singles.push({ label, site: at[0]! });
    } else if (at.length === 2) {
      // The two donors of one chelate are cis by construction: no descriptor.
      if (!chelate) out.push({ label, word: isOpposite(sites, at[0]!, at[1]!) ? "trans" : "cis", sites: 2 });
    } else if (at.length === 3) {
      const anyTrans = at.some((a, i) => at.slice(i + 1).some((b) => isOpposite(sites, a, b)));
      out.push({ label, word: anyTrans ? "mer" : "fac", sites: 3 });
    }
  }
  // Two descriptors that between them fill every site say the same thing
  // twice (fac NH3 is fac Cl in [Co(NH3)3Cl3]): keep the first.
  if (out.length === 2 && out[0]!.sites + out[1]!.sites === sites.count) out.pop();
  // Two lone ligands are cis or trans to each other ([Co(NH3)4ClBr]+).
  if (out.length === 0 && singles.length === 2) {
    out.push({ label: singles[1]!.label, word: isOpposite(sites, singles[0]!.site, singles[1]!.site) ? "trans" : "cis", sites: 2 });
  } else if (out.length === 0 && singles.length >= 3) {
    // [Pt(NH3)(py)ClBr]: name by what lies opposite the first ligand.
    const first = singles[0]!;
    const partner = singles.find((single) => isOpposite(sites, first.site, single.site));
    if (partner) out.push({ label: first.label, word: `${first.label} trans ${partner.label}`, sites: 2 });
  }
  return out;
}

function isomerName(words: Array<{ label: string; word: string; sites: number }>): string {
  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!.word;
  const distinct = new Set(words.map((entry) => entry.word));
  if (distinct.size === 1) return `all ${words[0]!.word}`;
  const joined = words.map((entry) => entry.word).join(", ");
  return joined.length <= 16 ? joined : words.map((entry) => entry.word.slice(0, 3)).join(",");
}

const NAME_ORDER = ["cis", "trans", "fac", "mer"];

function nameRank(name: string): number {
  const index = NAME_ORDER.indexOf(name);
  return index >= 0 ? index : 10;
}

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

/**
 * IUPAC skew line rule. Two chelate edges are skew lines; one is the axis
 * of a helix and the other a tangent to it. A right handed helix is Δ, a
 * left handed one Λ. Every pair of rings in a tris chelate agrees, so the
 * first skew pair decides.
 */
function helicity(arrangement: Arrangement, sites: SiteSet): "Δ" | "Λ" | null {
  const edges = arrangement.pairs.map(([a, b]) => ({ p: sites.vectors[a]!, q: sites.vectors[b]! }));
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const A = edges[i]!;
      const B = edges[j]!;
      const dA = sub(A.q, A.p);
      const dB = sub(B.q, B.p);
      const n = cross(dA, dB);
      const nn = dot(n, n);
      if (nn < 1e-9) continue;
      const mA: Vec3 = [(A.p[0] + A.q[0]) / 2, (A.p[1] + A.q[1]) / 2, (A.p[2] + A.q[2]) / 2];
      const mB: Vec3 = [(B.p[0] + B.q[0]) / 2, (B.p[1] + B.q[1]) / 2, (B.p[2] + B.q[2]) / 2];
      const along = dot(sub(mB, mA), n) / Math.sqrt(nn);
      if (Math.abs(along) < 1e-9) continue;
      const r: Vec3 = [n[0] * along, n[1] * along, n[2] * along];
      const circumferential = cross(dA, r);
      const sign = dot(dB, dA) * dot(dB, circumferential);
      if (Math.abs(sign) < 1e-9) continue;
      return sign > 0 ? "Δ" : "Λ";
    }
  }
  return null;
}

/* ------------------------------------------------------------------------- */
/* Drawing layouts                                                           */
/* ------------------------------------------------------------------------- */

type BondStyle = "plain" | "wedge" | "dash";

interface SiteLayout { at: Vec2; style: BondStyle }

const OCTAHEDRAL_LAYOUT: SiteLayout[] = [
  { at: { x: 1, y: 0 }, style: "plain" },
  { at: { x: -1, y: 0 }, style: "plain" },
  { at: { x: 0, y: 1 }, style: "plain" },
  { at: { x: 0, y: -1 }, style: "plain" },
  { at: { x: 0.62, y: -0.58 }, style: "wedge" },
  { at: { x: -0.62, y: 0.58 }, style: "dash" },
];
const SQUARE_LAYOUT: SiteLayout[] = [
  { at: { x: 1, y: 0 }, style: "plain" },
  { at: { x: 0, y: 1 }, style: "plain" },
  { at: { x: -1, y: 0 }, style: "plain" },
  { at: { x: 0, y: -1 }, style: "plain" },
];
// A lone figure is fitted to the 555 px tall zone with only 64 px of slack
// for labels, so a short figure has its top label pushed out of view. The
// tetrahedron is drawn on longer bonds and the linear complex on a long
// stick so the label overhang stays under that slack at any fit.
const TETRAHEDRAL_LAYOUT: SiteLayout[] = [
  { at: { x: 0, y: 1.3 }, style: "plain" },
  { at: { x: -1.13, y: -0.65 }, style: "plain" },
  { at: { x: 0.75, y: -0.72 }, style: "wedge" },
  { at: { x: 1.25, y: -0.25 }, style: "dash" },
];
const LINEAR_LAYOUT: SiteLayout[] = [
  { at: { x: 2.5, y: 0 }, style: "plain" },
  { at: { x: -2.5, y: 0 }, style: "plain" },
];

function layoutFor(geometry: CoordGeometry): SiteLayout[] {
  switch (geometry) {
    case "octahedral": return OCTAHEDRAL_LAYOUT;
    case "square planar": return SQUARE_LAYOUT;
    case "tetrahedral": return TETRAHEDRAL_LAYOUT;
    case "linear": return LINEAR_LAYOUT;
  }
}

const LABEL_GAP = 0.16;
/** A wedge widens towards its ligand, so that symbol sits a little further out. */
const DEPTH_LABEL_GAP = 0.28;
const BRIDGE_BULGE = 0.42;
const BRIDGE_LABEL_GAP = 0.24;

function norm(v: Vec2): Vec2 {
  const length = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / length, y: v.y / length };
}

/**
 * Where a ligand symbol sits: just beyond the bond end, further for a wedge
 * (which widens towards it) and further along a horizontal bond for a wide
 * symbol such as NH_3 or PPh_3, whose half width would otherwise reach back
 * onto the bond.
 */
function labelPosition(site: SiteLayout, text = ""): Vec2 {
  const dir = norm(site.at);
  const base = site.style === "plain" ? LABEL_GAP : DEPTH_LABEL_GAP;
  const gap = base + 0.06 * Math.max(0, glyphWidth(text) - 1) * Math.abs(dir.x);
  return { x: site.at.x + dir.x * gap, y: site.at.y + dir.y * gap };
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const orient = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function bridgePoints(a: Vec2, b: Vec2): Vec2[] {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const out = norm(mid);
  const control = { x: mid.x + out.x * 2 * BRIDGE_BULGE, y: mid.y + out.y * 2 * BRIDGE_BULGE };
  const points: Vec2[] = [];
  for (let step = 0; step <= 6; step += 1) {
    const t = 0.14 + (0.72 * step) / 6;
    const u = 1 - t;
    points.push({ x: u * u * a.x + 2 * u * t * control.x + t * t * b.x, y: u * u * a.y + 2 * u * t * control.y + t * t * b.y });
  }
  return points;
}

/** How cluttered a placement draws: bridges crossing bonds, chelates on the wedge or dash, minor ligands off the axes. */
function drawingCost(arrangement: Arrangement, layout: SiteLayout[], instances: LigandInstance[]): number {
  let cost = 0;
  const origin = { x: 0, y: 0 };
  for (const [a, b] of arrangement.pairs) {
    const points = bridgePoints(labelPosition(layout[a]!), labelPosition(layout[b]!));
    for (let s = 0; s < layout.length; s += 1) {
      if (s === a || s === b) continue;
      for (let i = 0; i + 1 < points.length; i += 1) {
        if (segmentsCross(points[i]!, points[i + 1]!, origin, layout[s]!.at)) cost += 10;
      }
    }
    if (layout[a]!.style !== "plain") cost += 2;
    if (layout[b]!.style !== "plain") cost += 2;
  }
  const counts = new Map<string, number>();
  for (const key of arrangement.keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  const minority = Math.min(...counts.values());
  arrangement.keys.forEach((key, site) => {
    if (counts.get(key) === minority && instances[arrangement.instanceAt[site]!]!.donorKeys.length === 1) {
      cost += layout[site]!.style === "plain" ? (layout[site]!.at.x === 0 ? 0 : 1) : 3;
    }
  });
  return cost;
}

/* ------------------------------------------------------------------------- */
/* The solver                                                                */
/* ------------------------------------------------------------------------- */

const ROMAN = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

export function oxidationRoman(ox: number): string {
  if (ox >= 0 && ox < ROMAN.length) return ROMAN[ox]!;
  return String(ox);
}

/** [Co(NH3)4Cl2]^(+) back to the way a student writes it. */
export function plainFormula(text: string): string {
  return text.replace(/\^\((\d*[+-])\)/g, "$1").replace(/\^(\d*[+-])/g, "$1");
}

/**
 * Oxidation states each metal shows in a JEE complex. A formula whose charge
 * the stem (or the OCR) dropped parses as a neutral entity with a metal state
 * no textbook lists, and would otherwise draw the wrong geometry: [Ni(CN)4]
 * without its 2- reads as Ni(IV) and would come out tetrahedral.
 */
const PLAUSIBLE_OXIDATION: Record<string, readonly number[]> = {
  Sc: [3], Ti: [2, 3, 4], V: [2, 3, 4, 5], Cr: [0, 2, 3, 6], Mn: [0, 2, 3, 4, 6, 7], Fe: [-2, 0, 2, 3], Co: [-1, 0, 2, 3],
  Ni: [0, 2], Cu: [1, 2], Zn: [2], Ag: [1], Au: [1, 3], Pt: [2, 4], Pd: [2], Rh: [1, 3], Ir: [1, 3], Ru: [2, 3], Os: [2, 3, 4],
  Cd: [2], Hg: [2], Mo: [0, 6], W: [0, 6], Y: [3], Zr: [4], Nb: [5], Ta: [5], Hf: [4], La: [3], Ce: [3, 4],
  Al: [3], Mg: [2], Ca: [2], Be: [2], Sn: [2, 4], Pb: [2, 4], B: [3], Si: [4],
};
/** Ligands that hold a metal in oxidation state zero or below. */
const PI_ACCEPTORS = new Set(["CO", "PPh3", "NO"]);

function plausible(complex: ParsedComplex): boolean {
  if (complex.ligands.length === 0) return false;
  if (complex.ligands.some((ligand) => ligand.spec.denticity > 2)) return false;
  const ox = complex.oxidationState;
  const allowed = PLAUSIBLE_OXIDATION[complex.metal.symbol] ?? [2, 3];
  if (!allowed.includes(ox)) return false;
  if (ox <= 0 && !complex.ligands.every((ligand) => PI_ACCEPTORS.has(ligand.spec.key))) return false;
  return true;
}

/**
 * The geometry and stereoisomer set of one complex, or null when the text
 * is not a plausible complex this family can place (an unreadable ligand,
 * an EDTA wrap, coordination number 5, an oxidation state no metal has).
 */
export function coordinationIsomers(complexText: string): CoordIsomerResult | null {
  const complex = parseComplex(complexText);
  if (!complex || !plausible(complex)) return null;
  const geometry = geometryOf(complex);
  if (!geometry) return null;
  const instances = ligandInstances(complex);
  if (!instances) return null;
  const sites = sitesFor(geometry);
  const layout = layoutFor(geometry);
  const all = enumerateArrangements(instances, sites);
  if (all.length === 0) return null;

  const orbits = new Map<string, Arrangement[]>();
  for (const arrangement of all) {
    const key = canonicalKey(arrangement, sites.full);
    orbits.set(key, [...(orbits.get(key) ?? []), arrangement]);
  }
  const geometrical: CoordIsomer[] = [];
  for (const members of orbits.values()) {
    const representative = [...members].sort((a, b) => drawingCost(a, layout, instances) - drawingCost(b, layout, instances))[0]!;
    const mirrored = applyPerm(sites.mirror, representative);
    const optical = canonicalKey(representative, sites.rotations) !== canonicalKey(mirrored, sites.rotations);
    geometrical.push({
      name: isomerName(descriptors(representative, sites, instances)),
      optical,
      helicity: optical && geometry === "octahedral" ? helicity(representative, sites) : null,
      arrangement: representative,
    });
  }
  geometrical.sort((a, b) => nameRank(a.name) - nameRank(b.name) || a.name.localeCompare(b.name));
  if (geometrical.length === 1) geometrical[0]!.name = "";

  return {
    complex,
    formula: plainFormula(complex.text),
    geometry,
    coordinationNumber: complex.coordinationNumber,
    oxidationState: complex.oxidationState,
    ligands: complex.ligands.map((ligand) => ({
      label: boardLabel(ligand.spec.label),
      name: ligand.spec.name,
      count: ligand.count,
      denticity: ligand.spec.denticity,
    })),
    geometrical,
    geometricalCount: geometrical.length,
    opticalIsomers: geometrical.some((isomer) => isomer.optical),
    stereoisomerCount: geometrical.reduce((sum, isomer) => sum + (isomer.optical ? 2 : 1), 0),
  };
}

/* ------------------------------------------------------------------------- */
/* Stem reading                                                              */
/* ------------------------------------------------------------------------- */

const CUE = /isomer|\bcis\b|\btrans\b|\bfac\b|\bmer\b|optical|chiral|enantiomer|stereo|structure of|\bshape\b|geometr|coordination number|denticity|chelat|iupac name|ambidentate|linkage/;
const ISOMER_CUE = /isomer|\bcis\b|\btrans\b|\bfac\b|\bmer\b|optical|chiral|enantiomer|stereo/;
const OPTICAL_CUE = /optical|chiral|enantiomer|stereo|mirror|\bd and l\b|racemic|dextro|laevo/;
const VETO = /crystal field|cfse|magnetic moment|spin only|spin-only|unpaired|hybridi[sz]|\bcft\b|splitting|absorb|wavelength|colou?r/;
const PREFIX = /(cis|trans|fac|mer)\s*-?\s*$/i;

interface StemComplex {
  token: string;
  prefix: "cis" | "trans" | "fac" | "mer" | null;
  result: CoordIsomerResult;
}

/** OCR leaves spaces inside a bracket ([FeCl4 ]-, [Co(en)(NH3 )2 Cl2 ]+); a complex has none. */
function closeBrackets(text: string): string {
  return normalizeChemistryText(text).replace(/\[[^\]]*\]/g, (match) => match.replace(/\s+/g, ""));
}

function stemComplexes(question: string): StemComplex[] {
  const normalized = closeBrackets(question);
  const out: StemComplex[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  for (const token of complexTokens(normalized)) {
    const index = normalized.indexOf(token, cursor);
    if (index >= 0) cursor = index + token.length;
    // Two entities written back to back ([Co(NH3)6][Cr(CN)6]) fix each
    // other's charge; neither can be read alone, so neither is drawn.
    const before = index >= 0 ? normalized.slice(0, index) : "";
    const after = index >= 0 ? normalized.slice(index + token.length) : "";
    if (/\]\s*$/.test(before) || /^\s*\[/.test(after)) continue;
    const result = coordinationIsomers(token);
    if (!result || seen.has(result.formula)) continue;
    seen.add(result.formula);
    const prefixMatch = PREFIX.exec(before.slice(-8));
    const prefix = prefixMatch ? (prefixMatch[1]!.toLowerCase() as StemComplex["prefix"]) : null;
    out.push({ token, prefix, result });
  }
  return out;
}

/** A parseable complex plus an isomer, structure, shape or naming cue, and none of the crystal field words unless isomers are asked too. */
export function isCoordinationStem(question: string): boolean {
  const stem = normalizeChemistryText(question).toLowerCase();
  if (!CUE.test(stem)) return false;
  if (VETO.test(stem) && !/isomer/.test(stem)) return false;
  return stemComplexes(question).length > 0;
}

/* ------------------------------------------------------------------------- */
/* Figures                                                                   */
/* ------------------------------------------------------------------------- */

interface Figure {
  result: CoordIsomerResult;
  isomer: CoordIsomer;
  /** Draw the mirror image (x reflected): the enantiomer of `isomer`. */
  mirrored: boolean;
  /** Pinned under the figure. */
  name: string;
  cue: string;
}

const FIGURE_DX = 3.8;
const FIGURE_DY = 3.6;

function glyphWidth(label: string): number {
  let width = 0;
  let small = false;
  for (const ch of label) {
    if (ch === "_" || ch === "^") { small = true; continue; }
    width += small ? 0.6 : 1;
    if (!/\d/.test(ch)) small = false;
  }
  return width;
}

function drawFigure(c: ChemScene, id: string, figure: Figure, origin: Vec2): string[] {
  const start = c.scene.entities.length;
  const { result, isomer, mirrored } = figure;
  const layout = layoutFor(result.geometry);
  const instances = ligandInstances(result.complex)!;
  const arrangement = isomer.arrangement;
  const place = (p: Vec2): Vec2 => ({ x: origin.x + (mirrored ? -p.x : p.x), y: origin.y + p.y });
  const pinned: Array<{ at: Vec2; text: string }> = [];

  const metalId = `${id}_M`;
  c.atom(metalId, result.complex.metal.symbol, place({ x: 0, y: 0 }));
  pinned.push({ at: place({ x: 0, y: 0 }), text: result.complex.metal.symbol });

  const siteIds: string[] = [];
  layout.forEach((site, index) => {
    const instance = instances[arrangement.instanceAt[index]!]!;
    const label = instance.donorLabels[arrangement.donorAt[index]!]!;
    const at = place(labelPosition(site, label));
    const siteId = c.atom(`${id}_s${index}`, label, at, { role: `${instance.spec.name} ligand` });
    siteIds.push(siteId);
    pinned.push({ at, text: label });
    const role = site.style === "plain" ? "metal ligand bond" : site.style === "wedge" ? "metal ligand bond towards viewer" : "metal ligand bond away from viewer";
    c.bond(`${id}_b${index}`, metalId, place(site.at), { style: site.style, trimEnd: 0, role });
  });

  if (result.geometry === "square planar") {
    for (let i = 0; i < 4; i += 1) {
      const a = layout[i]!.at;
      const b = layout[(i + 1) % 4]!.at;
      const dir = norm({ x: b.x - a.x, y: b.y - a.y });
      const trim = 0.2;
      c.link(`${id}_sq${i}`, place({ x: a.x + dir.x * trim, y: a.y + dir.y * trim }), place({ x: b.x - dir.x * trim, y: b.y - dir.y * trim }), "square planar outline");
    }
  }

  arrangement.pairs.forEach(([a, b], index) => {
    const instance = instances[arrangement.instanceAt[a]!]!;
    const pa = labelPosition(layout[a]!);
    const pb = labelPosition(layout[b]!);
    const points = bridgePoints(pa, pb);
    const pointIds = points.map((point, k) => c.scene.helper(`${id}_br${index}_${k}`, place(point), "chelate bridge helper"));
    c.scene.polyline(`${id}_br${index}`, pointIds, `${instance.spec.name} chelate ring`);
    const apex = points[3]!;
    const out = norm({ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 });
    const labelAt = place({ x: apex.x + out.x * BRIDGE_LABEL_GAP, y: apex.y + out.y * BRIDGE_LABEL_GAP });
    const text = boardLabel(instance.spec.label);
    c.text(`${id}_bl${index}`, labelAt, text, `${instance.spec.name} ligand name`);
    pinned.push({ at: labelAt, text });
  });

  const charge = result.complex.charge;
  if (charge !== 0) {
    const magnitude = Math.abs(charge) === 1 ? "" : String(Math.abs(charge));
    const text = `${magnitude}${charge > 0 ? "+" : "-"}`;
    const top = result.geometry === "tetrahedral" ? 1.3 : result.geometry === "linear" ? 0.6 : 1.15;
    const side = result.geometry === "linear" ? 2.9 : 1.35;
    // Top right as on paper, unless a chelate label already sits there.
    const corners = [{ x: side, y: top }, { x: -side, y: top }, { x: side, y: -top }, { x: -side, y: -top }];
    const clearance = (corner: Vec2) => Math.min(...pinned.map((entry) => Math.hypot(entry.at.x - place(corner).x, entry.at.y - place(corner).y)));
    const corner = corners.find((candidate) => clearance(candidate) >= 0.5) ?? [...corners].sort((p, q) => clearance(q) - clearance(p))[0]!;
    c.text(`${id}_q`, place(corner), text, "entity charge");
  }

  if (figure.name) {
    const baseY = result.geometry === "linear" ? -0.7 : result.geometry === "tetrahedral" ? -1.35 : -1.5;
    // A chelate label on the lower front pair reaches down to the name row.
    const lowest = Math.min(...pinned.map((entry) => entry.at.y - origin.y));
    const nameY = Math.min(baseY, lowest - 0.3);
    const nameId = c.text(`${id}_n`, place({ x: 0, y: nameY }), figure.name, "isomer name");
    c.scene.labelled(nameId);
  }
  c.scene.labelled(metalId);
  return c.scene.entities.slice(start).map((entity) => entity.id);
}

/* ------------------------------------------------------------------------- */
/* Captions                                                                  */
/* ------------------------------------------------------------------------- */

function chiralWord(isomer: CoordIsomer): string {
  return isomer.helicity ? "Δ and Λ" : "d and l";
}

function isomerSummary(result: CoordIsomerResult): string {
  const names = result.geometrical.map((isomer) => isomer.name || "one form").map((name, index) => {
    const isomer = result.geometrical[index]!;
    return isomer.optical ? `${name} (chiral)` : name;
  });
  const geometricalPart = result.geometricalCount === 1
    ? "no geometrical isomers"
    : `${result.geometricalCount} geometrical isomers (${names.join("; ")})`;
  const chiral = result.geometrical.filter((isomer) => isomer.optical);
  const opticalPart = chiral.length === 0
    ? "no optical isomers"
    : result.geometricalCount === 1
      ? `chiral, 2 optical isomers (${chiralWord(chiral[0]!)}, mirror images)`
      : `${chiral.map((isomer) => isomer.name).join(" and ")} chiral (${chiralWord(chiral[0]!)})`;
  const total = result.stereoisomerCount === 1 ? "" : `; ${result.stereoisomerCount} stereoisomers in all`;
  // "cis, trans" style names list the described ligands in formula order.
  const described = result.ligands.filter((ligand) => ligand.denticity === 1 && (ligand.count === 2 || ligand.count === 3)).map((ligand) => ligand.label.replace(/_/g, ""));
  const order = names.some((name) => name.includes(",")) && described.length >= 2 ? `; each name lists ${described.join(", ")} in that order` : "";
  return `${result.formula}: ${result.geometry}, ${geometricalPart}, ${opticalPart}${total}${order}`;
}

function structureSummary(result: CoordIsomerResult, drawn: CoordIsomer | null): string {
  const metal = `${result.complex.metal.symbol}(${oxidationRoman(result.oxidationState)})`;
  const chelates = result.ligands.filter((ligand) => ligand.denticity === 2);
  const rings = chelates.reduce((sum, ligand) => sum + ligand.count, 0);
  const ringPart = rings > 0 ? `, ${rings} chelate ring${rings === 1 ? "" : "s"} (${chelates.map((ligand) => `${ligand.name} bidentate`).join(", ")})` : "";
  const isomerPart = drawn && drawn.name ? `; ${drawn.name} form drawn, ${result.geometricalCount} geometrical isomers exist` : "";
  return `${result.formula}: ${result.geometry}, CN = ${result.coordinationNumber}, ${metal}${ringPart}${isomerPart}`;
}

/* ------------------------------------------------------------------------- */
/* The builder                                                               */
/* ------------------------------------------------------------------------- */

const MAX_FIGURES = 4;

function isomerFigures(entry: StemComplex, wantOptical: boolean): Figure[] {
  const { result } = entry;
  const chosen = entry.prefix
    ? result.geometrical.filter((isomer) => isomer.name === entry.prefix || isomer.name.startsWith(`${entry.prefix} `) || isomer.name.startsWith(`${entry.prefix},`))
    : result.geometrical;
  const list = chosen.length > 0 ? chosen : result.geometrical;
  const figures: Figure[] = [];
  for (const isomer of list) {
    const showPair = isomer.optical && (wantOptical || result.geometricalCount === 1);
    if (showPair) {
      const first = isomer.helicity ?? "d";
      const second = isomer.helicity ? (isomer.helicity === "Δ" ? "Λ" : "Δ") : "l";
      const tag = (side: string) => (isomer.name ? `${isomer.name} (${side})` : side);
      figures.push({ result, isomer, mirrored: false, name: tag(first), cue: `${isomer.name || "the"} ${isomer.name ? "isomer" : "complex"} of ${result.formula}, one optical form` });
      figures.push({ result, isomer, mirrored: true, name: tag(second), cue: "its mirror image, which cannot be superimposed on it" });
    } else {
      figures.push({ result, isomer, mirrored: false, name: isomer.name, cue: isomer.name ? `the ${isomer.name} isomer of ${result.formula}` : `${result.formula}, ${result.geometry}` });
    }
  }
  return figures;
}

export function buildCoordinationScene(
  question: string,
  quantities: ChemPlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  void quantities;
  const stem = normalizeChemistryText(question).toLowerCase();
  if (VETO.test(stem) && !/isomer/.test(stem)) return null;
  if (!CUE.test(stem) && !schematic) return null;
  const entries = stemComplexes(question);
  if (entries.length === 0) return null;

  const isomerAsk = ISOMER_CUE.test(stem);
  const opticalAsk = OPTICAL_CUE.test(stem);
  let figures: Figure[] = [];
  let caption: string;
  let reason: string;

  if (entries.length === 1) {
    const entry = entries[0]!;
    const { result } = entry;
    const named = entry.prefix
      ? result.geometrical.find((isomer) => isomer.name === entry.prefix || isomer.name.startsWith(`${entry.prefix} `) || isomer.name.startsWith(`${entry.prefix},`))
      : null;
    if (named && entry.prefix) {
      // The stem names one form (cis-[Pt(NH3)2Cl2]): draw that form alone,
      // as a mirror pair when it is chiral and the stem asks about that.
      figures = isomerFigures(entry, opticalAsk);
      const others = result.geometrical.filter((isomer) => isomer !== named).map((isomer) => isomer.name);
      const chiral = named.optical ? `chiral, 2 optical isomers (${chiralWord(named)})` : "not chiral";
      const rest = others.length ? `; the ${others.join(", ")} form${others.length === 1 ? "" : "s"} also exist${others.length === 1 ? "s" : ""}` : "";
      caption = `${entry.prefix} ${result.formula}: ${result.geometry}, ${chiral}${rest}`;
      reason = `the ${entry.prefix} form of ${result.formula}`;
    } else if (isomerAsk) {
      figures = isomerFigures(entry, opticalAsk);
      const shown = figures.length > MAX_FIGURES ? ` (${MAX_FIGURES} of ${figures.length} forms drawn)` : "";
      caption = `${isomerSummary(result)}${shown}`;
      reason = `stereoisomers of ${result.formula}`;
    } else {
      const drawn = result.geometrical[0]!;
      figures = [{ result, isomer: drawn, mirrored: false, name: "", cue: `${result.formula}: ${result.geometry} around ${result.complex.metal.symbol}` }];
      caption = structureSummary(result, drawn);
      reason = `structure of ${result.formula}`;
    }
  } else {
    // Several complexes listed: each drawn once, as its named isomer when the
    // stem writes cis or trans before it, labelled with its formula.
    const listed = entries.slice(0, MAX_FIGURES);
    figures = listed.map((entry) => {
      const chosen = entry.prefix
        ? entry.result.geometrical.find((isomer) => isomer.name === entry.prefix || isomer.name.startsWith(`${entry.prefix} `) || isomer.name.startsWith(`${entry.prefix},`))
        : null;
      const isomer = chosen ?? entry.result.geometrical[0]!;
      const label = entry.result.formula.length <= 16 ? entry.result.formula : `complex ${String.fromCharCode(65 + listed.indexOf(entry))}`;
      const shownName = entry.prefix && chosen ? `${entry.prefix} ${label}` : label;
      return { result: entry.result, isomer, mirrored: false, name: shownName.length <= 16 ? shownName : label, cue: `${entry.prefix ? `${entry.prefix} ` : ""}${entry.result.formula}: ${entry.result.geometry}` };
    });
    const lines = listed.map((entry, index) => {
      const figure = figures[index]!;
      const prefix = figure.name.startsWith("complex ") ? `${figure.name} = ` : "";
      const chosenIsomer = entry.prefix ? figure.isomer : null;
      const body = isomerAsk
        ? (chosenIsomer
          ? `${entry.prefix} ${entry.result.formula}: ${entry.result.geometry}, ${chosenIsomer.optical ? `chiral (${chiralWord(chosenIsomer)})` : "not chiral"}`
          : isomerSummary(entry.result))
        : structureSummary(entry.result, null);
      return `${prefix}${body}`;
    });
    const omitted = entries.length > MAX_FIGURES ? `; ${entries.length - MAX_FIGURES} more listed but not drawn` : "";
    caption = `${lines.join(". ")}${omitted}`;
    reason = `the ${listed.length} complexes named in the stem`;
  }

  if (figures.length === 0) return null;
  figures = figures.slice(0, MAX_FIGURES);
  // A lone figure is fitted tall, and a name under it would fall out of
  // view; its form is stated in the caption instead.
  if (figures.length === 1) figures[0] = { ...figures[0]!, name: "" };

  // Figures sit in a row (a 2 by 2 grid from three) in world units. Each
  // figure is its own reveal group, and its pinned name and charge texts are
  // construction components of their own inside that group, which is what
  // keeps the compiler from packing the figures into stacked view slots: the
  // document is fitted as laid out here, cis beside trans as in a textbook.
  const c = new ChemScene(question, reason, COORD_FAMILY);
  const columns = figures.length >= 3 ? 2 : figures.length;
  figures.forEach((figure, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const origin = { x: column * FIGURE_DX, y: -row * FIGURE_DY };
    const ids = drawFigure(c, `f${index}`, figure, origin);
    // A mirror pair gets its dashed mirror line between the two figures.
    const previous = figures[index - 1];
    if (figure.mirrored && previous && !previous.mirrored && previous.isomer === figure.isomer && column > 0) {
      const x = origin.x - FIGURE_DX / 2;
      const link = c.link(`mirror${index}`, { x, y: origin.y - 1.55 }, { x, y: origin.y + 1.35 }, "mirror plane");
      ids.push(link);
    }
    c.scene.group(`figure_${index}`, ids, figure.cue);
  });
  return c.build({ caption });
}

/* ------------------------------------------------------------------------- */
/* Probes                                                                    */
/* ------------------------------------------------------------------------- */

export const COORD_PROBES: ReadonlyArray<{
  question: string;
  expect: "draw" | "decline";
  labels?: string[];
  forbidLabels?: string[];
  note?: string;
}> = [
  { question: "Draw the geometrical isomers of [Co(NH3)4Cl2]+ and name them.", expect: "draw", labels: ["cis", "trans", "NH_3", "Cl", "Co"], forbidLabels: ["fac", "mer"], note: "MA4B2: cis and trans, no optical isomers" },
  { question: "How many geometrical isomers does [Co(NH3)3Cl3] show? Draw the fac and mer forms.", expect: "draw", labels: ["fac", "mer"], forbidLabels: ["cis", "trans"], note: "MA3B3: fac and mer" },
  { question: "Which isomer of [Co(en)2Cl2]+ is optically active? Draw the stereoisomers.", expect: "draw", labels: ["cis (Δ)", "cis (Λ)", "trans", "en", "N"], note: "M(AA)2B2: cis chiral pair plus trans, 3 stereoisomers" },
  { question: "[Cr(en)3]3+ shows optical isomerism. Draw the two optical isomers.", expect: "draw", labels: ["Δ", "Λ", "en", "Cr"], forbidLabels: ["cis", "trans"], note: "M(AA)3: only optical isomers, mirror images" },
  { question: "Draw the cis and trans isomers of [Pt(NH3)2Cl2].", expect: "draw", labels: ["cis", "trans", "Pt"], note: "square planar MA2B2" },
  { question: "What is the structure of [Ni(CN)4]2-?", expect: "draw", labels: ["Ni", "CN", "2-"], forbidLabels: ["cis", "trans"], note: "square planar structure, dsp2 Ni(II)" },
  { question: "The shape of [NiCl4]2- is", expect: "draw", labels: ["Ni", "Cl"], note: "tetrahedral structure" },
  { question: "Draw the structure of [Co(NH3)6]Cl3 and state its coordination number.", expect: "draw", labels: ["Co", "NH_3", "3+"], note: "octahedral structure" },
  { question: "What is the geometry of the complex ion in K4[Fe(CN)6]?", expect: "draw", labels: ["Fe", "CN", "4-"], note: "octahedral Fe(II)" },
  { question: "How many geometrical isomers are possible for [Pt(NH3)(H2O)Cl2]? Draw them.", expect: "draw", labels: ["cis", "trans", "H_2O", "NH_3"], note: "square planar MA2BC" },
  { question: "Draw the structure of [Cr(H2O)4Cl2]Cl and give the oxidation state of Cr.", expect: "draw", labels: ["Cr", "H_2O", "Cl"], note: "structure question, cis form drawn and caption says trans exists" },
  { question: "The shape of [Ni(CO)4] is", expect: "draw", labels: ["Ni", "CO"], note: "tetrahedral, Ni(0)" },
  { question: "What is the geometry of [Cu(NH3)4]2+?", expect: "draw", labels: ["Cu", "NH_3", "2+"], note: "square planar Cu(II) ammine" },
  { question: "Number of complexes showing optical isomerism among cis-[Cr(ox)2Cl2]3-, [Co(en)3]3+, trans-[Pt(en)2Cl2]2+ is", expect: "draw", labels: ["ox", "en"], note: "several complexes, each drawn as its named isomer" },
  { question: "The number of geometrical isomers of a square planar complex MABCD is", expect: "decline", note: "no readable complex: M is not a metal symbol" },
  { question: "Calculate the spin only magnetic moment of [Fe(CN)6]3-.", expect: "decline", note: "crystal field lane" },
];
