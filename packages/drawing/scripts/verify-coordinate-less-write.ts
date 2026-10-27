/**
 * Production, 21 to 25 Oct 2026: resumed lessons wrote their rows as
 * `[WRITE:text]`, `[WRITE:text,277]` and `[WRITE:text,x,211]`. The parser
 * refused every one, the resume ink gate saw no board writing, and nine
 * "Continue lesson" turns taught nothing. The runtime places every work row
 * itself, so these rows are repaired to the work margin; anything ambiguous
 * keeps today's behaviour. The row texts here are synthetic.
 */
import {
  IncrementalTagParser,
  WORK_ZONE,
  getSegmentCommands,
  parseDrawingCommands,
  type DrawCommand,
} from "../src/index";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function streamed(source: string, chunk = 1): { writes: DrawCommand[]; narration: string } {
  const commands: DrawCommand[] = [];
  const narration: string[] = [];
  const parser = new IncrementalTagParser({
    preserveStepSpeech: true,
    onSegmentReady: (segment) => {
      commands.push(...getSegmentCommands(segment));
      narration.push(segment.narration);
    },
  });
  for (let index = 0; index < source.length; index += chunk) parser.push(source.slice(index, index + chunk));
  parser.flush();
  return { writes: commands.filter((command) => command.type === "WRITE"), narration: narration.join(" ") };
}

function batchWrites(source: string): DrawCommand[] {
  return parseDrawingCommands(source).commands.filter((command) => command.type === "WRITE");
}

const ROW = (index: number) => WORK_ZONE.topY + index * WORK_ZONE.lineHeight;

// The three shapes production sent, each closed by the next STEP marker.
const repaired: Array<[string, string, number]> = [
  ["[STEP]Pressure grows with depth. [WRITE:p = p0 + rho g h] It is linear.[/STEP]", "p = p0 + ρ g h", ROW(0)],
  [`[STEP]Heat flows by conduction. [WRITE:conduction: contact, no flow,${ROW(2)}] The solid stays put.[/STEP]`, "conduction: contact, no flow", ROW(2)],
  [`[STEP]Scale is a ratio. [WRITE:E = d/D,x,${ROW(1)}] Map over ground.[/STEP]`, "E = d/D", ROW(1)],
];
for (const [source, text, y] of repaired) {
  for (const chunk of [1, 7, 64]) {
    const { writes, narration } = streamed(source, chunk);
    assert(writes.length === 1, `the streaming parser must repair ${JSON.stringify(source)} into one row (chunk ${chunk})`);
    assert(writes[0]!.text === text, `the repaired row keeps its text: ${writes[0]!.text}`);
    assert(writes[0]!.params[0] === WORK_ZONE.marginX && writes[0]!.params[1] === y,
      `the repaired row sits at the work margin on its grid row: ${writes[0]!.params.join(",")}`);
    assert(!narration.includes("[WRITE") && !narration.includes(",x,"), "no tag or placeholder is left in the speech");
  }
  const batch = batchWrites(source);
  assert(batch.length === 1 && batch[0]!.text === text && batch[0]!.params[1] === y,
    `the batch parser must agree with the streaming parser on ${JSON.stringify(source)}`);
}

// A coordinate-less row at the very end of the stream is closed by the flush.
const lastRow = streamed("So the image is real. [WRITE:v > 0 so real]");
assert(lastRow.writes.length === 1 && lastRow.writes[0]!.text === "v > 0 so real", "the stream end closes a coordinate-less row");

