import type { DrawCommand, ParsedResponse } from "@heytutor/drawing";
import { mathToSpeech, type AudioTimings } from "../tts/elevenLabsClient";
import {
  type InkPace,
  applySceneDuration,
  applySceneFlight,
  FOLLOW_FOCUS_SCALE,
  SCENE_WRITE_MAX_MS,
  SCENE_WRITE_MIN_MS,
  SCENE_WRITE_MS_PER_CHAR,
} from "./inkPace";
import {
  CODE_TYPE_MAX_BLOCK_MS,
  CODE_TYPE_MS_PER_CHAR,
  FRAME_SWAP_MS,
} from "../code/codeLessonPlan";
import { clampSpeechMsPerChar, defaultSpeechMsPerChar } from "./speechRate";

const INTER_COMMAND_GAP_MS = 300;

/**
 * Slowest the pen may letter one character while it tracks the voice, in
 * media ms. A token the voice never says (or says with no room) is written at
 * this pace right after its neighbour instead of being smeared to the end of
 * the sentence, and the whiteboard clamps every spoken slot to
 * [floor, ceiling] before it inks it.
 */
export const WRITE_INK_FLOOR_MS_PER_CHAR = 90;
export const WRITE_INK_CEILING_MS_PER_CHAR = 350;

/**
 * An estimated schedule is a guess at where the words fall; if it puts the
 * first cue past this share of the sentence the pen starts there instead,
 * so a wrong guess never leaves the row unwritten until the voice is done.
 * An exact schedule is the truth and is never shifted.
 */
export const ESTIMATED_FIRST_CUE_MAX_FRACTION = 0.6;

export interface SegmentTiming {
  narrationText: string;
  startMs: number;
  estimatedDurationMs: number;
  command: DrawCommand | null;
  commandIndex: number;
}

export interface SyncPlan {
  segments: SegmentTiming[];
  totalEstimatedDurationMs: number;
}

export interface CommandSpeechWindow {
  startMs: number;
  durationMs: number;
  matched: boolean;
}

export interface AudioTimingValidation {
  valid: boolean;
  reason?: string;
  totalDurationMs: number;
  expectedMaxMs: number;
}

export function buildSyncPlan(
  parsed: ParsedResponse,
  msPerChar = defaultSpeechMsPerChar,
): SyncPlan {
  const segments: SegmentTiming[] = [];
  let elapsedMs = 0;
  const rate = clampSpeechMsPerChar(msPerChar);

  for (let i = 0; i < parsed.segments.length; i++) {
    const seg = parsed.segments[i];
    const narrationText = seg.text.trim();
    const estimatedDurationMs = Math.max(narrationText.length * rate, 500);
    const command = seg.commandIndex < parsed.commands.length ? parsed.commands[seg.commandIndex] : null;

    segments.push({
      narrationText,
      startMs: elapsedMs,
      estimatedDurationMs,
      command,
      commandIndex: seg.commandIndex,
    });

    elapsedMs += estimatedDurationMs;

    if (command && command.type !== "CLEAR" && command.type !== "PAUSE") {
      elapsedMs += INTER_COMMAND_GAP_MS;
    }

    if (command && command.type === "PAUSE") {
      elapsedMs += command.params[0] ?? 500;
    }
  }

  return {
    segments,
    totalEstimatedDurationMs: elapsedMs,
  };
}

export function buildSyncPlanFromTimings(
  parsed: ParsedResponse,
  timings: AudioTimings,
  msPerChar = defaultSpeechMsPerChar,
): SyncPlan {
  const segments: SegmentTiming[] = [];
  let charOffset = 0;
  let elapsedMs = 0;
  const rate = clampSpeechMsPerChar(msPerChar);

  for (let i = 0; i < parsed.segments.length; i++) {
    const seg = parsed.segments[i];
    const narrationText = seg.text.trim();
    const narrationCharCount = narrationText.length;
    const command = seg.commandIndex < parsed.commands.length ? parsed.commands[seg.commandIndex] : null;

    let segmentStartSec = 0;
    let segmentEndSec = 0;

    if (charOffset < timings.charStartTimes.length) {
      segmentStartSec = timings.charStartTimes[charOffset] ?? elapsedMs / 1000;
      const endIdx = Math.min(charOffset + narrationCharCount, timings.charStartTimes.length) - 1;
      segmentEndSec = (timings.charStartTimes[endIdx] ?? segmentStartSec) + (timings.charDurations[endIdx] ?? 0.06);
    } else {
      segmentStartSec = elapsedMs / 1000;
      segmentEndSec = segmentStartSec + Math.max(narrationCharCount * rate / 1000, 0.5);
    }

    const segmentDurationMs = Math.max((segmentEndSec - segmentStartSec) * 1000, 300);

    segments.push({
      narrationText,
      startMs: segmentStartSec * 1000,
      estimatedDurationMs: segmentDurationMs,
      command,
      commandIndex: seg.commandIndex,
    });

    elapsedMs = segmentStartSec * 1000 + segmentDurationMs;
    charOffset += narrationCharCount;

    if (command && command.type !== "CLEAR" && command.type !== "PAUSE") {
      elapsedMs += INTER_COMMAND_GAP_MS;
    }

    if (command && command.type === "PAUSE") {
      elapsedMs += command.params[0] ?? 500;
    }
  }

  return {
    segments,
    totalEstimatedDurationMs: elapsedMs,
  };
}

/* ------------------------------------------------------------------------ */
/* Spoken forms                                                              */
/* ------------------------------------------------------------------------ */

const ONES_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS_WORDS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function integerToWords(n: number): string {
  if (n < 20) {
    return ONES_WORDS[n]!;
  }
  if (n < 100) {
    const rest = n % 10;
    return `${TENS_WORDS[Math.floor(n / 10)]}${rest ? ` ${ONES_WORDS[rest]}` : ""}`;
  }
  if (n < 1000) {
    const rest = n % 100;
    return `${ONES_WORDS[Math.floor(n / 100)]} hundred${rest ? ` ${integerToWords(rest)}` : ""}`;
  }
  if (n < 1_000_000) {
    const rest = n % 1000;
    return `${integerToWords(Math.floor(n / 1000))} thousand${rest ? ` ${integerToWords(rest)}` : ""}`;
  }
  if (n < 1_000_000_000) {
    const rest = n % 1_000_000;
    return `${integerToWords(Math.floor(n / 1_000_000))} million${rest ? ` ${integerToWords(rest)}` : ""}`;
  }
  return String(n)
    .split("")
    .map((digit) => ONES_WORDS[Number(digit)] ?? digit)
    .join(" ");
}

/**
 * "0.43" -> "zero point four three", "1,000" -> "one thousand". Both the board
 * token and the narration go through this, so a digit string on the board
 * finds the same words whether the model wrote the number in digits or spelt
 * it out for the voice.
 */
export function numberToSpokenWords(raw: string): string {
  const cleaned = raw.replace(/,/g, "");
  const [intPart = "", decimalPart] = cleaned.split(".");
  const digitsOnly = intPart.replace(/\D/g, "");
  const intWords =
    digitsOnly.length === 0
      ? ""
      : digitsOnly.length > 9
        ? digitsOnly.split("").map((digit) => ONES_WORDS[Number(digit)]).join(" ")
        : integerToWords(Number(digitsOnly));
  if (decimalPart === undefined || decimalPart.length === 0) {
    return intWords;
  }
  const decimalWords = decimalPart
    .split("")
    .map((digit) => ONES_WORDS[Number(digit)] ?? digit)
    .join(" ");
  return `${intWords.length > 0 ? `${intWords} ` : ""}point ${decimalWords}`;
}

const GREEK_SYMBOLS: Record<string, string> = {
  "θ": "theta",
  "μ": "mu",
  "ω": "omega",
  "π": "pi",
  "λ": "lambda",
  "Δ": "delta",
  "α": "alpha",
  "β": "beta",
  "γ": "gamma",
  "φ": "phi",
  "ψ": "psi",
  "ρ": "rho",
  "σ": "sigma",
  "τ": "tau",
  "ε": "epsilon",
  "η": "eta",
  "ν": "nu",
  "ξ": "xi",
  "κ": "kappa",
  "χ": "chi",
  "ζ": "zeta",
  "δ": "delta",
  "Θ": "capital theta",
  "Ω": "omega",
  "Σ": "sigma",
  "Φ": "phi",
  "Ψ": "psi",
  "Λ": "lambda",
};

function expandGreekSymbols(text: string): string {
  return text.replace(/[θμωπλΔαβγφψρστξηνκχζδΘΩΣΦΨΛ]/g, (match) => ` ${GREEK_SYMBOLS[match] ?? match} `);
}

