import { readFileSync } from "node:fs";
import {
  parseExtractedQuestion,
  readExtractedContent,
} from "../../lib/llm/extractQuestion";
import { readQuestionImage } from "../../lib/object-store/questionImage";
import { pickClipboardImage } from "../../features/tutor-session/lib/input/questionImageInput";
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

const pngBytes = Uint8Array.from([1, 2, 3, 4]);
const pngDataUrl = `data:image/png;base64,${Buffer.from(pngBytes).toString("base64")}`;
const parsedPng = readQuestionImage(pngDataUrl);
assert(parsedPng?.mimeType === "image/png", "png data URLs keep their mime");
assert(parsedPng?.ext === "png", "png data URLs map to .png");
assert(parsedPng != null && Buffer.from(parsedPng.bytes).equals(Buffer.from(pngBytes)), "png bytes round-trip");
assert(readQuestionImage("data:image/svg+xml;base64,YQ==") === null, "svg photos are rejected");
assert(readQuestionImage("not-a-data-url") === null, "plain text is not a photo");

const extractRoute = readFileSync(new URL("../../app/api/extract-question/route.ts", import.meta.url), "utf8");
assert(extractRoute.includes("startTurnTrace"), "OCR must open a Langfuse generation");
assert(extractRoute.includes('generationName: "qwen-vision"'), "OCR observations must be named for the vision lane");

console.log("extract question verification passed");