// Refused: anything that could cut a row's own text, or that names no row.
const refused = [
  "[STEP]The roots are listed. [WRITE:roots: 2, 3] Both are real.[/STEP]",
  `[STEP]A row on the wrong grid. [WRITE:v = 12,100] Done.[/STEP]`,
  "[STEP]A placeholder only. [WRITE:v = 12,x] Done.[/STEP]",
  `[STEP]Off grid y. [WRITE:v = 12,x,${ROW(1) + 3}] Done.[/STEP]`,
  "[STEP]Vagina is the canal. [WRITE:w6:y475]canal: birth[/WRITE] It also receives.[/STEP]",
  "[STEP]Q2 next. [WRITE:y=541]Q2: where?[/WRITE] A board question.[/STEP]",
  "[STEP]An empty row. [WRITE:] Nothing.[/STEP]",
  // Labelled coordinates, seen in production resumes: never written as text.
  "[STEP]Tissue next. [WRITE:tissue = similar cells together:y=541] Cells group.[/STEP]",
  "[STEP]Levels. [WRITE:organ -> organism, y=475] Up a level.[/STEP]",
  "[STEP]Chapter ten. [WRITE:chapter = many exercises, x=60, y=541] Many.[/STEP]",
  "[STEP]The answer. [WRITE:solution: x = 3, y = 4] Both found.[/STEP]",
  // A thousands separator is not a coordinate: "1,211" must not become "1".
  "[STEP]The count. [WRITE:Population = 1,211] That many.[/STEP]",
  // An evaluation bar is not the end of the row: the bounds and result stay with it.
  "[STEP]Area. [WRITE:x^3/3 ]_0^1 = 1/3] So a third.[/STEP]",
  // A row id in front names a row; it must not be written as ink.
  "[STEP]Kelvin. [WRITE:w4:T(K) = T(C) + 273.15] Always kelvin.[/STEP]",
];
for (const source of refused) {
  assert(streamed(source).writes.length === 0, `the streaming parser must refuse ${JSON.stringify(source)}`);
  assert(streamed(source, 9).writes.length === 0, `the chunked streaming parser must refuse ${JSON.stringify(source)}`);
  assert(batchWrites(source).length === 0, `the batch parser must refuse ${JSON.stringify(source)}`);
}

// Labels belong to the scene engine: never repaired.
assert(parseDrawingCommands("[STEP]A label. [LABEL:A] Done.[/STEP]").commands.length === 0,
  "a coordinate-less LABEL stays refused");

// Canonical rows are untouched, including an evaluation bar whose first "]"
// is not the end of the tag: the stream must wait for the real coordinates.
const canonical = [
  `[STEP]The bar. [WRITE:x^3/3 ]_0^1 = 1/3,90,${ROW(3)}] Evaluated.[/STEP]`,
  `[STEP]Math. [WRITE:[4x - x^3/3]_(-2)^(2),90,${ROW(1)}] Done.[/STEP]`,
  `[STEP]Plain. [WRITE:F = ma,90,${ROW(0)}] Newton.[/STEP]`,
];
for (const source of canonical) {
  const batch = batchWrites(source);
  for (const chunk of [1, 5]) {
    const { writes } = streamed(source, chunk);
    assert(writes.length === 1 && batch.length === 1 && writes[0]!.text === batch[0]!.text &&
      writes[0]!.params[1] === batch[0]!.params[1],
    `a canonical row must parse the same way it always did: ${JSON.stringify(source)}`);
  }
}
assert(batchWrites(canonical[0]!)[0]!.text === "x^3/3 ]_0^1 = 1/3", "the evaluation bar row keeps its full text");

// Two coordinate-less rows in one step: each is closed by the tag after it.
const two = streamed(`[STEP]First. [WRITE:a = 1] then [WRITE:b = 2 m,${ROW(1)}] end.[/STEP]`);
assert(two.writes.map((write) => write.text).join("|") === "a = 1|b = 2 m", "consecutive repaired rows both reach the board");

// A WRITE that closes neither way is protocol: it is dropped, never spoken,
// and the tags after it still run. Recorded resumes sent these; the stream
// used to hold the rest of the step behind them and read it all aloud.
const refusedThenTags = "[STEP]Vagina is the canal. [WRITE:w6:y475]canal: birth[/WRITE] It also receives.[/STEP]\n\n" +
  `[STEP]Next the force. [WRITE:F = ma,90,${ROW(1)}] Newton. [PAUSE:400] Done.[/STEP]`;
