/**
 * Whether a chemistry builder read every charge the stem writes.
 *
 * A builder that reads species from the stem reads some charge spellings
 * and not others. For "NO2 -", "O2 2-", "Cu 2+" or "Na +" it reads the
 * formula and drops the spaced sign, so it would draw the neutral species
 * under a question about the ion: a wrong figure. readChargeMarkers (the
 * shared reader in chargeMarker.ts) finds every charge the stem writes; a
 * builder passes the species it read, and draws nothing unless each marker
 * is carried by one of them.
 *
 * Species match a marker by composition and net charge, so a builder that
 * spells the formula another way (CH3COO- read as C2H3O2-) still matches.
 * An attached digit then a sign with no caret (O2-, He2+, S2-, Hg22+) is
 * read two ways by students and by the builders: the last digit as a
 * subscript with unit charge (superoxide O2^-, He2^+) or as the charge
 * (oxide O^2-, Hg2^2+). Either reading the builder made is the token as
 * written, so either one carries the marker. The spaced, sign first and
 * bracketed forms read one way only. A word marker (ion, cation, anion)
 * needs some read species charged with the asked sign.
 *
 * Charges written in words are read here too (readWrittenCharges), because
 * the shared sign reader does not see them: a sign word after a formula
 * ("NO2 minus", "SO3 two minus", "SO3 minus 2", "N2 plus", "NO2 negative"),
 * a charge phrase in the clause that names a formula ("with a negative
 * charge", "with charge -1", "has a charge of 2-"), and a Roman numeral
 * oxidation state on an element ("Cu II", "Cu(II)", "iron (III)"). Each sits
 * next to a species token; nothing here reads a bare word stem wide, so
 * "ionisation energy" or "positive deviation" is no marker. A sign word
 * followed by a formula or a number and a formula is arithmetic or a
 * reaction (BF3 plus NH3), and a numeral followed by an anion name is a
 * compound name (iron(III) chloride), not the charge of a species.
 */
import { readChargeMarkers, type ChargeMarker } from "./chargeMarker";
import { ELEMENTS, elementBySymbol } from "./elements";
import { normalizeChemistryText, parseFormula, splitCharge } from "./formula";

interface ReadCharge { readonly key: string; readonly charge: number }

/** Atom counts of a formula body, independent of the order written. */
function compositionKey(body: string): string | null {
  const parsed = parseFormula(body);
  if (!parsed || parsed.charge !== 0 || parsed.atoms.length === 0) return null;
  const counts = new Map<string, number>();
  for (const atom of parsed.atoms) counts.set(atom.symbol, (counts.get(atom.symbol) ?? 0) + atom.count);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([symbol, count]) => `${symbol}${count}`).join("");
}

function speciesRead(formula: string): ReadCharge | null {
  const text = normalizeChemistryText(formula).replace(/_\(?(\d+)\)?/g, "$1").replace(/\s+/g, "");
  if (!parseFormula(text)) return null;
  const { body, charge } = splitCharge(text);
  const key = compositionKey(body);
  return key === null ? null : { key, charge };
}

/** Every reading of a formula marker as written (see the file comment). */
function markerReadings(marker: ChargeMarker): ReadCharge[] {
  const readings: Array<{ body: string; charge: number }> = [{ body: marker.formula!, charge: marker.charge! }];
  const attached = /^([A-Za-z0-9()[\]]*?[A-Za-z)\]])(\d+)([+-])$/.exec(marker.text);
  if (attached) {
    const [, head, digits, sign] = attached as unknown as [string, string, string, string];
    const unit = sign === "-" ? -1 : 1;
    readings.push({ body: `${head}${digits}`, charge: unit });
    readings.push({ body: `${head}${digits.slice(0, -1)}`, charge: unit * Number(digits.slice(-1)) });
  }
  return readings.flatMap((reading) => {
    const key = compositionKey(reading.body);
    return key === null || reading.charge === 0 ? [] : [{ key, charge: reading.charge }];
  });
}

/** A charge written in words or as a Roman numeral, next to a species token. */
export interface WrittenCharge {
  /** Formula or element symbol it belongs to, or null for a clause phrase. */
  readonly formula: string | null;
  /** Net charge when the words give it, else null (sign only). */
  readonly charge: number | null;
  readonly polarity: -1 | 1;
  readonly text: string;
}

/** Same formula token as the shared reader, behind a lookbehind that also refuses non ASCII letters (ΔH). */
const FORMULA_TOKEN = String.raw`\[[^\]\s]+\]\d*|[A-Z][A-Za-z0-9]*(?:\([A-Z][A-Za-z0-9]*\)[A-Za-z0-9]*)*`;
const COUNT_WORDS: Record<string, number> = { one: 1, single: 1, two: 2, double: 2, three: 3, triple: 3, four: 4 };
const COUNT = String.raw`\d|one|two|three|four`;

