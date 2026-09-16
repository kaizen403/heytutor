/**
 * Crystal field splitting figures for coordination compounds (JEE Main,
 * NCERT class 12 chapter 9).
 *
 * The figure is the d-orbital splitting diagram: the degenerate free-ion
 * levels on the left, a dashed barycentre across, and the split sets on the
 * right with the electrons drawn as up/down arrows and a vertical dimension
 * for Δo (or Δt). Under it the facts a stem asks for: spin state, CFSE,
 * unpaired electrons, spin-only moment, VBT hybridisation.
 *
 * Every value is derived from the complex the stem writes, through the shared
 * complex parser and a pure solver (`crystalFieldAnalysis`) other families may
 * call. Nothing is defaulted: an unreadable complex, an implausible oxidation
 * state, or a geometry this module does not model (CN 2, 3, 5) declines.
 *
 * Conventions (NCERT / JEE answer keys):
 *   CN 6 octahedral, t2g at 0.4Δo below and eg at 0.6Δo above the barycentre.
 *   CN 4 tetrahedral (e below t2, always high spin) unless the metal is d8
 *   with a strong ligand or is Pt(II)/Pd(II)/Au(III), or Cu(II) with N donors:
 *   then square planar (dsp2).
 *   Strong field: ligands from bipy/phen up (CN, CO, NO, NO2, PPh3, H, CH3);
 *   Co(III) pairs with everything above the halides ([Co(ox)3]3- and
 *   [Co(H2O)6]3+ are diamagnetic in the keys); 4d/5d metals always pair.
 *   A mixed complex follows the majority of its donor atoms, so the brown
 *   ring ion [Fe(H2O)5NO]2+ stays high spin.
 */
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, type ChemPlanQuantity, type Vec2 } from "./sceneKit";
import { complexTokens, formulaTokens, normalizeChemistryText, parseComplex, type ParsedComplex } from "./formula";
import { dElectronCount } from "./electronConfiguration";
import { elementBySymbol } from "./elements";
// The label engine reserves boxes measured with the board's own glyph
// metrics, so pinned labels are offset by the same measure.
import { measureTextWidth } from "@heytutor/drawing";

export const CFT_FAMILY = "chem_cft" as const;

export type CftGeometry = "octahedral" | "tetrahedral" | "square_planar" | "linear";

export interface CftLevel {
  /** Board label of the level set: t_2g, e_g, e, t_2, d_xy, d_(z2) ... */
  readonly label: string;
  /** Height in the drawing, in units of the splitting parameter for octahedral and tetrahedral; ordinal spacing for square planar. */
  readonly energy: number;
  /** Electron count in each orbital box of the set, 0, 1 or 2. */
  readonly boxes: readonly number[];
}

export interface CftResult {
  /** The complex as written, notation normalised. */
  readonly text: string;
  /** Formula label used on the board, 16 characters or fewer. */
  readonly ionLabel: string;
  readonly metal: string;
  readonly oxidationState: number;
  readonly dCount: number;
  readonly coordinationNumber: number;
  readonly geometry: CftGeometry;
  readonly fieldStrength: "strong" | "weak";
  /** Ligand that set the field (the highest-field ligand on the winning side). */
  readonly fieldLigand: string;
  /** High or low spin for d4 to d7 in an octahedral field; null where the count makes it moot or the geometry fixes it. */
  readonly spin: "high" | "low" | null;
  /** Level sets from lowest to highest energy with their box occupancy. */
  readonly levels: readonly CftLevel[];
  /** Octahedral occupancy; null for other geometries. */
  readonly t2g: number | null;
  readonly eg: number | null;
  readonly unpaired: number;
  readonly magneticMomentBM: number;
  readonly magnetism: "paramagnetic" | "diamagnetic";
  /** CFSE in units of Δo or Δt with the pairing count; null for square planar and linear. */
  readonly cfse: {
    readonly coefficient: number;
    readonly symbol: "Δ_o" | "Δ_t";
    /** Board text, e.g. "CFSE = -2.4Δ_o". */
    readonly text: string;
    /** Paired orbitals in the complex. */
    readonly pairs: number;
    /** Pairs beyond those the free ion already has (the P count in "-2.4Δo + 2P"). */
    readonly extraPairs: number;
  } | null;
  /** VBT hybridisation in board markup: d^2sp^3, sp^3d^2, dsp^2, sp^3, sp. */
  readonly hybridisation: string;
  /** Plain spelling: d2sp3, sp3d2, dsp2, sp3, sp. */
  readonly hybridisationPlain: string;
  readonly orbitalType: "inner" | "outer" | null;
  /** True when a d-d transition is possible (d1 to d9), the source of colour. */
  readonly ddTransition: boolean;
}

/* ------------------------------------------------------------------------- */
/* Solver                                                                    */
/* ------------------------------------------------------------------------- */

const SQUARE_PLANAR_D8_METALS = new Set(["Pt", "Pd", "Au", "Rh", "Ir"]);
const STRONG_RANK = 13;
const COBALT_III_STRONG_RANK = 7;
const ROMAN = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

function chargeText(charge: number, superscript: boolean): string {
  if (charge === 0) return "";
  const magnitude = Math.abs(charge) === 1 ? "" : String(Math.abs(charge));
  const sign = charge < 0 ? "-" : "+";
  return superscript ? `^(${magnitude}${sign})` : `${magnitude}${sign}`;
}

/** The coordination entity as a board label of at most 16 characters. */
function ionLabelFor(complex: ParsedComplex, dCount: number): string {
  const inside = /\[([^\]]+)\]/.exec(complex.text)?.[1] ?? complex.text;
  const subscripted = inside.replace(/([A-Za-z)])(\d+)/g, "$1_$2");
  const candidates = [
    `[${subscripted}]${chargeText(complex.charge, true)}`,
    `[${inside}]${chargeText(complex.charge, true)}`,
    `[${inside}]${chargeText(complex.charge, false)}`,
    `${complex.metal.symbol}(${ROMAN[complex.oxidationState] ?? complex.oxidationState}), d^${dCount}`,
    `${complex.metal.symbol}(${ROMAN[complex.oxidationState] ?? complex.oxidationState})`,
  ];
  return candidates.find((candidate) => candidate.length <= 16) ?? candidates[candidates.length - 1]!;
}

