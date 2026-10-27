import { mathToSpeech } from "@heytutor/tutor-core";
import {
  matchClosedWriteRow,
  parseDrawingCommands,
  parseDrawingTag,
  repairCoordinateLessWriteTags,
  repairHeaderOnlyTextTags,
  scanDrawingTags,
  type DrawCommand,
} from "@heytutor/drawing";

/**
 * The pen schedules a row from the words in front of its tag. Two misses from
 * the rough-incline lectures are repaired here, after the model speaks and
 * before the board runs:
 *
 * - a relation row whose step never says "equals" (it said "has magnitude")
 * - a lesson of relations that never boxes the result
 *
 * Code lessons are left alone: a [TYPE] step is a program, not a notebook row.
 */

const RELATION = /[=<>]|\b(?:sqrt|sum|int)\b/;
const OPEN_UNKNOWN = /=\s*\?\s*$/;
const SAYS_EQUALS = /\bequals\b|\bequal to\b/i;
/** "is" used as a copula, not "is the", "is no", "is stuck", and not "there is" or "here is". */
const COPULA_IS =
  /(?<!\b(?:there|here)\s+)\bis\b(?!\s+(?:the|a|an|no|not|its|stuck|there|this|that|what|still|only|now)\b)/gi;

function isRelationWrite(command: DrawCommand): boolean {
  if (command.type !== "WRITE") return false;
  const row = (command.text ?? "").trim();
  return RELATION.test(row) && !OPEN_UNKNOWN.test(row);
}

/** The step with every tag-closed row taken out, words and tags alike. */
function withoutClosedRows(step: string): string {
  let out = "";
  let from = 0;
  for (let open = step.search(/\[WRITE[:\]]/i); open >= 0; open = step.slice(from).search(/\[WRITE[:\]]/i)) {
    const at = from + open;
    const closed = matchClosedWriteRow(step.slice(at));
    out += step.slice(from, closed ? at : at + 1);
    from = closed ? at + closed.raw.length : at + 1;
  }
  return out + step.slice(from);
}

/**
 * The first spoken word of each mathematical side after an "=" in the step's
 * relation rows: "f = μN" gives "mu", "x = b/(2a)" gives "b", "P = mgv" gives
 * "m" (spoken letter by letter). A side of plain words ("s3 = object storage",
 * "distance = rotated") is a definition, and its "is" is never an "equals".
 */
const GREEK_LETTER = /^(?:alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)$/;
/** The spoken number after "is" ("twenty five percent"), skipped before looking for a comparison. */
const NUMBER_RUN = /^(?:[\s-]+(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakh|million|point|and|percent|[\d.,%]+)(?![\p{L}\p{N}]))+/iu;
/** After the spoken number, a unit or "times" and then a comparison, or "or more". */
const COMPARISON_AFTER_NUMBER = /^(?:\s+\S+){0,2}?\s+(?:less|more|greater|smaller|fewer|higher|lower|bigger|larger|faster|slower|heavier|lighter|longer|shorter|as)\b/i;
/** "is one of the", "is one way to": a count, not the row's value. */
const COUNT_NOT_VALUE = /^\s+\S+\s+(?:of|ways?|reasons?|things?|examples?|kinds?|types?|common|key|important|big|major|main|simple|useful|classic|good|great|small|quick|easy|last|final|other|more|such|particular|single|special|standard|basic|typical|possible)\b/i;
/**
 * A value spoken in words needs strong evidence that it is a value: a unit that
 * ends the clause ("six newtons.", "sixty meters per second"), an operation with
 * its operand ("two to the power of four"), a fraction word, or two or more
 * number words ("one hundred."). A bare "one." or "one a", "one in", "one point"
 * or a unit used loosely ("ten centimeters from the lens", "ten years old") is
 * not enough: "here is one", "this is one a lot of students miss" stay as spoken.
 */
