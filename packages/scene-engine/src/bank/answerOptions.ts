/**
 * Answer-option oracle for the question bank: parse the multiple-choice
 * options that thousands of bank stems carry inline, so a computed answer can
 * be checked against the stated choices without an LLM.
 *
 * WHY: every gate in this repo measures whether a DIAGRAM is right; nothing
 * measures whether an ANSWER is right. Options embedded in the stem are a free
 * correctness oracle: a computed answer that is not among the stated options
 * means a bad parse, a bad solve, or bad units.
 *
 * FAIL-CLOSED CONTRACT — a wrong oracle is worse than no oracle:
 * - `parseAnswerOptions` returns kind "none" whenever the option block cannot
 *   be read confidently: fewer than three labelled options, labels missing or
 *   out of order (a lost label folds its value into a neighbour, which would
 *   make a correct answer report "no_match"), stray numbers between an
 *   "Options :" marker and its first database id, digit labels that look like
 *   function application (`g(1) = 2`), lower-case (a)/(b)/(c) runs that are
 *   CBSE question sub-parts rather than choices, and dotted or bare-letter
 *   label styles (`A.`, `1.`) that collide with decimals and enumerations.
 * - A row that carries several labelled runs (a bilingual Hindi duplicate, or
 *   the next printed question glued onto this stem) is only trusted when every
 *   run the oracle could use agrees on its values — bilingual duplicates
 *   repeat the same numbers, so runs that disagree mean the row mixes two
 *   different questions' options, and no run can be trusted: kind "none".
 * - An option whose text is not one single clean quantity keeps value null;
 *   the parser never guesses which of several numbers is "the" value, and a
 *   mantissa with an OCR-destroyed exponent (`1.5 x 10+ N`) is null, not 1.5.
 * - `checkAnswerAgainstOptions` reports "unusable" instead of guessing when
 *   fewer than two options carry numeric values. "match" requires the answer
 *   to sit within tolerance of exactly ONE option value; zero hits or several
 *   hits — including two options printed with the SAME value, which in this
 *   corpus is usually a lost minus sign ("– 10" scanned as "10") or an
 *   OCR-merged pair — return "no_match", never a confident "match".
 *
 * Formats recognised (all real corpus shapes):
 *   "Options : 4058593807. 12 4058593808. 18 ..."    long db ids delimit values
 *   "Options : T 9561772055. 4 T 9561772056. 3 ..."  same, glyph noise on ids
 *   "(A) 1  (B) 2  (C) log e 3  (D) 4"               paren letters, >= (A)(B)(C)
 *   "(a) ... (b) ... (c) ... (d) ..."                lower case needs a full a-d run
 *   "(1) 2.5 m/s (2) 5 m/s (3) 7.5 m/s (4) 10 m/s"   digits need a full 1-4 run
 * The long numeric ids are database keys, not answers; they are stripped and
 * the options relabelled positionally "1".."n". OCR label variants that keep
 * the block whole are accepted in sequence: "®)" for (B), "©" for (C), "@)"
 * for (D). Values understand fractions (3/2, unicode vulgar fractions),
 * scientific notation (2 x 10^4, 2 x 10-3, 10 with unicode superscripts),
 * middle-dot decimals (0·60), unicode minus signs, spaced minus signs
 * ("– 10" is minus ten — CBSE prints negatives that way, so a leading dash is
 * label decoration only when no digit follows it), and a short trailing unit
 * (m/s, %, °C — kept verbatim, never converted; matching ignores units).
 *
 * kind "numeric" flags stems that declare a numerical/integer answer and carry
 * no options (options: []); kind "mcq" carries the parsed options.
 *
 * Dependency-free on purpose: no imports, safe to call from any script.
 */

export interface ParsedOption {
  /** "A".."D", "a".."d", "1".."4"; positional "1".."n" for id-delimited blocks. */
  label: string;
  /** The option's raw text with the label / database id stripped. */
  text: string;
  /** Parsed numeric value, or null when the text is not one clean quantity. */
  value: number | null;
  /** Verbatim trailing unit token(s), e.g. "m/s", "%", "°C"; informational only. */
  unit: string | null;
}

