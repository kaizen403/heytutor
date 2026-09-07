/**
 * The lecture lab's board-arithmetic checker emits a fatal verdict, so a false
 * positive here accuses the tutor of being wrong when it is right. Its first
 * version did exactly that eighteen times in one sweep: it split a row listing
 * two quantities, read the unknown in "0.01 V = ..." as a unit, called a unit
 * conversion an arithmetic error, and evaluated "10^-6" as 10^0 minus 6.
 */
import { checkBoardArithmetic, evaluate } from "../lecture-lab/boardArithmetic";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const EXPRESSIONS: [expression: string, value: number][] = [
  ["10^-6", 1e-6],
  ["8.99e9 * -6e-12", -0.05394],
  ["10^8 / 10^14", 1e-6],
  ["-3 + 1", -2],
  ["2 * (-4)", -8],
  ["1/(1/6 + 1/3)", 2],
  ["2^3^2", 512],
  ["(0.2*20 + 0.01*100)/0.01", 500],
];
for (const [expression, expected] of EXPRESSIONS) {
  const actual = evaluate(expression);
  assert(
    actual !== null && Math.abs(actual - expected) <= Math.abs(expected) * 1e-9,
    `evaluate(${expression}) gave ${actual}, expected ${expected}`,
  );
}

// Rows that are correct, or that this checker has no business judging.
const MUST_PASS = [
  "k = 1.38e-23 J/K, T = 300 K",
  "1 MeV = 10^6 eV",
  "r = 0.5 mm = 5e-4 m",
  "1 N = 10^5 dyn",
  "10^8 / 10^14 = 10^-6",
  "8.99e9 * -6e-12 = -0.05394",
  "0.01 V = 0.01*100 + 0.2*20",
  "V = (0.2*20 + 0.01*100)/0.01 = 500 m/s",
  "eta = 1 - 300/500 = 0.4",
  "R_p = 1/(1/6 + 1/3) = 2 ohm",
  "t = sqrt(2h/g)",
  "1/f = 1/15 - 1/20 = 1/60",
  "L = 2 m",
  // A prefixed unit on the answer rescales it: the left side is in pascals.
  "τ = 8000/0.01 = 800 kPa",
  "d = 1000 * 5 = 5 km",
  "t = 60 * 25 = 1.5 ks",
];
for (const row of MUST_PASS) {
  const issues = checkBoardArithmetic([row]);
  assert(
    issues.length === 0,
    `a correct or unjudgeable row was flagged: ${row} -> ${JSON.stringify(issues)}`,
  );
}

// The row this checker exists for: an emphasised final answer ten times too
// large, which passed every other automated check in a 342-question sweep.
const wrong = checkBoardArithmetic(["E = 3.596e10 * 5 = 1.8e10 N/C"]);
assert(wrong.length === 1, "a board row that is out by a factor of ten must be caught");
assert(
  Math.abs(wrong[0].actual - 1.798e11) < 1e6,
  `the checker must report the true value, got ${wrong[0].actual}`,
);
assert(
  checkBoardArithmetic(["W = 4.8 * 1.667 = 8.0 J"]).length === 0,
  "rounding on the board is not an error",
);
// An unprefixed unit on the answer must still be checked, or the one row this
// gate exists for would slip through.
assert(
  checkBoardArithmetic(["E = 3.596e10 * 5 = 1.8e10 N/C"]).length === 1,
  "a plain unit on the answer must not exempt the row from checking",
);
assert(
  checkBoardArithmetic(["v = 100/2 = 50 m/s"]).length === 0,
  "m/s is metres per second, not a milli prefix",
);

console.log(
  `verify-board-arithmetic: ${EXPRESSIONS.length} expressions evaluate correctly and ${MUST_PASS.length} honest rows are left alone`,
);
