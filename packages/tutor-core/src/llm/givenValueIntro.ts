/**
 * Runtime-owned opening for problem-solving turns.
 *
 * If the submitted question states values, write them first as "Given: ...",
 * then the verified figure can be revealed and the teaching stream can solve.
 * The teaching model must not restate or rewrite this list.
 */
import { WORK_ZONE, measureTextWidth, workRowFontSize, type TutorSegment } from "@heytutor/drawing";
import { isConceptLessonQuestion } from "./reasoningEffort";
import type { NarrationLanguage } from "./hinglishNarration";

export interface QuestionGiven {
  symbol: string;
  board: string;
  spoken: string;
}

/** A row this code could write, and whether the question positively states it. */
interface GivenCandidate extends QuestionGiven {
  stated: boolean;
}

interface TurnPlanLike {
  givens?: unknown;
  unknowns?: unknown;
}

const ASK_SPLIT =
  /\b(?:find|calculate|locate|determine|compute|evaluate|how much|what is|show that|draw the)\b/i;
/** What is to be shown is not given, though a row may reach this far in the statement. */
const NOT_GIVEN_FROM = /\b(?:prove|derive|verify)\b/i;

const UNIT_SPEECH: ReadonlyArray<readonly [RegExp, string]> = [
  [/m\/s\^2|m\/s²/i, "meters per second squared"],
  [/m\/s/i, "meters per second"],
  [/^cm$/i, "centimeters"],
  [/^mm$/i, "millimeters"],
  [/^km$/i, "kilometers"],
  [/^kg$/i, "kilograms"],
  [/^(?:Ω|ohms?)$/i, "ohms"],
  [/^amp(?:ere)?s?$/i, "amperes"],
  [/^volts?$/i, "volts"],
  [/^newtons?$/i, "newtons"],
  [/^joules?$/i, "joules"],
  [/^watts?$/i, "watts"],
  [/^hertz$/i, "hertz"],
  [/^radians?$/i, "radians"],
  [/^(?:°|deg(?:ree)?s?)$/i, "degrees"],
  [/^s$/i, "seconds"],
  [/^g$/i, "grams"],
  [/^m$/i, "meters"],
  [/^A$/i, "amperes"],
  [/^V$/i, "volts"],
  [/^N$/i, "newtons"],
  [/^J$/i, "joules"],
  [/^W$/i, "watts"],
  [/^Hz$/i, "hertz"],
];

export function collectQuestionGivens(
  question: string,
  turnPlan?: TurnPlanLike | null,
): QuestionGiven[] {
  // "Explain Newton's first law" has no givens. Opening such a lesson with a
  // "Given:" list frames an idea as a numbered problem before a word is spoken.
  if (isConceptLessonQuestion(question)) {
    return [];
  }
  const statement = givenStatement(question);
  const unknownKeys = unknownKeysOf(turnPlan);
  const collected: GivenCandidate[] = [];
  const seen = new Set<string>();
  // A planner often emits both the qualified and the bare form of one quantity
  // — "n_glass = 1.5" and "n = 1.5" — and listing both says there are two
  // refractive indices when there is one. Same base symbol, same value, same
  // unit is the same fact; anything less exact stays two facts.
  const facts = new Set<string>();
  const add = (given: GivenCandidate | null): void => {
    if (!given) return;
    const key = normalizeKey(given.symbol);
    if (!key || seen.has(key) || unknownKeys.has(key)) return;
    const base = normalizeKey(given.symbol.split(/[_^]/)[0] ?? given.symbol);
    const rhs = given.board.slice(given.board.indexOf("=") + 1).trim();
    const fact = `${base}=${rhs}`;
    if (base && rhs && facts.has(fact)) return;
    if (base && rhs) facts.add(fact);
    seen.add(key);
    collected.push(given);
  };

  if (turnPlan && Array.isArray(turnPlan.givens)) {
    turnPlan.givens.forEach((row, index) => add(givenFromPlan(row, index, question)));
  }
  for (const assignment of assignmentsFromQuestion(statement, question)) {
    add(assignment);
  }
  if (collected.length === 0) {
    add(equationFromQuestion(statement));
  }
  // The list is chosen first and only then checked, so this check can only
  // remove a row: a row it refuses never makes room for another.
  return collected.slice(0, 8)
    .filter((given) => given.stated)
    .map(({ symbol, board, spoken }) => ({ symbol, board, spoken }));
}

const GIVEN_LEAD = "Given: ";

/**
 * Break the given list into rows that fit the work column.
 *
 * Nothing downstream reflows ink: `findWorkTextSlot` clamps the *rect* it
 * registers to the column width but `writeText` draws the whole string at the
 * requested size regardless. So a one-line "Given: ..." of several quantities
 * was drawn straight across the board and through the ray diagram. The list
 * has to arrive already fitted.
 *
 * Each row carries its own narration so the voice stays with the pen — the
 * sync rule the whole board is built on — rather than speaking every value
 * over the first row and writing the rest silently.
 */
