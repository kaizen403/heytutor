/**
 * Chapter figures for chemical bonding that the Lewis, VSEPR and MO families
 * did not already draw: ionic electron transfer, Fajan factor marks, bond
 * dipole directions, orbital overlap, an explicit sigma/pi bond line, the
 * metallic electron sea, and hydrogen-bond donor/acceptor edges.
 *
 * Arrow length, level spacing and bond strokes are schematic. A Debye value,
 * an ionic radius in pm, or a bond length is written only when this module is
 * not inventing it. Ionic radii are not read from the covalent-radius table.
 */
import { molecularOverlapRequested } from "./semanticCues";
import type { SceneDocument } from "../types";
import { elementBySymbol, isMetal, valenceElectrons, type ElementRecord } from "./elements";
import { electronConfiguration } from "./electronConfiguration";
import { parseFormula, formulaTokens } from "./formula";
import { ChemScene, chemStem, type Vec2 } from "./sceneKit";

const VSEPR_FAMILY = "chem_vsepr";
const LEWIS_FAMILY = "chem_lewis";

const PHYSICS_DIPOLE = /point charge|electric dipole|revolving|magnetic moment|torque on/;
const COVALENT_METALS = new Set(["Be", "Al", "Sn", "Pb"]);
const HBD_HEAVY = new Set(["N", "O", "F"]);

type V3 = [number, number, number];

export interface DipoleInput {
  readonly formula: string;
  readonly label: string;
  readonly central: string;
  readonly centralEn: number | null;
  readonly bondPairs: number;
  readonly lonePairs: number;
  readonly ligands: readonly { symbol: string; en: number; count: number }[];
}

export interface DipoleAccount {
  readonly formula: string;
  readonly label: string;
  readonly cancels: boolean;
  readonly sense: "cancels" | "with lp" | "opposes lp" | "mixed";
  readonly sum: V3;
}

export interface IonicAccount {
  readonly formula: string;
  readonly label: string;
  readonly cation: ElementRecord;
  readonly anion: ElementRecord;
  readonly cationCount: number;
  readonly anionCount: number;
  readonly cationCharge: number;
  readonly anionCharge: number;
  readonly electronsTransferred: number;
}

export interface TopoAtom {
  readonly element: string;
  readonly hydrogens: number;
  readonly label: string;
}

export interface TopoBond {
  readonly order: 1 | 2 | 3;
  readonly a: number;
  readonly b: number;
}

export interface BondLine {
  readonly atoms: readonly TopoAtom[];
  readonly bonds: readonly TopoBond[];
  readonly sigma: number;
  readonly pi: number;
  /** Index of the unique highest-order carbon-carbon bond, when one exists. */
  readonly shorterCarbonCarbon: number | null;
}

export interface OverlapFacts {
  readonly label: string;
  readonly sigma: number;
  readonly pi: number;
  readonly hybridLabel: string | null;
}

export interface FajanFactor {
  readonly label: string;
  readonly effect: "yes" | "no";
}

export function shapeIsTheAsk(stem: string): boolean {
  return /\bvsepr\b|hybridi[sz]|bond angles?|shape of|geometry of|number of lone|lone pairs? on/.test(stem);
}

export function dipoleIsTheAsk(stem: string): boolean {
  if (PHYSICS_DIPOLE.test(stem)) return false;
  if (!/dipole/.test(stem)) return false;
  return !shapeIsTheAsk(stem);
}

export function fajanAsked(stem: string): boolean {
  return /fajan|polaris(?:ing|zing) power|polarisability|percent covalent character/.test(stem);
}

export function hydrogenBondAsked(stem: string): boolean {
  return /hydrogen bond/.test(stem);
}

export function metallicBondAsked(stem: string): boolean {
  return /metallic bond|electron sea/.test(stem);
}

export function ionicTransferAsked(stem: string): boolean {
  if (/fajan|covalent character|polaris/.test(stem)) return false;
  if (/lattice\s+(?:enthalpy|energy)|born\s*-?\s*haber/.test(stem)) return false;
  return /kossel|electrovalen|electron transfer|ionic bond/.test(stem);
}

export function overlapAsked(stem: string): boolean {
  return molecularOverlapRequested(stem);
}

export function topologyAsked(stem: string): boolean {
  return /sigma|pi\b|π|σ|shortest|bond length|bond energy|bond enthalpy/.test(stem);
}

function unit3(v: V3): V3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

