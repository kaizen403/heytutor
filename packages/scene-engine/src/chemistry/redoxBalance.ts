/**
 * Oxidation-number assignment and acidic or basic redox balancing.
 *
 * Cell emf, the Nernst equation, conductance, electrolysis and commercial
 * cells stay with the electrochemical-cell figures. This file does not import
 * that module.
 *
 * An oxidation number is accepted only when the atom-weighted sum equals the
 * formula charge. Peroxide oxygen is -1, superoxide oxygen is -1/2, and
 * hydride hydrogen is -1. Fe3O4 is mixed valence, average +8/3. That sum is
 * not a formal charge.
 *
 * A written net is drawn only after its atoms, ionic charges and
 * oxidation-number electron changes all agree, and only when the medium ions
 * match the stated medium. The acidic permanganate–iron net below is the one
 * smallest-integer balance used when that pair is asked in acid and no net
 * is written. It is checked by the same pass, not by matching the sentence:
 * MnO4- + 5Fe2+ + 8H+ -> Mn2+ + 5Fe3+ + 4H2O.
 */
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, type ChemPlanQuantity } from "./sceneKit";
import { formulaTokens, normalizeChemistryText, parseFormula, type ParsedFormula } from "./formula";
import { ELEMENTS, elementByName, elementBySymbol, isMetal } from "./elements";

const FAMILY = "chem_electrochem" as const;
const COLUMN_X = 0.2;
const COLUMN_Y = 2.6;
const COLUMN_STEP = -0.8;
const COLUMN_MAX = 6;

/** Unique smallest-integer acidic balance of MnO4- with Fe2+. */
const ACIDIC_PERMANGANATE_IRON = "MnO4- + 5Fe2+ + 8H+ -> Mn2+ + 5Fe3+ + 4H2O";

const OUTSIDE = /nernst|emf|e\u00b0|e0 cell|conductance|kohlrausch|faraday|dry cell|accumulator|fuel cell|corrosion|salt bridge|galvanic|electrolys|\u221a|internal resistance/;

interface Q {
  n: number;
  d: number;
}

interface Term {
  coeff: number;
  electrons: number;
  formula: ParsedFormula | null;
}

interface Tally {
  atoms: Map<string, number>;
  charge: number;
  electrons: number;
}