const NUMBER_WORDS = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakh|million";
const UNIT = "(?:(?:square|cubic)\\s+)?(?:rupees?|paise|dollars?|cents?|meters?|metres?|centimeters?|centimetres?|millimeters?|millimetres?|kilometers?|kilometres?|nanometers?|seconds?|milliseconds?|minutes?|hours?|years?|grams?|kilograms?|milligrams?|newtons?|joules?|kilojoules?|watts?|kilowatts?|volts?|kilovolts?|millivolts?|amperes?|amps?|milliamps?|milliamperes?|ohms?|hertz|kilohertz|megahertz|kelvin|coulombs?|celsius|tesla|pascals?|kilopascals?|moles?|radians?|liters?|litres?|milliliters?|millilitres?|farads?|microfarads?|henries|henry|webers?|atmospheres?|calories?|kilocalories?|decibels?|degrees?|electron\\s+volts?|light\\s+years?)\\b";
const OPERATION = `(?:squared|cubed|(?:over|times|plus|minus|divided\\s+by|remainder|to\\s+the\\s+power(?:\\s+of)?)\\s+(?:(?:${NUMBER_WORDS})\\b|\\d|(?![iI]\\b)\\p{L}\\b))`;
const CLAUSE_END = "\\s*(?:[,.;:!?)]|$)";
const FRACTION = "(?:half|halves|thirds?|quarters?|(?:fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\\p{L}+teenth|\\p{L}+tieth|hundredth|thousandth|millionth)s?)";
const SPOKEN_VALUE_END = new RegExp(
  `^\\s+(?:${UNIT}(?:\\s+(?:per\\s+${UNIT}|squared|cubed|${UNIT}))*${CLAUSE_END}|${OPERATION}|${FRACTION}(?:${CLAUSE_END}|\\s+${OPERATION}|\\s+(?![iI]\\b)\\p{L}\\b))`,
  "iu",
);
const RUN_TOKEN = new RegExp(`^[\\s-]+((?:${NUMBER_WORDS}|point|and|percent)|[\\d.,%]+)(?![\\p{L}\\p{N}])`, "iu");
const LARGE_UNIT = /^(?:hundred|thousand|lakh|million)$/;
const JOINER = /^(?:and|point|percent)$/;

/** True when the words after "is" are a value spoken in words, by strong evidence only. */
function isSpokenValue(after: string): boolean {
  let rest = after;
  let words = 0;
  let previous = "";
  for (let token = RUN_TOKEN.exec(rest); token; token = RUN_TOKEN.exec(rest)) {
    const word = token[1]!.toLowerCase();
    const next = RUN_TOKEN.exec(rest.slice(token[0].length))?.[1]?.toLowerCase();
    // "one hundred and five" continues; "four and five" and "one point." do not.
    if (word === "and" && !(LARGE_UNIT.test(previous) && next && !JOINER.test(next))) break;
    if (word === "point" && !(next && !JOINER.test(next))) break;
    if (word !== "and" && word !== "point") words += 1;
    previous = word;
    rest = rest.slice(token[0].length);
  }
  return SPOKEN_VALUE_END.test(rest) || (words >= 2 && new RegExp(`^${CLAUSE_END}`, "u").test(rest));
}
const SMALL_NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS_WORDS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/**
 * The first word a number is spoken with: "6" is "six", "170" is "one"
 * (hundred seventy), "45" is "forty", "0.5" is "zero" or "point". The model
 * often says the value in words, "the force is six newtons", for "F = 6 N".
 */
function spokenNumberLeads(digits: string): string[] {
  const [whole = "", fraction] = digits.split(".");
  const value = Number(whole);
  if (!Number.isSafeInteger(value)) return [];
  const leads = new Set<string>();
  // The first word, by the largest unit: 170 is "one" (hundred ...), 100000 is
  // "one" (hundred thousand), 2500000 is "two" (million ...). "a hundred" is not
  // offered: COPULA_IS never rewrites "is a".
  const firstWords = (n: number): void => {
    if (n < 20) leads.add(SMALL_NUMBER_WORDS[n]!);
    else if (n < 100) leads.add(TENS_WORDS[Math.floor(n / 10)]!);
    else {
      const head = n < 1000 ? Math.floor(n / 100) : n < 1_000_000 ? Math.floor(n / 1000) : Math.floor(n / 1_000_000);
      firstWords(head);
    }
  };
  firstWords(value);
  if (value === 0 && fraction !== undefined) leads.add("point").add("nought");
  return [...leads];
}
const MATH_MARK = /[\d+\-*/^×·÷√∫Σ²³]/;
function relationLeads(commands: readonly DrawCommand[]): Set<string> {
  const leads = new Set<string>();
  for (const command of commands) {
    if (!isRelationWrite(command)) continue;
    for (const raw of (command.text ?? "").split("=").slice(1)) {
      const side = raw.trim();
      const spokenFirst = /[\p{L}\p{N}]+/u.exec(mathToSpeech(side).toLowerCase())?.[0];
      // mathToSpeech has no name for omicron; the model says it.
      const first = spokenFirst === "ο" ? "omicron" : spokenFirst;
      if (!first) continue;
      if (/^\d/.test(first) || first.length === 1 || GREEK_LETTER.test(first) || MATH_MARK.test(side)) leads.add(first);
      const number = /^\d+(?:\.\d+)?/.exec(side)?.[0];
      if (number) for (const word of spokenNumberLeads(number)) leads.add(word);
      // A bare run of symbols ("mgv", "IR") is spoken letter by letter.
      if (/^\p{L}{2,4}$/u.test(side)) leads.add(first[0]!);
    }
  }
  return leads;
}

