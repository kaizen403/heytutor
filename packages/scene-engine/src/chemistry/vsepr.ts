/**
 * VSEPR family: the shape of a molecule or ion from its formula alone.
 *
 * The solver counts the central atom's electrons the way the exam does:
 * every monovalent ligand (H, halogen, OH) takes one electron, a terminal
 * chalcogen takes two, a terminal N takes three, and the ion charge is put
 * on the central atom. What is left, halved, is the lone pair count; the
 * steric number gives the hybridisation and the (bond pair, lone pair)
 * class gives the shape. Nothing here is a stock molecule: a formula that
 * does not resolve to one central atom with a consistent electron count
 * draws nothing.
 *
 * The figure is the textbook projection of that class (in-plane bonds,
 * wedges towards the viewer, dashes away), lone pairs as dot pairs at their
 * domain positions, one characteristic bond angle when the class or a
 * measured table grounds it, and the hybridisation and shape written under
 * the molecule.
 */
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, type BondStyle, type ChemPlanQuantity, type Vec2 } from "./sceneKit";
import { formulaTokens, normalizeChemistryText, parseFormula, type ParsedFormula } from "./formula";
import { isMonovalent, valenceElectrons, type ElementRecord } from "./elements";

export const VSEPR_FAMILY = "chem_vsepr" as const;

/* ------------------------------------------------------------------------- */
/* Solver                                                                    */
/* ------------------------------------------------------------------------- */

export type Hybridisation = "sp" | "sp2" | "sp3" | "sp3d" | "sp3d2" | "sp3d3";

export type ElectronGeometry =
  | "linear"
  | "trigonal planar"
  | "tetrahedral"
  | "trigonal bipyramidal"
  | "octahedral"
  | "pentagonal bipyramidal";

export type VseprShape =
  | "linear"
  | "bent"
  | "trigonal planar"
  | "tetrahedral"
  | "trigonal pyramidal"
  | "trigonal bipyramidal"
  | "see-saw"
  | "T-shaped"
  | "octahedral"
  | "square pyramidal"
  | "square planar"
  | "pentagonal bipyramidal"
  | "distorted octahedral"
  | "pentagonal planar";

export interface VseprLigand {
  /** Element symbol, or "OH" for a hydroxyl group of an oxoacid. */
  readonly symbol: string;
  /** Text drawn at the ligand position. */
  readonly label: string;
  readonly count: number;
  /** Electrons the ligand takes from the central atom (its bond order). */
  readonly bondOrder: 1 | 2 | 3;
  readonly electronegativity: number;
}

export interface VseprResult {
  /** Formula as written, notation normalised (e.g. "SO4^(2-)"). */
  readonly formula: string;
  /** Board label with scripts (e.g. "SO_4^(2-)"). */
  readonly label: string;
  readonly central: ElementRecord;
  readonly ligands: readonly VseprLigand[];
  readonly charge: number;
  /** Valence electrons of the central atom (V). */
  readonly valence: number;
  readonly bondPairs: number;
  /** Lone pairs on the central atom (E); a radical's odd electron counts as one domain. */
  readonly lonePairs: number;
  readonly unpairedElectron: boolean;
  readonly stericNumber: number;
  readonly hybridisation: Hybridisation;
  /** Board text for the hybridisation (e.g. "sp^3d^2"). */
  readonly hybridisationLabel: string;
  readonly electronGeometry: ElectronGeometry;
  readonly shape: VseprShape;
  /** Board text for the shape, at most 16 characters (e.g. "sq. pyramidal"). */
  readonly shapeLabel: string;
  /** VSEPR class, e.g. "AX4E". */
  readonly axe: string;
  /** Characteristic bond angle to write, or null when no true single value exists. */
  readonly bondAngle: string | null;
  /** Angle (degrees) the two marked bonds are drawn at in the plane of the paper. */
  readonly drawnAngle: number;
}

const HYBRIDISATION: Record<number, [Hybridisation, string, ElectronGeometry]> = {
  2: ["sp", "sp", "linear"],
  3: ["sp2", "sp^2", "trigonal planar"],
  4: ["sp3", "sp^3", "tetrahedral"],
  5: ["sp3d", "sp^3d", "trigonal bipyramidal"],
  6: ["sp3d2", "sp^3d^2", "octahedral"],
  7: ["sp3d3", "sp^3d^3", "pentagonal bipyramidal"],
};

const SHAPES: Record<string, [VseprShape, string]> = {
  "2-0": ["linear", "linear"],
  "3-0": ["trigonal planar", "trig. planar"],
  "3-1": ["bent", "bent"],
  "4-0": ["tetrahedral", "tetrahedral"],
  "4-1": ["trigonal pyramidal", "trig. pyramidal"],
  "4-2": ["bent", "bent"],
  "5-0": ["trigonal bipyramidal", "TBP"],
  "5-1": ["see-saw", "see-saw"],
  "5-2": ["T-shaped", "T-shaped"],
  "5-3": ["linear", "linear"],
  "6-0": ["octahedral", "octahedral"],
  "6-1": ["square pyramidal", "sq. pyramidal"],
  "6-2": ["square planar", "sq. planar"],
  "7-0": ["pentagonal bipyramidal", "pent. bipyr."],
  "7-1": ["distorted octahedral", "dist. octahedral"],
  "7-2": ["pentagonal planar", "pent. planar"],
};

/**
 * Measured bond angles the exam quotes, keyed by composition and charge.
 * Anything not here gets the class rule (an exact ideal angle, an
 * inequality the lone pairs guarantee, or nothing).
 */
