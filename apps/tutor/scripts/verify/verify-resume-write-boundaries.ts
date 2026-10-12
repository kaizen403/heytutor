/** Actual streaming resume boundary; controlled continuation, not recovered C08 output. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import {
  IncrementalTagParser as PackageParser, getSegmentCommands, parseDrawingCommands as packageParse,
  prepareVerifiedLessonSegments, DRAW_COMMAND_TYPES, type TutorSegment,
} from "@heytutor/drawing";
import { LectureMarkupBuffer } from "../../features/tutor-session/lib/turn/lectureCueRepair";
import { createResumeInkGate, normalizeSegmentForAlignment } from "../../features/tutor-session/lib/turn/segmentPlanning";
import { buildResumeTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";

// Optional source substitutions let the gate challenge one real protocol
// boundary without modifying built packages or other agents' test processes.
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const protocolFile = fileURLToPath(new URL("../../../../packages/drawing/src/protocol/drawingProtocol.ts", import.meta.url));
const parserFile = fileURLToPath(new URL("../../../../packages/drawing/src/protocol/incrementalParser.ts", import.meta.url));
function load(file: string, canonical: string, protocol?: unknown): unknown {
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", code)((specifier: string) =>
    protocol && specifier === "./drawingProtocol" ? protocol : requireApp(specifier.startsWith(".")
      ? path.resolve(path.dirname(canonical), specifier) : specifier), loaded, loaded.exports);
  return loaded.exports;
}
const protocol = process.env.RESUME_WRITE_PROTOCOL_SOURCE
  ? load(process.env.RESUME_WRITE_PROTOCOL_SOURCE, protocolFile) as { parseDrawingCommands: typeof packageParse }
  : null;
const IncrementalTagParser = process.env.RESUME_WRITE_PARSER_SOURCE || protocol
  ? (load(process.env.RESUME_WRITE_PARSER_SOURCE ?? parserFile, parserFile, protocol) as { IncrementalTagParser: typeof PackageParser }).IncrementalTagParser
  : PackageParser;
const parseDrawingCommands = protocol?.parseDrawingCommands ?? packageParse;

// Exact retained stopped teaching prefix. The failed Continue streams were not
// retained. Everything after this context in this gate is a controlled fixture.
const retainedPrefix = "alright... this one is about electrolysis of molten sodium chloride. let's build it up from the beginning. Electrolysis of molten sodium chloride: the beaker, the solution level, the anode electrode, the cathode electrode, the battery positive plate, the battery negative plate, the wire, the gas bubble, the metal deposit, and the electron flow. electrolysis uses electrical energy to break down a molten compound; molten sodium chloride is sodium chloride in its liquid state. notice NaCl(l), the molten electrolyte: it contains mobile sodium ions and chloride ions.";
const prompt = buildResumeTeachingPrompt({
  lessonQuestion: "Explain electrolysis of molten sodium chloride. Show the electrodes and write both half-equations.",
  boardRows: [{ text: "electrolysis: electrical breakdown" }, { text: "NaCl(l) → Na^(+) + Cl^(-)" }],
  interruptedStep: retainedPrefix.slice(retainedPrefix.lastIndexOf("notice")),
  rowsLeftOnPage: 5, nextRowY: 274, diagramPromptAddon: null, codePanelShowing: false,
  turnPlan: null, solverProjection: null, familiarity: "normal", fastMode: false,
});
assert(prompt.runtimeAddon.includes("NaCl(l) → Na^(+) + Cl^(-)"));
assert(prompt.runtimeAddon.includes("mobile sodium ions and chloride ions"));

function consume(source: string, width: number, repairMarkup = true) {
  const markup = new LectureMarkupBuffer();
  const gate = createResumeInkGate();
  const parsed: TutorSegment[] = [], released: TutorSegment[] = [];
  let buffered: TutorSegment | null = null;
  const flush = () => {
    if (!buffered) return;
    for (const segment of prepareVerifiedLessonSegments([buffered], null).segments) {
      released.push(...gate.offer(normalizeSegmentForAlignment(segment)));
    }
    buffered = null;
  };
  const parser = new IncrementalTagParser({ preserveStepSpeech: true,
    onSegmentReady: (segment) => { flush(); parsed.push(structuredClone(segment)); buffered = segment; },
  });
  for (let from = 0; from < source.length; from += width) {
    const delta = source.slice(from, from + width);
    parser.push(repairMarkup ? markup.push(delta) : delta);
  }
  if (repairMarkup) parser.push(markup.finish());
  parser.flush(); flush();
  return { hasInk: gate.hasInk(), parsed, released };
}
const text = "Na^+ + e^- -> Na";
const spoken = "Sodium ions gain one electron to form sodium metal.";
const canonical = `[STEP]${spoken} [WRITE:${text},90,274][/STEP]`;
const header = `[STEP]${spoken} [WRITE]${text},90,274[/STEP]`;
const row = (segments: TutorSegment[]) => segments.flatMap(getSegmentCommands)
  .filter((command) => command.type === "WRITE")
  .map((command) => ({ text: command.text, params: command.params }));

let groups = 0;
for (const width of [1, 2, 7, 19, header.length]) {
  for (const repairMarkup of [false, true]) {
    const control = consume(canonical, width, repairMarkup);
    const actual = consume(header, width, repairMarkup);
    assert(control.hasInk, "canonical continuation reaches spoken-and-written playback");
    assert(actual.hasInk, "header-only WRITE before closing STEP reaches resumed playback");
    assert.deepEqual(row(actual.released), row(control.released));
    assert.equal(actual.released[0]?.narration, spoken);
    assert(!actual.released.some((segment) => /\[WRITE\]|,90,274/.test(segment.narration)),
      "protocol and coordinates are never narrated");
  }
}
assert.deepEqual(row(consume(header, 1).parsed),
  parseDrawingCommands(header).commands.filter((command) => command.type === "WRITE")
    .map((command) => ({ text: command.text, params: command.params })),
  "whole parsing and incremental parsing preserve the same board row");
groups++;

// Indexed work can name any protocol token without turning into that token.
// Keep the live markup -> parser -> authority -> resume-ink consumer in the gate.
for (const type of DRAW_COMMAND_TYPES) {
  const indexed = `dp[${type.toLowerCase()}] = 3`;
  for (const header of ["[WRITE:", "[WRITE]"]) {
    const source = `[STEP]Explain the index. ${header}${indexed},90,274${header.endsWith(":") ? "]" : ""}[/STEP]`;
    for (const width of [1, 7, source.length]) {
      const actual = consume(source, width);
      assert(actual.hasInk, `indexed ${type} reaches resumed spoken-and-written playback`);
      assert.deepEqual(row(actual.released), [{ text: indexed, params: [90, 274, 32] }]);
      assert.equal(actual.released[0]?.narration, "Explain the index.");
      assert(!actual.parsed.flatMap(getSegmentCommands).some(command => command.type !== "WRITE"),
        `indexed ${type} cannot fabricate another protocol command`);
    }
  }
}
groups++;

// Exact coordinator examples: prose brackets must never clear the board or
// leak protocol coordinates into speech, including on actual resumed playback.
for (const [text, expected] of [
  ["[Type I error] = alpha", "[Type I error] = α"],
  ["In [Frame S'] v = 0.5c", "In [Frame S'] v = 0.5c"],
  ["[Clear] solution", "[Clear] solution"],
  ["[Arrow] points north", "[Arrow] points north"],
]) {
  const source = `[STEP]Explain the notation. [WRITE:${text},90,274][/STEP]`;
  for (const width of [1, 7, source.length]) {
    const actual = consume(source, width);
    assert(actual.hasInk);
    assert.deepEqual(row(actual.released), [{ text: expected, params: [90, 274, 32] }]);
    assert.deepEqual(actual.parsed.flatMap(getSegmentCommands).map(command => command.type), ["WRITE"]);
    assert.equal(actual.released[0]?.narration, "Explain the notation.");
  }
}
groups++;

// Newline, EOF and bracketed mathematics retain the existing format contract.
for (const ending of ["\n[/STEP]", "", "[/step]"]) {
  const source = `[STEP]The concentration is bracketed. [WRITE][Na^+],90,274${ending}`;
  const actual = consume(source, 1);
  assert(actual.hasInk);
  assert.equal(row(actual.released)[0]?.text, "[Na^+]");
  assert.deepEqual(row(actual.parsed), parseDrawingCommands(source).commands
    .filter((command) => command.type === "WRITE")
    .map((command) => ({ text: command.text, params: command.params })));
}
groups++;

const twoSteps = `${header}[STEP]Chloride ions lose electrons. [WRITE]2Cl^- -> Cl2 + 2e^-,90,340[/STEP]`;
const two = consume(twoSteps, 1);
assert(two.hasInk && two.released.length === 2, "each explicit footer releases its own teaching step");
assert.deepEqual(row(two.parsed).map((command) => command.text), [text, "2Cl^(-) -> Cl_2 + 2e^(-)"]);
groups++;

// Malformed rows never become ink, and never borrow coordinates from a later step.
for (const source of [
  "[STEP]Continue the explanation.[/STEP]",
  "[STEP]Look at the existing cathode. [FOCUS:cathode_bar][/STEP]",
  "[STEP]Only a header. [WRITE][/STEP]",
  "[STEP]Coordinates are incomplete. [WRITE]Na^+ + e^- -> Na,90,not-a-number[/STEP]",
  "[STEP]Missing a coordinate. [WRITE]Na^+ + e^- -> Na,90[/STEP]",
  "[STEP][WRITE]Na^+ + e^- -> Na,90,274[/STEP]",
]) {
  assert(!consume(source, 1).hasInk, "no speech/valid WRITE means genuine resume failure remains gated");
}
const malformedThenValid = `[STEP]Incomplete work. [WRITE]missing coordinates[/STEP]${header}`;
const recovered = consume(malformedThenValid, 1);
assert.deepEqual(row(recovered.released).map((command) => command.text), [text]);
assert.deepEqual(parseDrawingCommands(malformedThenValid).commands
  .filter((command) => command.type === "WRITE").map((command) => command.text), [text],
  "whole parsing cannot invent a row by swallowing a closing/opening STEP");
const crossTag = "[STEP]Incomplete work. [WRITE]missing [ARROW:90,142,1160,600] junk,90,274[/STEP]";
assert(!consume(crossTag, 1).hasInk, "a legacy text body cannot borrow coordinates across a drawing protocol tag");
for (const type of DRAW_COMMAND_TYPES) {
  for (const separator of [":", " :", ",", " ,"]) {
    const source = `[STEP]Incomplete work. [WRITE]missing [${type}${separator}90,142,1160,600] junk,90,274[/STEP]`;
    assert(!row(consume(source, 1).parsed).some(command => command.text?.startsWith("missing")),
      `incremental repair cannot swallow the recognized ${type} boundary into a work row`);
    assert(!parseDrawingCommands(source).commands.some(command => command.type === "WRITE" && command.text?.startsWith("missing")),
      `whole repair cannot swallow the recognized ${type} boundary into a work row`);
  }
}
const adjacentSteps = "[STEP]Incomplete. [WRITE]missing[/STEP][STEP]x,90,274[/STEP]";
assert(!row(consume(adjacentSteps, 1).parsed).length);
assert(!parseDrawingCommands(adjacentSteps).commands.some(command => command.type === "WRITE"),
  "a STEP footer after ordinary letters cannot lend the next step coordinates to a WRITE");
groups++;
console.log(`verify-resume-write-boundaries: ${groups} groups passed; actual markup/parser/ownership/resume queue; controlled continuation; providers0`);
