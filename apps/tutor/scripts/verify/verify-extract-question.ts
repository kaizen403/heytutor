import { readFileSync } from "node:fs";
import {
  EXTRACT_QUESTION_PROMPT,
  EXTRACT_QUESTION_SECOND_LOOK_PROMPT,
  MAX_EXTRACTED_QUESTION_CHARS,
  parseExtractedQuestion,
  readExtractedContent,
  readExtraction,
  readExtractionChoice,
  shouldTakeSecondLook,
} from "../../lib/llm/extractQuestion";
import { readQuestionImage } from "../../lib/object-store/questionImage";
import { pickClipboardImage } from "../../features/tutor-session/lib/input/questionImageInput";
import { questionImageScale } from "../../features/tutor-session/lib/input/compressQuestionImage";
import {
  DEFAULT_FIREWORKS_MODEL,
  DEFAULT_FIREWORKS_VISION_MODEL,
  resolveFireworksModel,
  resolveFireworksVisionModel,
  resolveFireworksVisionModels,
} from "../../lib/llm/fireworksModels";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  resolveFireworksVisionModel({}) === DEFAULT_FIREWORKS_VISION_MODEL,
  "vision should default to DeepSeek V4.1 Flash",
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

// Format drift around a real transcription must not lose the question.
const KEPT: ReadonlyArray<readonly [string, string, string]> = [
  ["```text\nSolve 3x + 4 = 19.\n```", "Solve 3x + 4 = 19.", "any fence language"],
  ["```\nSolve 3x + 4 = 19.\n```", "Solve 3x + 4 = 19.", "a bare fence"],
  ["**Question:** Solve 3x + 4 = 19.", "Solve 3x + 4 = 19.", "a bold label"],
  ["## Problem: Solve 3x + 4 = 19.", "Solve 3x + 4 = 19.", "a heading label"],
  ["Here is the transcribed question:\nSolve 3x + 4 = 19.", "Solve 3x + 4 = 19.", "a preamble line"],
  ["<think>reading the page</think>\nSolve 3x + 4 = 19.", "Solve 3x + 4 = 19.", "a thinking block"],
  [
    "There is no friction on the synthetic ramp. Find the block's acceleration.",
    "There is no friction",
    "a question that opens with 'There is no'",
  ],
  [
    "Triangle PQR has PQ = 7 cm and angle Q = 90°. Find the angle marked y.",
    "Find the angle marked y",
    "a diagram-only task",
  ],
  [
    "A synthetic train leaves at [unclear] and travels 40 km. Find its average speed.",
    "[unclear]",
    "a partly unreadable question",
  ],
  ["1. Expand (a + 2)^2.\n2. Factor b^2 - 9.", "Factor", "several numbered questions"],
];
for (const [raw, expected, label] of KEPT) {
  const extraction = readExtraction(raw);
  assert(
    extraction.question?.includes(expected) === true && !extraction.question.startsWith("**"),
    `${label} must stay a question, got ${JSON.stringify(extraction)}`,
  );
}

const DECLINED: ReadonlyArray<readonly [string, string]> = [
  ["NO_QUESTION", "no_question"],
  ["`NO_QUESTION`", "no_question"],
  ["**NO_QUESTION**", "no_question"],
  ["```\nNO_QUESTION\n```", "no_question"],
  ["NO_QUESTION.\nThe synthetic photo shows a desk lamp.", "no_question"],
  ["The synthetic photo shows a desk lamp.\nNO_QUESTION", "no_question"],
  ["Question: NO_QUESTION", "no_question"],
  ["I'm unable to read this image.", "refusal"],
  ["Sorry, I can't help with that.", "refusal"],
  ["There is no question in this image.", "refusal"],
  ["The image does not contain a question.", "refusal"],
  ["   ", "empty"],
  ["<think>nothing here</think>", "empty"],
  ["ab", "too_short"],
  [`Find x. ${"Synthetic filler text. ".repeat(700)}`, "too_long"],
];
for (const [raw, reason] of DECLINED) {
  const extraction = readExtraction(raw);
  assert(
    extraction.question === null && extraction.reason === reason,
    `${JSON.stringify(raw.slice(0, 40))} must decline as ${reason}, got ${JSON.stringify(extraction).slice(0, 120)}`,
  );
}
assert(MAX_EXTRACTED_QUESTION_CHARS === 12_000, "the transcription cap is unchanged");