function wrapGivenRows(
  givens: QuestionGiven[],
  maxWidth: number,
  language?: NarrationLanguage,
): { board: string; spoken: string }[] {
  const rows: QuestionGiven[][] = [];
  let current: QuestionGiven[] = [];
  // Measure at the size this column is actually written at. Measuring the
  // narrow column at the full-width size burned a row per given for no reason.
  const fontSize = workRowFontSize(maxWidth);

  const rowText = (items: QuestionGiven[], first: boolean) =>
    `${first ? GIVEN_LEAD : ""}${items.map((given) => given.board).join(", ")}`;

  for (const given of givens) {
    const first = rows.length === 0;
    const candidate = [...current, given];
    const tooWide = measureTextWidth(rowText(candidate, first), fontSize) > maxWidth;
    // A lone given that overflows on its own still gets its row: splitting
    // "45 deg" mid-token would be worse than one slightly wide line, and the
    // app clamps a stubborn row's size as a last resort.
    if (tooWide && current.length > 0) {
      rows.push(current);
      current = [given];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) rows.push(current);

  return rows.map((items, index) => ({
    board: rowText(items, index === 0),
    spoken: spokenGivenList(items, index === 0, language),
  }));
}

export interface GivenValueSegmentOptions {
  /** Spoken scaffolding follows the voice; board rows remain English. */
  language?: NarrationLanguage;
  /**
   * Widest a row may be drawn. A turn whose figure holds the right of the board
   * gets the narrow column; a text-only turn gets the whole width, so a short
   * given list does not burn three rows for no reason.
   */
  maxWidth?: number;
}

export function buildGivenValueSegments(
  question: string,
  turnPlan?: TurnPlanLike | null,
  options: GivenValueSegmentOptions = {},
): TutorSegment[] {
  const givens = collectQuestionGivens(question, turnPlan);
  if (givens.length === 0) return [];
  const maxWidth = options.maxWidth ?? WORK_ZONE.maxTextWidth;
  return wrapGivenRows(givens, maxWidth, options.language).map((row, index) => ({
    narration: row.spoken,
    command: {
      type: "WRITE",
      params: [WORK_ZONE.marginX, WORK_ZONE.topY + index * WORK_ZONE.lineHeight],
      text: row.board,
      charPosition: 0,
      narrationBefore: row.spoken,
      syncable: true,
    },
  }));
}

export function givenValuesPromptAddon(hasGivens: boolean): string {
  if (!hasGivens) return "";
  return `GIVEN VALUES ARE ALREADY ON THE BOARD
The runtime already spoke the opening line, wrote the given quantities as "Given: ..." and will reveal any verified figure next. Do not rewrite those givens as a second list, do not say what the question asks for again, and do not read the question back.
Start by saying what each of those symbols physically is, and [WRITE] that meaning line first. If a figure is visible, read it next: name each labeled part, say what it represents and which way it points or where it acts, and [FOCUS:entity_id] on the part you just named.
Then write each general formula in symbols before substituting the given values, write the rearranged form, write the substitution with its units, write the result, and close with one line reading what the result means. Write each working line as you speak it. Every step must [WRITE] or [FOCUS] so the marker moves with the voice. Use [EMPHASIZE:last] to box the current work line when you want the student to hold it.`;
}

function givenFromPlan(raw: unknown, index: number, question: string): GivenCandidate | null {
  if (!isRecord(raw)) return null;
  if (raw.provenance !== undefined && raw.provenance !== "given") return null;
  if (typeof raw.value !== "number" || !Number.isFinite(raw.value)) return null;
  const named = compactSymbol(raw.symbol);
  const symbol = named ?? compactSymbol(raw.id) ?? `q${index + 1}`;
  const unit = displayUnit(raw.unit);
  // "Given: ..." asserts that the *question* stated this value, so the number
  // itself has to be findable in the question. Nothing softer holds: asked for
  // "the first law of physics with an example problem", the planner invented a
  // whole friction problem — F = 10 N, m = 2 kg, mu = 0.2, g = 9.8 — each with
  // a confident sourceText ("applied horizontal force") and each marked
  // provenance "given". A plausible sourceText is not evidence, and a
  // one-letter symbol matched as a substring is worse than none: "m" is inside
  // "the first law of physics", so the old symbol test passed every time.
  if (!questionStatesValue(question, raw.value)) {
    return null;
  }
  const board = `${symbol} = ${boardNumber(raw.value, raw.sourceText, [raw.label, symbol, raw.id])}${unit ? ` ${unit}` : ""}`;
  return {
    symbol,
    board,
    spoken: `${speakSymbol(symbol)} equals ${speakNumber(raw.value)}${unit ? ` ${speakUnit(unit)}` : ""}`,
    // A plan's internal id is never a symbol the question wrote.
    stated: named !== null && questionLiterallyStates(question, raw.value, named, unit),
  };
}

/** Where a statement stops stating: at the answer options, or at what is to be shown. */
function statedEnd(statement: string): number {
  const shown = NOT_GIVEN_FROM.exec(statement)?.index ?? statement.length;
  return Math.min(shown, withoutAnswerOptions(statement).length);
}

function assignmentsFromQuestion(statement: string, question: string): GivenCandidate[] {
  const givens: GivenCandidate[] = [];
  const end = statedEnd(statement);
  const { reassigned } = statedOf(withoutAnswerOptions(question));
  const pattern =
    /(?:^|[,;]|\s)((?:d[A-Za-z]\/d[A-Za-z]|[A-Za-z][A-Za-z0-9_/^']{0,12}))\s*=\s*/g;
  for (const match of statement.matchAll(pattern)) {
    const symbol = compactSymbol(match[1]);
    const valueStart = (match.index ?? 0) + match[0].length;
    const sourceRhs = readAssignmentRhs(statement, valueStart);
    if (sourceRhs === null) continue;
    const rhs = compactRhs(sourceRhs);
    if (!symbol || !rhs || !hasGivenContent(rhs)) continue;
    if (isAskedUnknownAssignment(statement, symbol)) continue;
    const symbolStart = (match.index ?? 0) + match[0].indexOf(match[1]!);
    givens.push({
      symbol,
      board: `${symbol} = ${rhs}`,
      spoken: `${speakSymbol(symbol)} equals ${speakRhs(rhs)}`,
      stated: symbolStart < end && isPlainValue(rhs) && standsAlone(statement, symbolStart) && !reassigned.has(symbol) &&
        !continuesAsList(statement, valueStart),
    });
  }
  return givens;
}

function readAssignmentRhs(statement: string, start: number): string | null {
  const closing: string[] = [];
  let end = start;
  for (; end < statement.length; end++) {
    const char = statement[end]!;
    if (closing.length === 0 && (
      char === "," || char === ";" || char === "\n" ||
      char === "." && /\s/.test(statement[end + 1] ?? "") ||
      /^and\b/.test(statement.slice(end)) && /\s/.test(statement[end - 1] ?? "")
    )) break;
    if (char === "[" || char === "(" || char === "{") {
      closing.push(char === "[" ? "]" : char === "(" ? ")" : "}");
    } else if (char === "]" || char === ")" || char === "}") {
      if (closing.pop() !== char) return null;
    }
  }
  return closing.length === 0 ? statement.slice(start, end) : null;
}

function equationFromQuestion(statement: string): GivenCandidate | null {
  const match = /([^\n=]{1,48}=\s*[^\n=]{1,48})/.exec(statement);
  if (!match || readAssignmentRhs(match[1], match[1].indexOf("=") + 1) === null) return null;
  const equation = compactRhs(match[1]).replace(
    /^(?:solve|simplify|evaluate|consider|given)\s+/i,
    "",
  );
  if (!equation || !/\d/.test(equation) || !/=/.test(equation)) return null;
  return {
    symbol: "equation",
    board: equation,
    spoken: speakRhs(equation),
    // An equation is not a symbol equal to a value. It stays on this list only so
    // that refusing it cannot change which rows the list holds.
    stated: false,
  };
}

function spokenGivenList(givens: QuestionGiven[], lead = true, language?: NarrationLanguage): string {
  const parts = givens.map((given) => given.spoken);
  if (language === "hinglish") {
    return parts.map((part, index) => `${index === 0 && lead ? "दिया है" : "और"} ${part}.`).join(" ");
  }
  // Ellipsis is a short breath in ElevenLabs — "Given", then the values. Only
  // the first row says it; a continuation row just carries on listing.
  const opener = lead ? "Given... " : "";
  if (parts.length === 1) return `${opener}${parts[0]}.`;
  if (parts.length === 2) return `${opener}${parts[0]}. And ${parts[1]}.`;
  return `${opener}${parts.slice(0, -1).join(". ")}. And ${parts.at(-1)}.`;
}

/** Labelled choices, a first label and then its second, start the options. A lone "(a)" is a part of the question. */
const OPTION_LABELS: ReadonlyArray<readonly [RegExp, RegExp]> = [
  [/(?:^|\s)(?:\(\s*[Aa]\s*\)|[Aa]\))\s/, /(?:^|\s)(?:\(\s*[Bb]\s*\)|[Bb]\))\s/],
  [/(?:^|\s)[Aa]\.\s/, /\s[Bb]\.\s/],
];

function withoutAnswerOptions(question: string): string {
  let end = question.length;
  for (const [firstLabel, secondLabel] of OPTION_LABELS) {
    const first = firstLabel.exec(question);
    if (first && secondLabel.test(question.slice(first.index + first[0].length))) end = Math.min(end, first.index);
  }
  const named = /\b(?:options|choices)\s*:/i.exec(question);
  return question.slice(0, named ? Math.min(end, named.index) : end);
}

function givenStatement(question: string): string {
  return (question.split(ASK_SPLIT)[0] ?? question).trim();
}

function unknownKeysOf(turnPlan?: TurnPlanLike | null): Set<string> {
  const keys = new Set<string>();
  if (!turnPlan || !Array.isArray(turnPlan.unknowns)) return keys;
  for (const unknown of turnPlan.unknowns) {
    if (!isRecord(unknown)) continue;
    const symbol = compactSymbol(unknown.symbol);
    const id = compactSymbol(unknown.id);
    if (symbol) keys.add(normalizeKey(symbol));
    if (id) keys.add(normalizeKey(id));
  }
  return keys;
}

function isAskedUnknownAssignment(statement: string, symbol: string): boolean {
  return new RegExp(
    `\\b(?:find|calculate|locate|determine|compute)\\s+${escapeRegExp(symbol)}\\b`,
    "i",
  ).test(statement);
}

function hasGivenContent(rhs: string): boolean {
  return /\d|[a-z]/i.test(rhs);
}

/** SI prefixes and bases, and the spelled units a question uses. Anything else is not known to be a unit. */
const UNIT_TOKEN =
  /^(?:(?:[fpnuµμmcdkMGT]?(?:m|g|s|A|K|N|J|W|V|C|F|H|T|Ω|L|l|Pa|Hz|eV|mol|ohm|ohms|bar))|min|mins|h|hr|hrs|sec|secs|deg|rad|rpm|atm|torr|cal|kcal|(?:kilo|centi|milli)?(?:met(?:er|re)s?|grams?)|seconds?|minutes?|hours?|years?|days?|newtons?|joules?|watts?|volts?|amps?|amperes?|ohms?|hertz|kelvin|pascals?|coulombs?|farads?|henrys?|teslas?|moles?|lit(?:er|re)s?|degrees?|radians?|rupees?|dollars?|M|mM|kmph|kph|mph)$/;
const MATH_WORD = /^(?:sin|cos|tan|cot|sec|csc|cosec|arcsin|arccos|arctan|sinh|cosh|tanh|log|ln|exp|sqrt|pi|alpha|beta|gamma|theta|lambda|mu|omega|sigma|phi|rho|tau|epsilon|delta)$/i;

/**
 * A number with at most its unit: all a row may state. "AX = B", "y = sin x",
 * "CH2 = CH-CH2+" and "0 by completing the square" are not values.
 */
/** "10,000" and "x = 1, 2": the clause ended at a comma, but the number did not. */
function continuesAsList(text: string, start: number): boolean {
  const rhs = readAssignmentRhs(text, start);
  return rhs !== null && /^,\s*\d/.test(text.slice(start + rhs.length, start + rhs.length + WINDOW));
}

function isPlainValue(text: string): boolean {
  const match = /^[+\-−–]?\s*(?:\d+(?:\.\d+)?|\.\d+)\s*(.*)$/su.exec(text);
  if (!match) return false;
  const unit = match[1]!.trim();
  return !unit || unit === "%" || unit === "°" || unit.split(/\s+/).every(isUnitText);
}

/** A limit ("from x = 0 to x = 2"), not a stated value. */
const CONDITION_WORD = /(?:^|[^\p{L}])(?:from|to|between|until|till|through)$/iu;
const BETWEEN_LIMITS = /\bbetween\s+\S+\s*=\s*\S+(?:\s+\S+)?\s+and$/iu;
const LAST_WORD = /(?:^|[^\p{L}\p{N}_])([\p{L}\p{N}][\p{L}\p{M}\p{N}_.]*)$/u;

/**
 * "bx + c = 0" has no given c: the symbol is a term of a larger expression. So
 * does "sin x = 1/2", "3 x = 12" and "m a = 10": the word before it multiplies it
 * or applies to it. A bracket opened after a space ("(g = 10 m/s^2)") is an aside.
 */
function standsAlone(statement: string, symbolStart: number): boolean {
  const before = statement.slice(Math.max(0, symbolStart - WINDOW), symbolStart);
  const trimmed = before.trimEnd();
  if (trimmed.endsWith("(") && /(?:^|\s)\($/.test(trimmed)) return true;
  if (/[+\-*/^×·(=)\]]$/.test(trimmed) || CONDITION_WORD.test(trimmed) || BETWEEN_LIMITS.test(trimmed)) return false;
  // Only a gap separates them: "force, x = 2" has a comma, so nothing multiplies x.
  const last = /\s$/.test(before) ? LAST_WORD.exec(trimmed)?.[1] : undefined;
  // "sin² x" and "log2 x" are functions too.
  // A word with a digit or a subscript is a symbol too: "m_1 a = 10".
  return !last || !(last.length === 1 || /[\p{N}_]/u.test(last) || MATH_WORD.test(last));
}

/** How far back a value's own context can reach. Long pasted prompts stay linear. */
const WINDOW = 80;

const SPELLED_UNITS: Record<string, string> = {
  ohm: "Ω", volt: "V", amp: "A", ampere: "A", newton: "N", joule: "J", watt: "W", hertz: "Hz", kelvin: "K",
  pascal: "Pa", coulomb: "C", farad: "F", henry: "H", tesla: "T", liter: "L", litre: "L", mole: "mol", degree: "°",
  meter: "m", metre: "m", gram: "g", second: "s", minute: "min", hour: "h", deg: "°", sec: "s",
};
const SUPERSCRIPTS: Record<string, string> = { "²": "^2", "³": "^3", "⁻¹": "^-1", "⁻²": "^-2", "⁻³": "^-3" };
const PREFIX_FACTOR: Record<string, number> = { f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, "μ": 1e-6, m: 1e-3, c: 1e-2, d: 1e-1, k: 1e3, M: 1e6, G: 1e9, T: 1e12 };
const SPELLED_PREFIX: Record<string, number> = { kilo: 1e3, centi: 1e-2, milli: 1e-3 };
const BASE_UNIT = /^(m|g|s|A|K|N|J|W|V|C|F|H|T|Ω|L|Pa|Hz|eV|mol|bar)$/;
const TIME_FACTOR: Record<string, number> = { min: 60, mins: 60, h: 3600, hr: 3600, hrs: 3600 };

/** "m/s²" and "m/s^2" are one unit. */
function plainUnit(unit: string): string {
  return unit.replace(/⁻[¹²³]|[²³]/g, (mark) => SUPERSCRIPTS[mark] ?? mark);
}

/** One unit word as its base and what it is worth in that base. */
function unitPart(word: string): { base: string; factor: number } {
  // No unit is this long: it can only be opaque, and it must never recurse deep.
  if (word.length > 32) return { base: word, factor: 1 };
  const bare = word.replace(/s$/, "");
  const spelledPrefix = /^(kilo|centi|milli)(.+)$/.exec(word);
  if (spelledPrefix) {
    const inner = unitPart(spelledPrefix[2]!);
    return { base: inner.base, factor: inner.factor * SPELLED_PREFIX[spelledPrefix[1]!]! };
  }
  if (TIME_FACTOR[word]) return { base: "s", factor: TIME_FACTOR[word]! };
  const named = SPELLED_UNITS[word.toLowerCase()] ?? SPELLED_UNITS[bare.toLowerCase()];
  if (named && (word.length > 2 || word === "Ω")) return TIME_FACTOR[named] ? { base: "s", factor: TIME_FACTOR[named]! } : { base: named, factor: 1 };
  if (word === "l") return { base: "L", factor: 1 };
  if (word === "ml") return { base: "L", factor: 1e-3 };
  if (BASE_UNIT.test(word)) return { base: word, factor: 1 };
  const prefix = PREFIX_FACTOR[word[0] ?? ""];
  const rest = word.slice(1);
  if (prefix !== undefined && BASE_UNIT.test(rest)) return { base: rest, factor: prefix };
  if (prefix !== undefined && /^ohms?$/i.test(rest)) return { base: "Ω", factor: prefix };
  return { base: word, factor: 1 };
}

/** A unit as what it measures and its size, so "g mL^-1" and "g/mL" agree and "m/s" and "m/s^2" do not. */
function readUnit(unit: string): { signature: string; factor: number } {
  let factor = 1;
  const powers = new Map<string, number>();
  plainUnit(unit).trim().split("/").forEach((group, groupIndex) => {
    for (const piece of group.split(/[\s·*]+/).filter(Boolean)) {
      const match = /^(.+?)(?:\^(-?\d+))?$/.exec(piece);
      if (!match) continue;
      const part = unitPart(match[1]!);
      const power = Number(match[2] ?? 1) * (groupIndex === 0 ? 1 : -1);
      factor *= part.factor ** power;
      powers.set(part.base, (powers.get(part.base) ?? 0) + power);
    }
  });
  const signature = [...powers.entries()].filter(([, power]) => power !== 0).map(([base, power]) => `${base}^${power}`).sort().join(" ");
  return { signature, factor };
}

interface StatedQuantity {
  value: number;
  unit: string;
  /** The symbol assigned this number in the question, if any. */
  owner: string | null;
  /** The whole right side is this number and its unit. Any other value still counts as a second value. */
  plain: boolean;
}

/**
 * The number at each place the question states one as a quantity, with the unit
 * written beside it and the symbol assigned it. A term or a bound is not a value.
 */
function statedQuantities(question: string): StatedQuantity[] {
  const stated: StatedQuantity[] = [];
  for (const match of question.matchAll(/\d+(?:\.\d+)?|\.\d+/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = question.slice(Math.max(0, start - WINDOW), start).trimEnd();
    const after = question.slice(end, end + WINDOW);
    const owner = /(?<![\p{L}\p{N}_])([\p{L}][\p{L}\p{M}\p{N}_'/]*(?:\([^()]*\))?)\s*=\s*[+\-−–]?$/u.exec(before);
    // "bx + c = 0" states no c, even for a plan row named c.
    if (owner && !standsAlone(before, owner.index)) continue;
    // The whole right side has to be the value: "x = 3 times y" states no x = 3.
    // An aside closes its own bracket: "(g = 10 m/s^2)".
    const rightSide = readAssignmentRhs(question, start) ?? question.slice(start, start + WINDOW).split(")")[0]!;
    const plain = isPlainValue(rightSide.trim().replace(/[.,;:]+$/, "")) && !continuesAsList(question, start);
    // A glued word is read as written: "20cm" is a length, and "3i" matches no unit.
    const glued = /^[\p{L}µ°%Ω](?:[\p{L}\p{N}/²³⁻¹°]|\^-?)*/u.exec(after)?.[0];
    // A compound unit may be spaced ("10 N m", "1.08 g mL^-1"): read all of it.
    const spacedUnits: string[] = [];
    for (const word of /^\s/.test(after) ? after.trimStart().split(/\s+/) : []) {
      const bare = word.replace(/[.,;:)]+$/, "");
      if (!isUnitText(bare)) break;
      spacedUnits.push(bare);
      if (bare !== word) break;
    }
    const unit = (glued ?? spacedUnits.join(" ")).replace(/[.,;:]+$/, "");
    const negative = /[-−–]$/.test(before);
    stated.push({ value: (negative ? -1 : 1) * Number(match[0]), unit, owner: owner?.[1] ?? null, plain });
  }
  return stated;
}

function isUnitText(text: string): boolean {
  const parts = plainUnit(text).replace(/[.,;:]+$/, "").split(/[/·]/);
  return parts.length > 0 && parts.every((part) => /^°[CF]$/.test(part) || UNIT_TOKEN.test(part.replace(/\^-?\d+$/, "")));
}

const statedCache = new Map<string, { stated: StatedQuantity[]; reassigned: Set<string> }>();

/**
 * The question's stated quantities, and the symbols it gives more than one value:
 * "A = 0 and A = 1", "masses at x = -1 m and x = 1 m". Such a symbol has cases, not
 * a given, so neither value can be written as what the question stated.
 */
function statedOf(question: string): { stated: StatedQuantity[]; reassigned: Set<string> } {
  const cached = statedCache.get(question);
  if (cached) return cached;
  const stated = statedQuantities(question);
  const values = new Map<string, Set<string>>();
  for (const { owner, value, unit } of stated) {
    if (owner) values.set(owner, (values.get(owner) ?? new Set()).add(`${value} ${unit}`));
  }
  const entry = { stated, reassigned: new Set([...values].filter(([, seen]) => seen.size > 1).map(([owner]) => owner)) };
  // One question at a time reads a few spellings of itself: no need to keep more.
  if (statedCache.size >= 4) statedCache.clear();
  statedCache.set(question, entry);
  return entry;
}

/**
 * Does the question literally say this symbol equals this value, with this unit?
 * `questionStatesValue` asks only whether the number is somewhere in the text,
 * which is what a teaching prompt needs. A "Given:" row claims the question stated
 * it, and reading a plan's symbols onto a question's numbers has been wrong in
 * every form tried: tuples, coefficients, limits, parts of a time. So a row needs
 * the question's own words. "A 2 kg block" writes no row, and the lesson still teaches.
 */
function questionLiterallyStates(question: string, value: number, symbol: string, unit: string): boolean {
  // One value across the whole question, but stated before anything is asked of it.
  const { reassigned } = statedOf(withoutAnswerOptions(question));
  if (reassigned.has(symbol)) return false;
  const asked = givenStatement(question);
  const statedPart = asked.slice(0, statedEnd(asked));
  return statedOf(statedPart).stated.some((stated) => {
    if (stated.owner !== symbol || stated.value !== value || !stated.plain) return false;
    if (!unit || !stated.unit) return !unit && !stated.unit;
    const planned = readUnit(unit);
    const written = readUnit(stated.unit);
    return planned.signature === written.signature && planned.factor === written.factor;
  });
}

function compactSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, "");
  if (!trimmed || trimmed.length > 16) return null;
  return trimmed;
}

function compactRhs(value: string): string {
  const compacted = value.trim().replace(/\s+/g, " ").replace(/[.,;:]+$/, "");
  return compacted.length <= 40 ? compacted : "";
}

/**
 * Units that mean "this quantity has no unit". The planner writes these out in
 * full, and "n_glass = 1.5 dimensionless" on a board is worse than noise — a
 * student reads "dimensionless" as part of the value.
 */
const UNITLESS = /^(?:1|none|n\/?a|dimensionless|unitless|no\s*units?|ratio|pure\s*number)$/i;

function displayUnit(value: unknown): string {
  if (typeof value !== "string") return "";
  const unit = value.trim();
  if (!unit || UNITLESS.test(unit)) return "";
  return unit.replace(/\s+/g, " ");
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return Number(value.toPrecision(8)).toString();
}

/** Keep a plus the question wrote. An unsigned 1 is not the oxidation state +1. */
export function boardNumber(value: number, sourceText: unknown, names: unknown[]): string {
  const plain = formatNumber(value);
  if (typeof sourceText !== "string" || !(value > 0)) return plain;
  const numbers = [...sourceText.matchAll(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/g)];
  // The given's own number decides when the text writes it ("atomic number 20"
  // is not the "+2" beside it).
  const equal = numbers.filter((match) => Number(match[0]) === value);
  const own = equal.length > 1 ? nearestGivenNumber(sourceText, equal, names) : equal[0];
  // Otherwise a unit rescaling ("+2 mC" is 0.002 C) counts only when the text
  // holds one number, so the plus cannot come from another quantity.
  const scaled = !own && numbers.length === 1 &&
    VALUE_SCALES.some((scale) => Number(formatNumber(value * scale)) === Number(numbers[0]![0]))
    ? numbers[0]
    : undefined;
  const match = own ?? scaled;
  return match && writtenWithPlus(sourceText, match.index ?? 0) ? `+${plain}` : plain;
}

/** Repeated values belong to the quantity named beside them, not the first match. */
function nearestGivenNumber(
  text: string,
  numbers: RegExpMatchArray[],
  names: unknown[],
): RegExpMatchArray | undefined {
  // Qualified symbols such as valence(Na), ox_Na and f_1 name their base
  // quantity. A multi-letter abbreviation may prefix a source word (ox ->
  // oxidation); a one-letter symbol must match a whole source token.
  const stems = names.flatMap((name) => typeof name === "string"
    ? [name.split(/[_^(]/)[0]!.replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase()]
    : []).filter(Boolean);
  const words = [...text.matchAll(/[\p{L}][\p{L}\p{N}]*/gu)];
  const anchors = stems.map((stem) => stem.includes(" ")
    ? [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(stem).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "giu"))]
    : words.filter((word) => word[0].toLowerCase() === stem || stem.length >= 2 && word[0].toLowerCase().startsWith(stem)),
  ).find((matches) => matches.length > 0) ?? [];
  if (anchors.length === 0) {
    // With no identifying words, keep a sign only when every equal occurrence
    // agrees. An ambiguous source cannot donate another quantity's plus.
    const signed = numbers.map((number) => writtenWithPlus(text, number.index ?? 0));
    return signed.every((sign) => sign === signed[0]) ? numbers[0] : undefined;
  }
  const distance = (number: RegExpMatchArray): number => Math.min(...anchors.map((anchor) => {
    const left = Math.min((number.index ?? 0) + number[0].length, (anchor.index ?? 0) + anchor[0].length);
    const right = Math.max(number.index ?? 0, anchor.index ?? 0);
    // Another clause names another given: do not cross "and" or punctuation
    // to take a numerically closer value from that clause.
    const between = text.slice(left, right);
    const clauses = (between.match(/[,;]|\band\b/gi) ?? []).length;
    return clauses * (text.length + 1) + Math.max(0, right - left);
  }));
  const ranked = numbers.map((number) => ({ number, distance: distance(number) }));
  const nearest = Math.min(...ranked.map((entry) => entry.distance));
  const matches = ranked.filter((entry) => entry.distance === nearest);
  return matches.length === 1 ? matches[0]!.number : undefined;
}

/**
 * Is the number at `start` written with a plus sign ("+1", "state +1.0",
 * "= +2")? A plus after a term ("5 + 2", "5 +2", "x +2", "(a) + 1") is
 * addition, whatever the spacing; after a word ("is +2") it is a sign.
 */
function writtenWithPlus(text: string, start: number): boolean {
  let sign = start - 1;
  while (sign >= 0 && /\s/.test(text[sign]!)) sign--;
  if (text[sign] !== "+") return false;
  let end = sign - 1;
  while (end >= 0 && /\s/.test(text[end]!)) end--;
  if (end < 0 || "=([{,:;".includes(text[end]!)) return true;
  let begin = end;
  while (begin > 0 && /[A-Za-z]/.test(text[begin - 1]!)) begin--;
  const word = text.slice(begin, end + 1);
  // A one-letter "a" is an article in a prose noun phrase ("a +2 C
  // charge"), but stays a variable in bare or equation-context addition.
  const beforeWord = text.slice(0, begin).trimEnd();
  const afterNumber = text.slice(start).replace(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/, "");
  const article = /^a$/i.test(word) && /\s/.test(text[end + 1] ?? "") &&
    (!beforeWord || /[.!?,:;]$|(?:^|\s)[A-Za-z]{2,}$/.test(beforeWord)) &&
    /^\s+(?:[A-Za-z][^\s]*\s+)*[A-Za-z]{2,}\b/.test(afterNumber);
  if (article) return true;
  // A word of two or more letters is prose ("state", "is"); a lone letter,
  // number or closing bracket is a term being added to.
  return /^[A-Za-z]{2,}$/.test(word) && !/[\w)\]}]/.test(text[begin - 1] ?? "");
}

