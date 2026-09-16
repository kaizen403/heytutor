/**
 * Solutions and ionic equilibrium graphs: acid base titration curves,
 * Raoult's law vapour pressure lines, and the colligative vapour pressure
 * against temperature diagram behind boiling point elevation and freezing
 * point depression.
 *
 * A titration curve is drawn from the full charge balance, not from the
 * textbook piecewise formulas, so the steep part, the buffer region and the
 * hydrolysis at equivalence are all one continuous expression. The curve is a
 * parametric curve in pH (the parameter) because the inverse titration
 * equation V(pH) is closed form while pH(V) is not: for a weak acid HA of
 * concentration C_a and volume V_a titrated with strong base C_b,
 *
 *   V_b(h) = V_a (C_a Ka/(Ka + h) - h + Kw/h) / (C_b + h - Kw/h),  h = 10^(-pH)
 *
 * and the same shape holds for a strong acid (Ka/(Ka + h) -> 1) and, with the
 * roles of h and Kw/h swapped, for a base titrated with strong acid. Every
 * marked point (initial pH, half equivalence, equivalence) is proved with a
 * function_value assertion at its pinned parameter, so a numeric figure is
 * exact_verified and a shape question stays qualitative.
 *
 * The textbook values (pH = pKa at half equivalence, pH = 7 + (pKa + log C)/2
 * at equivalence) are computed alongside and used for the caption; on JEE
 * inputs they agree with the exact curve to two decimals.
 */
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, planQuantity, numberAfter, round, type ChemPlanQuantity, type Vec2 } from "./sceneKit";

export const SOLUTIONS_FAMILY = "chem_solutions" as const;

const KW = 1e-14;
const LN10 = Math.LN10;

/* ------------------------------------------------------------------------- */
/* Pure solvers                                                               */
/* ------------------------------------------------------------------------- */

export interface TitrationSpecies {
  kind: "acid" | "base";
  strength: "strong" | "weak";
  /** pKa of a weak acid or pKb of a weak base. Ignored for a strong species. */
  pK?: number;
  /** Replaceable protons of an acid or hydroxides of a base (H2SO4: 2, Ba(OH)2: 2). */
  protons?: number;
  /** Molarity in mol/L. */
  concentration: number;
  /** Analyte volume in mL. When absent the curve is drawn against V / V_eq. */
  volume?: number;
  /** Display formula, e.g. "CH_3COOH". */
  name: string;
}

export interface TitrationSpec {
  analyte: TitrationSpecies;
  titrant: TitrationSpecies;
}

export type TitrationKind = "strong acid + strong base" | "weak acid + strong base" | "weak base + strong acid" | "strong base + strong acid";

export interface TitrationCurve {
  kind: TitrationKind;
  /** True when pH rises with titrant volume (acid analyte). */
  rising: boolean;
  /** Analyte volume used for the curve (1 when the stem gave none). */
  analyteVolume: number;
  /** Titrant volume at equivalence, in the analyte's volume unit. */
  equivalenceVolume: number;
  pHInitial: number;
  pHHalfEquivalence: number;
  pHEquivalence: number;
  /** pH after twice the equivalence volume has been added. */
  pHEnd: number;
  /** Exact pH after `volume` of titrant (charge balance, autoionisation included). */
  pHAt(volume: number): number;
  /** Closed form titrant volume that gives `pH`; negative before the start. */
  volumeAt(pH: number): number;
  /** Textbook (JEE) values from the piecewise formulas, for the caption. */
  textbook: { pHInitial: number; pHHalfEquivalence: number | null; pHEquivalence: number };
  /** Indicator whose range sits on the steep part. */
  indicator: { name: string; low: number; high: number };
  /** V(pH) as an expression in t = pH for the scene engine's parametric_curve. */
  volumeExpression: string;
}

function effectiveConcentration(species: TitrationSpecies): number {
  return species.concentration * (species.protons ?? 1);
}

/**
 * Titration curve of one analyte (strong or weak acid, strong or weak base)
 * against a strong titrant of the opposite kind. Returns null for a pairing
 * the model does not cover (weak against weak, same kind) or for values that
 * are not positive.
 */