function expandPowersOfTen(text: string): string {
  return text.replace(/(\d+)\s*\^\s*(\d+)/g, (_match, base, exp) => {
    const baseWord = numberToSpokenWords(base!);
    const expNum = Number(exp);
    if (expNum === 2) return `${baseWord} squared`;
    if (expNum === 3) return `${baseWord} cubed`;
    return `${baseWord} to the power ${exp}`;
  });
}

function expandNumbers(text: string): string {
  return expandPowersOfTen(text).replace(/\b\d+(?:\.\d+)?\b/g, (match) => numberToSpokenWords(match));
}

/**
 * One string of lowercase words, the way the voice would say the text. Used
 * for whole-phrase candidates (a FOCUS anchor clause, a narration clause) and
 * by the focus scheduler; the board token matcher builds its candidates per
 * symbol instead, because a symbol has more than one spoken form.
 */
export function normalizeForSpeechMatch(text: string): string {
  return expandNumbers(
    expandGreekSymbols(
      mathToSpeech(text)
        .replace(/([0-9])([a-z])/gi, "$1 $2")
        .replace(/([a-z])([0-9])/gi, "$1 $2")
        .replace(/\bis\s+equal\s+to\b/gi, " equals ")
        .replace(/\bequal\s+to\b/gi, " equals ")
        .replace(/=/g, " equals ")
        .replace(/\+/g, " plus ")
        // A hyphen inside a word ("forty-five", "re-arrange") is not a minus.
        .replace(/(\p{L})-(?=\p{L})/gu, "$1 ")
        .replace(/-/g, " minus ")
        .replace(/\*/g, " times ")
        .replace(/\//g, " divided by ")
        .replace(/\bint\b/gi, " integral ")
        .replace(/\bpi\b/gi, " pi "),
    ),
  )
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How the voice says a symbol. Measured over 364 lessons (6301 WRITE rows):
 * "=" was said as "is" 45% of the time, "equals" 33%; "/" was "over" far more
 * often than "divided by"; "->" and "≈" had no spoken form at all and dropped
 * out of every schedule. The first form is the one the narration side uses
 * when the sentence itself carries the symbol; every form is a board
 * candidate. Order matters only as a tie break.
 */
const SYMBOL_SPOKEN_FORMS: Record<string, readonly string[]> = {
  "=": [
    "equals", "is", "gives", "comes to", "equal to", "is equal to", "becomes",
    "comes out to", "works out to", "we get", "which is", "will be", "that is",
    "equal",
  ],
  "==": ["equals", "is", "is equal to", "equal to"],
  "≈": [
    "approximately", "about", "roughly", "around", "is about", "is approximately",
    "is roughly", "is around", "approximately equal to", "nearly", "close to",
    "almost",
  ],
  "~": ["approximately", "about", "roughly", "around"],
  "->": [
    "so", "gives", "means", "therefore", "implies", "hence", "then", "which gives",
    "which means", "leads to", "we get", "so that", "giving", "meaning",
  ],
  ">": [
    "greater than", "more than", "positive", "exceeds", "bigger than", "larger than",
    "above", "is positive", "is greater than", "is more than", "came out positive",
  ],
  "<": [
    "less than", "negative", "below", "smaller than", "under", "is negative",
    "is less than", "came out negative",
  ],
  ">=": ["greater than or equal to", "at least", "greater than or equal"],
  "<=": ["less than or equal to", "at most", "less than or equal"],
  "≠": ["not equal to", "does not equal", "not equal", "is not"],
  "!=": ["not equal to", "does not equal", "not equal", "is not"],
  "+": ["plus", "and", "added to", "add", "positive"],
  "-": ["minus", "negative", "less", "take away", "subtract", "subtracting"],
  "±": ["plus or minus", "plus minus"],
  "*": ["times", "multiplied by", "by", "into", "cross"],
  "/": ["over", "divided by", "by", "per", "upon", "divided"],
  "_": ["", "sub"],
  "√": ["square root of", "root", "square root", "the square root of", "root of"],
  "∞": ["infinity"],
  "°": ["degrees", "degree"],
  "%": ["percent", "per cent"],
  "|": ["", "absolute value of", "magnitude of", "mod", "the absolute value of", "the magnitude of"],
  "'": ["prime", "dash"],
  "!": ["", "factorial"],
  "∑": ["sum of", "sum", "sigma", "the sum of"],
  "∫": ["integral of", "integral", "the integral of"],
  "∂": ["partial", "del"],
  "∇": ["del", "nabla", "gradient"],
  "∈": ["in", "belongs to", "is in", "element of"],
  "∝": ["proportional to", "is proportional to", "varies as"],
  "⊥": ["perpendicular to", "perpendicular"],
  "∥": ["parallel to", "parallel"],
  "∠": ["angle"],
  "&": ["and"],
  "@": ["at"],
  "#": ["number", "hash"],
  // Inside a token ("(2,3)") a comma is often read out; at the end of one it is silence.
  ",": ["", "comma", "and"],
};

const SYMBOL_ALIASES: Record<string, string> = {
  "=>": "->",
  "→": "->",
  "⇒": "->",
  "⟹": "->",
  "∴": "->",
  "≥": ">=",
  "≤": "<=",
  "×": "*",
  "·": "*",
  "⋅": "*",
  "∗": "*",
  "÷": "/",
  "∕": "/",
  "−": "-",
  "–": "-",
  "—": "-",
  "Σ": "∑",
  "²": "^2",
  "³": "^3",
};

/** Punctuation that carries no spoken word: dropped from candidates, never matched. */
const SILENT_SYMBOLS = new Set([
  "(", ")", "[", "]", "{", "}", ".", ":", ";", "?", "✓", "✔", "✗", "✘", "…",
  "\"", "“", "”", "‘", "’", "`", "•", "$", "\\", "^", "⋯",
]);

const STOPWORDS = new Set([
  "is", "so", "by", "be", "per", "about", "around", "means", "gives", "then", "and",
  "less", "more", "to", "a", "an", "the", "of", "in", "on", "at", "we", "it", "as",
  "or", "if", "into", "add", "sub", "mod", "will", "that", "which", "get",
]);

/**
 * Units by their board symbol. Single letters (m, s, N, J, V, A, ...) are
 * only read as units when a number precedes them, because "m" is also the
 * magnification and "V" a voltage variable. Multi letter symbols are units
 * wherever they stand.
 */
const UNIT_SPOKEN_FORMS: Record<string, readonly string[]> = {
  cm: ["centimeters", "centimeter", "centimetres", "centimetre", "cm"],
  mm: ["millimeters", "millimeter", "millimetres", "millimetre", "mm"],
  km: ["kilometers", "kilometer", "kilometres", "kilometre", "km"],
  m: ["meters", "meter", "metres", "metre", "m"],
  s: ["seconds", "second", "s", "sec"],
  sec: ["seconds", "second", "sec"],
  ms: ["milliseconds", "millisecond", "ms"],
  min: ["minutes", "minute", "min"],
  h: ["hours", "hour", "h"],
  hr: ["hours", "hour"],
  hrs: ["hours", "hour"],
  kg: ["kilograms", "kilogram", "kilos", "kilo", "kg"],
  g: ["grams", "gram", "g"],
  mg: ["milligrams", "milligram", "mg"],
  n: ["newtons", "newton", "n"],
  j: ["joules", "joule", "j"],
  kj: ["kilojoules", "kilojoule"],
  w: ["watts", "watt", "w"],
  kw: ["kilowatts", "kilowatt"],
  v: ["volts", "volt", "v"],
  kv: ["kilovolts", "kilovolt"],
  mv: ["millivolts", "millivolt"],
  a: ["amperes", "ampere", "amps", "amp", "a"],
  ma: ["milliamperes", "milliampere", "milliamps", "milliamp"],
  ohm: ["ohms", "ohm"],
  ohms: ["ohms", "ohm"],
  hz: ["hertz", "hz"],
  khz: ["kilohertz"],
  mhz: ["megahertz"],
  ghz: ["gigahertz"],
  k: ["kelvin", "k"],
  c: ["coulombs", "coulomb", "celsius", "c"],
  t: ["tesla", "t"],
  pa: ["pascals", "pascal"],
  kpa: ["kilopascals", "kilopascal"],
  mol: ["moles", "mole", "mol"],
  ev: ["electron volts", "electron volt", "ev"],
  rad: ["radians", "radian", "rad"],
  deg: ["degrees", "degree"],
  db: ["decibels", "decibel"],
  l: ["liters", "liter", "litres", "litre", "l"],
  ml: ["milliliters", "milliliter", "millilitres", "millilitre", "ml"],
  f: ["farads", "farad", "f"],
  uf: ["microfarads", "microfarad"],
  nf: ["nanofarads", "nanofarad"],
  pf: ["picofarads", "picofarad"],
  h_: ["henries", "henry"],
  wb: ["webers", "weber"],
  au: ["astronomical units", "astronomical unit"],
  ly: ["light years", "light year"],
  atm: ["atmospheres", "atmosphere"],
  cal: ["calories", "calorie"],
  kcal: ["kilocalories", "kilocalorie"],
  rpm: ["rpm", "revolutions per minute"],
  kmh: ["kilometers per hour", "kilometres per hour"],
  mph: ["miles per hour"],
  yr: ["years", "year"],
  yrs: ["years", "year"],
};

/** Units that need no number beside them to read as a unit. */
const UNAMBIGUOUS_UNITS = new Set([
  "cm", "mm", "km", "ms", "kg", "mg", "kj", "kw", "kv", "mv", "ma", "ohm", "ohms",
  "hz", "khz", "mhz", "ghz", "pa", "kpa", "mol", "ev", "rad", "deg", "db", "ml",
  "uf", "nf", "pf", "wb", "atm", "cal", "kcal", "rpm", "kmh", "mph", "hrs", "yrs",
]);

const FUNCTION_SPOKEN_FORMS: Record<string, readonly string[]> = {
  sin: ["sine", "sin"],
  cos: ["cosine", "cos"],
  tan: ["tangent", "tan"],
  cot: ["cotangent", "cot"],
  sec: ["secant", "sec"],
  csc: ["cosecant", "cosec", "csc"],
  cosec: ["cosecant", "cosec"],
  sinh: ["sinh", "hyperbolic sine"],
  cosh: ["cosh", "hyperbolic cosine"],
  tanh: ["tanh", "hyperbolic tangent"],
  arcsin: ["arc sine", "inverse sine", "arcsine", "sine inverse"],
  arccos: ["arc cosine", "inverse cosine", "arccosine", "cosine inverse"],
  arctan: ["arc tangent", "inverse tangent", "arctangent", "tangent inverse"],
  log: ["log", "logarithm", "log of"],
  ln: ["natural log", "ln", "l n", "log", "natural log of"],
  lg: ["log", "lg"],
  sqrt: ["square root of", "root", "square root", "the square root of"],
  lim: ["limit", "lim", "the limit"],
  int: ["integral of", "integral", "the integral of", "int"],
  exp: ["e to the", "exp", "exponential", "e to the power"],
  max: ["max", "maximum", "the maximum"],
  min: ["min", "minimum", "the minimum"],
  det: ["determinant", "det", "the determinant"],
  mod: ["mod", "modulo", "modulus"],
  abs: ["absolute value of", "abs", "the absolute value of"],
  avg: ["average", "avg"],
  dx: ["d x", "dx"],
  dy: ["d y", "dy"],
  dt: ["d t", "dt"],
  dv: ["d v", "dv"],
  var: ["variance", "var"],
  len: ["length", "len"],
  len_: ["length"],
  null: ["null", "none", "nothing"],
  nil: ["nil", "null"],
  arr: ["array", "arr"],
  idx: ["index", "idx"],
  ptr: ["pointer", "ptr"],
  cnt: ["count", "cnt"],
  num: ["number", "num"],
  str: ["string", "str"],
  fn: ["function", "fn"],
  func: ["function", "func"],
  pe: ["potential energy", "p e"],
  ke: ["kinetic energy", "k e"],
  emf: ["e m f", "emf", "electromotive force"],
};

// Common English words of two to three letters. A word on the board that is
// one of these is said as the word, never letter by letter ("the" is not
// "t h e"); anything else that short inside a formula may be a product of
// variables, so both readings are offered.
const COMMON_SHORT_WORDS = new Set([
  "the", "and", "for", "but", "not", "you", "all", "any", "can", "had", "her",
  "was", "one", "our", "out", "day", "get", "has", "him", "his", "how", "man",
  "new", "now", "old", "see", "two", "way", "who", "boy", "did", "its", "let",
  "put", "say", "she", "too", "use", "an", "as", "at", "be", "by", "do", "go",
  "he", "if", "in", "is", "it", "me", "my", "no", "of", "on", "or", "so", "to",
  "up", "us", "we", "am", "yes", "per", "sum", "net", "top", "end", "set", "run",
  "add", "ask", "big", "cut", "far", "few", "fix", "key", "law", "low", "map",
  "max", "min", "mid", "odd", "off", "own", "red", "row", "try", "via", "yet",
  "area", "base", "case", "goal", "rule", "real", "side", "step", "true", "left",
  "down", "next", "last", "more", "less", "than", "with", "from", "into", "over",
  "when", "then", "both", "each", "same", "work", "find", "want", "need", "show",
  "here", "hint", "note", "sign", "zero", "half", "unit", "mass", "time", "path",
  "flow", "heat", "loop", "node", "root", "tree", "list", "head", "tail", "peak",
  "ex", "eg", "ie", "vs", "ok", "ans", "sol", "def", "dim", "avg", "std", "err",
]);

/* ------------------------------------------------------------------------ */
/* Narration words                                                           */
/* ------------------------------------------------------------------------ */

/** One spoken word with its span in the spoken narration string (end exclusive). */
export interface SpokenWord {
  text: string;
  startIndex: number;
  endIndex: number;
}

// A comma joins digits only as a thousands separator ("1,000"); "(2,3)" is two numbers.
const NARRATION_RUN = /\d+(?:,\d{3})*(?:\.\d+)?|\p{L}+(?:'\p{L}+)*|->|=>|<=|>=|!=|==|[^\s\p{L}\p{N}]/gu;

function isLetter(char: string | undefined): boolean {
  return char !== undefined && /\p{L}/u.test(char);
}

function letterRunWords(run: string): string[] {
  const lowered = run.replace(/'/g, "").toLowerCase();
  const expanded = lowered.replace(/[θμωπλΔαβγφψρστξηνκχζδΘΩΣΦΨΛ]/g, (match) => ` ${GREEK_SYMBOLS[match] ?? match} `);
  return expanded
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function symbolKey(symbol: string): string {
  return SYMBOL_ALIASES[symbol] ?? symbol;
}

/**
 * The spoken narration as whole words, each tied to the characters the
 * alignment timed. Whole words are the unit of matching: a substring search
 * put "v" inside "concave" and "|m|" inside "image" (measured, 10 Sep 2026),
 * and a proportional character map drifted once numbers were spelt out.
 */
export function tokenizeSpokenNarration(spoken: string): SpokenWord[] {
  const words: SpokenWord[] = [];
  for (const match of spoken.matchAll(NARRATION_RUN)) {
    const run = match[0];
    const startIndex = match.index ?? 0;
    const endIndex = startIndex + run.length;
    let parts: string[];
    if (/^\d/.test(run)) {
      parts = numberToSpokenWords(run).split(" ").filter(Boolean);
    } else if (/^\p{L}/u.test(run)) {
      parts = letterRunWords(run);
    } else if (run === "-" && isLetter(spoken[startIndex - 1]) && isLetter(spoken[endIndex])) {
      // A hyphen joining two words ("forty-five") is not a minus sign.
      parts = [];
    } else {
      const key = symbolKey(run);
      const forms = key.startsWith("^") ? [] : SYMBOL_SPOKEN_FORMS[key];
      parts = forms && forms.length > 0 && forms[0]!.length > 0 ? forms[0]!.split(" ") : [];
    }
    if (parts.length === 0) {
      continue;
    }
    if (parts.length === 1) {
      words.push({ text: parts[0]!, startIndex, endIndex });
      continue;
    }
    // "45" -> "forty five": split the two timed characters between the words
    // by their length so each word still owns a real slice of the alignment.
    const totalLetters = parts.reduce((sum, part) => sum + part.length, 0);
    let cursor = startIndex;
    parts.forEach((part, partIndex) => {
      const isLast = partIndex === parts.length - 1;
      const share = Math.max(Math.round((run.length * part.length) / Math.max(totalLetters, 1)), 0);
      const partEnd = isLast ? endIndex : Math.min(cursor + share, endIndex);
      words.push({ text: part, startIndex: cursor, endIndex: Math.max(partEnd, cursor) });
      cursor = partEnd;
    });
  }
  return words;
}

/* ------------------------------------------------------------------------ */
/* Board token candidates                                                    */
/* ------------------------------------------------------------------------ */

interface TokenUnit {
  /** Every spoken reading of this piece, as normalized words; "" means silent. */
  forms: string[];
}

const BOARD_UNIT = /\d+(?:,\d{3})*(?:\.\d+)?|\p{L}+|->|=>|<=|>=|!=|==|\^\d+|\^|[^\s\p{L}\p{N}]/gu;

function isSilentSymbol(symbol: string): boolean {
  return SILENT_SYMBOLS.has(symbol);
}

function numberForms(raw: string, subscript: boolean): string[] {
  const words = numberToSpokenWords(raw);
  const forms = [words];
  if (subscript) {
    forms.push(`sub ${words}`);
  }
  if (/^0\./.test(raw)) {
    forms.push(words.replace(/^zero /, ""));
    forms.push(words.replace(/^zero /, "oh "));
  } else if (/\.\d\d$/.test(raw)) {
    // "8.57" is also said "eight point fifty seven".
    const [intPart, decimalPart] = raw.replace(/,/g, "").split(".");
    forms.push(`${numberToSpokenWords(intPart!)} point ${integerToWords(Number(decimalPart))}`);
  }
  if (/^(100|1000|1000000)$/.test(raw.replace(/,/g, ""))) {
    forms.push(words.replace(/^one /, "a "));
    forms.push(words.replace(/^one /, ""));
  }
  return forms;
}

function letterForms(
  run: string,
  options: { numericContext: boolean; formulaToken: boolean; standaloneOperand: boolean },
): string[] {
  const lower = run.toLowerCase();
  const plain = letterRunWords(run).join(" ");
  const forms: string[] = [];
  const unitForms = UNIT_SPOKEN_FORMS[lower];
  const isUnit = unitForms && (options.numericContext || UNAMBIGUOUS_UNITS.has(lower));
  if (isUnit) {
    forms.push(...unitForms);
  }
  const functionForms = FUNCTION_SPOKEN_FORMS[lower];
  if (functionForms && !isUnit) {
    forms.push(...functionForms);
  }
  if (plain.length > 0) {
    forms.push(plain);
  }
  // "mgh" or "ma" inside a formula is a product of variables as often as a
  // word; offer the letters too. A single letter is already itself.
  const isLatin = /^[a-z]+$/i.test(run);
  if (
    isLatin &&
    run.length >= 2 &&
    run.length <= 4 &&
    !COMMON_SHORT_WORDS.has(lower) &&
    !functionForms &&
    !isUnit &&
    (options.formulaToken || run.length <= 3)
  ) {
    forms.push(run.toLowerCase().split("").join(" "));
    if (run.length === 2) {
      forms.push(run.toLowerCase().split("").join(" times "));
    }
  }
  // A lone "x" token between two operands is the multiplication sign as often
  // as the variable ("V_s x R2"); glued to a number ("2x") it is the variable.
  if (lower === "x" && options.standaloneOperand) {
    forms.push("times", "multiplied by", "cross");
  }
  return forms;
}

function powerForms(exponent: string): string[] {
  const trimmed = exponent.replace(/^\^/, "");
  if (trimmed.length === 0) {
    return ["to the power of", "to the power", "to the", "raised to"];
  }
  if (trimmed === "2") return ["squared", "square", "to the power two"];
  if (trimmed === "3") return ["cubed", "cube", "to the power three"];
  const spoken = /^\d/.test(trimmed) ? numberToSpokenWords(trimmed) : letterRunWords(trimmed).join(" ");
  return [
    `to the power ${spoken}`,
    `to the ${spoken}`,
    `to the power of ${spoken}`,
    `power ${spoken}`,
    `raised to ${spoken}`,
  ];
}

/**
 * Break one board token into pieces and list how each may be said. "1/v"
 * becomes [one] [over | divided by | by | per] [v]; "V_s" becomes
 * [v] [ | sub] [s]; "60cm" becomes [sixty] [centimeters | centimeter | ...].
 */
function boardTokenUnits(token: string, previousToken: string | undefined): TokenUnit[] {
  const pieces = [...token.matchAll(BOARD_UNIT)].map((match) => match[0]);
  const formulaToken = /[=+\-*/^_()|<>≈→⇒×·÷√]|\d/.test(token) || /[A-Z].*[A-Z]/.test(token);
  const previousNumeric = previousToken !== undefined && /\d$/.test(previousToken);
  const units: TokenUnit[] = [];

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!;
    const previous = pieces[i - 1];
    const next = pieces[i + 1];

    if (/^\d/.test(piece)) {
      const subscript = previous !== undefined && /^\p{L}+$/u.test(previous);
      units.push({ forms: numberForms(piece, subscript) });
      // "2x", "2(4)", "2πr": a number written against a letter or bracket is
      // multiplied, and the voice may or may not say "times".
      if (next !== undefined && (/^\p{L}/u.test(next) || next === "(" || next === "√")) {
        units.push({ forms: ["", "times"] });
      }
      continue;
    }

    if (/^\p{L}/u.test(piece)) {
      const numericContext =
        (previous !== undefined && /^\d/.test(previous)) ||
        (i === 0 && previousNumeric);
      units.push({
        forms: letterForms(piece, {
          numericContext,
          formulaToken,
          standaloneOperand: pieces.length === 1 && previousToken !== undefined,
        }),
      });
      if (next === "(" && !FUNCTION_SPOKEN_FORMS[piece.toLowerCase()]) {
        units.push({ forms: ["", "times"] });
      }
      continue;
    }

    if (piece.startsWith("^")) {
      if (piece === "^" && next !== undefined && /^[\p{L}\d]/u.test(next)) {
        units.push({ forms: powerForms(next) });
        i += 1;
      } else {
        units.push({ forms: powerForms(piece) });
      }
      continue;
    }

    const key = symbolKey(piece);
    if (key.startsWith("^")) {
      units.push({ forms: powerForms(key) });
      continue;
    }
    if (isSilentSymbol(key)) {
      if ((key === ")" || key === "]") && (next === "(" || next === "[")) {
        units.push({ forms: ["", "times"] });
      }
      continue;
    }
    const forms = SYMBOL_SPOKEN_FORMS[key];
    if (forms) {
      // A leading minus is a sign more than a subtraction.
      if (key === "-" && i === 0 && next !== undefined && /^\d/.test(next)) {
        units.push({ forms: ["negative", "minus"] });
      } else {
        units.push({ forms: [...forms] });
      }
      continue;
    }
    // Anything else (≤ from the older mapping, a chemistry arrow) keeps the
    // single reading the voice gets.
    const fallback = normalizeForSpeechMatch(piece);
    if (fallback.length > 0) {
      units.push({ forms: [fallback] });
    }
  }

  return units;
}

const MAX_TOKEN_CANDIDATES = 64;

/**
 * Every way this board token may be spoken, most likely first, as word
 * arrays. Empty when the token is pure punctuation ("?", "✓", ":"), which
 * the pen letters beside its neighbour without looking for a word.
 */
export function boardTokenSpokenCandidates(token: string, previousToken?: string): string[][] {
  const units = boardTokenUnits(token, previousToken);
  if (units.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const results: string[][] = [];
  const walk = (index: number, acc: string[]): void => {
    if (results.length >= MAX_TOKEN_CANDIDATES) {
      return;
    }
    if (index === units.length) {
      const phrase = acc.join(" ").replace(/\s+/g, " ").trim();
      if (phrase.length === 0 || seen.has(phrase)) {
        return;
      }
      seen.add(phrase);
      results.push(phrase.split(" "));
      return;
    }
    for (const form of units[index]!.forms) {
      walk(index + 1, form.length > 0 ? [...acc, form] : acc);
      if (results.length >= MAX_TOKEN_CANDIDATES) {
        return;
      }
    }
  };
  walk(0, []);
  return results;
}

/* ------------------------------------------------------------------------ */
/* Whole-word search                                                         */
/* ------------------------------------------------------------------------ */

function phraseAt(words: readonly string[], phrase: readonly string[], at: number): boolean {
  if (at < 0 || at + phrase.length > words.length) {
    return false;
  }
  for (let k = 0; k < phrase.length; k++) {
    if (words[at + k] !== phrase[k]) {
      return false;
    }
  }
  return true;
}

/** First index in [from, before) where the phrase starts, or -1. */
function findPhrase(
  words: readonly string[],
  phrase: readonly string[],
  from: number,
  before = words.length,
): number {
  if (phrase.length === 0) {
    return -1;
  }
  const last = Math.min(before, words.length - phrase.length + 1);
  for (let i = Math.max(from, 0); i < last; i++) {
    if (phraseAt(words, phrase, i)) {
      return i;
    }
  }
  return -1;
}

function findNthPhrase(words: readonly string[], phrase: readonly string[], n: number): number {
  let from = 0;
  let found = -1;
  for (let i = 0; i <= n; i++) {
    found = findPhrase(words, phrase, from);
    if (found < 0) {
      return -1;
    }
    from = found + 1;
  }
  return found;
}

interface PhraseMatch {
  start: number;
  /** Exclusive. */
  end: number;
  candidate: string[];
}

/**
 * Earliest whole-word match of any candidate inside [from, before). Ties on
 * position go to the longer phrase ("is about" over "about"), then to the
 * likelier form.
 */
function earliestCandidateMatch(
  words: readonly string[],
  candidates: readonly string[][],
  from: number,
  before = words.length,
  taken?: readonly boolean[],
): PhraseMatch | null {
  let best: PhraseMatch | null = null;
  for (const candidate of candidates) {
    let at = findPhrase(words, candidate, from, before);
    while (at >= 0 && taken && taken.slice(at, at + candidate.length).some(Boolean)) {
      at = findPhrase(words, candidate, at + 1, before);
    }
    if (at < 0) {
      continue;
    }
    if (!best || at < best.start || (at === best.start && candidate.length > best.candidate.length)) {
      best = { start: at, end: at + candidate.length, candidate };
    }
  }
  return best;
}

function phraseStrength(candidate: readonly string[]): number {
  return candidate.reduce((sum, word) => sum + (STOPWORDS.has(word) ? 0 : word.length), 0);
}

/* ------------------------------------------------------------------------ */
/* Timings                                                                   */
/* ------------------------------------------------------------------------ */

function normalizeSegmentTimings(narration: string, timings: AudioTimings): AudioTimings {
  const spokenNarration = mathToSpeech(narration.trim());
  const limit = Math.min(spokenNarration.length, timings.charStartTimes.length);
  if (limit <= 0) {
    return timings;
  }

  const charStartTimes = timings.charStartTimes.slice(0, limit);
  const charDurations = timings.charDurations.slice(0, limit);
  const lastIndex = limit - 1;
  const totalDuration =
    (charStartTimes[lastIndex] ?? 0) + (charDurations[lastIndex] ?? 0.06);

  return {
    charStartTimes,
    charDurations,
    totalDuration,
  };
}

export function validateAudioTimingsForNarration(
  narration: string,
  timings?: AudioTimings | null,
): AudioTimingValidation {
  const spokenNarration = mathToSpeech(narration.trim());
  if (!timings || timings.charStartTimes.length === 0 || timings.totalDuration <= 0) {
    return {
      valid: false,
      reason: "missing-timings",
      totalDurationMs: 0,
      expectedMaxMs: Math.max(spokenNarration.length * 220, 2500),
    };
  }

  const normalized = normalizeSegmentTimings(narration, timings);
  const lastIndex = normalized.charStartTimes.length - 1;
  const measuredEndMs = Math.round(
    ((normalized.charStartTimes[lastIndex] ?? 0) +
      (normalized.charDurations[lastIndex] ?? 0.06)) *
      1000,
  );
  const expectedMaxMs = Math.max(spokenNarration.length * 220, 2500);

  if (measuredEndMs > expectedMaxMs * 1.35) {
    return {
      valid: false,
      reason: "duration-too-large",
      totalDurationMs: measuredEndMs,
      expectedMaxMs,
    };
  }

  for (let i = 1; i < normalized.charStartTimes.length; i++) {
    const previous = normalized.charStartTimes[i - 1] ?? 0;
    const current = normalized.charStartTimes[i] ?? 0;
    if (current + 0.05 < previous) {
      return {
        valid: false,
        reason: "non-monotonic",
        totalDurationMs: measuredEndMs,
        expectedMaxMs,
      };
    }
  }

  const lastStartMs = Math.round((normalized.charStartTimes[lastIndex] ?? 0) * 1000);
  if (lastStartMs > expectedMaxMs * 1.2) {
    return {
      valid: false,
      reason: "offset-too-large",
      totalDurationMs: measuredEndMs,
      expectedMaxMs,
    };
  }

  return {
    valid: true,
    totalDurationMs: measuredEndMs,
    expectedMaxMs,
  };
}

export function timingIndexForNormalizedOffset(
  normalizedOffset: number,
  normalizedLength: number,
  spokenLength: number,
): number {
  if (spokenLength <= 1 || normalizedLength <= 0) {
    return 0;
  }

  const ratio = Math.min(Math.max(normalizedOffset / normalizedLength, 0), 1);
  return Math.min(Math.round(ratio * (spokenLength - 1)), spokenLength - 1);
}

function hasTimingAt(timings: AudioTimings, index: number): boolean {
  return Number.isFinite(timings.charStartTimes[index]);
}

export function timingStartMs(timings: AudioTimings, index: number): number | null {
  if (!hasTimingAt(timings, index)) {
    return null;
  }
  return Math.max(Math.round((timings.charStartTimes[index] ?? 0) * 1000), 0);
}

export function timingEndMs(timings: AudioTimings, index: number): number | null {
  if (!hasTimingAt(timings, index)) {
    return null;
  }
  const sec =
    (timings.charStartTimes[index] ?? timings.totalDuration) +
    (timings.charDurations[index] ?? 0.06);
  return Math.max(Math.round(sec * 1000), 0);
}

/** Spoken span of words [start, end) of the narration, in media ms. */
function wordSpanMs(
  words: readonly SpokenWord[],
  timings: AudioTimings,
  start: number,
  end: number,
): { startMs: number; endMs: number } | null {
  const first = words[start];
  const last = words[end - 1];
  if (!first || !last) {
    return null;
  }
  const startMs = timingStartMs(timings, first.startIndex);
  const endMs = timingEndMs(timings, Math.max(last.endIndex - 1, last.startIndex));
  if (startMs === null || endMs === null) {
    return null;
  }
  return { startMs, endMs: Math.max(endMs, startMs) };
}

/* ------------------------------------------------------------------------ */
/* Command speech windows                                                    */
/* ------------------------------------------------------------------------ */

type SpeechCandidateKind = "text" | "anchor";

interface SpeechCandidate {
  words: string[];
  kind: SpeechCandidateKind;
}

function spokenWordsOf(text: string): string[] {
  return normalizeForSpeechMatch(text).split(" ").filter(Boolean);
}

function uniqueCandidates(candidates: Array<{ text?: string; kind: SpeechCandidateKind }>): SpeechCandidate[] {
  const seen = new Set<string>();
  const result: SpeechCandidate[] = [];

  for (const candidate of candidates) {
    const words = spokenWordsOf(candidate.text ?? "");
    const key = words.join(" ");
    if (words.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ words, kind: candidate.kind });
  }

  return result;
}

export function lastMeaningfulClause(text: string): string {
  const clauses = text
    .split(/(?<=[.!?,;:])\s+/)
    .map((clause) => clause.trim())
    .filter(Boolean);

  return clauses.at(-1) ?? text;
}

function expandCompactFormulaTokens(text: string): string {
  if (!/[=+\-*/^]|\bint\b/i.test(text)) {
    return text;
  }

  return text.replace(/\b[a-z]{2,3}\b/gi, (token) => {
    const lower = token.toLowerCase();
    if (COMMON_SHORT_WORDS.has(lower)) {
      return token;
    }
    if (['int', 'sin', 'cos', 'tan', 'log', 'sqrt', 'pi', 'sum', 'vec', 'det', 'lim', 'exp', 'max', 'min'].includes(lower)) {
      return token;
    }
    return token.split('').join(' ');
  });
}

function fallbackSpeechWindow(
  narration: string,
  command: DrawCommand,
  msPerChar = defaultSpeechMsPerChar,
): CommandSpeechWindow {
  const spokenLength = mathToSpeech(narration.trim()).length;
  const estimatedTotalMs = Math.max(spokenLength * clampSpeechMsPerChar(msPerChar), 500);
  const naturalDrawMs = getCommandDrawDurationMs(command);
  const isTextCommand = command.type === "WRITE" || command.type === "LABEL";
  const startMs = isTextCommand ? Math.round(estimatedTotalMs * 0.45) : 0;
  const durationMs = isTextCommand
    ? Math.max(naturalDrawMs, Math.round(estimatedTotalMs * 0.35))
    : Math.min(naturalDrawMs, estimatedTotalMs);

  return {
    startMs,
    durationMs,
    matched: false,
  };
}

/**
 * When the voice reaches this command's words. Text commands after another
 * text command in the same segment look for the next occurrence of their
 * phrase; a FOCUS or a shape after a WRITE looks for the first, because the
 * old rule (the second occurrence for everything) missed every such gesture
 * measured on 10 Sep 2026.
 */
export function getCommandSpeechWindow(
  narration: string,
  command: DrawCommand,
  timings?: AudioTimings | null,
  textCommandIndex = 0,
  msPerChar = defaultSpeechMsPerChar,
): CommandSpeechWindow {
  if (!timings || timings.charStartTimes.length === 0 || timings.totalDuration <= 0) {
    return fallbackSpeechWindow(narration, command, msPerChar);
  }

  const spokenNarration = mathToSpeech(narration.trim());
  const spokenWords = tokenizeSpokenNarration(spokenNarration);
  const wordTexts = spokenWords.map((word) => word.text);
  const totalMs = Math.round(timings.totalDuration * 1000);

  if (wordTexts.length === 0) {
    return fallbackSpeechWindow(narration, command, msPerChar);
  }

  const isTextCommand = command.type === "WRITE" || command.type === "LABEL";
  const occurrence = isTextCommand ? textCommandIndex : 0;

  const candidates = uniqueCandidates([
    { text: command.text, kind: "text" },
    { text: command.text ? expandCompactFormulaTokens(command.text) : undefined, kind: "text" },
    { text: command.text ? mathToSpeech(command.text) : undefined, kind: "text" },
    {
      text: command.text ? mathToSpeech(expandCompactFormulaTokens(command.text)) : undefined,
      kind: "text",
    },
    { text: lastMeaningfulClause(command.narrationBefore), kind: "anchor" },
    { text: command.narrationBefore, kind: "anchor" },
  ]);

  for (const candidate of candidates) {
    const at = findNthPhrase(wordTexts, candidate.words, occurrence);
    if (at < 0) {
      continue;
    }
    const span = wordSpanMs(spokenWords, timings, at, at + candidate.words.length);
    if (!span) {
      continue;
    }

    const phraseDurationMs = Math.max(span.endMs - span.startMs, 250);
    const naturalDrawMs = getCommandDrawDurationMs(command);
    const durationMs =
      isTextCommand
        ? candidate.kind === "text"
          ? Math.max(phraseDurationMs, naturalDrawMs)
          : naturalDrawMs
        : Math.min(Math.max(phraseDurationMs, naturalDrawMs), Math.max(totalMs - span.startMs, 250));

    return {
      startMs: span.startMs,
      durationMs,
      matched: true,
    };
  }

  return fallbackSpeechWindow(narration, command, msPerChar);
}

/* ------------------------------------------------------------------------ */
/* Per-character write schedules                                             */
/* ------------------------------------------------------------------------ */

export interface WriteCharSchedule {
  /** Start time (ms from audio start) for each non-space character of command.text, in order. */
  offsetsMs: number[];
  /**
   * The spoken slot of each character: its token's spoken span divided across
   * the token's characters, in media ms. Zero when the voice left no room. The
   * whiteboard clamps it to [WRITE_INK_FLOOR_MS_PER_CHAR, WRITE_INK_CEILING_MS_PER_CHAR]
   * so ink fills the slot and ends when the word ends.
   */
  charDurationsMs: number[];
  /** True when any token was found in the narration (matchedCharFraction > 0). */
  matched: boolean;
  /**
   * Share of the row's letterable characters whose token the voice says, 0..1.
   * Punctuation with no spoken form ("?", "✓") is outside the denominator.
   */
  matchedCharFraction: number;
  source: "tts" | "estimated";
  validTiming: boolean;
  reason?: string;
  /**
   * How long the pen may wait for the first cue before it starts anyway.
   * Infinite for an exact schedule (the alignment is the truth); a share of
   * the estimated duration for an estimate.
   */
  maxInitialWaitMs: number;
}

/**
 * A schedule is unusable when its last cue lands after the sentence, which is
 * what a misaligned stream looks like. A late first cue is not a fault any
 * more: a formula spoken at 70% of the sentence is written at 70%.
 */
export function isWriteScheduleUsable(
  schedule: WriteCharSchedule,
  narration: string,
  segmentDurationMs?: number,
  msPerChar = defaultSpeechMsPerChar,
): boolean {
  if (!schedule.matched || schedule.offsetsMs.length === 0) {
    return false;
  }

  const spoken = mathToSpeech(narration.trim());
  const durationMs = Math.max(
    segmentDurationMs && segmentDurationMs > 0
      ? segmentDurationMs
      : spoken.length * clampSpeechMsPerChar(msPerChar),
    700,
  );

  const lastOffsetMs = schedule.offsetsMs[schedule.offsetsMs.length - 1] ?? 0;

  return lastOffsetMs <= durationMs * 1.12;
}

interface TokenPlan {
  token: string;
  /** Letterable characters (the pen skips whitespace). */
  count: number;
  /** Pure punctuation: no spoken form, rides with a neighbour, outside the fraction. */
  silent: boolean;
  candidates: string[][];
  /** Where the voice says it, as narration word indices; null when it never does. */
  match: PhraseMatch | null;
  /** Found, but said out of board order; timed beside its neighbours instead. */
  outOfOrder: boolean;
  /** Timed by the alignment (in the monotonic chain). */
  anchored: boolean;
  startMs: number;
  endMs: number;
}

const LOOKBACK_TOKENS = 3;

/**
 * Locate every board token in the narration words, in order. On a miss the
 * search retries from where the cursor stood up to three located tokens
 * earlier, for rows the voice says out of order ("solution: x = 4" said as
 * "x equals four. that is the solution").
 */
function locateTokens(plans: TokenPlan[], wordTexts: readonly string[], initialCursor: number): void {
  let cursor = initialCursor;
  const cursorHistory: number[] = [];
  let lookbackFloor = 0;
  // Words a token already owns; a look-back never hands the same word to a
  // second token ("11 = 11" must not put both elevens on one "eleven").
  const taken: boolean[] = new Array<boolean>(wordTexts.length).fill(false);
  const take = (match: PhraseMatch): void => {
    for (let k = match.start; k < match.end; k++) {
      taken[k] = true;
    }
  };

  for (const plan of plans) {
    if (plan.silent || plan.candidates.length === 0) {
      continue;
    }
    const forward = earliestCandidateMatch(wordTexts, plan.candidates, cursor);
    if (forward) {
      plan.match = forward;
      take(forward);
      cursorHistory.push(cursor);
      if (cursorHistory.length > LOOKBACK_TOKENS) {
        cursorHistory.shift();
      }
      cursor = forward.end;
      continue;
    }
    const lookbackFrom = Math.max(cursorHistory[0] ?? initialCursor, lookbackFloor);
    if (lookbackFrom < cursor) {
      const behind = earliestCandidateMatch(wordTexts, plan.candidates, lookbackFrom, cursor, taken);
      if (behind) {
        plan.match = behind;
        plan.outOfOrder = true;
        take(behind);
        lookbackFloor = behind.end;
      }
    }
  }
}

/**
 * Keep the longest board-ordered chain of located tokens (most tokens, then
 * the most letters outside stop words) as the timed ones. A single label
 * said out of order loses to the three tokens of maths said in order; a
 * lone "is" found behind the cursor loses to the letter the voice named.
 */
function anchorMonotonicChain(plans: TokenPlan[]): void {
  const located = plans.filter((plan) => plan.match !== null);
  const n = located.length;
  if (n === 0) {
    return;
  }
  const bestCount = new Array<number>(n).fill(1);
  const bestStrength = located.map((plan) => phraseStrength(plan.match!.candidate));
  const previous = new Array<number>(n).fill(-1);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (located[j]!.match!.end > located[i]!.match!.start) {
        continue;
      }
      const count = bestCount[j]! + 1;
      const strength = bestStrength[j]! + phraseStrength(located[i]!.match!.candidate);
      if (count > bestCount[i]! || (count === bestCount[i]! && strength > bestStrength[i]!)) {
        bestCount[i] = count;
        bestStrength[i] = strength;
        previous[i] = j;
      }
    }
  }

  let bestIndex = 0;
  for (let i = 1; i < n; i++) {
    if (
      bestCount[i]! > bestCount[bestIndex]! ||
      (bestCount[i] === bestCount[bestIndex] && bestStrength[i]! > bestStrength[bestIndex]!)
    ) {
      bestIndex = i;
    }
  }

  for (let i = bestIndex; i >= 0; i = previous[i]!) {
    located[i]!.anchored = true;
  }
  for (const plan of located) {
    if (!plan.anchored) {
      plan.outOfOrder = true;
    }
  }
}

/**
 * Give every token that has no spoken span a window beside its neighbours at
 * floor pace: the first after the previous anchored token, the rest ahead of
 * the next one. Nothing is smeared to the end of the sentence any more; that
 * left one glyph then an 800 ms park on every unmatched row measured.
 */
function attachUnanchoredTokens(plans: TokenPlan[]): void {
  const floor = WRITE_INK_FLOOR_MS_PER_CHAR;
  let i = 0;
  while (i < plans.length) {
    if (plans[i]!.anchored) {
      i++;
      continue;
    }
    let j = i;
    while (j < plans.length && !plans[j]!.anchored) {
      j++;
    }
    const previous = i > 0 ? plans[i - 1]! : null;
    const next = j < plans.length ? plans[j]! : null;
    const run = plans.slice(i, j);

    let forwardCount = 0;
    if (previous) {
      forwardCount = next ? 1 : run.length;
    }
    let cursor = previous ? previous.endMs : 0;
    for (let k = 0; k < forwardCount; k++) {
      const plan = run[k]!;
      plan.startMs = cursor;
      // Fill the room before the next spoken word, at no more than the
      // ceiling pace; with nothing after it, floor pace.
      const room = next ? Math.max(next.startMs - cursor, 0) : plan.count * floor;
      plan.endMs = cursor + Math.min(room, plan.count * WRITE_INK_CEILING_MS_PER_CHAR);
      cursor = plan.endMs;
    }
    if (next) {
      let end = next.startMs;
      for (let k = run.length - 1; k >= forwardCount; k--) {
        const plan = run[k]!;
        plan.endMs = Math.max(end, cursor);
        plan.startMs = Math.max(plan.endMs - plan.count * floor, cursor);
        end = plan.startMs;
      }
    }
    i = j;
  }
}

function scheduleFromPlans(plans: TokenPlan[]): { offsetsMs: number[]; charDurationsMs: number[] } {
  const offsetsMs: number[] = [];
  const charDurationsMs: number[] = [];
  let last = 0;
  for (const plan of plans) {
    const start = Math.max(plan.startMs, 0);
    const end = Math.max(plan.endMs, start);
    const count = Math.max(plan.count, 1);
    const slot = (end - start) / count;
    for (let c = 0; c < plan.count; c++) {
      let offset = Math.round(start + slot * c);
      if (offset < last) {
        offset = last;
      }
      offsetsMs.push(offset);
      charDurationsMs.push(Math.max(Math.round(slot), 0));
      last = offset;
    }
  }
  return { offsetsMs, charDurationsMs };
}

/**
 * Builds a per-character writing schedule so each token of a WRITE/LABEL command
 * is drawn while the narrator speaks it. Returns one start offset (ms from
 * audio start) per non-space character of `command.text`, in document order,
 * which matches the order `textToStrokePaths` emits characters (it skips spaces).
 *
 * Each board token (whitespace-separated) is matched against the spoken words
 * as a whole phrase, in any of its spoken forms: "5x" while "five x" or "five
 * times x" is said, "=" while "equals" or "is" is said, "/" while "over" is
 * said. A token the voice never says is lettered beside its neighbour at
 * floor pace. Null when no token is spoken at all, so the caller can fall
 * back to a spread.
 */
export function getWriteCharScheduleMs(
  narration: string,
  command: DrawCommand,
  timings?: AudioTimings | null,
  textCommandIndex = 0,
): WriteCharSchedule | null {
  const text = command.text ?? "";
  const nonSpaceCount = text.replace(/\s/g, "").length;
  if (nonSpaceCount === 0) {
    return null;
  }

  if (!timings || timings.charStartTimes.length === 0 || timings.totalDuration <= 0) {
    return null;
  }

  const normalizedTimings = normalizeSegmentTimings(narration, timings);
  const timingValidation = validateAudioTimingsForNarration(narration, normalizedTimings);
  if (!timingValidation.valid) {
    return null;
  }

  const spokenNarration = mathToSpeech(narration.trim());
  const spokenWords = tokenizeSpokenNarration(spokenNarration);
  const wordTexts = spokenWords.map((word) => word.text);
  if (wordTexts.length === 0) {
    return null;
  }

  const tokens = text.split(/\s+/).filter((token) => token.length > 0);
  const plans: TokenPlan[] = tokens.map((token, index) => {
    const candidates = boardTokenSpokenCandidates(token, tokens[index - 1]);
    return {
      token,
      count: token.length,
      silent: candidates.length === 0,
      candidates,
      match: null,
      outOfOrder: false,
      anchored: false,
      startMs: 0,
      endMs: 0,
    };
  });

  let cursor = 0;
  if (textCommandIndex > 0) {
    const first = plans.find((plan) => !plan.silent);
    if (first) {
      let nth = -1;
      for (const candidate of first.candidates) {
        const at = findNthPhrase(wordTexts, candidate, textCommandIndex);
        if (at >= 0 && (nth < 0 || at < nth)) {
          nth = at;
        }
      }
      if (nth >= 0) {
        cursor = nth;
      }
    }
  }

  locateTokens(plans, wordTexts, cursor);
  anchorMonotonicChain(plans);

  for (const plan of plans) {
    if (!plan.anchored || !plan.match) {
      continue;
    }
    const span = wordSpanMs(spokenWords, normalizedTimings, plan.match.start, plan.match.end);
    if (!span) {
      return null;
    }
    plan.startMs = span.startMs;
    plan.endMs = span.endMs;
  }

  const letterable = plans.filter((plan) => !plan.silent);
  const letterableChars = letterable.reduce((sum, plan) => sum + plan.count, 0);
  // A token counts as spoken when it is timed by the voice, or when it was
  // found out of order on a real word ("solution", "image"). A stop word
  // found behind the cursor ("=" latching onto the "is" of "f is the focal
  // length") is not the row being said.
  const locatedChars = letterable.reduce(
    (sum, plan) =>
      sum +
      (plan.match && (plan.anchored || phraseStrength(plan.match.candidate) > 0) ? plan.count : 0),
    0,
  );
  const matchedCharFraction = letterableChars > 0 ? locatedChars / letterableChars : 0;
  if (!plans.some((plan) => plan.anchored)) {
    return null;
  }

  attachUnanchoredTokens(plans);
  const { offsetsMs, charDurationsMs } = scheduleFromPlans(plans);

  return {
    offsetsMs,
    charDurationsMs,
    matched: matchedCharFraction > 0,
    matchedCharFraction,
    source: "tts",
    validTiming: true,
    maxInitialWaitMs: Number.POSITIVE_INFINITY,
  };
}

/**
 * The same matcher against a script clock: every spoken character takes
 * `msPerChar` (the session's measured rate, or the 86 ms default). No
 * velocity hump: the old sinusoid made the nominal rate and the effective
 * one differ by 19%, so no two estimates in the runner agreed.
 */
export function getEstimatedWriteCharScheduleMs(
  narration: string,
  command: DrawCommand,
  textCommandIndex = 0,
  msPerChar = defaultSpeechMsPerChar,
): WriteCharSchedule | null {
  const spokenNarration = mathToSpeech(narration.trim());
  if (spokenNarration.length === 0) {
    return null;
  }

  const rate = clampSpeechMsPerChar(msPerChar);
  const n = spokenNarration.length;
  const charStartTimes: number[] = [];
  const charDurations: number[] = [];
  for (let i = 0; i < n; i++) {
    charStartTimes.push((i * rate) / 1000);
    charDurations.push(rate / 1000);
  }
  const totalMs = n * rate;

  const schedule = getWriteCharScheduleMs(narration, command, {
    charStartTimes,
    charDurations,
    totalDuration: totalMs / 1000,
  }, textCommandIndex);

  if (!schedule?.matched) {
    return null;
  }

  return {
    ...schedule,
    source: "estimated",
    validTiming: false,
    reason: "estimated-from-script",
    maxInitialWaitMs: Math.round(totalMs * ESTIMATED_FIRST_CUE_MAX_FRACTION),
  };
}

/**
 * When board text is not spoken token-for-token, still write during speech:
 * never dump the whole line before the voice starts or after it finishes.
 * Spreads characters across the latter half of the estimated narration window.
 */
export function getFallbackWriteCharScheduleMs(
  narration: string,
  command: DrawCommand,
  msPerChar = defaultSpeechMsPerChar,
): WriteCharSchedule | null {
  const text = command.text ?? "";
  const nonSpaceCount = text.replace(/\s/g, "").length;
  if (nonSpaceCount === 0) {
    return null;
  }

  const rate = clampSpeechMsPerChar(msPerChar);
  const spokenNarration = mathToSpeech(narration.trim());
  const estimatedTotalMs = Math.max(
    spokenNarration.length > 0 ? spokenNarration.length * rate : narration.length * rate,
    700,
  );
  const startMs = Math.round(estimatedTotalMs * 0.40);
  const endMs = Math.round(estimatedTotalMs * 0.90);
  const span = Math.max(endMs - startMs, nonSpaceCount * 48);

  const offsetsMs: number[] = [];
  const charDurationsMs: number[] = [];
  for (let i = 0; i < nonSpaceCount; i++) {
    const offset = Math.round(startMs + (span * i) / nonSpaceCount);
    const next = Math.round(startMs + (span * (i + 1)) / nonSpaceCount);
    offsetsMs.push(offset);
    charDurationsMs.push(Math.max(next - offset, 0));
  }

  return {
    offsetsMs,
    charDurationsMs,
    matched: false,
    matchedCharFraction: 0,
    source: "estimated",
    validTiming: false,
    reason: "fallback-spread-during-speech",
    maxInitialWaitMs: Number.POSITIVE_INFINITY,
  };
}

/**
 * Select the strongest schedule currently available. This is deliberately
 * usable before audio starts: the estimated schedule is anchored to the audio
 * clock later, so a slow TTS connection never forces unscheduled handwriting.
 */
export function getBestWriteCharScheduleMs(
  narration: string,
  command: DrawCommand,
  timings?: AudioTimings | null,
  segmentDurationMs?: number,
  textCommandIndex = 0,
  msPerChar = defaultSpeechMsPerChar,
): WriteCharSchedule | null {
  const timed = getWriteCharScheduleMs(
    narration,
    command,
    timings,
    textCommandIndex,
  );
  if (timed && isWriteScheduleUsable(timed, narration, segmentDurationMs, msPerChar)) {
    return timed;
  }

  const estimated = getEstimatedWriteCharScheduleMs(
    narration,
    command,
    textCommandIndex,
    msPerChar,
  );
  if (estimated && isWriteScheduleUsable(estimated, narration, segmentDurationMs, msPerChar)) {
    return timed
      ? { ...estimated, reason: "tts-schedule-unusable" }
      : estimated;
  }

  return getFallbackWriteCharScheduleMs(narration, command, msPerChar);
}

/**
 * Pull a schedule forward when its first cue is further away than the pen
 * may wait. Pass the schedule's own `maxInitialWaitMs`: an exact schedule
 * never moves (the alignment says when the word is spoken, and the pen goes
 * to the row and waits for it), an estimated one may wait for
 * ESTIMATED_FIRST_CUE_MAX_FRACTION of the sentence. The old 250 ms cap
 * dragged "v = ?" from 2055 ms to 250 ms and the row was done 5 s before the
 * voice reached it.
 */
export function leadWriteScheduleToSpeech(
  offsetsMs: number[],
  audioPositionMs: number,
  maxInitialWaitMs = Number.POSITIVE_INFINITY,
): number[] {
  if (offsetsMs.length === 0 || !Number.isFinite(maxInitialWaitMs)) {
    return offsetsMs;
  }
  const firstOffsetMs = offsetsMs[0] ?? 0;
  const waitMs = firstOffsetMs - audioPositionMs;
  if (waitMs <= maxInitialWaitMs) {
    return offsetsMs;
  }
  const shiftMs = waitMs - maxInitialWaitMs;
  return offsetsMs.map((offset) => Math.max(Math.round(offset - shiftMs), Math.round(audioPositionMs)));
}

/**
 * If the pen is already late for the first character, keep future cues and
 * pull overdue characters to "now" so writing catches the voice instead of
 * sliding the whole formula later in the sentence.
 */
export function catchUpWriteScheduleOffsets(
  offsetsMs: number[],
  audioPositionMs: number,
): number[] {
  if (offsetsMs.length === 0) {
    return offsetsMs;
  }
  const firstOffsetMs = offsetsMs[0] ?? 0;
  if (audioPositionMs <= firstOffsetMs + 80) {
    return offsetsMs;
  }
  return offsetsMs.map((offset) => (offset < audioPositionMs ? Math.round(audioPositionMs) : offset));
}

export interface DrawingDurations {
  DRAW_CUBOID: number;
  DRAW_CUBE: number;
  DRAW_RECT: number;
  DRAW_CIRCLE: number;
  DRAW_ARC: number;
  DRAW_POINT: number;
  DRAW_LINE: number;
  WRITE: number;
  LABEL: number;
  UNDERLINE: number;
  CIRCLE_AROUND: number;
  ARROW: number;
  HIGHLIGHT: number;
  FOCUS: number;
  EMPHASIZE: number;
  SUPERSEDE: number;
  ANNOTATE: number;
  SCRIBBLE: number;
  DIMENSION: number;
  CLEAR: number;
  PAUSE: number;
  ERASE: number;
}

const WRITE_MS_PER_CHAR = 38;
const MIN_WRITE_MS = 420;
const MAX_WRITE_MS = 3200;

const DEFAULT_DRAWING_DURATIONS: DrawingDurations = {
  DRAW_CUBOID: 1800,
  DRAW_CUBE: 1400,
  DRAW_RECT: 1200,
  DRAW_CIRCLE: 1200,
  DRAW_ARC: 900,
  DRAW_POINT: 280,
  DRAW_LINE: 600,
  WRITE: 0,
  LABEL: 0,
  UNDERLINE: 350,
  CIRCLE_AROUND: 700,
  ARROW: 500,
  HIGHLIGHT: 250,
  FOCUS: 900,
  EMPHASIZE: 420,
  SUPERSEDE: 400,
  ANNOTATE: 700,
  SCRIBBLE: 400,
  DIMENSION: 900,
  CLEAR: 200,
  PAUSE: 500,
  ERASE: 1500,
};

export function getDrawingDuration(
  command: DrawCommand,
  pace: InkPace = "follow",
): number {
  switch (command.type) {
    // A frame swap wipes the diagram zone and redraws the next figure of the
    // worked example. The redraw's own ink is timed by the nested commands;
    // this is the beat the narration gets to say what changed, and it is
    // deliberately unhurried — the whole complaint about these lessons was
    // that the picture moved faster than it could be read.
    case "FRAME":
      return FRAME_SWAP_MS;
    // Moving the marker onto the figure costs the flight and nothing else:
    // it draws no ink, so it must not take a share of the spoken window away
    // from the words it travels with.
    case "POINT":
      return 0;
    case "TYPE": {
      // Code is read, not spoken. Do not share handwriting's 3.2s cap — that
      // compressed whole functions into a few seconds of speech.
      const visible = Math.max(
        1,
        [...(command.text ?? "")].filter((char) => !/\s/.test(char)).length,
      );
      return Math.min(
        Math.max(visible * CODE_TYPE_MS_PER_CHAR, 1_200),
        CODE_TYPE_MAX_BLOCK_MS,
      );
    }
    case "WRITE":
    case "LABEL":
    case "DIMENSION": {
      const charCount = command.text?.length ?? 1;
      if (pace === "scene") {
        return Math.min(
          Math.max(charCount * SCENE_WRITE_MS_PER_CHAR, SCENE_WRITE_MIN_MS),
          SCENE_WRITE_MAX_MS,
        );
      }
      return Math.min(
        Math.max(charCount * WRITE_MS_PER_CHAR, MIN_WRITE_MS),
        MAX_WRITE_MS,
      );
    }
    case "PAUSE":
      return command.params[0] ?? 500;
    case "ERASE": {
      const [, , eraseWidth, eraseHeight] = command.params;
      const area = Math.abs((eraseWidth ?? 0) * (eraseHeight ?? 0));
      return Math.max(Math.min(Math.round(area / 50), 3000), 800);
    }
    default: {
      const baseMs = DEFAULT_DRAWING_DURATIONS[command.type] ?? 1500;
      if (pace === "scene") {
        return applySceneDuration(baseMs);
      }
      if (
        command.type === "FOCUS" ||
        command.type === "EMPHASIZE" ||
        command.type === "SUPERSEDE" ||
        command.type === "ANNOTATE"
      ) {
        return Math.round(baseMs * FOLLOW_FOCUS_SCALE);
      }
      return baseMs;
    }
  }
}

export function getFlightDuration(
  command: DrawCommand,
  pace: InkPace = "follow",
): number {
  let baseMs = 300;
  if (command.type === "CLEAR") baseMs = 0;
  else if (command.type === "PAUSE") baseMs = 0;
  // TYPE has no pen: characters appear in the code panel with zero approach.
  else if (command.type === "TYPE") baseMs = 0;
  else if (command.type === "WRITE" || command.type === "LABEL") baseMs = 50;
  else if (command.type === "DIMENSION") baseMs = 120;
  else if (command.type === "ERASE") baseMs = 500;
  else if (
    command.type === "UNDERLINE" ||
    command.type === "CIRCLE_AROUND" ||
    command.type === "ARROW" ||
    command.type === "HIGHLIGHT" ||
    command.type === "FOCUS" ||
    command.type === "EMPHASIZE" ||
    command.type === "SUPERSEDE" ||
    command.type === "ANNOTATE" ||
    command.type === "SCRIBBLE"
  ) {
    baseMs = 200;
  }
  if (pace === "scene" && baseMs > 0) {
    return applySceneFlight(baseMs);
  }
  return baseMs;
}

export function getCommandDrawDurationMs(
  command: DrawCommand | null,
  pace: InkPace = "follow",
): number {
  if (!command) {
    return 0;
  }

  if (command.type === "PAUSE") {
    return command.params[0] ?? 500;
  }

  if (command.type === "CLEAR") {
    return getDrawingDuration(command, pace);
  }

  return getFlightDuration(command, pace) + getDrawingDuration(command, pace);
}

export function getSegmentDuration(
  command: DrawCommand | null,
  audioTimings?: AudioTimings | null,
): number {
  const audioMs = audioTimings?.totalDuration
    ? Math.round(audioTimings.totalDuration * 1000)
    : 0;
  const drawMs = getCommandDrawDurationMs(command);

  return Math.max(audioMs, drawMs, 300);
}