for (const chunk of [1, 7, 64]) {
  const commands: DrawCommand[] = [];
  const narration: string[] = [];
  const parser = new IncrementalTagParser({
    preserveStepSpeech: true,
    onSegmentReady: (segment) => {
      commands.push(...getSegmentCommands(segment));
      narration.push(segment.narration);
    },
  });
  for (let index = 0; index < refusedThenTags.length; index += chunk) parser.push(refusedThenTags.slice(index, index + chunk));
  parser.flush();
  assert(commands.filter((command) => command.type === "WRITE").map((command) => command.text).join("|") === "F = ma",
    `the canonical row after a refused WRITE is still written (chunk ${chunk})`);
  assert(commands.some((command) => command.type === "PAUSE"), `the PAUSE after a refused WRITE still runs (chunk ${chunk})`);
  assert(!narration.join(" ").includes("["), `no tag text is spoken after a refused WRITE (chunk ${chunk}): ${narration.join(" | ")}`);
}
const batchRefused = parseDrawingCommands(refusedThenTags);
assert(batchRefused.commands.filter((command) => command.type === "WRITE").map((command) => command.text).join("|") === "F = ma" &&
  !/\[\/?WRITE/i.test(batchRefused.narration), "the batch parser drops the refused WRITE and the stray [/WRITE] the same way");

// Dropped protocol between two words leaves one space: words are never glued
// and two numbers never become one ("x = 2[/WRITE]3" is not "x = 23").
const glued: Array<[string, string[], string[]]> = [
  ["[STEP]It is alive.[WRITE:w3:y=211]cell = life[/WRITE]This is alive.[/STEP]", ["alive. cell", "life This"], ["alive.cell", "lifeThis"]],
  ["[STEP]Now [WRITE:w6:y475]canal: birth[/WRITE]The delivery.[/STEP]", ["birth The"], ["birthThe"]],
  ["Then x = 2[/WRITE]3 seconds later.", ["2 3 seconds"], ["23 seconds"]],
  ["[STEP]Speed v = 2[WRITE:y=277]3 seconds later.[/STEP]", ["2 3 seconds"], ["23 seconds"]],
];
for (const [source, spaced, joined] of glued) {
  const spokenBatch = parseDrawingCommands(source).narration;
  for (const chunk of [1, 7]) {
    const spoken = streamed(source, chunk).narration;
    for (const [where, text] of [["stream", spoken], ["batch", spokenBatch]] as const) {
      assert(spaced.every((piece) => text.includes(piece)) && !joined.some((piece) => text.includes(piece)),
        `dropped protocol leaves a space in the ${where} (chunk ${chunk}): ${JSON.stringify(text)}`);
    }
  }
}

// The overflow and the end of the stream drop a refused WRITE too.
const overflow = streamed(`[STEP]A row. [WRITE:y=277] ${"then more words ".repeat(24)}[/STEP]`);
assert(overflow.writes.length === 0 && !overflow.narration.includes("[WRITE"), "a refused WRITE held past the buffer limit is not spoken");
assert(!streamed("Last words. [WRITE:w5]").narration.includes("[WRITE"), "a refused WRITE at the end of the stream is not spoken");

// The refused span ends at the tag's own "]": a bracket in the speech after it
// (an interval) is speech, not part of the tag.
const interval = "[STEP]The domain. [WRITE:w5] Take x in (0, 1]. Then solve.[/STEP]";
for (const chunk of [1, 9]) {
  const spoken = streamed(interval, chunk).narration;
  assert(spoken.includes("Take x in (0, 1]") && !spoken.includes("[WRITE"), `the words after a refused WRITE are still spoken (chunk ${chunk}): ${spoken}`);
}
assert(parseDrawingCommands(interval).narration.includes("Take x in (0, 1]"), "the batch parser keeps the words after a refused WRITE");

// A row may quote a closing tag: only a stray [/WRITE] outside a row is dropped.
const quoted = `[STEP]The tag. [WRITE:the [/WRITE] tag,90,${ROW(1)}] Quoted.[/STEP]`;
assert(batchWrites(quoted)[0]?.text === "the [/WRITE] tag", `the batch parser keeps a quoted [/WRITE] in a row: ${batchWrites(quoted)[0]?.text}`);
assert(streamed(quoted).writes[0]?.text === "the [/WRITE] tag", "the streaming parser keeps a quoted [/WRITE] in a row");

// An evaluation bar refused as a row leaves with its bounds, not as speech.
const bar = streamed("[STEP]Area. [WRITE:x^3/3 ]_0^1 = 1/3] So a third.[/STEP]");
assert(bar.writes.length === 0 && !bar.narration.includes("[") && !bar.narration.includes("_0^1"),
  `a refused evaluation bar row is neither written nor read out: ${bar.narration}`);

console.log("verify-coordinate-less-write: coordinate-less WRITE rows are repaired to the work margin; ambiguous, id-shaped and LABEL tags stay refused; canonical rows are unchanged; a WRITE that closes neither way is dropped from speech and the tags after it still run");
