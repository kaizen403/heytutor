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
  /** Where it starts in the folded text, so each occurrence is judged on its own. */
  readonly at: number;
  /**
   * For a charge phrase, its owner as written: each reading of the owner's
   * own attached charge (O2- is O2^- or O^2-), or the bare formula with no
   * charge. The phrase must agree with one of them, and that reading must be
   * read; a bare owner ("O2 with charge -1") was read neutral, so it declines.
   */
  readonly owner?: ReadonlyArray<{ readonly body: string; readonly charge: number }>;
  /** Where the owner formula of a charge phrase starts in the folded text. */
  readonly ownerAt?: number;
}

/** Same formula token as the shared reader, behind a lookbehind that also refuses non ASCII letters (ΔH). */
const FORMULA_TOKEN = String.raw`\[[^\]\s]+\]\d*|[A-Z][A-Za-z0-9]*(?:\([A-Z][A-Za-z0-9]*\)[A-Za-z0-9]*)*`;
const COUNT_WORDS: Record<string, number> = { one: 1, single: 1, two: 2, double: 2, three: 3, triple: 3, four: 4 };
const COUNT = String.raw`\d|one|two|three|four`;

/**
 * A word in any letter case, one character class per letter ([Mm][Ii]...).
 * Never an inline case modifier group: V8 gave one a different answer
 * once it compiled the regex to native code, so a cold process and a warm
 * one read the same stem differently (the charged species gate fails on any
 * inline modifier group in scene-engine src).
 */
function anyCase(word: string): string {
  return [...word].map((letter) => `[${letter.toUpperCase()}${letter.toLowerCase()}]`).join("");
}
const SIGN_WORDS = ["minus", "plus", "negative", "positive"].map(anyCase).join("|");
const LY_CHARGED = String.raw`${anyCase("ly")}\s+${anyCase("charged")}`;

/** NO2 minus, SO3 two minus, SO3 minus 2, N2 plus, NO2 negative, NO2 negatively charged. */
const SIGN_WORD = new RegExp(
  String.raw`(?<![\p{L}\p{N}_\])])(${FORMULA_TOKEN})\s+(?:(${COUNT})\s+)?(${SIGN_WORDS})(${LY_CHARGED})?\b(?:\s+(${COUNT})\b)?`,
  "gu",
);

/** A negatively charged NO2. */
const CHARGED_BEFORE = new RegExp(
  String.raw`\b(${anyCase("negative")}|${anyCase("positive")})${LY_CHARGED}\s+(?:species\s+)?(${FORMULA_TOKEN})(?![\p{L}\p{N}])`,
  "gu",
);

/** with a negative charge, carrying a positive charge, with charge -1, has a charge of 2-, with a net charge of +1. */
const CHARGE_PHRASE = new RegExp(
  String.raw`\b(?:with|carrying|having|bearing|has|have)\s+((?:(?:an?|one|two|three|four|net|overall|total|single|double|triple|unit)\s+)*)`
  + String.raw`(?:(negative|positive)\s+charges?\b|charges?\s+(?:of\s+)?\(?\s*(?:([+-])\s*(\d?)|(\d)\s*([+-]))(?![\d.]))`,
  "gi",
);

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };
const ELEMENT_NAMES = new Map(ELEMENTS.map((element) => [element.name.toLowerCase(), element.symbol]));
/** Cu II, Cu(II), Cu (II), copper(II); a bare "I" only in brackets (Cu I is too close to iodine or a pronoun). */
const ROMAN_STATE = /(?<![\p{L}\p{N}])([A-Z][a-z]?|[a-z]{3,})\s*(?:\(\s*(VII|VI|IV|V|I{1,3})\s*\)|\s(VII|VI|IV|V|III|II)\b)/gu;
/**
 * A numeral then an anion or class word names a compound: iron(III) chloride,
 * copper(II) sulphate. Lower case after the first letter, so a formula that
 * follows (written with capitals inside it) is never read as the word and
 * never sets the oxidation state aside.
 */
