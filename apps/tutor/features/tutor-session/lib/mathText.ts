/**
 * Render the board's math notation as readable text.
 *
 * The pen and the narration share one source form — `R_1`, `v^2`, `F_net` —
 * because the handwriting renderer needs explicit script markers. That form is
 * for the nib, not for a reader: showing `R_1` in the chat leaks the markup.
 * This splits a line into runs the UI can set as real sub/superscripts.
 *
 * Prose must survive intact. `snake_case` is left alone, so the rule is
 * deliberately narrow: a script run is either braced, or at most three
 * alphanumerics that do not run on into a longer word.
 */

export type MathRunKind = "text" | "sub" | "sup";

export interface MathRun {
  kind: MathRunKind;
  value: string;
}

const MAX_BARE_SCRIPT_CHARS = 3;

function isAlphanumeric(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9]/.test(char);
}

/**
 * Read the script that follows a `_` or `^` at `index`.
 * Returns null when the marker is ordinary punctuation rather than notation.
 */
function readScript(text: string, index: number): { value: string; next: number } | null {
  const marker = text[index];
  if (marker !== "_" && marker !== "^") return null;

  // A marker only ever binds to something on its left.
  if (!isAlphanumeric(text[index - 1]) && text[index - 1] !== ")" && text[index - 1] !== "}") {
    return null;
  }

  const after = index + 1;
  if (text[after] === "{") {
    const close = text.indexOf("}", after + 1);
    if (close === -1) return null;
    const value = text.slice(after + 1, close);
    if (value.length === 0) return null;
    return { value, next: close + 1 };
  }

  let end = after;
  while (end < text.length && /[A-Za-z0-9+\-]/.test(text[end]!) && end - after < MAX_BARE_SCRIPT_CHARS) {
    end += 1;
  }
  if (end === after) return null;
  // `snake_case` — the run keeps going, so this underscore is part of a word.
  if (isAlphanumeric(text[end])) return null;
  return { value: text.slice(after, end), next: end };
}

/** Split a line into plain text and script runs, in order. */
export function parseMathText(raw: string): MathRun[] {
  const text = raw ?? "";
  const runs: MathRun[] = [];
  let buffer = "";

  const flush = (): void => {
    if (buffer.length > 0) {
      runs.push({ kind: "text", value: buffer });
      buffer = "";
    }
  };

  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "_" || char === "^") {
      const script = readScript(text, index);
      if (script) {
        flush();
        runs.push({ kind: char === "_" ? "sub" : "sup", value: script.value });
        index = script.next;
        continue;
      }
    }
    buffer += char;
    index += 1;
  }
  flush();
  return runs;
}

/** True when a line carries notation worth rendering as scripts. */
export function hasMathNotation(text: string): boolean {
  return parseMathText(text).some((run) => run.kind !== "text");
}

/**
 * Flatten to a plain string with Unicode scripts where they exist. Used where
 * markup is not available — copy-to-clipboard, aria labels, plain summaries.
 */
const SUB_DIGITS: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋",
};
const SUP_DIGITS: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻",
};

export function toPlainMathText(raw: string): string {
  return parseMathText(raw)
    .map((run) => {
      if (run.kind === "text") return run.value;
      const table = run.kind === "sub" ? SUB_DIGITS : SUP_DIGITS;
      // Only map when every character has a real script glyph; otherwise the
      // result would be a mix of raised and baseline characters.
      const mapped = [...run.value].map((char) => table[char]);
      if (mapped.every((char) => char !== undefined)) return mapped.join("");
      return run.kind === "sub" ? `_${run.value}` : `^${run.value}`;
    })
    .join("");
}
