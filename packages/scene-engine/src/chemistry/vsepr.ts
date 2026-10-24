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
import { measureTextInkBounds, measureTextWidth } from "@heytutor/drawing";
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, type BondStyle, type ChemPlanQuantity, type Vec2 } from "./sceneKit";
import {
  buildDipoleScene,
  buildFajanScene,
  dipoleAccount,
  dipoleIsTheAsk,
  fajanAsked,
  parseExamBondLines,
  shapeIsTheAsk,
  type DipoleInput,
} from "./bondingFigures";
import { formulaTokens, normalizeChemistryText, parseFormula, type ParsedFormula } from "./formula";
import { chargeMarkersCarried } from "./chargeMarker";
import { stemHasChargeLikeToken } from "./chargeEvidence";
import { isMonovalent, resolveElement, valenceElectrons, type ElementRecord } from "./elements";
import { isDiscreteVseprCandidate } from "./foundation/formulaState";
import { vseprFormulaArguments, vseprSourceArgumentsComplete, hasValidatedVseprNotation } from "./vseprSource";
import type { TurnPlanV3 } from "../contracts/contractsV3";
import type { VseprBondInkPlan } from "./representation/bondInk";

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
  /** Nonbonding domains (E); includes a radical's single-electron domain. */
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
  "6-3": ["T-shaped", "T-shaped"],
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
  if (!parsed || !isDiscreteVseprCandidate(parsed)) return null;
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
    case "6-3": bondAngle = identical && allMonovalent && !cation ? "<90°" : null; drawnAngle = 90; break;
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
    // A list of requested molecules is atomic: a supported first formula
    // cannot stand in for an unsupported second formula.
    if (!result) return [];
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
  [/\btrigonal pyramidal\b|(?<!square |bi|trigonal )\bpyramidal\b/, "trigonal pyramidal"],
  [/(?<!distorted )octahedral/, "octahedral"],
  [/(?<!distorted )tetrahedral/, "tetrahedral"],
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

/** A radical's single-electron domain is not an electron pair. */
function actualLonePairs(result: VseprResult): number {
  return result.lonePairs - (result.unpairedElectron ? 1 : 0);
}

type ShapeClaim = { shape: VseprShape; target: "electron" | "molecular" | null; negated: boolean; owners: readonly string[] | null };

interface ShapeOwnerMention { start: number; end: number; key: string }

/** Keep formula case and charge: a sibling molecule cannot describe this one. */
function shapeOwnerMentions(clause: string): ShapeOwnerMention[] {
  let from = 0;
  return formulaTokens(clause.replace(/,/g, " ")).flatMap(token => {
    const start = clause.indexOf(token, from);
    const parsed = parseFormula(token);
    if (start < 0 || !parsed) return [];
    from = start + token.length;
    return [{ start, end: from, key: compositionKey(parsed) }];
  });
}