/** NO2 minus, SO3 two minus, SO3 minus 2, N2 plus, NO2 negative, NO2 negatively charged. */
const SIGN_WORD = new RegExp(
  String.raw`(?<![\p{L}\p{N}_\])])(${FORMULA_TOKEN})\s+(?:(${COUNT})\s+)?(?i:(minus|plus|negative|positive)(ly\s+charged)?)\b(?:\s+(${COUNT})\b)?`,
  "gu",
);

/** A negatively charged NO2. */
const CHARGED_BEFORE = new RegExp(String.raw`(?i:\b(negative|positive)ly\s+charged)\s+(?:species\s+)?(${FORMULA_TOKEN})(?![\p{L}\p{N}])`, "gu");

/** with a negative charge, carrying a positive charge, with charge -1, has a charge of 2-, with a net charge of +1. */
const CHARGE_PHRASE = new RegExp(
  String.raw`\b(?:with|carrying|having|bearing|has|have)\s+(?:(?:an?|one|two|three|net|overall|total|single|double|unit)\s+)*`
  + String.raw`(?:(negative|positive)\s+charges?\b|charges?\s+(?:of\s+)?\(?\s*(?:([+-])\s*(\d?)|(\d)\s*([+-]))(?![\d.]))`,
  "gi",
);

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };
const ELEMENT_NAMES = new Map(ELEMENTS.map((element) => [element.name.toLowerCase(), element.symbol]));
/** Cu II, Cu(II), Cu (II), copper(II); a bare "I" only in brackets (Cu I is too close to iodine or a pronoun). */
const ROMAN_STATE = /(?<![\p{L}\p{N}])([A-Z][a-z]?|[a-z]{3,})\s*(?:\(\s*(VII|VI|IV|V|I{1,3})\s*\)|\s(VII|VI|IV|V|III|II)\b)/gu;
/** A numeral then an anion or class word names a compound: iron(III) chloride, copper(II) sulphate. */
const COMPOUND_AFTER = /^\s*(?:[a-z]+(?:ide|ate|ite)s?|salts?|compounds?|complex(?:es)?|solution)\b/i;

function countOf(word: string | undefined): number | null {
  if (!word) return null;
  return /^\d$/.test(word) ? Number(word) : COUNT_WORDS[word.toLowerCase()] ?? null;
}

function isFormula(token: string): boolean {
  return Boolean(parseFormula(token)) && /[A-Z]/.test(token);
}

/** Clauses of the text, so a phrase belongs to the formula it is written with. */
function clauses(text: string): Array<{ text: string; at: number }> {
  const out: Array<{ text: string; at: number }> = [];
  let start = 0;
  for (const match of text.matchAll(/[;!?]|\.(?=\s|$)/g)) {
    out.push({ text: text.slice(start, match.index), at: start });
    start = (match.index ?? 0) + match[0].length;
  }
  out.push({ text: text.slice(start), at: start });
  return out;
}

/** Charges the text writes in words or Roman numerals (see the file comment). */
function fold(raw: string): string {
  return normalizeChemistryText(raw).replace(/_\(?(\d+)\)?/g, "$1");
}

