/**
 * Teaching models wrap math in LaTeX delimiters, `\(d = 5\)` or `$r = 5$`,
 * and use commands such as `\frac{9}{2}` and `\sqrt{25}`. The board pen draws
 * plain math (`d = 5`, `9/2`, `sqrt(25)`) and the voice reads plain math, so
 * both unwrap the markup the same way before anything else sees the text.
 *
 * Only markup is removed. A `$` pair is math only when its body looks like
 * math, so "$5 and $10" stays money.
 */

const SYMBOLS: ReadonlyArray<readonly [string, string]> = [
  ["times", "×"], ["cdot", "·"], ["div", "÷"], ["pm", "±"], ["mp", "∓"],
  ["leq", "≤"], ["le", "≤"], ["geq", "≥"], ["ge", "≥"], ["neq", "≠"], ["ne", "≠"],
  ["approx", "≈"], ["sim", "~"], ["equiv", "≡"], ["propto", "∝"], ["infty", "∞"],
  ["Rightarrow", "⇒"], ["implies", "⇒"], ["rightarrow", "→"], ["to", "→"], ["Leftrightarrow", "⇔"],
  ["therefore", "∴"], ["angle", "∠"], ["perp", "⊥"], ["parallel", "∥"], ["triangle", "△"],
  ["circ", "°"], ["degree", "°"], ["partial", "∂"], ["nabla", "∇"], ["int", "∫"], ["sum", "∑"],
  ["alpha", "α"], ["beta", "β"], ["gamma", "γ"], ["delta", "δ"], ["epsilon", "ε"], ["varepsilon", "ε"],
  ["theta", "θ"], ["lambda", "λ"], ["mu", "μ"], ["pi", "π"], ["rho", "ρ"], ["sigma", "σ"],
  ["tau", "τ"], ["phi", "φ"], ["varphi", "φ"], ["omega", "ω"], ["Delta", "Δ"], ["Omega", "Ω"],
  ["Sigma", "Σ"], ["Theta", "Θ"], ["Phi", "Φ"], ["Lambda", "Λ"],
];
const SYMBOL_MAP = new Map(SYMBOLS);

/** The `{...}` group starting at `open` (which must be "{"), with nested braces. */
function braceGroup(text: string, open: number): { body: string; end: number } | null {
  if (text[open] !== "{") return null;
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === "{") depth++;
    else if (text[index] === "}") {
      depth--;
      if (depth === 0) return { body: text.slice(open + 1, index), end: index + 1 };
    }
  }
  return null;
}

const ATOM = /^(?:-?\d+(?:\.\d+)?|[A-Za-z0-9]|[A-Za-z]_?\d|[α-ωΑ-Ω])$/;
const wrap = (body: string) => (ATOM.test(body.trim()) ? body.trim() : `(${body.trim()})`);

/** LaTeX commands to the board's plain math. Unknown commands lose only the backslash. */
function rewriteCommands(input: string): string {
  // A degree sign is written as a superscript circle: 30^\circ, 30^{\circ}.
  const text = input.replace(/\^\s*\{?\s*\\circ\s*\}?/g, "°");
  let out = "";
  let index = 0;
  while (index < text.length) {
    if (text[index] !== "\\") {
      out += text[index];
      index++;
      continue;
    }
    const spacing = /^\\(?:[,;:!> ]|quad\b|qquad\b)/.exec(text.slice(index));
    if (spacing) {
      out += " ";
      index += spacing[0].length;
      continue;
    }
    const name = /^\\([A-Za-z]+)\s*/.exec(text.slice(index));
    if (!name) {
      // An escaped character such as \{ or \%: keep the character.
      out += text[index + 1] ?? "";
      index += 2;
      continue;
    }
    const command = name[1]!;
    const after = index + name[0].length;
    if (command === "frac" || command === "dfrac" || command === "tfrac") {
      const top = braceGroup(text, after);
      const bottom = top ? braceGroup(text, top.end) : null;
      if (top && bottom) {
        out += `(${wrap(rewriteCommands(top.body))}/${wrap(rewriteCommands(bottom.body))})`;
        index = bottom.end;
        continue;
      }
    }
    if (command === "sqrt") {
      const group = braceGroup(text, after);
      if (group) {
        out += `sqrt(${rewriteCommands(group.body).trim()})`;
        index = group.end;
        continue;
      }
    }
    if (["text", "textrm", "mathrm", "mathbf", "mathit", "operatorname", "boldsymbol", "vec", "overline", "hat", "bar"].includes(command)) {
      const group = braceGroup(text, after);
      if (group) {
        const body = rewriteCommands(group.body);
        out += command === "vec" ? `${body}→` : body;
        index = group.end;
        continue;
      }
    }
    if (command === "left" || command === "right" || command === "displaystyle" || command === "limits") {
      index = after;
      continue;
    }
    const symbol = SYMBOL_MAP.get(command);
    if (symbol) {
      // Keep the space that separated the command from what follows.
      out += /\s$/.test(name[0]) ? `${symbol} ` : symbol;
      index = after;
      continue;
    }
    out += command;
    index = after;
  }
  return out;
}

const MATHY = /[=<>^_\\+*/≤≥≠]|^\s*[A-Za-z]\s*$|\d\s*[A-Za-z]|[A-Za-z]\s*\d/;

/** Unwrap LaTeX math delimiters and rewrite the commands inside. Text without markup is unchanged. */
export function unwrapMathMarkup(text: string): string {
  if (!/[\\$]/.test(text)) return text;
  let out = text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, body: string) => rewriteCommands(body))
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, body: string) => rewriteCommands(body))
    .replace(/\$\$([\s\S]+?)\$\$/g, (_match, body: string) => rewriteCommands(body))
    .replace(/(?<![\\\w])\$([^$\n]+?)\$(?!\d)/g, (match, body: string) => (MATHY.test(body) ? rewriteCommands(body) : match));
  // A delimiter split across two rows or two sentences leaves one half behind.
  out = out.replace(/\\[()[\]]/g, "");
  // Commands outside delimiters (models drop them) still need rewriting.
  if (/\\[A-Za-z]/.test(out)) out = rewriteCommands(out);
  return out.replace(/[ \t]{2,}/g, " ");
}
