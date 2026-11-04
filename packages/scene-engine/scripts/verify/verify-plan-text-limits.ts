/**
 * Plan text has fixed sizes, and every plan reader runs in bounded time. A plan
 * over a size is refused before anything reads it, with one closed code and no
 * plan text in the issue. A question is not refused for being long or for holding
 * wide gaps. Plans inside the sizes read exactly as they did.
 */
import {
  TURN_PLAN_TEXT_LIMITS as L,
  questionForPlanReaders,
  reconcileTurnPlanV3ExplicitArithmetic,
  turnPlanTextOverLimit,
  validateTurnPlanV3,
} from "../../src/contracts/contractsV3";
import { parseTurnPlanV3Content, type TurnPlanV3ParseTrace } from "../../../tutor-core/src/planners/turnPlannerV3";
import { cpuMs } from "./cpuTime";

const QUESTION = "A synthetic plan row.";
const LIMIT_MS = 1_000;
// A long question is read by more of the parser, and runners differ, so its rows get more room.
const QUESTION_PARSE_LIMIT_MS = 5_000;
const OVER = "plan_text_over_limit";
// The first failure ends the run, because a slow row is slow whichever row it is.
const fail = (name: string, detail: unknown): never => {
  console.error(`FAIL ${name}: ${JSON.stringify(detail).slice(0, 200)}`);
  process.exit(1);
};

// The sizes themselves, so raising one is a decision and not an accident.
const PINNED = { textChars: 1_000, nameChars: 128, totalChars: 8_000, entries: 64, nodes: 2_000, depth: 16, whitespaceRun: 16, digitRun: 400, questionChars: 12_000 };
if (JSON.stringify(L) !== JSON.stringify(PINNED)) fail("the plan sizes moved", L);

const plan = (over: Record<string, unknown> = {}) => ({
  schemaVersion: "turn-plan/v3", question: QUESTION, givens: [],
  unknowns: [{ id: "x", symbol: "x", unit: "m" }],
  derived: [{ id: "x", symbol: "x", value: 7, unit: "m", sourceText: "x = 7 m", provenance: "derived" }],
  qualitativeClaims: [], lawIds: ["law"], assumptions: [], visualRequirement: "optional",
  ...over,
});
const withSource = (sourceText: string) => plan({ derived: [{ id: "x", symbol: "x", value: 7, unit: "m", sourceText, provenance: "derived" }] });
const withGiven = (field: "symbol" | "id" | "sourceText", text: string) => plan({ givens: [{ id: "g", symbol: "g", value: 1, provenance: "given", [field]: text }] });
const withClaim = (claim: string, expected: unknown = true) => plan({ qualitativeClaims: [{ id: "c", claim, expected }] });
const spaces = (count: number) => " ".repeat(count);
const fill = (part: string, chars: number) => part.repeat(Math.ceil(chars / part.length)).slice(0, chars);
const codes = (raw: unknown, question?: string) => validateTurnPlanV3(raw, question).issues.map((issue) => issue.code);

