import assert from "node:assert/strict";
import { IncrementalTagParser } from "../src/protocol/incrementalParser";
import type { TutorSegment } from "../src/protocol/drawingProtocol";

const text = "[STEP]the block [FOCUS:block] sits on the incline [FOCUS:incline], a tilted surface. [WRITE:block on incline,90,145][/STEP]";
for (const chunkSize of [1, 7, text.length]) {
  const segments: TutorSegment[] = [];
  const parser = new IncrementalTagParser({ preserveStepSpeech: true, onSegmentReady: (segment) => segments.push(segment) });
  for (let i = 0; i < text.length; i += chunkSize) parser.push(text.slice(i, i + chunkSize));
  parser.flush();
  assert.equal(segments.length, 1, "inline focus must not split 'the block' into a separate voice clip");
  assert.equal(segments[0]?.narration, "the block sits on the incline, a tilted surface.");
  assert.deepEqual(segments[0]?.commands?.map((command) => command.type), ["FOCUS", "FOCUS", "WRITE"]);
}
const segments: TutorSegment[] = [];
const parser = new IncrementalTagParser({ preserveStepSpeech: true, onSegmentReady: (segment) => segments.push(segment) });
parser.push("[STEP]a force [FOCUS:force] points down.");
parser.flush();
assert.equal(segments.length, 1, "a truncated step must still flush");
assert.equal(segments[0]?.narration, "a force points down.");
const legacy: TutorSegment[] = [];
new IncrementalTagParser({ onSegmentReady: (segment) => legacy.push(segment) }).push(text);
assert(legacy.length > 1, "the opt-in must preserve existing code conductor segmentation");
const distinct: TutorSegment[] = [];
const stepParser = new IncrementalTagParser({ preserveStepSpeech: true, onSegmentReady: (segment) => distinct.push(segment) });
stepParser.push(text + "[STEP]The normal is N. [WRITE]N = mg cos θ,90,211\n[EMPHASIZE:last][/STEP]");
stepParser.flush();
assert.equal(distinct.length, 2, "adjacent steps must remain distinct speech clips");
assert.deepEqual(distinct[1]?.commands?.map((command) => command.type), ["WRITE", "EMPHASIZE"]);
console.log("verified complete-step speech and inline focus across stream chunk boundaries");