export function readWrittenCharges(raw: string): WrittenCharge[] {
  const text = fold(raw);
  const out: WrittenCharge[] = [];
  for (const match of text.matchAll(SIGN_WORD)) {
    const [whole, token, lead, sign, , trail] = match as unknown as [string, string, string | undefined, string, string | undefined, string | undefined];
    if (!isFormula(token) || (lead && trail)) continue;
    const word = sign.toLowerCase();
    const rest = text.slice((match.index ?? 0) + whole.length);
    // BF3 plus NH3, N2 plus 3 H2, NaCl minus Na: a sum or a reaction.
    if ((word === "plus" || word === "minus") && /^\s+(?:\d+\s+)?[A-Z[(]/.test(rest)) continue;
    const polarity = word === "minus" || word === "negative" ? -1 : 1;
    const magnitude = countOf(lead) ?? countOf(trail) ?? 1;
    out.push({ formula: token, charge: polarity * magnitude, polarity, text: whole });
  }
  for (const match of text.matchAll(CHARGED_BEFORE)) {
    const [whole, sign, token] = match as unknown as [string, string, string];
    if (!isFormula(token)) continue;
    const polarity = sign.toLowerCase() === "negative" ? -1 : 1;
    out.push({ formula: token, charge: null, polarity, text: whole });
  }
  for (const clause of clauses(text)) {
    const hasSpecies = [...clause.text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])(${FORMULA_TOKEN})`, "gu"))].some((match) => isFormula(match[1]!));
    if (!hasSpecies) continue;
    for (const match of clause.text.matchAll(CHARGE_PHRASE)) {
      const [whole, word, leadSign, leadDigits, trailDigits, trailSign] = match as unknown as [string, string | undefined, string | undefined, string | undefined, string | undefined, string | undefined];
      const signText = word ? (word.toLowerCase() === "negative" ? "-" : "+") : (leadSign ?? trailSign)!;
      const polarity = signText === "-" ? -1 : 1;
      const digits = leadDigits || trailDigits;
      out.push({ formula: null, charge: digits ? polarity * Number(digits) : null, polarity, text: whole });
    }
  }
  for (const match of text.matchAll(ROMAN_STATE)) {
    const [whole, name, bracketed, spaced] = match as unknown as [string, string, string | undefined, string | undefined];
    const symbol = elementBySymbol(name) ? name : ELEMENT_NAMES.get(name.toLowerCase()) ?? null;
    if (!symbol) continue;
    if (COMPOUND_AFTER.test(text.slice((match.index ?? 0) + whole.length))) continue;
    const charge = ROMAN[(bracketed ?? spaced)!]!;
    out.push({ formula: symbol, charge, polarity: 1, text: whole });
  }
  return out;
}

function writtenChargeCarried(marker: WrittenCharge, species: readonly ReadCharge[]): boolean {
  if (marker.formula === null) {
    return species.some((item) => Math.sign(item.charge) === marker.polarity && (marker.charge === null || item.charge === marker.charge));
  }
  const key = compositionKey(marker.formula);
  return key !== null && species.some((item) => item.key === key && Math.sign(item.charge) === marker.polarity && (marker.charge === null || item.charge === marker.charge));
}

/**
 * Which formula markers bear on the species read. A stem in one clause, or
 * one whose clauses never write a read species as a formula, is read whole:
 * every marker counts. Otherwise a formula marker counts only in a clause
 * that writes a read species ("No He+ or Li2+ participate; draw the Lewis
 * structure of H2O" draws H2O, while "shape of SO3? Compare SO3 2-" still
 * declines SO3). Word markers (ion, cation, anion) always count.
 */
function relevantAt(folded: string, species: readonly ReadCharge[]): (marker: string, from: number) => { relevant: boolean; next: number } {
  const parts = clauses(folded);
  const readKeys = new Set(species.map((item) => item.key));
  const writesRead = parts.map((part) => [...part.text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_\\])])(${FORMULA_TOKEN})`, "gu"))]
    .some((match) => { const read = speciesRead(match[1]!); return read !== null && readKeys.has(read.key); }));
  const scoped = parts.length > 1 && writesRead.some(Boolean);
  return (marker, from) => {
    const at = folded.indexOf(marker, from);
    if (!scoped || at < 0) return { relevant: true, next: at < 0 ? from : at + marker.length };
    const index = parts.findIndex((part, i) => at >= part.at && (i === parts.length - 1 || at < parts[i + 1]!.at));
    return { relevant: index < 0 || writesRead[index]!, next: at + marker.length };
  };
}

/**
 * True when every charge the text writes (signs through the shared reader,
 * words and Roman numerals through readWrittenCharges) is carried by a
 * species the builder read. With no charge written this is true; with one
 * and no species it is false. See relevantAt for stems in several clauses.
 */
export function stemChargesRead(text: string, speciesFormulas: readonly string[]): boolean {
  const markers = readChargeMarkers(text);
  const written = readWrittenCharges(text);
  if (markers.length === 0 && written.length === 0) return true;
  const species = speciesFormulas.map(speciesRead).filter((item): item is ReadCharge => item !== null);
  const relevant = relevantAt(fold(text), species);
  let from = 0;
  const signsCarried = markers.every((marker) => {
    if (marker.formula === null) {
      return species.some((item) => item.charge !== 0 && (marker.polarity === 0 || Math.sign(item.charge) === marker.polarity));
    }
    const place = relevant(marker.text, from);
    from = place.next;
    if (!place.relevant) return true;
    const readings = markerReadings(marker);
    return species.some((item) => readings.some((reading) => reading.key === item.key && reading.charge === item.charge));
  });
  // Written charges come from several readers, not in text order: each is placed from the start.
  return signsCarried && written.every((marker) => {
    if (marker.formula !== null && !relevant(marker.text, 0).relevant) return true;
    return writtenChargeCarried(marker, species);
  });
}

/**
 * The species a builder read, or none when the stem writes a charge none of
 * them carries. For readers whose result is a list that empties to a decline.
 */
export function speciesWithWrittenCharges<T>(text: string, species: readonly T[], formulaOf: (item: T) => string): T[] {
  return stemChargesRead(text, species.map(formulaOf)) ? [...species] : [];
}

/** Board or formula spelling of a monatomic species: Fe^(3+), Cl^(-), Na. */
export function monatomicFormula(symbol: string, charge: number): string {
  if (charge === 0) return symbol;
  return `${symbol}^(${Math.abs(charge) === 1 ? "" : Math.abs(charge)}${charge < 0 ? "-" : "+"})`;
}