// Every text shape, in every field that reads it, far over the sizes. Each is refused, and quickly.
const refusedInTime: Array<[string, Record<string, unknown>]> = [
  ["gap in a chain that disagrees", plan({ derived: [{ id: "x", symbol: "x", value: 7, unit: "m", sourceText: `x = 2 × 3 = 6 m; x = 1 m${spaces(2_000)}!`, provenance: "derived" }] })],
  ["gap after a trig word, given symbol", withGiven("symbol", `sin 1${spaces(2_000)}!`)],
  ["gap after a trig word, given id", withGiven("id", `sin 1${spaces(2_000)}!`)],
  ["gap after a trig word, given source", withGiven("sourceText", `sin 1${spaces(2_000)}!`)],
  ["long gap in a source text", withSource(`x = 1${spaces(128_000)}!`)],
  ["long gap after an approximate sign", withSource(`x = ~${spaces(64_000)}!`)],
  ["long digits in a source text", withSource(`x = ${"1".repeat(32_000)}!`)],
  ["repeated statements in a claim", withClaim(fill("x = 1 m ", 8_000))],
  ["repeated statements in an expected value", withClaim("x", fill("x = 1 m ", 8_000))],
  ["repeated measures in a claim", withClaim(fill("1 m ", 32_000))],
  ["long digits in a claim", withClaim("1".repeat(32_000))],
  ["long digits in an expected value", withClaim("x", "1".repeat(32_000))],
  ["decimal point, gap, digit", withSource(`x = 1.${spaces(300)}1`)],
  ["digit, gap, digit", withSource(`x = 1${spaces(300)}1`)],
  ["bracket, gap, bad character", withSource(`x = (1${spaces(300)}!`)],
  ["two gaps", withSource(`x = ~${spaces(150)}1${spaces(150)}!`)],
  ["tabs and spaces", withSource(`x = 1.${"\t ".repeat(150)}1`)],
  ["unit, gap, bad character", withSource(`x = 1 m${spaces(300)}!`)],
  ["power of ten, gaps", withSource(`x = 1 ×${spaces(150)}10${spaces(150)}!`)],
  ["no schema and no question", { givens: [{ symbol: `sin 1${spaces(2_000)}!`, value: 1 }], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [] }],
];
for (const [name, raw] of refusedInTime) {
  let validated: string[] = [];
  let trace: TurnPlanV3ParseTrace = {};
  let parsed: unknown = null;
  const validateMs = cpuMs(() => { validated = codes(raw, QUESTION); }, LIMIT_MS);
  const parseMs = cpuMs(() => { trace = {}; parsed = parseTurnPlanV3Content(JSON.stringify(raw), QUESTION, trace); }, LIMIT_MS);
  if (validateMs > LIMIT_MS || parseMs > LIMIT_MS) fail(`${name}: time`, { validateMs, parseMs });
  if (validated.join() !== OVER) fail(`${name}: validate`, validated);
  if (parsed !== null || trace.issues?.[0]?.code !== OVER || trace.normalized !== undefined) fail(`${name}: parse`, trace.issues);
  const direct = reconcileTurnPlanV3ExplicitArithmetic(raw);
  if (direct.plan !== raw || direct.reconciliations.length > 0) fail(`${name}: reconcile wrote`, direct.reconciliations);
}

// The slowest text the sizes still allow.
const atTheSizes: Array<[string, Record<string, unknown>]> = [
  ["a chain at the text size", withSource(`x = ${fill("x = 1 = ", L.textChars - 4)}`)],
  ["gaps at the run size in a source", withSource(`x = 1${fill(`${spaces(L.whitespaceRun)}1`, L.textChars - 5)}`)],
  ["trig words at the run size, given", withGiven("sourceText", fill(`sin 1${spaces(L.whitespaceRun)}!`, L.textChars))],
  ["trig words at the run size, symbol", withGiven("symbol", fill(`sin 1${spaces(L.whitespaceRun)}!`, L.nameChars))],
  ["measures at the text size in a claim", withClaim(fill("1 m ", L.textChars))],
  ["statements at the text size in a claim", withClaim(fill("x = 1 m ", L.textChars))],
  ["digits at the run size in a claim", withClaim(fill(`${"1".repeat(L.digitRun)} `, L.textChars))],
  ["seven chains", plan({ unknowns: [], derived: Array.from({ length: 7 }, (_, index) => ({ id: `x${index}`, symbol: `x${index}`, value: 7, sourceText: `x${index} = ${fill("1 = ", L.textChars - 8)}`, provenance: "derived" })) })],
];
for (const [name, raw] of atTheSizes) {
  let validated: string[] = [];
  const validateMs = cpuMs(() => { validated = codes(raw, QUESTION); }, LIMIT_MS);
  const parseMs = cpuMs(() => { parseTurnPlanV3Content(JSON.stringify(raw), QUESTION); }, LIMIT_MS);
  if (validateMs > LIMIT_MS || parseMs > LIMIT_MS) fail(`${name}: time`, { validateMs, parseMs });
  if (validated.includes(OVER)) fail(`${name}: within the sizes`, validated);
}