function narrationOutsideTags(text: string): string {
  return parseDrawingCommands(text).narration;
}

/**
 * One closed step, or a tail that never opened one. Relation rows that were
 * spoken without "equals" pick up the word. Everything else is unchanged.
 */
function repairLectureStep(rawStep: string): string {
  if (/\[TYPE[:\]]/i.test(rawStep)) return rawStep;
  // Rows the parser would repair are repaired first, so the copula and the
  // result box land on real tags, never inside a coordinate-less row.
  const step = repairCoordinateLessWriteTags(repairHeaderOnlyTextTags(rawStep));
  const parsed = parseDrawingCommands(step);
  if (!parsed.commands.some(isRelationWrite)) return step;
  // A row closed by [/WRITE] became a row only on this branch: it does not
  // widen the spoken repair. The step is rewritten only when its other rows
  // already made it a relation step, as before.
  const mainRows = parseDrawingCommands(withoutClosedRows(rawStep)).commands;
  if (!mainRows.some(isRelationWrite)) return step;
  if (SAYS_EQUALS.test(narrationOutsideTags(step))) return step;

  const tags = scanDrawingTags(step);
  const ranges: Array<[number, number]> = [];
  let cursor = 0;
  for (const tag of tags) {
    if (tag.index > cursor) ranges.push([cursor, tag.index]);
    cursor = tag.index + tag.fullTag.length;
  }
  if (cursor < step.length) ranges.push([cursor, step.length]);

  // "has magnitude" is rewritten only in speech, never inside a row's text.
  for (const [from, to] of ranges) {
    const magnitude = /\bhas magnitude\b/i.exec(step.slice(from, to));
    if (magnitude) {
      const start = from + magnitude.index;
      return `${step.slice(0, start)}equals${step.slice(start + magnitude[0].length)}`;
    }
  }

  // Only an "is" that the row's value follows is an "equals": "friction is mu
  // N" for f = μN. "pneumonia is infection", "the hypotenuse is always the
  // longest side" and "R is resistance" are descriptions, and stay as spoken.
  // Leads come from the rows main sees too, so a tag-closed row never adds one.
  const leads = relationLeads(mainRows);
  let last: { start: number; end: number } | null = null;
  for (const [from, to] of ranges) {
    const slice = step.slice(from, to);
    COPULA_IS.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = COPULA_IS.exec(slice))) {
      const after = slice.slice(match.index + match[0].length);
      const next = /^\s+([\p{L}\p{N}]+)/u.exec(after)?.[1]?.toLowerCase();
      if (!next || !leads.has(next)) continue;
      // "is ten percent less than" compares; it is not a value.
      const rest = after.replace(NUMBER_RUN, "");
      if (COMPARISON_AFTER_NUMBER.test(rest)) continue;
      // A value spoken in words needs strong evidence (isSpokenValue).
      if (/^\s+\p{L}/u.test(after) && rest !== after && (COUNT_NOT_VALUE.test(after) || !isSpokenValue(after))) continue;
      last = { start: from + match.index, end: from + match.index + match[0].length };
    }
  }
  if (!last) return step;
  return `${step.slice(0, last.start)}equals${step.slice(last.end)}`;
}

/** Where the result box goes: after the closing relation row, or null for no box. */
function resultBoxAt(raw: string): number | null {
  if (/\[EMPHASIZE[:\]]/i.test(raw)) return null;
  const parsed = parseDrawingCommands(raw);
  const relations = parsed.commands.filter(isRelationWrite);
  if (relations.length < 3) return null;

  const tags = scanDrawingTags(raw);
  let commandIndex = 0;
  let lastWrite: { index: number; length: number } | null = null;
  for (const tag of tags) {
    const parsedTag = parseDrawingTag(tag.fullTag);
    if (!parsedTag) continue;
    const command = parsed.commands[commandIndex];
    commandIndex += 1;
    if (command && isRelationWrite(command)) {
      lastWrite = { index: tag.index, length: tag.fullTag.length };
    }
  }
  return lastWrite ? lastWrite.index + lastWrite.length : null;
}

