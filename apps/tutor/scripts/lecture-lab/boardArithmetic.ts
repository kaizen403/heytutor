/**
 * Recompute the arithmetic the tutor wrote on the board.
 *
 * A review lane found a lecture whose emphasised final answer was ten times too
 * large: the board said `8.99e9/0.25 = 3.596e10` and then `x 5 = 1.8e10`. Every
 * automated check passed it, and catching it took a person recomputing by hand.
 * Rows of the shape `something = number` are machine-checkable, so they should
 * never need a person again.
 *
 * The evaluator is a small shunting-yard parser rather than `Function`, because
 * the input is model output and there is no reason to hand it an interpreter.
 * Anything it does not fully understand returns null and is not judged: a false
 * "the tutor got it wrong" is far more expensive here than a missed row.
 */

export interface BoardArithmeticIssue {
  row: string;
  left: string;
  claimed: number;
  actual: number;
}

/** Only rows made of numbers and operators are checkable; symbols are not. */
const CHECKABLE = /^[\s\d.+\-*/^()e]+$/i;

export function checkBoardArithmetic(rows: readonly string[]): BoardArithmeticIssue[] {
  const issues: BoardArithmeticIssue[] = [];
  for (const row of rows) {
    // A row listing several quantities ("k = 1.38e-23 J/K, T = 300 K") is not
    // one equation, and splitting it on "=" compares unrelated numbers.
    if (row.includes(",")) continue;
    const raw = row.split("=").map((part) => part.trim()).filter(Boolean);
    if (raw.length < 2) continue;
    for (let index = 0; index + 1 < raw.length; index += 1) {
      const leftRaw = raw[index];
      const rightRaw = raw[index + 1];
      const leftUnit = trailingUnit(leftRaw);
      const rightUnit = trailingUnit(rightRaw);
      // Two sides carrying different units is a conversion, not a sum:
      // "1 MeV = 10^6 eV" and "0.5 mm = 5e-4 m" are both correct.
      if (leftUnit && rightUnit && leftUnit !== rightUnit) continue;
      // A prefixed unit on the answer rescales it: "8000/0.01 = 800 kPa" is
      // right, because the left side is in pascals and the right in kilopascals.
      if (!leftUnit && hasSiPrefix(rightUnit)) continue;
      const left = stripTrailingUnit(leftRaw);
      const right = stripTrailingUnit(rightRaw);
      if (!CHECKABLE.test(left) || !CHECKABLE.test(right)) continue;
      // The left side has to actually compute something. Without this, a
      // symbolic row like "0.01 V = 0.01*100 + 0.2*20" reads its unknown as a
      // unit and compares 0.01 against the sum.
      const leftNumbers = left.match(/\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi) ?? [];
      if (leftNumbers.length < 2 || !/[+\-*/^]/.test(left.slice(1))) continue;
      const actual = evaluate(left);
      const claimed = evaluate(right);
      if (actual === null || claimed === null) continue;
      // The board rounds, so only a real disagreement counts. A wrong power of
      // ten is what this exists to find.
      const scale = Math.max(Math.abs(actual), Math.abs(claimed));
      if (scale === 0) continue;
      if (Math.abs(actual - claimed) / scale <= 0.02) continue;
      issues.push({ row, left, claimed, actual });
    }
  }
  return issues;
}

/**
 * The same symbol computed on one row and stated on another.
 *
 * A lecture wrote `|E| = (8.99e9/0.25)(5)` and then `|E| = 1.8e10 N/C`, ten
 * times too small, and boxed the wrong one. Neither row is wrong on its own,
 * so a row-local check cannot see it. Only a symbol computed from numbers and
 * then restated as a bare number within a few rows is compared, which is the
 * shape of "work it out, then write the answer".
 */
export function checkRestatedResults(rows: readonly string[]): BoardArithmeticIssue[] {
  const issues: BoardArithmeticIssue[] = [];
  const computed = new Map<string, { value: number; row: string; at: number }>();
  rows.forEach((row, at) => {
    if (row.includes(",")) return;
    const parts = row.split("=");
    if (parts.length !== 2) return;
    const symbol = parts[0].trim();
    if (!symbol || /^[\s\d.+\-*/^()e]+$/i.test(symbol)) return;
    const right = stripTrailingUnit(parts[1].trim());
    if (!CHECKABLE.test(right)) return;
    const value = evaluate(right);
    if (value === null) return;
    const numbers = right.match(/\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi) ?? [];
    const isComputation = numbers.length >= 2 && /[+\-*/^]/.test(right.slice(1));
    const earlier = computed.get(symbol);
    if (!isComputation && earlier && at - earlier.at <= 6) {
      const scale = Math.max(Math.abs(value), Math.abs(earlier.value));
      if (scale > 0 && Math.abs(value - earlier.value) / scale > 0.02) {
        issues.push({ row, left: earlier.row, claimed: value, actual: earlier.value });
      }
      computed.delete(symbol);
      return;
    }
    if (isComputation) computed.set(symbol, { value, row, at });
  });
  return issues;
}