// A question stays inside the sizes at any shape and does not lose its plan.
const longQuestions: Array<[string, string]> = [
  ["a trig word, a wide gap", `sin 1${spaces(4_000)}!`],
  ["a chain, a wide gap", `x = 1${spaces(L.questionChars - 10)}!`],
  ["an approximate sign, a wide gap", `x = ~${spaces(L.questionChars - 10)}!`],
  ["repeated statements", fill("x = 1 m ", L.questionChars)],
  ["repeated measures", fill("1 m ", L.questionChars)],
  ["digits at the run size", fill(`${"1".repeat(L.digitRun)} `, L.questionChars)],
  ["bars", fill("|x| ", L.questionChars)],
  ["open brackets", fill("(", L.questionChars)],
  ["close brackets", fill(")", L.questionChars)],
  ["ordinary prose", fill("A ball is thrown at 20 m/s from a tower of height 45 m. Find its range. ", L.questionChars)],
];
for (const [name, question] of longQuestions) {
  const raw = plan({ question });
  let validated = validateTurnPlanV3(plan(), QUESTION);
  let parsed: unknown = null;
  const validateMs = cpuMs(() => { validated = validateTurnPlanV3(raw, question); }, LIMIT_MS);
  const parseMs = cpuMs(() => { parsed = parseTurnPlanV3Content(JSON.stringify(raw), question); }, QUESTION_PARSE_LIMIT_MS);
  if (validateMs > LIMIT_MS || parseMs > QUESTION_PARSE_LIMIT_MS) fail(`question, ${name}: time`, { validateMs, parseMs });
  if (validated.issues.some((issue) => issue.code === OVER) || !validated.plan) fail(`question, ${name}: refused`, validated.issues);
  if (!parsed) fail(`question, ${name}: parser refused`, null);
  if (validated.plan && validated.plan.question !== questionForPlanReaders(question)) fail(`question, ${name}: text`, null);
}
const ordinary = "A ball is thrown at 20 m/s.\n\nFind its  range.";
if (questionForPlanReaders(ordinary) !== ordinary || validateTurnPlanV3(plan({ question: ordinary }), ordinary).plan?.question !== ordinary) fail("an ordinary question changed", null);
const gap = `A ball${spaces(L.whitespaceRun + 1)}is thrown.`;
if (questionForPlanReaders(gap) !== `A ball${spaces(L.whitespaceRun)}is thrown.`) fail("a wide gap is cut to the run size", questionForPlanReaders(gap));
if (questionForPlanReaders(`A ball${spaces(L.whitespaceRun)}is thrown.`) !== `A ball${spaces(L.whitespaceRun)}is thrown.`) fail("a gap at the run size stays", null);
for (const question of ["q".repeat(L.questionChars + 1), `${"1".repeat(L.digitRun + 1)} apples`]) {
  if (codes(plan({ question }), question).join() !== OVER) fail("question over a size, both", question.length);
  if (codes(plan(), question).join() !== OVER) fail("question over a size, submitted only", question.length);
  if (codes(plan({ question })).join() !== OVER) fail("question over a size, plan only", question.length);
  const trace: TurnPlanV3ParseTrace = {};
  if (parseTurnPlanV3Content(JSON.stringify(plan()), question, trace) !== null || trace.issues?.[0]?.code !== OVER || trace.normalized !== undefined) fail("question over a size, parser", question.length);
}
if (codes(plan({ question: "q".repeat(L.questionChars) }), "q".repeat(L.questionChars)).includes(OVER)) fail("a question at the length size", null);
if (codes(plan({ question: "1".repeat(L.digitRun) }), "1".repeat(L.digitRun)).includes(OVER)) fail("a question at the digit size", null);

