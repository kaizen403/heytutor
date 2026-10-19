/**
 * Normalize a student question before any planner sees it.
 *
 * Pasted KaTeX/markdown (`\(y = \sqrt{x}\)`, `$x^2$`) must become the same
 * plain math the scene expression language and teaching stream already use.
 * Without this, a disk-method stem arrives as `y = x` and the diagram is wrong
 * before a single operator runs.
 */
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u00AD]/g;
const SUPERSCRIPTS: Readonly<Record<string, string>> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-", "⁽": "(", "⁾": ")", "ⁿ": "n", "ⁱ": "i",
};

/** Count only outer operators; a balanced inner group already owns its scope. */
function superscriptOuterOperators(power: string): number | null {
  if (power.length > 256) return null;
  let cursor = 0;
  function atom(depth: number): boolean {
    if (power[cursor] === "(") {
      cursor += 1;
      if (expression(depth + 1) === null || power[cursor] !== ")") return false;
      cursor += 1;
      return true;
    }
    const start = cursor;
    while (/[0-9]/.test(power[cursor] ?? "")) cursor += 1;
    if (cursor > start) return true;
    if (power[cursor] === "n" || power[cursor] === "i") {
      cursor += 1;
      return true;
    }
    return false;
  }
  function expression(depth: number): number | null {
    if (depth > 32) return null;
    if (power[cursor] === "+" || power[cursor] === "-") cursor += 1;
    if (!atom(depth)) return null;
    let operators = 0;
    while (power[cursor] === "+" || power[cursor] === "-") {
      cursor += 1;
      // A second sign is not repaired into an ordinary unary expression.
      if (!atom(depth)) return null;
      operators += 1;
    }
    return operators;
  }
  const operators = expression(0);
  return cursor === power.length ? operators : null;
}

export function normalizeTutorQuestion(raw: string): string {
  let text = raw.normalize("NFC").replace(ZERO_WIDTH, "");
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, "$1");
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, "$1");
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, "$1");
  text = text.replace(/\$([^$\n]+)\$/g, "$1");
  text = text.replace(/\\sqrt\s*\{([^{}]+)\}/g, "sqrt($1)");
  text = text.replace(/\\sqrt\s*\(([^)]+)\)/g, "sqrt($1)");
  text = text.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "($1)/($2)");
  text = text.replace(/\\left|\\right/g, "");
  text = text.replace(/\\times/g, "*");
  text = text.replace(/\\cdot/g, "*");
  text = text.replace(/\\pi(?![A-Za-z])/g, "pi");
  text = text.replace(/\\theta(?![A-Za-z])/g, "theta");
  text = text.replace(/\\,/g, " ");
  text = text.replace(/√\s*\(([^)]+)\)/g, "sqrt($1)");
  text = text.replace(/√\s*([A-Za-z0-9]+)/g, "sqrt($1)");
  text = text.replace(/π/g, "pi");
  text = text.replace(/[−–—]/g, "-");
  text = text.replace(/×/g, "*");
  // A power or charge is one source run: 10⁻¹⁵, Mg²⁺ and s⁻¹ must
  // not acquire a separate caret for each digit or retain half a sign.
  text = text.replace(/\^?[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾ⁿⁱ]+/g, (run) => {
    const power = [...run.replace(/^\^/, "")].map((glyph) => SUPERSCRIPTS[glyph]).join("");
    // Preserve existing charge notation separately from arithmetic validity.
    if (/^(?:\d*[+-]|\(\d*[+-]\))$/.test(power)) return `^${power}`;
    const operators = superscriptOuterOperators(power);
    // Lowering malformed signs can create valid unary arithmetic. Keep the
    // original run unsupported rather than silently assigning it a value.
    if (operators === null) return run;
    return `^${operators > 0 ? `(${power})` : power}`;
  });
  text = text.replace(/\*\*(.+?)\*\*/g, "$1");
  text = text.replace(/\s{2,}/g, " ").trim();
  return text;
}
