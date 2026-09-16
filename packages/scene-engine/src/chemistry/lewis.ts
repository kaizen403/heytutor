/**
 * Lewis (electron dot) structures for the JEE bonding syllabus.
 *
 * The solver is the octet method a student runs by hand: count valence
 * electrons, pick the skeleton, spend electrons on single bonds, complete the
 * terminal octets, give the rest to the central atom, and turn terminal lone
 * pairs into multiple bonds until the centre has its octet. Period 3 and
 * later centres may expand the octet and, by the JEE convention, take extra
 * double bonds until their formal charge is zero (two S=O in sulphate, three
 * Cl=O in perchlorate). Boron, beryllium and aluminium stay electron
 * deficient rather than take a double bond from a halogen or oxygen.
 *
 * Every drawn value comes out of that solver for the formula the stem names.
 * Nothing is looked up as a stock picture: a formula the solver cannot place
 * (a metal, a bracketed complex, an organic chain beyond two carbons) draws
 * nothing.
 */
import type { SceneDocument } from "../types";
import { type ElementRecord, isMetal, valenceElectrons } from "./elements";
import { complexTokens, formulaTokens, parseFormula, type ParsedFormula } from "./formula";
import { ChemScene, chemStem, type ChemPlanQuantity, type Vec2 } from "./sceneKit";

export const LEWIS_FAMILY = "chem_lewis" as const;

/* ------------------------------------------------------------------------- */
/* Public result types                                                        */
/* ------------------------------------------------------------------------- */

export interface LewisAtom {
  readonly id: string;
  readonly symbol: string;
  readonly element: ElementRecord;
  /** Position in the 2D Lewis plane, bond length 1. */
  readonly x: number;
  readonly y: number;
  readonly lonePairs: number;
  /** 1 for the odd electron of a radical (NO, NO2, ClO2), else 0. */
  readonly unpaired: number;
  readonly formalCharge: number;
  readonly neighbours: readonly string[];
  /** Directions (degrees) of each lone pair around the atom. */
  readonly lonePairAngles: readonly number[];
  readonly unpairedAngle: number | null;
  /** Electrons the atom owns or shares (8 is an octet). */
  readonly electrons: number;
}

export interface LewisBond {
  readonly id: string;
  readonly a: string;
  readonly b: string;
  readonly order: 1 | 2 | 3;
}

export interface LewisForm {
  readonly atoms: readonly LewisAtom[];
  readonly bonds: readonly LewisBond[];
  readonly sigmaBonds: number;
  readonly piBonds: number;
  readonly lonePairs: number;
}

export interface LewisResult extends LewisForm {
  /** The formula as written, notation normalised. */
  readonly text: string;
  /** Board label with subscripts and charge, e.g. NO_3^(-). */
  readonly label: string;
  readonly formula: ParsedFormula;
  readonly totalValenceElectrons: number;
  readonly unpairedElectrons: number;
  readonly centralAtom: string | null;
  readonly skeleton: "diatomic" | "central" | "chain";
  readonly expandedOctet: boolean;
  readonly electronDeficient: boolean;
  /** Number of equivalent resonance structures (1 when there is no resonance). */
  readonly resonanceCount: number;
  /** The resonance forms that are counted, base form first, at most three. */
  readonly resonanceForms: readonly LewisForm[];
}

/* ------------------------------------------------------------------------- */
/* Cues                                                                       */
/* ------------------------------------------------------------------------- */