function ligandIsStrong(rank: number, metal: string, period: number, oxidationState: number): boolean {
  if (period >= 5) return true;
  if (metal === "Co" && oxidationState === 3) return rank >= COBALT_III_STRONG_RANK;
  return rank >= STRONG_RANK;
}

interface Fill { boxes: number[][]; }

/** Put `count` electrons into level sets following `order`, a list of [levelIndex, pass] where pass 0 is a single and pass 1 completes a pair. */
function fill(sizes: readonly number[], order: ReadonlyArray<[number, 0 | 1]>, count: number): Fill {
  const boxes = sizes.map((size) => new Array<number>(size).fill(0));
  let left = count;
  for (const [level, pass] of order) {
    const row = boxes[level]!;
    for (let box = 0; box < row.length && left > 0; box += 1) {
      if (row[box] === pass) {
        row[box] = pass + 1;
        left -= 1;
      }
    }
  }
  return { boxes };
}

const OCTAHEDRAL_HIGH: ReadonlyArray<[number, 0 | 1]> = [[0, 0], [1, 0], [0, 1], [1, 1]];
const OCTAHEDRAL_LOW: ReadonlyArray<[number, 0 | 1]> = [[0, 0], [0, 1], [1, 0], [1, 1]];
const TETRAHEDRAL: ReadonlyArray<[number, 0 | 1]> = [[0, 0], [1, 0], [0, 1], [1, 1]];
const SQUARE_PLANAR: ReadonlyArray<[number, 0 | 1]> = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1]];

function formatCoefficient(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (Math.abs(rounded) < 1e-9) return "0";
  return rounded.toFixed(1);
}

function hybridisationMarkup(plain: string): string {
  return plain.replace(/(\d)/g, "^$1");
}

/**
 * The crystal field picture of one complex, or null when the complex cannot
 * be read, its oxidation state is not plausible, or its coordination number
 * has no textbook splitting here (2 is reported as linear, 3 and 5 decline).
 */