function speakNumber(value: number): string {
  return formatNumber(value).replace(/-/g, "minus ");
}

function speakSymbol(symbol: string): string {
  if (/^d[A-Za-z]\/d[A-Za-z]$/i.test(symbol)) {
    return `d ${symbol[1]} over d ${symbol[3]}`;
  }
  return symbol
    .replace(/_/g, " ")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/\//g, " over ")
    .replace(/\^/g, " to the ")
    .trim();
}

function speakRhs(rhs: string): string {
  return rhs
    .replace(/\^2\b/g, " squared")
    .replace(/\^3\b/g, " cubed")
    .replace(/\^(\d+)/g, " to the $1")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/-/g, " minus ")
    .replace(/\+/g, " plus ")
    .replace(/\*/g, " times ")
    .replace(/\//g, " over ")
    .replace(/\s+/g, " ")
    .replace(/ minus /g, ", minus ")
    .replace(/ plus /g, ", plus ")
    .trim();
}

function speakUnit(unit: string): string {
  for (const [pattern, spoken] of UNIT_SPEECH) {
    if (pattern.test(unit)) return spoken;
  }
  return unit;
}

/**
 * Common unit rescalings between a stated number and a normalised plan value:
 * a question saying "20 cm" yields a plan given of 0.2 m, and both are the same
 * stated fact. Anything outside this ladder is not a restatement of the
 * question, it is a new number.
 */