export interface ParsedOptions {
  kind: "mcq" | "numeric" | "none";
  options: ParsedOption[];
}

export type AnswerCheck = "match" | "no_match" | "unusable";

const MAX_OPTION_TEXT = 160;
const LAST_OPTION_CAP = 200;

export function parseAnswerOptions(questionText: string): ParsedOptions {
  if (typeof questionText !== "string" || questionText.trim().length === 0) {
    return { kind: "none", options: [] };
  }
  const flat = questionText.replace(/\s+/g, " ").trim();

  const idBlock = parseIdDelimitedBlock(flat);
  if (idBlock) return { kind: "mcq", options: idBlock };

  const labelled = parseLabelledRun(flat);
  if (labelled) return { kind: "mcq", options: labelled };

  if (NUMERIC_ANSWER_RE.test(flat)) return { kind: "numeric", options: [] };
  return { kind: "none", options: [] };
}

export function checkAnswerAgainstOptions(
  answer: number,
  options: ParsedOptions,
  opts?: { relativeTolerance?: number },
): AnswerCheck {
  const toleranceRaw = opts?.relativeTolerance;
  const tolerance =
    typeof toleranceRaw === "number" && Number.isFinite(toleranceRaw) && toleranceRaw > 0
      ? toleranceRaw
      : 1e-3;
  if (!Number.isFinite(answer)) return "unusable";

  const values: number[] = [];
  for (const option of options.options) {
    if (typeof option.value === "number" && Number.isFinite(option.value)) {
      values.push(option.value);
    }
  }
  // Fewer than two numeric options cannot discriminate a right answer from a
  // wrong one that happens to land near the single stated value.
  if (options.kind !== "mcq" || values.length < 2) return "unusable";

  // Collapse duplicate values (bilingual stems repeat every option) so that
  // "(A) 1 (B) 1" counts as one distinct value, not an ambiguous pair.
  const distinct: number[] = [];
  for (const value of [...values].sort((a, b) => a - b)) {
    const last = distinct.length > 0 ? distinct[distinct.length - 1] : undefined;
    if (last === undefined || !withinTolerance(last, value, tolerance)) distinct.push(value);
  }

  let hits = 0;
  for (const value of distinct) {
    if (withinTolerance(answer, value, tolerance)) hits += 1;
  }
  // Exactly one distinct value must match; zero or several (options closer
  // together than the tolerance can resolve) both fail closed to "no_match".
  return hits === 1 ? "match" : "no_match";
}

function withinTolerance(a: number, b: number, relativeTolerance: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale < 1e-12) return true;
  return Math.abs(a - b) <= relativeTolerance * scale;
}

// --------------------------------------------------------------------------
// Format 1: "Options :" followed by long sequential database ids.
// --------------------------------------------------------------------------

const OPTIONS_MARKER_RE = /options?\s*[:;]/gi;

function parseIdDelimitedBlock(flat: string): ParsedOption[] | null {
  const markers: number[] = [];
  OPTIONS_MARKER_RE.lastIndex = 0;
  for (let m = OPTIONS_MARKER_RE.exec(flat); m; m = OPTIONS_MARKER_RE.exec(flat)) {
    markers.push(m.index + m[0].length);
  }
  for (let i = markers.length - 1; i >= 0; i -= 1) {
    const parsed = parseIdBlockTail(flat.slice(markers[i] ?? 0));
    if (parsed) return parsed;
  }
  return null;
}

interface IdSpan {
  start: number;
  end: number;
}