export function crystalFieldAnalysis(complexText: string): CftResult | null {
  const complex = parseComplex(complexText);
  if (!complex) return null;
  const metal = complex.metal;
  if (metal.block !== "d" || metal.group === null) return null;
  const oxidationState = complex.oxidationState;
  const ligandCharge = complex.ligands.reduce((sum, ligand) => sum + ligand.spec.charge * ligand.count, 0);
  // A charged ligand set with no written charge and no counter ion means the
  // student left the charge off; only a neutral entity with a familiar
  // oxidation state (Pt(NH3)2Cl2, Co(NH3)3Cl3, Ni(dmg)2) is trusted.
  if (unreadableCounterIon(complex)) return null;
  const chargeWritten = /[+-]\)?$/.test(complex.text) || complex.counterIon !== null;
  if (!chargeWritten && ligandCharge !== 0 && (oxidationState < 1 || oxidationState > 3)) return null;
  if (oxidationState < 0 || oxidationState > 7) return null;
  // CFT counts every valence electron as d: group number less oxidation
  // state, so Ni(0) is d10 and the brown ring Fe(I) is d7 (the aufbau count
  // from electronConfiguration keeps a 4s electron there, so it is only
  // consulted for the ordinary +2 and higher states).
  const dCount = metal.group - oxidationState;
  if (dCount < 0 || dCount > 10) return null;
  if (oxidationState >= 2) {
    const configured = dElectronCount(metal, oxidationState);
    if (configured !== null && configured !== dCount) return null;
  }
  const cn = complex.coordinationNumber;
  if (![2, 4, 6].includes(cn)) return null;

  const ranked = [...complex.ligands].sort((a, b) => b.spec.fieldRank - a.spec.fieldRank);
  const topRank = ranked[0]?.spec.fieldRank ?? 0;
  let geometry: CftGeometry;
  if (cn === 6) geometry = "octahedral";
  else if (cn === 2) geometry = "linear";
  else {
    const nDonor = complex.ligands.some((ligand) => ["NH3", "en", "CN", "bipy", "phen", "py", "dmg"].includes(ligand.spec.key));
    const squarePlanar =
      (dCount === 8 && (SQUARE_PLANAR_D8_METALS.has(metal.symbol) || topRank >= 14 || complex.ligands.some((ligand) => ligand.spec.key === "dmg"))) ||
      (dCount === 9 && metal.symbol === "Cu" && nDonor);
    geometry = squarePlanar ? "square_planar" : "tetrahedral";
  }

  let strongDonors = 0;
  let weakDonors = 0;
  let fieldLigand = ranked[0]?.spec.label ?? "";
  for (const ligand of complex.ligands) {
    const donors = ligand.spec.denticity * ligand.count;
    if (ligandIsStrong(ligand.spec.fieldRank, metal.symbol, metal.period, oxidationState)) strongDonors += donors;
    else weakDonors += donors;
  }
  const fieldStrength: "strong" | "weak" = strongDonors >= weakDonors && strongDonors > 0 ? "strong" : "weak";
  const side = complex.ligands.filter((ligand) => ligandIsStrong(ligand.spec.fieldRank, metal.symbol, metal.period, oxidationState) === (fieldStrength === "strong"));
  if (side.length) fieldLigand = [...side].sort((a, b) => b.spec.fieldRank - a.spec.fieldRank)[0]!.spec.label;

  let levels: CftLevel[];
  let spin: "high" | "low" | null = null;
  let cfse: CftResult["cfse"] = null;
  let hybridisationPlain: string;
  let orbitalType: "inner" | "outer" | null = null;
  const freeIonPairs = Math.max(0, dCount - 5);

  if (geometry === "octahedral") {
    const low = fieldStrength === "strong";
    const filled = fill([3, 2], low ? OCTAHEDRAL_LOW : OCTAHEDRAL_HIGH, dCount);
    levels = [
      { label: "t_2g", energy: -0.4, boxes: filled.boxes[0]! },
      { label: "e_g", energy: 0.6, boxes: filled.boxes[1]! },
    ];
    const spinMatters = dCount >= 4 && dCount <= 7;
    spin = spinMatters ? (low ? "low" : "high") : null;
    const t2g = filled.boxes[0]!.reduce((a, b) => a + b, 0);
    const eg = filled.boxes[1]!.reduce((a, b) => a + b, 0);
    const coefficient = -0.4 * t2g + 0.6 * eg;
    const pairs = filled.boxes.flat().filter((box) => box === 2).length;
    cfse = {
      coefficient: Math.round(coefficient * 10) / 10,
      symbol: "Δ_o",
      text: formatCoefficient(coefficient) === "0" ? "CFSE = 0" : `CFSE = ${formatCoefficient(coefficient)}Δ_o`,
      pairs,
      extraPairs: pairs - freeIonPairs,
    };
    const inner = dCount <= 3 || (spinMatters && low);
    hybridisationPlain = inner ? "d2sp3" : "sp3d2";
    orbitalType = inner ? "inner" : "outer";
  } else if (geometry === "tetrahedral") {
    const filled = fill([2, 3], TETRAHEDRAL, dCount);
    levels = [
      { label: "e", energy: -0.6, boxes: filled.boxes[0]! },
      { label: "t_2", energy: 0.4, boxes: filled.boxes[1]! },
    ];
    spin = dCount >= 4 && dCount <= 7 ? "high" : null;
    const e = filled.boxes[0]!.reduce((a, b) => a + b, 0);
    const t2 = filled.boxes[1]!.reduce((a, b) => a + b, 0);
    const coefficient = -0.6 * e + 0.4 * t2;
    const pairs = filled.boxes.flat().filter((box) => box === 2).length;
    cfse = {
      coefficient: Math.round(coefficient * 10) / 10,
      symbol: "Δ_t",
      text: formatCoefficient(coefficient) === "0" ? "CFSE = 0" : `CFSE = ${formatCoefficient(coefficient)}Δ_t`,
      pairs,
      extraPairs: pairs - freeIonPairs,
    };
    hybridisationPlain = "sp3";
  } else if (geometry === "square_planar") {
    const filled = fill([2, 1, 1, 1], SQUARE_PLANAR, dCount);
    levels = [
      { label: "d_xz, d_yz", energy: -1.5, boxes: filled.boxes[0]! },
      { label: "d_(z2)", energy: -0.6, boxes: filled.boxes[1]! },
      { label: "d_xy", energy: 0.6, boxes: filled.boxes[2]! },
      { label: "d_(x2-y2)", energy: 2.0, boxes: filled.boxes[3]! },
    ];
    hybridisationPlain = "dsp2";
  } else {
    const filled = fill([5], [[0, 0], [0, 1]], dCount);
    levels = [{ label: "d", energy: 0, boxes: filled.boxes[0]! }];
    hybridisationPlain = "sp";
  }

  const unpaired = levels.flatMap((level) => level.boxes).filter((box) => box === 1).length;
  const magneticMomentBM = Number(Math.sqrt(unpaired * (unpaired + 2)).toFixed(2));
  return {
    text: complex.text,
    ionLabel: ionLabelFor(complex, dCount),
    metal: metal.symbol,
    oxidationState,
    dCount,
    coordinationNumber: cn,
    geometry,
    fieldStrength,
    fieldLigand,
    spin,
    levels,
    t2g: geometry === "octahedral" ? levels[0]!.boxes.reduce((a, b) => a + b, 0) : null,
    eg: geometry === "octahedral" ? levels[1]!.boxes.reduce((a, b) => a + b, 0) : null,
    unpaired,
    magneticMomentBM,
    magnetism: unpaired > 0 ? "paramagnetic" : "diamagnetic",
    cfse,
    hybridisation: hybridisationMarkup(hybridisationPlain),
    hybridisationPlain,
    orbitalType,
    ddTransition: dCount >= 1 && dCount <= 9,
  };
}

/* ------------------------------------------------------------------------- */
/* Reading the stem                                                          */
/* ------------------------------------------------------------------------- */

const NOBLE_CORES = /^\[(He|Ne|Ar|Kr|Xe|Rn)\]$/;

/**
 * Text outside the brackets that the parser did not recognise as an ion
 * leaves the entity uncharged: "[Mn(Br)6]3" with its minus lost to OCR would
 * otherwise read as Mn(VI). Charged ligands with no charge from the counter
 * ion mean the counter ion was not read.
 */