const COMPOUND_AFTER = /^\s*(?:[A-Za-z][a-z]*(?:ide|ate|ite)s?|[Ss]alts?|[Cc]ompounds?|[Cc]omplex(?:es)?|[Ss]olution)\b/;

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
    out.push({ formula: token, charge: polarity * magnitude, polarity, text: whole, at: match.index ?? 0 });
  }
  for (const match of text.matchAll(CHARGED_BEFORE)) {
    const [whole, sign, token] = match as unknown as [string, string, string];
    if (!isFormula(token)) continue;
    const polarity = sign.toLowerCase() === "negative" ? -1 : 1;
    out.push({ formula: token, charge: null, polarity, text: whole, at: match.index ?? 0 });
  }
  // A charge phrase belongs to the formula it is written with: the nearest
  // one before it in the clause, else the first after. "MO diagram of N2-.
  // Draw O2 with charge -1" asks for O2^-, which N2^- does not satisfy, and
  // "O2- with a double negative charge" asks for O2^2-, not superoxide.
  for (const clause of clauses(text)) {
    const formulas = [...clause.text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_\\])])(${FORMULA_TOKEN})`, "gu"))]
      .filter((match) => isFormula(match[1]!))
      .map((match) => {
        // The owner keeps its attached charge (Cu2+ is copper, not Cu2). A digit
        // then a bare sign reads both ways (O2- is O2^- or O^2-).
        const token = match[1]!;
        const end = (match.index ?? 0) + token.length;
        const suffix = /^\^?\(?\d*[+-]\)?/.exec(clause.text.slice(end))?.[0] ?? "";
        const readings = [suffix ? splitCharge(`${token}${suffix}`) : { body: token, charge: 0 }];
        if (/^[+-]$/.test(suffix) && readings[0]!.body !== token) readings.push({ body: token, charge: suffix === "-" ? -1 : 1 });
        return { readings, at: match.index ?? 0 };
      });
    if (formulas.length === 0) continue;
    for (const match of clause.text.matchAll(CHARGE_PHRASE)) {
      const [whole, modifiers, word, leadSign, leadDigits, trailDigits, trailSign] = match as unknown as [string, string, string | undefined, string | undefined, string | undefined, string | undefined, string | undefined];
      const at = match.index ?? 0;
      const owner = [...formulas].reverse().find((item) => item.at < at) ?? formulas.find((item) => item.at > at)!;
      const signText = word ? (word.toLowerCase() === "negative" ? "-" : "+") : (leadSign ?? trailSign)!;
      const polarity = signText === "-" ? -1 : 1;
      const counted = modifiers.toLowerCase().split(/\s+/).map((item) => COUNT_WORDS[item] ?? (item === "unit" ? 1 : null)).find((item) => item != null) ?? null;
      const digits = leadDigits || trailDigits;
      const magnitude = digits ? Number(digits) : counted;
      // "with a charge of -2" and "two negative charges" give the size; "a negative charge" gives only the sign.
      out.push({ formula: owner.readings[0]!.body, owner: owner.readings, ownerAt: clause.at + owner.at, charge: magnitude ? polarity * magnitude : null, polarity, text: whole, at: clause.at + at });
    }
  }
  for (const match of text.matchAll(ROMAN_STATE)) {
    const [whole, name, bracketed, spaced] = match as unknown as [string, string, string | undefined, string | undefined];
    const symbol = elementBySymbol(name) ? name : ELEMENT_NAMES.get(name.toLowerCase()) ?? null;
    if (!symbol) continue;
    if (COMPOUND_AFTER.test(text.slice((match.index ?? 0) + whole.length))) continue;
    const charge = ROMAN[(bracketed ?? spaced)!]!;
    out.push({ formula: symbol, charge, polarity: 1, text: whole, at: match.index ?? 0 });
  }
  return out;
}

function writtenChargeCarried(marker: WrittenCharge, species: readonly ReadCharge[]): boolean {
  if (marker.formula === null) {
    return species.some((item) => Math.sign(item.charge) === marker.polarity && (marker.charge === null || item.charge === marker.charge));
  }
  if (marker.owner) {
    // Only the owner's own readings that agree with the phrase count; another
    // occurrence of the formula cannot stand in for this one.
    const agreeing = marker.owner.filter((reading) => Math.sign(reading.charge) === marker.polarity && (marker.charge === null || reading.charge === marker.charge));
    return agreeing.some((reading) => {
      const key = compositionKey(reading.body);
      return key !== null && species.some((item) => item.key === key && item.charge === reading.charge);
    });
  }
  const key = compositionKey(marker.formula);
  return key !== null && species.some((item) => item.key === key && Math.sign(item.charge) === marker.polarity && (marker.charge === null || item.charge === marker.charge));
}

/**
 * A negator that governs a list of formulas: "No He+ or Li2+", "not NO2 -",
 * "without Cu 2+ and Zn 2+". The words are matched case sensitively: lower
 * case anywhere, or with only the first letter capital at the start of the
 * clause. A case blind match read the formula NO ("NO with a charge of +1")
 * as the word "no", set its charge aside, and drew neutral NO. Capitals
 * (NO, NOT, NOR) and No (nobelium) inside a clause are never read as a
 * negator, so a doubtful negator keeps the charge and the figure declines.
 */
const NEGATOR = String.raw`(?:\b(?:no|not|without|excluding|except|nor|neither)|^\s*(?:No|Not|Without|Excluding|Except|Nor|Neither))`;
const EXCLUDED_LIST = new RegExp(
  String.raw`${NEGATOR}\s+(?:(?:the|any)\s+)?(?:(?:${FORMULA_TOKEN})[^\s,]*(?:\s+\d?[+-])?\s*(?:,|\bor\b|\band\b|\bnor\b)\s*)*$`,
  "u",
);

/**
 * Whether a formula marker bears on the species read. Only positive
 * evidence that the stem excludes the charged formula sets it aside: a
 * negator governing the list the marker stands in ("No He+ or Li2+
 * participate; draw the Lewis structure of H2O" draws H2O, "the Lewis
 * structure of NO2, not NO2 -" draws NO2). Every other marker counts,
 * wherever it stands: a second clause that asks for or compares an ion
 * ("2s orbital of He+. Compare with H.") still declines.
 */
function excludedAt(folded: string): (at: number) => boolean {
  const parts = clauses(folded);
  return (at) => {
    const part = parts.find((item, i) => at >= item.at && (i === parts.length - 1 || at < parts[i + 1]!.at)) ?? { text: folded, at: 0 };
    return EXCLUDED_LIST.test(folded.slice(part.at, at));
  };
}

/**
 * True when every charge the text writes (signs through the shared reader,
 * words and Roman numerals through readWrittenCharges) is carried by a
 * species the builder read. With no charge written this is true; with one
 * and no species it is false. See excludedAt for an excluded formula.
 */
export function stemChargesRead(text: string, speciesFormulas: readonly string[]): boolean {
  const markers = readChargeMarkers(text);
  const written = readWrittenCharges(text);
  if (markers.length === 0 && written.length === 0) return true;
  const species = speciesFormulas.map(speciesRead).filter((item): item is ReadCharge => item !== null);
  const folded = fold(text);
  const excluded = excludedAt(folded);
  let from = 0;
  const signsCarried = markers.every((marker) => {
    if (marker.formula === null) {
      return species.some((item) => item.charge !== 0 && (marker.polarity === 0 || Math.sign(item.charge) === marker.polarity));
    }
    // The shared reader gives no positions; its markers come in text order, so each is found after the last.
    const at = folded.indexOf(marker.text, from);
    if (at >= 0) from = at + marker.text.length;
    if (at >= 0 && excluded(at)) return true;
    const readings = markerReadings(marker);
    return species.some((item) => readings.some((reading) => reading.key === item.key && reading.charge === item.charge));
  });
  return signsCarried && written.every((marker) => {
    if (marker.formula !== null && excluded(marker.at)) return true;
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

/** A formula then the word ion, anion or cation: "the CO3 ion", "NO2 anion". */
const ION_WORD_AFTER = new RegExp(String.raw`(?<![\p{L}\p{N}_\])])(${FORMULA_TOKEN})\s+(cation|anion|ion)s?\b`, "gu");

const MAX_CHARGE_READINGS = 27;

function withCaretCharge(body: string, charge: number): string {
  return `${body}^(${Math.abs(charge) === 1 ? "" : Math.abs(charge)}${charge < 0 ? "-" : "+"})`;
}

/**
 * Routing only: the stem with each charge it writes attached to its formula
 * in caret notation ("Shape of CO3 2-" becomes "Shape of CO3^(2-)", "NH4
 * plus" becomes "NH4^(+)", "CO3 with a charge of -2" puts ^(2-) on CO3). A
 * reader that resolves no species from the bare bodies (NH4 and CO3 are no
 * molecules) can then tell that the stem asks about a real ion, so the stem
 * stays in the chemistry lane. A charge with no size ("a negative charge",
 * "the CO3 ion") gives one reading per size 1 to 3, and "ion" both signs.
 * Empty when the stem writes no charge on a formula, so a stem without a
 * charge is never read differently. Never feed these to a figure: the
 * figure reads the stem as written and declines a charge it did not read.
 */
export function chargeAttachedReadings(raw: string): string[] {
  const text = fold(raw);
  const edits: Array<{ start: number; end: number; body: string; charges: number[] }> = [];
  const sized = (polarity: number) => [1, 2, 3].map((size) => polarity * size);
  let from = 0;
  for (const marker of readChargeMarkers(raw)) {
    if (marker.formula === null || marker.charge === null) continue;
    const at = text.indexOf(marker.text, from);
    if (at < 0) continue;
    from = at + marker.text.length;
    edits.push({ start: at, end: at + marker.text.length, body: marker.formula, charges: [marker.charge] });
  }
  for (const marker of readWrittenCharges(raw)) {
    if (marker.formula === null) continue;
    const charges = marker.charge !== null ? [marker.charge] : sized(marker.polarity);
    if (marker.owner) {
      // A phrase puts its charge on its owner, only when the owner is written bare.
      if (marker.ownerAt === undefined || marker.owner[0]!.charge !== 0) continue;
      edits.push({ start: marker.ownerAt, end: marker.ownerAt + marker.formula.length, body: marker.formula, charges });
    } else if (text.startsWith(marker.formula, marker.at)) {
      edits.push({ start: marker.at, end: marker.at + marker.text.length, body: marker.formula, charges });
    } else {
      // "negatively charged NO2": the formula ends the marker.
      const start = marker.at + marker.text.length - marker.formula.length;
      if (text.startsWith(marker.formula, start)) edits.push({ start, end: start + marker.formula.length, body: marker.formula, charges });
    }
  }
  for (const match of text.matchAll(ION_WORD_AFTER)) {
    const token = match[1]!;
    if (!isFormula(token) || splitCharge(token).charge !== 0) continue;
    const word = match[2]!;
    const charges = word === "cation" ? sized(1) : word === "anion" ? sized(-1) : [...sized(-1), ...sized(1)];
    const start = match.index ?? 0;
    edits.push({ start, end: start + token.length, body: token, charges });
  }
  if (edits.length === 0) return [];
  edits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = edits.filter((edit, i) => !edits.slice(0, i).some((other) => edit.start < other.end && edit.end > other.start));
  let readings: string[][] = [[]];
  for (const edit of kept) {
    readings = readings.flatMap((picked) => edit.charges.map((charge) => [...picked, withCaretCharge(edit.body, charge)])).slice(0, MAX_CHARGE_READINGS);
  }
  return readings.map((picked) => {
    let out = "";
    let cursor = 0;
    kept.forEach((edit, i) => {
      out += `${text.slice(cursor, edit.start)}${picked[i]}`;
      cursor = edit.end;
    });
    return out + text.slice(cursor);
  });
}

/** Board or formula spelling of a monatomic species: Fe^(3+), Cl^(-), Na. */
export function monatomicFormula(symbol: string, charge: number): string {
  if (charge === 0) return symbol;
  return `${symbol}^(${Math.abs(charge) === 1 ? "" : Math.abs(charge)}${charge < 0 ? "-" : "+"})`;
}