function parseIdBlockTail(tail: string): ParsedOption[] | null {
  const spans: IdSpan[] = [];
  const digits = /\d{9,13}/g;
  for (let m = digits.exec(tail); m; m = digits.exec(tail)) {
    const before = m.index > 0 ? tail[m.index - 1] ?? "" : "";
    const after = tail[m.index + m[0].length] ?? "";
    if (/[0-9A-Za-z.]/.test(before) || /[0-9]/.test(after)) continue;
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  if (spans.length < 3 || spans.length > 6) return null;

  // Database ids in one block are sequential keys: same width, tiny range.
  // Anything else (a value glued onto an id, an unrelated long number) makes
  // the block untrustworthy, so fail closed.
  const widths = new Set(spans.map((s) => s.end - s.start));
  if (widths.size !== 1) return null;
  const numbers = spans.map((s) => Number(tail.slice(s.start, s.end)));
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min > 100000) return null;

  // Between the marker and the first id there must be nothing but an optional
  // short OCR glyph (a radio-button scanned as "T"). A number there means the
  // block structure is compromised (labels interleaved into the values).
  const firstSpan = spans[0];
  if (!firstSpan) return null;
  const pre = tail.slice(0, firstSpan.start).trim();
  if (/\d/.test(pre) || pre.length > 2) return null;
  const glyph = pre.length > 0 ? pre : null;

  const options: ParsedOption[] = [];
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    if (!span) return null;
    const next = spans[i + 1];
    let raw = next
      ? tail.slice(span.end, next.start)
      : tail.slice(span.end, span.end + LAST_OPTION_CAP);
    raw = raw.replace(/^\s*[.,:]\s*/, "").trim();
    if (glyph) {
      // Strip the same glyph where it precedes the next id ("4 T" -> "4").
      const tailGlyph = new RegExp("\\s" + escapeRegExp(glyph) + "$");
      raw = raw.replace(tailGlyph, "").trim();
    }
    const finished = next
      ? { text: raw, ...parseQuantity(raw) }
      : finishLastOption(raw);
    options.push({ label: String(i + 1), text: finished.text, value: finished.value, unit: finished.unit });
  }
  return options;
}

/**
 * The last option of a block has no following label to bound it, so exam-paper
 * trailer text (instructions, paper codes, the next printed section) bleeds
 * into it. Cut at the first known trailer marker; if the remainder still
 * refuses to parse, drop one trailing page-fraction token ("... 8/10") that
 * print layout glues onto the value. Never parse a mere prefix otherwise.
 */