// A long stated number is an ordinary thing to state. A value this reader cannot hold as a finite number has at most 309 digits.
const fifty = "30414093201713378043612608166064768844377641568960512000000000000";
const longNumber = validateTurnPlanV3(reconcileTurnPlanV3ExplicitArithmetic(plan({ unknowns: [{ id: "x", symbol: "x" }], derived: [{ id: "x", symbol: "x", value: Number(fifty), sourceText: `x = ${fifty}`, provenance: "derived" }] })).plan, QUESTION);
if (longNumber.plan?.derived[0]?.value !== Number(fifty)) fail("a plan stating a 65 digit result", longNumber.issues);
if (codes(plan(), `What is the sum of the digits of ${fifty}?`).includes(OVER)) fail("a question holding a 65 digit number", null);

// Each size, right at it and one past it.
const quantities = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `g${index}`, symbol: `g${index}`, value: 1, provenance: "given" }));
const deep = (levels: number) => { let value: unknown = 1; for (let index = 0; index < levels; index += 1) value = { a: value }; return value; };
const sizes: Array<[string, (over: number) => Record<string, unknown>]> = [
  ["text length", (over) => withClaim("a".repeat(L.textChars + over))],
  ["name length, symbol", (over) => withGiven("symbol", "a".repeat(L.nameChars + over))],
  ["name length, id", (over) => withGiven("id", "a".repeat(L.nameChars + over))],
  ["name length, unit", (over) => plan({ givens: [{ id: "g", symbol: "g", value: 1, unit: "a".repeat(L.nameChars + over), provenance: "given" }] })],
  ["key length", (over) => plan({ extra: { ["k".repeat(L.nameChars + over)]: 1 } })],
  ["top level key length", (over) => plan({ ["k".repeat(L.nameChars + over)]: 1 })],
  ["total length", (over) => {
    const used = turnPlanTextTotal(plan({ assumptions: [] }));
    const left = L.totalChars - used + over;
    const whole = Math.floor(left / L.textChars);
    return plan({ assumptions: [...Array.from({ length: whole }, () => "a".repeat(L.textChars)), "a".repeat(left - whole * L.textChars)] });
  }],
  ["list entries", (over) => plan({ givens: quantities(L.entries + over) })],
  ["object entries", (over) => plan({ extra: Object.fromEntries(Array.from({ length: L.entries + over }, (_, index) => [`k${index}`, 1])) })],
  ["nesting", (over) => plan({ extra: deep(L.depth - 1 + over) })],
  ["value count", (over) => {
    const base = turnPlanNodeCount(plan({ extra: [] }));
    const left = L.nodes - base + over;
    const lists = Math.ceil(left / (L.entries + 1));
    return plan({ extra: Array.from({ length: lists }, (_, index) => Array.from({ length: index === lists - 1 ? left - (lists - 1) * (L.entries + 1) - 1 : L.entries }, () => 1)) });
  }],
  ["whitespace run", (over) => withSource(`x = 7${spaces(L.whitespaceRun + over)}m`)],
  ["other whitespace in a run", (over) => withSource(`x = 7${" ".repeat(L.whitespaceRun + over)}m`)],
  ["digit run", (over) => withSource(`x = ${"7".repeat(L.digitRun + over)}`)],
  ["digit run in a claim", (over) => withClaim(`${"7".repeat(L.digitRun + over)} apples`)],
];
for (const [name, make] of sizes) {
  const at = turnPlanTextOverLimit(make(0));
  const past = turnPlanTextOverLimit(make(1));
  if (at !== null) fail(`${name}: at the size`, at);
  if (past === null || past.code !== OVER || past.path !== "$") fail(`${name}: one past`, past);
  if (past && past.message.length > 60) fail(`${name}: closed message`, past.message);
}
function turnPlanTextTotal(raw: Record<string, unknown>): number {
  let total = 0;
  const walk = (value: unknown, depth: number) => {
    if (typeof value === "string") total += value.length;
    else if (Array.isArray(value)) value.forEach((entry) => walk(entry, depth + 1));
    else if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) {
      total += key.length;
      if (depth > 0 || key !== "question") walk(entry, depth + 1);
    }
  };
  walk(raw, 0);
  return total;
}
function turnPlanNodeCount(raw: Record<string, unknown>): number {
  let nodes = 0;
  const walk = (value: unknown, depth: number) => {
    nodes += 1;
    if (Array.isArray(value)) value.forEach((entry) => walk(entry, depth + 1));
    else if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) if (depth > 0 || key !== "question") walk(entry, depth + 1);
  };
  walk(raw, 0);
  return nodes;
}

