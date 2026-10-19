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
import { ChemScene, chemStem, round, type ChemPlanQuantity, type Vec2 } from "./sceneKit";
import { CHEMISTRY_SCALAR_PATTERN, parseChemistryScalar, matchedChemistryScalar, matchedChemistryQuantity, matchedChemistryComponentAmount, readChemistryLiteral, readChemistryQuantityDeclaration, chemistryQuantityPayloadPresent, chemistryQuestionSpan, findChemistryQuantities, chemistryCanonicalValuesAgree, convertChemistryValue, chemistryPlanBindingsValid, type ChemistryUnit, type ChemistrySpan } from "./quantityReader";
import { buildSolutionLessonScene, claimsSolutionLesson } from "./solutionProperties";

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

/** Notation aliases apply only inside a complete species token. The original
 * question and every scalar/unit capture keep their original UTF-16 indices. */
const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";
function speciesNotationPattern(source: string): string {
  return source.replace(/\\b/g, "").replace(/[0-9]/g, digit => `[${digit}${SUBSCRIPT_DIGITS[Number(digit)]}]`);
}
function speciesIdentity(token: string): string {
  return token.replace(/\(aq\)$/i, "").replace(/[₀-₉]/g, digit => String(SUBSCRIPT_DIGITS.indexOf(digit))).toLowerCase();
}
// Prefixes, extra atoms/subscripts, charges, hydrates and unfinished groups
// are not the neutral species this titration model supports.
const SPECIES_LEFT = String.raw`(?<![\p{L}\p{N}\p{M}_^+−⁺⁻\-·/])`;
const SPECIES_RIGHT = String.raw`(?![\p{L}\p{N}\p{M}_^+−⁺⁻\-·/(\[{])`;
const ACID_BASE_CONSTANT_SYMBOL = String.raw`(?:p\s*)?k\s*_?\s*(?:\{\s*[ab]\s*\}|[ab])(?![a-z])`;
const ATTACHED_CONSTANT_START = String.raw`\(\s*(?=${ACID_BASE_CONSTANT_SYMBOL})`;
function completeSpeciesPattern(source: string): string {
  // A typed annotation opening is only lexical presence. Its full group and
  // every payload are independently validated before any titration can draw.
  const right = `(?:${SPECIES_RIGHT}|(?=\\s*${ATTACHED_CONSTANT_START}))`;
  return `${SPECIES_LEFT}(?:${speciesNotationPattern(source)})(?:\\(aq\\))?${right}`;
}
const SPECIES_ALTERNATION = completeSpeciesPattern(SPECIES.map(entry => `(?:${entry.pattern.source})`).join("|"));
const CONC_UNIT = "(?:M|N|molar|normal)\\b";
const VOLUME_UNIT = "(?:ml|cm\\^?3|cc)\\b";
const FILLER = "(?:(?:of|a|an|aqueous|solution|the)\\s+)*";
const VOL_CONC_SPECIES = new RegExp(`(${CHEMISTRY_SCALAR_PATTERN})\\s*${VOLUME_UNIT}\\s+${FILLER}(${CHEMISTRY_SCALAR_PATTERN})\\s*(${CONC_UNIT})\\s+${FILLER}(${SPECIES_ALTERNATION})`, "gidu");
const CONC_SPECIES = new RegExp(`(${CHEMISTRY_SCALAR_PATTERN})\\s*(${CONC_UNIT})\\s+${FILLER}(${SPECIES_ALTERNATION})`, "gidu");
const BARE_SPECIES = new RegExp(SPECIES_ALTERNATION, "gidu");
const VOLUME_SPECIES = new RegExp(`(${CHEMISTRY_SCALAR_PATTERN})\\s*${VOLUME_UNIT}\\s+${FILLER}(${SPECIES_ALTERNATION})`, "gidu");

