import {
  IncrementalTagParser,
  checkSegmentAlignment,
  lessonNarrationText,
  normalizeBoardText,
  normalizeStrokeText,
  parseDrawingCommands,
  parseFocusSpec,
  parseStructuredLessonSteps,
  parseWorkRowSelector,
  prepareVerifiedLessonSegments,
  isBlockedVerifiedDiagramCommand,
  resolveWorkAreaRow,
  hitTestVerifiedAnchor,
  spokenFocusTarget,
  textToStrokePaths,
  type TutorSegment,
  type VerifiedDiagram,
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

const diagram: VerifiedDiagram = {
  id: "verified_scene",
  name: "optics",
  commands: [],
  anchors: [
    { id: "object_base", labels: ["object_base", "O", "object position"], x: 420, y: 300, width: 12, height: 12 },
    { id: "image_base", labels: ["image_base", "I", "image position"], x: 360, y: 300, width: 12, height: 12 },
    { id: "object", labels: ["object", "O", "object"], x: 420, y: 250, width: 12, height: 80 },
    { id: "ab", labels: ["ab", "AB"], x: 450, y: 300, width: 200, height: 8 },
    { id: "mirror", labels: ["mirror", "M"], x: 700, y: 200, width: 16, height: 140 },
  ],
  reveals: [],
  promptAddon: "",
};

const imageAnchor = spokenFocusTarget("this is I, the image.", diagram);
assert(imageAnchor?.id === "image_base", "spoken I must mark the image point");
const objectAnchor = spokenFocusTarget("the object sits in front of the mirror.", diagram);
assert(objectAnchor?.id === "object_base", "spoken object must mark the smaller object point, not the arrow");
assert(
  spokenFocusTarget("i will substitute the given distances.", diagram) === null,
  "first-person i must not be treated as the image point",
);

const namedImage = prepareVerifiedLessonSegments([
  { narration: "this is I, the image.", command: null },
], diagram);
assert(namedImage.segments[0]?.command?.type === "FOCUS", "naming I must attach a FOCUS command");
assert(namedImage.segments[0]?.command?.text === "image_base|pulse", "naming a compact point must pulse the verified image entity");
assert(
  checkSegmentAlignment({
    narration: "this is I, the image.",
    command: namedImage.segments[0]!.command,
  }).aligned,
  "verified FOCUS must stay aligned with the spoken name",
);

const firstPerson = prepareVerifiedLessonSegments([
  { narration: "i will substitute the given distances.", command: null },
], diagram);
assert(firstPerson.segments[0]?.command === null, "first-person speech must not invent a FOCUS mark");

assert(spokenFocusTarget("notice AB.", diagram)?.id === "ab", "notice AB must select the labeled segment");
assert(spokenFocusTarget("look at the mirror.", diagram)?.id === "mirror", "a spoken display label must select the figure part");
const noticedMirror = prepareVerifiedLessonSegments([
  { narration: "look at the mirror.", command: null },
], diagram);
assert(noticedMirror.segments[0]?.command?.type === "FOCUS", "naming the mirror must move the marker");
assert(noticedMirror.segments[0]?.command?.text === "mirror", "the mirror label must trace the verified apparatus");
assert(
  spokenFocusTarget("the mirror equation is one over f.", diagram) === null,
  "a formula name must not steal FOCUS from a nearby apparatus label",
);
assert(
  spokenFocusTarget("the object sits in front of the mirror.", diagram)?.id === "object_base",
  "object role still wins over a later apparatus label",
);
const noticedEdge = prepareVerifiedLessonSegments([
  { narration: "notice AB.", command: null },
], diagram);
assert(noticedEdge.segments[0]?.command?.type === "FOCUS", "notice AB must attach FOCUS without a teaching tag");
assert(
  noticedEdge.segments[0]?.command?.text === "ab",
  "a long segment is traced, not pulsed like a point",
);

const circledImage = prepareVerifiedLessonSegments([
  { narration: "let me circle the image I.", command: null },
], diagram);
assert(circledImage.segments[0]?.command?.type === "FOCUS", "circle intent must become FOCUS, not CIRCLE_AROUND");
assert(
  circledImage.segments[0]?.command?.text === "image_base|pulse",
  "circling a labeled point must pulse the verified image entity",
);
assert(
  !/let me circle/i.test(circledImage.segments[0]?.narration ?? ""),
  "first-person circle speech must be stripped after the semantic focus is attached",
);
assert(
  /notice/i.test(circledImage.segments[0]?.narration ?? ""),
  "a stripped circle sentence must still leave a spoken notice cue",
);

const spotlight = parseDrawingCommands("[STEP]notice AB. [FOCUS:ab|spotlight][/STEP]");
assert(spotlight.commands[0]?.type === "FOCUS" && spotlight.commands[0].text === "ab|spotlight", "FOCUS spotlight form must parse");
assert(parseFocusSpec(spotlight.commands[0]?.text).emphasis === "spotlight", "FOCUS|spotlight must decode as spotlight");
assert(parseFocusSpec("ab,cd|pulse").targetIds.join(",") === "ab,cd", "multi-id FOCUS must split entity ids");
assert(parseFocusSpec("ab,cd|pulse").emphasis === "pulse", "FOCUS|pulse must decode as pulse");

const emphasize = parseDrawingCommands("[STEP]keep this line. [EMPHASIZE:last][/STEP]");
assert(emphasize.commands[0]?.type === "EMPHASIZE" && emphasize.commands[0].text === "last", "EMPHASIZE must parse a work-row selector");
const supersede = parseDrawingCommands("[STEP]that earlier line is replaced. [SUPERSEDE:1][/STEP]");
assert(supersede.commands[0]?.type === "SUPERSEDE" && supersede.commands[0].text === "1", "leftover SUPERSEDE tags must still parse so they do not leak into speech");
assert(isBlockedVerifiedDiagramCommand(supersede.commands[0]!, null), "SUPERSEDE must not execute as a strike");
const annotate = parseDrawingCommands("[STEP]the length is 4. [ANNOTATE:u_dim][/STEP]");
assert(annotate.commands[0]?.type === "ANNOTATE" && annotate.commands[0].text === "u_dim", "ANNOTATE must parse an entity id");

const workRow = resolveWorkAreaRow(parseWorkRowSelector("w2"), [
  { x: 90, y: 145, width: 120, height: 32, text: "a = 1", workIndex: 1, workId: "w1" },
  { x: 90, y: 205, width: 120, height: 32, text: "b = 2", workIndex: 2, workId: "w2" },
]);
assert(workRow?.text === "b = 2", "work-row selectors must resolve by workId");

const hitDiagram: VerifiedDiagram = {
  id: "verified_scene",
  name: "hit",
  commands: [{
    type: "DRAW_LINE",
    params: [450, 300, 700, 300],
    semanticRef: { entityId: "ab" },
  }],
  anchors: [{ id: "ab", labels: ["ab", "AB"], x: 450, y: 292, width: 250, height: 16 }],
  reveals: [],
  promptAddon: "",
};
assert(hitTestVerifiedAnchor(575, 300, hitDiagram)?.id === "ab", "path-distance hit test must select the traced segment");
assert(hitTestVerifiedAnchor(100, 100, hitDiagram) === null, "far clicks must not select a diagram entity");

console.log("verify-drawing-protocol: nested WRITE/LABEL math tags pass inline, structured, and streaming parsing");