const KNOWN_ANGLES: Record<string, string> = {
  "H2O|0": "104.5°",
  "H2S|0": "92°",
  "H3N|0": "107°",
  "H3P|0": "93.5°",
  "O2S|0": "119.5°",
  "O3|0": "117°",
  "NO2|-1": "115°",
  "NO2|0": "134°",
  "ClF3|0": "87.5°",
  "BrF3|0": "86.2°",
  "F2O|0": "103°",
  "Cl2O|0": "111°",
};

/** Elements that can carry a hydrogen directly (H is never on a halogen or noble gas). */
const HYDRIDE_CENTRES = new Set(["Be", "B", "Al", "C", "Si", "Ge", "Sn", "N", "P", "As", "Sb", "O", "S", "Se", "Te"]);

function compositionKey(parsed: ParsedFormula): string {
  const parts = [...parsed.atoms]
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map((atom) => `${atom.symbol}${atom.count > 1 ? atom.count : ""}`);
  return `${parts.join("")}|${parsed.charge}`;
}

function boardLabel(parsed: ParsedFormula): string {
  const body = parsed.atoms.map((atom) => `${atom.symbol}${atom.count > 1 ? `_${atom.count}` : ""}`).join("");
  if (parsed.charge === 0) return body;
  const magnitude = Math.abs(parsed.charge);
  const sign = parsed.charge < 0 ? "-" : "+";
  return `${body}^(${magnitude > 1 ? magnitude : ""}${sign})`;
}

function ligandOrder(element: ElementRecord): 1 | 2 | 3 | null {
  if (isMonovalent(element)) return 1;
  if (element.group === 16) return 2;
  if (element.symbol === "N" || element.symbol === "P") return 3;
  return null;
}

function centralAllowed(element: ElementRecord): boolean {
  if (element.symbol === "H") return false;
  if (element.block === "d" || element.block === "f") return false;
  if (element.block === "s") return element.group === 2;
  return element.electronegativity !== null;
}

interface Count { readonly hydrogensOnCentral: number; readonly hydroxyls: number; readonly loneElectrons: number; readonly ligands: VseprLigand[] }

/**
 * Electron bookkeeping for one placement of the hydrogens: `hydroxyls` of
 * them sit on oxygens as OH groups, the rest bond to the central atom.
 * Returns null when the placement is impossible.
 */
function countFor(
  central: ElementRecord,
  others: ReadonlyArray<{ symbol: string; count: number; element: ElementRecord }>,
  hydrogens: number,
  hydroxyls: number,
  charge: number,
): Count | null {
  const onCentral = hydrogens - hydroxyls;
  if (onCentral < 0) return null;
  if (onCentral > 0 && !HYDRIDE_CENTRES.has(central.symbol)) return null;
  const ligands: VseprLigand[] = [];
  if (onCentral > 0) ligands.push({ symbol: "H", label: "H", count: onCentral, bondOrder: 1, electronegativity: 2.2 });
  let used = onCentral;
  for (const other of others) {
    const order = ligandOrder(other.element);
    if (order === null) return null;
    let count = other.count;
    if (other.symbol === "O" && hydroxyls > 0) {
      if (hydroxyls > count) return null;
      ligands.push({ symbol: "OH", label: "OH", count: hydroxyls, bondOrder: 1, electronegativity: 3.44 });
      used += hydroxyls;
      count -= hydroxyls;
    }
    if (count > 0) {
      ligands.push({ symbol: other.symbol, label: other.symbol, count, bondOrder: order, electronegativity: other.element.electronegativity ?? 0 });
      used += order * count;
    }
  }
  const loneElectrons = valenceElectrons(central) - used - charge;
  if (loneElectrons < 0) return null;
  return { hydrogensOnCentral: onCentral, hydroxyls, loneElectrons, ligands };
}

/** Species whose central atom is not the element that occurs once. */
const CENTRAL_EXCEPTIONS: Record<string, string> = { "N2O|0": "N" };

/**
 * Pure solver: hybridisation, lone pairs and shape of one species, or null
 * when the formula has no single main-group centre, is a coordination
 * entity, or gives an inconsistent electron count.
 */