/** A postposed property owner or a local subject owns this fact, not its neighbour. */
function localMoleculeOwners(
  clause: string, start: number, end: number, nextStart: number,
  mentions: readonly ShapeOwnerMention[], inherited: readonly string[] | null,
): readonly string[] | null {
  const tail = clause.slice(end, nextStart);
  const postposed = /^\s+(?:(?:(?:molecular|electron(?:[ -](?:domain|pair))?)\s+)?(?:shapes?|geometr(?:y|ies)|arrangements?)\s+|hybridi[sz](?:ed|ation)\s+)?(?:of|for|in|on|around)\s+(?:(?:the|molecule|ion|each)\s+)*(?:(?:central\s+atom|[A-Za-z]+)(?:\s+atoms?)?\s+in\s+)?/i.exec(tail);
  if (postposed) {
    const owner = mentions.find(mention => mention.start === end + postposed[0].length);
    if (owner) {
      const owners = [owner.key];
      let at = mentions.indexOf(owner);
      while (at + 1 < mentions.length && mentions[at + 1]!.start < nextStart
        && /^\s*(?:,\s*(?:(?:and|or)\s+)?|(?:and|or)\s+)$/i.test(clause.slice(mentions[at]!.end, mentions[at + 1]!.start))) {
        owners.push(mentions[++at]!.key);
      }
      return owners;
    }
  }
  const before = mentions.filter(mention => mention.end <= start);
  const subject = [...before].reverse().find(mention => {
    const predicate = clause.slice(mention.end, start);
    if (/^\s*(?:(?:molecule|ion|species)\s+)?(?:is|are|has|have|does|do|did|with|having|containing|carries|carry|contains|contain|uses|use|adopts?|exhibits?|shows?)\b/i.test(predicate)) return true;
    const possessive = /^['\u2019]s\s+(central\s+atom|[A-Za-z]+)(?:\s+atoms?)?\s+(?:is|are|has|have|does|do|did|carries|carry|contains|contain|uses|use)\b/i.exec(predicate);
    return possessive !== null && (/^central\s+atom$/i.test(possessive[1]!) || resolveElement(possessive[1]!) !== null);
  });
  if (subject) {
    const owners = [subject.key];
    let at = before.indexOf(subject);
    // A shared subject ("X and Y have ...") describes both, never just Y.
    while (at > 0 && /^\s*(?:,\s*(?:(?:and|or)\s+)?|(?:and|or)\s+)$/i.test(clause.slice(before[at - 1]!.end, before[at]!.start))) {
      owners.push(before[--at]!.key);
    }
    return owners;
  }
  if (before.length) {
    const keys = [...new Set(before.map(mention => mention.key))];
    return keys.length === 1 ? keys : null;
  }
  return inherited;
}

/** Bind each geometry in its property clause, including compound claims. */
function shapeClaims(text: string, result: VseprResult): ShapeClaim[] {
  const claims: ShapeClaim[] = [];
  let inheritedOwners: readonly string[] | null = [compositionKey(parseFormula(result.formula)!)];
  // A colon connects a typed property to its value (electron geometry:
  // tetrahedral); it must not turn that value into a free molecular claim.
  for (const rawClause of repairOcr(normalizeChemistryText(text)).split(/[.;]|\b(?:but|while|whereas|although|because)\b|,\s*derived\s+from\b/i)) {
    const clause = rawClause.toLowerCase();
    const mentions = shapeOwnerMentions(rawClause);
    const shapes = SHAPE_WORDS.flatMap(([pattern, shape]) => [...clause.matchAll(new RegExp(pattern.source, "g"))]
      .map((match) => ({ shape, start: match.index, end: match.index + match[0].length })))
      .sort((left, right) => left.start - right.start);
    if (!shapes.length && mentions.length) {
      const owners = [...new Set(mentions.map(mention => mention.key))];
      inheritedOwners = owners.length === 1 ? owners : null;
    }
    const roles: { start: number; end: number; target: "electron" | "molecular" }[] = [];
    const patterns: [RegExp, "electron" | "molecular"][] = [
      [/\bmolecular\s+(?:shape|geometry|arrangement)\b|\b(?:shape|geometry)\s+of\s+(?:the\s+)?(?:molecule|ion)\b/g, "molecular"],
      [/\belectron(?:\s+(?:domain|pair)s?)?\s+(?:geometry|arrangement)\b|\b(?:geometry|arrangement)\s+(?:of|for)\s+(?:(?:the|its)\s+)?electron(?:s|\s+(?:domains?|pairs?))?\b/g, "electron"],
      [/\belectron(?:\s+(?:pair|domain))?s?\s+(?:is|are)\b/g, "electron"],
      [/\belectron(?:\s+(?:pair|domain))?s?\b(?:(?!\bmolecular\b)[^.;:]){0,100}\b(?:geometry|arrangement|arranged)\b/g, "electron"],
    ];
    for (const [pattern, target] of patterns) for (const match of clause.matchAll(pattern)) {
      roles.push({ start: match.index, end: match.index + match[0].length, target });
    }
    let previousShape: { end: number; negated: boolean } | undefined;
    for (const [index, shape] of shapes.entries()) {
      const owners = localMoleculeOwners(rawClause, shape.start, shape.end, shapes[index + 1]?.start ?? rawClause.length, mentions, inheritedOwners);
      const targets = new Set(roles.map((role) => role.target));
      let target: ShapeClaim["target"] = "molecular";
      if (targets.size === 1) target = [...targets][0]!;
      else if (targets.size > 1 && shapes.length === 1) target = null;
      else if (targets.size > 1) {
        const distance = (role: typeof roles[number]) => Math.max(0, role.start - shape.end, shape.start - role.end);
        const nearest = Math.min(...roles.map(distance));
        const nearestTargets = new Set(roles.filter((role) => distance(role) === nearest).map((role) => role.target));
        target = nearestTargets.size === 1 ? [...nearestTargets][0]! : null;
      }
      const explicitNegative = /\b(?:not|no|neither)\s+(?:(?:have|has)\s+)?(?:an?\s+)?$/.test(clause.slice(0, shape.start));
      // One negative can govern a comma/or/nor list. A new predicate or
      // property clause ends that list; it must keep its own truth value.
      const joinedNegative = previousShape?.negated === true
        && /^(?:\s*,\s*|\s+(?:or|nor)\s+|\s*,\s*(?:or|nor)\s+)(?:an?\s+)?$/.test(clause.slice(previousShape.end, shape.start));
      const negated = explicitNegative || joinedNegative;
      claims.push({ shape: shape.shape, target, negated, owners });
      inheritedOwners = owners;
      previousShape = { end: shape.end, negated };
    }
  }
  return claims;
}

type ElectronCountClaim = { count: number; kind: "lone-pair" | "unpaired"; negated: boolean; central: boolean };

/** Counts and hybrids inherit the same typed molecule ownership as shapes. */
function moleculePropertyOwner(text: string, start: number, end: number, result: VseprResult): boolean {
  const target = compositionKey(parseFormula(result.formula)!);
  let inherited: readonly string[] | null = [target];
  let from = 0;
  const boundaries = [...text.matchAll(/[;:]|\.(?=\s|$)|\b(?:but|while|whereas|although|because)\b|,\s*derived\s+from\b/gi)]
    .map(match => ({ start: match.index, end: match.index + match[0].length }));
  boundaries.push({ start: text.length, end: text.length });
  for (const boundary of boundaries) {
    const clause = text.slice(from, boundary.start);
    const mentions = shapeOwnerMentions(clause);
    if (start >= from && end <= boundary.start) {
      const owners = localMoleculeOwners(clause, start - from, end - from, clause.length, mentions, inherited);
      return owners?.includes(target) ?? false;
    }
    if (mentions.length) inherited = localMoleculeOwners(clause, clause.length, clause.length, clause.length, mentions, inherited);
    from = boundary.end;
  }
  return false;
}

/** Explicit counts on another atom do not describe the central atom. */
function centralCountOwner(text: string, start: number, end: number, result: VseprResult): boolean {
  if (!moleculePropertyOwner(text, start, end, result)) return false;
  const owner = (token: string): boolean | null => {
    if (/^central\s+atom$/i.test(token)) return true;
    const element = resolveElement(token);
    return element ? element.symbol === result.central.symbol : null;
  };
  const after = /^\s+(?:on|around)\s+(?:(?:the|each)\s+)?(?:central\s+)?(central\s+atom|[A-Za-z]+)(?:\s+atoms?)?\b/i.exec(text.slice(end));
  const afterOwner = after ? owner(after[1]!) : null;
  if (afterOwner !== null) return afterOwner;
  const before = text.slice(0, start).split(/[.;:]/).at(-1)!;
  const possessive = /\b([A-Za-z]+)['\u2019]s\s*$/.exec(before);
  const possessiveOwner = possessive ? owner(possessive[1]!) : null;
  if (possessiveOwner !== null) return possessiveOwner;
  const subjects = [...before.matchAll(/\b(central\s+atom|[A-Za-z]+)(?:\s+atoms?)?(?:\s+in\s+[A-Za-z0-9_()^+-]+)?(?:\s+(?:each|all|both|individually))?\s+(?:has|have|carries|carry|contains|contain|is|are|uses|use)\b/gi)];
  for (const subject of subjects.reverse()) {
    const subjectOwner = owner(subject[1]!);
    if (subjectOwner !== null) return subjectOwner;
  }
  // The existing unqualified molecular shorthand describes its center.
  return true;
}

function electronCountClaims(text: string, result: VseprResult): ElectronCountClaim[] {
  const words: Record<string, number> = { zero: 0, no: 0, one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const count = String.raw`-?\d+(?:\.\d+)?|zero|no|one|single|two|three|four|five|six|seven|eight|nine|ten`;
  const noun = String.raw`lone[ -]?pairs?|unpaired\s+electrons?`;
  const candidates: Array<{ start: number; end: number; count: number; kind: ElectronCountClaim["kind"]; negative?: true }> = [];
  const shared: Array<{ start: number; end: number }> = [];
  // A shared final noun belongs to both explicitly negated alternatives.
  for (const match of text.matchAll(new RegExp(`\\b(?:neither|not|never)\\s+(${count})\\s+(?:nor|or)\\s+(${count})\\s+(${noun})\\b`, "gdi"))) {
    shared.push({ start: match.index, end: match.index + match[0].length });
    for (const group of [1, 2]) candidates.push({ start: match.indices![group]![0], end: match.index + match[0].length,
      count: words[match[group]!.toLowerCase()] ?? Number(match[group]), kind: /^lone/i.test(match[3]!) ? "lone-pair" : "unpaired", negative: true });
  }
  for (const match of text.matchAll(new RegExp(`(?<![\\w.])(${count})\\s+(${noun})\\b`, "gi"))) {
    if (shared.some(span => span.start <= match.index && match.index < span.end)) continue;
    candidates.push({ start: match.index, end: match.index + match[0].length, count: words[match[1]!.toLowerCase()] ?? Number(match[1]), kind: /^lone/i.test(match[2]!) ? "lone-pair" : "unpaired" });
  }
  let previous: { end: number; negated: boolean } | undefined;
  return candidates.sort((a, b) => a.start - b.start).map(candidate => {
    const explicit = /\b(?:not|never|neither)(?:\s+(?:have|has|contain|contains|carry|carries|exactly|even|just|a))*\s+$/i.test(text.slice(0, candidate.start));
    const joined = previous?.negated === true && /^(?:\s*,\s*|\s+(?:or|nor)\s+|\s*,\s*(?:or|nor)\s+)$/i.test(text.slice(previous.end, candidate.start));
    const negated = candidate.negative === true || explicit || joined;
    previous = { end: candidate.end, negated };
    return { count: candidate.count, kind: candidate.kind, negated, central: centralCountOwner(text, candidate.start, candidate.end, result) };
  });
}

/** Each local hybrid claim retains its owner and negation; siblings cannot erase it. */
function hybridisationClaims(text: string, result: VseprResult): Array<{ value: Hybridisation; negated: boolean }> {
  const claims: Array<{ value: Hybridisation; negated: boolean }> = [];
  let previous: { end: number; negated: boolean } | undefined;
  for (const match of text.matchAll(/(?<![\p{L}\p{N}_])sp(?:\s*[\^*'\u2019"`]?\s*[\d²³])?(?:\s*d(?:\s*[\^*'\u2019"`]?\s*[\d²³])?)?(?![\p{L}\p{N}_]|\s*[\^*'’"`])/giu)) {
    const token = match[0].toLowerCase().replace(/²/g, "2").replace(/³/g, "3");
    const value = readHybridisation(`${token} hybridised`);
    if (!value || !centralCountOwner(text, match.index, match.index + match[0].length, result)) continue;
    if (/^sp$/i.test(match[0]) && !/hybrid/i.test(text.slice(Math.max(0, match.index - 45), match.index + match[0].length + 20))) continue;
    const explicit = /\b(?:not|never|neither)\s+(?:an?\s+)?$/i.test(text.slice(0, match.index));
    const joined = previous?.negated === true && /^(?:\s*,\s*|\s+(?:or|nor)\s+|\s*,\s*(?:or|nor)\s+)(?:an?\s+)?$/i.test(text.slice(previous.end, match.index));
    const negated = explicit || joined;
    claims.push({ value, negated });
    previous = { end: match.index + match[0].length, negated };
  }
  return claims;
}

/** Position belongs to a lone-pair predicate, not an axial ligand nearby. */
function centralLonePairPositions(text: string, result: VseprResult): Array<{ position: string; negated: boolean }> {
  const claims: Array<{ position: string; negated: boolean }> = [];
  const afterPair = /\blone[ -]?pairs?\b(?:(?:\s+(?:on|around|in))\s+(?:(?:the|central)\s+)*[A-Za-z0-9_^()+-]+(?:\s+atom)?)?\s+(?:(?:is|are|occupies|occupy|sits|sit|lies|lie|prefers|prefer)\s+)?(?:(?:placed|located|positioned)\s+)?(?:(?:not|never)\s+)?(?:(?:in|at|on)\s+)?(?:(?:one|either|any|each|both)\s+of\s+)?(?:(?:an?|the|its|one|two|1|2|first|second|both|either|any)\s+)*(axial|equatorial)\b/gi;
  for (const match of text.matchAll(afterPair)) {
    const pair = /^lone[ -]?pairs?/i.exec(match[0])!;
    const end = match.index + pair[0].length;
    if (centralCountOwner(text, match.index, end, result)) claims.push({ position: match[1]!.toLowerCase(), negated: /\b(?:not|never)\b/i.test(match[0].slice(pair[0].length)) });
  }
  for (const match of text.matchAll(/\b(axial|equatorial)\s+(lone[ -]?pairs?)\b/gi)) {
    // An indefinite counterfactual ("an axial lone pair would ...") explains
    // a rejected alternative; it does not locate the actual source pair.
    if (/\ban?\s+$/i.test(text.slice(0, match.index))
      && /^\s+(?:would|could)\b/i.test(text.slice(match.index + match[0].length))) continue;
    const start = match.index + match[0].length - match[2]!.length;
    if (centralCountOwner(text, start, start + match[2]!.length, result)) claims.push({ position: match[1]!.toLowerCase(), negated: /\b(?:not|no|neither)\s+(?:an?\s+)?$/i.test(text.slice(0, match.index)) });
  }
  return claims;
}

/** A correct source molecule must not accompany a contradictory lesson plan. */
export function vseprPlanConflict(question: string, plan: TurnPlanV3): string | null {
  if (!isVseprStem(question)) return null;
  const species = vseprSpecies(question);
  // Multi-species comparisons need separately bound claims; do not guess
  // which molecule a free-form claim describes.
  if (species.length !== 1) return null;
  const result = species[0]!;
  for (const claim of plan.qualitativeClaims) {
    const rawText = repairOcr(normalizeChemistryText(`${claim.claim}${typeof claim.expected === "boolean" ? "" : ` ${claim.expected}`}`)).replace(/([a-z])[-\u2010-\u2015](?=[a-z])/gi, "$1 ");
    const facts: Array<{ truth: boolean; property: string }> = [];
    const moleculeKey = compositionKey(parseFormula(result.formula)!);
    for (const described of shapeClaims(rawText, result)) {
      if (!described.owners?.includes(moleculeKey)) continue;
      const sourceShapes = described.target === null ? [result.shape, result.electronGeometry]
        : [described.target === "electron" ? result.electronGeometry : result.shape];
      const equal = sourceShapes.map(shape => shape === described.shape);
      // A property that could refer to either different geometry stays undecided.
      if (equal.some(Boolean) && !equal.every(Boolean)) continue;
      facts.push({ truth: described.negated ? !equal[0] : equal[0]!, property: described.target === "electron" ? "electron geometry" : described.target === "molecular" ? "molecular shape" : "geometry" });
    }
    for (const described of hybridisationClaims(rawText, result)) facts.push({ truth: described.negated ? described.value !== result.hybridisation : described.value === result.hybridisation, property: "hybridisation" });
    for (const described of electronCountClaims(rawText, result)) {
      if (!described.central) continue;
      const sourceCount = described.kind === "lone-pair" ? actualLonePairs(result) : Number(result.unpairedElectron);
      facts.push({ truth: described.negated ? described.count !== sourceCount : described.count === sourceCount, property: `${described.kind === "lone-pair" ? "lone-pair" : "unpaired-electron"} count` });
    }
    if (result.stericNumber === 5 && result.lonePairs > 0) {
      for (const described of centralLonePairPositions(rawText, result)) facts.push({ truth: described.negated ? described.position !== "equatorial" : described.position === "equatorial", property: "equatorial lone-pair position" });
    }
    if (claim.expected === false && facts.length && (facts.length !== 1 || /\b(?:and|or|but|while|whereas|although|nor)\b/i.test(rawText))) return `VSEPR plan claim ${claim.id} has unsupported compound boolean scope`;
    const conflict = facts.find(fact => fact.truth !== (claim.expected !== false));
    if (conflict) return `VSEPR plan claim ${claim.id} contradicts the source-derived ${conflict.property}`;
  }
  return null;
}

/** A closed carbon bond line is one molecule, not a list of VSEPR fragments.
 * CH2=C=O must not become a bent CH2, and a hyphen before the next atom is
 * a bond rather than a charge invented on the preceding group. Discrete
 * formulas and separate ions (CH4, or CH3- beside CH2) have no such line.
 */
function connectedCarbonStructure(question: string): boolean {
  return parseExamBondLines(question).some((line) => line.atoms.some((atom) => atom.element === "C"));
}

const MAX_SPECIES = 4;

/**
 * The complete formula set in the source. Up to four resolved species are
 * drawn together; an unsupported member or an overfull set declines rather
 * than silently drawing a recognized subset. A charge the source writes that
 * no read species carries (SO3 2-, NO2 -, "the ... ion" over neutral species)
 * declines too: the neutral shape and its angle are false for the ion asked.
 * So does any charge-like token (NO2 minus, SO3 two minus, with charge -1,
 * Cu II, a stray sign) when no read species is charged: the reader cannot
 * prove the neutral formula is the species asked, so it draws none.
 */
export function vseprSpecies(question: string): VseprResult[] {
  const text = repairOcr(normalizeChemistryText(question));
  const lower = text.toLowerCase();
  if (HARD_VETO.test(lower) || ORGANIC_VETO.test(lower) || connectedCarbonStructure(question)) return [];
  // The whole source owns the requested set. Selecting only a cue sentence
  // silently lost later "also draw" requests and unsupported list members.
  const tokens = vseprFormulaArguments(text, formulaTokens(text));
  const species = uniqueSpecies(tokens);
  if (species.length === 0 || species.length > MAX_SPECIES) return [];
  if (!chargeMarkersCarried(text, species.map((result) => result.formula))) return [];
  if (stemHasChargeLikeToken(question) && !species.some((result) => result.charge !== 0)) return [];
  return vseprSourceArgumentsComplete(sentencesOf(text), tokens, species) ? species : [];
}

function dipoleInputs(question: string): DipoleInput[] {
  return vseprSpecies(question).map((result) => ({
    formula: result.formula,
    label: result.label,
    central: result.central.symbol,
    centralEn: result.central.electronegativity,
    bondPairs: result.bondPairs,
    lonePairs: result.lonePairs,
    ligands: result.ligands.map((ligand) => ({ symbol: ligand.symbol, en: ligand.electronegativity, count: ligand.count })),
  }));
}

/** True when the stem asks about hybridisation, shape, angle, lone pairs, a dipole direction, or Fajan factors. */
export function isVseprStem(question: string): boolean {
  const stem = chemStem(question);
  if (HARD_VETO.test(stem) || ORGANIC_VETO.test(stem)) return false;
  if (!shapeIsTheAsk(stem) && fajanAsked(stem)) return true;
  if (dipoleIsTheAsk(stem) && dipoleInputs(question).some((input) => dipoleAccount(input) !== null)) return true;
  const species=vseprSpecies(question);
  if (!CUE.test(stem)) {
    const text=repairOcr(normalizeChemistryText(question));
    if(!hasValidatedVseprNotation(sentencesOf(text),vseprFormulaArguments(text,formulaTokens(text)),species))return false;
  }
  return species.length > 0;
}

/* ------------------------------------------------------------------------- */
/* Drawing                                                                   */
/* ------------------------------------------------------------------------- */

interface Slot {
  readonly deg: number;
  readonly len: number;
  readonly style: BondStyle;
  /** Position family, used to seat mixed ligands the way the exam expects. */
  readonly seat: SlotSeat;
}

export type SlotSeat = "axial" | "equatorial" | "plain";

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
  { deg: 225, len: 0.9, style: "wedge", seat: "equatorial" },
  { deg: 45, len: 0.9, style: "dash", seat: "equatorial" },
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
    case "6-3":
      return {
        bonds: [
          { deg: 90, len: 1, style: "plain", seat: "axial" },
          { deg: 270, len: 1, style: "plain", seat: "axial" },
          { deg: 0, len: 1, style: "plain", seat: "equatorial" },
        ],
        lonePairs: [{ deg: 150, dist: 0.42 }, { deg: 210, dist: 0.42 }, { deg: 180, dist: 0.72 }],
        angle: null,
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

/** Same source-derived layout/seating policy consumed by production and audit. */
export function vseprBondInkPlan(result: VseprResult): VseprBondInkPlan[] | null {
  const layout = layoutFor(result);
  const seated = layout ? seatLigands(result, layout) : null;
  if (!seated) return null;
  return seated.map(({ slot, ligand }) => ({ ligandLabel: ligand.label, style: slot.style,
    strokeCount: drawOrders(result) && slot.style !== "wedge" ? ligand.bondOrder : 1 }));
}

interface DrawnSpecies {
  readonly ids: string[];
  readonly frameIds: string[];
  readonly detailIds: string[];
  readonly atomIds: string[];
  readonly bondIds: string[];
  readonly electronIds: string[];
  readonly lonePairIds: Array<readonly [string, string]>;
  readonly formulaId: string;
  readonly panel: { minX: number; maxX: number; minY: number; maxY: number };
}

/** Reach of the panel beyond the molecule's furthest atom, so symbols and caption lines clear its border. */
const PANEL_SIDE = 0.5;
const TITLE_GAP = 0.65;
const CAPTION_GAP = 1;
const CAPTION_STEP = 0.65;
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

/**
 * The one angle a shape figure writes, on every stem, not only when the stem
 * says "angle": the source value (ideal, quoted, or a bound) wherever the
 * layout names the pair of bonds it belongs to, else null. TBP names its
 * axial to equatorial 90°; its oblique equatorial 120° is never written.
 * angleMark() decides how the value is shown: an arc between two in-plane
 * bonds with the value beside it, or a caption naming the atoms. Both are
 * part of the regenerated source graph, so certifyVseprSourceDocument
 * certifies them and still checks any plan angle scalar by species and role.
 */
export function characteristicAngle(result: VseprResult): string | null {
  return result.bondAngle && layoutFor(result)?.angle ? result.bondAngle : null;
}

/** The stem asks for an angle: main's rule for writing one before #287. */
const ANGLE_ASKED = /\bangles?\b|°|\bdegrees?\b/i;

/**
 * Whether a figure for this question writes characteristic angles. Only on
 * positive evidence of no charge: a stem with any charge-like token (NH4+
 * ion, NO2 minus, with charge -1) writes an angle only when it asks for one,
 * as main did, so a misread charge never gains an angle the stem did not ask.
 */
export function writesCharacteristicAngle(question: string): boolean {
  return !stemHasChargeLikeToken(question) || ANGLE_ASKED.test(chemStem(question));
}

/**
 * Pixels per world unit of a chemistry figure in the default board viewport,
 * as the compiler fits it: the panels' span into 612 by 427 px (the 740 by
 * 555 viewport less its 24 px padding and the 40 px glyph margin each side).
 * verify-vsepr-angle-arc-clearance checks this estimate against the compile.
 */
const FIT_PX = { width: 612, height: 427 } as const;
const LABEL_FONT_PX = 24;
const LABEL_PAD_PX = 4;
/** Clear ink kept between the angle value and every other mark, in px. */
const MARK_GAP_PX = 7;
/** Clearance between two labels' whole text boxes (verify-vsepr-label-geometry), in px. */
const LABEL_BOX_GAP_PX = 6;
const SECTOR_MARGIN_DEG = 3;

interface Box { readonly cx: number; readonly cy: number; readonly hw: number; readonly hh: number }
interface SpeciesInk {
  readonly origin: Vec2;
  readonly ligands: readonly Vec2[];
  /** Half the drawn width of each bond about its axis: a wedge's base, a multiple bond's outer stroke. */
  readonly bondHalfWidths: readonly number[];
  readonly dots: readonly Vec2[];
  /** Glyph ink of the atom symbols. */
  readonly symbols: readonly Box[];
  /** Whole text boxes of the atom symbols, as the label engine reserves them. */
  readonly symbolBoxes: readonly Box[];
}
type AngleMark =
  | { kind: "arc"; a: number; b: number; radius: number; value: Box; box: Box }
  | { kind: "caption"; text: string };

const norm360 = (deg: number) => ((deg % 360) + 360) % 360;

/** The swept sector c.angle() draws between two directions, in degrees. */
function sectorOf(degA: number, degB: number): { start: number; span: number } {
  let sweep = degB - degA;
  while (sweep <= -180) sweep += 360;
  while (sweep > 180) sweep -= 360;
  return { start: norm360(sweep >= 0 ? degA : degB), span: Math.abs(sweep) };
}

function inSector(deg: number, sector: { start: number; span: number }): boolean {
  const offset = norm360(deg - sector.start);
  return offset > SECTOR_MARGIN_DEG && offset < sector.span - SECTOR_MARGIN_DEG;
}

function inkBox(text: string, at: Vec2, pxPerUnit: number): Box {
  const ink = measureTextInkBounds(text, 0, 0, LABEL_FONT_PX);
  const width = ink?.width ?? text.length * LABEL_FONT_PX * 0.6;
  const height = ink?.height ?? LABEL_FONT_PX * 0.65;
  return { cx: at.x, cy: at.y, hw: (width / 2 + 1) / pxPerUnit, hh: (height / 2 + 1) / pxPerUnit };
}

/** The whole text box the label engine reserves for a pinned label centred at `at`. */
function textBox(text: string, at: Vec2, pxPerUnit: number): Box {
  return { cx: at.x, cy: at.y, hw: (measureTextWidth(text, LABEL_FONT_PX) / 2 + LABEL_PAD_PX) / pxPerUnit, hh: (LABEL_FONT_PX / 2 + LABEL_PAD_PX) / pxPerUnit };
}

function pointBoxDistance(p: Vec2, box: Box): number {
  const dx = Math.max(Math.abs(p.x - box.cx) - box.hw, 0);
  const dy = Math.max(Math.abs(p.y - box.cy) - box.hh, 0);
  return Math.hypot(dx, dy);
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function segmentBoxDistance(a: Vec2, b: Vec2, box: Box): number {
  const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => ({ x: box.cx + sx * box.hw, y: box.cy + sy * box.hh })));
  // Clipped to the box's slab, the segment touches the box iff its y-range there meets the box.
  const x0 = box.cx - box.hw, x1 = box.cx + box.hw;
  const tAt = (x: number) => (b.x === a.x ? null : (x - a.x) / (b.x - a.x));
  let lo = 0, hi = 1;
  if (b.x === a.x) { if (a.x < x0 || a.x > x1) lo = 2; }
  else { const t0 = tAt(x0)!, t1 = tAt(x1)!; lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1)); }
  if (lo <= hi) {
    const y = (t: number) => a.y + (b.y - a.y) * t;
    const yMin = Math.min(y(lo), y(hi)), yMax = Math.max(y(lo), y(hi));
    if (yMax >= box.cy - box.hh && yMin <= box.cy + box.hh) return 0;
  }
  return Math.min(pointBoxDistance(a, box), pointBoxDistance(b, box), ...corners.map((corner) => pointSegmentDistance(corner, a, b)));
}

function boxBoxDistance(a: Box, b: Box): number {
  return Math.hypot(Math.max(Math.abs(a.cx - b.cx) - a.hw - b.hw, 0), Math.max(Math.abs(a.cy - b.cy) - a.hh - b.hh, 0));
}

/**
 * An arc is honest only between two bonds drawn flat on the page (a plain
 * line projects its true angle; a wedge or dash does not), and only when its
 * swept sector holds no other bond or lone pair of the species: an arc that
 * crosses a third bond reads as a bent bond (NH3's dashed H, 24 Oct judge).
 */
function honestArc(layout: Layout, ink: SpeciesInk, radius: number): readonly [number, number] | null {
  if (!layout.angle) return null;
  const [a, b] = layout.angle;
  const slotA = layout.bonds[a];
  const slotB = layout.bonds[b];
  if (!slotA || !slotB || slotA.style !== "plain" || slotB.style !== "plain") return null;
  const sector = sectorOf(slotA.deg, slotB.deg);
  const direction = (p: Vec2) => (Math.atan2(p.y - ink.origin.y, p.x - ink.origin.x) * 180) / Math.PI;
  if (layout.bonds.some((slot, index) => index !== a && index !== b && inSector(slot.deg, sector))) return null;
  for (const dot of ink.dots) {
    if (inSector(direction(dot), sector)) return null;
    for (let i = 0; i <= 64; i++) {
      const rad = ((sector.start + (sector.span * i) / 64) * Math.PI) / 180;
      const on = { x: ink.origin.x + Math.cos(rad) * radius, y: ink.origin.y + Math.sin(rad) * radius };
      if (Math.hypot(on.x - dot.x, on.y - dot.y) < 0.08) return null;
    }
  }
  return [a, b];
}

/**
 * Where the value of an honest arc sits: inside its sector, just outside the
 * arc, its ink clear of every bond, symbol and lone pair by MARK_GAP_PX and
 * its text box clear of every symbol's box by LABEL_BOX_GAP_PX at the
 * figure's own scale, and nearer its arc than any other mark. Of the places
 * that qualify the nearest the arc wins, the bisector breaking near ties.
 * Null when none does (a narrow sector in a small multi-species figure).
 */
function arcValueBox(value: string, layout: Layout, pair: readonly [number, number], radius: number, ink: SpeciesInk, pxPerUnit: number): { value: Box; box: Box } | null {
  const [a, b] = pair;
  const sector = sectorOf(layout.bonds[a]!.deg, layout.bonds[b]!.deg);
  const gap = MARK_GAP_PX / pxPerUnit;
  const boxGap = LABEL_BOX_GAP_PX / pxPerUnit;
  const size = inkBox(value, ink.origin, pxPerUnit);
  const whole = textBox(value, ink.origin, pxPerUnit);
  let best: { value: Box; box: Box; toArc: number; offset: number } | null = null;
  const reach = Math.max(0, sector.span / 2 - 6);
  for (let offset = 0; offset <= reach; offset += 2) {
    for (const sign of offset === 0 ? [1] : [1, -1]) {
      const rad = ((sector.start + sector.span / 2 + sign * offset) * Math.PI) / 180;
      for (let d = radius; d <= radius + 1.2; d += 0.01) {
        const at = { cx: ink.origin.x + Math.cos(rad) * d, cy: ink.origin.y + Math.sin(rad) * d };
        const box = { ...size, ...at };
        const text = { ...whole, ...at };
        // Nearest point of the ink to the arc's centre, less the radius.
        const toArc = pointBoxDistance(ink.origin, box) - radius;
        if (toArc < gap) continue;
        // Off the bisector a place must sit 2 px nearer the arc to win.
        if (best && toArc >= best.toArc - 2 / pxPerUnit) break;
        if (ink.symbolBoxes.some((symbol) => boxBoxDistance(symbol, text) < boxGap)) continue;
        const nearestOther = Math.min(
          ...ink.ligands.map((end, index) => segmentBoxDistance(ink.origin, end, box) - ink.bondHalfWidths[index]!),
          ...ink.dots.map((dot) => pointBoxDistance(dot, box)),
          ...ink.symbols.map((symbol) => boxBoxDistance(symbol, box)),
        );
        if (nearestOther < gap || toArc + 1 / pxPerUnit >= nearestOther) continue;
        best = { value: box, box: text, toArc, offset };
        break;
      }
    }
  }
  return best ? { value: best.value, box: best.box } : null;
}

/**
 * The words that name a marked pair of bonds without the drawing: "" where
 * every pair of that shape shares the angle (CH4, BF3, NH3), "eq. " for two
 * equatorial bonds of a trigonal bipyramid (SF4: <120° against about 173°
 * axial), "ax-eq " for an axial and an equatorial one (PCl5: 90° against
 * 120° and 180°), "cis " for two adjacent bonds of an octahedron (SF6, BrF5,
 * XeF4: 90° against 180° trans). Null for a pair this does not name.
 */
export function anglePairQualifier(stericNumber: number, seatA: SlotSeat, seatB: SlotSeat): string | null {
  if (stericNumber < 5) return "";
  if (stericNumber === 5) {
    if (seatA === "equatorial" && seatB === "equatorial") return "eq. ";
    if ([seatA, seatB].includes("axial") && [seatA, seatB].includes("equatorial")) return "ax-eq ";
    return null;
  }
  // An octahedron's marked pairs are adjacent: an apex to the base, or two
  // neighbouring basal or square-planar bonds (layoutFor never marks a trans pair).
  if (stericNumber === 6) return "cis ";
  return null;
}

/**
 * The caption form, e.g. "H-N-H = 107°", "eq. F-S-F <120°", "cis F-S-F = 90°".
 * A caption names its pair in words, since no arc shows which bonds it
 * means; past the compact limit, or for a pair the words cannot name, it
 * is null and no angle is written (PCl5's "ax-eq Cl-P-Cl 90°" is too long:
 * a bare "Cl-P-Cl = 90°" reads as THE angle of a shape that has three).
 */
function angleCaption(result: VseprResult, layout: Layout, seated: readonly Seated[], value: string): string | null {
  const [a, b] = layout.angle!;
  const atoms = `${seated[a]!.ligand.label}-${result.central.symbol}-${seated[b]!.ligand.label}`;
  const prefix = anglePairQualifier(result.stericNumber, seated[a]!.slot.seat, seated[b]!.slot.seat);
  if (prefix === null) return null;
  const bound = value.startsWith("<") || value.startsWith(">");
  const forms = [bound ? `${prefix}${atoms} ${value}` : `${prefix}${atoms} = ${value}`, `${prefix}${atoms} ${value}`];
  return forms.find((form) => form.length <= 16) ?? null;
}

function angleMark(result: VseprResult, layout: Layout, seated: readonly Seated[], ink: SpeciesInk, value: string, pxPerUnit: number): AngleMark | null {
  const radius = layout.angleRadius ?? 0.36;
  // An arc shows its pair on the page, so its value is bare; it is still
  // drawn only on a pair the words could name (never a trans or other pair
  // whose angle differs from the value).
  const [first, second] = layout.angle!;
  if (anglePairQualifier(result.stericNumber, seated[first]!.slot.seat, seated[second]!.slot.seat) === null) return null;
  const pair = honestArc(layout, ink, radius);
  const placed = pair ? arcValueBox(value, layout, pair, radius, ink, pxPerUnit) : null;
  if (pair && placed) return { kind: "arc", a: pair[0], b: pair[1], radius, ...placed };
  const text = angleCaption(result, layout, seated, value);
  return text ? { kind: "caption", text } : null;
}

function drawSpecies(c: ChemScene, result: VseprResult, origin: Vec2, tag: string, pxPerUnit: number, withAngle: boolean): DrawnSpecies | null {
  const layout = layoutFor(result);
  if (!layout) return null;
  const seated = seatLigands(result, layout);
  if (!seated) return null;
  const orders = drawOrders(result);
  const frameIds: string[] = [];
  const detailIds: string[] = [];
  const bondIds: string[] = [];
  const electronIds: string[] = [];
  const lonePairIds: Array<readonly [string, string]> = [];
  const centralId = c.atom(`${tag}_A`, result.central.symbol, origin, { role: `${result.central.symbol} central atom` });
  frameIds.push(centralId);
  let minY = origin.y;
  let maxY = origin.y;
  let reachX = 0;
  const ligandIds: string[] = [];
  const ligandAt: Vec2[] = [];
  const pairDots: Vec2[] = [];
  seated.forEach(({ slot, ligand }, index) => {
    const rad = (slot.deg * Math.PI) / 180;
    const at = { x: origin.x + Math.cos(rad) * slot.len, y: origin.y + Math.sin(rad) * slot.len };
    ligandAt.push(at);
    minY = Math.min(minY, at.y);
    maxY = Math.max(maxY, at.y);
    reachX = Math.max(reachX, Math.abs(at.x - origin.x));
    const id = c.atom(`${tag}_L${index + 1}`, ligand.label, at, { role: `${ligand.label} ligand` });
    ligandIds.push(id);
    frameIds.push(id);
    const order = orders && slot.style !== "wedge" ? ligand.bondOrder : 1;
    const strokes = c.bond(`${tag}_b${index + 1}`, centralId, id, { style: slot.style, order, role: `${result.central.symbol} to ${ligand.label} bond` });
    frameIds.push(...strokes);
    bondIds.push(...strokes);
  });
  layout.lonePairs.forEach((pair, index) => {
    const rad = (pair.deg * Math.PI) / 180;
    const centre = { x: origin.x + Math.cos(rad) * pair.dist, y: origin.y + Math.sin(rad) * pair.dist };
    const spread = { x: -Math.sin(rad) * 0.11, y: Math.cos(rad) * 0.11 };
    if (result.unpairedElectron && index === layout.lonePairs.length - 1) pairDots.push(centre);
    else pairDots.push({ x: centre.x - spread.x, y: centre.y - spread.y }, { x: centre.x + spread.x, y: centre.y + spread.y });
    minY = Math.min(minY, origin.y + Math.sin(rad) * pair.dist - 0.12);
    maxY = Math.max(maxY, origin.y + Math.sin(rad) * pair.dist + 0.12);
    reachX = Math.max(reachX, Math.abs(Math.cos(rad) * pair.dist) + 0.12);
    if (result.unpairedElectron && index === layout.lonePairs.length - 1) {
      const at = { x: origin.x + Math.cos(rad) * pair.dist, y: origin.y + Math.sin(rad) * pair.dist };
      const dotId = c.scene.point(`${tag}_odd`, at, "unpaired electron");
      const entity = c.scene.entities.find((candidate) => candidate.id === dotId);
      if (entity) entity.provenance = { pointStyle: "filled" };
      electronIds.push(dotId);
      return;
    }
    const dots = c.lonePair(`${tag}_lp${index + 1}`, centralId, pair.deg, pair.dist);
    electronIds.push(...dots);
    lonePairIds.push([dots[0]!, dots[1]!]);
  });
  // Nonbonding electrons belong to the structure, just like its bonds.
  frameIds.push(...electronIds);
  const characteristic = withAngle ? characteristicAngle(result) : null;
  const ink: SpeciesInk = {
    origin, ligands: ligandAt, dots: pairDots,
    // sceneKit draws a wedge 0.09 wide at its base and multiple-bond strokes 0.1 apart.
    bondHalfWidths: seated.map(({ slot, ligand }) => {
      if (slot.style === "wedge") return 0.09;
      const order = orders ? ligand.bondOrder : 1;
      return order === 3 ? 0.1 : order === 2 ? 0.05 : 0;
    }),
    symbols: [inkBox(result.central.symbol, origin, pxPerUnit), ...seated.map(({ ligand }, index) => inkBox(ligand.label, ligandAt[index]!, pxPerUnit))],
    symbolBoxes: [textBox(result.central.symbol, origin, pxPerUnit), ...seated.map(({ ligand }, index) => textBox(ligand.label, ligandAt[index]!, pxPerUnit))],
  };
  const mark = characteristic ? angleMark(result, layout, seated, ink, characteristic, pxPerUnit) : null;
  const angleTextIds: string[] = [];
  if (mark?.kind === "arc") {
    detailIds.push(c.angle(`${tag}_ang`, centralId, ligandIds[mark.a]!, ligandIds[mark.b]!, undefined, mark.radius));
    // The value is pinned where arcValueBox proved it clear, not left to the
    // label solver, whose arc slots sat it a bond length away (or behind a
    // leader). It shares the arc's reveal group, so it never shows alone.
    const valueId = c.text(`${tag}_ang_val`, { x: mark.value.cx, y: mark.value.cy }, characteristic!, "bond angle value");
    detailIds.push(valueId);
    angleTextIds.push(valueId);
    // A linear molecule has no atom above its centre, but its semicircular
    // angle mark and value occupy that space: include them in the panel reach.
    minY = Math.min(minY, origin.y - mark.radius, mark.box.cy - mark.box.hh);
    maxY = Math.max(maxY, origin.y + mark.radius, mark.box.cy + mark.box.hh);
    reachX = Math.max(reachX, Math.abs(mark.box.cx - origin.x) + mark.box.hw);
  }
  const titleY = maxY + TITLE_GAP;
  const hybridY = minY - CAPTION_GAP;
  const shapeY = hybridY - CAPTION_STEP;
  // No honest arc: the value is written under the shape, naming its atoms.
  const angleY = mark?.kind === "caption" ? shapeY - CAPTION_STEP : shapeY;
  const domainY = angleY - CAPTION_STEP;
  const claim = mark ? angleClaim(characteristic!) : null;
  const claimY = claim ? domainY - CAPTION_STEP : domainY;
  const titleId = c.text(`${tag}_title`, { x: origin.x, y: titleY }, result.label, "species formula");
  frameIds.push(titleId);
  const hybridId = c.text(`${tag}_hyb`, { x: origin.x, y: hybridY }, result.hybridisationLabel, "hybridisation");
  const shapeId = c.text(`${tag}_shape`, { x: origin.x, y: shapeY }, result.shapeLabel, "molecular shape");
  if (mark?.kind === "caption") angleTextIds.push(c.text(`${tag}_ang_txt`, { x: origin.x, y: angleY }, mark.text, "bond angle"));
  const domainId = c.text(`${tag}_dom`, { x: origin.x, y: domainY }, ELECTRON_GEOMETRY_LABEL[result.electronGeometry], "electron geometry");
  detailIds.push(hybridId, shapeId, ...(mark?.kind === "caption" ? angleTextIds : []), domainId);
  let claimId: string | null = null;
  if (claim) {
    claimId = c.text(`${tag}_claim`, { x: origin.x, y: claimY }, claim, "angle is ideal, an inequality, or a quoted value");
    detailIds.push(claimId);
  }
  const top = titleY + PANEL_END;
  const bottom = claimY - PANEL_END;
  const halfWidth = Math.max(reachX + PANEL_SIDE, 1.45);
  frameIds.push(panel(c, `${tag}_panel`, { x: origin.x, y: (top + bottom) / 2 }, 2 * halfWidth, top - bottom));
  c.scene.labelled(centralId, titleId, hybridId, shapeId, ...angleTextIds, domainId, ...(claimId ? [claimId] : []));
  return { ids: [...frameIds, ...detailIds], frameIds, detailIds,
    atomIds: [centralId, ...ligandIds], bondIds, electronIds, lonePairIds, formulaId: titleId,
    panel: { minX: origin.x - halfWidth, maxX: origin.x + halfWidth, minY: bottom, maxY: top } };
}

function speciesCue(result: VseprResult): string {
  const lonePairs = actualLonePairs(result);
  const pairs = result.unpairedElectron
    ? `${lonePairs} lone pair${lonePairs === 1 ? "" : "s"} and one unpaired electron`
    : `${lonePairs} lone pair${lonePairs === 1 ? "" : "s"}`;
  return `${result.formula}: ${result.central.symbol} with ${result.bondPairs} bond pairs and ${pairs}, steric number ${result.stericNumber}, ${result.electronGeometry} electron geometry, ${result.shape} molecular shape, ${result.hybridisation}`;
}

const ELECTRON_GEOMETRY_LABEL: Record<ElectronGeometry, string> = {
  linear: "e: linear",
  "trigonal planar": "e: trig. planar",
  tetrahedral: "e: tetrahedral",
  "trigonal bipyramidal": "e: TBP",
  octahedral: "e: octahedral",
  "pentagonal bipyramidal": "e: pent. bipyr.",
};

function angleClaim(bondAngle: string): "ideal" | "quoted" | "inequality" {
  if (bondAngle.startsWith("<") || bondAngle.startsWith(">")) return "inequality";
  if (bondAngle === "180°" || bondAngle === "120°" || bondAngle === "109.5°" || bondAngle === "90°") return "ideal";
  return "quoted";
}

const SPECIES_PITCH = 3.6;

/** The compiler's uniform fit of these panels into FIT_PX. */
export function fitPxPerUnit(panels: ReadonlyArray<{ minX: number; maxX: number; minY: number; maxY: number }>): number {
  const spanX = Math.max(...panels.map((p) => p.maxX)) - Math.min(...panels.map((p) => p.minX));
  const spanY = Math.max(...panels.map((p) => p.maxY)) - Math.min(...panels.map((p) => p.minY));
  return Math.min(FIT_PX.width / Math.max(spanX, 1), FIT_PX.height / Math.max(spanY, 1));
}

/**
 * The figure for a stem: one molecule, or up to four listed species in a
 * row, each its own reveal group. Null when no species grounds it.
 */
export function buildVseprScene(question: string, quantities: ChemPlanQuantity[], schematic: boolean): SceneDocument | null {
  return buildVseprFigure(question, quantities, schematic)?.document ?? null;
}

/** A freshly recomputed molecule, not a caller-supplied membership claim. */
export interface VseprStructure {
  formulaId: string;
  atomIds: readonly string[];
  bondIds: readonly string[];
  electronIds: readonly string[];
  lonePairs: ReadonlyArray<{ entityIds: readonly [string, string]; equatorial: boolean }>;
  bonds: ReadonlyArray<readonly [string, string]>;
}

export interface VseprFigure {
  document: SceneDocument;
  structures: VseprStructure[];
}

export function buildVseprFigure(question: string, quantities: ChemPlanQuantity[], schematic: boolean): VseprFigure | null {
  void quantities;
  void schematic;
  const stem = chemStem(question);
  if (!shapeIsTheAsk(stem) && fajanAsked(stem)) {
    const fajan = buildFajanScene(question);
    if (fajan) return { document: fajan, structures: [] };
  }
  if (dipoleIsTheAsk(stem)) {
    const dipole = buildDipoleScene(question, dipoleInputs(question));
    if (dipole) return { document: dipole, structures: [] };
  }
  const species = vseprSpecies(question);
  if (species.length === 0) return null;
  const single = species.length === 1;
  const reason = single
    ? `${species[0]!.formula} by VSEPR: ${species[0]!.hybridisation}, ${species[0]!.shape}`
    : `shapes of ${species.map((result) => result.formula).join(", ")} by VSEPR`;
  const withAngle = writesCharacteristicAngle(question);
  const draw = (pxPerUnit: number) => {
    const scene = new ChemScene(question, reason, VSEPR_FAMILY);
    const items: Array<{ result: VseprResult; drawn: DrawnSpecies }> = [];
    species.forEach((result, index) => {
      const item = drawSpecies(scene, result, { x: index * SPECIES_PITCH, y: 0 }, `m${index + 1}`, pxPerUnit, withAngle);
      if (item) items.push({ result, drawn: item });
    });
    return { scene, items };
  };
  // The angle value is placed at the figure's own scale, which depends on the
  // panels it sizes: draw, fit, and redraw until the fit stops shrinking.
  let pxPerUnit = FIT_PX.height / 5;
  let pass = draw(pxPerUnit);
  for (let round = 0; round < 3 && pass.items.length === species.length; round++) {
    const fitted = fitPxPerUnit(pass.items.map((item) => item.drawn.panel));
    if (fitted >= pxPerUnit * 0.99) break;
    pxPerUnit = fitted;
    pass = draw(pxPerUnit);
  }
  const { scene: c, items: drawn } = pass;
  if (drawn.length !== species.length) return null;
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
    ? `${drawn[0]!.result.formula}: ${drawn[0]!.result.hybridisation}, ${drawn[0]!.result.shape}, ${actualLonePairs(drawn[0]!.result)} lone pair${actualLonePairs(drawn[0]!.result) === 1 ? "" : "s"}${drawn[0]!.result.unpairedElectron ? ", 1 unpaired electron" : ""}`
    : `Shapes of ${drawn.map((item) => item.result.formula).join(", ")}`;
  return {
    document: c.build({ caption: caption.slice(0, 60) }),
    structures: drawn.map(({ drawn: item, result }) => ({
      formulaId: item.formulaId, atomIds: item.atomIds, bondIds: item.bondIds, electronIds: item.electronIds,
      lonePairs: item.lonePairIds.map((entityIds) => ({ entityIds, equatorial: result.stericNumber === 5 })),
      bonds: item.atomIds.slice(1).map((id) => [item.atomIds[0]!, id] as const),
    })),
  };
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
  { question: "The shape of SF4 molecule and the hybridisation of sulphur in it are:", expect: "draw", labels: ["SF_4", "sp^3d", "see-saw"], note: "AX4E, one equatorial lone pair" },
  { question: "The hybridisation of Xe in XeF4 and the shape of the molecule are:", expect: "draw", labels: ["XeF_4", "sp^3d^2", "sq. planar"], note: "AX4E2, lone pairs trans" },
  { question: "The shape of BrF5 molecule is:", expect: "draw", labels: ["BrF_5", "sp^3d^2", "sq. pyramidal"] },
  { question: "The geometry of PCl5 and the hybridisation of P in it are:", expect: "draw", labels: ["PCl_5", "sp^3d", "TBP"] },
  { question: "The shape of ClF3 and its bond angle are:", expect: "draw", labels: ["ClF_3", "sp^3d", "T-shaped", "87.5°"] },
  { question: "The number of lone pairs on Xe in XeF2 and the shape of the molecule are:", expect: "draw", labels: ["XeF_2", "sp^3d", "linear"], forbidLabels: ["180°"], note: "three equatorial lone pairs, no arc" },
  { question: "The shape of I3- ion is:", expect: "draw", labels: ["I_3^(-)", "sp^3d", "linear"] },
  { question: "The bond angle in NH3 and the shape of the molecule are:", expect: "draw", labels: ["NH_3", "sp^3", "trig. pyramidal", "H-N-H = 107°"], note: "plain to wedge sector holds the dashed H: caption, no arc" },
  { question: "The bond angle of H2O and its geometry are:", expect: "draw", labels: ["H_2O", "sp^3", "bent", "104.5°"] },
  { question: "The shape of CO2 molecule is:", expect: "draw", labels: ["CO_2", "sp", "linear"] },
  { question: "The hybridisation of boron in BF3 and its shape are:", expect: "draw", labels: ["BF_3", "sp^2", "trig. planar"] },
  { question: "The hybridisation of S in SO4^2- ion and the shape of the ion are:", expect: "draw", labels: ["SO_4^(2-)", "sp^3", "tetrahedral"] },
  { question: "The shape of NO3- ion is:", expect: "draw", labels: ["NO_3^(-)", "sp^2", "trig. planar"] },
  { question: "The shape of XeOF4 molecule is:", expect: "draw", labels: ["XeOF_4", "sp^3d^2", "sq. pyramidal", "O"], forbidLabels: ["<90°"], note: "O at the apex, trans to the lone pair" },
  { question: "The geometry of IF7 is:", expect: "draw", labels: ["IF_7", "sp^3d^3", "pent. bipyr."] },
  { question: "The hybridisation of sulphur in SO2 and its shape are:", expect: "draw", labels: ["SO_2", "sp^2", "bent"] },
  { question: "The shape of NH4+ ion is:", expect: "draw", labels: ["NH_4^(+)", "sp^3", "tetrahedral"] },
  { question: "The shape of XeF6 molecule is:", expect: "draw", labels: ["XeF_6", "sp^3d^3", "dist. octahedral"] },
  { question: "The hybridisation and geometry of [Ni(CN)4]2- are:", expect: "decline", note: "coordination entity, another lane" },
  { question: "The shape of C2H4 molecule is:", expect: "decline", note: "no single central atom" },
  { question: "The molecule/ion with square pyramidal shape is: PF5, BrF5, PCl5, [Ni(CN)4]2-", expect: "decline", note: "unsupported coordination member cannot disappear from the source set" },
  { question: "Statement I: F2O < H2O < Cl2O is the correct trend in terms of bond angle. Statement II: SiF4, SnF4 and PbF4 are ionic in nature.", expect: "decline", note: "six-species source cannot be represented by a selected three-species fragment" },
  { question: "Identify the incorrect statement about the structure shown in the figure.", expect: "decline", note: "figure-absent stem" },
  { question: "The number of tetrahedral voids per atom in a ccp lattice is:", expect: "decline", note: "solid state, not a molecule" },
];