const TRAILER_RE =
  /\s(?:General Instructions|Questions?\s+(?:number|paper)|Question\s*[:.]|Directions\b|SECTION\s*[-–—]?\s*[A-E]\b|Assertion\s*[-–—(:]|JEE\s*\(|NEET\b|\d{1,3}\/[A-Z0-9]{1,3}\/\d{1,3}\b|Page\s+\d)/i;

function finishLastOption(raw: string): { text: string; value: number | null; unit: string | null } {
  let text = raw;
  const trailer = TRAILER_RE.exec(text);
  if (trailer) text = text.slice(0, trailer.index).trim();
  const quantity = parseQuantity(text);
  if (quantity.value !== null) return { text, value: quantity.value, unit: quantity.unit };
  const stripped = text.replace(/\s\d{1,2}\/\d{1,3}\s*$/, "").trim();
  if (stripped !== text && stripped.length > 0) {
    const retry = parseQuantity(stripped);
    if (retry.value !== null) return { text, value: retry.value, unit: retry.unit };
  }
  const leading = parseLeadingQuantity(text);
  return { text, value: leading.value, unit: leading.unit };
}

// --------------------------------------------------------------------------
// Format 2: parenthesised label runs — (A)(B)(C)(D), (a)..(d), (1)..(4).
// --------------------------------------------------------------------------

interface LabelMatch {
  index: number; // 0-based position in the label family
  canonical: string;
  start: number;
  end: number;
}

interface FamilyRule {
  scan: (flat: string) => LabelMatch[];
  minRun: number;
}

const FAMILIES: FamilyRule[] = [
  { scan: (flat) => scanUpper(flat), minRun: 3 },
  // Lower-case (a)/(b)/(c) are CBSE question sub-parts far more often than
  // options; only a complete a-d run is trusted. Same for digit labels, which
  // collide with function application.
  { scan: (flat) => scanSimple(flat, "abcd"), minRun: 4 },
  { scan: (flat) => scanSimple(flat, "1234"), minRun: 4 },
];

function parseLabelledRun(flat: string): ParsedOption[] | null {
  let best: { options: ParsedOption[]; numeric: number; start: number } | null = null;
  for (const family of FAMILIES) {
    const matches = family.scan(flat);
    for (const run of extractRuns(matches, family.minRun)) {
      const options = optionsFromRun(flat, run, matches);
      if (!options) continue;
      const numeric = options.filter((o) => o.value !== null).length;
      const start = run[0]?.start ?? 0;
      // Bilingual stems duplicate the block; prefer the run whose values
      // parse (usually the English one), tie-break on the later block.
      if (!best || numeric > best.numeric || (numeric === best.numeric && start > best.start)) {
        best = { options, numeric, start };
      }
    }
  }
  return best ? best.options : null;
}

function scanUpper(flat: string): LabelMatch[] {
  // (A)..(D) plus common OCR shapes of the circled labels: ® for (B), © for
  // (C), @) for (D). Alternates only count when they slot into an ascending
  // run, which extractRuns enforces.
  const re = /\(\s*([A-D])\s*\)|(®)\)?|(©)\)?|@\)/g;
  const matches: LabelMatch[] = [];
  for (let m = re.exec(flat); m; m = re.exec(flat)) {
    const before = m.index > 0 ? flat[m.index - 1] ?? "" : "";
    if (/[0-9A-Za-z)\]}|]/.test(before)) continue;
    let index: number;
    if (m[1]) index = m[1].charCodeAt(0) - "A".charCodeAt(0);
    else if (m[2]) index = 1;
    else if (m[3]) index = 2;
    else index = 3;
    const canonical = String.fromCharCode("A".charCodeAt(0) + index);
    matches.push({ index, canonical, start: m.index, end: m.index + m[0].length });
  }
  return matches;
}

function scanSimple(flat: string, alphabet: string): LabelMatch[] {
  const re = new RegExp("\\(\\s*([" + alphabet + "])\\s*\\)", "g");
  const matches: LabelMatch[] = [];
  for (let m = re.exec(flat); m; m = re.exec(flat)) {
    const before = m.index > 0 ? flat[m.index - 1] ?? "" : "";
    // `g(1)`, `y (2)` are function application, not labels; also reject a
    // label glued to an identifier or a closing bracket.
    if (/[0-9A-Za-z)\]}|]/.test(before)) continue;
    const label = m[1] ?? "";
    const index = alphabet.indexOf(label);
    if (index < 0) continue;
    matches.push({ index, canonical: label, start: m.index, end: m.index + m[0].length });
  }
  return matches;
}

/**
 * Split label matches into contiguous ascending runs that start at the first
 * label of the family. Gaps are not bridged: a missing label folds its option
 * into a neighbour and would silently drop a value from the oracle.
 */
function extractRuns(matches: LabelMatch[], minRun: number): LabelMatch[][] {
  const runs: LabelMatch[][] = [];
  let current: LabelMatch[] = [];
  for (const match of matches) {
    const last = current[current.length - 1];
    if (
      last &&
      match.index === last.index + 1 &&
      match.start - last.end <= MAX_OPTION_TEXT
    ) {
      current.push(match);
      continue;
    }
    if (current.length >= minRun) runs.push(current);
    current = match.index === 0 ? [match] : [];
  }
  if (current.length >= minRun) runs.push(current);
  return runs;
}