export function vseprGeometry(formulaText: string): VseprResult | null {
  const parsed = parseFormula(formulaText);
  if (!parsed) return null;
  if (parsed.totalAtoms < 3 || parsed.totalAtoms > 9) return null;
  if (parsed.atoms.some((atom) => atom.element.block === "d" || atom.element.block === "f")) return null;
  const key = compositionKey(parsed);
  const hydrogens = parsed.atoms.find((atom) => atom.symbol === "H")?.count ?? 0;
  const heavy = parsed.atoms.filter((atom) => atom.symbol !== "H");
  if (heavy.length === 0) return null;

  let central: ElementRecord | null = null;
  let others: Array<{ symbol: string; count: number; element: ElementRecord }> = [];
  const exception = CENTRAL_EXCEPTIONS[key];
  if (exception) {
    const atom = heavy.find((candidate) => candidate.symbol === exception);
    if (!atom) return null;
    central = atom.element;
    others = heavy.flatMap((candidate) => candidate.symbol === exception
      ? (candidate.count > 1 ? [{ symbol: candidate.symbol, count: candidate.count - 1, element: candidate.element }] : [])
      : [{ symbol: candidate.symbol, count: candidate.count, element: candidate.element }]);
  } else if (heavy.length === 1) {
    const only = heavy[0]!;
    if (only.count === 1) {
      central = only.element;
      others = [];
    } else if (only.count === 3 && hydrogens === 0) {
      // A homonuclear triatomic (O3, I3-, N3-): the middle atom is the centre.
      central = only.element;
      others = [{ symbol: only.symbol, count: 2, element: only.element }];
    } else return null;
  } else {
    const singles = heavy.filter((atom) => atom.count === 1 && centralAllowed(atom.element));
    if (singles.length === 0) return null;
    const chosen = singles.reduce((best, atom) =>
      (atom.element.electronegativity ?? Infinity) < (best.element.electronegativity ?? Infinity) ? atom : best);
    central = chosen.element;
    others = heavy.filter((atom) => atom !== chosen).map((atom) => ({ symbol: atom.symbol, count: atom.count, element: atom.element }));
  }
  if (!central || !centralAllowed(central)) return null;
  if (others.some((other) => other.element.block === "d" || other.element.block === "f")) return null;

  // Hydrogens sit on the centre unless oxygens can carry them as OH groups;
  // an oxoacid is only read when exactly one placement is consistent.
  const oxygenCount = central.symbol === "O" ? 0 : others.find((other) => other.symbol === "O")?.count ?? 0;
  const placements: Count[] = [];
  const maxHydroxyls = Math.min(hydrogens, oxygenCount);
  for (let hydroxyls = 0; hydroxyls <= maxHydroxyls; hydroxyls += 1) {
    const count = countFor(central, others, hydrogens, hydroxyls, parsed.charge);
    if (!count) continue;
    if (count.ligands.reduce((sum, ligand) => sum + ligand.count, 0) < 2) continue;
    const period2 = central.period === 2;
    const pairs = Math.floor(count.loneElectrons / 2) + (count.loneElectrons % 2);
    const steric = count.ligands.reduce((sum, ligand) => sum + ligand.count, 0) + pairs;
    if (steric < 2 || steric > 7) continue;
    if (period2 && steric > 4) continue;
    placements.push(count);
  }
  if (placements.length !== 1) return null;
  const count = placements[0]!;
  const bondPairs = count.ligands.reduce((sum, ligand) => sum + ligand.count, 0);
  const unpairedElectron = count.loneElectrons % 2 === 1;
  // The only odd-electron species the exam draws by VSEPR is NO2 (bent, sp2).
  if (unpairedElectron && key !== "NO2|0") return null;
  const lonePairs = Math.floor(count.loneElectrons / 2) + (unpairedElectron ? 1 : 0);
  const stericNumber = bondPairs + lonePairs;
  if (stericNumber >= 5 && central.period < 3) return null;
  if (stericNumber === 7 && central.period < 5) return null;
  const hybrid = HYBRIDISATION[stericNumber];
  const shape = SHAPES[`${stericNumber}-${lonePairs}`];
  if (!hybrid || !shape) return null;
  const axe = `AX${bondPairs}${lonePairs > 0 ? `E${lonePairs > 1 ? lonePairs : ""}` : ""}`;
  const identical = count.ligands.length === 1;
  const allMonovalent = count.ligands.every((ligand) => ligand.bondOrder === 1 && ligand.symbol !== "OH");
  const cation = parsed.charge > 0;
  const bulkyLigand = count.ligands.some((ligand) => ligand.symbol !== "H" && ligand.symbol !== "OH"
    && (parsed.atoms.find((atom) => atom.symbol === ligand.symbol)?.element.radiusPm ?? 0) > central.radiusPm + 10);
  const known = KNOWN_ANGLES[key] ?? null;
  let bondAngle: string | null = known;
  let drawnAngle = 0;
  const classKey = `${stericNumber}-${lonePairs}`;
  switch (classKey) {
    case "2-0": bondAngle = "180°"; drawnAngle = 180; break;
    case "3-0": bondAngle = identical ? "120°" : null; drawnAngle = 120; break;
    case "3-1": bondAngle = known ?? (identical && allMonovalent ? "<120°" : null); drawnAngle = known ? Number.parseFloat(known) : 117; break;
    case "4-0": bondAngle = identical ? "109.5°" : null; drawnAngle = 109.5; break;
    case "4-1": bondAngle = known ?? (allMonovalent && !cation && !bulkyLigand ? "<109.5°" : null); drawnAngle = known ? Number.parseFloat(known) : 107; break;
    case "4-2": bondAngle = known ?? (allMonovalent && !cation && !bulkyLigand ? "<109.5°" : null); drawnAngle = known ? Number.parseFloat(known) : 104.5; break;
    case "5-0": bondAngle = identical ? "90°" : null; drawnAngle = 90; break;
    case "5-1": bondAngle = identical && allMonovalent ? "<120°" : null; drawnAngle = 102; break;
    case "5-2": bondAngle = known ?? (identical && allMonovalent && !cation ? "<90°" : null); drawnAngle = known ? Number.parseFloat(known) : 87.5; break;
    case "6-0": bondAngle = identical ? "90°" : null; drawnAngle = 90; break;
    case "6-1": bondAngle = identical && allMonovalent && !cation ? "<90°" : null; drawnAngle = 90; break;
    case "6-2": bondAngle = identical ? "90°" : null; drawnAngle = 90; break;
    default: bondAngle = null; drawnAngle = 0;
  }
  return {
    formula: parsed.text,
    label: boardLabel(parsed),
    central,
    ligands: count.ligands,
    charge: parsed.charge,
    valence: valenceElectrons(central),
    bondPairs,
    lonePairs,
    unpairedElectron,
    stericNumber,
    hybridisation: hybrid[0],
    hybridisationLabel: hybrid[1],
    electronGeometry: hybrid[2],
    shape: shape[0],
    shapeLabel: shape[1],
    axe,
    bondAngle,
    drawnAngle,
  };
}

/* ------------------------------------------------------------------------- */
/* Stem reading                                                              */
/* ------------------------------------------------------------------------- */

const CUE = /hybridi[sz](?:ation|ed|es)|\bshapes?\b|\bgeometr(?:y|ies)\b|bond angles?|lone[ -]?pairs?|\bvsepr\b|square pyramidal|trigonal bipyramidal|see[ -]?saw|\bt[ -]shaped|octahedral|tetrahedral|square planar|\blinear\b|\bbent\b|\bangular\b|pyramidal|trigonal planar|dipole moment|(?:molecule|ion|species)s? with\b/;

