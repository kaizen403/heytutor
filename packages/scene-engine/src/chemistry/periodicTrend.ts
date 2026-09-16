/**
 * Periodic trends and periodic table position (JEE Main, classification of
 * elements and periodicity).
 *
 * Three figures, every number read from the element tables so the picture
 * cannot disagree with NCERT:
 *
 *  1. A trend graph of one property, first ionisation enthalpy, Pauling
 *     electronegativity, covalent radius or electron gain enthalpy, across a
 *     period, down a group, or over the elements the stem lists. Each point is
 *     labelled with its symbol and the caption states the true order with the
 *     anomalies the exam tests (Be > B, N > O, Mg > Al, P > S) intact.
 *  2. The same graph for ionic radii, when every listed species carries a
 *     charge the ion table knows; an isoelectronic series says so.
 *  3. A periodic table row with the asked element's cell highlighted, for
 *     "position in the periodic table" stems that give Z, a symbol, a name, a
 *     period and group, or an electron configuration.
 *
 * Everything else declines: no property or no element set, a property with no
 * table (second ionisation enthalpy, metallic character), d and f block
 * trends, and the group 13 and 14 heavy members whose radius and
 * electronegativity order depends on which table one reads.
 */
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, type ChemPlanQuantity, type Vec2 } from "./sceneKit";
import { electronConfiguration } from "./electronConfiguration";
import {
  ELEMENTS,
  elementByName,
  elementBySymbol,
  elementByZ,
  periodElements,
  type ElementRecord,
} from "./elements";
import { formulaTokens, normalizeChemistryText, parseFormula } from "./formula";

export const PERIODIC_FAMILY = "chem_periodic" as const;

/* ------------------------------------------------------------------------- */
/* Data                                                                      */
/* ------------------------------------------------------------------------- */

export type PeriodicProperty = "ie1" | "electronegativity" | "radius" | "egh";

/** Electron gain enthalpy, kJ/mol (NCERT Table 3.7 and the standard main group values). */
const ELECTRON_GAIN_ENTHALPY: Readonly<Record<string, number>> = {
  H: -73,
  He: 48, Ne: 116, Ar: 96, Kr: 96, Xe: 77, Rn: 68,
  Li: -60, Na: -53, K: -48, Rb: -47, Cs: -46,
  Be: 66, Mg: 67,
  B: -27, Al: -43,
  C: -122, Si: -134, Ge: -119,
  N: 7, P: -72, As: -78,
  O: -141, S: -200, Se: -195, Te: -190, Po: -174,
  F: -328, Cl: -349, Br: -325, I: -295, At: -270,
};

/** Ionic radii, pm (NCERT / Shannon, six coordinate). Key: symbol then signed charge. */
const IONIC_RADIUS: Readonly<Record<string, number>> = {
  "Li+1": 76, "Na+1": 102, "K+1": 138, "Rb+1": 152, "Cs+1": 167,
  "Be+2": 45, "Mg+2": 72, "Ca+2": 100, "Sr+2": 118, "Ba+2": 135,
  "Al+3": 54,
  "N-3": 171, "O-2": 140, "F-1": 133,
  "S-2": 184, "Cl-1": 181, "Br-1": 196, "I-1": 220, "Se-2": 198, "Te-2": 221,
};

export interface PropertySpec {
  readonly property: PeriodicProperty;
  /** Axis title, at most 16 characters. */
  readonly axis: string;
  /** Caption name with unit. */
  readonly name: string;
  readonly unit: string;
  readonly digits: number;
}

const PROPERTY_SPEC: Readonly<Record<PeriodicProperty, PropertySpec>> = {
  ie1: { property: "ie1", axis: "IE_1 (kJ/mol)", name: "IE_1 (kJ/mol)", unit: "kJ/mol", digits: 0 },
  electronegativity: { property: "electronegativity", axis: "EN (Pauling)", name: "electronegativity (Pauling)", unit: "", digits: 2 },
  radius: { property: "radius", axis: "r (pm)", name: "covalent radius (pm)", unit: "pm", digits: 0 },
  egh: { property: "egh", axis: "Δ_(eg)H (kJ/mol)", name: "Δ_(eg)H (kJ/mol)", unit: "kJ/mol", digits: 0 },
};

/** Electron gain enthalpy of an element, kJ/mol, or null when the table has no value. */
export function electronGainEnthalpy(symbol: string): number | null {
  return ELECTRON_GAIN_ENTHALPY[symbol] ?? null;
}

/** Ionic radius of a monatomic ion, pm, or null when the table has no value. */
export function ionicRadiusPm(symbol: string, charge: number): number | null {
  if (!Number.isInteger(charge) || charge === 0) return null;
  return IONIC_RADIUS[`${symbol}${charge > 0 ? "+" : "-"}${Math.abs(charge)}`] ?? null;
}

/** The table value of a property for an element, or null when undefined. */
export function propertyValue(property: PeriodicProperty, element: ElementRecord): number | null {
  switch (property) {
    case "ie1": return element.ie1;
    case "electronegativity": return element.electronegativity;
    case "radius": return element.radiusPm;
    case "egh": return electronGainEnthalpy(element.symbol);
  }
}

/**
 * Pure solver other families may call: the elements that have a value for the
 * property, in increasing order of that value, with the values alongside.
 * Ties keep the input order.
 */