function optionsFromRun(
  flat: string,
  run: LabelMatch[],
  allMatches: LabelMatch[],
): ParsedOption[] | null {
  const options: ParsedOption[] = [];
  for (let i = 0; i < run.length; i += 1) {
    const label = run[i];
    if (!label) return null;
    // The option text ends at the next label occurrence anywhere in the
    // family scan (the next run's first label also terminates the last text).
    const next = allMatches.find((m) => m.start > label.start);
    const cap = i === run.length - 1 ? LAST_OPTION_CAP : MAX_OPTION_TEXT;
    const end = Math.min(next ? next.start : flat.length, label.end + cap);
    let raw = flat.slice(label.end, end).trim();
    raw = raw.replace(/^[:=.\-–—]\s*/, "").trim();
    // The final option is label-bounded only when the next label sits inside
    // the cap; a label far away belongs to another block, and the slice was
    // capped mid-bleed, so route it through the trailer-aware parse.
    const bounded = next !== undefined && next.start <= label.end + cap;
    const finished = i === run.length - 1 && !bounded
      ? finishLastOption(raw)
      : { text: raw, ...parseQuantity(raw) };
    options.push({ label: label.canonical, text: finished.text, value: finished.value, unit: finished.unit });
  }
  return options.length >= 3 ? options : null;
}

// --------------------------------------------------------------------------
// Numerical-answer stems (no options by design).
// --------------------------------------------------------------------------

const NUMERIC_ANSWER_RE =
  /answer\s+is\s+a\s+non[\s-]?negative\s+integer|nearest\s+integer|answer\s+is\s+an?\s+integer|integer\s+value\s+of|correct\s+(?:up\s+)?to\s+(?:two|three|2|3)\s+decimal\s+places?/i;

// --------------------------------------------------------------------------
// Quantity parsing: the whole option text must be one clean quantity.
// --------------------------------------------------------------------------

const VULGAR_FRACTIONS: Record<string, string> = {
  "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4",
  "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5", "⅙": "1/6",
  "⅚": "5/6", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
};

const SUPERSCRIPTS: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁻": "-", "⁺": "+",
};

const QUANTITY_RE = new RegExp(
  "^[~≈]?\\s*" +
    // mantissa: comma-grouped integer, decimal, or bare fraction numerator
    "(-?(?:\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?|\\.\\d+))" +
    // optional fraction denominator
    "(?:\\s*/\\s*(\\d+(?:\\.\\d+)?))?" +
    // optional power of ten: x 10^4, x 10**4, x 10-3 (attached sign only —
    // a spaced or missing exponent is OCR damage and must fail the match)
    "(?:\\s*[x×*]\\s*10(?:\\s*(?:\\^|\\*\\*)\\s*([+-]?\\d{1,3})|([+-]\\d{1,3})))?" +
    // optional short unit tail, kept verbatim
    "(?:\\s*([%°]|[A-Za-zµΩ°%][A-Za-z0-9µΩ°%^/\\-]{0,11}(?:[\\s/·][A-Za-zµΩ°][A-Za-z0-9µΩ°^\\-]{0,5}){0,2}))?" +
    "\\s*$",
);

/**
 * Units that make a numeric option value trustworthy. This is a whitelist on
 * purpose: a stray trailing letter is far more often an algebra symbol than a
 * unit ("36a" is 36*a, "180q" is 180*q, "2mg" is a force in terms of m and g),
 * and accepting it would hand the oracle a wrong value. Symbol-colliding
 * bases (g, mg, h, L, F, H, G, S, R, E...) are deliberately absent; their
 * options parse as value null instead of a misleading number. Bases may carry
 * an exponent suffix (m2, s-1, ms-2).
 */
const UNIT_BASES = new Set([
  "%", "°", "°C", "°F",
  "m", "s", "kg", "km", "cm", "mm", "nm", "µm", "um", "dm", "mL",
  "mol", "rad", "deg", "min", "hr", "day", "yr",
  "cal", "kcal", "erg", "amu",
  "eV", "keV", "MeV", "GeV",
  "N", "J", "W", "V", "C", "K", "T", "A", "D",
  "kN", "kJ", "MJ", "kW", "MW", "kV", "MV",
  "mA", "µA", "uA", "nA", "mC", "µC", "uC", "pC", "nC",
  "mF", "µF", "uF", "pF", "nF", "mH", "µH", "uH",
  "Wb", "Hz", "kHz", "MHz", "GHz", "Pa", "kPa", "MPa", "atm", "bar", "torr", "mmHg",
  "ohm", "Ω", "kΩ", "MΩ", "dB", "Å", "ms", "µs", "us", "ns", "ps",
  "newton", "joule", "watt", "volt", "ampere", "coulomb", "farad", "henry",
  "tesla", "gauss", "weber", "hertz", "pascal", "kelvin",
  "metre", "meter", "second", "gram", "litre", "liter", "dioptre", "diopter",
  "times", "fold", "rev", "rpm",
]);

