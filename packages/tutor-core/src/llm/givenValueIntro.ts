/**
 * Runtime-owned opening for problem-solving turns.
 *
 * If the submitted question states values, write them first as "Given: ...",
 * then the verified figure can be revealed and the teaching stream can solve.
 * The teaching model must not restate or rewrite this list.
 */
import { WORK_ZONE, type TutorSegment } from "@heytutor/drawing";

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
  const statement = givenStatement(question);
  const unknownKeys = unknownKeysOf(turnPlan);
  const collected: QuestionGiven[] = [];
  const seen = new Set<string>();
  const add = (given: QuestionGiven | null): void => {
    if (!given) return;
    const key = normalizeKey(given.symbol);
    if (!key || seen.has(key) || unknownKeys.has(key)) return;
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

export function buildGivenValueSegments(
  question: string,
  turnPlan?: TurnPlanLike | null,
): TutorSegment[] {
  const givens = collectQuestionGivens(question, turnPlan);
  if (givens.length === 0) return [];
  const board = `Given: ${givens.map((given) => given.board).join(", ")}`;
  const spoken = spokenGivenList(givens);
  return [{
    narration: spoken,
    command: {
      type: "WRITE",
      params: [WORK_ZONE.marginX, WORK_ZONE.topY],
      text: board,
      charPosition: 0,
      narrationBefore: spoken,
      syncable: true,
    },
  }];
}

export function givenValuesPromptAddon(hasGivens: boolean): string {
  if (!hasGivens) return "";
  return `GIVEN VALUES ARE ALREADY ON THE BOARD
The runtime already wrote the given quantities as "Given: ..." and will reveal any verified figure next. Do not rewrite those givens. Do not restate the full list. Start from the governing relationship: write each general formula in symbols before substituting the given values, write each working line as you speak it, and [FOCUS:entity_id] when you name a labeled diagram point.`;
}

function givenFromPlan(raw: unknown, index: number, question: string): QuestionGiven | null {
  if (!isRecord(raw)) return null;
  if (raw.provenance !== undefined && raw.provenance !== "given") return null;
  if (typeof raw.value !== "number" || !Number.isFinite(raw.value)) return null;
  const symbol = compactSymbol(raw.symbol) ?? compactSymbol(raw.id) ?? `q${index + 1}`;
  const unit = displayUnit(raw.unit);
  const sourceText = typeof raw.sourceText === "string" ? raw.sourceText.trim() : "";
  if (sourceText && !questionMentions(question, sourceText) && !questionMentions(question, symbol)) {
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

function spokenGivenList(givens: QuestionGiven[]): string {
  const parts = givens.map((given) => given.spoken);
  // Ellipsis is a short breath in ElevenLabs — "Given", then the values.
  if (parts.length === 1) return `Given... ${parts[0]}.`;
  if (parts.length === 2) return `Given... ${parts[0]}. And ${parts[1]}.`;
  return `Given... ${parts.slice(0, -1).join(". ")}. And ${parts.at(-1)}.`;
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

function displayUnit(value: unknown): string {
  if (typeof value !== "string") return "";
  const unit = value.trim();
  if (!unit || unit === "1" || unit === "none") return "";
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