export function periodicOrder(
  property: PeriodicProperty,
  elements: readonly ElementRecord[],
): { ordered: ElementRecord[]; values: number[] } {
  const rows = elements
    .map((element, index) => ({ element, value: propertyValue(property, element), index }))
    .filter((row): row is { element: ElementRecord; value: number; index: number } => row.value !== null)
    .sort((a, b) => a.value - b.value || a.index - b.index);
  return { ordered: rows.map((row) => row.element), values: rows.map((row) => row.value) };
}

/* ------------------------------------------------------------------------- */
/* Cues                                                                      */
/* ------------------------------------------------------------------------- */

const PROPERTY_CUE = /ioni[sz]ation (?:enthalp|energ|potential)|electron gain enthalp|electron affinit|electronegativit|atomic (?:radi|size)|ionic (?:radi|size)|covalent radi|metallic (?:character|radi)|periodic (?:trend|propert)|across (?:the |a )?(?:\w+ )?period\b|down (?:the |a )?(?:\w+ )?group\b|isoelectronic/;

const POSITION_CUE = /position (?:of [^.?]{1,40})?in the (?:modern |long form (?:of the )?)?periodic table|which block|belongs to (?:the )?[spdf][ -]?block|\b[spdf][ -]?block\b.{0,30}\b(?:z|atomic number)\b|\bgroup and period\b|\bperiod and group\b|\bgroup (?:number|of the element)|\bperiod (?:number|of the element)|belongs to (?:the )?(?:group|period)\b|(?:atomic number|\bz\b)[^.?]{0,50}\b(?:group|period|block)\b|\b(?:group|period|block)\b[^.?]{0,50}(?:atomic number|\bz\s*=)/;