function isRecognisedUnit(unit: string): boolean {
  const parts = unit.split(/[\s/·]+/).filter((part) => part.length > 0);
  if (parts.length === 0 || parts.length > 3) return false;
  for (const part of parts) {
    const base = part.replace(/\^?[+-]?\d{1,3}$/, "");
    if (base.length === 0 || !UNIT_BASES.has(base)) return false;
  }
  return true;
}

function normalizeQuantityText(rawText: string): string {
  let text = rawText;
  // Unicode minus / dashes to ASCII minus; middle-dot decimals; fractions.
  text = text.replace(/[−–—]/g, "-");
  text = text.replace(/(\d)\s*·\s*(\d)/g, "$1.$2");
  text = text.replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (ch) => " " + (VULGAR_FRACTIONS[ch] ?? ch) + " ");
  text = text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (run) => {
    let out = "^";
    for (const ch of run) out += SUPERSCRIPTS[ch] ?? "";
    return out;
  });
  // Normalise caret spacing so "10 ^ 4" and a converted superscript ("10^4")
  // read the same to the grammar.
  text = text.replace(/10\s*\^\s*(?=[+-]?\d)/g, "10^");
  return text.replace(/\s+/g, " ").trim();
}

/** Compute a value from the shared grammar groups: mantissa, denominator, caret exponent, attached exponent. */
function computeValue(
  mantissaRaw: string | undefined,
  denominatorRaw: string | undefined,
  caretExponentRaw: string | undefined,
  attachedExponentRaw: string | undefined,
): number | null {
  const mantissaText = (mantissaRaw ?? "").replace(/,/g, "");
  let value = Number.parseFloat(mantissaText);
  if (!Number.isFinite(value)) return null;
  if (denominatorRaw !== undefined) {
    const denominator = Number.parseFloat(denominatorRaw);
    if (!Number.isFinite(denominator) || denominator === 0) return null;
    value /= denominator;
  }
  const exponentText = caretExponentRaw ?? attachedExponentRaw;
  if (exponentText !== undefined) {
    const exponent = Number.parseInt(exponentText, 10);
    if (!Number.isFinite(exponent)) return null;
    value *= Math.pow(10, exponent);
  }
  return Number.isFinite(value) ? value : null;
}