export function titrationCurve(spec: TitrationSpec): TitrationCurve | null {
  const { analyte, titrant } = spec;
  if (analyte.kind === titrant.kind) return null;
  if (titrant.strength !== "strong") return null;
  if (!(analyte.concentration > 0) || !(titrant.concentration > 0)) return null;
  if (analyte.strength === "weak" && !(typeof analyte.pK === "number" && analyte.pK > 0 && analyte.pK < 14)) return null;
  const va = analyte.volume ?? 1;
  if (!(va > 0)) return null;
  const a = effectiveConcentration(analyte);
  const t = effectiveConcentration(titrant);
  const rising = analyte.kind === "acid";
  const k = analyte.strength === "weak" ? Math.pow(10, -(analyte.pK as number)) : Infinity;
  // Fraction of the analyte present as its conjugate at proton concentration h.
  const alpha = rising
    ? (h: number) => (k === Infinity ? 1 : k / (k + h))
    : (h: number) => (k === Infinity ? 1 : h / (h + KW / k));
  const volumeAtH = (h: number): number => {
    const w = KW / h;
    return rising
      ? (va * (a * alpha(h) - h + w)) / (t + h - w)
      : (va * (a * alpha(h) + h - w)) / (t - h + w);
  };
  const volumeAt = (pH: number): number => volumeAtH(Math.exp(-LN10 * pH));
  // pH the titrant alone would reach: the asymptote of V(pH).
  const limitPH = rising ? 14 + Math.log10(t) : -Math.log10(t);
  const pHAt = (volume: number): number => {
    let lo = rising ? -2 : limitPH + 1e-6;
    let hi = rising ? limitPH - 1e-6 : 16;
    for (let i = 0; i < 100; i += 1) {
      const mid = (lo + hi) / 2;
      const v = volumeAt(mid);
      const below = rising ? v < volume : v > volume;
      if (below) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const equivalenceVolume = (va * a) / t;
  const pHInitial = pHAt(0);
  const pHHalfEquivalence = pHAt(equivalenceVolume / 2);
  const pHEquivalence = pHAt(equivalenceVolume);
  const pHEnd = pHAt(2 * equivalenceVolume);
  const kind: TitrationKind = rising
    ? (analyte.strength === "weak" ? "weak acid + strong base" : "strong acid + strong base")
    : (analyte.strength === "weak" ? "weak base + strong acid" : "strong base + strong acid");
  const saltConcentration = (va * a) / (va + equivalenceVolume);
  const pK = analyte.pK ?? 0;
  const textbook = analyte.strength === "strong"
    ? { pHInitial: rising ? -Math.log10(a) : 14 + Math.log10(a), pHHalfEquivalence: null, pHEquivalence: 7 }
    : rising
      ? { pHInitial: 0.5 * (pK - Math.log10(a)), pHHalfEquivalence: pK, pHEquivalence: 7 + 0.5 * (pK + Math.log10(saltConcentration)) }
      : { pHInitial: 14 - 0.5 * (pK - Math.log10(a)), pHHalfEquivalence: 14 - pK, pHEquivalence: 7 - 0.5 * (pK + Math.log10(saltConcentration)) };
  const indicator = kind === "weak acid + strong base"
    ? { name: "phenolphthalein", low: 8.3, high: 10 }
    : kind === "weak base + strong acid"
      ? { name: "methyl orange", low: 3.1, high: 4.4 }
      : { name: "phenolphthalein or methyl orange", low: 3.1, high: 10 };
  // h = 10^(-pH) is written as exp(-ln10 t): the engine's interval check
  // bounds exp exactly, while a variable power is widened to include 1 and
  // would report a denominator that "may be zero".
  const num = (value: number) => String(value);
  const h = `exp(-${LN10}*t)`;
  const w = `1e-14/exp(-${LN10}*t)`;
  const volumeExpression = rising
    ? (k === Infinity
      ? `${num(va)}*(${num(a)}-${h}+${w})/(${num(t)}+${h}-${w})`
      : `${num(va)}*(${num(a)}*${num(k)}/(${num(k)}+${h})-${h}+${w})/(${num(t)}+${h}-${w})`)
    : (k === Infinity
      ? `${num(va)}*(${num(a)}+${h}-${w})/(${num(t)}-${h}+${w})`
      : `${num(va)}*(${num(a)}*${h}/(${h}+${num(KW / k)})+${h}-${w})/(${num(t)}-${h}+${w})`);
  return {
    kind,
    rising,
    analyteVolume: va,
    equivalenceVolume,
    pHInitial,
    pHHalfEquivalence,
    pHEquivalence,
    pHEnd,
    pHAt,
    volumeAt,
    textbook,
    indicator,
    volumeExpression,
  };
}

export interface RaoultLines {
  pA0: number;
  pB0: number;
  /** Partial pressure of A at liquid mole fraction xA. */
  pA(xA: number): number;
  pB(xA: number): number;
  pTotal(xA: number): number;
  /** Vapour phase mole fraction of A. */
  yA(xA: number): number;
  /** Expressions in x = xA for function_curve. */
  expressions: { pA: string; pB: string; pTotal: string };
}

/** Raoult's law lines for an ideal binary solution of A (xA on the right) and B. */
export function raoultLines(pA0: number, pB0: number): RaoultLines {
  const pA = (xA: number) => pA0 * xA;
  const pB = (xA: number) => pB0 * (1 - xA);
  const pTotal = (xA: number) => pB0 + (pA0 - pB0) * xA;
  return {
    pA0,
    pB0,
    pA,
    pB,
    pTotal,
    yA: (xA: number) => pA(xA) / pTotal(xA),
    expressions: {
      pA: `${pA0}*x`,
      pB: `${pB0}*(1-x)`,
      pTotal: `${pB0}+(${pA0 - pB0})*x`,
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Stem reading                                                               */
/* ------------------------------------------------------------------------- */

interface SpeciesEntry {
  pattern: RegExp;
  kind: "acid" | "base";
  strength: "strong" | "weak";
  pK?: number;
  protons: number;
  name: string;
  generic?: boolean;
}

/** Textbook values: pKa (weak acids) and pKb (weak bases) at 25 °C. */
const SPECIES: SpeciesEntry[] = [
  { pattern: /h2so4|sulph?uric acid/, kind: "acid", strength: "strong", protons: 2, name: "H_2SO_4" },
  { pattern: /hclo4|perchloric acid/, kind: "acid", strength: "strong", protons: 1, name: "HClO_4" },
  { pattern: /hno3|nitric acid/, kind: "acid", strength: "strong", protons: 1, name: "HNO_3" },
  { pattern: /\bhcl\b|hydrochloric acid/, kind: "acid", strength: "strong", protons: 1, name: "HCl" },
  { pattern: /\bhbr\b|hydrobromic acid/, kind: "acid", strength: "strong", protons: 1, name: "HBr" },
  { pattern: /ch3cooh|acetic acid|ethanoic acid/, kind: "acid", strength: "weak", pK: 4.76, protons: 1, name: "CH_3COOH" },
  { pattern: /hcooh|formic acid|methanoic acid/, kind: "acid", strength: "weak", pK: 3.75, protons: 1, name: "HCOOH" },
  { pattern: /\bhcn\b|hydrocyanic acid/, kind: "acid", strength: "weak", pK: 9.21, protons: 1, name: "HCN" },
  { pattern: /\bhf\b|hydrofluoric acid/, kind: "acid", strength: "weak", pK: 3.17, protons: 1, name: "HF" },
  { pattern: /weak (?:mono(?:protic|basic) )?acid(?:\s*\(?\s*(?:hx|ha)\s*\)?)?|\b(?:hx|ha)\b/, kind: "acid", strength: "weak", protons: 1, name: "HA", generic: true },
  { pattern: /ba\(oh\)2|barium hydroxide/, kind: "base", strength: "strong", protons: 2, name: "Ba(OH)_2" },
  { pattern: /ca\(oh\)2|calcium hydroxide/, kind: "base", strength: "strong", protons: 2, name: "Ca(OH)_2" },
  { pattern: /\bnaoh\b|sodium hydroxide/, kind: "base", strength: "strong", protons: 1, name: "NaOH" },
  { pattern: /\bkoh\b|potassium hydroxide/, kind: "base", strength: "strong", protons: 1, name: "KOH" },
  { pattern: /\blioh\b|lithium hydroxide/, kind: "base", strength: "strong", protons: 1, name: "LiOH" },
  { pattern: /nh4oh|ammonium hydroxide|\bnh3\b|ammonia\b/, kind: "base", strength: "weak", pK: 4.75, protons: 1, name: "NH_3" },
  { pattern: /weak (?:mono(?:acidic|basic) )?base(?:\s*\(?\s*b\s*\)?)?/, kind: "base", strength: "weak", protons: 1, name: "B", generic: true },
];

const SPECIES_ALTERNATION = SPECIES.map((entry) => `(?:${entry.pattern.source})`).join("|");
const CONC_UNIT = "(?:m|n|molar|normal)\\b";
const VOLUME_UNIT = "(?:ml|cm\\^?3|cc)\\b";
const FILLER = "(?:(?:of|a|an|aqueous|solution|the)\\s+)*";
const VOL_CONC_SPECIES = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${VOLUME_UNIT}\\s+${FILLER}(\\d+(?:\\.\\d+)?)\\s*(${CONC_UNIT})\\s+${FILLER}(${SPECIES_ALTERNATION})`, "g");
const CONC_SPECIES = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${CONC_UNIT})\\s+${FILLER}(${SPECIES_ALTERNATION})`, "g");
const BARE_SPECIES = new RegExp(SPECIES_ALTERNATION, "g");

function speciesEntry(token: string): SpeciesEntry | null {
  return SPECIES.find((entry) => entry.pattern.test(token)) ?? null;
}

function genericName(entry: SpeciesEntry, token: string): string {
  if (!entry.generic) return entry.name;
  if (entry.kind === "acid") return /\bhx\b/.test(token) ? "HX" : "HA";
  return "B";
}

interface ReadSpecies {
  entry: SpeciesEntry;
  name: string;
  concentration: number;
  /** Concentration was given as normality. */
  normal: boolean;
  volume?: number;
  index: number;
  end: number;
}

function readSpeciesMentions(stem: string): { withVolume: ReadSpecies[]; withoutVolume: ReadSpecies[] } {
  const withVolume: ReadSpecies[] = [];
  const withoutVolume: ReadSpecies[] = [];
  for (const match of stem.matchAll(VOL_CONC_SPECIES)) {
    const entry = speciesEntry(match[4]!);
    if (!entry) continue;
    withVolume.push({
      entry,
      name: genericName(entry, match[4]!),
      concentration: Number(match[2]),
      normal: /^n/.test(match[3]!),
      volume: Number(match[1]),
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  for (const match of stem.matchAll(CONC_SPECIES)) {
    const index = match.index ?? 0;
    if (withVolume.some((seen) => index >= seen.index && index < seen.end)) continue;
    const entry = speciesEntry(match[3]!);
    if (!entry) continue;
    withoutVolume.push({
      entry,
      name: genericName(entry, match[3]!),
      concentration: Number(match[1]),
      normal: /^n/.test(match[2]!),
      index,
      end: index + match[0].length,
    });
  }
  return { withVolume, withoutVolume };
}

function firstNumber(stem: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const value = numberAfter(stem, pattern);
    if (value !== null && Number.isFinite(value)) return value;
  }
  return null;
}

/** pKa from the stem or plan: written directly, or from a stated Ka. */
function statedPK(stem: string, quantities: readonly ChemPlanQuantity[], which: "a" | "b"): number | null {
  const direct = planQuantity(quantities, [`pK${which}`, `pK_${which}`, `pk${which}`]);
  if (direct !== null && direct > 0 && direct < 14) return direct;
  const fromStem = firstNumber(stem, [
    new RegExp(`\\bpk_?${which}\\s*(?:\\([^)]*\\)|of\\s+[a-z0-9()]+)?\\s*(?:value)?`),
  ]);
  if (fromStem !== null && fromStem > 0 && fromStem < 14) return fromStem;
  const constant = planQuantity(quantities, [`K${which}`, `K_${which}`, `k${which}`])
    ?? firstNumber(stem, [new RegExp(`(?<![a-z])k_?${which}\\s*(?:\\([^)]*\\)|of\\s+[a-z0-9()]+)?\\s*(?:value)?`)]);
  if (constant !== null && constant > 0 && constant < 1) return -Math.log10(constant);
  return null;
}

function toSpecies(read: ReadSpecies, pK: number | null): TitrationSpecies | null {
  const protons = read.entry.protons;
  const concentration = read.normal ? read.concentration / protons : read.concentration;
  const strength = read.entry.strength;
  if (strength === "weak") {
    const value = pK ?? read.entry.pK ?? null;
    if (value === null) return null;
    return { kind: read.entry.kind, strength, pK: value, protons, concentration, volume: read.volume, name: read.name };
  }
  return { kind: read.entry.kind, strength, protons, concentration, volume: read.volume, name: read.name };
}

interface TitrationReading {
  spec: TitrationSpec;
  curve: TitrationCurve;
  /** True when the stem gave concentrations but no analyte volume. */
  normalisedVolume: boolean;
}

function readTitration(stem: string, quantities: readonly ChemPlanQuantity[]): TitrationReading | null {
  const { withVolume, withoutVolume } = readSpeciesMentions(stem);
  let analyte: ReadSpecies | undefined;
  let titrant: ReadSpecies | undefined;
  if (withVolume.length > 0 && withoutVolume.length > 0) {
    titrant = withoutVolume.find((candidate) => candidate.entry.kind !== withVolume[0]!.entry.kind)
      ?? withoutVolume.find((candidate) => withVolume.some((seen) => seen.entry.kind !== candidate.entry.kind));
    if (!titrant) return null;
    analyte = withVolume.find((candidate) => candidate.entry.kind !== titrant!.entry.kind);
  } else if (withVolume.length >= 2) {
    analyte = withVolume[0];
    titrant = withVolume.find((candidate) => candidate.entry.kind !== analyte!.entry.kind);
  } else if (withVolume.length === 0 && withoutVolume.length >= 2) {
    // Concentrations only: the curve is drawn against V / V_eq.
    analyte = withoutVolume[0];
    titrant = withoutVolume.find((candidate) => candidate.entry.kind !== analyte!.entry.kind);
  }
  if (!analyte || !titrant) return null;
  if (titrant.entry.strength !== "strong") return null;
  const pK = analyte.entry.kind === "acid" ? statedPK(stem, quantities, "a") : statedPK(stem, quantities, "b");
  const analyteSpecies = toSpecies(analyte, pK);
  const titrantSpecies = toSpecies(titrant, null);
  if (!analyteSpecies || !titrantSpecies) return null;
  const curve = titrationCurve({ analyte: analyteSpecies, titrant: titrantSpecies });
  if (!curve) return null;
  return { spec: { analyte: analyteSpecies, titrant: titrantSpecies }, curve, normalisedVolume: analyte.volume === undefined };
}

/** Shape question: which qualitative titration the stem names, if any. */
function qualitativeTitrationKind(stem: string): TitrationKind | null {
  const weakAcid = /weak (?:mono(?:protic|basic) )?acid/.test(stem);
  const weakBase = /weak (?:mono(?:acidic|basic) )?base/.test(stem);
  const strongAcid = /strong (?:mono(?:protic|basic) )?acid/.test(stem);
  const strongBase = /strong (?:mono(?:acidic|basic) )?base/.test(stem);
  const bases = [...stem.matchAll(BARE_SPECIES)].map((match) => speciesEntry(match[0])).filter((entry): entry is SpeciesEntry => Boolean(entry));
  const namedWeakAcid = weakAcid || bases.some((entry) => entry.kind === "acid" && entry.strength === "weak");
  const namedWeakBase = weakBase || bases.some((entry) => entry.kind === "base" && entry.strength === "weak");
  const namedStrongAcid = strongAcid || bases.some((entry) => entry.kind === "acid" && entry.strength === "strong");
  const namedStrongBase = strongBase || bases.some((entry) => entry.kind === "base" && entry.strength === "strong");
  if (namedWeakAcid && namedWeakBase) return null;
  if (namedWeakAcid && namedStrongBase) return "weak acid + strong base";
  if (namedWeakBase && namedStrongAcid) return "weak base + strong acid";
  if (namedWeakAcid || namedWeakBase) return null;
  if (namedStrongAcid && namedStrongBase) {
    // Which one sits in the flask decides whether pH rises or falls.
    const acidFirst = stem.search(/strong acid|hcl|hno3|h2so4|hclo4|hbr/) < stem.search(/strong base|naoh|koh|lioh|ba\(oh\)2|ca\(oh\)2/);
    const titrantIsBase = /(?:titrated|titration)\s+(?:with|against|by|using)\s+(?:a\s+|an\s+)?(?:\d[\d.]*\s*m\s+)?(?:strong base|naoh|koh|lioh)/.test(stem);
    const titrantIsAcid = /(?:titrated|titration)\s+(?:with|against|by|using)\s+(?:a\s+|an\s+)?(?:\d[\d.]*\s*m\s+)?(?:strong acid|hcl|hno3|h2so4|hclo4)/.test(stem);
    if (titrantIsBase) return "strong acid + strong base";
    if (titrantIsAcid) return "strong base + strong acid";
    return acidFirst ? "strong acid + strong base" : "strong base + strong acid";
  }
  return null;
}

/* ------------------------------------------------------------------------- */
/* Cues                                                                       */
/* ------------------------------------------------------------------------- */

const FIGURE_PRESENT = /shown (?:in|below|here|above)|following (?:figure|graph|diagram|curve|plot|table)|(?:figure|graph|curve|diagram|plot)s? (?:shown|given|drawn) (?:below|above|here)|given (?:in the )?(?:figure|graph|diagram|plot)|in the (?:figure|graph|diagram|plot)\b|the curve shown|as shown|diagram is obtained|figure below|graph below|curve below/;
const NOT_ACID_BASE_TITRATION = /thiosulph|thiosulf|kmno4|permanganate|k2cr2o7|dichromate|iodine|iodometr|iodimetr|\bedta\b|conductometr|potentiometr|redox|oxalic|oxalate|mno4|ceric|mohr|bleach|hypo\b|starch/;
const TITRATION_WORD = /\btitrat(?:ion|ed|ing|e)s?\b/;
const RAOULT_CUE = /raoult|positive deviation|negative deviation|deviations? from (?:the )?ideal|ideal solution.{0,120}(?:graph|plot|curve|deviation)|(?:graph|plot|curve).{0,120}ideal solution|vapou?r pressure.{0,160}(?:mole fraction|composition|plot|graph|deviation)|(?:mole fraction|composition|plot|graph).{0,160}vapou?r pressure/;
const COLLIGATIVE_CUE = /(?:elevation (?:in|of) (?:the )?boiling point|boiling point elevation|depression (?:in|of) (?:the )?freezing point|freezing point depression|ebullioscop|cryoscop).{0,200}(?:graph|diagram|curve|plot|vapou?r pressure)|(?:graph|diagram|curve|plot|vapou?r pressure).{0,200}(?:elevation (?:in|of) (?:the )?boiling point|boiling point elevation|depression (?:in|of) (?:the )?freezing point|freezing point depression)/;

function hasNamedAcidAndBase(stem: string): boolean {
  const entries = [...stem.matchAll(BARE_SPECIES)].map((match) => speciesEntry(match[0])).filter((entry): entry is SpeciesEntry => Boolean(entry));
  const acid = entries.some((entry) => entry.kind === "acid") || /strong acid|weak acid/.test(stem);
  const base = entries.some((entry) => entry.kind === "base") || /strong base|weak base/.test(stem);
  return acid && base;
}

function titrationCue(stem: string): boolean {
  if (NOT_ACID_BASE_TITRATION.test(stem)) return false;
  if (/titration curve|ph curve|ph titration/.test(stem)) return true;
  if (/equivalence point|half neutrali[sz]ation|end ?point/.test(stem) && hasNamedAcidAndBase(stem)) return true;
  if (TITRATION_WORD.test(stem) && hasNamedAcidAndBase(stem)) return true;
  return false;
}

/** True when this family should draw for the stem. */
export function isSolutionsGraphStem(question: string): boolean {
  const stem = chemStem(question);
  if (FIGURE_PRESENT.test(stem)) return false;
  return titrationCue(stem) || RAOULT_CUE.test(stem) || COLLIGATIVE_CUE.test(stem);
}

/* ------------------------------------------------------------------------- */
/* Drawing helpers                                                            */
/* ------------------------------------------------------------------------- */

function fmtNumber(value: number, digits = 2): string {
  const rounded = Number(value.toFixed(digits));
  return String(rounded);
}

/** A parametric curve in t (private helper: the shared builder has no parametric method). */
function parametricCurve(
  c: ChemScene,
  id: string,
  xExpression: string,
  yExpression: string,
  tMin: number,
  tMax: number,
  role: string,
  label?: string,
  samples = 161,
): string {
  c.scene.entities.push({ id, kind: "polyline", role, ...(label ? { label } : {}) });
  c.scene.constructions.push({
    id: `make_${id}`,
    operator: "parametric_curve",
    inputs: { xExpression, yExpression, parameter: "t", tMin: round(tMin, 6), tMax: round(tMax, 6), samples },
    outputs: [id],
  });
  return id;
}

function dashed(c: ChemScene, id: string, from: Vec2, to: Vec2, role: string, label?: string): string {
  const a = c.scene.helper(`${id}_a`, from, "guide end helper");
  const b = c.scene.helper(`${id}_b`, to, "guide end helper");
  const segment = c.scene.segment(id, a, b, role, label);
  const entity = c.scene.entities.find((candidate) => candidate.id === id);
  if (entity) entity.provenance = { ...(entity.provenance ?? {}), dashed: true, strokeRole: "construction" };
  return segment;
}

function setDashed(c: ChemScene, id: string): void {
  const entity = c.scene.entities.find((candidate) => candidate.id === id);
  if (entity) entity.provenance = { ...(entity.provenance ?? {}), dashed: true, strokeRole: "construction" };
}

/* ------------------------------------------------------------------------- */
/* Titration figure                                                           */
/* ------------------------------------------------------------------------- */

const PH_SPAN = 14;

function titrationScene(
  question: string,
  curve: TitrationCurve,
  spec: TitrationSpec | null,
  options: { numeric: boolean; normalisedVolume: boolean },
): SceneDocument | null {
  const { numeric, normalisedVolume } = options;
  const xSpan = 2 * curve.equivalenceVolume;
  // pH is display scaled so the plot keeps a readable aspect; every value in
  // an assertion is in the scaled space and every label reports the true pH.
  const k = (0.55 * xSpan) / PH_SPAN;
  const ySpan = PH_SPAN * k;
  const c = new ChemScene(
    question,
    numeric
      ? `${curve.kind} titration curve from the stated concentrations and volumes`
      : `qualitative ${curve.kind} titration curve`,
    SOLUTIONS_FAMILY,
  );
  c.scene.axes("axes", -0.05 * xSpan, 1.14 * xSpan, -0.06 * ySpan, 1.1 * ySpan, "pH against titrant volume axes");
  const tLow = Math.min(curve.pHInitial, curve.pHEnd);
  const tHigh = Math.max(curve.pHInitial, curve.pHEnd);
  parametricCurve(c, "curve", curve.volumeExpression, `${k}*t`, tLow, tHigh, "titration pH curve");
  const volumeUnit = normalisedVolume ? "" : " mL";
  c.text("x_axis_text", { x: 1.09 * xSpan, y: -0.13 * ySpan }, normalisedVolume ? "V / V_eq" : "V (mL)", "axis title");
  c.text("y_axis_text", { x: -0.06 * xSpan, y: 1.12 * ySpan }, "pH", "axis title");
  const eq: Vec2 = { x: curve.equivalenceVolume, y: k * curve.pHEquivalence };
  c.scene.point("eq_point", eq, "equivalence point", "eq. point");
  c.scene.point("eq_foot", { x: eq.x, y: 0 }, "equivalence volume on the axis", numeric
    ? (normalisedVolume ? "V_eq" : `V_eq = ${fmtNumber(curve.equivalenceVolume)}${volumeUnit}`)
    : "V_eq");
  dashed(c, "eq_drop", eq, { x: eq.x, y: 0 }, "drop to the equivalence volume");
  c.scene.point("eq_ph", { x: 0, y: eq.y }, "pH at equivalence on the axis", numeric ? `pH = ${fmtNumber(curve.pHEquivalence)}` : (curve.pHEquivalence > 7.5 ? "pH > 7" : curve.pHEquivalence < 6.5 ? "pH < 7" : "pH 7"));
  dashed(c, "eq_guide", { x: 0, y: eq.y }, eq, "guide to the equivalence pH");
  const half: Vec2 = { x: curve.equivalenceVolume / 2, y: k * curve.pHHalfEquivalence };
  const weak = curve.kind === "weak acid + strong base" || curve.kind === "weak base + strong acid";
  if (weak) {
    const pK = spec?.analyte.pK ?? 0;
    const halfLabel = !numeric
      ? (curve.rising ? "pH = pK_a" : "pOH = pK_b")
      : curve.rising
        ? (`pH = pK_a = ${fmtNumber(pK)}`.length <= 16 ? `pH = pK_a = ${fmtNumber(pK)}` : `pK_a = ${fmtNumber(pK)}`)
        : `pH = ${fmtNumber(curve.pHHalfEquivalence)}`;
    c.scene.point("half_point", half, "half equivalence point", halfLabel);
  }
  if (numeric) {
    c.scene.point("start_point", { x: 0, y: k * curve.pHInitial }, "initial pH", `pH = ${fmtNumber(curve.pHInitial)}`);
  } else {
    // A shape figure carries the neutral line the student compares against.
    dashed(c, "neutral", { x: 0, y: 7 * k }, { x: 1.05 * xSpan, y: 7 * k }, "pH 7 reference", curve.pHEquivalence > 7.5 || curve.pHEquivalence < 6.5 ? "pH 7" : undefined);
  }
  if (numeric) {
    c.scene.assert("eq_on_curve", "function_value", ["curve"], { t: round(curve.pHEquivalence, 8), x: round(eq.x, 8), y: round(eq.y, 8) });
    c.scene.assert("start_on_curve", "function_value", ["curve"], { t: round(curve.pHInitial, 8), x: 0, y: round(k * curve.pHInitial, 8) });
    if (weak) c.scene.assert("half_on_curve", "function_value", ["curve"], { t: round(curve.pHHalfEquivalence, 8), x: round(half.x, 8), y: round(half.y, 8) });
  }
  if (numeric) c.scene.assert("eq_rises", "ordered_along", curve.rising ? ["start_point", "eq_point"] : ["eq_point", "start_point"], { axis: "y", direction: "increasing" });
  c.scene.labelled("eq_point", "eq_foot", "eq_ph");
  if (weak) c.scene.labelled("half_point");
  const analyteName = spec ? spec.analyte.name.replace(/_/g, "") : curve.kind.split(" + ")[0];
  const titrantName = spec ? spec.titrant.name.replace(/_/g, "") : curve.kind.split(" + ")[1];
  const indicator = `${curve.indicator.name} (${curve.indicator.low} to ${curve.indicator.high})`;
  const caption = numeric && spec
    ? [
        `${normalisedVolume ? "" : `${fmtNumber(spec.analyte.volume ?? 1)} mL of `}${fmtNumber(spec.analyte.concentration, 4)} M ${analyteName} titrated with ${fmtNumber(spec.titrant.concentration, 4)} M ${titrantName}.`,
        normalisedVolume
          ? `Equivalence at V_eq = ${fmtNumber(curve.equivalenceVolume, 3)} times the ${analyteName} volume, pH ${fmtNumber(curve.pHEquivalence)}.`
          : `Equivalence at ${fmtNumber(curve.equivalenceVolume)} mL, pH ${fmtNumber(curve.pHEquivalence)}.`,
        `Initial pH ${fmtNumber(curve.pHInitial)}.`,
        weak
          ? curve.rising
            ? `At half equivalence pH = pKa = ${fmtNumber(spec.analyte.pK ?? 0)}; at equivalence the conjugate base hydrolyses, pH = 7 + (pKa + log C)/2 = ${fmtNumber(curve.textbook.pHEquivalence)}.`
            : `At half equivalence pOH = pKb = ${fmtNumber(spec.analyte.pK ?? 0)}, pH ${fmtNumber(curve.pHHalfEquivalence)}; at equivalence the conjugate acid hydrolyses, pH = 7 (pKb + log C)/2 = ${fmtNumber(curve.textbook.pHEquivalence)}.`
          : "Strong against strong: the salt does not hydrolyse, so the equivalence pH is 7.",
        `Suitable indicator: ${indicator}.`,
      ].join(" ")
    : [
        `${curve.kind} titration curve.`,
        weak
          ? curve.rising
            ? "The buffer region is flat; at half equivalence pH = pKa; at equivalence the salt hydrolyses so the equivalence pH is above 7."
            : "At half equivalence pOH = pKb; at equivalence the salt hydrolyses so the equivalence pH is below 7."
          : "The steep part spans several pH units around 7, so either phenolphthalein or methyl orange works.",
        `Suitable indicator: ${indicator}.`,
      ].join(" ");
  return c.build({ caption });
}

/* ------------------------------------------------------------------------- */
/* Raoult figure                                                              */
/* ------------------------------------------------------------------------- */

const PRESSURE_UNIT = "(torr|mm\\s*(?:of\\s*)?hg|mmhg|kpa|bar|atm|pa\\b|mm\\b)";
const COMPONENT_FILLER = "(?:(?:the|two|pure|volatile|liquids?|components?|solvents?|of|a)\\s+)*";

interface RaoultReading {
  names: [string, string];
  pA0: number;
  pB0: number;
  unit: string;
  xA: number | null;
}

function normaliseUnit(raw: string | undefined): string {
  const unit = (raw ?? "").replace(/\s+/g, " ").trim();
  if (/mm/.test(unit)) return "mm Hg";
  if (/kpa/.test(unit)) return "kPa";
  if (/bar/.test(unit)) return "bar";
  if (/atm/.test(unit)) return "atm";
  if (/^pa$/.test(unit)) return "Pa";
  return unit || "";
}

function readRaoult(stem: string, quantities: readonly ChemPlanQuantity[]): RaoultReading | null {
  const bindings: Array<{ name: string; value: number; unit: string }> = [];
  const number = "(\\d+(?:\\.\\d+)?)";
  const name = "([a-z][a-z0-9]*)";
  // "vapour pressures of pure A and B are 200 torr and 100 torr"
  const pair = new RegExp(`vapou?r pressures? of ${COMPONENT_FILLER}${name}\\s+and\\s+${COMPONENT_FILLER}${name}(?:\\s+at\\s+[^,.]{0,24}?)?\\s*(?:are|is|=|:|,)?\\s*${number}\\s*${PRESSURE_UNIT}?\\s*(?:and|,)\\s*${number}\\s*${PRESSURE_UNIT}?`, "g");
  for (const match of stem.matchAll(pair)) {
    bindings.push({ name: match[1]!, value: Number(match[3]), unit: normaliseUnit(match[4] ?? match[6]) });
    bindings.push({ name: match[2]!, value: Number(match[5]), unit: normaliseUnit(match[6] ?? match[4]) });
  }
  // "vapour pressure of pure A is 200 torr", "that of pure B is 100 torr"
  const single = new RegExp(`(?:vapou?r pressure|that) of ${COMPONENT_FILLER}${name}(?:\\s+at\\s+[^,.]{0,24}?)?\\s*(?:is|=|:|are)\\s*${number}\\s*${PRESSURE_UNIT}?`, "g");
  for (const match of stem.matchAll(single)) {
    if (bindings.some((binding) => binding.name === match[1])) continue;
    if (/^(?:the|pure|liquid|solution|solvent|mixture|water)$/.test(match[1]!) && !/^water$/.test(match[1]!)) continue;
    bindings.push({ name: match[1]!, value: Number(match[2]), unit: normaliseUnit(match[3]) });
  }
  // "p°A = 200 torr", "p_A^0 = 200"
  const symbolic = new RegExp(`\\bp\\s*(?:°|\\^0|\\^\\(0\\)|0)?\\s*_?\\s*([a-z])\\s*(?:°|\\^0|\\^\\(0\\)|0)?\\s*(?:=|is|:)\\s*${number}\\s*${PRESSURE_UNIT}?`, "g");
  for (const match of stem.matchAll(symbolic)) {
    if (bindings.some((binding) => binding.name === match[1])) continue;
    bindings.push({ name: match[1]!, value: Number(match[2]), unit: normaliseUnit(match[3]) });
  }
  const planA = planQuantity(quantities, ["pA0", "p_A0", "pA°", "p°A", "P_A^0", "pA"]);
  const planB = planQuantity(quantities, ["pB0", "p_B0", "pB°", "p°B", "P_B^0", "pB"]);
  if (bindings.length < 2 && planA !== null && planB !== null && planA > 0 && planB > 0) {
    bindings.length = 0;
    bindings.push({ name: "a", value: planA, unit: "" }, { name: "b", value: planB, unit: "" });
  }
  const distinct = bindings.filter((binding, index) => bindings.findIndex((other) => other.name === binding.name) === index);
  if (distinct.length !== 2) return null;
  const [first, second] = distinct as [typeof distinct[number], typeof distinct[number]];
  if (!(first.value > 0) || !(second.value > 0)) return null;
  const unit = first.unit || second.unit;
  const names: [string, string] = [first.name, second.name];
  let xA: number | null = null;
  const fraction = "(0?\\.\\d+|1(?:\\.0+)?|0)";
  const compositionPatterns: Array<{ pattern: RegExp; name: (m: RegExpExecArray) => string; value: (m: RegExpExecArray) => number }> = [
    { pattern: new RegExp(`mole fraction of ${COMPONENT_FILLER}${name}(?: in (?:the )?(?:liquid|solution)(?: phase)?)?\\s*(?:is|=|:|of)?\\s*${fraction}`), name: (m) => m[1]!, value: (m) => Number(m[2]) },
    { pattern: new RegExp(`${fraction}\\s*mole fraction of ${COMPONENT_FILLER}${name}`), name: (m) => m[2]!, value: (m) => Number(m[1]) },
    { pattern: new RegExp(`\\bx_?\\(?([a-z])\\)?\\s*(?:=|is)\\s*${fraction}`), name: (m) => m[1]!, value: (m) => Number(m[2]) },
  ];
  for (const candidate of compositionPatterns) {
    const match = candidate.pattern.exec(stem);
    if (!match) continue;
    const who = candidate.name(match);
    const value = candidate.value(match);
    if (!(value >= 0 && value <= 1)) continue;
    if (who === names[0]) { xA = value; break; }
    if (who === names[1]) { xA = 1 - value; break; }
  }
  if (xA === null && /equimolar/.test(stem)) xA = 0.5;
  if (xA === null) {
    const moles = new RegExp(`${number}\\s*mol(?:e|es)?\\s+(?:of\\s+)?${COMPONENT_FILLER}${name}[^.]{0,60}?${number}\\s*mol(?:e|es)?\\s+(?:of\\s+)?${COMPONENT_FILLER}${name}`).exec(stem);
    if (moles && moles[2] === names[0] && moles[4] === names[1]) xA = Number(moles[1]) / (Number(moles[1]) + Number(moles[3]));
    if (moles && moles[2] === names[1] && moles[4] === names[0]) xA = Number(moles[3]) / (Number(moles[1]) + Number(moles[3]));
  }
  return { names, pA0: first.value, pB0: second.value, unit, xA };
}

function displayName(raw: string, fallback: string): string {
  if (raw.length === 1) return raw.toUpperCase();
  if (raw.length <= 8) return raw;
  return fallback;
}

function raoultScene(question: string, reading: RaoultReading): SceneDocument | null {
  const lines = raoultLines(reading.pA0, reading.pB0);
  const pMax = Math.max(reading.pA0, reading.pB0);
  const k = 0.6 / pMax;
  const nameA = displayName(reading.names[0], "A");
  const nameB = displayName(reading.names[1], "B");
  const c = new ChemScene(question, "Raoult's law lines from the stated pure component vapour pressures", SOLUTIONS_FAMILY);
  c.scene.axes("axes", -0.05, 1.14, -0.05 * 0.6, 0.72, "vapour pressure against mole fraction axes");
  const scaledExpr = (expression: string) => `(${k})*(${expression})`;
  c.scene.curve("p_a", scaledExpr(lines.expressions.pA), 0, 1, "partial pressure of A", undefined, 17);
  c.scene.curve("p_b", scaledExpr(lines.expressions.pB), 0, 1, "partial pressure of B", undefined, 17);
  c.scene.curve("p_total", scaledExpr(lines.expressions.pTotal), 0, 1, "total vapour pressure", undefined, 17);
  c.scene.point("pure_a", { x: 1, y: k * reading.pA0 }, "pure A vapour pressure", `p°_${nameA} = ${fmtNumber(reading.pA0, 3)}`);
  c.scene.point("pure_b", { x: 0, y: k * reading.pB0 }, "pure B vapour pressure", `p°_${nameB} = ${fmtNumber(reading.pB0, 3)}`);
  c.scene.point("x_one", { x: 1, y: 0 }, "pure A on the axis", `x_${nameA} = 1`);
  dashed(c, "pure_a_drop", { x: 1, y: k * reading.pA0 }, { x: 1, y: 0 }, "drop at pure A");
  // Line names sit beside their own line (a path label would otherwise be
  // slotted on the line's bounding box, far from the ink): p_A beside x = 0.8
  // on the side away from p_B, p_B beside x = 0.2 on the side away from p_A,
  // p_total above its midpoint where nothing else is drawn.
  const aAbove = reading.pA0 < reading.pB0;
  c.text("p_a_text", { x: 0.8, y: k * lines.pA(0.8) + (aAbove ? 0.05 : -0.05) }, `p_${nameA}`, "line name");
  c.text("p_b_text", { x: 0.2, y: k * lines.pB(0.2) + (aAbove ? -0.05 : 0.05) }, `p_${nameB}`, "line name");
  c.text("p_total_text", { x: 0.42, y: k * lines.pTotal(0.42) + 0.05 }, "p_total", "line name");
  c.text("x_axis_text", { x: 1.1, y: -0.075 }, `x_${nameA}`, "axis title");
  c.text("y_axis_text", { x: -0.09, y: 0.7 }, reading.unit ? `p (${reading.unit})` : "p", "axis title");
  c.scene.assert("total_at_b", "function_value", ["p_total"], { x: 0, y: round(k * reading.pB0, 8) });
  c.scene.assert("total_at_a", "function_value", ["p_total"], { x: 1, y: round(k * reading.pA0, 8) });
  c.scene.assert("pa_at_a", "function_value", ["p_a"], { x: 1, y: round(k * reading.pA0, 8) });
  c.scene.assert("pb_at_b", "function_value", ["p_b"], { x: 0, y: round(k * reading.pB0, 8) });
  let compositionCaption = "";
  if (reading.xA !== null && reading.xA > 0.02 && reading.xA < 0.98) {
    const total = lines.pTotal(reading.xA);
    const at: Vec2 = { x: reading.xA, y: k * total };
    c.scene.point("mix_point", at, "stated composition on the total pressure line", `p_total = ${fmtNumber(total, 3)}`);
    c.scene.point("mix_foot", { x: reading.xA, y: 0 }, "stated composition on the axis", `x_${nameA} = ${fmtNumber(reading.xA, 3)}`);
    dashed(c, "mix_drop", at, { x: reading.xA, y: 0 }, "drop at the stated composition");
    c.scene.assert("total_at_mix", "function_value", ["p_total"], { x: round(reading.xA, 8), y: round(at.y, 8) });
    c.scene.labelled("mix_point");
    compositionCaption = ` At x_${nameA} = ${fmtNumber(reading.xA, 3)}: p_${nameA} = ${fmtNumber(lines.pA(reading.xA), 4)}, p_${nameB} = ${fmtNumber(lines.pB(reading.xA), 4)}, p_total = ${fmtNumber(total, 4)} ${reading.unit}; vapour mole fraction y_${nameA} = ${fmtNumber(lines.yA(reading.xA), 3)}.`;
  }
  c.scene.labelled("pure_a", "pure_b", "x_one");
  const unit = reading.unit ? ` ${reading.unit}` : "";
  const caption = `Ideal solution of ${nameA} and ${nameB}: p_${nameA} = p°_${nameA} x_${nameA} and p_${nameB} = p°_${nameB} (1 x_${nameA}) are straight lines, and p_total = p_${nameA} + p_${nameB} runs from p°_${nameB} = ${fmtNumber(reading.pB0, 4)}${unit} at pure ${nameB} to p°_${nameA} = ${fmtNumber(reading.pA0, 4)}${unit} at pure ${nameA}.${compositionCaption}`
    .replace("(1 x_", "(1 minus x_");
  return c.build({ caption });
}

function deviationScene(question: string, sign: 1 | -1, stem: string): SceneDocument | null {
  // Qualitative shape: symbolic pure component pressures, curves bowed by a
  // symmetric x(1 x) term of one sign for both partial pressures.
  const pA0 = 0.6;
  const pB0 = 0.4;
  const bow = 0.55 * sign;
  const c = new ChemScene(question, `${sign > 0 ? "positive" : "negative"} deviation from Raoult's law, qualitative`, SOLUTIONS_FAMILY);
  c.scene.axes("axes", -0.05, 1.14, -0.03, 0.78, "vapour pressure against mole fraction axes");
  const idealA = `${pA0}*x`;
  const idealB = `${pB0}*(1-x)`;
  const idealTotal = `${pB0}+${pA0 - pB0}*x`;
  c.scene.curve("ideal_a", idealA, 0, 1, "ideal partial pressure of A", undefined, 17);
  c.scene.curve("ideal_b", idealB, 0, 1, "ideal partial pressure of B", undefined, 17);
  c.scene.curve("ideal_total", idealTotal, 0, 1, "ideal total pressure", undefined, 17);
  setDashed(c, "ideal_a");
  setDashed(c, "ideal_b");
  setDashed(c, "ideal_total");
  const realA = (x: number) => pA0 * x * (1 + bow * (1 - x));
  const realB = (x: number) => pB0 * (1 - x) * (1 + bow * x);
  const realTotal = (x: number) => pB0 + (pA0 - pB0) * x + bow * (pA0 + pB0) * x * (1 - x);
  c.scene.curve("real_a", `${pA0}*x*(1+${bow}*(1-x))`, 0, 1, "partial pressure of A", undefined, 33);
  c.scene.curve("real_b", `${pB0}*(1-x)*(1+${bow}*x)`, 0, 1, "partial pressure of B", undefined, 33);
  c.scene.curve("real_total", `${idealTotal}+${bow * (pA0 + pB0)}*x*(1-x)`, 0, 1, "total vapour pressure", undefined, 33);
  c.scene.point("pure_a", { x: 1, y: pA0 }, "pure A vapour pressure", "p°_A");
  c.scene.point("pure_b", { x: 0, y: pB0 }, "pure B vapour pressure", "p°_B");
  c.scene.point("x_one", { x: 1, y: 0 }, "pure A on the axis", "x_A = 1");
  dashed(c, "pure_a_drop", { x: 1, y: pA0 }, { x: 1, y: 0 }, "drop at pure A");
  // Pinned line names: the partial pressure names sit under the lower of the
  // real and ideal line (the other component's lines are far below there);
  // the total names sit on the open side of each total curve.
  c.text("p_a_text", { x: 0.8, y: Math.min(realA(0.8), pA0 * 0.8) - 0.05 }, "p_A", "line name");
  c.text("p_b_text", { x: 0.2, y: Math.min(realB(0.2), pB0 * 0.8) - 0.05 }, "p_B", "line name");
  c.text("p_total_text", { x: 0.5, y: realTotal(0.5) + 0.05 * sign }, "p_total", "line name");
  c.text("ideal_text", { x: 0.5, y: pB0 + (pA0 - pB0) * 0.5 - 0.05 * sign }, "ideal", "line name");
  c.text("x_axis_text", { x: 1.1, y: -0.07 }, "x_A", "axis title");
  c.text("y_axis_text", { x: -0.08, y: 0.76 }, "p", "axis title");
  c.scene.labelled("pure_a", "pure_b", "x_one");
  const example = sign > 0
    ? (/ethanol|acetone|cs2|carbon disulphide|carbon disulfide|ccl4|carbon tetrachloride|methanol|benzene|toluene/.test(stem) && !/chloroform|chcl3|phenol|aniline/.test(stem)
      ? "ethanol + acetone"
      : "ethanol + acetone")
    : "chloroform + acetone";
  const why = sign > 0
    ? "A B interactions are weaker than A A and B B, so both components escape more easily: every curve lies above its Raoult line and ΔH_mix > 0, ΔV_mix > 0."
    : "A B interactions are stronger than A A and B B (chloroform hydrogen bonds to acetone), so both components escape less easily: every curve lies below its Raoult line and ΔH_mix < 0, ΔV_mix < 0.";
  const caption = `${sign > 0 ? "Positive" : "Negative"} deviation from Raoult's law, for example ${example}. Dashed lines are the ideal p_A, p_B and p_total; solid curves are the real values. ${why}`;
  return c.build({ caption });
}

function idealQualitativeScene(question: string): SceneDocument | null {
  const pA0 = 0.6;
  const pB0 = 0.4;
  const c = new ChemScene(question, "ideal solution Raoult's law lines, qualitative", SOLUTIONS_FAMILY);
  c.scene.axes("axes", -0.05, 1.14, -0.03, 0.72, "vapour pressure against mole fraction axes");
  c.scene.curve("p_a", `${pA0}*x`, 0, 1, "partial pressure of A", undefined, 17);
  c.scene.curve("p_b", `${pB0}*(1-x)`, 0, 1, "partial pressure of B", undefined, 17);
  c.scene.curve("p_total", `${pB0}+${pA0 - pB0}*x`, 0, 1, "total vapour pressure", undefined, 17);
  c.scene.point("pure_a", { x: 1, y: pA0 }, "pure A vapour pressure", "p°_A");
  c.scene.point("pure_b", { x: 0, y: pB0 }, "pure B vapour pressure", "p°_B");
  c.scene.point("x_one", { x: 1, y: 0 }, "pure A on the axis", "x_A = 1");
  dashed(c, "pure_a_drop", { x: 1, y: pA0 }, { x: 1, y: 0 }, "drop at pure A");
  c.text("p_a_text", { x: 0.8, y: pA0 * 0.8 - 0.05 }, "p_A", "line name");
  c.text("p_b_text", { x: 0.2, y: pB0 * 0.8 + 0.05 }, "p_B", "line name");
  c.text("p_total_text", { x: 0.42, y: pB0 + (pA0 - pB0) * 0.42 + 0.05 }, "p_total", "line name");
  c.text("x_axis_text", { x: 1.1, y: -0.07 }, "x_A", "axis title");
  c.text("y_axis_text", { x: -0.08, y: 0.7 }, "p", "axis title");
  c.scene.labelled("pure_a", "pure_b", "x_one");
  return c.build({ caption: "Ideal solution: p_A = p°_A x_A and p_B = p°_B x_B are straight lines through the pure component points, and p_total = p_A + p_B is the straight line joining p°_B (pure B, left) to p°_A (pure A, right). ΔH_mix = 0 and ΔV_mix = 0." });
}

/* ------------------------------------------------------------------------- */
/* Colligative vapour pressure diagram                                        */
/* ------------------------------------------------------------------------- */

function statedDeltaT(stem: string, quantities: readonly ChemPlanQuantity[], which: "b" | "f"): number | null {
  const plan = planQuantity(quantities, [`ΔT${which}`, `deltaT${which}`, `dT${which}`, `ΔT_${which}`, `delta_T_${which}`]);
  if (plan !== null && plan > 0) return plan;
  const phrases = which === "b"
    ? [/(?:elevation (?:in|of) (?:the )?boiling point|boiling point elevation|(?:δ|Δ|delta ?)t_?b)(?:\s*of (?:the |a |an |this )?(?:[a-z]+ )?(?:solution|water|solvent|benzene))?(?:\s+(?:is|was|of|=|:))?(?:\s+found to be|\s+observed(?: to be)?)?/]
    : [/(?:depression (?:in|of) (?:the )?freezing point|freezing point depression|(?:δ|Δ|delta ?)t_?f)(?:\s*of (?:the |a |an |this )?(?:[a-z]+ )?(?:solution|water|solvent|benzene))?(?:\s+(?:is|was|of|=|:))?(?:\s+found to be|\s+observed(?: to be)?)?/];
  const value = firstNumber(stem, phrases);
  if (value === null || !(value > 0) || value > 50) return null;
  const unitMatch = new RegExp(`${String(value)}\\s*(k\\b|°\\s*c|kelvin|degree)`).test(stem);
  return unitMatch ? value : null;
}

function colligativeScene(question: string, mode: "boiling" | "freezing", deltaT: number | null): SceneDocument | null {
  const c = new ChemScene(question, mode === "boiling" ? "vapour pressure against temperature: solvent and solution curves, boiling point elevation" : "vapour pressure against temperature: solid, solvent and solution curves, freezing point depression", SOLUTIONS_FAMILY);
  const unitLabel = deltaT !== null ? ` = ${fmtNumber(deltaT, 3)} K` : "";
  const deltaLabel = (symbol: string) => (`${symbol}${unitLabel}`.length <= 16 ? `${symbol}${unitLabel}` : symbol);
  // Curve names are pinned beside their own curve near the right end, on the
  // open side, so they cannot be mistaken for the neighbouring curve.
  if (mode === "boiling") {
    const liquid = (x: number) => 1.5 * Math.exp(0.3 * (x - 6));
    const solution = (x: number) => 0.75 * liquid(x);
    c.scene.axes("axes", -0.4, 10.8, -0.3, 5.6, "vapour pressure against temperature axes");
    c.scene.curve("solvent", "1.5*exp(0.3*(x-6))", 0.5, 10, "vapour pressure of the pure solvent", undefined, 65);
    c.scene.curve("solution", "1.125*exp(0.3*(x-6))", 0.5, 10, "vapour pressure of the solution", undefined, 65);
    const tb0 = 6;
    const tb = 6 + Math.log(1 / 0.75) / 0.3;
    dashed(c, "atm_line", { x: 0, y: 1.5 }, { x: tb + 0.8, y: 1.5 }, "external pressure line");
    c.scene.point("atm_mark", { x: 0, y: 1.5 }, "1 atm on the pressure axis", "1 atm");
    c.scene.point("tb0_cross", { x: tb0, y: 1.5 }, "solvent boils here");
    c.scene.point("tb_cross", { x: tb, y: 1.5 }, "solution boils here");
    dashed(c, "tb0_drop", { x: tb0, y: 1.5 }, { x: tb0, y: 0 }, "drop to the solvent boiling point");
    dashed(c, "tb_drop", { x: tb, y: 1.5 }, { x: tb, y: 0 }, "drop to the solution boiling point");
    c.scene.point("tb0_foot", { x: tb0, y: 0 }, "boiling point of the pure solvent", "T_b°");
    c.scene.point("tb_foot", { x: tb, y: 0 }, "boiling point of the solution", "T_b");
    c.scene.dimension("delta", "tb0_foot", "tb_foot", "boiling point elevation", deltaLabel("ΔT_b"));
    c.text("solvent_text", { x: 9.2, y: liquid(9.2) + 0.4 }, "solvent", "curve name");
    c.text("solution_text", { x: 9.4, y: solution(9.4) - 0.4 }, "solution", "curve name");
    c.text("x_axis_text", { x: 10.6, y: -0.55 }, "T", "axis title");
    c.text("y_axis_text", { x: -0.7, y: 5.4 }, "p", "axis title");
    c.scene.assert("elevated", "ordered_along", ["tb0_foot", "tb_foot"], { axis: "x", direction: "increasing" });
    c.scene.assert("solvent_at_tb0", "function_value", ["solvent"], { x: tb0, y: 1.5 }, "warning");
    c.scene.labelled("tb0_foot", "tb_foot", "delta", "atm_mark");
    return c.build({ caption: `A nonvolatile solute lowers the vapour pressure at every temperature, so the solution curve lies below the solvent curve and reaches the external pressure of 1 atm only at a higher temperature: T_b > T_b°, the elevation ΔT_b${unitLabel} = K_b m.` });
  }
  // Freezing: the solid solvent curve meets the liquid solvent curve at T_f°
  // and is twice as steep, so the solution's lower curve meets it earlier.
  const tf0 = 5;
  const liquid = (x: number) => 2 * Math.exp(0.3 * (x - 5));
  const solution = (x: number) => 0.75 * liquid(x);
  const solid = (x: number) => 2 * Math.exp(0.6 * (x - 5));
  const tf = 5 + Math.log(0.75) / 0.3;
  c.scene.axes("axes", -0.4, 10.2, -0.4, 7.4, "vapour pressure against temperature axes");
  c.scene.curve("solid", "2*exp(0.6*(x-5))", 2.2, 5.7, "vapour pressure of the solid solvent", undefined, 33);
  c.scene.curve("solvent", "2*exp(0.3*(x-5))", 2.6, 9.2, "vapour pressure of the pure liquid solvent", undefined, 65);
  c.scene.curve("solution", "1.5*exp(0.3*(x-5))", 1.6, 9.4, "vapour pressure of the solution", undefined, 65);
  c.scene.point("tf0_cross", { x: tf0, y: liquid(tf0) }, "solvent freezes here");
  c.scene.point("tf_cross", { x: tf, y: solution(tf) }, "solution freezes here");
  dashed(c, "tf0_drop", { x: tf0, y: liquid(tf0) }, { x: tf0, y: 0 }, "drop to the solvent freezing point");
  dashed(c, "tf_drop", { x: tf, y: solution(tf) }, { x: tf, y: 0 }, "drop to the solution freezing point");
  c.scene.point("tf0_foot", { x: tf0, y: 0 }, "freezing point of the pure solvent", "T_f°");
  c.scene.point("tf_foot", { x: tf, y: 0 }, "freezing point of the solution", "T_f");
  c.scene.dimension("delta", "tf_foot", "tf0_foot", "freezing point depression", deltaLabel("ΔT_f"));
  c.text("solid_text", { x: 5.9, y: solid(5.7) + 0.35 }, "solid", "curve name");
  c.text("solvent_text", { x: 8.5, y: liquid(8.5) + 0.45 }, "solvent", "curve name");
  c.text("solution_text", { x: 8.7, y: solution(8.7) - 0.45 }, "solution", "curve name");
  c.text("x_axis_text", { x: 10.0, y: -0.7 }, "T", "axis title");
  c.text("y_axis_text", { x: -0.7, y: 7.2 }, "p", "axis title");
  c.scene.assert("depressed", "ordered_along", ["tf_foot", "tf0_foot"], { axis: "x", direction: "increasing" });
  c.scene.assert("solid_meets_solvent", "function_value", ["solid"], { x: tf0, y: round(liquid(tf0), 6) }, "warning");
  c.scene.assert("solid_meets_solution", "function_value", ["solid"], { x: round(tf, 6), y: round(solution(tf), 6) }, "warning");
  c.scene.labelled("tf0_foot", "tf_foot", "delta");
  return c.build({ caption: `The solid solvent curve is steeper than the liquid curves. The pure solvent freezes where the solid and liquid curves meet, T_f°; the solution's lower vapour pressure meets the solid curve at a lower temperature T_f, the depression ΔT_f${unitLabel} = K_f m.` });
}

/* ------------------------------------------------------------------------- */
/* Builder                                                                    */
/* ------------------------------------------------------------------------- */

/** The figure, or null when the stem does not ground it. */
export function buildSolutionsGraphScene(
  question: string,
  quantities: ChemPlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  void schematic;
  const stem = chemStem(question);
  if (FIGURE_PRESENT.test(stem)) return null;
  if (titrationCue(stem)) {
    const numeric = readTitration(stem, quantities);
    if (numeric) return titrationScene(question, numeric.curve, numeric.spec, { numeric: true, normalisedVolume: numeric.normalisedVolume });
    const kind = qualitativeTitrationKind(stem);
    if (!kind) return null;
    const analyte: TitrationSpecies = kind.startsWith("weak acid")
      ? { kind: "acid", strength: "weak", pK: 5, concentration: 0.1, name: "HA" }
      : kind.startsWith("weak base")
        ? { kind: "base", strength: "weak", pK: 5, concentration: 0.1, name: "B" }
        : kind.startsWith("strong acid")
          ? { kind: "acid", strength: "strong", concentration: 0.1, name: "HA" }
          : { kind: "base", strength: "strong", concentration: 0.1, name: "B" };
    const titrant: TitrationSpecies = analyte.kind === "acid"
      ? { kind: "base", strength: "strong", concentration: 0.1, name: "NaOH" }
      : { kind: "acid", strength: "strong", concentration: 0.1, name: "HCl" };
    const curve = titrationCurve({ analyte, titrant });
    if (!curve) return null;
    return titrationScene(question, curve, null, { numeric: false, normalisedVolume: true });
  }
  if (COLLIGATIVE_CUE.test(stem)) {
    const boilingAt = stem.search(/elevation (?:in|of) (?:the )?boiling point|boiling point elevation|ebullioscop/);
    const freezingAt = stem.search(/depression (?:in|of) (?:the )?freezing point|freezing point depression|cryoscop/);
    if (boilingAt < 0 && freezingAt < 0) return null;
    const mode: "boiling" | "freezing" = boilingAt >= 0 && (freezingAt < 0 || boilingAt < freezingAt) ? "boiling" : "freezing";
    return colligativeScene(question, mode, statedDeltaT(stem, quantities, mode === "boiling" ? "b" : "f"));
  }
  if (RAOULT_CUE.test(stem)) {
    const positive = /positive deviation|deviates? positively/.test(stem);
    const negative = /negative deviation|deviates? negatively/.test(stem);
    const reading = readRaoult(stem, quantities);
    if (reading && !positive && !negative) return raoultScene(question, reading);
    if (positive && !negative) return deviationScene(question, 1, stem);
    if (negative && !positive) return deviationScene(question, -1, stem);
    if (positive && negative) {
      // Both named: the question is about which is which; draw the positive case
      // only when the stem asks for a graph, otherwise decline.
      return /graph|plot|curve|draw|sketch/.test(stem) ? deviationScene(question, 1, stem) : null;
    }
    if (reading) return raoultScene(question, reading);
    if (/ideal solution|raoult/.test(stem) && /graph|plot|curve|draw|sketch|diagram/.test(stem)) return idealQualitativeScene(question);
    return null;
  }
  return null;
}

/* ------------------------------------------------------------------------- */
/* Probes                                                                     */
/* ------------------------------------------------------------------------- */

export const SOLUTIONS_PROBES: ReadonlyArray<{
  question: string;
  expect: "draw" | "decline";
  labels?: string[];
  forbidLabels?: string[];
  note?: string;
}> = [
  {
    question: "25 mL of 0.1 M HCl is titrated with 0.1 M NaOH. Draw the titration curve and find the pH at the equivalence point.",
    expect: "draw",
    labels: ["eq. point", "pH = 7", "V_eq = 25 mL", "pH = 1"],
    note: "strong acid + strong base: V_eq 25 mL, pH 7 at equivalence, initial pH 1, pH 12.52 at 50 mL",
  },
  {
    question: "25 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH (pKa of CH3COOH = 4.76). Sketch the pH curve and mark the equivalence point.",
    expect: "draw",
    labels: ["eq. point", "pH = 8.73", "pH = pK_a = 4.76", "pH = 2.88", "V_eq = 25 mL"],
    note: "weak acid + strong base: initial pH 2.88, half equivalence pH 4.76, equivalence pH 8.73",
  },
  {
    question: "25 mL of 0.1 M NH3 solution is titrated with 0.1 M HCl. What is the pH at the equivalence point and which indicator is suitable?",
    expect: "draw",
    labels: ["eq. point", "pH = 5.28", "V_eq = 25 mL", "pH = 11.12"],
    forbidLabels: ["pH = 7"],
    note: "weak base + strong acid: equivalence pH 5.28 with pKb 4.75, methyl orange; initial pH 11.12 exact (11.13 by the textbook formula)",
  },
  {
    question: "Draw the titration curve of a weak acid with a strong base and mark the half equivalence point.",
    expect: "draw",
    labels: ["pH = pK_a", "eq. point", "pH 7"],
    forbidLabels: ["pH = 8.73", "V_eq = 25 mL"],
    note: "shape question: symbolic labels only",
  },
  {
    question: "Two volatile liquids A and B form an ideal solution. The vapour pressure of pure A is 200 torr and that of pure B is 100 torr. Plot the vapour pressure against mole fraction and find the total pressure when x_A = 0.5.",
    expect: "draw",
    labels: ["p°_A = 200", "p°_B = 100", "p_total = 150", "p_A", "p_B", "p_total"],
    note: "Raoult lines exact; p_total(0.5) = 150 torr proved by function_value",
  },
  {
    question: "Which mixture shows positive deviation from Raoult's law: ethanol and acetone, or chloroform and acetone? Draw the vapour pressure curves.",
    expect: "draw",
    labels: ["p_total", "ideal", "p°_A", "p°_B"],
    note: "qualitative positive deviation; caption names ethanol + acetone",
  },
  {
    question: "Chloroform and acetone show negative deviation from Raoult's law. Draw the vapour pressure versus composition graph.",
    expect: "draw",
    labels: ["p_total", "ideal"],
    note: "qualitative negative deviation; curves below the dashed ideal lines",
  },
  {
    question: "Explain elevation of boiling point with a vapour pressure versus temperature diagram.",
    expect: "draw",
    labels: ["solvent", "solution", "ΔT_b", "T_b°", "T_b", "1 atm"],
  },
  {
    question: "Depression of freezing point: draw the vapour pressure curve of the solvent and the solution showing ΔT_f.",
    expect: "draw",
    labels: ["solid", "solvent", "solution", "ΔT_f", "T_f°", "T_f"],
  },
  {
    question: "1.2 g of a non volatile solute dissolved in 50 g of water lowers the freezing point by 0.372 K. Calculate the molar mass of the solute (Kf = 1.86 K kg/mol).",
    expect: "decline",
    note: "numeric colligative calculation without a graph cue",
  },
  {
    question: "The titration curve shown below is for a weak acid titrated with NaOH. From the curve shown, find the pKa of the acid.",
    expect: "decline",
    note: "figure already present in the question",
  },
  {
    question: "A buffer contains 0.1 M CH3COOH and 0.2 M CH3COONa. Calculate its pH (pKa = 4.76).",
    expect: "decline",
    note: "buffer pH, no curve asked",
  },
  {
    question: "The osmotic pressure of a 0.1 M glucose solution at 300 K is (R = 0.083 L bar/K mol).",
    expect: "decline",
    note: "osmotic pressure apparatus is not modelled",
  },
  {
    question: "25 mL of 0.1 M H2SO4 is titrated with 0.1 M NaOH. Find the volume of NaOH at the equivalence point.",
    expect: "draw",
    labels: ["V_eq = 50 mL", "pH = 7", "pH = 0.7"],
    note: "diprotic strong acid: 5 mmol of H+ needs 50 mL of 0.1 M NaOH; initial pH = 0.70",
  },
  {
    question: "50 mL of 0.1 M CH3COOH is titrated against 0.1 M NaOH. When 25 mL of NaOH has been added, the pH of the solution is (pKa of CH3COOH = 4.76).",
    expect: "draw",
    labels: ["pH = pK_a = 4.76", "V_eq = 50 mL", "eq. point"],
    note: "real bank stem cleaned; half equivalence point is the asked value",
  },
  {
    question: "The liberated iodine is titrated with 0.1 M sodium thiosulphate solution using starch as indicator. If 20 mL of thiosulphate was consumed, find the amount of iodine.",
    expect: "decline",
    note: "redox titration, not an acid base pH curve",
  },
];
