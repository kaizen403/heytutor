import { normalizeTutorQuestion } from "../../src/text/questionText";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  normalizeTutorQuestion("The region under \\(y = \\sqrt{x}\\) from \\(x = 0\\) to \\(x = 4\\)").includes("sqrt(x)"),
  "inline LaTeX sqrt must become sqrt(x)",
);
assert(
  !normalizeTutorQuestion("The region under \\(y = \\sqrt{x}\\) from x = 0").includes("y = x from"),
  "sqrt must not collapse to y = x",
);
assert(
  normalizeTutorQuestion("Sketch $y = x^2$ and the circle").includes("y = x^2"),
  "dollar math must keep the expression",
);
assert(
  normalizeTutorQuestion("A prism of index \\sqrt{3}").includes("sqrt(3)"),
  "bare LaTeX sqrt{3} must become sqrt(3)",
);
assert(
  normalizeTutorQuestion("volume is 8π").includes("8pi"),
  "unicode pi must become pi for planners",
);
assert(
  normalizeTutorQuestion("y = x² − 4").includes("x^2 - 4"),
  "unicode superscript and minus must become ASCII",
);
assert(
  normalizeTutorQuestion("y = x\u200By = x").includes("y = x"),
  "zero-width characters must be stripped",
);

console.log("verify-question-text: ok");