function speciesEntry(token: string): SpeciesEntry | null {
  return SPECIES.find(entry => new RegExp(`^(?:${entry.pattern.source})$`, "i").test(speciesIdentity(token))) ?? null;
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
    const entry = speciesEntry(match[4]!.toLowerCase());
    if (!entry) continue;
    withVolume.push({
      entry,
      name: genericName(entry, match[4]!.toLowerCase()),
      concentration: matchedChemistryQuantity(stem, match, 2, /^n/i.test(match[3]!) ? "normality" : "concentration") ?? NaN,
      normal: /^n/i.test(match[3]!),
      volume: matchedChemistryQuantity(stem, match, 1, "volume", "mL") ?? NaN,
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  for (const match of stem.matchAll(CONC_SPECIES)) {
    const index = match.index ?? 0;
    if (withVolume.some((seen) => index >= seen.index && index < seen.end)) continue;
    const entry = speciesEntry(match[3]!.toLowerCase());
    if (!entry) continue;
    const previous = [...stem.slice(0,index).matchAll(BARE_SPECIES)].at(-1);
    const prefixStart = previous ? previous.index! + previous[0].length : 0;
    const prefix = /([+−-]?(?:(?:\p{N}|\.(?=\p{N}))[^\s,;()]*|unknown|unreadable|undefined|NaN))\s*([A-Za-z][A-Za-z0-9^/]*)\s+(?:[A-Za-z]+(?:\s+|$))*$/du.exec(stem.slice(prefixStart,index));
    const localSpan = prefix?.indices?.[1];
    const prefixSpan = localSpan ? [prefixStart+localSpan[0],prefixStart+localSpan[1]] : null;
    const suppliedVolume = prefixSpan ? readChemistryQuantityDeclaration({question:stem,after:/^/,
      within:{start:prefixSpan[0],end:index},dimension:"volume",targetUnit:"mL",owner:"analyte volume before its concentration"}) : null;
    const record: ReadSpecies = {
      entry,
      name: genericName(entry, match[3]!.toLowerCase()),
      concentration: matchedChemistryQuantity(stem, match, 1, /^n/i.test(match[2]!) ? "normality" : "concentration") ?? NaN,
      normal: /^n/i.test(match[2]!),
      index,
      end: index + match[0].length,
    };
    if (suppliedVolume) withVolume.push({...record,index:prefixSpan![0],
      volume:suppliedVolume.state === "valid" ? suppliedVolume.reading.value : NaN});
    else withoutVolume.push(record);
  }
  return { withVolume, withoutVolume };
}

interface SuppliedAcidBaseConstants {
  a: number | null; b: number | null; supplied: boolean;
  namedOwners: Array<{species:SpeciesEntry;sourceSpan:ChemistrySpan}>;
  roleOwners: Array<{kind:"acid"|"base";sourceSpan:ChemistrySpan}>;
}
interface ParentheticalConstantDeclaration {
  payloadEnd: number;
  owner: {species: SpeciesEntry; sourceSpan: ChemistrySpan} | null;
  roleOwner: {kind:"acid"|"base";sourceSpan:ChemistrySpan} | null;
  unresolvedOwner: boolean;
}

/** Presence is lexical, before element/catalog resolution: unknown XYZ must
 * not become an absent owner merely because parsing its elements fails. */
function constantOwnerPresence(before: string): {text:string;sourceSpan:ChemistrySpan;role?:"acid"|"base"} | null {
  const terminal = /([^\s,;.!?]+)\s*$/du.exec(before);
  const span = terminal?.indices?.[1];
  if (!terminal || !span) return null;
  const text = terminal[1]!;
  if (/^(?:acid|base)$/i.test(text)) {
    const modifier = /([\p{L}][\p{L}-]*)\s+$/du.exec(before.slice(0,span[0]));
    const modifierSpan = modifier?.indices?.[1];
    const sourceSpan = {start:modifierSpan?.[0] ?? span[0],end:span[1]};
    // The supported definite reference names a role, not another species.
    // Any other modifier is explicit ownership even outside the catalogue.
    return {text:before.slice(sourceSpan.start,sourceSpan.end),sourceSpan,
      ...(modifier?.[1].toLowerCase() === "the" ? {role:text.toLowerCase() as "acid"|"base"} : {})};
  }
  const token = text.replace(/\(aq\)$/i, "");
  // The same element/group/charge alphabet as formula tokens, including
  // damaged notation. This proves presence only, never chemical validity.
  const formulaAlphabet = /^[A-Za-z\p{N}[\](){}_^+−⁺⁻-]+$/u.test(token);
  const letters = token.replace(/[\p{N}[\](){}_^+−⁺⁻-]/gu, "");
  const strongNotation = /^(?:\[|\()?[A-Z]/.test(token) && /[\p{N}[\](){}_^+−⁺⁻-]/u.test(token);
  const formulaIdentifier = formulaAlphabet && (/^(?:[A-Z][a-z]?)+$/.test(letters) || strongNotation);
  const namedIdentifier = /\b(?:molecule|compound|species|acid|base)\s+$/iu.test(before.slice(0,span[0]));
  return formulaIdentifier || namedIdentifier ? {text,sourceSpan:{start:span[0],end:span[1]}} : null;
}

/** Inventory typed property groups independently of successful species reads.
 * Otherwise a malformed group on another species could vanish and its scalar
 * be borrowed by an earlier analyte as an unqualified constant. */
function parentheticalConstantDeclarations(question: string): Map<number,ParentheticalConstantDeclaration> | null {
  const declarations = new Map<number,ParentheticalConstantDeclaration>();
  const body = question.slice(0,chemistryQuestionSpan(question).end);
  const openings = new RegExp(ATTACHED_CONSTANT_START,"giu");
  for (const opening of body.matchAll(openings)) {
    const start = opening.index!;
    let depth = 1;
    let end = start+1;
    for (; end < body.length; end++) {
      if (question[end] === "(") depth++;
      else if (question[end] === ")" && --depth === 0) break;
    }
    // Supported exponent parentheses remain part of the original payload.
    // The strict scalar reader below, not this boundary scan, validates them.
    if (depth !== 0 || !new RegExp(`^${SPECIES_RIGHT}`,"u").test(body.slice(end+1))) return null;
    const before = question.slice(0,start);
    const species = new RegExp(`(${SPECIES_ALTERNATION})\\s*$`,"idu").exec(before);
    const speciesSpan = species?.indices?.[1];
    const entry = species ? speciesEntry(species[1]!) : null;
    // Whitespace cannot erase a supplied chemical owner. Ordinary prose that
    // supplies no chemical identifier retains the unqualified constant path.
    const presence = !entry ? constantOwnerPresence(before) : null;
    const owner = entry && speciesSpan ? {species:entry,sourceSpan:{start:speciesSpan[0],end:speciesSpan[1]}} : null;
    const roleOwner = presence?.role ? {kind:presence.role,sourceSpan:presence.sourceSpan} : null;
    const contents = question.slice(start+1,end);
    let cursor = start+1;
    const separators = [...contents.matchAll(/[,;]|\band\b/gi)];
    const ends = [...separators.map(separator => ({end:start+1+separator.index!,next:start+1+separator.index!+separator[0].length})),{end,next:end}];
    for (const part of ends) {
      const text = question.slice(cursor,part.end);
      const property = new RegExp(`^\\s*(${ACID_BASE_CONSTANT_SYMBOL})(?:\\s*value)?`,"idu").exec(text);
      const symbolSpan = property?.indices?.[1];
      if (!symbolSpan) return null;
      declarations.set(cursor+symbolSpan[0],{payloadEnd:part.end,owner,roleOwner,unresolvedOwner:Boolean(presence && !presence.role)});
      cursor = part.next;
    }
  }
  return declarations;
}

/** A mentioned constant either binds completely in the source or refuses the
 * titration. Missing is the only state that permits the species table. */
function suppliedAcidBaseConstants(question: string): SuppliedAcidBaseConstants | null {
  const result: SuppliedAcidBaseConstants = {a:null,b:null,supplied:false,namedOwners:[],roleOwners:[]};
  const body = question.slice(0,chemistryQuestionSpan(question).end);
  const parenthetical = parentheticalConstantDeclarations(question);
  if (!parenthetical) return null;
  const consumedParenthetical = new Set<number>();
  const names = completeSpeciesPattern(String.raw`(?:CH3COOH|HCOOH|NH4OH|NH3|HCN|HF|acetic acid|ethanoic acid|formic acid|methanoic acid|ammonia|ammonium hydroxide|the acid|the base)`);
  // Unqualified named constants do not identify which conjugate species owns
  // the value. Refuse instead of borrowing a table value for the analyte.
  if (/(?<!acid )(?<!base )\b(?:dissociation|ioni[sz]ation) constant\b/i.test(body)) return null;
  for (const which of ["a","b"] as const) {
    let pK: number | null = null; let k: number | null = null;
    for (const logarithmic of [true,false]) {
      const symbol = String.raw`(?<![a-z])${logarithmic?"p\\s*":"(?<!p)"}k\s*_?\s*(?:\{\s*${which}\s*\}|${which})(?![a-z])`;
      const word = !logarithmic ? String.raw`|\b${which==="a"?"acid":"base"}\s+(?:dissociation|ioni[sz]ation) constant\b` : "";
      const mention = new RegExp(`(?:${symbol}${word})`,"ig");
      const declarations = [...body.matchAll(mention)];
      if (declarations.length === 0) continue;
      // Repeated declarations remain a conservative refusal. In particular,
      // a readable later value cannot mask an earlier explicit unknown owner.
      if (declarations.length !== 1) return null;
      result.supplied = true;
      const cue = new RegExp(String.raw`(?:${symbol}${word})(?:\s*\(([^)]*)\)|\s+(?:of|for)\s+(${names})|(\s*(?:\(|(?:of|for)\b)))?\s*(?:value)?`,"igdu");
      const owners = [...body.matchAll(cue)];
      if (owners.length !== 1) return null;
      const owner = owners[0]!;
      // An explicit but unresolved ownership clause cannot become implicit.
      if (owner[3] !== undefined) return null;
      const namedGroup = owner[1] !== undefined ? 1 : owner[2] !== undefined ? 2 : null;
      const attached = parenthetical.get(owner.index!);
      if (attached) {
        consumedParenthetical.add(owner.index!);
        // Each property's explicit owner binds first. Adjacency supplies an
        // implicit owner only when this declaration does not name one.
        if (namedGroup === null) {
          if (attached.unresolvedOwner) return null;
          if (attached.roleOwner) result.roleOwners.push(attached.roleOwner);
          if (attached.owner) {
            // A finite weak-species constant cannot be ignored by a strong model.
            if (attached.owner.species.strength !== "weak") return null;
            result.namedOwners.push(attached.owner);
          }
        }
      }
      if (namedGroup !== null) {
        const named = owner[namedGroup]!.trim();
        const species = speciesEntry(named);
        const span = owner.indices?.[namedGroup];
        if (!species || !span) return null;
        result.namedOwners.push({species,sourceSpan:{start:span[0],end:span[1]}});
      }
      // Anchor the read after this one source declaration. Missing is fatal
      // here, rather than silently skipped by a whole-question cue scan.
      const within = {start:owner.index!+owner[0].length,end:attached?.payloadEnd ?? body.length};
      const read = readChemistryQuantityDeclaration({question,after:/^/,within,dimension:"dimensionless",owner:`${logarithmic?"pK":"K"}${which}`});
      const limit = logarithmic ? 14 : 1;
      if (read.state !== "valid" || !(read.reading.value > 0 && read.reading.value < limit)) return null;
      if (attached && (read.reading.source.span.start < within.start || read.reading.source.span.end > within.end
        || question.slice(read.reading.source.span.end,within.end).trim() !== "")) return null;
      if (logarithmic) pK = read.reading.value; else k = read.reading.value;
    }
    const fromK = k === null ? null : -Math.log10(k);
    if (pK !== null && fromK !== null && !chemistryCanonicalValuesAgree(pK,fromK)) return null;
    result[which] = pK ?? fromK;
  }
  if ([...parenthetical.keys()].some(start => !consumedParenthetical.has(start))) return null;
  return result;
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

/** Numeric-looking supplied unit arguments must pass the original reader,
 * even when unsupported numeral glyphs produce no scalar inventory entry.
 * This is a refusal check, not another number parser or notation conversion. */
function titrationQuantityTokensValid(question: string): boolean {
  const body = chemistryQuestionSpan(question);
  for (const unit of question.slice(body.start,body.end).matchAll(/(?<![\p{L}])(?:mL|ml|cc|cm\^?3|M|N|molar|normal)\b/gu)) {
    const at = body.start+unit.index!;
    const argument = /(?:^|[\s,;([])([^\s,;()[\]]+)\s*$/d.exec(question.slice(body.start,at));
    const span = argument?.indices?.[1];
    if (!argument || !span) continue;
    // A sentence stop is not an amount owner, but punctuation immediately
    // before an explicit unit is still a supplied malformed payload.
    if (!/[\p{N}]|\b(?:unknown|unreadable|undefined|NaN)\b/iu.test(argument[1]!)
      && !/^[+−-]?\.$/u.test(argument[1]!)) continue;
    const dimension = /^(?:M|molar)$/.test(unit[0]) ? "concentration" : /^(?:N|normal)$/.test(unit[0]) ? "normality" : "volume";
    // A full original literal may contain spaces in its coefficient/exponent.
    // Cover the lexical argument too: an ASCII suffix of damaged numeral
    // notation must never discharge the original complete unit argument.
    const inventory = findChemistryQuantities({question,dimension});
    if (!inventory.ok) return false;
    if (inventory.reading.some(reading => reading.value > 0
      && reading.source.span.start <= body.start+span[0]
      && reading.source.span.end === at+unit[0].length)) continue;
    const read = readChemistryQuantityDeclaration({question,after:/^/,
      within:{start:body.start+span[0],end:at+unit[0].length},dimension,owner:`original titration ${dimension} payload`});
    if (read.state !== "valid" || read.reading.value <= 0) return false;
  }
  return true;
}

/** Every original volume/concentration literal belongs to a supported species
 * binding, or to an explicitly added volume of the selected titrant. */
function titrationQuantitiesConsumed(question: string, analyte: ReadSpecies, titrant: ReadSpecies): boolean {
  // Binding is to these actual source records, not every later equal-valued
  // aliquot of the same material. Separate amounts need a separate solver.
  const bound = [analyte,titrant];
  const added: ChemistrySpan[] = [];
  for (const match of question.matchAll(VOLUME_SPECIES)) {
    if (speciesEntry(match[2]!) !== titrant.entry || !/^\s+(?:has\s+been\s+|is\s+)?added\b/i.test(question.slice(match.index!+match[0].length))) continue;
    const value = matchedChemistryQuantity(question,match,1,"volume","mL");
    const start = match.indices?.[1]?.[0];
    if (value === null || value <= 0 || start === undefined) return false;
    added.push({start,end:match.index!+match[0].length});
  }
  return (["volume","concentration","normality"] as const).every(dimension => {
    const inventory = findChemistryQuantities({question,dimension});
    return inventory.ok && inventory.reading.every(reading => bound.some(mention =>
      reading.source.span.start >= mention.index && reading.source.span.end <= mention.end
      && (dimension !== "volume" || mention.volume !== undefined))
      || dimension === "volume" && added.some(span => reading.source.span.start >= span.start && reading.source.span.end <= span.end));
  });
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
  void quantities;
  const supplied = suppliedAcidBaseConstants(stem);
  if (!supplied) return null;
  // Strong-species models do not consume a finite dissociation constant.
  if (supplied.supplied && analyte.entry.strength !== "weak") return null;
  const which = analyte.entry.kind === "acid" ? "a" : "b";
  // A supplied constant for another conjugate role is not an analyte constant.
  if (supplied.supplied && (supplied[which] === null || supplied[which === "a" ? "b" : "a"] !== null)) return null;
  // Acid/base kind is insufficient: HF and CH3COOH own different constants.
  // Formula and ordinary-name aliases resolve through the existing species
  // identity, with the declared owner span retained from the original source.
  if (supplied.namedOwners.some(owner => owner.species !== analyte.entry)) return null;
  if (supplied.roleOwners.some(owner => owner.kind !== analyte.entry.kind)) return null;
  const analyteSpecies = toSpecies(analyte, supplied[which]);
  const titrantSpecies = toSpecies(titrant, null);
  if (!analyteSpecies || !titrantSpecies) return null;
  const curve = titrationCurve({ analyte: analyteSpecies, titrant: titrantSpecies });
  if (!curve || !titrationQuantitiesConsumed(stem,analyte,titrant)) return null;
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
  return claimsSolutionLesson(question) || titrationCue(stem) || RAOULT_CUE.test(stem) || COLLIGATIVE_CUE.test(stem);
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
const COMPONENT_FILLER = "(?:(?:the|two|pure|volatile|liquids?|components?|solvents?|of|a(?=\\s+(?:liquid|component|solvent)))\\s+)*";

interface RaoultReading {
  names: [string, string];
  pA0: number;
  pB0: number;
  unit: string;
  xA: number | null;
}

function normaliseUnit(raw: string | undefined): string {
  const unit = (raw ?? "").replace(/\s+/g, " ").trim();
  if (/mm/i.test(unit)) return "torr";
  if (/kpa/i.test(unit)) return "kPa";
  if (/bar/.test(unit)) return "bar";
  if (/atm/.test(unit)) return "atm";
  if (/^pa$/.test(unit)) return "Pa";
  return unit || "";
}

function readRaoult(stem: string, _quantities: readonly ChemPlanQuantity[]): RaoultReading | null {
  const scope = chemistryQuestionSpan(stem);
  const body = stem.slice(0,scope.end);
  // Keep match.input and every capture index bound to the original question,
  // while excluding choices from the physical source inventory.
  const sourceMatches = (pattern:RegExp): RegExpMatchArray[] => [...stem.matchAll(pattern)]
    .filter(match=>match.index! >= scope.start && match.index!+match[0].length <= scope.end);
  const bindings: Array<{ name: string; sourceSpan: ChemistrySpan; value: number; unit: string }> = [];
  const componentSpan = (match: RegExpMatchArray, group: number): ChemistrySpan => ({start:match.indices![group]![0],end:match.indices![group]![1]});
  const number = `(${CHEMISTRY_SCALAR_PATTERN})`;
  const name = "([a-z][a-z0-9]*)";
  // "vapour pressures of pure A and B are 200 torr and 100 torr"
  const pair = new RegExp(`vapou?r pressures? of ${COMPONENT_FILLER}${name}\\s+and\\s+${COMPONENT_FILLER}${name}(?:\\s+at\\s+[^,.]{0,24}?)?\\s*(?:are|is|=|:|,)?\\s*${number}\\s*${PRESSURE_UNIT}?\\s*(?:and|,)\\s*${number}\\s*${PRESSURE_UNIT}?`, "gid");
  const single = new RegExp(`(?:vapou?r pressure|that) of ${COMPONENT_FILLER}${name}(?:\\s+at\\s+[^,.]{0,24}?)?\\s*(?:is|=|:|are)\\s*${number}\\s*${PRESSURE_UNIT}?`, "gid");
  const symbolic = new RegExp(`\\bp\\s*(?:°|\\^0|\\^\\(0\\)|0)?\\s*_?\\s*([a-z])\\s*(?:°|\\^0|\\^\\(0\\)|0)?\\s*(?:=|is|:)\\s*${number}\\s*${PRESSURE_UNIT}?`, "gid");
  const pairDeclarations = sourceMatches(pair);
  const singleDeclarations = sourceMatches(single);
  const symbolicDeclarations = sourceMatches(symbolic);
  const declarations = [...pairDeclarations,...singleDeclarations,...symbolicDeclarations];
  const componentNames = new Set([...pairDeclarations.flatMap(match=>[match[1]!,match[2]!]),
    ...singleDeclarations.map(match=>match[1]!),...symbolicDeclarations.map(match=>match[1]!)].map(who=>who.toLowerCase()));
  // A following phase noun phrase owns the liquid composition, rather than
  // being a physical unit. Retain its original span; other phases do not
  // authorize this liquid-x operator.
  const compositionPhase = (scalarEnd:number) => {
    const phase = /^\s+(?:in|for)\s+(?:(?:the|an?)\s+)?(?:([a-z]+)\s+)?(phase|solution|mixture|liquid|vapou?r)\b/i.exec(body.slice(scalarEnd));
    return phase ? {start:scalarEnd,end:scalarEnd+phase[0].length,
      liquid:phase[1] ? /^liquid$/i.test(phase[1]) && /^(?:phase|solution|mixture)$/i.test(phase[2]!) : /^(?:solution|mixture|liquid)$/i.test(phase[2]!)} : null;
  };
  const fraction = `(${CHEMISTRY_SCALAR_PATTERN})`;
  const compositionPatterns: Array<{ pattern: RegExp; nameGroup:number; valueGroup:number; valueFirst?:boolean }> = [
    { pattern: new RegExp(`mole fraction of ${COMPONENT_FILLER}${name}(?: in (?:the )?(?:liquid|solution)(?: phase)?)?\\s*(?:is|=|:|of)?\\s*${fraction}`, "gid"), nameGroup:1, valueGroup:2 },
    { pattern: new RegExp(`${fraction}\\s*mole fraction of ${COMPONENT_FILLER}${name}`, "gid"), nameGroup:2, valueGroup:1, valueFirst:true },
    { pattern: new RegExp(`\\bx_?\\(?([a-z])\\)?\\s*(?:=|is)\\s*${fraction}`, "gid"), nameGroup:1, valueGroup:2 },
  ];
  const compositions = compositionPatterns.flatMap(candidate=>sourceMatches(candidate.pattern).map(match=>{
    const span = match.indices![candidate.valueGroup]!;
    const value = matchedChemistryScalar(stem,match,candidate.valueGroup);
    // The value-first form owns the following "mole fraction" noun phrase.
    // Other forms must not hide a supplied foreign unit after their scalar.
    const phase = compositionPhase(span[1]);
    const literal = candidate.valueFirst ? null : readChemistryLiteral({question:stem,scalarSpan:{start:span[0],end:span[1]},
      ...(phase ? {within:{start:span[0],end:phase.start}} : {}),dimension:"dimensionless",targetUnit:"1"});
    return {start:match.index!,name:match[candidate.nameGroup]!.toLowerCase(),nameSpan:match.indices![candidate.nameGroup]!,
      scalarSpan:{start:span[0],end:span[1]},valueFirst:!!candidate.valueFirst,phase,
      value:value !== null && (!phase || phase.liquid) && (candidate.valueFirst || literal?.ok && chemistryCanonicalValuesAgree(literal.reading.value,value)) ? value : NaN};
  }));
  // Inventory owners independently of successful numeric matches. An unread
  // sibling is supplied-invalid, while an asked-for noun remains absent.
  const compositionOwners = [
    new RegExp(`mole fraction of ${COMPONENT_FILLER}${name}(?: in (?:the )?(?:liquid|solution)(?: phase)?)?`,"gid"),
    /\b(?:x_|x_?\()([a-z][a-z0-9]*)\)?/gid,
    /\bx([a-z])(?=\s*(?:=|:|\bis\b))/gid,
  ].flatMap(sourceMatches).sort((a,b)=>a.index!-b.index!);
  for (const [index,cue] of compositionOwners.entries()) {
    const next = compositionOwners[index+1]?.index ?? body.length;
    const sentence = /[;!?\n]|\.(?=\s|$)/.exec(body.slice(cue.index!+cue[0].length,next));
    const end = sentence ? cue.index!+cue[0].length+sentence.index : next;
    const after = new RegExp(cue[0].replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
    const composition = compositions.find(value=>value.nameSpan[0]===cue.indices![1]![0] && value.nameSpan[1]===cue.indices![1]![1]);
    const read = readChemistryQuantityDeclaration({question:stem,after,cueCaseSensitive:true,
      within:{start:cue.index!,end:composition?.phase ? Math.min(end,composition.phase.start) : end},dimension:"dimensionless",targetUnit:"1",owner:`liquid mole fraction of ${cue[1]}`});
    if (read.state === "invalid") return null;
    if (read.state === "valid" && (!componentNames.has(cue[1]!.toLowerCase())
      || !compositions.some(value=>value.nameSpan[0]===cue.indices![1]![0] && value.nameSpan[1]===cue.indices![1]![1]
        && chemistryCanonicalValuesAgree(value.value,read.reading.value)))) return null;
  }
  const closesPressureArgument = (end:number): boolean => declarations.some(next => next.index! >= end
    && /^(?:\s*,?\s*and\s+|\s*,\s*)$/i.test(stem.slice(end,next.index!)))
    || compositions.some(next=>next.start >= end && componentNames.has(next.name) && next.value >= 0 && next.value <= 1
      && /^\s*(?:,\s*|(?:and|with)\s+)$/i.test(stem.slice(end,next.start)))
    || /^(?:\s*$|\s*[.;!?)])/.test(stem.slice(end,chemistryQuestionSpan(stem).end));
  const pressureAt = (match: RegExpMatchArray, group: number, unitGroup: number, sharedUnitGroup?: number, peerScalarGroup?: number): number => {
    const token = match[group]!; const start = match.indices?.[group]?.[0];
    if (start === undefined) return NaN;
    if (match[unitGroup] === undefined && sharedUnitGroup !== undefined) {
      // Missing a regex unit is not proof that this source argument has none.
      // A peer convention is legal only across the pair's owned separator or
      // after this complete final argument; kg/qux/damaged units remain present.
      const end = start+token.length;
      const peer = peerScalarGroup === undefined ? undefined : match.indices?.[peerScalarGroup];
      const nextOwnedValue = peer && peer[0] > end && /^\s*(?:and|,)\s*$/i.test(stem.slice(end,peer[0]));
      if (!nextOwnedValue && !closesPressureArgument(end)) return NaN;
    }
    const selectedUnitGroup = match[unitGroup] !== undefined ? unitGroup : sharedUnitGroup;
    const rawUnit = selectedUnitGroup === undefined ? undefined : match[selectedUnitGroup];
    const unitSpan = selectedUnitGroup === undefined ? undefined : match.indices?.[selectedUnitGroup];
    if (rawUnit === "mm" && unitSpan) {
      // This pressure/component declaration owns the historical mm-Hg
      // shorthand. A material, power or attached factor is not bare mm.
      const insideJointDeclaration = unitSpan[1] < match.index! + match[0].length;
      if (!insideJointDeclaration && !closesPressureArgument(unitSpan[1])) return NaN;
      const value = matchedChemistryScalar(stem,match,group);
      if (value === null) return NaN;
      const converted = convertChemistryValue(value,"torr","torr","pressure");
      return converted.ok ? converted.reading : NaN;
    }
    const read = readChemistryLiteral({question: stem, scalarSpan: {start, end: start + token.length}, dimension: "pressure", targetUnit: "torr", ...(unitSpan && rawUnit ? {unitConvention: {unit: normaliseUnit(rawUnit) as ChemistryUnit, sourceSpan: {start: unitSpan[0], end: unitSpan[1]}}} : {})});
    return read.ok ? read.reading.value : NaN;
  };
  for (const match of pairDeclarations) {
    bindings.push({ name: match[1]!.toLowerCase(), sourceSpan:componentSpan(match,1), value: pressureAt(match, 3, 4, 6, 5), unit: normaliseUnit(match[4] ?? match[6]) || "torr" });
    bindings.push({ name: match[2]!.toLowerCase(), sourceSpan:componentSpan(match,2), value: pressureAt(match, 5, 6, 4, 3), unit: normaliseUnit(match[6] ?? match[4]) || "torr" });
  }
  // "vapour pressure of pure A is 200 torr", "that of pure B is 100 torr"
  for (const match of singleDeclarations) {
    if (/^(?:the|pure|liquid|solution|solvent|mixture|water)$/.test(match[1]!) && !/^water$/.test(match[1]!)) continue;
    bindings.push({ name: match[1]!.toLowerCase(), sourceSpan:componentSpan(match,1), value: pressureAt(match, 2, 3), unit: normaliseUnit(match[3]) || "torr" });
  }
  // "p°A = 200 torr", "p_A^0 = 200"
  for (const match of symbolicDeclarations) {
    bindings.push({ name: match[1]!.toLowerCase(), sourceSpan:componentSpan(match,1), value: pressureAt(match, 2, 3), unit: normaliseUnit(match[3]) || "torr" });
  }
  if (new Set(bindings.map(binding => binding.name)).size !== bindings.length) return null;
  const distinct = bindings;
  if (distinct.length !== 2) return null;
  const [first, second] = distinct as [typeof distinct[number], typeof distinct[number]];
  if (!(first.value > 0) || !(second.value > 0)) return null;
  // Preserve a common declared pressure unit; mixed-unit inputs retain the
  // canonical torr display. Values and axes are converted together.
  const unit = first.unit === second.unit ? first.unit : "torr";
  const a = convertChemistryValue(first.value, "torr", unit as ChemistryUnit, "pressure");
  const b = convertChemistryValue(second.value, "torr", unit as ChemistryUnit, "pressure");
  if (!a.ok || !b.ok) return null;
  first.value = a.reading; second.value = b.reading;
  const names: [string, string] = [first.name, second.name];
  const molePairs = new RegExp(`${number}\\s*mol(?:e|es)?\\s+(?:of\\s+)?${COMPONENT_FILLER}${name}[^.]{0,60}?${number}\\s*mol(?:e|es)?\\s+(?:of\\s+)?${COMPONENT_FILLER}${name}`, "gid");
  const moleReadings: Array<{match:RegExpMatchArray;value:number}> = [];
  for (const moles of sourceMatches(molePairs)) {
    const firstName = moles[2]!.toLowerCase(); const secondName = moles[4]!.toLowerCase();
    const firstComponent = bindings.find(binding=>binding.name===firstName);
    const secondComponent = bindings.find(binding=>binding.name===secondName);
    if (!firstComponent || !secondComponent || firstComponent === secondComponent) return null;
    const firstMoles = matchedChemistryComponentAmount(stem,moles,1,2,firstComponent);
    const secondMoles = matchedChemistryComponentAmount(stem,moles,3,4,secondComponent);
    if (firstMoles === null || secondMoles === null || firstMoles < 0 || secondMoles < 0 || firstMoles + secondMoles <= 0) return null;
    const value = firstName === names[0] && secondName === names[1] ? firstMoles/(firstMoles+secondMoles)
      : firstName === names[1] && secondName === names[0] ? secondMoles/(firstMoles+secondMoles) : null;
    if (value === null) return null;
    moleReadings.push({match:moles,value});
  }
  // A composition authorizes one state only after every original scalar in
  // its local argument is consumed. Independent typed owners end that
  // argument; an unread or merely unparsed tail does not establish one.
  const scalarTokens = sourceMatches(new RegExp(`(${CHEMISTRY_SCALAR_PATTERN})`,"gd")).map(token=>({
    start:token.indices![1]![0]+token[1]!.length-token[1]!.trimStart().length,
    end:token.indices![1]![1]-(token[1]!.length-token[1]!.trimEnd().length),
  })).filter(span=>!/[A-Za-z0-9_.]/.test(stem[span.start-1] ?? ""));
  type CompositionRole = {kind:"quantity"|"notation";span:ChemistrySpan;scalars:ChemistrySpan[]};
  const capturedSpan = (match:RegExpMatchArray,group:number): ChemistrySpan => {
    const span = match.indices![group]!; const token = stem.slice(span[0],span[1]);
    return {start:span[0]+token.length-token.trimStart().length,end:span[1]-(token.length-token.trimEnd().length)};
  };
  const roles: CompositionRole[] = declarations.map(match=>({kind:"quantity",span:{start:match.index!,end:match.index!+match[0].length},
    scalars:(pairDeclarations.includes(match) ? [3,5] : [2]).map(group=>capturedSpan(match,group))}));
  const temperatures = sourceMatches(/\b(?:at(?:\s+(?:the\s+)?temperature)?|temperature|T)\b/gid).flatMap(cue=>{
    const sentence = /[;!?\n]|\.(?=\s|$)/.exec(body.slice(cue.index!+cue[0].length));
    const end = sentence ? cue.index!+cue[0].length+sentence.index : scope.end;
    const after = new RegExp(cue[0].replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
    const read = readChemistryQuantityDeclaration({question:stem,after,cueCaseSensitive:true,
      within:{start:cue.index!,end},dimension:"temperature",targetUnit:"K",owner:"solution temperature"});
    return read.state === "valid" ? [{start:cue.index!,span:read.reading.source.span}] : [];
  });
  roles.push(...temperatures.map(owner=>({kind:"quantity" as const,span:{start:owner.start,end:owner.span.end},scalars:[owner.span]})),
    ...moleReadings.map(owner=>({kind:"quantity" as const,span:{start:owner.match.index!,end:owner.match.index!+owner.match[0].length},
      scalars:[capturedSpan(owner.match,1),capturedSpan(owner.match,3)]})));
  // Discover count owners before reading a numeral: an unknown or damaged
  // count cannot disappear just because its numeric pattern did not match.
  const cardinals = ["zero","one","two","three","four","five","six","seven","eight","nine","ten",
    "eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  // Numeric-word presence is broader than the component-count value
  // grammar. These original spans grant no fractional/numeric authority.
  const countNouns = ["dozen","score","gross","pair","couple","trio","quartet","quintet","sextet","septet","octet","nonet","decet"];
  const numberWords = [...cardinals,...countNouns.flatMap(word=>[word,word === "gross" ? "grosses" : `${word}s`]),
    "twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety",
    "hundred","thousand","million","billion","trillion","half","halves","quarter","quarters",
    ...["third","fourth","fifth","sixth","seventh","eighth","ninth","tenth","eleventh","twelfth",
      "thirteenth","fourteenth","fifteenth","sixteenth","seventeenth","eighteenth","nineteenth",
      "twentieth","thirtieth","fortieth","fiftieth","sixtieth","seventieth","eightieth","ninetieth",
      "hundredth","thousandth","millionth","billionth","trillionth"].flatMap(word=>[word,`${word}s`])];
  const numberWord = `(?:${numberWords.join("|")})`;
  const wordPayloads = sourceMatches(new RegExp(String.raw`(?<![\p{L}\p{N}\p{M}_])${numberWord}(?:[\s-]+(?:and[\s-]+)?${numberWord})*(?![\p{L}\p{N}\p{M}_])`,"giu"))
    .map(match=>({start:match.index!,end:match.index!+match[0].length}));
  const countOwners = [
    ...sourceMatches(/\b(?:the\s+)?(?:mixture|solution)\s+(?:contains|has|consists\s+of)\s*/gid)
      .map(cue=>({cue,noun:/\b(?:liquid\s+)?components?\b/i})),
    ...sourceMatches(/\b(?:the\s+)?(?:mixture|solution)\s+of\s*/gid)
      .map(cue=>({cue,noun:/\bliquids?\b/i})),
  ].sort((first,second)=>first.cue.index!-second.cue.index!);
  for (const {cue,noun} of countOwners) {
    const payload = cue.index!+cue[0].length;
    const next = [...compositionOwners.map(owner=>owner.index!),...roles.map(owner=>owner.span.start)]
      .filter(start=>start >= payload).sort((a,b)=>a-b)[0] ?? scope.end;
    const sentence = /[;!?\n]|\.(?=\s|$)/.exec(body.slice(payload,next));
    const end = sentence ? payload+sentence.index : next;
    const head = noun.exec(body.slice(payload,end));
    if (!head) continue;
    const countEnd = payload+head.index;
    if (!stem.slice(payload,countEnd).trim()) continue;
    const text = stem.slice(payload,countEnd);
    // Cardinal words describe the resolved component set only. Keep the
    // original source span; this grants no fractional/scalar authority.
    const word = new RegExp(String.raw`^\s*(${cardinals.join("|")})(?![\p{L}\p{N}\p{M}_])`,"iu").exec(text);
    const start = payload+text.length-text.trimStart().length;
    const scalar = scalarTokens.find(token=>token.start === start && token.end <= countEnd);
    // Preserve successful original declaration syntax (including numeric
    // connectors); only unresolved modifier phrases use the leading token.
    const declared = readChemistryQuantityDeclaration({question:stem,after:/^/,
      within:{start:payload,end:countEnd},dimension:"dimensionless",targetUnit:"1",owner:"solution component count"});
    const read = scalar ? parseChemistryScalar(stem,scalar) : null;
    const count = declared.state === "valid" ? declared.reading.value
      : word ? cardinals.indexOf(word[1]!.toLowerCase()) : read?.ok ? read.reading : NaN;
    const span = declared.state === "valid" ? declared.reading.source.span
      : word ? {start,end:payload+word[0].length} : scalar ?? {start:payload,end:countEnd};
    const modifiers = stem.slice(span.end,countEnd);
    // Complete lexical noun modifiers may follow the count. They cannot
    // hide an attached unit, unread value, or another supplied numeral.
    if (!Number.isInteger(count) || count !== bindings.length
      || (modifiers.trim() && (!/^\s+[\p{L}\p{M}]+(?:[\s-]+[\p{L}\p{M}]+)*\s*$/u.test(modifiers)
        || /\b(?:and|or)\b/i.test(modifiers) || chemistryQuantityPayloadPresent(modifiers)
        || wordPayloads.some(token=>token.end > span.end && token.start < countEnd)))) return null;
    roles.push({kind:"quantity",span:{start:cue.index!,end:countEnd+head[0].length},scalars:[span]});
  }
  // A complete nominal pair refers to the independently resolved binary
  // roster. It owns lexical notation only, never a scalar or argument end.
  for (const reference of sourceMatches(/\b(pairs?)\s+of\s+/gidu)) {
    const start = reference.index!, payload = start+reference[0].length;
    const boundary = [...body.slice(scope.start,start).matchAll(/[;!?\n]|\.(?=\s|$)/g)].at(-1);
    const sentenceStart = boundary ? scope.start+boundary.index!+boundary[0].length : scope.start;
    const right = /[;!?\n]|\.(?=\s|$)/.exec(body.slice(payload));
    const end = right ? payload+right.index : scope.end;
    // The physical head must belong to this immediate nominal complement,
    // not to a later prepositional phrase or relative clause.
    const postmodifier = /\b(?:of|for|with|from|to|in|on|at|by|about|between|among|against|under|over|through|which|that|whose)\b/iu.exec(body.slice(payload,end));
    const head = /\b(?:liquids|components)\b/iu.exec(body.slice(payload,postmodifier ? payload+postmodifier.index : end));
    if (!head) continue;
    const prefix = stem.slice(sentenceStart,start);
    const determiner = [...prefix.matchAll(/\b(?:the|this|that|an?|its)\b/giu)].at(-1);
    const from = determiner ? sentenceStart+determiner.index! : start;
    const modifierStart = determiner ? from+determiner[0].length : start;
    const headStart = payload+head.index;
    const modifierValid = (from:number,to:number): boolean => {
      const text = stem.slice(from,to);
      return !text.trim() || (/^\s*[\p{L}\p{M}]+(?:[\s-]+[\p{L}\p{M}]+)*\s*$/u.test(text)
        && !/\b(?:and|or)\b/i.test(text) && !chemistryQuantityPayloadPresent(text)
        && !wordPayloads.some(token=>token.end > from && token.start < to));
    };
    if (reference[1]!.toLowerCase() !== "pair"
      || !modifierValid(modifierStart,start) || !modifierValid(payload,headStart)) return null;
    // An attached replacement predicate cannot lend this roster's pressures
    // to a different pair. Its object must be both actual component names;
    // modifiers alone establish no exclusion, nor does a negated relation.
    const pairNames = `(?:${names[0]}\\s+and\\s+${names[1]}|${names[1]}\\s+and\\s+${names[0]})`;
    const exclusion = new RegExp(String.raw`^\s*(?:,\s*)?(?:(?:is|are)\s+(?:([\p{L}\p{M}]+)\s+)?)?(instead\s+of|rather\s+than|distinct\s+from|not)\s+${pairNames}(?![\p{L}\p{N}\p{M}_])`,"iu")
      .exec(stem.slice(headStart+head[0].length,end));
    if (exclusion && !/^(?:not|never)$/i.test(exclusion[1] ?? "")) return null;
    if (!exclusion && new RegExp(String.raw`\b(?:instead\s+of|rather\s+than|distinct\s+from|not)\s+${pairNames}(?![\p{L}\p{N}\p{M}_])`,"iu")
      .test(stem.slice(headStart+head[0].length,end))) continue;
    // Absent nominal-prefix proof adds no role; ordinary prose alone is
    // not a supplied-invalid quantity and retains the prior source path.
    if (!determiner && prefix.trim()) continue;
    roles.push({kind:"notation",span:{start:from,end:headStart+head[0].length},scalars:[]});
  }
  // Complete parenthetical document references own only their integral ID.
  // Other numbers or property declarations in/after an aside remain checked.
  const documentReferences = sourceMatches(new RegExp(`\\(\\s*(?:[a-z]+\\s+)*(?:question|problem)\\s+${number}\\s*\\)`,"gid"));
  for (const reference of documentReferences) {
    const value = matchedChemistryScalar(stem,reference,1);
    if (value === null || !Number.isInteger(value) || value <= 0) return null;
  }
  roles.push(...documentReferences.map(reference=>({kind:"notation" as const,
    span:{start:reference.index!,end:reference.index!+reference[0].length},scalars:[capturedSpan(reference,1)]})));
  const ownsScalar = (role:CompositionRole,scalar:ChemistrySpan): boolean => role.scalars.some(span=>span.start <= scalar.start && span.end >= scalar.end);
  const notationScalar = (scalar:ChemistrySpan): boolean => roles.some(role=>role.kind === "notation" && ownsScalar(role,scalar));
  const independentOwners = [...compositionOwners.map(owner=>owner.index!),...roles.filter(role=>role.kind === "quantity").map(role=>role.span.start)];
  const coordinated = /^\s*(?:,\s*(?:(?:and|or)\b\s*)?|(?:and|or)\b\s*)[a-z\s]*$/i;
  // Worded/unread antecedents are supplied presence, not fractional numeric
  // authority. A proved component-count role owns its cardinal token.
  const lexicalPayloads = [...wordPayloads,
    ...sourceMatches(/\b(?:unknown|unreadable|unspecified|undefined|NaN|cannot\s+be\s+read)\b/gi)
      .map(match=>({start:match.index!,end:match.index!+match[0].length}))];
  for (const composition of compositions) {
    if (composition.valueFirst) {
      let start = composition.scalarSpan.start;
      const boundary = [...body.slice(scope.start,start).matchAll(/[;!?\n]|\.(?=\s|$)/g)].at(-1);
      const sentenceStart = boundary ? scope.start+boundary.index!+boundary[0].length : scope.start;
      while (true) {
        const prefix = stem.slice(sentenceStart,start);
        const link = /(\S+)\s*(?:,\s*(?:(?:and|or)\b\s*)?|\b(?:and|or)\s*)[a-z\s]*$/i.exec(prefix);
        if (!link) break;
        if (lexicalPayloads.some(token=>token.start >= sentenceStart && token.end <= start
          && !roles.some(owner=>owner.span.start <= token.start && owner.span.end >= token.end))) return null;
        const previous = scalarTokens.filter(token=>token.start >= sentenceStart && token.end <= start).at(-1);
        if (!previous) {
          // A local prose conjunction supplies no earlier fraction. Unread
          // alternatives remain fatal; unowned bare units in prose alone
          // do not establish a scalar quantity argument.
          if (/\bor\b/i.test(link[0])) return null;
          break;
        }
        // One source-role ledger governs both directions. Document IDs
        // are transparent notation; they never hide an earlier alternative.
        const role = roles.find(owner=>ownsScalar(owner,previous) && owner.span.end <= start
          && coordinated.test(stem.slice(owner.span.end,start)));
        if (role) {
          if (chemistryQuantityPayloadPresent(stem.slice(role.span.end,start))) return null;
          if (role.kind === "quantity") break;
          start = role.span.start;
          continue;
        }
        if (!coordinated.test(stem.slice(previous.end,start))
          || chemistryQuantityPayloadPresent(stem.slice(previous.end,start))) return null;
        start = previous.start;
      }
      // The final adjacent scalar already has the strict matched-scalar
      // proof and the following dimensionless property noun. Earlier list
      // members must each pass the original literal reader themselves.
      for (const scalar of scalarTokens.filter(token=>token.start >= start && token.end <= composition.scalarSpan.start)) {
        if (notationScalar(scalar)) continue;
        const read = readChemistryLiteral({question:stem,scalarSpan:scalar,dimension:"dimensionless",targetUnit:"1"});
        if (!read.ok || !chemistryCanonicalValuesAgree(read.reading.value,composition.value)) return null;
      }
    } else {
      const next = independentOwners.filter(start=>start > composition.scalarSpan.end).sort((a,b)=>a-b)[0] ?? scope.end;
      const sentence = /[;!?\n]|\.(?=\s|$)/.exec(body.slice(composition.scalarSpan.end,next));
      const end = sentence ? composition.scalarSpan.end+sentence.index : next;
      const start = composition.phase?.end ?? composition.scalarSpan.end;
      for (const scalar of scalarTokens.filter(token=>token.start >= start && token.end <= end)) {
        if (notationScalar(scalar)) continue;
        const read = readChemistryLiteral({question:stem,scalarSpan:scalar,within:{start,end},dimension:"dimensionless",targetUnit:"1"});
        if (!read.ok || !chemistryCanonicalValuesAgree(read.reading.value,composition.value)) return null;
      }
      // Inventory supplied unread alternatives as well as successful scalar
      // matches. A connector before a proved foreign owner has no payload.
      for (const link of stem.slice(start,end).matchAll(/\b(?:and|or)\b|,/gi)) {
        const argument = start+link.index!+link[0].length;
        if (!stem.slice(argument,end).trim()) continue;
        if (documentReferences.some(reference=>reference.index! >= argument && reference.index!+reference[0].length <= end
          && !stem.slice(argument,reference.index!).trim() && !stem.slice(reference.index!+reference[0].length,end).trim())) continue;
        const read = readChemistryQuantityDeclaration({question:stem,after:/^/,
          within:{start:argument,end},dimension:"dimensionless",targetUnit:"1",owner:`liquid mole fraction of ${composition.name}`});
        if (read.state !== "valid" && (chemistryQuantityPayloadPresent(stem.slice(argument,end)) || /^or$/i.test(link[0]))) return null;
      }
    }
  }
  let xA: number | null = null;
  const consumeComposition = (value:number): boolean => {
    if (!(value >= 0 && value <= 1) || xA !== null && !chemistryCanonicalValuesAgree(xA,value)) return false;
    xA = value;
    return true;
  };
  for (const {name:who,value} of compositions) {
    if (!(value >= 0 && value <= 1)) return null;
    const selected = who === names[0] ? value : who === names[1] ? 1-value : null;
    if (selected === null || !consumeComposition(selected)) return null;
  }
  // Each supported source form supplies the same composition constraint;
  // none is a fallback that may disappear behind an earlier readable form.
  let nonEquimolar = false;
  for (const cue of sourceMatches(/\bequimolar\b/gi)) {
    const negated = /\b(?:not(?:\s+(?:an?|the))?(?:\s+(?:[a-z]+ly|quite|at\s+all))?|non|unequal)[\s\-‐‑−–—]*$/i.test(body.slice(0,cue.index));
    if (negated) nonEquimolar = true;
    else if (!consumeComposition(0.5)) return null;
  }
  const consumedAmounts: ChemistrySpan[] = [];
  for (const {match:moles,value} of moleReadings) {
    if (!consumeComposition(value)) return null;
    consumedAmounts.push({start:moles.indices![1]![0],end:moles.indices![2]![1]},
      {start:moles.indices![3]![0],end:moles.indices![4]![1]});
  }
  // Successful pairs cannot erase a supplied unread amount. The postfix
  // unit/component cue also retains the existing declaration-state semantics
  // for unknown/NaN owners and genuine requested amount nouns.
  const amountOwners = sourceMatches(new RegExp(`(?<![a-z_])mol(?:e|es)?\\s+(?:of\\s+)?${COMPONENT_FILLER}${name}`,"gid"))
    .filter(cue=>!compositionOwners.some(owner=>owner.index! <= cue.index!
      && owner.index!+owner[0].length >= cue.index!+cue[0].length));
  for (const [index,cue] of amountOwners.entries()) {
    if (consumedAmounts.some(span=>span.start <= cue.index! && span.end >= cue.index!+cue[0].length)) continue;
    const next = amountOwners[index+1]?.index ?? scope.end;
    const sentence = /[;!?\n]|\.(?=\s|$)/.exec(body.slice(cue.index!+cue[0].length,next));
    const end = sentence ? cue.index!+cue[0].length+sentence.index : next;
    const after = new RegExp(cue[0].replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
    const read = readChemistryQuantityDeclaration({question:stem,after,cueCaseSensitive:true,
      within:{start:cue.index!,end},dimension:"amount",targetUnit:"mol",owner:`component amount of ${cue[1]}`});
    const prefixToken = /[^\s,;!?]+$/.exec(body.slice(0,cue.index!).trimEnd())?.[0] ?? "";
    if (read.state !== "absent" || new RegExp(CHEMISTRY_SCALAR_PATTERN).test(prefixToken)) return null;
  }
  if (nonEquimolar && xA !== null && chemistryCanonicalValuesAgree(xA,0.5)) return null;
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
  c.scene.assert("total_at_b", "function_value", ["p_total"], { x: 0, y: round(k * reading.pB0, 8) }, "warning");
  c.scene.assert("total_at_a", "function_value", ["p_total"], { x: 1, y: round(k * reading.pA0, 8) }, "warning");
  c.scene.assert("pa_at_a", "function_value", ["p_a"], { x: 1, y: round(k * reading.pA0, 8) }, "warning");
  c.scene.assert("pb_at_b", "function_value", ["p_b"], { x: 0, y: round(k * reading.pB0, 8) }, "warning");
  c.text("scale_note", { x: 0.15, y: 0.68 }, "display scaled", "axis height is not the pressure unit");
  let compositionCaption = "";
  if (reading.xA !== null && reading.xA > 0.02 && reading.xA < 0.98) {
    const total = lines.pTotal(reading.xA);
    const at: Vec2 = { x: reading.xA, y: k * total };
    c.scene.point("mix_point", at, "stated composition on the total pressure line", `p_total = ${fmtNumber(total, 3)}`);
    c.scene.point("mix_foot", { x: reading.xA, y: 0 }, "stated composition on the axis", `x_${nameA} = ${fmtNumber(reading.xA, 3)}`);
    dashed(c, "mix_drop", at, { x: reading.xA, y: 0 }, "drop at the stated composition");
    c.scene.assert("total_at_mix", "function_value", ["p_total"], { x: round(reading.xA, 8), y: round(at.y, 8) }, "warning");
    const pressureUnit = reading.unit ? ` ${reading.unit}` : "";
    const partialA = `p_${nameA}=${fmtNumber(lines.pA(reading.xA), 3)}${pressureUnit}`;
    const partialB = `p_${nameB}=${fmtNumber(lines.pB(reading.xA), 3)}${pressureUnit}`;
    const vapour = `y_${nameA}=${fmtNumber(lines.yA(reading.xA), 3)}`;
    c.text("pa_value", { x: 0.12, y: -0.22 }, partialA.length <= 16 ? partialA : `p_${nameA}=${fmtNumber(lines.pA(reading.xA), 3)}`, "partial pressure of A");
    c.text("pb_value", { x: 0.12, y: -0.42 }, partialB.length <= 16 ? partialB : `p_${nameB}=${fmtNumber(lines.pB(reading.xA), 3)}`, "partial pressure of B");
    c.text("ya_value", { x: 0.62, y: -0.22 }, vapour, "vapour mole fraction of A");
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
  c.text("schematic_l", { x: 0.28, y: 0.74 }, "schematic", "deviation curves are not measured pressures");
  c.text("measured_l", { x: 0.62, y: 0.74 }, "not measured p", "curve height is not a measured pressure");
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
  c.text("schematic_l", { x: 0.28, y: 0.68 }, "schematic", "symbolic ideal lines are not measured pressures");
  c.text("measured_l", { x: 0.62, y: 0.68 }, "not measured p", "curve height is not a measured pressure");
  c.scene.labelled("pure_a", "pure_b", "x_one");
  return c.build({ caption: "Ideal solution: p_A = p°_A x_A and p_B = p°_B x_B are straight lines through the pure component points, and p_total = p_A + p_B is the straight line joining p°_B (pure B, left) to p°_A (pure A, right). The heights are schematic, not measured pressures. ΔH_mix = 0 and ΔV_mix = 0." });
}

/* ------------------------------------------------------------------------- */
/* Colligative vapour pressure diagram                                        */
/* ------------------------------------------------------------------------- */

function statedDeltaT(stem: string, _quantities: readonly ChemPlanQuantity[], which: "b" | "f"): number | null | false {
  const phrases = which === "b"
    ? [/(?:elevation (?:in|of) (?:the )?boiling point|boiling point elevation|(?:δ|Δ|delta ?)t_?b)(?:\s*of (?:the |a |an |this )?(?:[a-z]+ )?(?:solution|water|solvent|benzene))?(?:\s+(?:is|was|of|=|:))?(?:\s+found to be|\s+observed(?: to be)?)?/]
    : [/(?:depression (?:in|of) (?:the )?freezing point|freezing point depression|(?:δ|Δ|delta ?)t_?f)(?:\s*of (?:the |a |an |this )?(?:[a-z]+ )?(?:solution|water|solvent|benzene))?(?:\s+(?:is|was|of|=|:))?(?:\s+found to be|\s+observed(?: to be)?)?/];
  const cue = phrases[0]!;
  const owners = [...stem.slice(0,chemistryQuestionSpan(stem).end).matchAll(new RegExp(cue.source,"gi"))];
  let value: number | null = null;
  for (const [index,owner] of owners.entries()) {
    const end = owners[index+1]?.index ?? chemistryQuestionSpan(stem).end;
    const payload = stem.slice(owner.index!+owner[0].length,end);
    const heading = /:\s*$/.test(owner[0])
      ? /^\s*(?:draw|sketch|plot|show)\b/i.test(payload)
      : /^\s*:\s*(?:draw|sketch|plot|show)\b/i.test(payload);
    if (heading && !chemistryQuantityPayloadPresent(payload)) continue;
    const read = readChemistryQuantityDeclaration({question:stem,after:cue,within:{start:owner.index!,end},
      dimension:"temperature_delta",targetUnit:"K",owner:which === "b" ? "boiling-point elevation" : "freezing-point depression"});
    if (read.state === "invalid") return false;
    if (read.state === "valid") {
      if (value !== null || !(read.reading.value > 0) || read.reading.value > 50) return false;
      value = read.reading.value;
    }
  }
  return value;
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
  if (!chemistryPlanBindingsValid(question, quantities)) return null;
  const stem = chemStem(question);
  if (FIGURE_PRESENT.test(stem)) return null;
  if (claimsSolutionLesson(question)) return buildSolutionLessonScene(question, quantities, schematic);
  if (titrationCue(stem)) {
    if (!titrationQuantityTokensValid(question)) return null;
    // Each textual concentration is checked independently here. Species
    // binding and agreement still belong to the ordinary titration reader;
    // valid acid/base concentrations are not coalesced into one owner.
    const concentrations = [...question.matchAll(/\bconcentrations?\b/gi)];
    for (const [index,cue] of concentrations.entries()) {
      const within = {start:cue.index!,end:concentrations[index+1]?.index ?? question.length};
      const reads = (["concentration","normality"] as const).map(dimension => readChemistryQuantityDeclaration({question,after:/\bconcentrations?\b/,within,dimension,owner:"titration concentration declaration"}));
      if (!reads.some(read => read.state === "valid") && !reads.every(read => read.state === "absent")) return null;
    }
    const supplied = suppliedAcidBaseConstants(question);
    if (!supplied) return null;
    const mentions = readSpeciesMentions(question);
    if ([...mentions.withVolume, ...mentions.withoutVolume].some(m => !Number.isFinite(m.concentration) || m.concentration <= 0 || (m.volume !== undefined && (!Number.isFinite(m.volume) || m.volume <= 0)))) return null;
    const numeric = readTitration(question, quantities);
    if (numeric) return titrationScene(question, numeric.curve, numeric.spec, { numeric: true, normalisedVolume: numeric.normalisedVolume });
    if (supplied.supplied) return null;
    // Supplied numeric data that failed a species/quantity binding must not
    // disappear into a normalised or qualitative default curve.
    if ((["volume","concentration","normality"] as const).some(dimension => {
      const inventory = findChemistryQuantities({question,dimension});
      return !inventory.ok || inventory.reading.length > 0;
    })) return null;
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
    const deltaT = statedDeltaT(question, quantities, mode === "boiling" ? "b" : "f");
    return deltaT === false ? null : colligativeScene(question, mode, deltaT);
  }
  if (RAOULT_CUE.test(stem)) {
    if (/azeotrope/.test(stem) && !/minimum boiling|maximum boiling|azeotropic composition/.test(stem)) return null;
    const positive = /positive deviation|deviates? positively/.test(stem);
    const negative = /negative deviation|deviates? negatively/.test(stem);
    const reading = readRaoult(question, quantities);
    // Numeric source statements that failed binding cannot become a stock graph.
    const pressureGiven = /(?:vapou?r pressures?|that)\s+of\b|\bp\s*(?:°|\^0|\^\(0\)|0)\s*_?\s*[A-Za-z]\s*(?:=|is|:)/i.test(question);
    if (!reading && pressureGiven) return null;
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
    expect: "draw",
    labels: ["M=120 g/mol", "i=1"],
    note: "M = 1.86 × 1.2 × 1000 / (0.372 × 50) = 120 g/mol; dissociation is not assumed",
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
    expect: "draw",
    labels: ["pi=2.49 bar", "solvent", "no solute", "T=300 K"],
    note: "π = 1 × 0.1 × 0.083 × 300 = 2.49 bar; the membrane passes solvent only",
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