function add3(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale3(a: V3, k: number): V3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

function zeroish(v: V3): boolean {
  return Math.hypot(v[0], v[1], v[2]) < 1e-6;
}

/** Ligand directions and lone-pair directions for one VSEPR class. */
function domainVectors(bondPairs: number, lonePairs: number): { ligands: V3[]; lonePairs: V3[] } | null {
  const tet = [
    unit3([1, 1, 1]),
    unit3([1, -1, -1]),
    unit3([-1, 1, -1]),
    unit3([-1, -1, 1]),
  ];
  const tri = [0, 1, 2].map((i) => {
    const t = (2 * Math.PI * i) / 3;
    return unit3([Math.cos(t), 0, Math.sin(t)]);
  });
  const axial: V3[] = [[0, 1, 0], [0, -1, 0]];
  const oct: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  // Key is bond pairs then lone pairs (AXE), not the steric-number key used by the shape layout.
  const key = `${bondPairs}-${lonePairs}`;
  switch (key) {
    case "2-0":
      return { ligands: [[1, 0, 0], [-1, 0, 0]], lonePairs: [] };
    case "2-1":
      return { ligands: tri.slice(0, 2), lonePairs: tri.slice(2) };
    case "2-2":
      return { ligands: tet.slice(0, 2), lonePairs: tet.slice(2) };
    case "2-3":
      return { ligands: axial, lonePairs: tri };
    case "3-0":
      return { ligands: tri, lonePairs: [] };
    case "3-1":
      return { ligands: tet.slice(0, 3), lonePairs: tet.slice(3) };
    case "3-2":
      return { ligands: [...axial, tri[0]!], lonePairs: tri.slice(1) };
    case "4-0":
      return { ligands: tet, lonePairs: [] };
    case "4-1":
      return { ligands: [...axial, ...tri.slice(0, 2)], lonePairs: tri.slice(2) };
    case "4-2":
      return { ligands: [oct[0]!, oct[1]!, oct[4]!, oct[5]!], lonePairs: [oct[2]!, oct[3]!] };
    case "5-0":
      return { ligands: [...axial, ...tri], lonePairs: [] };
    case "5-1":
      return { ligands: oct.slice(0, 5), lonePairs: oct.slice(5) };
    case "6-0":
      return { ligands: oct, lonePairs: [] };
    default:
      return null;
  }
}

function expandLigands(input: DipoleInput): { symbol: string; en: number }[] {
  return input.ligands.flatMap((ligand) => Array.from({ length: ligand.count }, () => ({ symbol: ligand.symbol, en: ligand.en })));
}

/**
 * Bond-dipole sum from electronegativity differences on ideal domain
 * directions. Identical-ligand cancellation is a symmetry result. Mixed
 * ligands are not given a seating-dependent zero. The returned sum is a
 * direction in arbitrary EN units, not a Debye measurement.
 */
export function dipoleAccount(input: DipoleInput): DipoleAccount | null {
  const placed = domainVectors(input.bondPairs, input.lonePairs);
  if (!placed) return null;
  const ligands = expandLigands(input);
  if (ligands.length !== placed.ligands.length) return null;
  const identical = ligands.every((ligand) => ligand.symbol === ligands[0]!.symbol);
  if (!identical) {
    return { formula: input.formula, label: input.label, cancels: false, sense: "mixed", sum: [1, 0, 0] };
  }
  if (ligands[0]!.symbol === input.central) return null;
  const geometrySum = placed.ligands.reduce((sum, vector) => add3(sum, vector), [0, 0, 0] as V3);
  const cancels = zeroish(geometrySum);
  if (cancels) return { formula: input.formula, label: input.label, cancels: true, sense: "cancels", sum: [0, 0, 0] };
  if (input.centralEn === null) return null;
  const delta = ligands[0]!.en - input.centralEn;
  if (delta === 0) return { formula: input.formula, label: input.label, cancels: true, sense: "cancels", sum: [0, 0, 0] };
  const sum = scale3(geometrySum, delta);
  const sense = delta > 0 ? "opposes lp" : "with lp";
  return { formula: input.formula, label: input.label, cancels: false, sense, sum };
}

function project(v: V3): Vec2 {
  return { x: v[0] + 0.45 * v[2], y: v[1] + 0.15 * v[2] };
}

export function buildDipoleScene(question: string, species: readonly DipoleInput[]): SceneDocument | null {
  const accounts = species.map(dipoleAccount).filter((account): account is DipoleAccount => account !== null);
  if (accounts.length === 0 || accounts.length > 4) return null;
  const c = new ChemScene(question, `bond dipole directions of ${accounts.map((account) => account.formula).join(", ")}`, VSEPR_FAMILY);
  const pitch = 3.4;
  accounts.forEach((account, index) => {
    const input = species.find((candidate) => candidate.formula === account.formula)!;
    const placed = domainVectors(input.bondPairs, input.lonePairs)!;
    const origin = { x: index * pitch, y: 0 };
    const before = c.scene.entities.length;
    const centralId = c.atom(`d${index}_A`, input.central, origin, { role: `${input.central} central atom` });
    const ligands = expandLigands(input);
    placed.ligands.forEach((vector, ligandIndex) => {
      const at = project(vector);
      const pos = { x: origin.x + at.x, y: origin.y + at.y };
      const id = c.atom(`d${index}_L${ligandIndex}`, ligands[ligandIndex]!.symbol, pos, { role: `${ligands[ligandIndex]!.symbol} ligand` });
      c.bond(`d${index}_b${ligandIndex}`, centralId, id, { role: `${input.central} to ${ligands[ligandIndex]!.symbol} bond` });
      const ligandEn = ligands[ligandIndex]!.en;
      const centralEn = input.centralEn;
      if (centralEn === null || ligandEn === centralEn) return;
      const towardLigand = ligandEn > centralEn;
      const from = towardLigand ? origin : pos;
      const to = towardLigand ? pos : origin;
      const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      const dir = { x: to.x - from.x, y: to.y - from.y };
      const length = Math.hypot(dir.x, dir.y) || 1;
      const tip = { x: mid.x + (dir.x / length) * 0.28, y: mid.y + (dir.y / length) * 0.28 };
      const tail = { x: mid.x - (dir.x / length) * 0.28, y: mid.y - (dir.y / length) * 0.28 };
      c.arrow(`d${index}_p${ligandIndex}`, tail, tip, "bond dipole direction");
    });
    placed.lonePairs.forEach((vector, pairIndex) => {
      const at = project(vector);
      const deg = (Math.atan2(at.y, at.x) * 180) / Math.PI;
      c.lonePair(`d${index}_lp${pairIndex}`, centralId, deg, 0.42);
    });
    c.text(`d${index}_name`, { x: origin.x, y: 1.7 }, account.label, "species formula");
    c.text(`d${index}_sense`, { x: origin.x, y: -1.85 }, account.sense, "dipole sense");
    const ids = c.scene.entities.slice(before).map((entity) => entity.id);
    c.scene.group(`dipole_${index + 1}`, ids, `${account.formula}: bond dipoles ${account.sense}; arrow length is not a measured dipole`, index === 0 ? [] : [`dipole_${index}`]);
  });
  c.text("dipole_note", { x: ((accounts.length - 1) * pitch) / 2, y: -2.45 }, "not measured", "dipole arrows are directions");
  return c.build({ caption: accounts.map((account) => `${account.label} ${account.sense}`).join("; ").slice(0, 60) });
}

const FAJAN_RULES: readonly { re: RegExp; label: string; effect: "yes" | "no" }[] = [
  { re: /polaris(?:ing|zing) power of the anion/, label: "anion power", effect: "no" },
  { re: /polaris(?:ing|zing) power of the cation/, label: "cation power", effect: "yes" },
  { re: /distortion of the anion/, label: "anion distort", effect: "yes" },
  { re: /polarisability of the anion/, label: "anion polar.", effect: "yes" },
  { re: /(?:small|size of the) cation|cation radius/, label: "cation size", effect: "yes" },
  { re: /(?:large|size of the) anion|anion radius/, label: "anion size", effect: "yes" },
];

export function fajanFactors(stem: string): FajanFactor[] {
  const parts = stem.split(/\([a-d]\)/i).map((part) => part.trim()).filter(Boolean);
  const phrases = parts.length > 1 ? parts : [stem];
  const found: FajanFactor[] = [];
  for (const phrase of phrases) {
    const rule = FAJAN_RULES.find((candidate) => candidate.re.test(phrase));
    if (!rule) continue;
    if (found.some((factor) => factor.label === rule.label)) continue;
    found.push({ label: rule.label, effect: rule.effect });
  }
  return found;
}

function cationChargeOf(element: ElementRecord): number | null {
  if (COVALENT_METALS.has(element.symbol)) return null;
  if (element.block !== "s" || element.group === null || element.group > 2) return null;
  return element.group;
}

export function buildFajanScene(question: string): SceneDocument | null {
  const stem = chemStem(question);
  if (!fajanAsked(stem) || PHYSICS_DIPOLE.test(stem)) return null;
  const factors = fajanFactors(stem);
  const c = new ChemScene(question, "Fajan factors named in the question", VSEPR_FAMILY);
  if (factors.length >= 2) {
    factors.forEach((factor, index) => {
      const y = 1.2 - index * 0.75;
      c.text(`f_label_${index}`, { x: 0, y }, factor.label, "Fajan factor");
      c.text(`f_effect_${index}`, { x: 2.2, y }, factor.effect, factor.effect === "yes" ? "increases covalent character" : "not a Fajan factor");
    });
    c.text("f_note", { x: 1, y: 1.2 - factors.length * 0.75 }, "no ionic pm", "covalent radii are not used as ionic radii");
    const ids = c.scene.entities.map((entity) => entity.id);
    c.scene.group("factors", ids, "Fajan factors from the stem; yes increases covalent character");
    return c.build({ caption: "Fajan factors in the question" });
  }
  const salts = formulaTokens(question)
    .map((token) => ionicAccount(token))
    .filter((account): account is IonicAccount => account !== null);
  if (salts.length < 2) return null;
  const ranked = [...salts].sort((a, b) => b.cationCharge - a.cationCharge);
  if (ranked[0]!.cationCharge === ranked[1]!.cationCharge) {
    c.text("same_charge", { x: 0, y: 0 }, "charge equal", "cation charges match");
    c.text("no_radius", { x: 0, y: -0.8 }, "no radius", "covalent radius is not an ionic radius");
  } else {
    ranked.forEach((salt, index) => {
      c.text(`salt_${index}`, { x: index * 2.4, y: 0.4 }, salt.label, "salt");
      c.text(`chg_${index}`, { x: index * 2.4, y: -0.4 }, `charge ${salt.cationCharge}`, "cation count");
    });
    c.text("rank_note", { x: 1.2, y: -1.3 }, "charge only", "higher cation count polarises more; radius not measured");
  }
  const ids = c.scene.entities.map((entity) => entity.id);
  c.scene.group("salts", ids, "Fajan comparison uses cation charge only");
  return c.build({ caption: "Fajan charge comparison" });
}

function shellLabel(symbol: string, charge: number): string | null {
  const config = electronConfiguration(symbol, charge);
  if (!config) return null;
  const element = elementBySymbol(symbol);
  if (!element || config.electrons !== element.z - charge) return null;
  const maxN = Math.max(...config.subshells.map((subshell) => subshell.n));
  const text = config.subshells.filter((subshell) => subshell.n === maxN).map((subshell) => `${subshell.n}${subshell.l}${subshell.electrons}`).join(" ");
  return text.length > 0 && text.length <= 16 ? text : null;
}

function chargeText(charge: number): string {
  const sign = charge > 0 ? "+" : "-";
  const magnitude = Math.abs(charge);
  return magnitude === 1 ? sign : `${magnitude}${sign}`;
}

export function ionicAccount(formulaText: string): IonicAccount | null {
  const parsed = parseFormula(formulaText);
  if (!parsed || parsed.charge !== 0 || parsed.atoms.length !== 2) return null;
  const [first, second] = parsed.atoms;
  if (!first || !second) return null;
  const metal = isMetal(first.element) ? first : isMetal(second.element) ? second : null;
  const nonmetal = metal === first ? second : metal === second ? first : null;
  if (!metal || !nonmetal) return null;
  if (COVALENT_METALS.has(metal.symbol) || nonmetal.element.block === "d" || nonmetal.element.block === "f") return null;
  const cationCharge = cationChargeOf(metal.element);
  if (cationCharge === null) return null;
  const anionValence = valenceElectrons(nonmetal.element);
  const anionCharge = anionValence - 8;
  if (anionCharge >= 0 || anionCharge < -3) return null;
  if (metal.count * cationCharge + nonmetal.count * anionCharge !== 0) return null;
  const body = `${metal.symbol}${metal.count > 1 ? metal.count : ""}${nonmetal.symbol}${nonmetal.count > 1 ? nonmetal.count : ""}`;
  return {
    formula: parsed.text,
    label: body,
    cation: metal.element,
    anion: nonmetal.element,
    cationCount: metal.count,
    anionCount: nonmetal.count,
    cationCharge,
    anionCharge,
    electronsTransferred: metal.count * cationCharge,
  };
}

export function buildIonicTransferScene(question: string): SceneDocument | null {
  const accounts = formulaTokens(question).map(ionicAccount).filter((account): account is IonicAccount => account !== null);
  const unique = accounts.filter((account, index) => accounts.findIndex((other) => other.label === account.label) === index).slice(0, 2);
  if (unique.length === 0) return null;
  const c = new ChemScene(question, `electron transfer in ${unique.map((account) => account.label).join(", ")}`, LEWIS_FAMILY);
  unique.forEach((account, index) => {
    const x0 = index * 6.2;
    const neutralCation = shellLabel(account.cation.symbol, 0);
    const neutralAnion = shellLabel(account.anion.symbol, 0);
    const ionCation = shellLabel(account.cation.symbol, account.cationCharge);
    const ionAnion = shellLabel(account.anion.symbol, account.anionCharge);
    if (!neutralCation || !neutralAnion || !ionCation || !ionAnion) return;
    const before = c.scene.entities.length;
    c.text(`ncat_${index}`, { x: x0, y: 1.3 }, account.cation.symbol, "neutral cation atom");
    c.text(`ncat_sh_${index}`, { x: x0, y: 0.7 }, neutralCation, "cation valence shell");
    c.text(`nan_${index}`, { x: x0 + 2.6, y: 1.3 }, account.anion.symbol, "neutral anion atom");
    c.text(`nan_sh_${index}`, { x: x0 + 2.6, y: 0.7 }, neutralAnion, "anion valence shell");
    c.arrow(`transfer_${index}`, { x: x0 + 0.7, y: 1.3 }, { x: x0 + 1.8, y: 1.3 }, "electron transfer", "e-");
    c.text(`icat_${index}`, { x: x0, y: -0.3 }, `${account.cation.symbol}^(${chargeText(account.cationCharge)})`, "cation");
    c.text(`icat_sh_${index}`, { x: x0, y: -0.9 }, ionCation, "cation shell after transfer");
    c.text(`ian_${index}`, { x: x0 + 2.6, y: -0.3 }, `${account.anion.symbol}^(${chargeText(account.anionCharge)})`, "anion");
    c.text(`ian_sh_${index}`, { x: x0 + 2.6, y: -0.9 }, ionAnion, "anion shell after transfer");
    c.text(`balance_${index}`, { x: x0 + 1.3, y: -1.6 }, "neutral", "formula is neutral");
    const ids = c.scene.entities.slice(before).map((entity) => entity.id);
    c.scene.group(`ionic_${index + 1}`, ids, `${account.label}: ${account.electronsTransferred} electron${account.electronsTransferred === 1 ? "" : "s"} transferred, ions sum to zero`, index === 0 ? [] : [`ionic_${index}`]);
  });
  if (c.scene.entities.length === 0) return null;
  return c.build({ caption: unique.map((account) => account.label).join(", ").slice(0, 60) });
}

const BOND_CAP: Record<string, number> = { C: 4, N: 3, O: 2, S: 2, F: 1, Cl: 1, Br: 1, I: 1, H: 1 };

function readTopoAtom(line: string, at: number): { atom: TopoAtom; next: number } | null {
  const specials: readonly [string, string, number, string][] = [
    ["OH", "O", 1, "OH"],
    ["NH2", "N", 2, "NH_2"],
    ["Cl", "Cl", 0, "Cl"],
    ["Br", "Br", 0, "Br"],
  ];
  for (const [token, element, hydrogens, label] of specials) {
    if (line.startsWith(token, at)) return { atom: { element, hydrogens, label }, next: at + token.length };
  }
  const match = /^([A-Z][a-z]?)(H(\d*))?/.exec(line.slice(at));
  if (!match || !elementBySymbol(match[1]!)) return null;
  const element = match[1]!;
  const hydrogens = match[2] ? (match[3] ? Number(match[3]) : 1) : 0;
  const label = hydrogens > 1 ? `${element}H_${hydrogens}` : hydrogens === 1 ? `${element}H` : element;
  return { atom: { element, hydrogens, label }, next: at + match[0].length };
}

const BOND_LINE = /(?:OH|NH2|Cl|Br|[A-Z][a-z]?(?:H\d*)?)(?:\s*[#=-]\s*(?:OH|NH2|Cl|Br|[A-Z][a-z]?(?:H\d*)?))+/g;

/** One written bond line. Returns null when the string is not a closed valence line. */
function bondLineFrom(line: string): BondLine | null {
  const atoms: TopoAtom[] = [];
  const bonds: TopoBond[] = [];
  let cursor = 0;
  const first = readTopoAtom(line, cursor);
  if (!first || first.next === 0) return null;
  atoms.push(first.atom);
  cursor = first.next;
  while (cursor < line.length) {
    const mark = line[cursor];
    const order = mark === "#" ? 3 : mark === "=" ? 2 : mark === "-" ? 1 : 0;
    if (order === 0) return null;
    cursor += 1;
    const next = readTopoAtom(line, cursor);
    if (!next) return null;
    bonds.push({ order: order as 1 | 2 | 3, a: atoms.length - 1, b: atoms.length });
    atoms.push(next.atom);
    cursor = next.next;
  }
  if (cursor !== line.length || bonds.length === 0) return null;
  for (let index = 0; index < atoms.length; index += 1) {
    const atom = atoms[index]!;
    const cap = BOND_CAP[atom.element];
    if (cap === undefined) return null;
    const used = bonds.filter((bond) => bond.a === index || bond.b === index).reduce((sum, bond) => sum + bond.order, 0) + atom.hydrogens;
    if (used !== cap) return null;
  }
  const sigma = bonds.length + atoms.reduce((sum, atom) => sum + atom.hydrogens, 0);
  const pi = bonds.reduce((sum, bond) => sum + bond.order - 1, 0);
  const carbonCarbon = bonds
    .map((bond, index) => ({ bond, index }))
    .filter(({ bond }) => atoms[bond.a]!.element === "C" && atoms[bond.b]!.element === "C");
  let shorterCarbonCarbon: number | null = null;
  if (carbonCarbon.length > 0) {
    const top = Math.max(...carbonCarbon.map(({ bond }) => bond.order));
    const winners = carbonCarbon.filter(({ bond }) => bond.order === top);
    if (winners.length === 1 && carbonCarbon.some(({ bond }) => bond.order < top)) shorterCarbonCarbon = winners[0]!.index;
  }
  return { atoms, bonds, sigma, pi, shorterCarbonCarbon };
}

/**
 * A written bond line such as CH2=CH-C≡N. Bare fragments such as C=C fail
 * valence and are skipped so a later closed formula in the same sentence can match.
 */
export function parseExamBondLines(text: string): BondLine[] {
  const normalized = text.replace(/[–—−]/g, "-").replace(/≡/g, "#");
  const lines: BondLine[] = [];
  for (const match of normalized.matchAll(BOND_LINE)) {
    const parsed = bondLineFrom(match[0].replace(/\s+/g, ""));
    if (parsed) lines.push(parsed);
  }
  return lines;
}

export function parseExamBondLine(text: string): BondLine | null {
  return parseExamBondLines(text)[0] ?? null;
}

export function buildBondTopologyScene(question: string, lines: readonly BondLine[]): SceneDocument | null {
  if (lines.length === 0) return null;
  if (lines.length > 1) return buildBondLineComparison(question, lines);
  const line = lines[0]!;
  const c = new ChemScene(question, `sigma and pi topology, ${line.sigma} sigma and ${line.pi} pi`, LEWIS_FAMILY);
  const spacing = 1.7;
  const ids: string[] = [];
  line.atoms.forEach((atom, index) => {
    ids.push(c.atom(`t_${index}`, atom.label, { x: index * spacing, y: 0 }, { role: `${atom.element} atom` }));
  });
  line.bonds.forEach((bond, index) => {
    ids.push(...c.bond(`tb_${index}`, `t_${bond.a}`, `t_${bond.b}`, {
      order: bond.order,
      role: `bond order ${bond.order}`,
    }));
  });
  const countId = c.text("counts", { x: ((line.atoms.length - 1) * spacing) / 2, y: -1.1 }, `sigma ${line.sigma}`, "sigma count");
  const piId = c.text("pi_count", { x: ((line.atoms.length - 1) * spacing) / 2, y: -1.7 }, `pi ${line.pi}`, "pi count");
  ids.push(countId, piId);
  if (line.shorterCarbonCarbon !== null && /shortest/.test(chemStem(question))) {
    const bond = line.bonds[line.shorterCarbonCarbon]!;
    const x = ((bond.a + bond.b) / 2) * spacing;
    ids.push(c.text("shorter", { x, y: 0.85 }, "higher order", "higher bond order, not a measured length"));
  }
  const quoted = quotedMeasures(question);
  quoted.forEach((value, index) => {
    ids.push(c.text(`quoted_${index}`, { x: index * 1.8, y: -2.4 }, value, "value stated in the question"));
  });
  if (quoted.length === 0) ids.push(c.text("no_length", { x: ((line.atoms.length - 1) * spacing) / 2, y: 1.45 }, "not measured", "equal strokes are not bond lengths"));
  c.scene.group("topology", ids, `${line.sigma} sigma and ${line.pi} pi; stroke length is not energy or bond length`);
  return c.build({ caption: `sigma ${line.sigma}, pi ${line.pi}` });
}

function buildBondLineComparison(question: string, lines: readonly BondLine[]): SceneDocument | null {
  const c = new ChemScene(question, "bond lines compared with the lengths stated in the question", LEWIS_FAMILY);
  const spacing = 1.7;
  const panel = Math.max(...lines.map((line) => line.atoms.length)) * spacing + 1.2;
  const ids: string[] = [];
  lines.forEach((line, panelIndex) => {
    const x0 = panelIndex * panel;
    line.atoms.forEach((atom, index) => {
      ids.push(c.atom(`t_${panelIndex}_${index}`, atom.label, { x: x0 + index * spacing, y: 0 }, { role: `${atom.element} atom` }));
    });
    line.bonds.forEach((bond, index) => {
      ids.push(...c.bond(`tb_${panelIndex}_${index}`, `t_${panelIndex}_${bond.a}`, `t_${panelIndex}_${bond.b}`, {
        order: bond.order,
        role: `bond order ${bond.order}`,
      }));
    });
    const mid = x0 + ((line.atoms.length - 1) * spacing) / 2;
    ids.push(c.text(`counts_${panelIndex}`, { x: mid, y: -1.15 }, `sigma ${line.sigma}`, "sigma count"));
    ids.push(c.text(`pi_${panelIndex}`, { x: mid, y: -1.8 }, `pi ${line.pi}`, "pi count"));
  });
  const quoted = quotedMeasures(question);
  const span = (lines.length - 1) * panel + (lines[lines.length - 1]!.atoms.length - 1) * spacing;
  quoted.forEach((value, index) => {
    ids.push(c.text(`quoted_${index}`, { x: (span * index) / Math.max(quoted.length - 1, 1), y: -2.7 }, value, "value stated in the question"));
  });
  if (quoted.length === 0) {
    ids.push(c.text("no_length", { x: span / 2, y: -2.7 }, "not measured", "equal strokes are not bond lengths"));
  }
  c.scene.group("topology", ids, "each formula keeps its own sigma and pi count; stated lengths are quoted, not measured from the strokes");
  return c.build({ caption: lines.map((line) => `sigma ${line.sigma}`).join(", ").slice(0, 60) });
}

function quotedMeasures(question: string): string[] {
  const matches = question.matchAll(/(\d+(?:\.\d+)?)\s*(pm|kJ\/mol|kJ)/gi);
  return [...matches].map((match) => `${match[1]} ${match[2]}`).filter((label) => label.length <= 16).slice(0, 4);
}

export function buildOverlapScene(question: string, facts: OverlapFacts): SceneDocument | null {
  if (facts.sigma < 1) return null;
  const stem = chemStem(question);
  if (/sideways|lateral/.test(stem) && facts.pi < 1) return null;
  const c = new ChemScene(question, `orbital overlap in ${facts.label}`, LEWIS_FAMILY);
  const ids: string[] = [];
  ids.push(c.text("formula", { x: 1.2, y: 1.7 }, facts.label, "species"));
  ids.push(c.level("sigma_left", { x: 0, y: 0.3 }, 0.7, "head-on orbital"));
  ids.push(c.level("sigma_right", { x: 1.5, y: 0.3 }, 0.7, "head-on orbital"));
  ids.push(c.text("sigma_name", { x: 0.75, y: -0.25 }, "sigma", "head-on overlap"));
  if (facts.pi > 0) {
    ids.push(c.level("pi_a", { x: 3.2, y: 0.7 }, 0.7, "sideways orbital"));
    ids.push(c.level("pi_b", { x: 3.2, y: -0.1 }, 0.7, "sideways orbital"));
    ids.push(c.text("pi_name", { x: 3.2, y: -0.7 }, "pi", "sideways overlap"));
  }
  ids.push(c.text("sigma_count", { x: 0.75, y: -1.15 }, `sigma ${facts.sigma}`, "sigma bond count"));
  ids.push(c.text("pi_count", { x: facts.pi > 0 ? 3.2 : 2.4, y: -1.15 }, `pi ${facts.pi}`, "pi bond count"));
  if (facts.hybridLabel) ids.push(c.text("hybrid", { x: 1.8, y: 1.05 }, facts.hybridLabel, "hybrid orbitals equal orbitals combined"));
  c.scene.group("overlap", ids, `${facts.label}: head-on sigma overlap${facts.pi > 0 ? " and sideways pi overlap" : ""}; drawings are not measured energies`);
  return c.build({ caption: `${facts.label}: sigma ${facts.sigma}, pi ${facts.pi}`.slice(0, 60) });
}

const METAL_NAMES: readonly [RegExp, string][] = [
  [/\bsodium\b|\bna\b/, "Na"],
  [/\bpotassium\b|\bk\b/, "K"],
  [/\blithium\b|\bli\b/, "Li"],
  [/\bmagnesium\b|\bmg\b/, "Mg"],
  [/\bcalcium\b|\bca\b/, "Ca"],
  [/\baluminium\b|\baluminum\b|\bal\b/, "Al"],
];

export function metallicAccount(stem: string): { symbol: string; charge: number; electrons: number } | null {
  const found = METAL_NAMES.find(([pattern]) => pattern.test(stem));
  if (!found) return null;
  const element = elementBySymbol(found[1]);
  if (!element || !isMetal(element)) return null;
  if (element.block === "d" || element.block === "f") return null;
  const charge = element.symbol === "Al" ? 3 : element.block === "s" && element.group !== null && element.group <= 2 ? element.group : null;
  if (charge === null) return null;
  const ions = 3;
  return { symbol: element.symbol, charge, electrons: ions * charge };
}

export function buildMetallicScene(question: string): SceneDocument | null {
  const account = metallicAccount(chemStem(question));
  if (!account) return null;
  const c = new ChemScene(question, `metallic bonding in ${account.symbol}`, LEWIS_FAMILY);
  const ids: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    ids.push(c.text(`ion_${index}`, { x: index * 1.6, y: 0 }, `${account.symbol}^(${chargeText(account.charge)})`, "metal cation"));
  }
  const centre = c.scene.helper("sea_c", { x: 1.6, y: 0.85 }, "electron sea centre");
  const rect = c.scene.rectangle("sea_box", centre, 4.2, 0.7, "delocalised valence electrons");
  const entity = c.scene.entities.find((candidate) => candidate.id === rect);
  if (entity) entity.provenance = { dashed: true, strokeRole: "construction" };
  ids.push(rect, centre);
  ids.push(c.text("sea_label", { x: 1.6, y: 0.85 }, "e- sea", "delocalised electrons"));
  ids.push(c.text("count", { x: 1.6, y: -0.8 }, `${account.electrons} e-`, "electron count matches the cations"));
  ids.push(c.text("neutral", { x: 1.6, y: -1.45 }, "neutral", "cations plus electrons are neutral"));
  c.scene.group("ions", ids.filter((id) => id.startsWith("ion_")), "metal cations");
  c.scene.group("sea_group", ids.filter((id) => !id.startsWith("ion_")), "delocalised valence electrons, not localised bonds on one cation", ["ions"]);
  return c.build({ caption: `${account.symbol} electron sea` });
}

function hexPoint(index: number, radius: number): Vec2 {
  const angle = ((Math.PI * 2) / 6) * index - Math.PI / 2;
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

function trimmedEnds(from: Vec2, to: Vec2, trim: number): [Vec2, Vec2] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return [
    { x: from.x + (dx / length) * trim, y: from.y + (dy / length) * trim },
    { x: to.x - (dx / length) * trim, y: to.y - (dy / length) * trim },
  ];
}

function drawNitrophenol(c: ChemScene, origin: Vec2, ortho: boolean, tag: string): string[] {
  const ids: string[] = [];
  const radius = 1.05;
  const carbons = [0, 1, 2, 3, 4, 5].map((index) => {
    const at = hexPoint(index, radius);
    return { x: origin.x + at.x, y: origin.y + at.y };
  });
  carbons.forEach((at, index) => {
    ids.push(c.atom(`${tag}_c${index}`, "C", at, { role: "ring carbon" }));
  });
  const doubles = new Set(["0-5", "1-2", "3-4"]);
  for (let index = 0; index < 6; index += 1) {
    const next = (index + 1) % 6;
    const key = `${Math.min(index, next)}-${Math.max(index, next)}`;
    ids.push(...c.bond(`${tag}_r${index}`, `${tag}_c${index}`, `${tag}_c${next}`, {
      order: doubles.has(key) ? 2 : 1,
      role: "ring bond",
    }));
  }
  const outward = (index: number, distance: number): Vec2 => {
    const at = hexPoint(index, radius + distance);
    return { x: origin.x + at.x, y: origin.y + at.y };
  };
  const oxygen = outward(0, 0.9);
  const hydrogen = outward(0, 1.85);
  ids.push(c.atom(`${tag}_o`, "O", oxygen, { role: "phenol oxygen donor" }));
  ids.push(c.atom(`${tag}_h`, "H", hydrogen, { role: "donor hydrogen" }));
  ids.push(...c.bond(`${tag}_co`, `${tag}_c0`, `${tag}_o`, { role: "C-O bond" }));
  ids.push(...c.bond(`${tag}_oh`, `${tag}_o`, `${tag}_h`, { role: "O-H bond" }));
  const nitroSite = ortho ? 1 : 3;
  const nitrogen = outward(nitroSite, 0.95);
  ids.push(c.atom(`${tag}_n`, "N", nitrogen, { role: "nitro nitrogen" }));
  const plusAt = outward(nitroSite, 0.95);
  ids.push(c.text(`${tag}_np`, { x: plusAt.x + 0.48, y: plusAt.y }, "+", "nitro plus mark"));
  ids.push(...c.bond(`${tag}_cn`, `${tag}_c${nitroSite}`, `${tag}_n`, { role: "C-N bond" }));
  const base = hexPoint(nitroSite, 1);
  const side = (sign: number, distance: number): Vec2 => {
    const angle = Math.atan2(base.y, base.x) + sign * 0.85;
    return {
      x: nitrogen.x + Math.cos(angle) * distance,
      y: nitrogen.y + Math.sin(angle) * distance,
    };
  };
  const acceptor = side(ortho ? -1 : 1, 0.95);
  const carbonyl = side(ortho ? 1 : -1, 0.95);
  ids.push(c.atom(`${tag}_oa`, "O", acceptor, { role: "nitro acceptor oxygen" }));
  const away = {
    x: acceptor.x + (acceptor.x - nitrogen.x) * 0.45,
    y: acceptor.y + (acceptor.y - nitrogen.y) * 0.45,
  };
  ids.push(c.text(`${tag}_oam`, away, "-", "acceptor minus mark"));
  ids.push(c.atom(`${tag}_ob`, "O", carbonyl, { role: "nitro oxygen" }));
  ids.push(...c.bond(`${tag}_noa`, `${tag}_n`, `${tag}_oa`, { role: "N-O single bond" }));
  ids.push(...c.bond(`${tag}_nob`, `${tag}_n`, `${tag}_ob`, { order: 2, role: "N=O bond" }));
  if (ortho) {
    const [from, to] = trimmedEnds(hydrogen, acceptor, 0.42);
    ids.push(c.link(`${tag}_hb`, from, to, "intramolecular hydrogen bond"));
    ids.push(c.text(`${tag}_kind`, { x: origin.x, y: origin.y + radius + 2.35 }, "intra", "intramolecular hydrogen bond"));
  } else {
    ids.push(c.text(`${tag}_kind`, { x: origin.x, y: origin.y - radius - 4.15 }, "no intra", "para isomer has no intramolecular hydrogen bond"));
  }
  ids.push(c.text(`${tag}_title`, { x: origin.x, y: origin.y - radius - 3.15 }, ortho ? "o-nitrophenol" : "p-nitrophenol", "isomer"));
  return ids;
}

export function buildHydrogenBondScene(question: string): SceneDocument | null {
  const stem = chemStem(question);
  if (!hydrogenBondAsked(stem)) return null;
  const ortho = /(?:\bo-|\bortho[\s-]?)nitrophenol/.test(stem);
  const para = /(?:\bp-|\bpara[\s-]?)nitrophenol/.test(stem);
  if (/methane|ch4|hydrogen chloride|\bhcl\b/.test(stem) && !ortho && !para) return null;
  const c = new ChemScene(question, "hydrogen bond donor and acceptor", LEWIS_FAMILY);
  if (ortho || para) {
    const ids: string[] = [];
    if (ortho) ids.push(...drawNitrophenol(c, { x: ortho && para ? -3.8 : 0, y: 0 }, true, "o"));
    if (para) ids.push(...drawNitrophenol(c, { x: ortho ? 3.8 : 0, y: 0 }, false, "p"));
    if (ortho && para) {
      ids.push(c.text("inter_note", { x: 0, y: 0.15 }, "inter", "p-nitrophenol hydrogen bonds between molecules"));
    }
    c.scene.group("hbonds", ids, ortho && para
      ? "o-nitrophenol has an intramolecular O-H...O bond; p-nitrophenol does not"
      : "hydrogen bond donor is H on O and the acceptor is O");
    return c.build({ caption: ortho && para ? "intra versus inter" : ortho ? "intramolecular" : "no intramolecular" });
  }
  const heavy = /\bhf\b|hydrogen fluoride/.test(stem) ? "F" : /\bammonia\b|\bnh3\b/.test(stem) ? "N" : /\bwater\b|\bh2o\b/.test(stem) ? "O" : null;
  if (heavy && HBD_HEAVY.has(heavy)) {
    const ids: string[] = [];
    ids.push(c.atom("a_x", heavy, { x: 0, y: 0.2 }, { role: `${heavy} donor atom` }));
    ids.push(c.atom("a_h", "H", { x: 1.05, y: -0.25 }, { role: "donor hydrogen" }));
    ids.push(...c.bond("a_b", "a_x", "a_h", { role: `${heavy}-H bond` }));
    ids.push(c.atom("b_x", heavy, { x: 2.5, y: 0.2 }, { role: `${heavy} acceptor` }));
    ids.push(c.atom("b_h", "H", { x: 3.45, y: 0.55 }, { role: "second hydrogen" }));
    ids.push(...c.bond("b_b", "b_x", "b_h", { role: `${heavy}-H bond` }));
    ids.push(c.link("hb", { x: 1.05, y: -0.25 }, { x: 2.5, y: 0.2 }, "intermolecular hydrogen bond"));
    ids.push(c.text("kind", { x: 1.3, y: -1.1 }, "inter", "intermolecular hydrogen bond"));
    ids.push(c.text("pair", { x: 1.3, y: 1.15 }, heavy === "F" ? "HF" : heavy === "N" ? "NH_3" : "H_2O", "molecules"));
    c.scene.group("hbonds", ids, `intermolecular hydrogen bond from H on ${heavy} to ${heavy}`);
    return c.build({ caption: `${heavy} intermolecular` });
  }
  return null;
}
