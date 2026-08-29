import {
  hasMathNotation,
  parseMathText,
  toPlainMathText,
} from "@/features/tutor-session/lib/mathText";

/**
 * The chat must show notation, never markup — and must not mangle prose while
 * doing it. The narrow rule these gates pin down is the whole point: an
 * underscore is only notation when it clearly is.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const shape = (text: string): string =>
  parseMathText(text)
    .map((run) => (run.kind === "text" ? run.value : `<${run.kind}>${run.value}`))
    .join("|");

// --- the cases the board actually emits -----------------------------------
assert(shape("R_1") === "R|<sub>1", `R_1 → ${shape("R_1")}`);
assert(shape("v^2") === "v|<sup>2", `v^2 → ${shape("v^2")}`);
assert(shape("F_net") === "F|<sub>net", `F_net → ${shape("F_net")}`);
assert(shape("R_{eq}") === "R|<sub>eq", `braces → ${shape("R_{eq}")}`);
assert(shape("x^{n+1}") === "x|<sup>n+1", `braced superscript → ${shape("x^{n+1}")}`);
assert(shape("R_12") === "R|<sub>12", `multi-digit → ${shape("R_12")}`);
assert(
  shape("v_1 = u_1 + a_1 t") === "v|<sub>1| = u|<sub>1| + a|<sub>1| t",
  `a whole equation → ${shape("v_1 = u_1 + a_1 t")}`,
);
assert(shape("E_k = 1/2 m v^2") === "E|<sub>k| = 1/2 m v|<sup>2", `mixed → ${shape("E_k = 1/2 m v^2")}`);

// --- prose must survive intact --------------------------------------------
assert(shape("snake_case") === "snake_case", `snake_case must be left alone, got ${shape("snake_case")}`);
assert(
  shape("a_very_long_identifier") === "a_very_long_identifier",
  `long identifiers stay literal, got ${shape("a_very_long_identifier")}`,
);
assert(shape("_leading") === "_leading", "a marker with nothing on its left is literal");
assert(shape("trailing_") === "trailing_", "a marker with nothing after it is literal");
assert(shape("R_{unclosed") === "R_{unclosed", "an unclosed brace stays literal");
assert(shape("R_{}") === "R_{}", "an empty script stays literal");
assert(shape("plain english sentence") === "plain english sentence", "prose is untouched");
assert(shape("") === "", "empty input is empty output");
assert(shape("100% sure") === "100% sure", "percentages are untouched");
assert(shape("2^10 bytes") === "2|<sup>10| bytes", "a numeric superscript still works");

// --- nothing is ever lost --------------------------------------------------
for (const sample of [
  "R_1", "v^2", "F_net", "R_{eq}", "x^{n+1}", "snake_case", "plain text",
  "E_k = 1/2 m v^2", "a_1 + b_2 = c_3", "_leading", "trailing_", "R_{unclosed",
]) {
  const runs = parseMathText(sample);
  const rebuilt = runs
    .map((run) => (run.kind === "text" ? run.value : (run.kind === "sub" ? "_" : "^") + run.value))
    .join("");
  const withoutBraces = sample.replace(/([_^])\{([^}]+)\}/g, "$1$2");
  assert(
    rebuilt === withoutBraces,
    `parsing must be lossless for "${sample}": got "${rebuilt}", expected "${withoutBraces}"`,
  );
}

// --- detection -------------------------------------------------------------
assert(hasMathNotation("R_1"), "notation is detected");
assert(!hasMathNotation("snake_case"), "an identifier is not notation");
assert(!hasMathNotation("just words"), "prose is not notation");

// --- plain-text fallback (clipboard, aria) ---------------------------------
assert(toPlainMathText("R_1") === "R₁", `plain R_1 → ${toPlainMathText("R_1")}`);
assert(toPlainMathText("v^2") === "v²", `plain v^2 → ${toPlainMathText("v^2")}`);
assert(toPlainMathText("R_12") === "R₁₂", `plain R_12 → ${toPlainMathText("R_12")}`);
// No script glyphs exist for letters, so the source form is kept rather than
// producing half-raised text.
assert(toPlainMathText("F_net") === "F_net", `plain F_net → ${toPlainMathText("F_net")}`);
assert(toPlainMathText("snake_case") === "snake_case", "prose survives the plain form");

console.log(
  "verify-math-text: notation renders as scripts, identifiers and prose stay literal, parsing is lossless",
);