/** Whole-stem vetoes: the figure asked for is not a VSEPR shape. */
const HARD_VETO = /crystal field|\bcfse\b|\bvoids?\b|\blattice\b|unit cell|\b(?:ccp|hcp|fcc|bcc)\b|packing|\breact(?:s|ion|ions|ing|ed)?\b|\bproducts?\b|\bproduces?\b|\bobtained\b|carbocation|carbanion|free radical|\bisomer|molecular orbital|shown in the figure|given (?:in the )?figure|figure below|in the figure|as follows|structures? (?:given|shown|drawn)|shape of (?:the |an? )?(?:\d[spdf] )?orbital|boundary surface|wave function|quantum number/;

/** Sentence-level vetoes: formulas in such a sentence are not shape candidates. */
const SOFT_VETO = /bond order|bond length|\bcomplex(?:es)?\b|coordination|\bligands?\b|magnetic|paramagnetic|diamagnetic|\bspin\b|oxidation state|oxidi[sz]ing|reducing|ionic in nature/;

const ORGANIC_VETO = /\b(?:alkane|alkene|alkyne|benzene|ethene|ethyne|ethane|propane|butane|ester|aldehyde|ketone|alcohol|amine|phenyl|methyl|ethyl|propyl|carbonyl|tollens|iodoform)\b/;

/**
 * OCR reads a lower-case l as a capital I: CIF3, PCI5, ICI4-, HCI. Inside a
 * formula-shaped token "CI" is chlorine (a carbon bonded to one iodine is
 * never written that way), so it is repaired when a symbol precedes it or
 * an F, O or digit follows it.
 */
function repairOcr(text: string): string {
  return text.replace(/\bCI(?=[FO0-9])|(?<=[A-Z][a-z]?\d*)CI(?![A-Za-z])/g, "Cl");
}

