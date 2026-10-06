import assert from "node:assert/strict";
import * as drawing from "@heytutor/drawing";
import * as core from "@heytutor/tutor-core";
import * as builtDrawing from "../../../../packages/drawing/dist/index.js";
import * as builtCore from "../../../../packages/tutor-core/dist/index.js";
import { createTeachingArithmeticAdmission } from "../../features/tutor-session/lib/turn/teachingArithmeticAdmission";

// Exercise the parser boundary, including built ESM, rather than offering
// hand-authored normalized commands to the arithmetic helper.
const cases = [
  [String.raw`2 \frac{1}{2}=2.5`, "unsupported"],
  [String.raw`-2\frac{1}{2}=-2.5`, "unsupported"],
  [String.raw`3\dfrac{1}{4}=3.25`, "unsupported"],
  [String.raw`2\tfrac{1}{2}=1`, "unsupported"],
  [String.raw`2 \frac{1}{2}=99`, "unsupported"],
  [String.raw`$2 \frac{1}{2}=2.5$`, "unsupported"],
  [String.raw`\(2\frac{1}{2}=2.5\)`, "unsupported"],
  [String.raw`2+\frac{1}{2}=2.5`, "correct"],
  [String.raw`2*\frac{1}{2}=1`, "correct"],
  [String.raw`2\times\frac{1}{2}=1`, "correct"],
  [String.raw`\frac{1}{2}\frac{3}{4}=0.375`, "correct"],
  ["2(3+4)=14", "correct"],
  ["2(3+4)=13", "false"],
  [String.raw`2+\frac{1}{2}=1`, "false"],
  [String.raw`2*\frac{1}{2}=2.5`, "false"],
] as const;

let checks = 0;
for (const [name, parser, arithmetic] of [
  ["source", drawing, core], ["built-esm", builtDrawing, builtCore],
] as const) {
  for (const [row, expected] of cases) {
    for (const suffix of [",80,150", ",80,150,24"]) {
      const parsed = parser.parseDrawCommandFromTag("WRITE", `${row}${suffix}`, 0, "Compute the row.");
      assert.equal(parsed.sourceText, row);
      assert.deepEqual(parsed.params, suffix.endsWith(",24") ? [80, 150, 24] : [80, 150]);
      const response = `[STEP]Compute the row.[WRITE:${row}${suffix}][/STEP]`;
      const streamed: drawing.TutorSegment[] = [];
      const incremental = new parser.IncrementalTagParser({
        preserveStepSpeech: true, onSegmentReady: segment => streamed.push(segment),
      });
      // Split every character, including commands, fraction groups and STEP.
      for (const character of response) incremental.push(character);
      incremental.flush();
      for (const [mode, segments] of [
        ["incremental", streamed], ["batch", parser.buildLessonSegments(response)],
      ] as const) {
        const commands = segments.flatMap(parser.getSegmentCommands).filter(c => c.type === "WRITE");
        assert.equal(commands.length, 1, `${name}/${mode}: complete WRITE`);
        const command = commands[0]!;
        assert.equal(command.sourceText, row, `${name}/${mode}: raw notation survives`);
        const verdict = arithmetic.checkTeachingArithmeticRow(command.sourceText!);
        assert.equal(verdict.verdict, expected, `${name}/${mode}: ${row}`);
        const admission = createTeachingArithmeticAdmission();
        assert.equal(admission.offer(segments.find(s => parser.getSegmentCommands(s).includes(command))!), expected !== "false");
        const retry = admission.startAttempt();
        assert.equal(retry === null, expected !== "false", `${name}/${mode}: ambiguous rows produce no repair proof`);
        if (row === String.raw`2 \frac{1}{2}=2.5`) assert.equal(command.text, "2 (1/2)=2.5");
        checks++;
      }
    }
  }
}

// A checked but downstream-discarded beat must not mutate turn history.
const admission = createTeachingArithmeticAdmission();
const beat = (row: string, narration: string): drawing.TutorSegment => ({
  narration, command: drawing.parseDrawCommandFromTag("WRITE", `${row},80,150`, 0, narration),
});
// Preserve existing board spelling checks without rewriting ambiguous frac.
for (const [row, expected] of [
  ["2 plus 3=4", false], ["2 plus 3=5", true],
  ["2 squared=5", false], ["2 squared=4", true],
  [String.raw`2 plus \frac{1}{2}=1`, false],
  [String.raw`2 plus \frac{1}{2}=2.5`, true],
] as const) {
  const spellingAdmission = createTeachingArithmeticAdmission();
  assert.equal(spellingAdmission.offer(beat(row, "Compute the row.")), expected, row);
}
const discarded = beat("2+3=5", "DISCARDED");
assert(admission.offer(discarded, { deferCommit: true }));
assert.equal(admission.admittedNarration(), "");
const released = beat("7+1=8", "RELEASED");
assert(admission.offer(released, { deferCommit: true }));
admission.commitReleased(released);
assert.equal(admission.admittedNarration(), "RELEASED");
assert(!admission.offer(beat("2(3+4)=13", "REJECTED"), { deferCommit: true }));
assert(admission.startAttempt()?.includes("= 14"));
assert.equal(admission.admittedNarration(), "RELEASED");
console.log(JSON.stringify({ parserControls: checks, spellingControls: 6, deferredCommit: "passed", offline: true }));
