/**
 * A long run of whitespace in a plan's source text must not stall the reader.
 * The plan parser runs in the browser and validation runs on the server, so a
 * stall blocks a student's tab or the one server process. On the old pattern a
 * run of 300 spaces before an unmatched character took seconds, and 800 took minutes.
 * The same text must keep reading the same value.
 */
import { reconcileTurnPlanV3ExplicitArithmetic, validateTurnPlanV3 } from "../../src/contracts/contractsV3";

const QUESTION = "A synthetic plan reader row.";
const LIMIT_MS = 1_000;
let failures = 0;

function read(source: string, value: number, unit?: string) {
  const raw = {
    schemaVersion: "turn-plan/v3", question: QUESTION, givens: [],
    unknowns: [{ id: "x", symbol: "x", ...(unit ? { unit } : {}) }],
    derived: [{ id: "x", symbol: "x", value, ...(unit ? { unit } : {}), sourceText: source, provenance: "derived" }],
    qualitativeClaims: [], lawIds: ["law"], assumptions: [], visualRequirement: "optional",
  };
  const started = performance.now();
  const validated = validateTurnPlanV3(reconcileTurnPlanV3ExplicitArithmetic(raw).plan, QUESTION);
  return { ms: performance.now() - started, accepted: validated.valid, final: validated.plan?.derived[0]?.value ?? null };
}

const spaces = (count: number) => " ".repeat(count);
// Every shape that stalled, and its neighbours that did not, at a size that took seconds.
for (const [name, source] of [
  ["decimal point, spaces, digit", `x = 1.${spaces(300)}1`],
  ["digit, spaces, digit", `x = 1${spaces(300)}1`],
  ["bracket, spaces, bad character", `x = (1${spaces(300)}!`],
  ["two runs", `x = ~${spaces(150)}1${spaces(150)}!`],
  ["tabs and spaces", `x = 1.${"\t ".repeat(150)}1`],
  ["unit, spaces, bad character", `x = 1 m${spaces(300)}!`],
  ["power of ten, spaces", `x = 1 ×${spaces(150)}10${spaces(150)}!`],
] as const) {
  const { ms } = read(source, 1);
  if (ms > LIMIT_MS) {
    failures += 1;
    console.error(`FAIL ${name}: ${Math.round(ms)} ms`);
  }
}

// Whitespace inside a measured value still reads the same.
for (const [name, source, value, unit, expected] of [
  ["spaces before a stated result", "x = 2 × 3 =    6", 6, undefined, 6],
  ["spaces around a unit", "x = 2 × 3 =   6    m", 6, "m", 6],
  ["a false result behind spaces is corrected", "x = 2 × 3 =   7", 7, undefined, 6],
  ["spaces inside a compound unit", "x = 2 × 3 = 6  m / s", 6, "m/s", 6],
  ["a tab before the unit", "x = 2 × 3 = 6\tm", 6, "m", 6],
] as const) {
  const result = read(source, value, unit);
  if (!result.accepted || result.final !== expected) {
    failures += 1;
    console.error(`FAIL ${name}: ${JSON.stringify(result)}`);
  }
}

if (failures > 0) {
  console.error(`plan reader whitespace time: ${failures} failed`);
  process.exit(1);
}
console.log("plan reader whitespace time: all rows passed");