function sentencesOf(text: string): string[] {
  return text
    .split(/\n+|(?<=[.?!])\s+(?=[A-Z(])|(?<=:)\s+(?=[A-Z])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function uniqueSpecies(tokens: readonly string[]): VseprResult[] {
  const seen = new Set<string>();
  const species: VseprResult[] = [];
  for (const token of tokens) {
    const result = vseprGeometry(token);
    if (!result) continue;
    const key = compositionKey(parseFormula(token)!);
    if (seen.has(key)) continue;
    seen.add(key);
    species.push(result);
  }
  return species;
}

interface StemProperty {
  readonly hybridisation: Hybridisation | null;
  readonly shape: VseprShape | null;
  readonly lonePairs: number | null;
}

/** The one hybridisation the stem names, or null when it names none or several. */
function readHybridisation(stem: string): Hybridisation | null {
  const compact = stem.replace(/[\^*'\u2019"`]/g, "");
  const found = new Set<Hybridisation>();
  for (const match of compact.matchAll(/\bsp\s?(\d)?\s?(d)?\s?(\d)?(?![a-z])/g)) {
    const [, power, d, dPower] = match;
    if (d) found.add(dPower === "2" ? "sp3d2" : dPower === "3" ? "sp3d3" : "sp3d");
    else if (power === "2") found.add("sp2");
    else if (power === "3") found.add("sp3");
    else if (power === undefined && /^sp[ -]hybrid/.test(compact.slice(match.index ?? 0))) found.add("sp");
  }
  return found.size === 1 ? [...found][0]! : null;
}

const SHAPE_WORDS: ReadonlyArray<[RegExp, VseprShape]> = [
  [/square pyramidal/, "square pyramidal"],
  [/trigonal bipyramidal/, "trigonal bipyramidal"],
  [/pentagonal bipyramidal/, "pentagonal bipyramidal"],
  [/see[ -]?saw/, "see-saw"],
  [/\bt[ -]shaped/, "T-shaped"],
  [/square planar/, "square planar"],
  [/trigonal planar/, "trigonal planar"],
  [/(?<!square |bi)pyramidal/, "trigonal pyramidal"],
  [/(?<!distorted )octahedral/, "octahedral"],
  [/tetrahedral/, "tetrahedral"],
  [/\bbent\b|\bangular\b|\bv[ -]shaped/, "bent"],
  [/\blinear\b/, "linear"],
];

/** The one shape the stem names, or null when it names none or several. */
function readShape(stem: string): VseprShape | null {
  const found = new Set<VseprShape>();
  for (const [pattern, shape] of SHAPE_WORDS) if (pattern.test(stem)) found.add(shape);
  return found.size === 1 ? [...found][0]! : null;
}

function readLonePairs(stem: string): number | null {
  const words: Record<string, number> = { zero: 0, no: 0, one: 1, two: 2, three: 3 };
  const match = /\b(zero|no|one|two|three|[0-3])\s+lone[ -]?pairs?/.exec(stem);
  if (!match) return null;
  const word = match[1]!;
  return words[word] ?? Number(word);
}

function stemProperty(stem: string): StemProperty {
  return { hybridisation: readHybridisation(stem), shape: readShape(stem), lonePairs: readLonePairs(stem) };
}

const MAX_SPECIES = 4;

/**
 * The species the stem asks about: formulas in cue sentences first, else
 * every formula in the stem. Up to four are drawn as listed; a longer list
 * is narrowed to the species the stem's named property picks out, and
 * declined when even that leaves more than four.
 */
export function vseprSpecies(question: string): VseprResult[] {
  const text = repairOcr(normalizeChemistryText(question));
  const lower = text.toLowerCase();
  if (HARD_VETO.test(lower) || ORGANIC_VETO.test(lower)) return [];
  const sentences = sentencesOf(text);
  const cued = sentences.filter((sentence) => CUE.test(sentence.toLowerCase()) && !SOFT_VETO.test(sentence.toLowerCase()));
  let species = uniqueSpecies(cued.flatMap((sentence) => formulaTokens(sentence)));
  if (species.length === 0) {
    const clean = sentences.filter((sentence) => !SOFT_VETO.test(sentence.toLowerCase()));
    species = uniqueSpecies(clean.flatMap((sentence) => formulaTokens(sentence)));
  }
  if (species.length === 0) return [];
  if (species.length <= MAX_SPECIES) return species;
  const property = stemProperty(lower);
  let narrowed = species;
  if (property.hybridisation) narrowed = narrowed.filter((result) => result.hybridisation === property.hybridisation);
  if (property.shape) narrowed = narrowed.filter((result) => result.shape === property.shape);
  if (property.lonePairs !== null) narrowed = narrowed.filter((result) => result.lonePairs === property.lonePairs);
  if (narrowed.length === 0 || narrowed.length > MAX_SPECIES) return [];
  if (!property.hybridisation && !property.shape && property.lonePairs === null) return [];
  return narrowed;
}

/** True when the stem asks about hybridisation, shape, angle or lone pairs of a species this family can draw. */
export function isVseprStem(question: string): boolean {
  const stem = chemStem(question);
  if (!CUE.test(stem)) return false;
  return vseprSpecies(question).length > 0;
}

/* ------------------------------------------------------------------------- */
/* Drawing                                                                   */
/* ------------------------------------------------------------------------- */

interface Slot {
  readonly deg: number;
  readonly len: number;
  readonly style: BondStyle;
  /** Position family, used to seat mixed ligands the way the exam expects. */
  readonly seat: "axial" | "equatorial" | "plain";
}

interface Layout {
  readonly bonds: readonly Slot[];
  readonly lonePairs: ReadonlyArray<{ deg: number; dist: number }>;
  /** Indices into `bonds` of the marked angle, or null for no arc. */
  readonly angle: readonly [number, number] | null;
  readonly angleRadius?: number;
}

const OCT_BASAL: readonly Slot[] = [
  { deg: 180, len: 1, style: "plain", seat: "equatorial" },
  { deg: 0, len: 1, style: "plain", seat: "equatorial" },
  { deg: 225, len: 0.78, style: "wedge", seat: "equatorial" },
  { deg: 45, len: 0.78, style: "dash", seat: "equatorial" },
];

function pentagonSlots(): Slot[] {
  // The equatorial pentagon seen edge-on and tilted: one vertex in the plane
  // to the left, two behind (dash) and two in front (wedge).
  const radius = 1.15;
  const tilt = 0.6;
  return [180, 108, 36, -36, -108].map((phi) => {
    const rad = (phi * Math.PI) / 180;
    const x = radius * Math.cos(rad);
    const y = radius * tilt * Math.sin(rad);
    const deg = (Math.atan2(y, x) * 180) / Math.PI;
    const style: BondStyle = phi === 180 ? "plain" : phi > 0 ? "dash" : "wedge";
    return { deg, len: Math.hypot(x, y), style, seat: "equatorial" as const };
  });
}

function layoutFor(result: VseprResult): Layout | null {
  const theta = result.drawnAngle;
  const half = theta / 2;
  switch (`${result.stericNumber}-${result.lonePairs}`) {
    case "2-0":
      return { bonds: [{ deg: 180, len: 1, style: "plain", seat: "plain" }, { deg: 0, len: 1, style: "plain", seat: "plain" }], lonePairs: [], angle: [0, 1] };
    case "3-0":
      return {
        bonds: [{ deg: 90, len: 1, style: "plain", seat: "plain" }, { deg: 210, len: 1, style: "plain", seat: "plain" }, { deg: 330, len: 1, style: "plain", seat: "plain" }],
        lonePairs: [],
        angle: [1, 2],
      };
    case "3-1":
      return {
        bonds: [{ deg: 270 - half, len: 1, style: "plain", seat: "plain" }, { deg: 270 + half, len: 1, style: "plain", seat: "plain" }],
        lonePairs: [{ deg: 90, dist: 0.42 }],
        angle: [0, 1],
      };
    case "4-0":
      return {
        bonds: [
          { deg: 90, len: 1, style: "plain", seat: "plain" },
          { deg: 90 + 109.5, len: 1, style: "plain", seat: "plain" },
          { deg: -45, len: 0.95, style: "wedge", seat: "plain" },
          { deg: 0, len: 0.85, style: "dash", seat: "plain" },
        ],
        lonePairs: [],
        angle: [0, 1],
      };
    case "4-1":
      return {
        bonds: [
          { deg: 270 - half, len: 1, style: "plain", seat: "plain" },
          { deg: 270 + half, len: 0.95, style: "wedge", seat: "plain" },
          { deg: 270, len: 0.72, style: "dash", seat: "plain" },
        ],
        lonePairs: [{ deg: 90, dist: 0.42 }],
        angle: [0, 1],
        angleRadius: 0.3,
      };
    case "4-2":
      return {
        bonds: [{ deg: 270 - half, len: 1, style: "plain", seat: "plain" }, { deg: 270 + half, len: 1, style: "plain", seat: "plain" }],
        lonePairs: [{ deg: 125, dist: 0.42 }, { deg: 55, dist: 0.42 }],
        angle: [0, 1],
      };
    case "5-0":
      return {
        bonds: [
          { deg: 90, len: 1, style: "plain", seat: "axial" },
          { deg: 270, len: 1, style: "plain", seat: "axial" },
          { deg: 180, len: 1, style: "plain", seat: "equatorial" },
          { deg: 330, len: 0.9, style: "wedge", seat: "equatorial" },
          { deg: 30, len: 0.9, style: "dash", seat: "equatorial" },
        ],
        lonePairs: [],
        angle: [0, 2],
      };
    case "5-1":
      return {
        bonds: [
          { deg: 86.5, len: 1, style: "plain", seat: "axial" },
          { deg: 273.5, len: 1, style: "plain", seat: "axial" },
          { deg: 360 - half, len: 0.9, style: "wedge", seat: "equatorial" },
          { deg: half, len: 0.9, style: "dash", seat: "equatorial" },
        ],
        lonePairs: [{ deg: 180, dist: 0.45 }],
        angle: [2, 3],
      };
    case "5-2":
      return {
        bonds: [
          { deg: theta, len: 1, style: "plain", seat: "axial" },
          { deg: 360 - theta, len: 1, style: "plain", seat: "axial" },
          { deg: 0, len: 1, style: "plain", seat: "equatorial" },
        ],
        lonePairs: [{ deg: 150, dist: 0.45 }, { deg: 210, dist: 0.45 }],
        angle: [0, 2],
      };
    case "5-3":
      return {
        bonds: [{ deg: 90, len: 1, style: "plain", seat: "axial" }, { deg: 270, len: 1, style: "plain", seat: "axial" }],
        lonePairs: [{ deg: 180, dist: 0.5 }, { deg: 60, dist: 0.5 }, { deg: 300, dist: 0.5 }],
        angle: null,
      };
    case "6-0":
      return {
        bonds: [{ deg: 90, len: 1, style: "plain", seat: "axial" }, { deg: 270, len: 1, style: "plain", seat: "axial" }, ...OCT_BASAL],
        lonePairs: [],
        angle: [0, 2],
      };
    case "6-1":
      return {
        bonds: [{ deg: 90, len: 1, style: "plain", seat: "axial" }, ...OCT_BASAL],
        lonePairs: [{ deg: 270, dist: 0.45 }],
        angle: [0, 1],
      };
    case "6-2":
      return {
        bonds: [45, 135, 225, 315].map((deg) => ({ deg, len: 1, style: "plain" as const, seat: "equatorial" as const })),
        lonePairs: [{ deg: 90, dist: 0.45 }, { deg: 270, dist: 0.45 }],
        angle: [3, 0],
      };
    case "7-0":
      return {
        bonds: [{ deg: 90, len: 1, style: "plain", seat: "axial" }, { deg: 270, len: 1, style: "plain", seat: "axial" }, ...pentagonSlots()],
        lonePairs: [],
        angle: null,
      };
    case "7-1":
      return {
        bonds: [{ deg: 90, len: 1, style: "plain", seat: "axial" }, { deg: 270, len: 1, style: "plain", seat: "axial" }, ...OCT_BASAL],
        lonePairs: [{ deg: 315, dist: 0.55 }],
        angle: null,
      };
    default:
      return null;
  }
}

interface Seated { readonly slot: Slot; readonly ligand: VseprLigand }

/**
 * Seat each ligand on a slot. In a trigonal bipyramid the most
 * electronegative monovalent ligands take the axial positions and doubly
 * bonded ones stay equatorial; in an octahedron a doubly bonded ligand takes
 * the apex (trans to the lone pair, as in XeOF4); elsewhere the rarer ligand
 * takes the first (in-plane) slot so it reads as the substituent.
 */
function seatLigands(result: VseprResult, layout: Layout): Seated[] | null {
  const expanded: VseprLigand[] = result.ligands.flatMap((ligand) => Array.from({ length: ligand.count }, () => ligand));
  if (expanded.length !== layout.bonds.length) return null;
  const family = result.electronGeometry;
  let ordered: VseprLigand[];
  if (family === "trigonal bipyramidal" || family === "pentagonal bipyramidal") {
    const axialCount = layout.bonds.filter((slot) => slot.seat === "axial").length;
    const monovalent = expanded.filter((ligand) => ligand.bondOrder === 1).sort((a, b) => b.electronegativity - a.electronegativity);
    const multiple = expanded.filter((ligand) => ligand.bondOrder > 1);
    const axial = monovalent.slice(0, axialCount);
    const rest = [...multiple, ...monovalent.slice(axialCount)];
    if (axial.length < axialCount) {
      const fill = rest.splice(0, axialCount - axial.length);
      axial.push(...fill);
    }
    ordered = [...axial, ...rest];
  } else if (family === "octahedral") {
    const multiple = expanded.filter((ligand) => ligand.bondOrder > 1);
    const single = expanded.filter((ligand) => ligand.bondOrder === 1);
    ordered = [...multiple, ...single];
  } else {
    ordered = [...expanded].sort((a, b) => a.count - b.count);
  }
  return layout.bonds.map((slot, index) => ({ slot, ligand: ordered[index]! }));
}

/** Bond orders are drawn only where the Lewis picture is the plain one: a neutral, closed-shell species whose centre keeps its octet. */
function drawOrders(result: VseprResult): boolean {
  if (result.charge !== 0 || result.unpairedElectron) return false;
  if (result.central.period === 2) {
    const pairs = result.ligands.reduce((sum, ligand) => sum + ligand.count * ligand.bondOrder, 0) + result.lonePairs;
    if (pairs > 4) return false;
  }
  return true;
}

interface DrawnSpecies { readonly ids: string[]; readonly frameIds: string[]; readonly detailIds: string[] }

/** Reach of the panel beyond the molecule's furthest atom, so symbols and caption lines clear its border. */
const PANEL_SIDE = 0.5;
const TITLE_GAP = 0.5;
const CAPTION_GAP = 0.5;
const CAPTION_STEP = 0.36;
const PANEL_END = 0.32;

/**
 * A light dashed panel around one species. Labels are excluded from the
 * view fit, so a molecule whose caption sits under it would have that
 * caption clipped; the panel is the ink that carries the fit out to it.
 */
function panel(c: ChemScene, id: string, center: Vec2, width: number, height: number): string {
  const centerId = c.scene.helper(`${id}_c`, center, "panel centre helper");
  const rectId = c.scene.rectangle(id, centerId, width, height, "species panel");
  const entity = c.scene.entities.find((candidate) => candidate.id === rectId);
  if (entity) entity.provenance = { dashed: true, strokeRole: "construction" };
  return rectId;
}

function drawSpecies(c: ChemScene, result: VseprResult, origin: Vec2, tag: string, withAngle: boolean): DrawnSpecies | null {
  const layout = layoutFor(result);
  if (!layout) return null;
  const seated = seatLigands(result, layout);
  if (!seated) return null;
  const orders = drawOrders(result);
  const frameIds: string[] = [];
  const detailIds: string[] = [];
  const centralId = c.atom(`${tag}_A`, result.central.symbol, origin, { role: `${result.central.symbol} central atom` });
  frameIds.push(centralId);
  let minY = origin.y;
  let maxY = origin.y;
  let reachX = 0;
  const ligandIds: string[] = [];
  seated.forEach(({ slot, ligand }, index) => {
    const rad = (slot.deg * Math.PI) / 180;
    const at = { x: origin.x + Math.cos(rad) * slot.len, y: origin.y + Math.sin(rad) * slot.len };
    minY = Math.min(minY, at.y);
    maxY = Math.max(maxY, at.y);
    reachX = Math.max(reachX, Math.abs(at.x - origin.x));
    const id = c.atom(`${tag}_L${index + 1}`, ligand.label, at, { role: `${ligand.label} ligand` });
    ligandIds.push(id);
    frameIds.push(id);
    const order = orders && slot.style !== "wedge" ? ligand.bondOrder : 1;
    frameIds.push(...c.bond(`${tag}_b${index + 1}`, centralId, id, { style: slot.style, order, role: `${result.central.symbol} to ${ligand.label} bond` }));
  });
  layout.lonePairs.forEach((pair, index) => {
    const rad = (pair.deg * Math.PI) / 180;
    minY = Math.min(minY, origin.y + Math.sin(rad) * pair.dist - 0.12);
    maxY = Math.max(maxY, origin.y + Math.sin(rad) * pair.dist + 0.12);
    reachX = Math.max(reachX, Math.abs(Math.cos(rad) * pair.dist) + 0.12);
    if (result.unpairedElectron && index === layout.lonePairs.length - 1) {
      const at = { x: origin.x + Math.cos(rad) * pair.dist, y: origin.y + Math.sin(rad) * pair.dist };
      const dotId = c.scene.point(`${tag}_odd`, at, "unpaired electron");
      const entity = c.scene.entities.find((candidate) => candidate.id === dotId);
      if (entity) entity.provenance = { pointStyle: "filled" };
      detailIds.push(dotId);
      return;
    }
    detailIds.push(...c.lonePair(`${tag}_lp${index + 1}`, centralId, pair.deg, pair.dist));
  });
  if (withAngle && layout.angle && result.bondAngle) {
    const [a, b] = layout.angle;
    detailIds.push(c.angle(`${tag}_ang`, centralId, ligandIds[a]!, ligandIds[b]!, result.bondAngle, layout.angleRadius ?? 0.36));
  }
  const titleY = maxY + TITLE_GAP;
  const hybridY = minY - CAPTION_GAP;
  const shapeY = hybridY - CAPTION_STEP;
  const titleId = c.text(`${tag}_title`, { x: origin.x, y: titleY }, result.label, "species formula");
  frameIds.push(titleId);
  const hybridId = c.text(`${tag}_hyb`, { x: origin.x, y: hybridY }, result.hybridisationLabel, "hybridisation");
  const shapeId = c.text(`${tag}_shape`, { x: origin.x, y: shapeY }, result.shapeLabel, "molecular shape");
  detailIds.push(hybridId, shapeId);
  const top = titleY + PANEL_END;
  const bottom = shapeY - PANEL_END;
  const halfWidth = Math.max(reachX + PANEL_SIDE, 1.45);
  frameIds.push(panel(c, `${tag}_panel`, { x: origin.x, y: (top + bottom) / 2 }, 2 * halfWidth, top - bottom));
  c.scene.labelled(centralId, titleId, hybridId, shapeId);
  return { ids: [...frameIds, ...detailIds], frameIds, detailIds };
}

function speciesCue(result: VseprResult): string {
  const pairs = result.unpairedElectron
    ? `${result.lonePairs - 1} lone pair${result.lonePairs - 1 === 1 ? "" : "s"} and one unpaired electron`
    : `${result.lonePairs} lone pair${result.lonePairs === 1 ? "" : "s"}`;
  return `${result.formula}: ${result.central.symbol} with ${result.bondPairs} bond pairs and ${pairs}, steric number ${result.stericNumber}, ${result.hybridisation}, ${result.shape}`;
}

const SPECIES_PITCH = 3.6;

/**
 * The figure for a stem: one molecule, or up to four listed species in a
 * row, each its own reveal group. Null when no species grounds it.
 */
export function buildVseprScene(question: string, quantities: ChemPlanQuantity[], schematic: boolean): SceneDocument | null {
  void quantities;
  void schematic;
  const species = vseprSpecies(question);
  if (species.length === 0) return null;
  const single = species.length === 1;
  const reason = single
    ? `${species[0]!.formula} by VSEPR: ${species[0]!.hybridisation}, ${species[0]!.shape}`
    : `shapes of ${species.map((result) => result.formula).join(", ")} by VSEPR`;
  const c = new ChemScene(question, reason, VSEPR_FAMILY);
  const drawn: Array<{ result: VseprResult; drawn: DrawnSpecies }> = [];
  species.forEach((result, index) => {
    const origin = { x: index * SPECIES_PITCH, y: 0 };
    const item = drawSpecies(c, result, origin, `m${index + 1}`, true);
    if (item) drawn.push({ result, drawn: item });
  });
  if (drawn.length === 0) return null;
  if (single) {
    const only = drawn[0]!;
    c.scene.group("frame", only.drawn.frameIds, `${only.result.formula}: ${only.result.central.symbol} bonded to ${only.result.bondPairs} atoms`);
    c.scene.group("detail", only.drawn.detailIds, speciesCue(only.result), ["frame"]);
  } else {
    drawn.forEach((item, index) => {
      c.scene.group(`species_${index + 1}`, item.drawn.ids, speciesCue(item.result), index === 0 ? [] : [`species_${index}`]);
    });
  }
  const caption = single
    ? `${drawn[0]!.result.formula}: ${drawn[0]!.result.hybridisation}, ${drawn[0]!.result.shape}, ${drawn[0]!.result.lonePairs} lone pair${drawn[0]!.result.lonePairs === 1 ? "" : "s"}`
    : `Shapes of ${drawn.map((item) => item.result.formula).join(", ")}`;
  return c.build({ caption: caption.slice(0, 60) });
}

/* ------------------------------------------------------------------------- */
/* Probes                                                                    */
/* ------------------------------------------------------------------------- */

export const VSEPR_PROBES: ReadonlyArray<{
  question: string;
  expect: "draw" | "decline";
  labels?: string[];
  forbidLabels?: string[];
  note?: string;
}> = [
  { question: "The shape of SF4 molecule and the hybridisation of sulphur in it are:", expect: "draw", labels: ["SF_4", "sp^3d", "see-saw", "<120°"], note: "AX4E, one equatorial lone pair" },
  { question: "The hybridisation of Xe in XeF4 and the shape of the molecule are:", expect: "draw", labels: ["XeF_4", "sp^3d^2", "sq. planar", "90°"], note: "AX4E2, lone pairs trans" },
  { question: "The shape of BrF5 molecule is:", expect: "draw", labels: ["BrF_5", "sp^3d^2", "sq. pyramidal", "<90°"] },
  { question: "The geometry of PCl5 and the hybridisation of P in it are:", expect: "draw", labels: ["PCl_5", "sp^3d", "TBP", "90°"] },
  { question: "The shape of ClF3 and its bond angle are:", expect: "draw", labels: ["ClF_3", "sp^3d", "T-shaped", "87.5°"] },
  { question: "The number of lone pairs on Xe in XeF2 and the shape of the molecule are:", expect: "draw", labels: ["XeF_2", "sp^3d", "linear"], forbidLabels: ["180°"], note: "three equatorial lone pairs, no arc" },
  { question: "The shape of I3- ion is:", expect: "draw", labels: ["I_3^(-)", "sp^3d", "linear"] },
  { question: "The bond angle in NH3 and the shape of the molecule are:", expect: "draw", labels: ["NH_3", "sp^3", "trig. pyramidal", "107°"] },
  { question: "The bond angle of H2O and its geometry are:", expect: "draw", labels: ["H_2O", "sp^3", "bent", "104.5°"] },
  { question: "The shape of CO2 molecule is:", expect: "draw", labels: ["CO_2", "sp", "linear", "180°"] },
  { question: "The hybridisation of boron in BF3 and its shape are:", expect: "draw", labels: ["BF_3", "sp^2", "trig. planar", "120°"] },
  { question: "The hybridisation of S in SO4^2- ion and the shape of the ion are:", expect: "draw", labels: ["SO_4^(2-)", "sp^3", "tetrahedral", "109.5°"] },
  { question: "The shape of NO3- ion is:", expect: "draw", labels: ["NO_3^(-)", "sp^2", "trig. planar", "120°"] },
  { question: "The shape of XeOF4 molecule is:", expect: "draw", labels: ["XeOF_4", "sp^3d^2", "sq. pyramidal", "O"], forbidLabels: ["<90°"], note: "O at the apex, trans to the lone pair" },
  { question: "The geometry of IF7 is:", expect: "draw", labels: ["IF_7", "sp^3d^3", "pent. bipyr."] },
  { question: "The hybridisation of sulphur in SO2 and its shape are:", expect: "draw", labels: ["SO_2", "sp^2", "bent", "119.5°"] },
  { question: "The shape of NH4+ ion is:", expect: "draw", labels: ["NH_4^(+)", "sp^3", "tetrahedral", "109.5°"] },
  { question: "The shape of XeF6 molecule is:", expect: "draw", labels: ["XeF_6", "sp^3d^3", "dist. octahedral"] },
  { question: "The hybridisation and geometry of [Ni(CN)4]2- are:", expect: "decline", note: "coordination entity, another lane" },
  { question: "The shape of C2H4 molecule is:", expect: "decline", note: "no single central atom" },
  { question: "The molecule/ion with square pyramidal shape is: PF5, BrF5, PCl5, [Ni(CN)4]2-", expect: "draw", labels: ["PF_5", "BrF_5", "PCl_5", "sq. pyramidal", "TBP"], note: "three species in a row, the complex skipped" },
  { question: "Statement I: F2O < H2O < Cl2O is the correct trend in terms of bond angle. Statement II: SiF4, SnF4 and PbF4 are ionic in nature.", expect: "draw", labels: ["F_2O", "H_2O", "Cl_2O", "103°", "104.5°", "111°"], note: "the cue sentence picks the three bent oxides" },
  { question: "Identify the incorrect statement about the structure shown in the figure.", expect: "decline", note: "figure-absent stem" },
  { question: "The number of tetrahedral voids per atom in a ccp lattice is:", expect: "decline", note: "solid state, not a molecule" },
];