/** The end of the last WRITE tag, the row `[EMPHASIZE:last]` boxes on the board. */
function lastWriteEnd(raw: string): number | null {
  let end: number | null = null;
  for (const tag of scanDrawingTags(raw)) {
    if (parseDrawingTag(tag.fullTag)?.type === "WRITE") end = tag.index + tag.fullTag.length;
  }
  return end;
}

function ensureResultEmphasis(raw: string): string {
  const insertAt = resultBoxAt(raw);
  if (insertAt === null) return raw;
  return `${raw.slice(0, insertAt)}[EMPHASIZE:last]${raw.slice(insertAt)}`;
}

/** Repair every step, then box the closing relation when the model boxed nothing. */
export function repairLectureMarkup(raw: string): string {
  const pattern = /\[STEP\][\s\S]*?\[\/STEP\]/gi;
  let last = 0;
  let out = "";
  for (const match of raw.matchAll(pattern)) {
    const index = match.index ?? 0;
    out += raw.slice(last, index);
    out += repairLectureStep(match[0]);
    last = index + match[0].length;
  }
  out += repairLectureStep(raw.slice(last));
  return ensureResultEmphasis(out);
}

function findTag(text: string, tag: string): number {
  return text.toUpperCase().indexOf(tag);
}

/** How many characters at the end might still grow into `[STEP]` or `[/STEP]`. */
function partialBracketTail(text: string): number {
  const bracket = text.lastIndexOf("[");
  if (bracket < 0) return 0;
  const tail = text.slice(bracket).toUpperCase();
  const heads = ["[STEP]", "[/STEP]"];
  if (heads.some((head) => head.startsWith(tail) && tail.length < head.length)) {
    return text.length - bracket;
  }
  return 0;
}

/**
 * Streaming companion of `repairLectureMarkup`. `push` returns text the parser
 * can speak now. `finish` returns whatever was still held, including a result
 * box when the lesson wrote relations and never boxed one.
 */
export class LectureMarkupBuffer {
  private pending = "";
  private pushed = "";

  push(delta: string): string {
    this.pending += delta;
    let ready = "";
    while (this.pending.length > 0) {
      const start = findTag(this.pending, "[STEP]");
      if (start > 0) {
        ready += this.pending.slice(0, start);
        this.pending = this.pending.slice(start);
        continue;
      }
      if (start < 0) {
        const keep = partialBracketTail(this.pending);
        ready += this.pending.slice(0, this.pending.length - keep);
        this.pending = this.pending.slice(this.pending.length - keep);
        break;
      }
      const end = findTag(this.pending, "[/STEP]");
      if (end < 0) break;
      const close = end + "[/STEP]".length;
      const step = this.pending.slice(0, close);
      this.pending = this.pending.slice(close);
      ready += repairLectureStep(step);
    }
    this.pushed += ready;
    return ready;
  }

  /**
   * Text still owed to the parser. The saved lesson is `text()`, which keeps
   * the box inside the step that wrote the result. When that step was already
   * spoken, the parser instead receives a trailing `[EMPHASIZE:last]`, which
   * boxes the same row.
   */
  finish(): string {
    const tail = this.pending.length > 0 ? repairLectureStep(this.pending) : "";
    this.pending = "";
    const combined = this.pushed + tail;
    const at = resultBoxAt(combined);
    let saved = combined;
    let extra = tail;
    if (at !== null && at >= this.pushed.length) {
      saved = `${combined.slice(0, at)}[EMPHASIZE:last]${combined.slice(at)}`;
      extra = saved.slice(this.pushed.length);
    } else if (at !== null && at === lastWriteEnd(combined)) {
      // The result row was already spoken, and it is still the last row on
      // the board, so a trailing box lands on it.
      saved = `${combined.slice(0, at)}[EMPHASIZE:last]${combined.slice(at)}`;
      extra = `${tail}[EMPHASIZE:last]`;
    }
    // Otherwise a later row was written after the result: a trailing box would
    // frame that row, so neither the board nor the saved lesson gets one.
    this.pushed = saved;
    return extra;
  }

  /** The lesson to save and replay, after speech repair and the result box. */
  text(): string {
    return this.pushed;
  }
}
