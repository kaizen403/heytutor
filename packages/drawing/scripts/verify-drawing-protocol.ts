import {
  IncrementalTagParser,
  lessonNarrationText,
  normalizeBoardText,
  normalizeStrokeText,
  parseDrawingCommands,
  parseStructuredLessonSteps,
  textToStrokePaths,
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

const inlineUnknown = parseDrawingCommands("Keep [UNKNOWN:value] as narration.");
assert(
  inlineUnknown.segments.some((segment) =>
    segment.text.includes("[UNKNOWN:value]"),
  ),
  "inline: unknown bracket tag must remain in a segment",
);
assert(
  inlineUnknown.narration.includes("[UNKNOWN:value]"),
  "inline: unknown bracket tag must remain in aggregate narration",
);

const deltaBoard = "[WRITE:Delta T = delta x,10,20]";
const deltaParsed = parseDrawingCommands(deltaBoard);
assert(deltaParsed.commands[0]?.text?.includes("Δ"), "uppercase Delta must become Δ");
assert(deltaParsed.commands[0]?.text?.includes("δ"), "lowercase delta must become δ");
assert(
  !deltaParsed.commands[0]?.text?.includes("δ T"),
  "uppercase Delta must not be lowercased to δ before Δ normalization",
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

const piWrite = parseDrawingCommands("[WRITE:V = 8pi,10,20]");
assert(piWrite.commands[0]?.text?.includes("π"), "8pi in WRITE must become π, not the letters p-i");
assert(!piWrite.commands[0]?.text?.includes("pi"), "8pi must not remain as latin letters after board normalization");

const latexPiWrite = parseDrawingCommands("[WRITE:\\pi r^2,10,20]");
assert(latexPiWrite.commands[0]?.text?.includes("π"), "\\pi in WRITE must become π");
assert(!latexPiWrite.commands[0]?.text?.includes("\\"), "\\pi must not leave a leftover backslash");

assert(normalizeBoardText("area = pi x r^2").includes("π"), "word pi must become π");
assert(normalizeStrokeText("V=8pi").includes("π"), "8pi must become π even without word boundaries");
assert(!normalizeBoardText("speed").includes("π"), "English speed must not become π");
assert(!normalizeBoardText("picky").includes("π"), "picky must not become π");

const piGlyphs = await textToStrokePaths("π", 0, 100, 40);
const nGlyphs = await textToStrokePaths("n", 0, 100, 40);
const piGlyph = piGlyphs[0];
const nGlyph = nGlyphs[0];
assert(piGlyph && piGlyph.strokes.length >= 3, "handwritten π must be a top bar plus two legs");
assert(nGlyph && nGlyph.strokes.length >= 1, "latin n must still render");
assert(
  piGlyph.strokes[0]?.pathData !== nGlyph.strokes[0]?.pathData,
  "π must not reuse the latin n glyph (n-with-a-bar)",
);

console.log("verify-drawing-protocol: nested WRITE/LABEL math tags pass inline, structured, and streaming parsing");