const VALUE_SCALES = [1, 10, 100, 1000, 0.1, 0.01, 0.001] as const;

/** Digits of the question, for "is this number actually in the text" tests. */
function numbersInQuestion(question: string): string[] {
  return question.match(/\d+(?:\.\d+)?/g) ?? [];
}

/**
 * True when the question itself states this value, at face value or at a
 * standard unit rescaling. This is what separates a given the student can see
 * in their own question from one the planner supplied for them.
 */
/**
 * A standard physical constant the tutor may quote without the question
 * stating it.
 *
 * `questionStatesValue` is the right gate for a value the planner invented for
 * a worked example, but it also rejects g, c and h, which no question is
 * obliged to supply. Telling the tutor to say "suppose the speed of light is
 * three times ten to the eight" would be worse than the problem it fixes.
 *
 * Both the symbol and the magnitude have to agree, because these letters are
 * all overloaded: `e` is the electronic charge and the coefficient of
 * restitution, `k` is Boltzmann's constant and a spring constant, `R` is the
 * gas constant and a resistance or a radius.
 */
const PHYSICAL_CONSTANTS: ReadonlyArray<readonly [RegExp, readonly number[]]> = [
  [/^g$/i, [9.8, 9.81, 9.807, 10]],
  [/^c$/i, [3e8, 2.998e8, 2.99792458e8]],
  [/^h$/i, [6.626e-34, 6.63e-34]],
  [/^h?bar$/i, [1.055e-34, 1.05e-34]],
  [/^e$/i, [1.6e-19, 1.602e-19]],
  [/^k(?:_?b)?$/i, [1.38e-23, 1.381e-23]],
  [/^n_?a$/i, [6.022e23, 6.02e23]],
  [/^r$/i, [8.314, 8.31]],
  [/^(?:eps(?:ilon)?|ε)_?0$/i, [8.854e-12, 8.85e-12]],
  [/^(?:mu|μ)_?0$/i, [1.257e-6, 1.256e-6, 4e-7]],
  [/^(?:sigma|σ)$/i, [5.67e-8]],
  [/^m_?e$/i, [9.11e-31, 9.109e-31]],
  [/^m_?p$/i, [1.67e-27, 1.673e-27]],
];

