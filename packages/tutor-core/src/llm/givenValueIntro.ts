/**
 * Runtime-owned opening for problem-solving turns.
 *
 * If the submitted question states values, write them first as "Given: ...",
 * then the verified figure can be revealed and the teaching stream can solve.
 * The teaching model must not restate or rewrite this list.
 */
import { WORK_ZONE, measureTextWidth, workRowFontSize, type TutorSegment } from "@heytutor/drawing";
import { isConceptLessonQuestion } from "./reasoningEffort";

export interface QuestionGiven {
  symbol: string;
  board: string;
  spoken: string;
}

interface TurnPlanLike {
  givens?: unknown;
  unknowns?: unknown;
}

const ASK_SPLIT =
  /\b(?:find|calculate|locate|determine|compute|evaluate|how much|what is|show that|draw the)\b/i;

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
  const collected: QuestionGiven[] = [];
  const seen = new Set<string>();
  // A planner often emits both the qualified and the bare form of one quantity
  // — "n_glass = 1.5" and "n = 1.5" — and listing both says there are two
  // refractive indices when there is one. Same base symbol, same value, same
  // unit is the same fact; anything less exact stays two facts.
  const facts = new Set<string>();
  const add = (given: QuestionGiven | null): void => {
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
  for (const assignment of assignmentsFromQuestion(statement)) {
    add(assignment);
  }
  if (collected.length === 0) {
    add(equationFromQuestion(statement));
  }
  return collected.slice(0, 8);
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
    spoken: spokenGivenList(items, index === 0),
  }));
}

export interface GivenValueSegmentOptions {
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
  return wrapGivenRows(givens, maxWidth).map((row, index) => ({
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
The runtime already wrote the given quantities as "Given: ..." and will reveal any verified figure next. Do not rewrite those givens as a second list and do not read the question back.
Open by saying what each of those symbols physically is and what the question asks you to find, and [WRITE] that meaning line first. If a figure is visible, read it next: name each labeled part, say what it represents and which way it points or where it acts, and [FOCUS:entity_id] on the part you just named.
Then write each general formula in symbols before substituting the given values, write the rearranged form, write the substitution with its units, write the result, and close with one line reading what the result means. Write each working line as you speak it. Every step must [WRITE] or [FOCUS] so the marker moves with the voice. Use [EMPHASIZE:last] to box the current work line when you want the student to hold it.`;
}

function givenFromPlan(raw: unknown, index: number, question: string): QuestionGiven | null {
  if (!isRecord(raw)) return null;
  if (raw.provenance !== undefined && raw.provenance !== "given") return null;
  if (typeof raw.value !== "number" || !Number.isFinite(raw.value)) return null;
  const symbol = compactSymbol(raw.symbol) ?? compactSymbol(raw.id) ?? `q${index + 1}`;
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
  const board = `${symbol} = ${formatNumber(raw.value)}${unit ? ` ${unit}` : ""}`;
  return {
    symbol,
    board,
    spoken: `${speakSymbol(symbol)} equals ${speakNumber(raw.value)}${unit ? ` ${speakUnit(unit)}` : ""}`,
  };
}

function assignmentsFromQuestion(statement: string): QuestionGiven[] {
  const givens: QuestionGiven[] = [];
  const pattern =
    /(?:^|[,;]|\s)((?:d[A-Za-z]\/d[A-Za-z]|[A-Za-z][A-Za-z0-9_/^']{0,12}))\s*=\s*([^\n,;]+?)(?=(?:,|;|\.\s|\band\b|$))/g;
  for (const match of statement.matchAll(pattern)) {
    const symbol = compactSymbol(match[1]);
    const rhs = compactRhs(match[2]);
    if (!symbol || !rhs || !hasGivenContent(rhs)) continue;
    if (isAskedUnknownAssignment(statement, symbol)) continue;
    givens.push({
      symbol,
      board: `${symbol} = ${rhs}`,
      spoken: `${speakSymbol(symbol)} equals ${speakRhs(rhs)}`,
    });
  }
  return givens;
}

function equationFromQuestion(statement: string): QuestionGiven | null {
  const match = /([^\n=]{1,48}=\s*[^\n=]{1,48})/.exec(statement);
  if (!match) return null;
  const equation = compactRhs(match[1]).replace(
    /^(?:solve|simplify|evaluate|consider|given)\s+/i,
    "",
  );
  if (!equation || !/\d/.test(equation) || !/=/.test(equation)) return null;
  return {
    symbol: "equation",
    board: equation,
    spoken: speakRhs(equation),
  };
}

function spokenGivenList(givens: QuestionGiven[], lead = true): string {
  const parts = givens.map((given) => given.spoken);
  // Ellipsis is a short breath in ElevenLabs — "Given", then the values. Only
  // the first row says it; a continuation row just carries on listing.
  const opener = lead ? "Given... " : "";
  if (parts.length === 1) return `${opener}${parts[0]}.`;
  if (parts.length === 2) return `${opener}${parts[0]}. And ${parts[1]}.`;
  return `${opener}${parts.slice(0, -1).join(". ")}. And ${parts.at(-1)}.`;
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

function compactSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, "");
  if (!trimmed || trimmed.length > 16) return null;
  return trimmed;
}

function compactRhs(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/, "")
    .slice(0, 40);
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
 * The board's "Given: ..." row has always been gated on this, because a
 * planner will happily invent a whole worked example and mark every value
 * `provenance: "given"` with a confident sourceText. The teaching prompt was
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

function questionMentions(question: string, snippet: string): boolean {
  const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9=]+/g, "");
  const needle = compact(snippet);
  return needle.length > 0 && compact(question).includes(needle);
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