const LEWIS_CUES: readonly RegExp[] = [
  /\blewis(?!\s*(?:acid|base|basic))/,
  /dot structure/, /electron[- ]dot/, /formal charge/, /lone[- ]pair/,
  /sigma and pi|σ and π|sigma bond|pi bond|σ[- ]bond|π[- ]bond|number of (?:sigma|pi|σ|π)|(?:sigma|pi|σ|π)\s*\(?\s*(?:bonds?|and)/,
  /resonan(?:ce|t|ting)\s+(?:struct|form|hybrid)|resonating struct|canonical (?:struct|form)|contributing struct/,
  /bond[- ]pair/, /octet/,
];

const LEWIS_VETOES: readonly RegExp[] = [
  /benzene|phenyl|aromatic|toluene|pyridine|naphthalene|anthracene|furan|pyrrole/,
  /\b(?!methane\b|ethane\b|ethene\b|ethyne\b|ethylene\b|acetylene\b)[a-z]{3,}(?:ane|ene|yne)\b/,
  /[a-z]+(?:anol|anone|anal|anoic|amine|amide)\b|\bether\b|\bester\b|\bketone\b|\baldehyde\b|\balcohol\b/,
  /alkane|alkene|alkyne|carbocation|carbanion|hyperconjugat|electromeric|inductive|mesomeric|\bs[_ ]?n[12]\b(?![+-])|\be[12]\b/,
  /molecular orbital|\bmo\b|\bmot\b|bond order|\bhomo\b|\blumo\b|paramagnetic|diamagnetic/,
  /hydrogen bond|three[- ]cent|3[- ]cent|banana bond|\bdimer/,
  /\[[a-z]{1,2}(?:\(|[a-z0-9]*\d)/,
];

/** True when the stem asks for a Lewis picture and names nothing this family must leave to another lane. */
export function isLewisStem(question: string): boolean {
  const stem = chemStem(question);
  if (!LEWIS_CUES.some((cue) => cue.test(stem))) return false;
  if (LEWIS_VETOES.some((veto) => veto.test(stem))) return false;
  if (complexTokens(question).length > 0) return false;
  return true;
}

/* ------------------------------------------------------------------------- */
/* Skeleton                                                                   */
/* ------------------------------------------------------------------------- */

interface SkelAtom {
  readonly id: string;
  readonly symbol: string;
  readonly element: ElementRecord;
  readonly parent: string | null;
  readonly children: string[];
}

interface Skeleton {
  readonly atoms: Map<string, SkelAtom>;
  readonly order: string[];
  /** Atoms whose octet is completed last and which take multiple bonds. */
  readonly roots: string[];
  readonly kind: "diatomic" | "central" | "chain";
  readonly resonanceOverride?: number;
  readonly label?: string;
}

/** Skeletons the electronegativity rule cannot find: asymmetric chains and the carboxylates. */
interface SpecialSkeleton {
  readonly bodies: readonly string[];
  readonly symbols: readonly string[];
  readonly edges: ReadonlyArray<readonly [number, number]>;
  readonly roots: readonly number[];
  readonly kind: "central" | "chain";
  readonly resonanceOverride?: number;
  readonly label?: string;
}

const SPECIAL_SKELETONS: readonly SpecialSkeleton[] = [
  { bodies: ["N2O"], symbols: ["N", "N", "O"], edges: [[1, 0], [1, 2]], roots: [1], kind: "central", resonanceOverride: 3 },
  { bodies: ["NCO", "OCN"], symbols: ["N", "C", "O"], edges: [[1, 0], [1, 2]], roots: [1], kind: "central", resonanceOverride: 3 },
  { bodies: ["SCN", "NCS"], symbols: ["S", "C", "N"], edges: [[1, 0], [1, 2]], roots: [1], kind: "central", resonanceOverride: 3 },
  { bodies: ["N3"], symbols: ["N", "N", "N"], edges: [[1, 0], [1, 2]], roots: [1], kind: "central", resonanceOverride: 3 },
  { bodies: ["HNC"], symbols: ["H", "N", "C"], edges: [[1, 0], [1, 2]], roots: [1], kind: "central" },
  { bodies: ["HCO2", "HCOO", "CHO2"], symbols: ["C", "H", "O", "O"], edges: [[0, 1], [0, 2], [0, 3]], roots: [0], kind: "central", label: "HCOO" },
  { bodies: ["HCOOH", "CH2O2", "H2CO2"], symbols: ["C", "H", "O", "O", "H"], edges: [[0, 1], [0, 2], [0, 3], [3, 4]], roots: [0], kind: "central", label: "HCOOH" },
  { bodies: ["CH3COO", "C2H3O2", "CH3CO2"], symbols: ["C", "C", "H", "H", "H", "O", "O"], edges: [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5], [1, 6]], roots: [0, 1], kind: "chain", label: "CH_3COO" },
  { bodies: ["CH3COOH", "C2H4O2", "CH3CO2H"], symbols: ["C", "C", "H", "H", "H", "O", "O", "H"], edges: [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5], [1, 6], [6, 7]], roots: [0, 1], kind: "chain", label: "CH_3COOH" },
];

/** Odd-electron species the syllabus draws, keyed body then charge; any other odd count is an OCR slip. */
const RADICALS_ALLOWED = new Set(["NO/0", "NO2/0", "ClO2/0", "O2/-1"]);

function isHalogen(element: ElementRecord): boolean {
  return element.group === 17;
}

function bodyOf(formula: ParsedFormula): string {
  return formula.atoms.map((atom) => `${atom.symbol}${atom.count > 1 ? atom.count : ""}`).join("");
}

function chargeSuffix(charge: number): string {
  if (charge === 0) return "";
  const magnitude = Math.abs(charge);
  return `^(${magnitude > 1 ? magnitude : ""}${charge < 0 ? "-" : "+"})`;
}

function boardLabel(formula: ParsedFormula, override?: string): string {
  const runs = scanRuns(bodyText(formula));
  const body = override ?? (runs ?? formula.atoms).map((run) => `${run.symbol}${run.count > 1 ? `_${run.count}` : ""}`).join("");
  return `${body}${chargeSuffix(formula.charge)}`;
}

function makeSkeleton(symbols: readonly string[], edges: ReadonlyArray<readonly [number, number]>, roots: readonly number[], kind: Skeleton["kind"], extra: Partial<Pick<Skeleton, "resonanceOverride" | "label">> = {}): Skeleton | null {
  const atoms = new Map<string, SkelAtom>();
  const order: string[] = [];
  const counters = new Map<string, number>();
  const ids = symbols.map((symbol) => {
    const element = parseFormula(symbol)?.atoms[0]?.element;
    if (!element) return null;
    const count = (counters.get(symbol) ?? 0) + 1;
    counters.set(symbol, count);
    const id = `${symbol}${count}`;
    atoms.set(id, { id, symbol, element, parent: null, children: [] });
    order.push(id);
    return id;
  });
  if (ids.some((id) => id === null)) return null;
  const parentOf = new Map<string, string>();
  for (const [from, to] of edges) {
    const a = ids[from]!;
    const b = ids[to]!;
    atoms.get(a)!.children.push(b);
    parentOf.set(b, a);
  }
  for (const [id, atom] of atoms) {
    const parent = parentOf.get(id) ?? null;
    atoms.set(id, { ...atom, parent });
  }
  return { atoms, order, roots: roots.map((index) => ids[index]!), kind, ...extra };
}

interface Run { readonly symbol: string; readonly count: number }

/** Element runs in written order: CH3OH -> C, H3, O, H. Null on brackets or dots. */
function scanRuns(body: string): Run[] | null {
  if (/[()[\]{}.·•]/.test(body)) return null;
  const runs: Run[] = [];
  const pattern = /([A-Z][a-z]?)(\d*)/g;
  let consumed = 0;
  for (const match of body.matchAll(pattern)) {
    if (match.index !== consumed) return null;
    consumed += match[0].length;
    runs.push({ symbol: match[1]!, count: match[2] ? Number(match[2]) : 1 });
  }
  if (consumed !== body.length || runs.length === 0) return null;
  return runs;
}

/** Strip the charge the parser read so the body can be scanned as written. */
function bodyText(formula: ParsedFormula): string {
  const text = formula.text;
  if (formula.charge === 0) return text;
  const explicit = /\^\(?\s*\d*\s*[+-]\s*\)?$/.exec(text);
  if (explicit) return text.slice(0, explicit.index);
  const bare = /^(.*?)(\d*)([+-])$/.exec(text);
  if (!bare) return text;
  const head = bare[1]!;
  const digits = bare[2]!;
  if (!digits) return head;
  if (digits.length >= 2) return `${head}${digits.slice(0, -1)}`;
  if (/^[A-Z][a-z]?$/.test(head) && Number(digits) === Math.abs(formula.charge)) return head;
  return `${head}${digits}`;
}

const OXYACID = /^H\d*[A-Z][a-z]?\d*O\d*$/;
const COVALENT_METALS = new Set(["Be", "Al", "Sn", "Pb"]);
const MULTI_TERMINAL = new Set(["O", "S", "F", "Cl", "Br", "I", "H"]);

/**
 * Choose the skeleton by the textbook rule: one central atom (the least
 * electronegative element that occurs once, never H, a halogen only among
 * oxygen and halogens), hydrogens on the atom they are written after (CH3OH,
 * NH2OH, HCHO) or on oxygen in an oxyacid (HNO3, H2SO4, H2CO3), two centres
 * when the only heavy element occurs twice (C2H4, N2H4, H2O2, C2O4^2-), a
 * linear chain for a homonuclear triatomic (O3, N3^-, I3^-), and a small
 * table for the asymmetric chains and carboxylates.
 */
function chooseSkeleton(formula: ParsedFormula): Skeleton | null {
  // Be, Al, Sn and Pb bond covalently in the halides the syllabus draws
  // (BeCl2, AlCl3, SnCl2); every other metal makes an ionic species.
  if (formula.atoms.some((atom) => (isMetal(atom.element) && !COVALENT_METALS.has(atom.symbol)) || atom.element.block === "d" || atom.element.block === "f")) return null;
  if (formula.totalAtoms < 2 || formula.totalAtoms > 9) return null;
  const body = bodyOf(formula);
  const special = SPECIAL_SKELETONS.find((entry) => entry.bodies.includes(body));
  if (special) return makeSkeleton(special.symbols, special.edges, special.roots, special.kind, { resonanceOverride: special.resonanceOverride, label: special.label });
  const runs = scanRuns(bodyText(formula));
  if (!runs) return null;

  if (formula.totalAtoms === 2) {
    const instances = runs.flatMap((run) => Array.from({ length: run.count }, () => run.symbol));
    const first = parseFormula(instances[0]!)!.atoms[0]!.element;
    const second = parseFormula(instances[1]!)!.atoms[0]!.element;
    const rootFirst = (first.electronegativity ?? 0) <= (second.electronegativity ?? 0);
    return makeSkeleton(instances, [[rootFirst ? 0 : 1, rootFirst ? 1 : 0]], [rootFirst ? 0 : 1], "diatomic");
  }

  const heavy = formula.atoms.filter((atom) => atom.symbol !== "H");
  const singles = heavy.filter((atom) => atom.count === 1);
  const pickRoot = (pool: typeof singles) => [...pool].sort((a, b) => (a.element.electronegativity ?? 9) - (b.element.electronegativity ?? 9))[0] ?? null;
  const onlyOxygenAndHalogens = heavy.every((atom) => atom.symbol === "O" || isHalogen(atom.element));
  const root = pickRoot(singles.filter((atom) => !isHalogen(atom.element))) ?? (onlyOxygenAndHalogens ? pickRoot(singles) : null);
  if (root) {
    if (heavy.some((atom) => atom.symbol !== root.symbol && atom.count > 1 && !MULTI_TERMINAL.has(atom.symbol))) return null;
    // Heavy instances in written order, then hydrogens on the atom they follow.
    const symbols: string[] = [];
    const heavyIndex: number[] = [];
    const hydrogenOn: number[] = [];
    let leading = 0;
    runs.forEach((run, runIndex) => {
      if (run.symbol === "H") {
        if (heavyIndex.length === 0) { leading += run.count; return; }
        const previous = runs[runIndex - 1]!;
        const targets = heavyIndex.slice(-previous.count);
        for (let i = 0; i < run.count; i += 1) hydrogenOn.push(previous.count >= run.count ? targets[i % targets.length]! : targets[targets.length - 1]!);
        return;
      }
      for (let i = 0; i < run.count; i += 1) {
        symbols.push(run.symbol);
        heavyIndex.push(symbols.length - 1);
      }
    });
    const rootIndex = symbols.indexOf(root.symbol);
    const oxygens = symbols.map((symbol, index) => (symbol === "O" && index !== rootIndex ? index : -1)).filter((index) => index >= 0);
    if (leading > 0) {
      const acid = OXYACID.test(bodyText(formula));
      const onOxygen = acid && root.symbol !== "O" && leading <= oxygens.length;
      for (let i = 0; i < leading; i += 1) hydrogenOn.push(onOxygen ? oxygens[i]! : acid && root.symbol === "O" ? rootIndex : heavyIndex[0]!);
    }
    const edges: Array<[number, number]> = [];
    symbols.forEach((_, index) => { if (index !== rootIndex) edges.push([rootIndex, index]); });
    for (const target of hydrogenOn) {
      symbols.push("H");
      edges.push([target, symbols.length - 1]);
    }
    if (edges.filter(([from]) => from === rootIndex).length > 7) return null;
    return makeSkeleton(symbols, edges, [rootIndex], "central");
  }

  if (heavy.length === 1 && heavy[0]!.count === 3 && formula.totalAtoms === 3) {
    const symbol = heavy[0]!.symbol;
    return makeSkeleton([symbol, symbol, symbol], [[1, 0], [1, 2]], [1], "central");
  }

  if (heavy.length >= 1 && heavy[0]!.count === 2) {
    const centre = heavy[0]!.symbol;
    const terminals = formula.atoms.filter((atom) => atom.symbol !== centre);
    if (terminals.some((atom) => atom.count % 2 === 1 || !MULTI_TERMINAL.has(atom.symbol))) return null;
    const symbols: string[] = [centre, centre];
    const edges: Array<[number, number]> = [[0, 1]];
    for (const atom of terminals) {
      const half = atom.count / 2;
      for (let side = 0; side < 2; side += 1) {
        for (let i = 0; i < half; i += 1) {
          symbols.push(atom.symbol);
          edges.push([side, symbols.length - 1]);
        }
      }
    }
    if ((symbols.length - 2) / 2 > 3) return null;
    return makeSkeleton(symbols, edges, [0, 1], "chain");
  }
  return null;
}

/* ------------------------------------------------------------------------- */
/* Electron distribution                                                      */
/* ------------------------------------------------------------------------- */

interface SolveAtom {
  readonly id: string;
  readonly symbol: string;
  readonly element: ElementRecord;
  nonbonding: number;
  readonly bonds: Map<string, number>;
}

interface Solution {
  readonly atoms: Map<string, SolveAtom>;
  readonly conversions: number;
}

const ELEMENT_PREFERENCE: Record<string, number> = { O: 0, N: 1, C: 2, S: 3 };

function electronsAround(atom: SolveAtom): number {
  let shared = 0;
  atom.bonds.forEach((order) => { shared += 2 * order; });
  return atom.nonbonding + shared;
}

function formalCharge(atom: SolveAtom): number {
  let orders = 0;
  atom.bonds.forEach((order) => { orders += order; });
  return valenceElectrons(atom.element) - atom.nonbonding - orders;
}

function canDonate(atom: SolveAtom): boolean {
  return atom.symbol !== "H" && !isHalogen(atom.element) && atom.nonbonding >= 2;
}

/**
 * Run the octet method on a skeleton. `prefer` is a multiset of neighbour ids
 * that should take the multiple bonds first (used to enumerate resonance
 * forms); `jee` adds the formal-charge minimisation for period 3+ centres.
 */
function distribute(skeleton: Skeleton, total: number, prefer: readonly string[], jee: boolean): Solution | null {
  const atoms = new Map<string, SolveAtom>();
  for (const id of skeleton.order) {
    const atom = skeleton.atoms.get(id)!;
    atoms.set(id, { id, symbol: atom.symbol, element: atom.element, nonbonding: 0, bonds: new Map() });
  }
  let edges = 0;
  for (const id of skeleton.order) {
    const atom = skeleton.atoms.get(id)!;
    for (const child of atom.children) {
      atoms.get(id)!.bonds.set(child, 1);
      atoms.get(child)!.bonds.set(id, 1);
      edges += 1;
    }
  }
  let remaining = total - 2 * edges;
  if (remaining < 0) return null;

  const roots = new Set(skeleton.roots);
  const nonRoots = skeleton.order.filter((id) => !roots.has(id));
  const terminals = nonRoots.filter((id) => atoms.get(id)!.bonds.size === 1);
  const interior = nonRoots.filter((id) => atoms.get(id)!.bonds.size > 1);
  const need = (atom: SolveAtom) => (atom.symbol === "H" ? 0 : Math.max(0, 8 - electronsAround(atom)));
  for (const id of [...terminals, ...interior]) {
    const atom = atoms.get(id)!;
    const want = need(atom);
    if (want > remaining) return null;
    atom.nonbonding += want;
    remaining -= want;
  }
  for (const id of skeleton.roots) {
    const atom = atoms.get(id)!;
    const give = Math.min(need(atom), remaining);
    atom.nonbonding += give;
    remaining -= give;
  }
  if (remaining > 0) {
    const expandable = skeleton.roots.map((id) => atoms.get(id)!).find((atom) => atom.element.period >= 3);
    if (!expandable) return null;
    expandable.nonbonding += remaining;
    remaining = 0;
  }

  const preferCounts = new Map<string, number>();
  prefer.forEach((id) => preferCounts.set(id, (preferCounts.get(id) ?? 0) + 1));
  const preferIndex = (id: string) => ((preferCounts.get(id) ?? 0) > 0 ? prefer.indexOf(id) : Number.POSITIVE_INFINITY);
  const usePrefer = (id: string) => { if ((preferCounts.get(id) ?? 0) > 0) preferCounts.set(id, preferCounts.get(id)! - 1); };
  const rank = (root: SolveAtom, id: string): number[] => {
    const atom = atoms.get(id)!;
    return [preferIndex(id), root.bonds.get(id)!, ELEMENT_PREFERENCE[atom.symbol] ?? 4, -atom.nonbonding, skeleton.order.indexOf(id)];
  };
  const byRank = (root: SolveAtom) => (a: string, b: string) => {
    const ra = rank(root, a);
    const rb = rank(root, b);
    for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
    return 0;
  };
  let conversions = 0;
  const convert = (root: SolveAtom, id: string) => {
    const neighbour = atoms.get(id)!;
    neighbour.nonbonding -= 2;
    root.bonds.set(id, root.bonds.get(id)! + 1);
    neighbour.bonds.set(root.id, neighbour.bonds.get(root.id)! + 1);
    usePrefer(id);
    conversions += 1;
  };

  // Octet completion of each centre from its neighbours' lone pairs.
  const deficientTypes = new Set(["B", "Be", "Al"]);
  for (const rootId of skeleton.roots) {
    const root = atoms.get(rootId)!;
    if (deficientTypes.has(root.symbol) || root.symbol === "H") continue;
    let guard = 0;
    while (8 - electronsAround(root) >= 2 && guard < 6) {
      guard += 1;
      const candidates = [...root.bonds.keys()].filter((id) => canDonate(atoms.get(id)!) && root.bonds.get(id)! < 3).sort(byRank(root));
      if (candidates.length === 0) break;
      convert(root, candidates[0]!);
    }
  }

  // JEE convention: a period 3+ centre keeps taking double bonds from
  // negatively charged neighbours until its own formal charge is zero.
  if (jee) {
    for (const rootId of skeleton.roots) {
      const root = atoms.get(rootId)!;
      if (root.element.period < 3) continue;
      let guard = 0;
      while (formalCharge(root) > 0 && guard < 6) {
        guard += 1;
        const candidates = [...root.bonds.keys()]
          .filter((id) => canDonate(atoms.get(id)!) && root.bonds.get(id)! < 3 && formalCharge(atoms.get(id)!) < 0)
          .sort((a, b) => {
            const pa = preferIndex(a);
            const pb = preferIndex(b);
            if (pa !== pb) return pa - pb;
            const fa = formalCharge(atoms.get(a)!);
            const fb = formalCharge(atoms.get(b)!);
            if (fa !== fb) return fa - fb;
            return byRank(root)(a, b);
          });
        if (candidates.length === 0) break;
        convert(root, candidates[0]!);
      }
    }
  }

  // The books must balance: every electron placed, formal charges summing to the charge.
  let placed = 0;
  atoms.forEach((atom) => { placed += atom.nonbonding; });
  let orders = 0;
  atoms.forEach((atom) => atom.bonds.forEach((order) => { orders += order; }));
  if (placed + orders !== total) return null;
  for (const atom of atoms.values()) {
    if (atom.symbol === "H" && electronsAround(atom) !== 2) return null;
    if (atom.nonbonding < 0) return null;
    // A period 2 atom never holds more than an octet: a balanced count on a
    // wrong skeleton (a carbon with five bonds) is refused here.
    if (atom.element.period <= 2 && electronsAround(atom) > 8) return null;
  }
  return { atoms, conversions };
}

/* ------------------------------------------------------------------------- */
/* Layout                                                                     */
/* ------------------------------------------------------------------------- */

const H_BOND = 0.9;

function slotsForCentre(n: number, lonePairSlots: number): number[] | null {
  if (n === 1) return [0];
  if (n === 2) {
    if (lonePairSlots === 0 || lonePairSlots >= 3) return [180, 0];
    if (lonePairSlots === 1) return [210, 330];
    return [217.75, 322.25];
  }
  if (n === 3) {
    if (lonePairSlots === 0) return [90, 210, 330];
    if (lonePairSlots === 1) return [180, 270, 0];
    return [90, 270, 0];
  }
  if (n === 4) return [90, 270, 180, 0];
  if (n === 5) return [90, 162, 234, 306, 18];
  if (n === 6) return [90, 150, 210, 270, 330, 30];
  if (n === 7) return [0, 1, 2, 3, 4, 5, 6].map((k) => 90 + (360 / 7) * k);
  return null;
}

function slotsForChainSide(k: number, lonePairSlots: number): number[] | null {
  if (k === 0) return [];
  if (k === 1) return [180];
  if (k === 2) return lonePairSlots > 0 ? [90, 270] : [120, 240];
  if (k === 3) return [90, 180, 270];
  return null;
}

function normalizeAngle(degrees: number): number {
  let value = degrees % 360;
  if (value < 0) value += 360;
  return value;
}

function angularDistance(a: number, b: number): number {
  const diff = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(diff, 360 - diff);
}

/** Spread `count` lone-pair slots evenly into the gaps between bond directions. */
function lonePairDirections(bondAngles: readonly number[], count: number): number[] {
  if (count <= 0) return [];
  const sorted = [...bondAngles].map(normalizeAngle).sort((a, b) => a - b);
  if (sorted.length === 0) return Array.from({ length: count }, (_, i) => 90 + (360 / count) * i);
  const gaps = sorted.map((start, index) => {
    const end = index + 1 < sorted.length ? sorted[index + 1]! : sorted[0]! + 360;
    return { start, size: end - start, assigned: 0 };
  });
  for (let slot = 0; slot < count; slot += 1) {
    let best = -1;
    for (let i = 0; i < gaps.length; i += 1) {
      if (best < 0) { best = i; continue; }
      const gap = gaps[i]!;
      const current = gaps[best]!;
      const scoreGap = gap.size / (gap.assigned + 1);
      const scoreBest = current.size / (current.assigned + 1);
      if (Math.abs(scoreGap - scoreBest) > 1e-6) { if (scoreGap > scoreBest) best = i; continue; }
      if (Math.abs(gap.size - current.size) > 1e-6) { if (gap.size > current.size) best = i; continue; }
      const farthest = (candidate: typeof gap) => Math.min(...gaps.filter((other) => other.assigned > 0 && other !== candidate).map((other) => angularDistance(other.start + other.size / 2, candidate.start + candidate.size / 2)), 999);
      if (farthest(gap) > farthest(current)) best = i;
    }
    gaps[best]!.assigned += 1;
  }
  const out: number[] = [];
  for (const gap of gaps) {
    for (let i = 1; i <= gap.assigned; i += 1) out.push(normalizeAngle(gap.start + (gap.size * i) / (gap.assigned + 1)));
  }
  return out;
}

interface Placed {
  readonly positions: Map<string, Vec2>;
}

function placeAtoms(skeleton: Skeleton, solution: Solution): Placed | null {
  const positions = new Map<string, Vec2>();
  const slotsOf = (id: string) => {
    const atom = solution.atoms.get(id)!;
    return Math.floor(atom.nonbonding / 2) + (atom.nonbonding % 2);
  };
  const orderChildren = (parentId: string, children: readonly string[]): string[] => {
    const parent = solution.atoms.get(parentId)!;
    return [...children].sort((a, b) => {
      const ka = childKey(a);
      const kb = childKey(b);
      for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
      return 0;
    });
    function childKey(id: string): number[] {
      const atom = skeleton.atoms.get(id)!;
      const hasGrandchildren = atom.children.length > 0 ? 0 : 1;
      const isH = atom.symbol === "H" ? 1 : 0;
      return [hasGrandchildren, isH, -(parent.bonds.get(id) ?? 1), skeleton.order.indexOf(id)];
    }
  };
  const placeChildren = (parentId: string, children: readonly string[], slots: readonly number[]): boolean => {
    const parentAt = positions.get(parentId)!;
    const ordered = orderChildren(parentId, children);
    const free = [...slots];
    for (const childId of ordered) {
      const child = skeleton.atoms.get(childId)!;
      let pick = 0;
      if (child.children.length > 0) {
        // An OH arm goes to the most horizontal free slot so the H runs sideways.
        let bestCos = -1;
        free.forEach((angle, index) => {
          const c = Math.abs(Math.cos((angle * Math.PI) / 180));
          if (c > bestCos + 1e-9) { bestCos = c; pick = index; }
        });
      }
      const angle = free.splice(pick, 1)[0]!;
      const rad = (angle * Math.PI) / 180;
      const at = { x: parentAt.x + Math.cos(rad), y: parentAt.y + Math.sin(rad) };
      positions.set(childId, at);
      for (const grandchild of child.children) {
        const gc = skeleton.atoms.get(grandchild)!;
        if (gc.children.length > 0) return false;
        const dir = { x: at.x - parentAt.x, y: at.y - parentAt.y };
        positions.set(grandchild, { x: at.x + dir.x * H_BOND, y: at.y + dir.y * H_BOND });
      }
    }
    return true;
  };

  if (skeleton.kind === "chain") {
    const [a, b] = skeleton.roots;
    if (!a || !b) return null;
    positions.set(a, { x: -0.5, y: 0 });
    positions.set(b, { x: 0.5, y: 0 });
    const aChildren = skeleton.atoms.get(a)!.children.filter((id) => id !== b);
    const bChildren = skeleton.atoms.get(b)!.children;
    const aSlots = slotsForChainSide(aChildren.length, slotsOf(a));
    const bSlots = slotsForChainSide(bChildren.length, slotsOf(b));
    if (!aSlots || !bSlots) return null;
    if (!placeChildren(a, aChildren, aSlots)) return null;
    if (!placeChildren(b, bChildren, bSlots.map((angle) => normalizeAngle(180 - angle)))) return null;
    return { positions };
  }
  const root = skeleton.roots[0]!;
  positions.set(root, { x: 0, y: 0 });
  const children = skeleton.atoms.get(root)!.children;
  const slots = slotsForCentre(children.length, slotsOf(root));
  if (!slots) return null;
  if (!placeChildren(root, children, slots)) return null;
  return { positions };
}

/* ------------------------------------------------------------------------- */
/* Solver entry                                                               */
/* ------------------------------------------------------------------------- */

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let out = 1;
  for (let i = 1; i <= k; i += 1) out = (out * (n - k + i)) / i;
  return Math.round(out);
}

