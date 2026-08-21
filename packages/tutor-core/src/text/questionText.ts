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
  "⁰": "^0", "¹": "^1", "²": "^2", "³": "^3", "⁴": "^4",
  "⁵": "^5", "⁶": "^6", "⁷": "^7", "⁸": "^8", "⁹": "^9",
};

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
  for (const [glyph, power] of Object.entries(SUPERSCRIPTS)) {
    text = text.replaceAll(glyph, power);
  }
  text = text.replace(/\*\*(.+?)\*\*/g, "$1");
  text = text.replace(/\s{2,}/g, " ").trim();
  return text;
}