function parseQuantity(rawText: string): { value: number | null; unit: string | null } {
  if (rawText.length === 0 || rawText.length > 80) return { value: null, unit: null };
  let text = normalizeQuantityText(rawText);
  text = text.replace(/[.,;:!?'"”’]+$/g, "").trim();
  // A standalone power of ten ("10^4", "10^-3 m") has no leading mantissa.
  const standalone = /^[~≈]?\s*10\^([+-]?\d{1,3})(?:\s+([%°]|[A-Za-zµΩ°%][A-Za-z0-9µΩ°%^\/\-]{0,11}))?\s*$/.exec(text);
  if (standalone) {
    const exponent = Number.parseInt(standalone[1] ?? "", 10);
    if (!Number.isFinite(exponent)) return { value: null, unit: null };
    const bareUnit = (standalone[2] ?? "").trim();
    if (bareUnit.length > 0 && !isRecognisedUnit(bareUnit)) return { value: null, unit: null };
    return { value: Math.pow(10, exponent), unit: bareUnit.length > 0 ? bareUnit : null };
  }
  const m = QUANTITY_RE.exec(text);
  if (!m) return { value: null, unit: null };
  const value = computeValue(m[1], m[2], m[3], m[4]);
  if (value === null) return { value: null, unit: null };
  const unit = (m[5] ?? "").trim();
  if (unit.length === 0) return { value, unit: null };
  // An unrecognised trailing token is treated as algebra, not a unit; the
  // whole option is then not one clean quantity, so fail closed to null.
  if (!isRecognisedUnit(unit)) return { value: null, unit: null };
  return { value, unit };
}

// Leading-quantity grammar for the final option of a block, where the text
// after the value is usually the next printed question, not option content.
const LEAD_RE = new RegExp(
  "^[~≈]?\\s*" +
    "(-?(?:\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?|\\.\\d+))" +
    "(?:\\s*/\\s*(\\d+(?:\\.\\d+)?))?" +
    "(?:\\s*[x×*]\\s*10(?:\\^([+-]?\\d{1,3})|([+-]\\d{1,3})))?",
);

/** Words that mean the number was only a coefficient ("2 log 3", "2 root 3"). */
const MATH_WORD_RE = /^(?:log|ln|sin|cos|tan|sec|cot|cosec|csc|exp|sqrt|root|mod)$/i;

/**
 * Parse a quantity at the START of the final option, accepting it only when
 * what follows cannot plausibly extend the quantity:
 * - a digit-led or operator-led tail rejects (stacked-fraction debris "3 3 4",
 *   an OCR-lost exponent "x 10", a product "2 √3", a range dash);
 * - a 1-2 letter tail token rejects unless it is a whitelisted unit ("180 q"
 *   is algebra, "5 m" is metres);
 * - a longer alpha token is prose from the next question and accepts, unless
 *   it is a math function word ("2 log 3" stays null).
 */
function parseLeadingQuantity(rawText: string): { value: number | null; unit: string | null } {
  if (rawText.length === 0) return { value: null, unit: null };
  const text = normalizeQuantityText(rawText);
  const m = LEAD_RE.exec(text);
  if (!m) return { value: null, unit: null };
  const value = computeValue(m[1], m[2], m[3], m[4]);
  if (value === null) return { value: null, unit: null };
  let rest = text.slice(m[0].length);
  let unit: string | null = null;

  const attached = /^([A-Za-zµΩ°%][A-Za-z0-9µΩ°%^\/\-]{0,11})/.exec(rest);
  if (attached) {
    const token = attached[1] ?? "";
    // Letters glued to the number must BE a unit ("0.45N"), else the number
    // was a coefficient ("36a" is 36*a) and the option is not a clean value.
    if (!isRecognisedUnit(token)) return { value: null, unit: null };
    unit = token;
    rest = rest.slice(token.length);
  } else {
    const spaced = /^\s+([A-Za-zµΩ°%][A-Za-z0-9µΩ°%^\/\-]{0,11})/.exec(rest);
    if (spaced) {
      const token = spaced[1] ?? "";
      if (isRecognisedUnit(token)) {
        unit = token;
        rest = rest.slice((spaced[0] ?? "").length);
      } else if (token.length <= 2 || MATH_WORD_RE.test(token)) {
        return { value: null, unit: null };
      } else {
        return { value, unit: null }; // prose boundary — next question's text
      }
    }
  }

  rest = rest.trimStart();
  if (rest.length === 0) return { value, unit };
  const boundary = rest[0] ?? "";
  // Anything that could continue the quantity refuses the parse.
  if (/[0-9.,+\-=*/^·⁄×÷±√π%°xX]/.test(boundary)) return { value: null, unit: null };
  if (/^[A-Za-z]{1,2}(?:\s|$)/.test(rest) && !/^[A-Za-z]{1,2}\)/.test(rest)) {
    return { value: null, unit: null };
  }
  if (MATH_WORD_RE.test((/^[A-Za-z]+/.exec(rest) ?? [""])[0] ?? "")) return { value: null, unit: null };
  return { value, unit };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