function buildForm(skeleton: Skeleton, solution: Solution, placed: Placed): LewisForm {
  const angleTo = (from: Vec2, to: Vec2) => (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  const atoms: LewisAtom[] = skeleton.order.map((id) => {
    const solved = solution.atoms.get(id)!;
    const at = placed.positions.get(id)!;
    const neighbours = [...solved.bonds.keys()];
    const bondAngles = neighbours.map((other) => angleTo(at, placed.positions.get(other)!));
    const lonePairs = Math.floor(solved.nonbonding / 2);
    const unpaired = solved.nonbonding % 2;
    const directions = lonePairDirections(bondAngles, lonePairs + unpaired);
    return {
      id,
      symbol: solved.symbol,
      element: solved.element,
      x: at.x,
      y: at.y,
      lonePairs,
      unpaired,
      formalCharge: formalCharge(solved),
      neighbours,
      lonePairAngles: directions.slice(0, lonePairs),
      unpairedAngle: unpaired ? directions[lonePairs]! : null,
      electrons: electronsAround(solved),
    };
  });
  const bonds: LewisBond[] = [];
  for (const id of skeleton.order) {
    for (const child of skeleton.atoms.get(id)!.children) {
      const order = solution.atoms.get(id)!.bonds.get(child)! as 1 | 2 | 3;
      bonds.push({ id: `${id}_${child}`, a: id, b: child, order });
    }
  }
  return {
    atoms,
    bonds,
    sigmaBonds: bonds.length,
    piBonds: bonds.reduce((sum, bond) => sum + bond.order - 1, 0),
    lonePairs: atoms.reduce((sum, atom) => sum + atom.lonePairs, 0),
  };
}

/** Product over centres of C(n, k): n equivalent terminals, k of them multiply bonded. */
function equivalentCount(skeleton: Skeleton, solution: Solution): number {
  let count = 1;
  for (const rootId of skeleton.roots) {
    const root = solution.atoms.get(rootId)!;
    const groups = new Map<string, string[]>();
    for (const id of skeleton.atoms.get(rootId)!.children) {
      const atom = skeleton.atoms.get(id)!;
      if (atom.symbol === "H" || atom.children.length > 0 || solution.atoms.get(id)!.bonds.size !== 1) continue;
      groups.set(atom.symbol, [...(groups.get(atom.symbol) ?? []), id]);
    }
    for (const ids of groups.values()) {
      const multiple = ids.filter((id) => root.bonds.get(id)! > 1).length;
      if (multiple > 0 && multiple < ids.length) count *= choose(ids.length, multiple);
    }
  }
  return count;
}

function bondSignature(solution: Solution, skeleton: Skeleton): string {
  return skeleton.order.map((id) => skeleton.atoms.get(id)!.children.map((child) => `${id}${solution.atoms.get(id)!.bonds.get(child)}`).join(",")).join("|");
}

function enumerateForms(skeleton: Skeleton, total: number, jee: boolean, conversions: number, limit: number): Solution[] {
  const base = distribute(skeleton, total, [], jee);
  if (!base) return [];
  const seen = new Set([bondSignature(base, skeleton)]);
  const forms = [base];
  if (conversions === 0) return forms;
  const donors = skeleton.roots.flatMap((rootId) => skeleton.atoms.get(rootId)!.children.filter((id) =>
    skeleton.atoms.get(id)!.children.length === 0 && canDonate({ ...base.atoms.get(id)!, nonbonding: 2 })));
  const multisets: string[][] = [];
  const grow = (start: number, current: string[]) => {
    if (current.length === conversions) { multisets.push([...current]); return; }
    for (let i = start; i < donors.length; i += 1) {
      current.push(donors[i]!);
      grow(i, current);
      current.pop();
    }
  };
  grow(0, []);
  for (const prefer of multisets.slice(0, 60)) {
    if (forms.length >= limit) break;
    const candidate = distribute(skeleton, total, prefer, jee);
    if (!candidate) continue;
    const signature = bondSignature(candidate, skeleton);
    if (seen.has(signature)) continue;
    seen.add(signature);
    forms.push(candidate);
  }
  return forms;
}

/**
 * The Lewis structure of a formula, or null when the octet method cannot
 * place it (metals, complexes, organic chains beyond two carbons, formulas
 * whose electron count does not balance).
 */
export function lewisStructure(formulaText: string): LewisResult | null {
  const formula = parseFormula(formulaText);
  if (!formula) return null;
  const skeleton = chooseSkeleton(formula);
  if (!skeleton) return null;
  const total = formula.atoms.reduce((sum, atom) => sum + atom.count * valenceElectrons(atom.element), 0) - formula.charge;
  if (total <= 0) return null;
  if (total % 2 === 1 && !RADICALS_ALLOWED.has(`${bodyOf(formula)}/${formula.charge}`)) return null;

  const octet = distribute(skeleton, total, [], false);
  if (!octet) return null;
  const drawn = distribute(skeleton, total, [], true);
  if (!drawn) return null;
  const placed = placeAtoms(skeleton, drawn);
  if (!placed) return null;

  const octetCount = equivalentCount(skeleton, octet);
  const jeeCount = equivalentCount(skeleton, drawn);
  const useOctetForms = octetCount > 1 || skeleton.resonanceOverride !== undefined;
  const resonanceCount = skeleton.resonanceOverride ?? (octetCount > 1 ? octetCount : jeeCount);
  const formSolutions = resonanceCount > 1
    ? enumerateForms(skeleton, total, !useOctetForms, (useOctetForms ? octet : drawn).conversions, Math.min(3, resonanceCount))
    : [drawn];
  // Every form keeps the base placement so the eye sees only the bonds move.
  const resonanceForms = formSolutions.map((solution) => buildForm(skeleton, solution, placed));

  const main = buildForm(skeleton, drawn, placed);
  const rootAtom = drawn.atoms.get(skeleton.roots[0]!)!;
  const rootElectrons = skeleton.roots.map((id) => electronsAround(drawn.atoms.get(id)!));
  return {
    ...main,
    text: formula.text,
    label: boardLabel(formula, skeleton.label),
    formula,
    totalValenceElectrons: total,
    unpairedElectrons: main.atoms.reduce((sum, atom) => sum + atom.unpaired, 0),
    centralAtom: skeleton.kind === "central" ? skeleton.roots[0]! : null,
    skeleton: skeleton.kind,
    expandedOctet: rootElectrons.some((count) => count > 8),
    electronDeficient: rootAtom.symbol !== "H" && rootElectrons.some((count) => count < 8),
    resonanceCount,
    resonanceForms,
  };
}

/* ------------------------------------------------------------------------- */
/* Drawing                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * The compiler fits the ink (bonds and dots, never labels) into its default
 * diagram zone, 740 x 555 with a 64 px label margin, and the board writes a
 * label 24 px tall. A small molecule therefore lands at 300 px per bond and a
 * wide one at 60, so every cosmetic distance here (symbol clearance, dot
 * spacing, charge offset, the formula line) is chosen in pixels and turned
 * into world units from the expected scale. That keeps the picture legible
 * at either end and keeps pinned text inside the margin the fit leaves.
 * These two numbers mirror the compiler's defaults; a private helper here
 * because the shared kit does not expose them.
 */
const ZONE_INNER = { width: 740 - 2 * 64, height: 555 - 2 * 64 };
const INK_REACH_PX = 30;

interface Box { minX: number; maxX: number; minY: number; maxY: number }

function expectedScale(atomsBox: Box): number {
  let scale = 150;
  for (let i = 0; i < 8; i += 1) {
    const reach = INK_REACH_PX / scale;
    const spanX = atomsBox.maxX - atomsBox.minX + 2 * reach;
    const spanY = atomsBox.maxY - atomsBox.minY + 2 * reach;
    scale = Math.min(ZONE_INNER.width / Math.max(spanX, 1), ZONE_INNER.height / Math.max(spanY, 1));
  }
  return scale;
}

interface Cosmetics {
  /** World units per pixel. */
  readonly px: number;
}

function symbolTrimPx(symbol: string): number {
  return symbol.length > 1 ? 21 : 17;
}

function chargeText(charge: number): string {
  const magnitude = Math.abs(charge);
  return `${magnitude > 1 ? magnitude : ""}${charge < 0 ? "-" : "+"}`;
}

/** Direction for a formal-charge sign: the middle of the widest free gap, nearest to up-right. */
function chargeDirection(atom: LewisAtom, positions: Map<string, Vec2>): number {
  const at = positions.get(atom.id)!;
  const occupied = [
    ...atom.neighbours.map((other) => {
      const to = positions.get(other)!;
      return (Math.atan2(to.y - at.y, to.x - at.x) * 180) / Math.PI;
    }),
    ...atom.lonePairAngles,
    ...(atom.unpairedAngle === null ? [] : [atom.unpairedAngle]),
  ].map(normalizeAngle).sort((a, b) => a - b);
  if (occupied.length === 0) return 45;
  const gaps = occupied.map((start, index) => {
    const end = index + 1 < occupied.length ? occupied[index + 1]! : occupied[0]! + 360;
    return { mid: normalizeAngle(start + (end - start) / 2), size: end - start };
  });
  const wide = gaps.filter((gap) => gap.size >= 60);
  const pool = wide.length > 0 ? wide : gaps;
  return [...pool].sort((a, b) => angularDistance(a.mid, 45) - angularDistance(b.mid, 45))[0]!.mid;
}

interface DrawnStructure {
  readonly ids: string[];
}

function atomsBox(form: LewisForm): Box {
  const xs = form.atoms.map((atom) => atom.x);
  const ys = form.atoms.map((atom) => atom.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function drawForm(c: ChemScene, form: LewisForm, prefix: string, offset: Vec2, under: string | null, cosmetics: Cosmetics): DrawnStructure {
  const { px } = cosmetics;
  const ids: string[] = [];
  const positions = new Map<string, Vec2>();
  form.atoms.forEach((atom) => positions.set(atom.id, { x: atom.x + offset.x, y: atom.y + offset.y }));
  let inkMinY = Number.POSITIVE_INFINITY;
  const noteInk = (point: Vec2) => { inkMinY = Math.min(inkMinY, point.y); };
  for (const atom of form.atoms) {
    ids.push(c.atom(`${prefix}${atom.id}`, atom.symbol, positions.get(atom.id)!));
  }
  for (const bond of form.bonds) {
    const a = form.atoms.find((atom) => atom.id === bond.a)!;
    const b = form.atoms.find((atom) => atom.id === bond.b)!;
    const from = positions.get(bond.a)!;
    const to = positions.get(bond.b)!;
    const trimStart = symbolTrimPx(a.symbol) * px;
    const trimEnd = symbolTrimPx(b.symbol) * px;
    ids.push(...c.bond(`${prefix}b_${bond.id}`, `${prefix}${bond.a}`, `${prefix}${bond.b}`, {
      order: bond.order,
      trimStart,
      trimEnd,
      spacing: 5 * px,
      role: bond.order === 1 ? "single bond" : bond.order === 2 ? "double bond" : "triple bond",
    }));
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const dir = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
    noteInk({ x: from.x + dir.x * trimStart, y: from.y + dir.y * trimStart });
    noteInk({ x: to.x - dir.x * trimEnd, y: to.y - dir.y * trimEnd });
  }
  const dot = (id: string, at: Vec2, role: string) => {
    c.scene.point(id, at, role);
    const entity = c.scene.entities.find((candidate) => candidate.id === id);
    if (entity) entity.provenance = { pointStyle: "filled" };
    noteInk({ x: at.x, y: at.y - 3 * px });
    ids.push(id);
  };
  for (const atom of form.atoms) {
    const at = positions.get(atom.id)!;
    const distance = (atom.symbol.length > 1 ? 24 : 21) * px;
    const spread = 3.5 * px;
    atom.lonePairAngles.forEach((angle, index) => {
      const rad = (angle * Math.PI) / 180;
      const centre = { x: at.x + Math.cos(rad) * distance, y: at.y + Math.sin(rad) * distance };
      const normal = { x: -Math.sin(rad), y: Math.cos(rad) };
      dot(`${prefix}lp_${atom.id}_${index + 1}_1`, { x: centre.x - normal.x * spread, y: centre.y - normal.y * spread }, "lone pair electron");
      dot(`${prefix}lp_${atom.id}_${index + 1}_2`, { x: centre.x + normal.x * spread, y: centre.y + normal.y * spread }, "lone pair electron");
    });
    if (atom.unpairedAngle !== null) {
      const rad = (atom.unpairedAngle * Math.PI) / 180;
      dot(`${prefix}odd_${atom.id}`, { x: at.x + Math.cos(rad) * distance, y: at.y + Math.sin(rad) * distance }, "unpaired electron");
    }
    if (atom.formalCharge !== 0) {
      const angle = chargeDirection(atom, positions);
      const rad = (angle * Math.PI) / 180;
      const reach = (atom.symbol.length > 1 ? 31 : 27) * px;
      ids.push(c.text(`${prefix}fc_${atom.id}`, { x: at.x + Math.cos(rad) * reach, y: at.y + Math.sin(rad) * reach }, chargeText(atom.formalCharge), "formal charge"));
    }
  }
  if (under) {
    const box = atomsBox(form);
    ids.push(c.text(`${prefix}name`, { x: offset.x + (box.minX + box.maxX) / 2, y: inkMinY - 30 * px }, under, "formula"));
  }
  return { ids };
}

/** Lay forms side by side: world x offsets so each keeps a clear gap, and one scale for the row. */
function rowLayout(forms: readonly LewisForm[], gapPx: number): { offsets: Vec2[]; cosmetics: Cosmetics } {
  const boxes = forms.map(atomsBox);
  const union: Box = { minX: 0, maxX: 0, minY: Math.min(...boxes.map((box) => box.minY)), maxY: Math.max(...boxes.map((box) => box.maxY)) };
  let scale = 150;
  let offsets: Vec2[] = [];
  for (let pass = 0; pass < 6; pass += 1) {
    const reach = INK_REACH_PX / scale;
    const gap = gapPx / scale;
    let cursor = 0;
    offsets = boxes.map((box) => {
      const offset = { x: cursor - box.minX + reach, y: 0 };
      cursor += box.maxX - box.minX + 2 * reach + gap;
      return offset;
    });
    union.maxX = cursor - gap;
    scale = expectedScale({ minX: 0, maxX: union.maxX, minY: union.minY, maxY: union.maxY });
  }
  return { offsets, cosmetics: { px: 1 / scale } };
}

/* ------------------------------------------------------------------------- */
/* Stem reading                                                               */
/* ------------------------------------------------------------------------- */

const NAMED_SPECIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bwater\b/, "H2O"], [/\bammonia\b/, "NH3"], [/\bmethane\b/, "CH4"], [/\bethane\b/, "C2H6"],
  [/\bethene\b|\bethylene\b/, "C2H4"], [/\bethyne\b|\bacetylene\b/, "C2H2"], [/\bozone\b/, "O3"],
  [/carbon dioxide/, "CO2"], [/carbon monoxide/, "CO"], [/\bnitrate\b/, "NO3-"], [/\bnitrite\b/, "NO2-"],
  [/\bsulph?ate\b/, "SO4^(2-)"], [/\bcarbonate\b/, "CO3^(2-)"], [/\bphosphate\b/, "PO4^(3-)"], [/\bperchlorate\b/, "ClO4-"],
  [/\bchlorate\b/, "ClO3-"], [/\bchlorite\b/, "ClO2-"], [/\bhypochlorite\b/, "ClO-"], [/\bammonium\b/, "NH4+"],
  [/\bhydronium\b|\boxonium\b/, "H3O+"], [/hydrogen cyanide/, "HCN"], [/\bcyanide\b/, "CN-"], [/nitrogen dioxide/, "NO2"],
  [/sulph?ur dioxide/, "SO2"], [/sulph?ur trioxide/, "SO3"], [/nitrous oxide|dinitrogen (?:mon)?oxide/, "N2O"],
  [/\bdinitrogen\b|nitrogen molecule/, "N2"], [/\bacetate\b|\bethanoate\b/, "CH3COO-"], [/\bformate\b|\bmethanoate\b/, "HCOO-"],
  [/\bhydroxide\b/, "OH-"], [/\bazide\b/, "N3-"], [/boron trifluoride/, "BF3"], [/phosphorus pentachloride/, "PCl5"],
  [/sulph?ur hexafluoride/, "SF6"], [/xenon tetrafluoride/, "XeF4"], [/xenon difluoride/, "XeF2"], [/hydrogen peroxide/, "H2O2"],
  [/\bhydrazine\b/, "N2H4"], [/formaldehyde|\bmethanal\b/, "CH2O"], [/\bphosgene\b/, "COCl2"], [/\bthiocyanate\b/, "SCN-"],
  [/\bcyanate\b/, "NCO-"], [/nitric acid/, "HNO3"], [/sulph?uric acid/, "H2SO4"], [/phosphoric acid/, "H3PO4"],
  [/perchloric acid/, "HClO4"], [/carbonic acid/, "H2CO3"], [/hydrogen fluoride/, "HF"], [/hydrogen chloride/, "HCl"],
  [/\boxygen molecule\b|\bdioxygen\b/, "O2"], [/\bfluorine molecule\b/, "F2"], [/nitric oxide|nitrogen monoxide/, "NO"],
  [/\bsulphite\b|\bsulfite\b/, "SO3^(2-)"], [/\bphosphine\b/, "PH3"], [/hydrogen sulph?ide/, "H2S"],
];

function speciesKey(result: LewisResult): string {
  return `${bodyOf(result.formula)}${result.formula.charge}`;
}

/** Every Lewis-solvable species the stem names, formulas first, then names, without repeats. */
function stemSpecies(question: string): LewisResult[] {
  const stem = chemStem(question);
  const out: LewisResult[] = [];
  const seen = new Set<string>();
  const push = (text: string) => {
    const result = lewisStructure(text);
    if (!result) return;
    const key = speciesKey(result);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(result);
  };
  formulaTokens(question).forEach(push);
  NAMED_SPECIES.forEach(([pattern, formula]) => { if (pattern.test(stem)) push(formula); });
  return out;
}

const RESONANCE_CUE = /resonan|canonical|contributing struct/;

function captionFor(result: LewisResult): string {
  return `${result.label}: σ = ${result.sigmaBonds}, π = ${result.piBonds}, lone pairs = ${result.lonePairs}`;
}

/**
 * The Lewis figure for the stem, or null when the stem names no species the
 * solver can place (or names more than four).
 */
export function buildLewisScene(question: string, quantities: ChemPlanQuantity[], schematic: boolean): SceneDocument | null {
  void quantities;
  void schematic;
  if (!isLewisStem(question)) return null;
  const stem = chemStem(question);
  const species = stemSpecies(question);
  if (species.length === 0) return null;

  const wantsResonance = RESONANCE_CUE.test(stem);
  const single = species[0]!;
  if (species.length === 1 && wantsResonance && single.resonanceCount > 1 && single.resonanceForms.length > 1) {
    const c = new ChemScene(question, `Resonance structures of ${single.label}`, LEWIS_FAMILY);
    const forms = single.resonanceForms.slice(0, 3);
    const { offsets, cosmetics } = rowLayout(forms, 70);
    forms.forEach((form, index) => {
      const structure = drawForm(c, form, `f${index + 1}_`, offsets[index]!, index === Math.floor((forms.length - 1) / 2) ? "resonance" : null, cosmetics);
      c.scene.group(`form_${index + 1}`, structure.ids, `Resonance form ${index + 1} of ${single.resonanceCount}`);
    });
    c.scene.labelled(`f1_${single.atoms[0]!.id}`);
    c.scene.quantity("sigma_bonds", "σ", single.sigmaBonds);
    c.scene.quantity("pi_bonds", "π", single.piBonds);
    c.scene.quantity("resonance_structures", "n_res", single.resonanceCount);
    return c.build({ caption: `${single.label}: ${single.resonanceCount} resonance forms, σ = ${single.sigmaBonds}, π = ${single.piBonds}` });
  }

  // Several species draw side by side, each labelled; more than four would
  // be a partial list that misleads a "how many of the following" count.
  if (species.length > 4) return null;
  const toDraw = species;
  const c = new ChemScene(question, `Lewis structure${toDraw.length > 1 ? "s" : ""} of ${toDraw.map((item) => item.label).join(", ")}`, LEWIS_FAMILY);
  const { offsets, cosmetics } = rowLayout(toDraw, 80);
  toDraw.forEach((result, index) => {
    const structure = drawForm(c, result, `s${index + 1}_`, offsets[index]!, result.label, cosmetics);
    c.scene.group(`species_${index + 1}`, structure.ids, `Lewis structure of ${result.label}: σ = ${result.sigmaBonds}, π = ${result.piBonds}, lone pairs = ${result.lonePairs}`);
  });
  c.scene.labelled(`s1_${single.atoms[0]!.id}`, "s1_name");
  c.scene.quantity("sigma_bonds", "σ", single.sigmaBonds);
  c.scene.quantity("pi_bonds", "π", single.piBonds);
  c.scene.quantity("lone_pairs", "n_lp", single.lonePairs);
  return c.build({ caption: toDraw.map(captionFor).join("; ") });
}

/* ------------------------------------------------------------------------- */
/* Probes                                                                     */
/* ------------------------------------------------------------------------- */

export const LEWIS_PROBES: ReadonlyArray<{
  question: string;
  expect: "draw" | "decline";
  labels?: string[];
  forbidLabels?: string[];
  note?: string;
}> = [
  { question: "Draw the Lewis structure of CO2 and find the number of sigma and pi bonds.", expect: "draw", labels: ["C", "O", "CO_2"], forbidLabels: ["+", "-"], note: "O=C=O, two lone pairs on each O, σ 2 π 2" },
  { question: "Write the Lewis dot structure of HCN. How many pi bonds does it have?", expect: "draw", labels: ["H", "C", "N", "HCN"], forbidLabels: ["+", "-"], note: "H-C≡N, one lone pair on N, σ 2 π 2" },
  { question: "The Lewis structure of N2 molecule has how many lone pairs and pi bonds?", expect: "draw", labels: ["N", "N_2"], note: "N≡N with one lone pair on each N" },
  { question: "Draw the resonance structures of ozone O3 and mark the formal charges.", expect: "draw", labels: ["O", "+", "-", "resonance"], note: "two forms, central O carries +, single bonded O carries -" },
  { question: "Assign formal charges to each atom in the Lewis structure of the nitrate ion NO3-.", expect: "draw", labels: ["N", "O", "+", "-", "NO_3^(-)"], note: "one N=O, N is +1, two single O are -1" },
  { question: "Draw the Lewis structure of SO4^2- and state the formal charge on sulphur.", expect: "draw", labels: ["S", "O", "-", "SO_4^(2-)"], forbidLabels: ["+", "2+"], note: "JEE convention: two S=O and two S-O(-), S is 0" },
  { question: "What is the formal charge on nitrogen in the Lewis structure of NH4+?", expect: "draw", labels: ["N", "H", "+", "NH_4^(+)"], forbidLabels: ["-"], note: "four N-H, N carries +1" },
  { question: "Draw the Lewis structure of carbon monoxide CO and give the formal charge on each atom.", expect: "draw", labels: ["C", "O", "+", "-"], note: "C≡O, C is -1 and O is +1" },
  { question: "Among H2O, NH3 and CH4, which molecule has the largest number of lone pairs on the central atom? Draw their Lewis structures.", expect: "draw", labels: ["H_2O", "NH_3", "CH_4", "O", "N", "C"], note: "three structures in a row: 2, 1 and 0 lone pairs on the centre" },
  { question: "Explain why BF3 is an exception to the octet rule using its Lewis dot structure.", expect: "draw", labels: ["B", "F", "BF_3"], forbidLabels: ["+", "-"], note: "B with six electrons, three single bonds, no double bond" },
  { question: "Draw the Lewis structure of PCl5. Does phosphorus obey the octet rule?", expect: "draw", labels: ["P", "Cl", "PCl_5"], note: "expanded octet, ten electrons on P" },
  { question: "How many lone pairs are present on the central atom in the Lewis structure of XeF4?", expect: "draw", labels: ["Xe", "F", "XeF_4"], note: "two lone pairs on Xe, twelve electrons" },
  { question: "Count the sigma and pi bonds in ethene C2H4 from its Lewis structure.", expect: "draw", labels: ["C", "H", "C_2H_4"], note: "C=C chain, σ 5 π 1" },
  { question: "Draw the resonance structures of the acetate ion CH3COO-.", expect: "draw", labels: ["C", "O", "H", "-", "resonance"], note: "two forms, the negative charge moves between the two O" },
  { question: "Draw the Lewis structure of the complex [Fe(CN)6]3- and give the number of lone pairs on the ligands.", expect: "decline", note: "coordination bracket: the complex lane owns it" },
  { question: "Draw the resonance structures of benzene and count the pi bonds.", expect: "decline", note: "organic ring: the organic lane owns it" },
];