/** True when this family should try the stem; the builder still declines what it cannot ground. */
export function isPeriodicTrendStem(question: string): boolean {
  const stem = chemStem(question);
  if (!stem.trim()) return false;
  if (POSITION_CUE.test(stem)) return true;
  if (!PROPERTY_CUE.test(stem)) return false;
  // Ordering stems about other quantities that merely mention a periodic word.
  if (/\b(?:pka|pkb|acidity|acid strength|basicity|basic strength|boiling point|melting point|bond length|bond order|nucleophil|electrophil|hydrolysis|dipole moment|reduction potential|electrode potential|heat capacit|lattice energ|hydration)\b/.test(stem) && !/\b(?:correct order of|increasing|decreasing|arrange)\b[^.?]{0,40}(?:ionis|ioniz|electronegativ|electron gain|electron affinit|radi)/.test(stem)) {
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------------- */
/* Reading the stem                                                          */
/* ------------------------------------------------------------------------- */

interface Ion { readonly element: ElementRecord; readonly charge: number; readonly label: string }

type PropertyKind = PeriodicProperty | "ionic" | "metallic" | "ie_higher";

const PROPERTY_PATTERNS: ReadonlyArray<[RegExp, PropertyKind]> = [
  [/(?:first|1st|1\s*st|i\b)?\s*ioni[sz]ation (?:enthalp|energ|potential)|\bie_?1\b/g, "ie1"],
  [/(?:second|third|fourth|2nd|3rd|4th|ii|iii)\s*ioni[sz]ation|ioni[sz]ation (?:enthalp\w*|energ\w*)\s*(?:values?\s*)?(?:\(\s*)?(?:ie|δ_?i\s*h)?_?\s*[234]\b|\bie_?[234]\b/g, "ie_higher"],
  [/electron gain enthalp|electron affinit/g, "egh"],
  [/electronegativit/g, "electronegativity"],
  [/ionic (?:radi|size)|isoelectronic/g, "ionic"],
  [/atomic (?:radi|size)|covalent radi|metallic radi|\bsize of (?:the )?(?:atom|element)s?\b|\bradi(?:us|i)\b/g, "radius"],
  [/metallic character/g, "metallic"],
];

interface PropertyRead { readonly property: PropertyKind; readonly mentions: number[] }

/** The property the stem asks about (its first mention wins) with every place it is mentioned. */
function readProperty(stem: string): PropertyRead | null {
  const finds: Array<{ property: PropertyKind; at: number }> = [];
  for (const [pattern, property] of PROPERTY_PATTERNS) {
    for (const match of stem.matchAll(pattern)) finds.push({ property, at: match.index! });
  }
  if (finds.length === 0) return null;
  finds.sort((a, b) => a.at - b.at);
  const mentionsOf = (property: PropertyKind): number[] => finds.filter((find) => find.property === property).map((find) => find.at);
  let chosen = finds[0]!.property;
  // A higher ionisation enthalpy has no table here; a stem that also asks the
  // first one by name gets the first.
  if (chosen === "ie_higher") {
    if (/\b(?:first|1st)\b/.test(stem) && mentionsOf("ie1").length > 0) chosen = "ie1";
    else return { property: "ie_higher", mentions: mentionsOf("ie_higher") };
  }
  return { property: chosen, mentions: mentionsOf(chosen) };
}

const ORDINAL: Readonly<Record<string, number>> = {
  first: 1, "1st": 1, one: 1, second: 2, "2nd": 2, two: 2, third: 3, "3rd": 3, three: 3,
  fourth: 4, "4th": 4, four: 4, fifth: 5, "5th": 5, five: 5, sixth: 6, "6th": 6, six: 6, seventh: 7, "7th": 7,
};

function ordinal(token: string | undefined): number | null {
  if (!token) return null;
  const digit = Number(token);
  if (Number.isInteger(digit) && digit > 0) return digit;
  return ORDINAL[token] ?? null;
}

function readPeriodNumber(stem: string): { period: number; at: number } | null {
  const named = /\b(first|second|third|fourth|fifth|sixth|seventh|1st|2nd|3rd|4th|5th|6th|7th)\s+period\b/.exec(stem);
  if (named) { const period = ordinal(named[1]); return period === null ? null : { period, at: named.index }; }
  const numbered = /\bperiod\s*(?:number\s*)?(?:=\s*)?([1-7])\b/.exec(stem);
  if (numbered) { const period = ordinal(numbered[1]); return period === null ? null : { period, at: numbered.index }; }
  return null;
}

const GROUP_FAMILY: ReadonlyArray<[RegExp, number]> = [
  [/\balkali metals?\b/, 1],
  [/\balkaline earth metals?\b/, 2],
  [/\bboron family\b/, 13],
  [/\bcarbon family\b/, 14],
  [/\bnitrogen family\b|\bpnictogens?\b/, 15],
  [/\boxygen family\b|\bchalcogens?\b/, 16],
  [/\bhalogens?\b/, 17],
  [/\bnoble gases\b|\binert gases\b|\bzero group\b/, 18],
];

function readGroupNumber(stem: string): { group: number; at: number } | null {
  const numbered = /\bgroup\s*(?:number\s*)?(?:=\s*)?(1[0-8]|[1-9])\b/.exec(stem);
  if (numbered) return { group: Number(numbered[1]), at: numbered.index };
  for (const [pattern, group] of GROUP_FAMILY) {
    const match = pattern.exec(stem);
    if (!match) continue;
    // "except noble gases", "other than the halogens": the family is excluded, not asked.
    const before = stem.slice(Math.max(0, match.index - 16), match.index);
    if (/\b(?:except|excluding|other than|apart from|besides|not)\b[^.]*$/.test(before)) continue;
    return { group, at: match.index };
  }
  return null;
}

/** The main group members the exam plots: no H in group 1, no radioactive tail. */
function mainGroupMembers(group: number): ElementRecord[] {
  const symbols: Readonly<Record<number, string[]>> = {
    1: ["Li", "Na", "K", "Rb", "Cs"],
    2: ["Be", "Mg", "Ca", "Sr", "Ba"],
    13: ["B", "Al", "Ga", "In", "Tl"],
    14: ["C", "Si", "Ge", "Sn", "Pb"],
    15: ["N", "P", "As", "Sb", "Bi"],
    16: ["O", "S", "Se", "Te", "Po"],
    17: ["F", "Cl", "Br", "I"],
    18: ["He", "Ne", "Ar", "Kr", "Xe"],
  };
  return (symbols[group] ?? []).map((symbol) => elementBySymbol(symbol)!);
}

const NAME_INDEX: ReadonlyMap<string, ElementRecord> = new Map([
  ...ELEMENTS.map((element): [string, ElementRecord] => [element.name.toLowerCase(), element]),
  ["aluminum", elementBySymbol("Al")!],
  ["sulfur", elementBySymbol("S")!],
  ["cesium", elementBySymbol("Cs")!],
]);

const NAME_PATTERN = new RegExp(`\\b(${[...NAME_INDEX.keys()].sort((a, b) => b.length - a.length).join("|")})\\b`, "gi");

interface Candidate { readonly element: ElementRecord; readonly start: number; readonly end: number; readonly byName: boolean }

/**
 * Element mentions in reading order: exact-case symbols standing alone (not
 * inside a formula, not an option marker like "(B)" or "B."), and element
 * names in any case.
 */
function elementCandidates(text: string): Candidate[] {
  const found: Candidate[] = [];
  const symbolPattern = /(?<![A-Za-z0-9\])])([A-Z][a-z]?)(?![A-Za-z0-9([])/g;
  for (const match of text.matchAll(symbolPattern)) {
    const symbol = match[1]!;
    const element = elementBySymbol(symbol);
    if (!element) continue;
    const start = match.index!;
    const end = start + symbol.length;
    const before = text.slice(Math.max(0, start - 2), start);
    const after = text.slice(end, end + 2);
    if (symbol.length === 1) {
      // "(B)" and "B. Br" are option markers; "Br and I." is iodine ending a sentence.
      if (/\(\s*$/.test(before)) continue;
      const listBefore = /(?:,|\band|\bor|<|>|=)\s*$/.test(text.slice(Math.max(0, start - 6), start));
      if (/^\s*[.):]/.test(after) && !listBefore) continue;
    }
    found.push({ element, start, end, byName: false });
  }
  for (const match of text.matchAll(NAME_PATTERN)) {
    const element = NAME_INDEX.get(match[1]!.toLowerCase());
    if (!element) continue;
    found.push({ element, start: match.index!, end: match.index! + match[1]!.length, byName: true });
  }
  return found.sort((a, b) => a.start - b.start);
}

const LIST_SEPARATOR = /^\s*(?:,|;|&|<|>|=|≤|≥|\/|\band\b|\bor\b|,\s*and|,\s*or)?\s*$/;
const EXPLICIT_SEPARATOR = /[,;&<>=≤≥/]|\band\b|\bor\b/;

interface Run { readonly elements: ElementRecord[]; readonly at: number }

/**
 * Runs of at least `minimum` distinct elements joined by list separators
 * ("Na, Mg, Al and Si", "F < Cl < Br < I"), in reading order. Names only
 * join through an explicit separator so "K lead to" never reads lead as Pb,
 * and a single letter joined by bare whitespace on both sides is an option
 * marker ("A O<S<Se<Te B O<S>Se>Te"), not boron.
 */
function elementRuns(text: string, minimum = 3): Run[] {
  const candidates = elementCandidates(text);
  const groups: Candidate[][] = [];
  let run: Candidate[] = [];
  candidates.forEach((candidate, index) => {
    const previous = candidates[index - 1];
    const next = candidates[index + 1];
    const gapBefore = previous ? text.slice(previous.end, candidate.start) : null;
    const gapAfter = next ? text.slice(candidate.end, next.start) : null;
    const explicitBefore = gapBefore !== null && EXPLICIT_SEPARATOR.test(gapBefore);
    const explicitAfter = gapAfter !== null && EXPLICIT_SEPARATOR.test(gapAfter);
    if (!candidate.byName && candidate.element.symbol.length === 1 && !explicitBefore && !explicitAfter) {
      if (run.length) groups.push(run);
      run = [];
      return;
    }
    if (run.length && gapBefore !== null) {
      const last = run[run.length - 1]!;
      const joins = LIST_SEPARATOR.test(gapBefore) && (explicitBefore || (!candidate.byName && !last.byName));
      if (!joins) {
        groups.push(run);
        run = [];
      }
    }
    run.push(candidate);
  });
  if (run.length) groups.push(run);
  const runs: Run[] = [];
  for (const group of groups) {
    const distinct: ElementRecord[] = [];
    for (const candidate of group) if (!distinct.includes(candidate.element)) distinct.push(candidate.element);
    if (distinct.length >= minimum) runs.push({ elements: distinct, at: group[0]!.start });
  }
  return runs;
}

const nearest = (at: number, mentions: readonly number[]): number =>
  mentions.reduce((best, mention) => Math.min(best, Math.abs(mention - at)), Number.POSITIVE_INFINITY);

/**
 * Multi-statement stems ("Statement I ... Statement II ...", "(A) ... (B) ...")
 * mix unrelated asks; the segment index of a position says which statement
 * it belongs to, so a property from one never pairs with elements of another.
 */
function segmentOf(text: string, at: number): number {
  const boundaries = text.slice(0, at).match(/\bstatement\b|\bassertion\b|\breason\b|\(\s*[a-eA-E]\s*\)/g);
  return boundaries ? boundaries.length : 0;
}

function sameSegment(text: string, at: number, mentions: readonly number[]): boolean {
  const segment = segmentOf(text, at);
  return mentions.some((mention) => segmentOf(text, mention) === segment);
}

/**
 * The element set the stem asks about: the set most runs agree on (the
 * options repeat the question's set), ties broken by closeness to where the
 * property is named. OCR damage that yields a one-off set loses the vote.
 */
function chooseRun(text: string, allRuns: readonly Run[], mentions: readonly number[]): Run | null {
  const inSegment = allRuns.filter((run) => sameSegment(text, run.at, mentions));
  const runs = inSegment.length > 0 ? inSegment : allRuns;
  if (runs.length === 0) return null;
  const key = (run: Run): string => [...run.elements].map((element) => element.symbol).sort().join(",");
  const votes = new Map<string, number>();
  for (const run of runs) votes.set(key(run), (votes.get(key(run)) ?? 0) + 1);
  const best = Math.max(...votes.values());
  const leading = runs.filter((run) => votes.get(key(run)) === best);
  return [...leading].sort((a, b) => nearest(a.at, mentions) - nearest(b.at, mentions))[0] ?? null;
}

/** "from Li to Ne" / "from sodium to argon": the elements between, along a period or a group. */
function elementRange(text: string): { elements: ElementRecord[]; kind: "period" | "group"; index: number; at: number } | null {
  const match = /\bfrom\s+([A-Z][a-z]?|[a-z]+)\s+(?:to|till|upto|up to)\s+([A-Z][a-z]?|[a-z]+)\b/.exec(text);
  if (!match) return null;
  const a = elementBySymbol(match[1]!) ?? elementByName(match[1]!);
  const b = elementBySymbol(match[2]!) ?? elementByName(match[2]!);
  if (!a || !b || a === b) return null;
  const lo = a.z < b.z ? a : b;
  const hi = a.z < b.z ? b : a;
  if (a.period === b.period) {
    return { elements: periodElements(a.period).filter((element) => element.z >= lo.z && element.z <= hi.z), kind: "period", index: a.period, at: match.index };
  }
  if (a.group !== null && a.group === b.group) {
    return { elements: ELEMENTS.filter((element) => element.group === a.group && element.z >= lo.z && element.z <= hi.z), kind: "group", index: a.group, at: match.index };
  }
  return null;
}

/** Monatomic ions with a charge, in reading order, deduplicated. */
function ionRun(text: string): Ion[] {
  const ions: Ion[] = [];
  for (const token of formulaTokens(text)) {
    const parsed = parseFormula(token);
    if (!parsed || parsed.totalAtoms !== 1 || parsed.charge === 0) continue;
    const atom = parsed.atoms[0]!;
    if (ions.some((ion) => ion.element === atom.element && ion.charge === parsed.charge)) continue;
    const magnitude = Math.abs(parsed.charge);
    const sign = parsed.charge > 0 ? "+" : "-";
    const label = magnitude === 1 ? `${atom.symbol}^${sign}` : `${atom.symbol}^(${magnitude}${sign})`;
    ions.push({ element: atom.element, charge: parsed.charge, label });
  }
  return ions;
}

/* ------------------------------------------------------------------------- */
/* Trend requests                                                            */
/* ------------------------------------------------------------------------- */

interface TrendPoint { readonly label: string; readonly value: number; readonly symbol: string; readonly z: number }

interface TrendRequest {
  readonly spec: PropertySpec | { readonly property: "ionic"; readonly axis: string; readonly name: string; readonly unit: string; readonly digits: number };
  readonly points: TrendPoint[];
  /** x axis title, at most 16 characters. */
  readonly xTitle: string;
  /** Caption lead: "across period 3", "down group 17", "in increasing order". */
  readonly lead: string;
  readonly direction: "asc" | "desc";
  readonly note?: string;
}

const IONIC_SPEC = { property: "ionic" as const, axis: "r_ion (pm)", name: "ionic radius (pm)", unit: "pm", digits: 0 };

function fmtValue(value: number, digits: number): string {
  return value.toFixed(digits);
}

/** Whether the exam's expected order for this set disagrees with the table used here. */
function sourceDependent(property: PeriodicProperty, elements: readonly ElementRecord[]): string | null {
  const symbols = new Set(elements.map((element) => element.symbol));
  if (elements.some((element) => element.block === "d" || element.block === "f")) return "d and f block trends are not plotted";
  if (property === "electronegativity" && ["Ga", "In", "Tl", "Ge", "Sn", "Pb"].some((symbol) => symbols.has(symbol))) {
    return "electronegativity of the heavy group 13 and 14 members depends on the table";
  }
  if (property === "radius" && symbols.has("Al") && symbols.has("Ga")) return "Al and Ga radii differ by table";
  return null;
}

function wantsDescending(stem: string): boolean {
  return /\bdecreasing\b|\bdescending\b/.test(stem) && !/\bincreasing\b|\bascending\b/.test(stem);
}

/** Characters between the property mention and the element set beyond which they belong to different statements. */
const PROXIMITY = 220;

function readTrend(question: string, stem: string): TrendRequest | null {
  const text = normalizeChemistryText(question);
  const property = readProperty(stem);
  if (!property) return null;
  if (property.property === "metallic" || property.property === "ie_higher") return null;
  const direction: "asc" | "desc" = wantsDescending(stem) ? "desc" : "asc";

  if (property.property === "ionic") {
    const ions = ionRun(text);
    if (ions.length < 2) return null;
    const rows = ions.map((ion) => ({ ion, value: ionicRadiusPm(ion.element.symbol, ion.charge) }));
    if (rows.some((row) => row.value === null)) return null;
    const sorted = rows
      .map((row) => ({ ion: row.ion, value: row.value! }))
      .sort((a, b) => (direction === "asc" ? a.value - b.value : b.value - a.value));
    const electrons = new Set(ions.map((ion) => ion.element.z - ion.charge));
    const isoelectronic = electrons.size === 1;
    return {
      spec: IONIC_SPEC,
      points: sorted.map((row) => ({ label: row.ion.label, value: row.value, symbol: row.ion.element.symbol, z: row.ion.element.z })),
      xTitle: direction === "asc" ? "increasing r_ion" : "decreasing r_ion",
      lead: `in ${direction === "asc" ? "increasing" : "decreasing"} order`,
      direction,
      note: isoelectronic ? `isoelectronic (${[...electrons][0]} electrons): radius falls as Z rises` : undefined,
    };
  }

  const spec = PROPERTY_SPEC[property.property];
  let elements: ElementRecord[] | null = null;
  let kind: "list" | "period" | "group" = "list";
  let index = 0;
  let at = 0;

  const run = chooseRun(text, elementRuns(text), property.mentions);
  const range = elementRange(text);
  const period = readPeriodNumber(stem);
  const group = readGroupNumber(stem);
  if (run) {
    elements = run.elements;
    at = run.at;
  } else if (range) {
    elements = range.elements;
    kind = range.kind;
    index = range.index;
    at = range.at;
  } else if (period !== null && period.period >= 2 && period.period <= 6) {
    elements = periodElements(period.period);
    kind = "period";
    index = period.period;
    at = period.at;
  } else if (group !== null && mainGroupMembers(group.group).length > 0) {
    elements = mainGroupMembers(group.group);
    kind = "group";
    index = group.group;
    at = group.at;
  }
  if (!elements) return null;
  // The property and the element set must come from the same ask, not from
  // two unrelated statements of a multi-statement stem.
  if (nearest(at, property.mentions) > PROXIMITY || !sameSegment(text, at, property.mentions)) return null;

  const veto = sourceDependent(spec.property, elements);
  if (veto) return null;
  // Electronegativity has no value for the noble gases; drop them from a period.
  let rows = elements.map((element) => ({ element, value: propertyValue(spec.property, element) }));
  if (spec.property === "electronegativity") rows = rows.filter((row) => row.value !== null);
  if (rows.some((row) => row.value === null) || rows.length < 3 || rows.length > 8) return null;
  let ordered = rows.map((row) => ({ element: row.element, value: row.value! }));
  if (kind === "list") ordered = ordered.sort((a, b) => (direction === "asc" ? a.value - b.value : b.value - a.value) || a.element.z - b.element.z);
  const lead = kind === "period" ? `across period ${index}` : kind === "group" ? `down group ${index}` : `in ${direction === "asc" ? "increasing" : "decreasing"} order`;
  const xTitle = kind === "period" ? `across period ${index}` : kind === "group" ? `down group ${index}` : direction === "asc" ? "increasing order" : "decreasing order";
  return {
    spec,
    points: ordered.map((row) => ({ label: row.element.symbol, value: row.value, symbol: row.element.symbol, z: row.element.z })),
    xTitle,
    lead,
    direction,
  };
}

/** "Na 496 < Al 578 < Mg 738 ...", ties written with "=". */
function orderChain(points: readonly TrendPoint[], digits: number, direction: "asc" | "desc"): string {
  const sorted = [...points].sort((a, b) => (direction === "asc" ? a.value - b.value : b.value - a.value) || a.z - b.z);
  return sorted.map((point, index) => {
    const previous = sorted[index - 1];
    const joiner = index === 0 ? "" : previous!.value === point.value ? " = " : direction === "asc" ? " < " : " > ";
    return `${joiner}${point.label} (${fmtValue(point.value, digits)})`;
  }).join("");
}

/* ------------------------------------------------------------------------- */
/* Figure 1 and 2: the trend graph                                           */
/* ------------------------------------------------------------------------- */

function niceStep(span: number): number {
  const raw = span / 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  for (const factor of [1, 2, 5, 10]) {
    if (raw <= factor * magnitude) return factor * magnitude;
  }
  return 10 * magnitude;
}

function unitVector(from: Vec2, to: Vec2): Vec2 {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

/** Direction that keeps a point label clear of the polyline through it. */
function labelOffset(index: number, positions: readonly Vec2[]): Vec2 {
  const at = positions[index]!;
  const previous = positions[index - 1];
  const next = positions[index + 1];
  const sum = { x: 0, y: 0 };
  if (previous) { const u = unitVector(at, previous); sum.x += u.x; sum.y += u.y; }
  if (next) { const u = unitVector(at, next); sum.x += u.x; sum.y += u.y; }
  const length = Math.hypot(sum.x, sum.y);
  let dir: Vec2;
  if (length < 0.35) {
    // Nearly straight or a single neighbour: use the normal, preferring up.
    const along = previous && next ? unitVector(previous, next) : previous ? unitVector(previous, at) : next ? unitVector(at, next) : { x: 1, y: 0 };
    dir = { x: -along.y, y: along.x };
    if (dir.y < 0) dir = { x: -dir.x, y: -dir.y };
    if (!(previous && next)) dir = { x: dir.x * 0.6, y: Math.abs(dir.y) * 0.6 + 0.8 };
  } else {
    dir = { x: -sum.x / length, y: -sum.y / length };
  }
  const norm = Math.hypot(dir.x, dir.y) || 1;
  return { x: dir.x / norm, y: dir.y / norm };
}

function trendGraph(question: string, request: TrendRequest): SceneDocument | null {
  const { spec, points } = request;
  const n = points.length;
  const values = points.map((point) => point.value);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const step = niceStep(hi - lo);
  const yLo = Math.floor(lo / step) * step;
  const yHi = Math.ceil(hi / step) * step;
  const tickDigits = step >= 1 ? 0 : 1;
  const xMax = n + 1.5;
  const height = Math.max(3.6, 0.6 * xMax);
  const k = height / (yHi - yLo);
  const y = (value: number): number => value * k;
  const positions: Vec2[] = points.map((point, index) => ({ x: index + 1, y: y(point.value) }));

  const c = new ChemScene(question, `${spec.name} ${request.lead}, plotted from the periodic table`, PERIODIC_FAMILY);
  const s = c.scene;
  const topPad = 0.55;
  s.axes("axes", 0, xMax, y(yLo) - (yLo < 0 ? 0.3 : 0), y(yHi) + topPad, `${spec.name} against element`);
  // Tick marks and their values on the y axis.
  for (let tick = yLo; tick <= yHi + 1e-9; tick += step) {
    const value = Number(tick.toFixed(6));
    const tickId = `tick_${Math.round(value * 100)}`.replace("-", "m");
    const a = s.helper(`${tickId}_a`, { x: -0.08, y: y(value) }, "tick helper");
    const b = s.helper(`${tickId}_b`, { x: 0.08, y: y(value) }, "tick helper");
    s.segment(tickId, a, b, "axis tick");
    c.text(`${tickId}_v`, { x: -0.5, y: y(value) }, fmtValue(value, tickDigits), "tick value");
  }
  c.text("y_title", { x: 0.15, y: y(yHi) + topPad + 0.3 }, spec.axis, "y axis title");
  c.text("x_title", { x: xMax - 0.1, y: -0.42 }, request.xTitle, "x axis title");
  s.labelled("y_title", "x_title");

  const pointIds = points.map((point, index) => {
    const id = `p_${point.symbol}${index}`;
    s.point(id, positions[index]!, `${point.label} data point`);
    return id;
  });
  s.polyline("trend", pointIds, `${spec.name} trend line`);
  points.forEach((point, index) => {
    const offset = labelOffset(index, positions);
    const at = positions[index]!;
    const distance = 0.34;
    const id = `lbl_${point.symbol}${index}`;
    c.text(id, { x: at.x + offset.x * distance, y: at.y + offset.y * distance }, point.label, `${point.label} label`);
    s.labelled(id);
    s.quantity(`q_${point.symbol}${index}`, `${spec.property === "ionic" ? "r" : spec.property}(${point.label})`, point.value, spec.unit);
  });
  const chain = orderChain(points, spec.digits, request.direction);
  const caption = `${spec.name} ${request.lead}: ${chain}${request.note ? `; ${request.note}` : ""}${spec.property === "egh" ? mostNegativeNote(points) : ""}`;
  return c.build({ caption });
}

function mostNegativeNote(points: readonly TrendPoint[]): string {
  const lowest = [...points].sort((a, b) => a.value - b.value)[0];
  return lowest && lowest.value < 0 ? `; most negative: ${lowest.label}` : "";
}

/* ------------------------------------------------------------------------- */
/* Figure 3: periodic table position                                         */
/* ------------------------------------------------------------------------- */

function readPositionElement(question: string, stem: string): ElementRecord | null {
  const text = normalizeChemistryText(question);
  const zMatch = /(?:atomic number|\bz\b)\s*(?:of the element\s*)?(?:is|=|:|being|equal to|equals)?\s*(\d{1,3})\b/.exec(stem)
    ?? /\bz\s*=\s*(\d{1,3})\b/.exec(stem);
  if (zMatch) {
    const element = elementByZ(Number(zMatch[1]));
    return element ?? null;
  }
  // Period and group named together identify a main group element.
  const period = readPeriodNumber(stem);
  const group = readGroupNumber(stem);
  if (period !== null && group !== null) {
    const element = ELEMENTS.find((candidate) => candidate.period === period.period && candidate.group === group.group);
    if (element) return element;
  }
  // A configuration: sum the electrons ("[Ar] 3d10 4s2 4p3", "1s2 2s2 2p6 3s2 3p5").
  if (/configuration/.test(stem)) {
    const core = /\[\s*(He|Ne|Ar|Kr|Xe|Rn)\s*\]/.exec(text);
    const subshells = [...text.matchAll(/(?<![A-Za-z0-9])([1-7])([spdf])\^?\(?(\d{1,2})\)?/g)];
    if (subshells.length > 0) {
      const total = (core ? elementBySymbol(core[1]!)!.z : 0) + subshells.reduce((sum, match) => sum + Number(match[3]), 0);
      const element = elementByZ(total);
      if (element && total >= 1) return element;
    }
    return null;
  }
  // A single named element: "position of arsenic", "which block does Se belong to".
  const candidates = elementCandidates(text);
  const distinct = [...new Set(candidates.map((candidate) => candidate.element))];
  if (distinct.length === 1) return distinct[0]!;
  return null;
}

const MAIN_GROUPS = [1, 2, 13, 14, 15, 16, 17, 18] as const;

/**
 * The asked element's period with its neighbours above and below, main
 * groups only (the d block is a labelled gap), so the group column and the
 * period row both read; a d block element gets its full 18 cell period.
 */
function positionFigure(question: string, element: ElementRecord): SceneDocument | null {
  if (element.block === "f" || element.period > 6 || element.group === null) return null;
  const fullRow = element.block === "d";
  const groups: number[] = fullRow ? Array.from({ length: 18 }, (_, index) => index + 1) : [...MAIN_GROUPS];
  const cell = 1;
  const gap = fullRow ? 0 : 1.1;
  const rowGap = 0.12;
  const xOf = (index: number): number => index * cell + (!fullRow && index >= 2 ? gap : 0);
  const periods = fullRow
    ? [element.period]
    : [element.period - 1, element.period, element.period + 1].filter((period) => period >= 1 && period <= 6);
  const yOf = (period: number): number => (element.period - period) * (cell + rowGap);
  const configuration = electronConfiguration(element);

  const c = new ChemScene(question, `period ${element.period} of the periodic table with ${element.symbol} (Z = ${element.z}) highlighted`, PERIODIC_FAMILY);
  const s = c.scene;
  const top = yOf(periods[0]!) + cell / 2;
  const bottom = yOf(periods[periods.length - 1]!) - cell / 2;
  groups.forEach((group, index) => c.text(`g_${group}`, { x: xOf(index), y: top + 0.3 }, String(group), "group number"));
  for (const period of periods) {
    const members = ELEMENTS.filter((candidate) => candidate.period === period && candidate.group !== null);
    const rowY = yOf(period);
    groups.forEach((group, index) => {
      const x = xOf(index);
      const centre = s.helper(`cell_${period}_${group}_c`, { x, y: rowY }, "cell centre helper");
      s.rectangle(`cell_${period}_${group}`, centre, cell, cell, `period ${period} group ${group} cell`);
      const member = members.find((candidate) => candidate.group === group);
      if (!member) return;
      if (member === element) {
        c.text(`sym_${member.symbol}`, { x, y: rowY + 0.14 }, member.symbol, `${member.symbol} symbol`);
        c.text(`z_${member.symbol}`, { x, y: rowY - 0.24 }, String(member.z), `${member.symbol} atomic number`);
        const highlightCentre = s.helper("highlight_c", { x, y: rowY }, "highlight centre helper");
        s.rectangle("highlight", highlightCentre, cell + 0.18, cell + 0.18, `${member.symbol} highlighted cell`);
        s.labelled(`sym_${member.symbol}`, `z_${member.symbol}`);
      } else {
        c.text(`sym_${member.symbol}`, { x, y: rowY }, member.symbol, `${member.symbol} symbol`);
      }
    });
    c.text(`period_${period}`, { x: xOf(0) - cell / 2 - 0.32, y: rowY }, String(period), "period number");
    if (!fullRow && period >= 4) c.text(`d_block_${period}`, { x: xOf(1) + cell / 2 + gap / 2, y: rowY }, "d block", "d block gap");
  }
  c.text("period_head", { x: xOf(0) - cell / 2 - 0.42, y: top + 0.3 }, "period", "period header");
  c.text("s_block", { x: (xOf(0) + xOf(1)) / 2, y: bottom - 0.3 }, "s block", "block label");
  if (fullRow) {
    c.text("d_block", { x: (xOf(2) + xOf(11)) / 2, y: bottom - 0.3 }, "d block", "block label");
    c.text("p_block", { x: (xOf(12) + xOf(17)) / 2, y: bottom - 0.3 }, "p block", "block label");
  } else {
    c.text("p_block", { x: (xOf(2) + xOf(7)) / 2, y: bottom - 0.3 }, "p block", "block label");
  }
  s.labelled(`period_${element.period}`, "period_head");
  const caption = `Z = ${element.z}: ${element.symbol} (${element.name}), period ${element.period}, group ${element.group}, ${element.block} block${configuration ? `, ${configuration.condensed}` : ""}`;
  return c.build({ caption });
}

/* ------------------------------------------------------------------------- */
/* Builder                                                                   */
/* ------------------------------------------------------------------------- */

/** The figure, or null when the stem does not ground it. */
export function buildPeriodicTrendScene(
  question: string,
  quantities: ChemPlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  void quantities;
  void schematic;
  const stem = chemStem(question);
  if (!stem.trim()) return null;
  try {
    if (POSITION_CUE.test(stem)) {
      const element = readPositionElement(question, stem);
      if (element) return positionFigure(question, element);
      // A position stem with no element falls through to a trend only if one is asked.
    }
    if (!PROPERTY_CUE.test(stem)) return null;
    const request = readTrend(question, stem);
    if (!request) return null;
    return trendGraph(question, request);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------- */
/* Probes                                                                    */
/* ------------------------------------------------------------------------- */

export const PERIODIC_PROBES: ReadonlyArray<{
  question: string;
  expect: "draw" | "decline";
  labels?: string[];
  forbidLabels?: string[];
  note?: string;
}> = [
  {
    question: "Plot the variation of first ionisation enthalpy across period 3 from Na to Ar and explain the irregularities.",
    expect: "draw",
    labels: ["Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "IE_1 (kJ/mol)"],
    note: "caption chain Na < Al < Mg < Si < S < P < Cl < Ar",
  },
  {
    question: "How does the first ionisation enthalpy vary across the second period of the periodic table?",
    expect: "draw",
    labels: ["Li", "Be", "B", "C", "N", "O", "F", "Ne", "IE_1 (kJ/mol)"],
    note: "caption chain Li < B < Be < C < O < N < F < Ne",
  },
  {
    question: "Describe the trend in electronegativity down group 17.",
    expect: "draw",
    labels: ["F", "Cl", "Br", "I", "EN (Pauling)"],
  },
  {
    question: "How does the atomic radius change down group 1 (alkali metals)?",
    expect: "draw",
    labels: ["Li", "Na", "K", "Rb", "Cs", "r (pm)"],
  },
  {
    question: "The correct order of first ionisation enthalpy of Na, Mg, Al and Si is",
    expect: "draw",
    labels: ["Na", "Al", "Mg", "Si"],
    note: "Na < Al < Mg < Si",
  },
  {
    question: "Arrange Na+, Mg2+, F- and O2- in increasing order of ionic radius.",
    expect: "draw",
    labels: ["Na^+", "Mg^(2+)", "F^-", "O^(2-)", "r_ion (pm)"],
    note: "Mg2+ < Na+ < F- < O2-, isoelectronic",
  },
  {
    question: "Find the position in the periodic table of the element with atomic number 33: its period, group and block.",
    expect: "draw",
    labels: ["As", "33", "4", "15", "d block", "P", "Sb"],
  },
  {
    question: "The element with Z = 17 belongs to which group and period of the periodic table?",
    expect: "draw",
    labels: ["Cl", "17", "3", "p block", "F", "Br"],
    forbidLabels: ["Sc"],
    note: "periods 2 to 4 main groups only; the d block is a labelled gap",
  },
  {
    question: "Which of B, C, N and O has the highest electronegativity?",
    expect: "draw",
    labels: ["B", "C", "N", "O", "EN (Pauling)"],
  },
  {
    question: "Compare the electron gain enthalpy of the halogens F, Cl, Br and I. Which has the most negative value?",
    expect: "draw",
    labels: ["F", "Cl", "Br", "I", "Δ_(eg)H (kJ/mol)"],
    note: "Cl most negative: F (-328), Cl (-349), Br (-325), I (-295)",
  },
  {
    question: "The correct order of electron gain enthalpy (negative value) of O, S, Se and Te is",
    expect: "draw",
    labels: ["O", "S", "Se", "Te"],
    note: "S (-200) < Se (-195) < Te (-190) < O (-141)",
  },
  {
    question: "The first ionisation enthalpy of the elements Na, Mg, Cl and Ar follows the order Na > Mg > Cl > Ar. True or false?",
    expect: "draw",
    labels: ["Na", "Mg", "Cl", "Ar"],
  },
  {
    question: "What is the atomic mass of carbon?",
    expect: "decline",
    note: "no property trend, no comparison",
  },
  {
    question: "Given below are two statements about the periodic table. Statement I: s block elements are found in pure form in nature. Choose the correct answer.",
    expect: "decline",
    note: "figure absent: no property, no element set",
  },
  {
    question: "The correct order of second ionisation enthalpy of Cr and Mn is",
    expect: "decline",
    note: "only first ionisation enthalpy is tabulated, and the d block is not plotted",
  },
  {
    question: "The correct order of atomic radius of B, Al, Ga, In and Tl is",
    expect: "decline",
    note: "Al and Ga radii differ between tables, a picture would take a side",
  },
];