interface BalanceReport {
  leftCharge: number;
  rightCharge: number;
  lost: number;
  gained: number;
  medium: "acidic" | "basic";
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

function q(numerator: number, denominator = 1): Q {
  if (denominator < 0) {
    numerator = -numerator;
    denominator = -denominator;
  }
  if (numerator === 0) return { n: 0, d: 1 };
  const divisor = gcd(numerator, denominator);
  return { n: numerator / divisor, d: denominator / divisor };
}

function addQ(a: Q, b: Q): Q {
  return q(a.n * b.d + b.n * a.d, a.d * b.d);
}

function subQ(a: Q, b: Q): Q {
  return addQ(a, q(-b.n, b.d));
}

function mulQ(value: Q, factor: number): Q {
  return q(value.n * factor, value.d);
}

function divQ(value: Q, count: number): Q | null {
  if (count === 0) return null;
  return q(value.n, value.d * count);
}

function eqQ(a: Q, b: Q): boolean {
  return a.n === b.n && a.d === b.d;
}

function formatOx(value: Q): string {
  if (value.n === 0) return "0";
  const sign = value.n < 0 ? "-" : "+";
  const numerator = Math.abs(value.n);
  return value.d === 1 ? `${sign}${numerator}` : `${sign}${numerator}/${value.d}`;
}

function sumLabel(charge: number): string {
  if (charge === 0) return "sum=0";
  return `sum=${charge > 0 ? "+" : ""}${charge}`;
}

function countOf(parsed: ParsedFormula, symbol: string): number {
  return parsed.atoms.find((atom) => atom.symbol === symbol)?.count ?? 0;
}

function negatedAt(text: string, index: number): boolean {
  const prior = text.slice(Math.max(0, index - 56), index);
  return /\b(?:not|never|no|without|except|forbid|avoid|blind)\b|don't|do not|cannot|can't|isn't|is not/.test(prior);
}

function oxidationCue(stem: string): boolean {
  if (/oxidation\s+(?:number|state)s?/.test(stem)) return true;
  if (/oxid(?:ation|n)\.?\s*no\b/.test(stem)) return true;
  if (/mixed valence/.test(stem) && /oxid|fe3o4/.test(stem)) return true;
  return /(?:superoxide|hydride|peroxide)/.test(stem) && /oxid|assign|h2o2|ko2|\bnah\b|fe3o4/.test(stem);
}

function balanceCue(stem: string): boolean {
  const medium = /\bacidic\b|\bacidified\b|\bbasic\b|\balkaline\b|acid medium|basic medium/.test(stem);
  const task = /\bbalanc|half[ -]reaction|ion[ -]electron|\bredox\b/.test(stem);
  if (task && medium) return true;
  return task && /mno4|permanganate|cr2o7|dichromate/.test(stem);
}

/** True when this chapter should own the stem, including honest declines. */
export function claimsRedoxBalance(question: string): boolean {
  const stem = chemStem(question);
  if (OUTSIDE.test(stem)) return false;
  return oxidationCue(stem) || balanceCue(stem);
}

/**
 * Atom-weighted sum of the assigned oxidation numbers.
 * The assignment is kept only when this equals the formula charge.
 */
function oxidationTotal(parsed: ParsedFormula, oxidation: ReadonlyMap<string, Q>): Q | null {
  let total = q(0);
  for (const atom of parsed.atoms) {
    const value = oxidation.get(atom.symbol);
    if (!value) return null;
    total = addQ(total, mulQ(value, atom.count));
  }
  return total;
}

function sumsToCharge(parsed: ParsedFormula, oxidation: ReadonlyMap<string, Q>): boolean {
  const total = oxidationTotal(parsed, oxidation);
  return total !== null && eqQ(total, q(parsed.charge));
}

function knownSum(parsed: ParsedFormula, oxidation: ReadonlyMap<string, Q>): Q | null {
  let total = q(0);
  for (const atom of parsed.atoms) {
    const value = oxidation.get(atom.symbol);
    if (!value) continue;
    total = addQ(total, mulQ(value, atom.count));
  }
  return total;
}

function assignOxidationNumbers(parsed: ParsedFormula): Map<string, Q> | null {
  if (parsed.atoms.length === 1) {
    const atom = parsed.atoms[0];
    if (!atom || atom.count === 0) return null;
    const oxidation = new Map<string, Q>([[atom.symbol, q(parsed.charge, atom.count)]]);
    return sumsToCharge(parsed, oxidation) ? oxidation : null;
  }

  const oxidation = new Map<string, Q>();
  for (const atom of parsed.atoms) {
    if (atom.symbol === "F") oxidation.set("F", q(-1));
    else if (atom.element.group === 1 && atom.symbol !== "H") oxidation.set(atom.symbol, q(1));
    else if (atom.element.group === 2) oxidation.set(atom.symbol, q(2));
  }

  if (countOf(parsed, "H") > 0) {
    const others = parsed.atoms.filter((atom) => atom.symbol !== "H");
    const hydride = others.length > 0 && others.every((atom) => isMetal(atom.element));
    oxidation.set("H", hydride ? q(-1) : q(1));
  }

  const oxygen = parsed.atoms.find((atom) => atom.symbol === "O");
  const unresolvedBesideOxygen = parsed.atoms.filter((atom) => atom.symbol !== "O" && !oxidation.has(atom.symbol));
  if (oxygen && unresolvedBesideOxygen.length === 0) {
    const fixed = knownSum(parsed, oxidation);
    if (!fixed) return null;
    const value = divQ(subQ(q(parsed.charge), fixed), oxygen.count);
    if (!value) return null;
    oxidation.set("O", value);
    return sumsToCharge(parsed, oxidation) ? oxidation : null;
  }

  if (oxygen) oxidation.set("O", q(-2));
  const unresolved = parsed.atoms.filter((atom) => !oxidation.has(atom.symbol));
  if (unresolved.length > 1) return null;
  if (unresolved.length === 1) {
    const target = unresolved[0];
    if (!target) return null;
    const fixed = knownSum(parsed, oxidation);
    if (!fixed) return null;
    const value = divQ(subQ(q(parsed.charge), fixed), target.count);
    if (!value) return null;
    oxidation.set(target.symbol, value);
  }
  return sumsToCharge(parsed, oxidation) ? oxidation : null;
}

function parseSigned(raw: string): Q | null {
  const match = /^([+-]?)(\d+)(?:\/(\d+))?$/.exec(raw);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const denominator = match[3] ? Number(match[3]) : 1;
  if (!(denominator > 0)) return null;
  return q(sign * Number(match[2]), denominator);
}

const ELEMENT_NAMES = [...ELEMENTS.map((element) => element.name.toLowerCase()), "sulfur", "aluminum", "cesium"]
  .sort((a, b) => b.length - a.length)
  .join("|");
const ELEMENT_NAME_PATTERN = new RegExp(
  `\\b(${ELEMENT_NAMES})\\b(?:\\s+\\w+){0,3}?\\s*(?:=|is|as|equals|at)\\s*([+-]?\\d+(?:\\/\\d+)?)`,
  "g",
);
const ELEMENT_NAME_TOKEN = new RegExp(`\\b(${ELEMENT_NAMES})\\b`, "g");

function symbolsNamedIn(text: string): string[] {
  const symbols: string[] = [];
  for (const match of text.matchAll(ELEMENT_NAME_TOKEN)) {
    const element = elementByName(match[1] ?? "");
    if (element && !symbols.includes(element.symbol)) symbols.push(element.symbol);
  }
  return symbols;
}

function readStated(question: string, stem: string): Map<string, Q> | null {
  const stated = new Map<string, Q>();
  const put = (symbol: string, value: Q, index: number, text: string): boolean => {
    if (negatedAt(text, index)) return true;
    const existing = stated.get(symbol);
    if (existing && !eqQ(existing, value)) return false;
    stated.set(symbol, value);
    return true;
  };

  for (const match of stem.matchAll(ELEMENT_NAME_PATTERN)) {
    const value = parseSigned(match[2] ?? "");
    if (!value) continue;
    for (const symbol of symbolsNamedIn(match[0] ?? "")) {
      if (!put(symbol, value, match.index ?? 0, stem)) return null;
    }
  }

  const symbols = /(?:^|[^A-Za-z])([A-Z][a-z]?)\s*=\s*([+-]?\d+(?:\/\d+)?)/g;
  const cased = normalizeChemistryText(question);
  for (const match of cased.matchAll(symbols)) {
    const element = elementBySymbol(match[1] ?? "");
    const value = parseSigned(match[2] ?? "");
    if (!element || !value) continue;
    const at = (match.index ?? 0) + match[0].indexOf(match[1] ?? "");
    if (!put(element.symbol, value, at, cased)) return null;
  }

  const lowerSymbols = /(?:^|[^a-z])([a-z]{1,2})\s*=\s*([+-]?\d+(?:\/\d+)?)/g;
  for (const match of stem.matchAll(lowerSymbols)) {
    const token = match[1] ?? "";
    const symbol = token.length === 1 ? token.toUpperCase() : token[0]!.toUpperCase() + token.slice(1).toLowerCase();
    const element = elementBySymbol(symbol);
    const value = parseSigned(match[2] ?? "");
    if (!element || !value) continue;
    const at = (match.index ?? 0) + match[0].indexOf(token);
    if (!put(element.symbol, value, at, stem)) return null;
  }
  return stated;
}

function blanketValue(stem: string): Q | null {
  const match = /(?:every|each|all|both)\s+atoms?\b[^.]{0,40}?(?:are|is|=|as|equal)\s*([+-]?\d+(?:\/\d+)?)/.exec(stem);
  if (!match || negatedAt(stem, match.index)) return null;
  return parseSigned(match[1] ?? "");
}

function statedTotalContradicts(stem: string, charge: number): boolean {
  const match = /(?:algebraic\s+)?sum(?:\s+of\s+(?:the\s+)?oxidation\s+numbers)?[^.]{0,24}(?:=|is|equals)\s*([+-]?\d+)/.exec(stem);
  if (!match || negatedAt(stem, match.index)) return false;
  return Number(match[1]) !== charge;
}

function statedBreaksFixedRule(parsed: ParsedFormula, stated: ReadonlyMap<string, Q>): boolean {
  for (const atom of parsed.atoms) {
    const value = stated.get(atom.symbol);
    if (!value) continue;
    if (atom.symbol === "H" && !eqQ(value, q(1)) && !eqQ(value, q(-1))) return true;
    if (atom.symbol === "F" && !eqQ(value, q(-1))) return true;
    if (atom.element.group === 1 && atom.symbol !== "H" && !eqQ(value, q(1))) return true;
    if (atom.element.group === 2 && !eqQ(value, q(2))) return true;
  }
  return false;
}

function isHydrogenPeroxide(parsed: ParsedFormula): boolean {
  return parsed.charge === 0 && parsed.atoms.length === 2 && countOf(parsed, "H") === 2 && countOf(parsed, "O") === 2;
}

function assertsPeroxideOxygenMinusTwo(stem: string): boolean {
  for (const sentence of stem.split(/[.;]/)) {
    if (!/h2o2|hydrogen peroxide/.test(sentence)) continue;
    const pattern = /(?:oxygen|\bo\b)[^.]{0,80}?(?:=|is|as|equals|at)\s*-2\b/g;
    for (const match of sentence.matchAll(pattern)) {
      if (!negatedAt(sentence, match.index ?? 0)) return true;
    }
  }
  return false;
}

function forbidsBlindOxygenMinusTwo(stem: string): boolean {
  if (!/h2o2|hydrogen peroxide|peroxide/.test(stem)) return false;
  if (/blind|forbid/.test(stem)) return true;
  if (/not\s+o\s*=\s*-2|o\s*!=\s*-2/.test(stem)) return true;
  if (/(?:do not|don't|never|not|isn't|is not|cannot)[^.]{0,48}-2/.test(stem)) return true;
  return /instead of -2|rather than -2|except(?:ion)?[^.]{0,24}-2/.test(stem);
}

function compositionKey(parsed: ParsedFormula): string {
  const atoms = [...parsed.atoms]
    .map((atom) => `${atom.symbol}${atom.count}`)
    .sort()
    .join(",");
  return `${atoms}|${parsed.charge}`;
}

function namedFormula(stem: string): ParsedFormula | null {
  const named: Array<[RegExp, string]> = [
    [/hydrogen peroxide|\bh2o2\b/, "H2O2"],
    [/potassium superoxide|\bko2\b/, "KO2"],
    [/sodium hydride|\bnah\b/, "NaH"],
    [/\bfe3o4\b|magnetite/, "Fe3O4"],
    [/sulphuric acid|sulfuric acid|\bh2so4\b/, "H2SO4"],
  ];
  for (const [pattern, formula] of named) {
    if (pattern.test(stem)) return parseFormula(formula);
  }
  return null;
}

function collectTargets(question: string, stem: string): ParsedFormula[] {
  const targets: ParsedFormula[] = [];
  const seen = new Set<string>();
  const add = (formula: ParsedFormula | null): void => {
    if (!formula) return;
    const key = compositionKey(formula);
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(formula);
  };
  for (const token of formulaTokens(normalizeChemistryText(question))) add(parseFormula(token));
  if (targets.length === 0) add(namedFormula(stem));
  return targets;
}

function primaryTarget(targets: readonly ParsedFormula[], stem: string): ParsedFormula | null {
  if (targets.length === 1) return targets[0] ?? null;
  for (const target of targets) {
    const body = target.atoms.map((atom) => `${atom.symbol}${atom.count > 1 ? atom.count : ""}`).join("").toLowerCase();
    if (new RegExp(`(?:\\bin\\b|\\bof\\b)\\s+${body}\\b`).test(stem)) return target;
  }
  return null;
}

function applyStated(parsed: ParsedFormula, base: ReadonlyMap<string, Q>, stated: ReadonlyMap<string, Q>): Map<string, Q> | null {
  const oxidation = new Map(base);
  for (const atom of parsed.atoms) {
    const forced = stated.get(atom.symbol);
    if (forced) oxidation.set(atom.symbol, forced);
  }
  return sumsToCharge(parsed, oxidation) ? oxidation : null;
}

function completeStatedMissesCharge(parsed: ParsedFormula, stated: ReadonlyMap<string, Q>): boolean {
  if (!parsed.atoms.every((atom) => stated.has(atom.symbol))) return false;
  const oxidation = new Map<string, Q>();
  for (const atom of parsed.atoms) {
    const value = stated.get(atom.symbol);
    if (!value) return false;
    oxidation.set(atom.symbol, value);
  }
  return !sumsToCharge(parsed, oxidation);
}

function peroxideOxygenForcedMinusTwo(parsed: ParsedFormula, stated: ReadonlyMap<string, Q>): boolean {
  if (!isHydrogenPeroxide(parsed)) return false;
  const oxygen = stated.get("O");
  return oxygen !== undefined && eqQ(oxygen, q(-2));
}

function askedSymbol(stem: string): string | null {
  const match = /oxidation\s+(?:number|state)\s+of\s+([a-z]+)/.exec(stem);
  if (!match) return null;
  const word = match[1] ?? "";
  const named = elementByName(word);
  if (named) return named.symbol;
  const symbol = word.length === 1 ? word.toUpperCase() : word[0]!.toUpperCase() + word.slice(1).toLowerCase();
  return elementBySymbol(symbol)?.symbol ?? null;
}

function withinLabel(text: string): boolean {
  return text.length > 0 && text.length <= 16;
}

function hydrogenPeroxideLabels(parsed: ParsedFormula, oxidation: ReadonlyMap<string, Q>, stem: string): string[] | null {
  if (!isHydrogenPeroxide(parsed)) return null;
  const oxygen = oxidation.get("O");
  const hydrogen = oxidation.get("H");
  if (!oxygen || !hydrogen || !eqQ(oxygen, q(-1)) || !eqQ(hydrogen, q(1))) return null;
  const labels = [`O=${formatOx(oxygen)}`, `H=${formatOx(hydrogen)}`, sumLabel(parsed.charge)];
  if (forbidsBlindOxygenMinusTwo(stem)) labels.push("not O=-2");
  return labels;
}

function superoxideLabels(parsed: ParsedFormula, oxidation: ReadonlyMap<string, Q>): string[] | null {
  const oxygen = oxidation.get("O");
  if (!oxygen || !eqQ(oxygen, q(-1, 2)) || parsed.atoms.length !== 2) return null;
  const metal = parsed.atoms.find((atom) => atom.symbol !== "O");
  const metalOx = metal ? oxidation.get(metal.symbol) : undefined;
  if (!metal || !metalOx || metal.element.group !== 1) return null;
  return [`O=${formatOx(oxygen)}`, `${metal.symbol}=${formatOx(metalOx)}`, sumLabel(parsed.charge)];
}

function hydrideLabels(parsed: ParsedFormula, oxidation: ReadonlyMap<string, Q>): string[] | null {
  const hydrogen = oxidation.get("H");
  if (!hydrogen || !eqQ(hydrogen, q(-1))) return null;
  const others = parsed.atoms.filter((atom) => atom.symbol !== "H");
  const metal = others[0];
  if (others.length !== 1 || !metal || !isMetal(metal.element)) return null;
  const metalOx = oxidation.get(metal.symbol);
  if (!metalOx) return null;
  return [`H=${formatOx(hydrogen)}`, `${metal.symbol}=${formatOx(metalOx)}`, "hydride"];
}

function mixedOxideLabels(parsed: ParsedFormula, oxidation: ReadonlyMap<string, Q>): string[] | null {
  if (parsed.charge !== 0 || parsed.atoms.length !== 2 || countOf(parsed, "O") === 0) return null;
  const metal = parsed.atoms.find((atom) => atom.symbol !== "O");
  const value = metal ? oxidation.get(metal.symbol) : undefined;
  if (!metal || !value || value.d === 1) return null;
  return [`${metal.symbol}=${formatOx(value)}`, "mixed", sumLabel(parsed.charge)];
}

function sulfuricLabels(parsed: ParsedFormula, oxidation: ReadonlyMap<string, Q>): string[] | null {
  if (parsed.charge !== 0 || parsed.atoms.length !== 3) return null;
  if (countOf(parsed, "H") !== 2 || countOf(parsed, "S") !== 1 || countOf(parsed, "O") !== 4) return null;
  const sulfur = oxidation.get("S");
  if (!sulfur || !eqQ(sulfur, q(6))) return null;
  return [`S=${formatOx(sulfur)}`, sumLabel(parsed.charge), "not formal"];
}

function genericLabels(parsed: ParsedFormula, oxidation: ReadonlyMap<string, Q>, stem: string): string[] | null {
  const asked = askedSymbol(stem);
  const symbols = parsed.atoms.map((atom) => atom.symbol);
  const ordered = asked && symbols.includes(asked) ? [asked, ...symbols.filter((symbol) => symbol !== asked)] : symbols;
  const labels: string[] = [];
  for (const symbol of ordered) {
    const value = oxidation.get(symbol);
    if (!value) return null;
    labels.push(`${symbol}=${formatOx(value)}`);
  }
  labels.push(sumLabel(parsed.charge));
  if (/formal/.test(stem) && !labels.includes("not formal")) labels.push("not formal");
  return labels.every(withinLabel) && labels.length <= COLUMN_MAX ? labels : null;
}

function oxidationLabels(parsed: ParsedFormula, oxidation: ReadonlyMap<string, Q>, stem: string): string[] | null {
  return hydrogenPeroxideLabels(parsed, oxidation, stem)
    ?? superoxideLabels(parsed, oxidation)
    ?? hydrideLabels(parsed, oxidation)
    ?? mixedOxideLabels(parsed, oxidation)
    ?? sulfuricLabels(parsed, oxidation)
    ?? genericLabels(parsed, oxidation, stem);
}

function oxidationCaption(parsed: ParsedFormula, oxidation: ReadonlyMap<string, Q>): string {
  const total = oxidationTotal(parsed, oxidation);
  const pieces = parsed.atoms.map((atom) => {
    const value = oxidation.get(atom.symbol);
    return `${atom.count}*(${value ? formatOx(value) : "?"})`;
  });
  const shown = total ? formatOx(total) : "?";
  return `Assigned oxidation numbers times atom counts give ${pieces.join(" + ")} = ${shown}. That total equals the formula charge ${parsed.charge}. Peroxide oxygen is -1 and superoxide oxygen is -1/2, not -2. Hydride hydrogen is -1. A fractional metal value is a mixed-valence average. Oxidation number is not formal charge.`;
}

function hasIon(stem: string, symbol: string, charge: number): boolean {
  const sign = charge < 0 ? "-" : "\\+";
  const magnitude = Math.abs(charge);
  const bare = magnitude === 1 ? `${symbol}${sign}` : `${symbol}${magnitude}${sign}`;
  const script = magnitude === 1 ? `${symbol}\\^\\(${sign}\\)` : `${symbol}\\^\\(${magnitude}${sign}\\)`;
  const caret = magnitude === 1 ? `${symbol}\\^${sign}` : `${symbol}\\^${magnitude}${sign}`;
  return new RegExp(`${bare}|${script}|${caret}`).test(stem);
}

function mentionsHydroxide(stem: string): boolean {
  return /hydroxide|oh\s*(?:\^\(-\)|\^-|-)/.test(stem);
}

function keepsAcidProductsInBase(stem: string): boolean {
  if (!/\bbasic\b|\balkaline\b/.test(stem)) return false;
  return hasIon(stem, "mn", 2) && hasIon(stem, "fe", 3);
}

function hydroxideForAcidicBalance(stem: string): boolean {
  if (!mentionsHydroxide(stem)) return false;
  if (/(?:do not|don't|never|without|not)\s+(?:add(?:ing)?\s+)?(?:oh\b|hydroxide)/.test(stem)) return false;
  const acidic = /\bacidic\b|\bacidified\b|\bacid medium\b/.test(stem);
  const asks = /add(?:ing)?[^.]{0,40}(?:oh|hydroxide)|(?:oh(?:\s*-|\^\(-\))|hydroxide)[^.]{0,30}medium|medium ion/.test(stem);
  return acidic && asks;
}

function declaredMedium(stem: string): "acidic" | "basic" | "both" | "none" {
  const acidic = /\bacidic\b|\bacidified\b|\bacid medium\b|\bin acid\b/.test(stem);
  const basic = /\bbasic\b|\balkaline\b|\bbasic medium\b|\bin base\b|\bin alkali\b/.test(stem);
  if (acidic && basic) return "both";
  if (acidic) return "acidic";
  if (basic) return "basic";
  return "none";
}

function isPermanganateIronPair(stem: string): boolean {
  const permanganate = /mno4|permanganate/.test(stem);
  const ironTwo = hasIon(stem, "fe", 2) || /ferrous|iron\(ii\)|fe\(ii\)/.test(stem);
  return permanganate && ironTwo && !/mno2|mn\(iv\)|manganese dioxide/.test(stem);
}

function electronLength(text: string): number | null {
  const match = /^e(?:\^\(-\)|\^-|-)/i.exec(text);
  if (!match) return null;
  const after = text[match[0].length];
  if (after !== undefined && !/[\s+]/.test(after)) return null;
  return match[0].length;
}

function readCoefficient(text: string): { coeff: number; length: number } | null {
  const match = /^(\d+)\s*/.exec(text);
  if (!match) return null;
  const next = text[match[0].length];
  if (!next || !/[A-Za-z([]/.test(next)) return null;
  const coeff = Number(match[1]);
  if (!Number.isInteger(coeff) || coeff < 1) return null;
  return { coeff, length: match[0].length };
}

function recaseFormula(token: string): string | null {
  let out = "";
  let i = 0;
  while (i < token.length) {
    const ch = token[i]!;
    if (!/[a-z]/i.test(ch)) {
      out += ch;
      i += 1;
      continue;
    }
    const next = token[i + 1];
    if (next && /[a-z]/i.test(next)) {
      const titled = `${ch.toUpperCase()}${next.toLowerCase()}`;
      if (elementBySymbol(titled)) {
        out += titled;
        i += 2;
        continue;
      }
    }
    const one = ch.toUpperCase();
    if (!elementBySymbol(one)) return null;
    out += one;
    i += 1;
  }
  return out;
}

function parseSpecies(token: string): ParsedFormula | null {
  const direct = parseFormula(token);
  if (direct) return direct;
  const recased = recaseFormula(token);
  if (!recased || recased === token) return null;
  return parseFormula(recased);
}

function readSpecies(text: string): { token: string; length: number } | null {
  const strict = /^(\[?(?:[A-Z][a-z]?\d*|\((?:[A-Z][a-z]?\d*)+\)\d*)+\]?(?:\^?\(?\d*[+-]\)?)?)/.exec(text);
  if (strict?.[1] && parseSpecies(strict[1])) return { token: strict[1], length: strict[1].length };
  const loose = /^(\[?(?:[A-Za-z]{1,2}\d*|\((?:[A-Za-z]{1,2}\d*)+\)\d*)+\]?(?:\^?\(?\d*[+-]\)?)?)/.exec(text);
  if (loose?.[1] && parseSpecies(loose[1])) return { token: loose[1], length: loose[1].length };
  return null;
}

function parseTerms(side: string): Term[] | null {
  const terms: Term[] = [];
  const text = side.trim();
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /[\s+]/.test(text[i]!)) i += 1;
    if (i >= text.length) break;
    let coeff = 1;
    const leading = readCoefficient(text.slice(i));
    if (leading) {
      coeff = leading.coeff;
      i += leading.length;
    }
    const electrons = electronLength(text.slice(i));
    if (electrons !== null) {
      terms.push({ coeff, electrons: coeff, formula: null });
      i += electrons;
      continue;
    }
    const species = readSpecies(text.slice(i));
    if (!species) return null;
    const formula = parseSpecies(species.token);
    if (!formula) return null;
    terms.push({ coeff, electrons: 0, formula });
    i += species.length;
    const rest = text[i];
    if (rest !== undefined && !/[\s+]/.test(rest)) return null;
  }
  return terms.length > 0 ? terms : null;
}

function isolateEquation(span: string): string | null {
  const cleaned = span.replace(/^.*\bnet(?:\s+ionic)?(?:\s+equation)?\s+is\s+/i, "").trim();
  const parts = cleaned.split(/\s*->\s*/);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return `${parts[0].trim()} -> ${parts[1].trim()}`;
}

function writtenEquation(question: string): string | null | undefined {
  const normalized = normalizeChemistryText(question).replace(/=>/g, " -> ");
  if (!normalized.includes("->")) return null;
  const labeled = /(?:the\s+)?net(?:\s+ionic)?(?:\s+equation)?\s+is\s+([^.]*)/i.exec(normalized);
  if (labeled?.[1]?.includes("->")) return isolateEquation(labeled[1]) ?? undefined;
  if ((normalized.split("->").length - 1) !== 1) return undefined;
  const sentence = normalized.split(/[.]/).find((part) => part.includes("->"));
  if (!sentence) return undefined;
  return isolateEquation(sentence) ?? undefined;
}

function tally(terms: readonly Term[]): Tally | null {
  const atoms = new Map<string, number>();
  let charge = 0;
  let electrons = 0;
  for (const term of terms) {
    if (term.electrons > 0) {
      electrons += term.electrons;
      continue;
    }
    if (!term.formula || term.coeff < 1) return null;
    charge += term.coeff * term.formula.charge;
    for (const atom of term.formula.atoms) {
      atoms.set(atom.symbol, (atoms.get(atom.symbol) ?? 0) + term.coeff * atom.count);
    }
  }
  return { atoms, charge, electrons };
}

function sameAtoms(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): boolean {
  const symbols = new Set([...left.keys(), ...right.keys()]);
  for (const symbol of symbols) {
    if ((left.get(symbol) ?? 0) !== (right.get(symbol) ?? 0)) return false;
  }
  return true;
}

function elementOxidationTotal(terms: readonly Term[], symbol: string): Q | null {
  let total = q(0);
  for (const term of terms) {
    if (!term.formula) continue;
    const count = countOf(term.formula, symbol);
    if (count === 0) continue;
    const oxidation = assignOxidationNumbers(term.formula);
    const value = oxidation?.get(symbol);
    if (!oxidation || !value || !sumsToCharge(term.formula, oxidation)) return null;
    total = addQ(total, mulQ(value, count * term.coeff));
  }
  return total;
}

function electronTransfer(left: readonly Term[], right: readonly Term[]): { lost: number; gained: number } | null {
  const symbols = new Set<string>();
  for (const term of [...left, ...right]) {
    if (!term.formula) continue;
    for (const atom of term.formula.atoms) symbols.add(atom.symbol);
  }
  let lost = q(0);
  let gained = q(0);
  for (const symbol of symbols) {
    const before = elementOxidationTotal(left, symbol);
    const after = elementOxidationTotal(right, symbol);
    if (!before || !after) return null;
    const delta = subQ(after, before);
    if (delta.n > 0) lost = addQ(lost, delta);
    else if (delta.n < 0) gained = addQ(gained, q(-delta.n, delta.d));
  }
  if (lost.d !== 1 || gained.d !== 1 || lost.n !== gained.n || lost.n <= 0) return null;
  return { lost: lost.n, gained: gained.n };
}

function termKind(term: Term): "proton" | "hydroxide" | "other" {
  const formula = term.formula;
  if (!formula || term.electrons > 0) return "other";
  if (formula.atoms.length === 1 && formula.atoms[0]?.symbol === "H" && formula.charge === 1) return "proton";
  if (countOf(formula, "O") === 1 && countOf(formula, "H") === 1 && formula.atoms.length === 2 && formula.charge === -1) return "hydroxide";
  return "other";
}

function mediumAgrees(terms: readonly Term[], medium: "acidic" | "basic"): boolean {
  const kinds = terms.map(termKind);
  const proton = kinds.includes("proton");
  const hydroxide = kinds.includes("hydroxide");
  if (proton && hydroxide) return false;
  if (medium === "acidic" && hydroxide) return false;
  if (medium === "basic" && proton) return false;
  return true;
}

function verifyEquation(text: string, medium: "acidic" | "basic"): BalanceReport | null {
  const parts = text.split(/\s*->\s*/);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const leftTerms = parseTerms(parts[0]);
  const rightTerms = parseTerms(parts[1]);
  if (!leftTerms || !rightTerms) return null;
  const left = tally(leftTerms);
  const right = tally(rightTerms);
  if (!left || !right) return null;
  if (left.electrons !== 0 || right.electrons !== 0) return null;
  if (!sameAtoms(left.atoms, right.atoms)) return null;
  if (left.charge !== right.charge) return null;
  const transfer = electronTransfer(leftTerms, rightTerms);
  if (!transfer) return null;
  if (!mediumAgrees([...leftTerms, ...rightTerms], medium)) return null;
  return {
    leftCharge: left.charge,
    rightCharge: right.charge,
    lost: transfer.lost,
    gained: transfer.gained,
    medium,
  };
}

function balanceCaption(report: BalanceReport): string {
  return `Atom counts agree. Ionic charge is ${report.leftCharge} on the left and ${report.rightCharge} on the right. Oxidation-number changes transfer ${report.lost} electrons one way and ${report.gained} the other, so the electrons cancel. The medium is ${report.medium}, and the medium ions match it.`;
}

function balanceLabels(report: BalanceReport): string[] {
  return ["e cancel", report.medium, "charge ok", "atoms ok"];
}

function column(question: string, reason: string, labels: readonly string[], caption: string): SceneDocument | null {
  if (labels.length === 0 || labels.length > COLUMN_MAX) return null;
  if (!labels.every(withinLabel)) return null;
  const scene = new ChemScene(question, reason, FAMILY);
  const ids = labels.map((label, index) =>
    scene.text(`line_${index}`, { x: COLUMN_X, y: COLUMN_Y + index * COLUMN_STEP }, label, "redox line"),
  );
  scene.scene.group("redox", ids, reason);
  return scene.build({ caption });
}

function withBlanket(parsed: ParsedFormula, stated: Map<string, Q>, stem: string): Map<string, Q> | null {
  const blanket = blanketValue(stem);
  if (!blanket) return stated;
  const next = new Map(stated);
  for (const atom of parsed.atoms) {
    const existing = next.get(atom.symbol);
    if (existing && !eqQ(existing, blanket)) return null;
    next.set(atom.symbol, blanket);
  }
  return next;
}

function buildOxidation(question: string, stem: string): SceneDocument | null {
  if (assertsPeroxideOxygenMinusTwo(stem)) return null;
  const target = primaryTarget(collectTargets(question, stem), stem);
  if (!target) return null;
  const stated = readStated(question, stem);
  if (!stated) return null;
  const forced = withBlanket(target, stated, stem);
  if (!forced) return null;
  if (statedTotalContradicts(stem, target.charge)) return null;
  if (completeStatedMissesCharge(target, forced)) return null;
  if (peroxideOxygenForcedMinusTwo(target, forced)) return null;
  if (statedBreaksFixedRule(target, forced)) return null;
  const base = assignOxidationNumbers(target);
  if (!base || !sumsToCharge(target, base)) return null;
  const oxidation = applyStated(target, base, forced);
  if (!oxidation || !sumsToCharge(target, oxidation)) return null;
  const labels = oxidationLabels(target, oxidation, stem);
  if (!labels) return null;
  return column(question, "oxidation numbers checked against the formula charge", labels, oxidationCaption(target, oxidation));
}

function buildBalance(question: string, stem: string): SceneDocument | null {
  if (keepsAcidProductsInBase(stem) || hydroxideForAcidicBalance(stem)) return null;
  const medium = declaredMedium(stem);
  if (medium === "both") return null;
  const written = writtenEquation(question);
  if (written === undefined) return null;
  if (written) {
    const resolved = medium === "none" ? null : medium;
    if (!resolved) return null;
    const report = verifyEquation(written, resolved);
    if (!report) return null;
    return column(question, "balanced redox equation", balanceLabels(report), balanceCaption(report));
  }
  if (medium === "acidic" && /\bbalanc/.test(stem) && isPermanganateIronPair(stem)) {
    const report = verifyEquation(ACIDIC_PERMANGANATE_IRON, "acidic");
    if (!report || report.leftCharge !== report.rightCharge || report.lost !== report.gained) return null;
    return column(question, "acidic redox balance of permanganate and iron(II)", balanceLabels(report), balanceCaption(report));
  }
  return null;
}

/** The figure, or null when the stem is claimed but not grounded. */
export function buildRedoxBalanceScene(
  question: string,
  quantities: ChemPlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  void quantities;
  void schematic;
  const stem = chemStem(question);
  if (!claimsRedoxBalance(question)) return null;
  if (balanceCue(stem)) return buildBalance(question, stem);
  if (oxidationCue(stem)) return buildOxidation(question, stem);
  return null;
}