// Object keys count toward the total, in whatever order the plan lists them.
const keysFirst = { extra: Object.fromEntries(Array.from({ length: L.entries }, (_, index) => [String(index).padEnd(L.nameChars, "k"), 1])), ...plan() };
if (turnPlanTextOverLimit(keysFirst)?.code !== OVER) fail("keys listed before the text", null);
if (turnPlanTextOverLimit({ ...plan(), extra: keysFirst.extra })?.code !== OVER) fail("keys listed after the text", null);

// A refused plan never carries its text in the issue.
const wideGap = `secretword${spaces(40)}`;
const refusal = validateTurnPlanV3(withSource(wideGap), QUESTION).issues[0];
if (!refusal || JSON.stringify(refusal).includes("secretword")) fail("the issue holds plan text", refusal);

// Values inside the sizes read as they always did, whatever whitespace they hold.
function read(sourceText: string, value: number, unit?: string) {
  const raw = plan({ unknowns: [{ id: "x", symbol: "x", ...(unit ? { unit } : {}) }], derived: [{ id: "x", symbol: "x", value, ...(unit ? { unit } : {}), sourceText, provenance: "derived" }] });
  const validated = validateTurnPlanV3(reconcileTurnPlanV3ExplicitArithmetic(raw).plan, QUESTION);
  return validated.plan?.derived[0]?.value ?? null;
}
for (const [name, source, value, unit, expected] of [
  ["spaces before a stated result", "x = 2 × 3 =    6", 6, undefined, 6],
  ["spaces around a unit", "x = 2 × 3 =   6    m", 6, "m", 6],
  ["a false result behind spaces is corrected", "x = 2 × 3 =   7", 7, undefined, 6],
  ["spaces inside a compound unit", "x = 2 × 3 = 6  m / s", 6, "m/s", 6],
  ["a tab before the unit", "x = 2 × 3 = 6\tm", 6, "m", 6],
  ["a gap inside a number stays unread", "x = 1 000", 1000, undefined, 1000],
  ["a gap inside a number stays unread, small", "x = 1 000", 7, undefined, null],
  ["no break space inside a unit, disagreeing", "x = 6 N m", 7, "N m", 7],
  ["no break space inside a unit, disagreeing the other way", "x = 7 N m", 6, "N m", 6],
  ["a tab inside a unit after a chain", "2 + 4 = 3 + 3 = 7 N\tm", 7, "N m", 7],
  ["a tab inside a scaled unit after a chain", "x = 2 × 3 = 0.007 kN\tm", 6, "N m", 6],
  ["a gap inside a stated result stays unread", "x = 2 × 500 = 1 000", 7, undefined, null],
  ["a gap inside a stated result stays unread, other chain", "x = 2 × 3 = 1 000", 6, undefined, null],
  ["a space inside a stated unit stays a space", "x = 2 × 3 = 7 kg m", 7, "kg m", 6],
  ["a space inside a unit, a value that disagrees", "x = 6 kg m", 7, "kg m", null],
] as const) {
  const final = read(source, value, unit);
  if (final !== expected) fail(name, { final, expected });
}

console.log("plan text limits: all rows passed");
