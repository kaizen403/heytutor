import {
  IncrementalTagParser,
  lessonNarrationText,
  parseDrawingCommands,
  parseStructuredLessonSteps,
  type TutorSegment,
} from "../src/index";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const nestedMathTag = "[WRITE:[4x - x^3/3]_(-2)^(2),90,325]";
const expectedText = "[4x - x^3/3]_(-2)^(2)";

function assertNestedMathCommand(
  command: ReturnType<typeof parseDrawingCommands>["commands"][number] | null | undefined,
  source: string,
): void {
  assert(command?.type === "WRITE", `${source}: expected one WRITE command`);
  assert(command.text === expectedText, `${source}: nested math text was truncated`);
  assert(command.params.join(",") === "90,325", `${source}: coordinates were not parsed`);
}

const inline = parseDrawingCommands(nestedMathTag);
assert(inline.commands.length === 1, "inline: expected exactly one command");
assertNestedMathCommand(inline.commands[0], "inline");
assert(inline.narration === "", "inline: tag suffix leaked into narration");

const structured = parseStructuredLessonSteps(
  `[STEP]Now evaluate the antiderivative. ${nestedMathTag}[/STEP]`,
);
assert(structured.length === 1, "structured: expected exactly one lesson segment");
assertNestedMathCommand(structured[0]?.command, "structured");
assert(
  structured[0]?.narration === "Now evaluate the antiderivative.",
  "structured: tag suffix leaked into narration",
);
assert(
  lessonNarrationText(`[STEP]Now evaluate the antiderivative. ${nestedMathTag}[/STEP]`) ===
    "Now evaluate the antiderivative.",
  "speech: nested tag text leaked into narration",
);

const streamed: TutorSegment[] = [];
const parser = new IncrementalTagParser({
  onSegmentReady: (segment) => streamed.push(segment),
});
for (const chunk of [
  "Now evaluate ",
  "[WRITE:[4x - x^3/3]",
  "_(-2)^(2),90,",
  "325]",
]) {
  parser.push(chunk);
}
parser.flush();

assert(streamed.length === 1, "streaming: expected exactly one lesson segment");
assertNestedMathCommand(streamed[0]?.command, "streaming");
assert(streamed[0]?.narration === "Now evaluate", "streaming: tag suffix leaked into narration");

const invalidTagSegments: TutorSegment[] = [];
const invalidTagParser = new IncrementalTagParser({
  onSegmentReady: (segment) => invalidTagSegments.push(segment),
});
invalidTagParser.push("Keep [UNKNOWN:value] as narration.");
invalidTagParser.flush();
assert(
  invalidTagSegments[0]?.narration === "Keep [UNKNOWN:value] as narration.",
  "streaming: an unknown bracket tag must remain narration",
);

const nestedLabel = parseStructuredLessonSteps(
  "[STEP]Mark the evaluated value. [LABEL:A(2)=[x^2]_0^(2),480,180,20][/STEP]",
);
assert(nestedLabel.length === 1, "label: expected exactly one lesson segment");
assert(nestedLabel[0]?.command?.type === "LABEL", "label: expected one LABEL command");
assert(
  nestedLabel[0]?.command?.text === "A(2)=[x^2]_0^(2)",
  "label: nested math text was truncated",
);
assert(
  nestedLabel[0]?.command?.params.join(",") === "480,180,20",
  "label: coordinates or font size were not parsed",
);

console.log("verify-drawing-protocol: nested WRITE/LABEL math tags pass inline, structured, and streaming parsing");