export function isQuotedPhysicalConstant(symbol: string, value: number): boolean {
  const trimmed = symbol.trim();
  for (const [pattern, magnitudes] of PHYSICAL_CONSTANTS) {
    if (!pattern.test(trimmed)) continue;
    if (magnitudes.some((magnitude) => Math.abs(value - magnitude) <= Math.abs(magnitude) * 0.01)) {
      return true;
    }
  }
  return false;
}

/**
 * Did the question actually state this number?
 *
 * A planner will happily invent a whole worked example and mark every value
 * `provenance: "given"` with a confident sourceText. The board's "Given: ..." row
 * asks for more than this (`questionLiterallyStates`). The teaching prompt was
 * not gated on it: it handed the model every planner given as authoritative,
 * so a lesson said "substitute the given values" over numbers the question
 * never contained, and once told a student Earth's magnetic field is one tesla.
 */
export function questionStatesValue(question: string, value: number): boolean {
  const stated = numbersInQuestion(question);
  if (stated.length === 0) return false;
  for (const scale of VALUE_SCALES) {
    const scaled = value * scale;
    if (!Number.isFinite(scaled)) continue;
    const needle = formatNumber(scaled);
    if (stated.includes(needle)) return true;
    // 20 vs "20.0", 0.5 vs ".5"
    if (stated.some((token) => Number(token) === Number(needle))) return true;
  }
  return false;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
