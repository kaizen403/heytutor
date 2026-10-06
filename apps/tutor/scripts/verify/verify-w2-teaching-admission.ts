import assert from "node:assert/strict";
import { createTeachingArithmeticAdmission } from "../../features/tutor-session/lib/turn/teachingArithmeticAdmission";
import type { TutorSegment } from "@heytutor/drawing";
const beat = (row: string, narration = row): TutorSegment => ({ narration, command: {
  type: "WRITE", text: row, params: [20,100], charPosition: 0, narrationBefore: narration,
} });
const gate = createTeachingArithmeticAdmission();
const speech: string[] = [], ink: string[] = [];
const queue = (segment: TutorSegment) => {
  if (!gate.offer(segment)) return;
  speech.push(segment.narration);
  ink.push(segment.command!.text!);
};
assert.equal(gate.startAttempt(), null);
queue(beat("2+3=5", "The sum is five."));
queue(beat("2.513^2=6.316", "The square is six point three one six."));
queue(beat("6.316/.8=7.896", "Use the false previous result."));
assert.deepEqual(ink, ["2+3=5"]);
assert.deepEqual(speech, ["The sum is five."]);
assert.equal(gate.admittedNarration(), "The sum is five.");
assert.equal(gate.blocked(), true);
assert.equal(gate.filtered(), true);
const proof = gate.startAttempt();
assert.ok(proof?.includes("6.315169") && proof.includes("6.315") && proof.includes("narration and WRITE together"));
queue(beat("2.513^2=6.315", "Rounded to three decimal places, six point three one five."));
assert.equal(gate.blocked(), false);
assert.equal(ink.length, 2);
// Ambiguous mixed-number notation cannot generate a false proof.
queue(beat(String.raw`2 \frac{1}{2}=2.5`, "Two and one half."));
assert.equal(gate.blocked(), false);
queue(beat(String.raw`2*\frac{1}{2}=1`, "Explicit multiplication gives one."));
assert.equal(ink.length, 4);
// An oversized entire beat is withheld, including its speech; there is no
// partially released row prefix from the failed admission call.
const oversized = beat("1+1=2", "This whole beat must wait.");
oversized.commands = Array.from({length:65}, () => oversized.command!);
queue(oversized);
assert.equal(gate.blocked(), true);
assert.equal(ink.length, 4);
assert.ok(gate.startAttempt()?.includes("budget"));
// Retried output may fail again; it never opens the queues by resetting the
// turn's accepted history or leaking a later segment from that attempt.
queue(beat("2.25+4-4.5-8+2.75=0", "The incorrect checksum is zero."));
queue(beat("1+1=2", "This later beat is also withheld."));
assert.equal(ink.length, 4);
assert.ok(gate.startAttempt()?.includes("-3.5"));
queue(beat("2.25+4-4.5-8+2.75=-3.5", "The checksum is minus three point five."));
assert.equal(ink.length, 5);
assert.ok(!gate.admittedNarration().includes("incorrect") && !gate.admittedNarration().includes("false previous"));
console.log("W2 teaching admission: paired speech/ink, tail block, retry, mixed notation and budget controls passed (offline queues)");