function unreadableCounterIon(complex: ParsedComplex): boolean {
  if (complex.counterIon === null) return false;
  const ligandCharge = complex.ligands.reduce((sum, ligand) => sum + ligand.spec.charge * ligand.count, 0);
  return complex.charge === 0 && ligandCharge !== 0;
}
const BRACKET_TOKEN = /(?<![A-Za-z])[A-Za-z0-9()]*\[[A-Za-z][A-Za-z0-9(),]*\][A-Za-z0-9()]*(?:\^?\(?\d*[+-]\)?)?/g;
const BARE_COMPLEX = /(?<![A-Za-z[(])([A-Z][a-z]?(?:\([A-Za-z0-9]+\)\d*)+)(\^?\(?\d*[+-]\)?)?(?![A-Za-z\]])/g;

interface StemComplexes {
  /** Distinct complexes the stem writes that parse to a d-block coordination entity, in order. */
  readonly complexes: readonly ParsedComplex[];
  /** Bracket tokens that look like complexes but could not be read (OCR damage, unknown ligand, a bracket never closed). */
  readonly unreadable: readonly string[];
  /** Formula tokens outside every complex (other species the stem lists). */
  readonly otherFormulas: readonly string[];
}

function readComplexes(question: string): StemComplexes {
  const normalized = normalizeChemistryText(question);
  const seen = new Set<string>();
  const complexes: ParsedComplex[] = [];
  const unreadable: string[] = [];
  const consider = (token: string): void => {
    const parsed = parseComplex(token);
    if (!parsed) return;
    if (parsed.metal.block !== "d") return;
    if (unreadableCounterIon(parsed)) {
      unreadable.push(token);
      return;
    }
    const key = `${parsed.metal.symbol}|${[...parsed.ligands].map((ligand) => `${ligand.spec.key}${ligand.count}`).sort().join("")}|${parsed.charge}`;
    if (seen.has(key)) return;
    seen.add(key);
    complexes.push(parsed);
  };
  for (const token of complexTokens(question)) consider(token);
  for (const match of normalized.matchAll(BRACKET_TOKEN)) {
    const token = match[0];
    if (NOBLE_CORES.test(token)) continue;
    if (!parseComplex(token)) unreadable.push(token);
  }
  for (const match of normalized.matchAll(BARE_COMPLEX)) {
    const body = match[1]!;
    const charge = match[2] ?? "";
    const metal = elementBySymbol(/^[A-Z][a-z]?/.exec(body)![0]);
    if (!metal || metal.block !== "d") continue;
    consider(`[${body}]${charge}`);
  }
  // OCR often loses the closing bracket ("[Ni(CN),P- Square planar"): an
  // opening bracket on a capital letter with no close within reach is a
  // complex the stem lists that cannot be read.
  const openers = normalized.match(/\[(?=[A-Z])/g)?.length ?? 0;
  const closed = normalized.match(/\[[A-Z][^[\]]{0,40}\]/g)?.length ?? 0;
  for (let index = closed; index < openers; index += 1) unreadable.push("[unclosed");
  const complexSpellings = complexTokens(question);
  const otherFormulas = formulaTokens(question).filter((token) =>
    !complexSpellings.some((spelling) => spelling.includes(token)) && !/^\[/.test(token));
  return { complexes, unreadable, otherFormulas };
}

/**
 * Cues that need the splitting diagram itself: the stem asks for CFSE, the
 * spin state, the moment, the unpaired count, or the hybridisation.
 */
const HARD_CUE = /crystal field|cfse|splitting|[δΔ] ?_?\(?[o0t]\)?\b|delta ?_?[o0t]\b|\bt_?\(?2\)?g\b|\be_?g\b|high[ -]spin|low[ -]spin|spin[ -]?only|magnetic moment|unpaired|hybridi[sz]|inner[ -]orbital|outer[ -]orbital|d ?\^?2 ?sp ?\^?3|sp ?\^?3 ?d ?\^?2|\bdsp ?\^?2\b|spectrochemical/;
/** Cues the diagram explains but that a stem can also ask in words alone. */
const SOFT_CUE = /magnetic|paramagnet|diamagnet|colou?r|d-d transition|bohr magneton|\bb\.? ?m\.?\b/;
/** Stems the coordination lane owns: isomer counting and naming. */
const COORDINATION_LANE = /isomer|iupac/;
const FIGURE_REFERENCE = /shown in (the )?(figure|diagram)|given (figure|diagram)|following (figure|diagram|structure)|figure ?\(?[i1v]+\)?\b|in the figure|from the figure/;

/**
 * True when the stem writes a readable d-block complex and asks a crystal
 * field or magnetic question.
 *
 * Lane boundary: an isomer or IUPAC-name stem belongs to the coordination
 * lane, which draws the geometry the isomer count needs. "Paramagnetic" or
 * "diamagnetic" beside "isomer" does not move it here, because that part is
 * answered in one line from the d-count while the isomers need the picture.
 * A hard cue (CFSE, splitting, high or low spin, magnetic moment, spin only,
 * unpaired electrons, hybridisation) does move it here, because that part
 * cannot be taught without the splitting diagram.
 */
export function isCrystalFieldStem(question: string): boolean {
  const stem = chemStem(question);
  if (FIGURE_REFERENCE.test(stem)) return false;
  const hard = HARD_CUE.test(stem);
  if (COORDINATION_LANE.test(stem) && !hard) return false;
  if (!hard && !SOFT_CUE.test(stem)) return false;
  return readComplexes(question).complexes.length > 0;
}

/* ------------------------------------------------------------------------- */
/* Drawing                                                                   */
/* ------------------------------------------------------------------------- */

const LEVEL_W = 0.6;
const LEVEL_PITCH = 0.78;
const FREE_W = 0.5;
const FREE_PITCH = 0.62;
const FREE_HALF = 2 * FREE_PITCH + FREE_W / 2;
const FREE_OFFSET = 3.5;
/** Drawn splitting, world units: a strong field opens a wider gap than a weak one, and Δt is about 4/9 of Δo. No number is written on it. */
const DELTA_STRONG = 2.4;
const DELTA_WEAK = 1.5;
const DELTA_TETRAHEDRAL = 1.4;
const ARROW_LEN = 0.5;
const ARROW_DX = 0.14;
const DIM_GAP = 0.45;
const LABEL_GAP = 0.2;
const MAX_DIAGRAMS = 3;
/** The compiler's diagram zone (740 x 555) less the 64 px it reserves for labels on each side. */
const FIT_W_PX = 612;
const FIT_H_PX = 427;
/** The board letters labels at 24 px; the engine reserves that plus 4 px of padding. */
const LABEL_FONT_PX = 24;
const LABEL_BOX_PX = 32;
const LINE_STEP_PX = 32;

function labelPx(text: string): number {
  return Math.max(16, measureTextWidth(text, LABEL_FONT_PX) + 8);
}

type LabelSide = "left" | "above" | "below";

/** A three-box set is named above or below itself (no width cost); narrower sets are named on their left. */
function labelSide(result: CftResult, index: number): LabelSide {
  const level = result.levels[index]!;
  if (level.boxes.length < 3) return "left";
  return index === 0 ? "below" : "above";
}

function setHalfSpan(level: CftLevel): number {
  return ((level.boxes.length - 1) * LEVEL_PITCH) / 2 + LEVEL_W / 2;
}

interface DiagramPlan {
  readonly result: CftResult;
  /** Centre x of the split sets. */
  readonly xs: number;
  /** World y of each level set, lowest first. */
  readonly setYs: readonly number[];
  readonly sides: readonly LabelSide[];
  readonly hasDimension: boolean;
}

interface LayoutPlan {
  readonly scale: number;
  readonly diagrams: readonly DiagramPlan[];
  readonly full: boolean;
  readonly axisX: number;
  readonly yTop: number;
  readonly textTop: number;
  readonly textStep: number;
  readonly textBottom: number;
  readonly boxHeight: number;
  readonly lines: readonly string[][];
}

function drawnDelta(result: CftResult): number {
  if (result.geometry === "tetrahedral") return DELTA_TETRAHEDRAL;
  return result.fieldStrength === "strong" ? DELTA_STRONG : DELTA_WEAK;
}

function setYsFor(result: CftResult): number[] {
  const delta = drawnDelta(result);
  return result.levels.map((level) => (result.geometry === "square_planar" ? level.energy : level.energy * delta));
}

function spinLine(result: CftResult): string {
  const d = `d^${result.dCount}`;
  if (result.spin === "low") return `low spin, ${d}`;
  if (result.spin === "high") return `high spin, ${d}`;
  return d;
}

function textLines(result: CftResult): string[] {
  const lines: string[] = [result.ionLabel];
  if (result.geometry === "square_planar") lines.push("square planar");
  lines.push(spinLine(result));
  if (result.cfse) lines.push(result.cfse.text);
  lines.push(`${result.unpaired} unpaired`);
  lines.push(`μ = ${result.unpaired === 0 ? "0" : result.magneticMomentBM.toFixed(2)} BM`);
  lines.push(result.hybridisation);
  return lines;
}

/** How far the sets and their left-side names reach left of xs. */
function leftExtent(result: CftResult, scale: number): number {
  return Math.max(...result.levels.map((level, index) =>
    setHalfSpan(level) + (labelSide(result, index) === "left" ? LABEL_GAP + labelPx(level.label) / scale : 0)));
}

/**
 * Place the diagrams in a row and estimate the scale the compiler will fit
 * them at, so pinned labels can be offset by their pixel width. The estimate
 * and the layout depend on each other through the label widths, so it is
 * iterated to a fixed point.
 */
function planLayout(results: readonly CftResult[], full: boolean): LayoutPlan {
  const lines = results.map(textLines);
  let scale = 90;
  let plan: LayoutPlan | null = null;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const px = (value: number): number => value / scale;
    const boxHeight = px(LABEL_BOX_PX);
    const diagrams: DiagramPlan[] = [];
    const axisX = 0;
    let cursor = axisX + 0.55;
    let right = 0;
    results.forEach((result, index) => {
      const hasDimension = result.cfse !== null;
      const left = leftExtent(result, scale);
      const xs = full ? cursor + FREE_HALF + FREE_OFFSET : cursor + Math.max(left, index === 0 ? 0 : 0.15) + (index === 0 ? 0 : 0.15);
      const sides = result.levels.map((_, k) => labelSide(result, k));
      diagrams.push({ result, xs, setYs: setYsFor(result), sides, hasDimension });
      const halfSpan = Math.max(...result.levels.map(setHalfSpan));
      right = xs + halfSpan + (hasDimension ? DIM_GAP + LABEL_GAP + px(labelPx("Δ_o")) : 0.1);
      cursor = right + 0.3;
    });
    const textStep = px(LINE_STEP_PX);
    const lowest = Math.min(...diagrams.flatMap((diagram) => diagram.setYs));
    const highest = Math.max(...diagrams.flatMap((diagram) => diagram.setYs));
    const anyBelow = diagrams.some((diagram) => diagram.sides.includes("below"));
    const anyAbove = diagrams.some((diagram) => diagram.sides.includes("above"));
    const textTop = lowest - ARROW_LEN / 2 - (anyBelow ? LABEL_GAP + boxHeight : 0) - 0.55;
    const maxLines = Math.max(...lines.map((entry) => entry.length));
    const textBottom = textTop - (maxLines - 1) * textStep;
    const yTop = highest + ARROW_LEN / 2 + (anyAbove ? LABEL_GAP + boxHeight : 0) + 0.3;
    const width = right - axisX;
    const height = yTop + 0.4 - (textBottom - 0.3);
    const next = Math.min(FIT_W_PX / width, FIT_H_PX / height);
    plan = { scale: next, diagrams, full, axisX, yTop, textTop, textStep, textBottom, boxHeight, lines };
    if (Math.abs(next - scale) < 0.5) break;
    scale = next;
  }
  return plan!;
}

function electron(c: ChemScene, id: string, at: Vec2, spin: "up" | "down"): string {
  const tail = { x: at.x, y: at.y + (spin === "up" ? -ARROW_LEN / 2 : ARROW_LEN / 2) };
  const tailId = c.scene.helper(`${id}_t`, tail, "electron tail helper");
  return c.scene.vector(id, tailId, { direction: { x: 0, y: spin === "up" ? 1 : -1 }, length: ARROW_LEN }, "electron");
}

function electronsOn(c: ChemScene, id: string, at: Vec2, count: number): string[] {
  if (count === 1) return [electron(c, `${id}_e1`, at, "up")];
  if (count === 2) {
    return [
      electron(c, `${id}_e1`, { x: at.x - ARROW_DX, y: at.y }, "up"),
      electron(c, `${id}_e2`, { x: at.x + ARROW_DX, y: at.y }, "down"),
    ];
  }
  return [];
}

/** One level set centred at x: boxes as short levels with their electrons, and the set name pinned beside it. */
function drawSet(c: ChemScene, id: string, centre: Vec2, level: CftLevel, side: LabelSide, plan: LayoutPlan): string[] {
  const ids: string[] = [];
  const n = level.boxes.length;
  const first = centre.x - ((n - 1) * LEVEL_PITCH) / 2;
  const role = `${level.label.replace(/[_(),^]/g, "")} energy level`;
  level.boxes.forEach((electrons, index) => {
    const at = { x: first + index * LEVEL_PITCH, y: centre.y };
    ids.push(c.level(`${id}_${index}`, at, LEVEL_W, role), ...electronsOn(c, `${id}_${index}`, at, electrons));
  });
  const halfWidth = labelPx(level.label) / plan.scale / 2;
  const at = side === "left"
    ? { x: first - LEVEL_W / 2 - LABEL_GAP - halfWidth, y: centre.y }
    : { x: centre.x, y: centre.y + (side === "above" ? 1 : -1) * (ARROW_LEN / 2 + LABEL_GAP + plan.boxHeight / 2) };
  ids.push(c.text(`${id}_name`, at, level.label, "orbital set name"));
  return ids;
}

function freeIonBoxes(dCount: number): number[] {
  return fill([5], [[0, 0], [0, 1]], dCount).boxes[0]!;
}

/** One splitting diagram with its text column; in full mode the free-ion levels and the barycentre link come first. */
function drawDiagram(c: ChemScene, index: number, plan: LayoutPlan, diagram: DiagramPlan): string[] {
  const id = `cft${index}`;
  const ids: string[] = [];
  const { result, xs, setYs } = diagram;
  const y0 = 0;

  if (plan.full) {
    const xL = xs - FREE_OFFSET;
    const firstX = xL - 2 * FREE_PITCH;
    freeIonBoxes(result.dCount).forEach((electrons, box) => {
      const at = { x: firstX + box * FREE_PITCH, y: y0 };
      ids.push(c.level(`${id}_free_${box}`, at, FREE_W, "free ion d level"), ...electronsOn(c, `${id}_free_${box}`, at, electrons));
    });
    const nameY = y0 - ARROW_LEN / 2 - LABEL_GAP - plan.boxHeight / 2;
    ids.push(c.text(`${id}_free_name`, { x: xL, y: nameY }, "free ion", "orbital set name"));
    ids.push(c.text(`${id}_free_d`, { x: xL, y: nameY - plan.textStep }, `d^${result.dCount}`, "figure note"));
    const halfSpan = Math.max(...result.levels.map(setHalfSpan));
    ids.push(c.link(`${id}_bary`, { x: xL + FREE_HALF + 0.12, y: y0 }, { x: xs + halfSpan, y: y0 }, "barycentre link"));
  }

  result.levels.forEach((level, k) => {
    ids.push(...drawSet(c, `${id}_l${k}`, { x: xs, y: setYs[k]! }, level, diagram.sides[k]!, plan));
  });

  if (result.cfse && diagram.hasDimension) {
    const halfSpan = Math.max(...result.levels.map(setHalfSpan));
    const xd = xs + halfSpan + DIM_GAP;
    const a = c.scene.helper(`${id}_dim_a`, { x: xd, y: Math.min(...setYs) }, "splitting gap helper");
    const b = c.scene.helper(`${id}_dim_b`, { x: xd, y: Math.max(...setYs) }, "splitting gap helper");
    const dim = c.scene.dimension(`${id}_dim`, a, b, "crystal field splitting", result.cfse.symbol);
    ids.push(dim);
    c.scene.labelled(dim);
  }

  plan.lines[index]!.forEach((line, row) => {
    ids.push(c.text(`${id}_t${row}`, { x: xs, y: plan.textTop - row * plan.textStep }, line, row === 0 ? "complex formula" : "figure note"));
  });
  return ids;
}

/** The energy axis on the left: the textbook arrow, and the ink that keeps the text column inside the fitted view. */
function drawEnergyAxis(c: ChemScene, plan: LayoutPlan): string[] {
  const tail = c.scene.helper("energy_axis_t", { x: plan.axisX, y: plan.textBottom - 0.3 }, "energy axis helper");
  const axis = c.scene.vector("energy_axis", tail, { direction: { x: 0, y: 1 }, length: plan.yTop - (plan.textBottom - 0.3) }, "energy axis");
  const name = c.text("energy_axis_name", { x: plan.axisX, y: plan.yTop + 0.3 }, "E", "axis name");
  return [axis, name];
}

function captionFor(result: CftResult, colour: boolean): string {
  const ion = `${result.metal}${result.oxidationState > 0 ? `${result.oxidationState}+` : "(0)"}`;
  const parts: string[] = [`${result.text}: ${ion} d${result.dCount}`];
  if (result.geometry === "octahedral") {
    parts.push(`${result.fieldStrength} field ${result.fieldLigand}`);
    const occupancy = `t2g^${result.t2g} eg^${result.eg}`;
    parts.push(result.spin ? `${result.spin} spin ${occupancy}` : occupancy);
    if (result.cfse) parts.push(`CFSE ${result.cfse.text.replace("CFSE = ", "").replace("Δ_o", "Δo")}${result.cfse.extraPairs > 0 ? ` + ${result.cfse.extraPairs}P` : ""}`);
  } else if (result.geometry === "tetrahedral") {
    const [e, t2] = result.levels.map((level) => level.boxes.reduce((a, b) => a + b, 0));
    parts.push(`tetrahedral, high spin e^${e} t2^${t2}`);
    if (result.cfse) parts.push(`CFSE ${result.cfse.text.replace("CFSE = ", "").replace("Δ_t", "Δt")}`);
  } else if (result.geometry === "square_planar") {
    parts.push("square planar, dx2-y2 empty" + (result.dCount === 8 ? " (d8 pairs in the lower four)" : ""));
  }
  parts.push(`${result.unpaired} unpaired, ${result.magnetism}${result.unpaired ? `, μ = ${result.magneticMomentBM.toFixed(2)} BM` : ""}`);
  parts.push(`${result.hybridisationPlain}${result.orbitalType ? ` (${result.orbitalType} orbital)` : ""}`);
  if (colour) {
    parts.push(result.ddTransition
      ? "colour from a d-d transition, an electron absorbs visible light to jump the gap"
      : `no d-d transition for d${result.dCount}, colourless`);
  }
  return parts.join(", ");
}

/**
 * The splitting diagram for every complex the stem writes (up to three in a
 * row, each its own reveal group). Null when any listed complex cannot be
 * read or modelled, so the figure never shows a subset the tutor could
 * mistake for the whole list.
 */
export function buildCrystalFieldScene(
  question: string,
  quantities: ChemPlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  void quantities;
  void schematic;
  if (!isCrystalFieldStem(question)) return null;
  const read = readComplexes(question);
  if (read.unreadable.length > 0) return null;
  if (read.complexes.length === 0 || read.complexes.length > MAX_DIAGRAMS) return null;
  // A list that mixes complexes with other species (O2-, K2MnO4, NO2 ...)
  // would draw only its complexes, a subset the tutor could read as the
  // whole list; two or more such species decline the figure.
  if (read.otherFormulas.length >= 2) return null;
  const results: CftResult[] = [];
  for (const complex of read.complexes) {
    const result = crystalFieldAnalysis(complex.text);
    if (!result || result.geometry === "linear") return null;
    results.push(result);
  }
  const stem = chemStem(question);
  const colour = /colou?r/.test(stem);
  const full = results.length === 1;
  const reason = `crystal field splitting of ${results.map((result) => result.text).join(", ")}`;
  const c = new ChemScene(question, reason, CFT_FAMILY);
  const plan = planLayout(results, full);
  const axisIds = drawEnergyAxis(c, plan);
  plan.diagrams.forEach((diagram, index) => {
    const ids = drawDiagram(c, index, plan, diagram);
    if (index === 0) ids.push(...axisIds);
    c.scene.group(`cft_${index}`, ids, `${diagram.result.text}: ${diagram.result.geometry.replace("_", " ")}, ${diagram.result.unpaired} unpaired`);
  });
  return c.build({ caption: results.map((result) => captionFor(result, colour)).join("; ") });
}

/* ------------------------------------------------------------------------- */
/* Probes                                                                    */
/* ------------------------------------------------------------------------- */

export const CFT_PROBES: ReadonlyArray<{
  question: string;
  expect: "draw" | "decline";
  labels?: string[];
  forbidLabels?: string[];
  note?: string;
  /** Solver expectations replayed by the lab harness. */
  solver?: { unpaired: number; hybridisation: string; geometry: CftGeometry; spin?: "high" | "low" | null; cfse?: string };
}> = [
  {
    question: "Calculate the CFSE and spin only magnetic moment of [Fe(CN)6]4-.",
    expect: "draw",
    labels: ["[Fe(CN)_6]^(4-)", "low spin, d^6", "CFSE = -2.4Δ_o", "0 unpaired", "μ = 0 BM", "d^2sp^3", "t_2g", "e_g", "Δ_o"],
    solver: { unpaired: 0, hybridisation: "d2sp3", geometry: "octahedral", spin: "low", cfse: "CFSE = -2.4Δ_o" },
  },
  {
    question: "The number of unpaired electrons and the hybridisation of [Fe(H2O)6]2+ is",
    expect: "draw",
    labels: ["[Fe(H2O)6]^(2+)", "high spin, d^6", "CFSE = -0.4Δ_o", "4 unpaired", "μ = 4.90 BM", "sp^3d^2"],
    solver: { unpaired: 4, hybridisation: "sp3d2", geometry: "octahedral", spin: "high", cfse: "CFSE = -0.4Δ_o" },
  },
  {
    question: "Spin only magnetic moment of K3[Fe(CN)6] in BM is",
    expect: "draw",
    labels: ["[Fe(CN)_6]^(3-)", "low spin, d^5", "CFSE = -2.0Δ_o", "1 unpaired", "μ = 1.73 BM", "d^2sp^3"],
    solver: { unpaired: 1, hybridisation: "d2sp3", geometry: "octahedral", spin: "low", cfse: "CFSE = -2.0Δ_o" },
  },
  {
    question: "[Co(NH3)6]3+ is diamagnetic. Draw the crystal field splitting and give the hybridisation.",
    expect: "draw",
    labels: ["[Co(NH3)6]^(3+)", "low spin, d^6", "CFSE = -2.4Δ_o", "0 unpaired", "d^2sp^3"],
    solver: { unpaired: 0, hybridisation: "d2sp3", geometry: "octahedral", spin: "low", cfse: "CFSE = -2.4Δ_o" },
    note: "17 characters with subscripts, so the label falls back to plain digits",
  },
  {
    question: "Why is [CoF6]3- paramagnetic while [Co(NH3)6]3+ is diamagnetic? Explain using crystal field theory.",
    expect: "draw",
    labels: ["[CoF_6]^(3-)", "high spin, d^6", "4 unpaired", "sp^3d^2", "[Co(NH3)6]^(3+)", "low spin, d^6", "0 unpaired", "d^2sp^3"],
    note: "two complexes, two compact diagrams",
  },
  {
    question: "The spin only magnetic moment of [Cr(H2O)6]3+ is",
    expect: "draw",
    labels: ["[Cr(H2O)6]^(3+)", "d^3", "CFSE = -1.2Δ_o", "3 unpaired", "μ = 3.87 BM", "d^2sp^3"],
    forbidLabels: ["high spin, d^3", "low spin, d^3"],
    solver: { unpaired: 3, hybridisation: "d2sp3", geometry: "octahedral", spin: null, cfse: "CFSE = -1.2Δ_o" },
  },
  {
    question: "Number of unpaired electrons in [Mn(H2O)6]2+ and its magnetic moment",
    expect: "draw",
    labels: ["[Mn(H2O)6]^(2+)", "high spin, d^5", "CFSE = 0", "5 unpaired", "μ = 5.92 BM", "sp^3d^2"],
    solver: { unpaired: 5, hybridisation: "sp3d2", geometry: "octahedral", spin: "high", cfse: "CFSE = 0" },
  },
  {
    question: "[Mn(CN)6]4- has how many unpaired electrons? Is it inner orbital or outer orbital?",
    expect: "draw",
    labels: ["[Mn(CN)_6]^(4-)", "low spin, d^5", "CFSE = -2.0Δ_o", "1 unpaired", "d^2sp^3"],
    solver: { unpaired: 1, hybridisation: "d2sp3", geometry: "octahedral", spin: "low", cfse: "CFSE = -2.0Δ_o" },
  },
  {
    question: "[Ni(CN)4]2- is diamagnetic and square planar. Show the d orbital splitting and the hybridisation.",
    expect: "draw",
    labels: ["[Ni(CN)_4]^(2-)", "square planar", "d^8", "0 unpaired", "μ = 0 BM", "dsp^2", "d_(x2-y2)", "d_xy", "d_(z2)", "d_xz, d_yz"],
    forbidLabels: ["t_2g", "e_g", "Δ_o", "Δ_t"],
    solver: { unpaired: 0, hybridisation: "dsp2", geometry: "square_planar", spin: null },
  },
  {
    question: "[NiCl4]2- is paramagnetic with two unpaired electrons. Draw the tetrahedral splitting and give the hybridisation.",
    expect: "draw",
    labels: ["[NiCl_4]^(2-)", "d^8", "CFSE = -0.8Δ_t", "2 unpaired", "μ = 2.83 BM", "sp^3", "e", "t_2", "Δ_t"],
    forbidLabels: ["t_2g", "e_g", "Δ_o"],
    solver: { unpaired: 2, hybridisation: "sp3", geometry: "tetrahedral", spin: null, cfse: "CFSE = -0.8Δ_t" },
  },
  {
    question: "The magnetic moment of [Cu(NH3)4]2+ (in BM) and its hybridisation are",
    expect: "draw",
    labels: ["[Cu(NH3)4]^(2+)", "square planar", "d^9", "1 unpaired", "μ = 1.73 BM", "dsp^2"],
    solver: { unpaired: 1, hybridisation: "dsp2", geometry: "square_planar", spin: null },
  },
  {
    question: "[Ti(H2O)6]3+ is coloured. Explain on the basis of crystal field splitting.",
    expect: "draw",
    labels: ["[Ti(H2O)6]^(3+)", "d^1", "CFSE = -0.4Δ_o", "1 unpaired", "μ = 1.73 BM", "t_2g", "e_g", "Δ_o"],
    solver: { unpaired: 1, hybridisation: "d2sp3", geometry: "octahedral", spin: null, cfse: "CFSE = -0.4Δ_o" },
    note: "colour cue: the caption names the d-d transition",
  },
  {
    question: "Which of the following is diamagnetic: [Ni(CO)4], [NiCl4]2-, [Fe(CN)6]3-?",
    expect: "draw",
    labels: ["[Ni(CO)_4]", "d^10", "0 unpaired", "sp^3", "[NiCl_4]^(2-)", "2 unpaired", "[Fe(CN)_6]^(3-)", "1 unpaired"],
    note: "three options in a row, Ni(0) is d10 by group count",
  },
  {
    question: "Arrange [FeF6]3-, [Fe(CN)6]3- and [Mn(CN)6]4- in increasing order of magnetic moment.",
    expect: "draw",
    labels: ["[FeF_6]^(3-)", "5 unpaired", "[Fe(CN)_6]^(3-)", "1 unpaired", "[Mn(CN)_6]^(4-)", "μ = 5.92 BM", "μ = 1.73 BM"],
    note: "three options, the compact row",
  },
  {
    question: "Arrange [FeF6]3-, [Fe(CN)6]3-, [MnCl6]4- and [Mn(CN)6]4- in increasing order of magnetic moment.",
    expect: "decline",
    note: "four complexes: a fourth diagram in the 740 px zone drops below 50 px per unit and the arrows become blobs, so the row is capped at three",
  },
  {
    question: "How many geometrical isomers does [Co(NH3)4Cl2]+ have, and is it paramagnetic?",
    expect: "decline",
    note: "isomer stem belongs to the coordination geometry lane",
  },
  {
    question: "Write the IUPAC name of K4[Fe(CN)6].",
    expect: "decline",
    note: "no crystal field or magnetic cue",
  },
  {
    question: "[Co(en)(NH3)2Cl2]+ shows geometrical isomerism. What is its spin only magnetic moment and hybridisation?",
    expect: "draw",
    labels: ["Co(III), d^6", "low spin, d^6", "0 unpaired", "μ = 0 BM", "d^2sp^3"],
    note: "isomer stem with a hard cue (spin only, hybridisation) comes here; the formula is 18 characters so the label names the ion",
  },
  {
    question: "Among the species given below, the total number of diamagnetic species is: H atom, NO2 monomer, O2- (superoxide), Mn3O4, (NH4)2[FeCl4], (NH4)2[NiCl4], K2MnO4, K2CrO4",
    expect: "decline",
    note: "a mixed list; drawing only its two complexes would show a subset",
  },
  {
    question: "Match LIST-I with LIST-II: A. [Ni(CO)4] B. [Ni(CN),P- square planar, 0 BM C. [NiCL Oi tetrahedral, 0 BM",
    expect: "decline",
    note: "OCR left two brackets unclosed, so the list is not fully readable",
  },
  {
    question: "The sum of the spin only magnetic moment values (in B.M.) of [Mn(Br)6]3 and [Mn(CN)6]3 is",
    expect: "decline",
    note: "OCR dropped the minus signs, so the bare 3 is not a counter ion and the oxidation state is unreadable",
  },
  {
    question: "The spin only magnetic moment of hexaaquairon(II) ion is",
    expect: "decline",
    note: "the complex is named, not written, so nothing grounds the diagram",
  },
  {
    question: "Number of unpaired electrons in [Fe(CN)6] is",
    expect: "decline",
    note: "no charge and no counter ion, so the oxidation state is not readable",
  },
];
