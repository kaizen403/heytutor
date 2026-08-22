import {
  parseExtractedQuestion,
  readExtractedContent,
} from "../../lib/llm/extractQuestion";
import { pickClipboardImage } from "../../features/tutor-session/lib/questionImageInput";
import {
  DEFAULT_FIREWORKS_MODEL,
  DEFAULT_FIREWORKS_VISION_MODEL,
  resolveFireworksModel,
  resolveFireworksVisionModel,
} from "../../lib/llm/fireworksModels";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  resolveFireworksVisionModel({}) === DEFAULT_FIREWORKS_VISION_MODEL,
  "vision should default to Qwen 3.7 Plus",
);
assert(
  resolveFireworksVisionModel({ FIREWORKS_VISION_MODEL: "only-vision" }) ===
    "only-vision",
  "FIREWORKS_VISION_MODEL must be the only vision model",
);
assert(
  resolveFireworksVisionModel({ FIREWORKS_MODEL: "teaching-model" }) ===
    DEFAULT_FIREWORKS_VISION_MODEL,
  "teaching ENV must not change the vision model",
);
assert(
  resolveFireworksModel({ env: { FIREWORKS_VISION_MODEL: "only-vision" } }) ===
    DEFAULT_FIREWORKS_MODEL,
  "vision ENV must not change the teaching model",
);

assert(
  parseExtractedQuestion(
    "```latex\nThe region under \\(y = \\sqrt{x}\\) from \\(x = 0\\) to \\(x = 4\\). Find the volume.\n```",
  )?.includes("sqrt(x)") === true,
  "extracted LaTeX square roots must become tutor math",
);
assert(
  parseExtractedQuestion("Find $\\frac{2x+1}{x-3}$ when x = 5.")?.includes(
    "(2x+1)/(x-3)",
  ) === true,
  "extracted stacked fractions must become (num)/(den)",
);
assert(
  parseExtractedQuestion("Question: Sketch $y = x^{2}$ and find dy/dx.")?.includes(
    "x^2",
  ) === true,
  "extracted powers must stay intact after the Question: prefix",
);
assert(
  parseExtractedQuestion("NO_QUESTION") === null,
  "an empty photo must not become a question",
);
assert(
  parseExtractedQuestion("I cannot read this image.") === null,
  "refusals must not become a question",
);
assert(
  readExtractedContent([{ type: "text", text: "Find $x^2$." }]).includes("x^2"),
  "vision content arrays must flatten to text",
);

const pasted = new File(["x"], "question.png", { type: "image/png" });
assert(
  pickClipboardImage({
    items: [{ kind: "file", type: "image/png", getAsFile: () => pasted }],
  }) === pasted,
  "pasted images must go to OCR",
);
assert(
  pickClipboardImage({
    items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
    files: [new File(["x"], "notes.txt", { type: "text/plain" })],
  }) === null,
  "plain text paste must not start OCR",
);

console.log("extract question verification passed");