const structuredRefusal = readExtractionChoice({
  message: { content: null, refusal: "Synthetic refusal." },
  finish_reason: "stop",
});
assert(
  structuredRefusal.reason === "refusal" && structuredRefusal.reply === "Synthetic refusal.",
  "message.refusal with null content is a refusal, not an empty page",
);
const truncated = readExtractionChoice({ message: { content: "" }, finish_reason: "length" });
assert(truncated.reason === "empty" && truncated.finishReason === "length", "finish_reason is kept for the trace");
assert(readExtractionChoice(undefined).reason === "empty", "a missing choice is an empty reply");
assert(
  readExtractionChoice({ message: { content: [{ type: "output_text", text: "Solve 2y = 8." }] } }).question === "Solve 2y = 8.",
  "content arrays read through the choice helper",
);

assert(shouldTakeSecondLook(readExtraction("NO_QUESTION")), "a decline earns a second look");
assert(shouldTakeSecondLook(readExtraction("")), "an empty reply earns a second look");
assert(shouldTakeSecondLook(readExtraction("I cannot read this image.")), "a refusal earns a second look");
assert(!shouldTakeSecondLook(readExtraction("Solve 3x + 4 = 19.")), "a found question needs no second look");
assert(
  !shouldTakeSecondLook(readExtraction("Synthetic filler text. ".repeat(700))),
  "a too-long transcription is not retried",
);

for (const cue of ["handwritten", "diagram", "cut off", "several questions", "NO_QUESTION"]) {
  assert(EXTRACT_QUESTION_PROMPT.includes(cue), `the OCR prompt must cover: ${cue}`);
}
assert(
  EXTRACT_QUESTION_SECOND_LOOK_PROMPT.startsWith(EXTRACT_QUESTION_PROMPT) &&
    EXTRACT_QUESTION_SECOND_LOOK_PROMPT.includes("Look again"),
  "the second look repeats the instructions and asks for a careful reread",
);

// Small crops are enlarged so text keeps vision tokens; large photos shrink to the attempt edge.
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
assert(near(questionImageScale(400, 120, 1600) * 400, 1024), "a small screenshot crop grows to 1024 px");
assert(near(questionImageScale(200, 100, 1600), 3), "upscaling is capped at 3x");
assert(near(questionImageScale(500, 300, 800) * 500, 800), "an enlarged crop still respects the attempt edge");
assert(near(questionImageScale(3000, 4000, 1600) * 4000, 1600), "a phone photo shrinks to the attempt edge");
assert(questionImageScale(1200, 900, 1600) === 1, "a mid-size image is left alone");

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

// A real 1x1 PNG: the parser reads the IHDR dimensions, so junk bytes fail.
const pngBytes = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const pngDataUrl = `data:image/png;base64,${Buffer.from(pngBytes).toString("base64")}`;
const parsedPng = readQuestionImage(pngDataUrl);
assert(parsedPng?.mimeType === "image/png", "png data URLs keep their mime");
assert(parsedPng?.ext === "png", "png data URLs map to .png");
assert(parsedPng != null && Buffer.from(parsedPng.bytes).equals(Buffer.from(pngBytes)), "png bytes round-trip");
assert(parsedPng?.width === 1 && parsedPng.height === 1, "the header size is returned for the trace");
assert(readQuestionImage("data:image/svg+xml;base64,YQ==") === null, "svg photos are rejected");
assert(readQuestionImage("not-a-data-url") === null, "plain text is not a photo");

const extractRoute = readFileSync(new URL("../../app/api/extract-question/route.ts", import.meta.url), "utf8");
assert(extractRoute.includes("startTurnTrace"), "OCR must open a Langfuse generation");
assert(extractRoute.includes('generationName: "vision-ocr"'), "OCR observations must be named for the vision lane");
assert(
  JSON.stringify(resolveFireworksVisionModels({ FIREWORKS_VISION_MODEL: "withdrawn" })) ===
    JSON.stringify(["withdrawn", DEFAULT_FIREWORKS_VISION_MODEL]),
  "a configured vision model must fall back to the default",
);
assert(
  JSON.stringify(resolveFireworksVisionModels({})) === JSON.stringify([DEFAULT_FIREWORKS_VISION_MODEL]),
  "the default vision model is tried once",
);
assert(!DEFAULT_FIREWORKS_VISION_MODEL.includes("kimi"), "photo OCR must not default to Kimi pricing");
assert(extractRoute.includes("response.status !== 404"), "a withdrawn model must fall through to the next one");
assert(
  extractRoute.includes("resolveFireworksVisionModels(endpointEnv(llm))"),
  "the vision model must come from the provider the request resolved",
);

console.log("extract question verification passed");