/**
 * Is this unit a prefixed one, so the number in front of it is not on the same
 * scale as a bare value? "kPa" is, "m/s" and "N/C" are not: the leading "m"
 * there is metres and the "N" is newtons.
 */
const SI_UNITS = new Set([
  "Pa", "N", "J", "W", "V", "A", "Ω", "ohm", "C", "K", "Hz", "F", "H", "T",
  "eV", "g", "m", "s", "L", "mol", "rad", "b", "t",
]);

function hasSiPrefix(unit: string): boolean {
  const match = /^(da|[kMGTPmµμnpcdh])(.+)$/u.exec(unit.trim());
  return match !== null && SI_UNITS.has(match[2]);
}

/** The unit text closing a side, or "" when it ends in a number. */
function trailingUnit(part: string): string {
  return /\s+([A-Za-zΩ°µ][^\s]*(?:\s+[A-Za-zΩ°µ][^\s]*)*)$/u.exec(part)?.[1] ?? "";
}

/**
 * Drop a trailing unit run, so "1.8e10 N/C" is a number and not a division.
 * The unit has to be preceded by a space, or the exponent in "1.8e10" would go
 * with it.
 */
function stripTrailingUnit(part: string): string {
  return part.replace(/\s+[A-Za-zΩ°µ][^\s]*(?:\s+[A-Za-zΩ°µ][^\s]*)*$/u, "").trim();
}

type Token = { kind: "number"; value: number } | { kind: "op"; value: string };

function tokenize(expression: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  const source = expression
    .replace(/\s+/g, "")
    // A board writes multiplication by juxtaposition: "(8.99e9/0.25)(5)".
    .replace(/\)\(/g, ")*(")
    .replace(/(\d)\(/g, "$1*(")
    .replace(/\)(\d)/g, ")*$1");
  while (index < source.length) {
    const char = source[index];
    if (/[0-9.]/.test(char)) {
      const match = /^(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i.exec(source.slice(index));
      if (!match) return null;
      tokens.push({ kind: "number", value: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    if ("+-*/^()".includes(char)) {
      tokens.push({ kind: "op", value: char });
      index += 1;
      continue;
    }
    return null;
  }
  return tokens;
}

const PRECEDENCE: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3, neg: 4 };

export function evaluate(expression: string): number | null {
  const tokens = tokenize(expression);
  if (!tokens || tokens.length === 0) return null;

  const values: number[] = [];
  const operators: string[] = [];
  const apply = (): boolean => {
    const operator = operators.pop();
    if (operator === "neg") {
      const operand = values.pop();
      if (operand === undefined) return false;
      values.push(-operand);
      return true;
    }
    const right = values.pop();
    const left = values.pop();
    if (operator === undefined || right === undefined || left === undefined) return false;
    switch (operator) {
      case "+": values.push(left + right); return true;
      case "-": values.push(left - right); return true;
      case "*": values.push(left * right); return true;
      case "/":
        if (right === 0) return false;
        values.push(left / right);
        return true;
      case "^": values.push(left ** right); return true;
      default: return false;
    }
  };

  let previous: Token | null = null;
  for (const token of tokens) {
    if (token.kind === "number") {
      values.push(token.value);
      previous = token;
      continue;
    }
    if (token.value === "(") {
      operators.push("(");
      previous = token;
      continue;
    }
    if (token.value === ")") {
      while (operators.length > 0 && operators.at(-1) !== "(") {
        if (!apply()) return null;
      }
      if (operators.pop() !== "(") return null;
      previous = token;
      continue;
    }
    // Unary sign, as in "-3 + 1", "2 * -4" or "10^-6". It binds tighter than
    // any binary operator, so it cannot be modelled by pushing a zero: that
    // made "10^-6" evaluate as 10^0 - 6.
    const unary =
      (token.value === "-" || token.value === "+") &&
      (previous === null || (previous.kind === "op" && previous.value !== ")"));
    if (unary) {
      if (token.value === "-") operators.push("neg");
      previous = token;
      continue;
    }
    // `^` is right associative, so 2^3^2 is 2^9 and not 8^2. Everything else
    // binds left to right.
    const rightAssociative = token.value === "^";
    while (
      operators.length > 0 &&
      operators.at(-1) !== "(" &&
      (rightAssociative
        ? PRECEDENCE[operators.at(-1) as string] > PRECEDENCE[token.value]
        : PRECEDENCE[operators.at(-1) as string] >= PRECEDENCE[token.value])
    ) {
      if (!apply()) return null;
    }
    operators.push(token.value);
    previous = token;
  }
  while (operators.length > 0) {
    if (operators.at(-1) === "(") return null;
    if (!apply()) return null;
  }
  return values.length === 1 && Number.isFinite(values[0]) ? values[0] : null;
}
