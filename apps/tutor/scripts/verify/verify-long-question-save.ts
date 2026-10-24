/**
 * Production 21 and 22 Oct: two lessons asked with long pasted Hindi
 * questions taught for about a minute and were saved with no rows (95325d87,
 * c5c5a9ad). Every checkpoint was refused as turn_fields_invalid because the
 * lesson's preview is its question and the server refused a preview over
 * 2,000 characters, though it stores 60. The keepalive close then created the
 * turn and, over its 12 KB budget, dropped the taught rows before the question.
 *
 * The question text here is synthetic.
 */
import assert from "node:assert/strict";
import {
  buildTurnCloseBody,
  checkpointMetadata,
  KEEPALIVE_CLOSE_MAX_BYTES,
  type RecordedSegmentPayload,
  type TurnCheckpointInput,
} from "../../lib/boards/boardsClient";
import { parseCommon } from "../../lib/boards/turnCheckpoint";

const longQuestion = "व्याकरण के नियम समझाइए और हर नियम का उदाहरण दीजिए। ".repeat(120);
assert(longQuestion.length > 5_000 && longQuestion.length < 12_000, "fixture question is long but under the server cap");
const narration = "यह वाक्य पाठ का एक हिस्सा है और बोर्ड पर लिखा जाता है।";
const rows: RecordedSegmentPayload[] = Array.from({ length: 20 }, (_, index) => ({
  narration: `${narration} ${index}`,
  spokenText: `${narration} ${index}`,
  command: null,
  audioBytes: null,
}) as unknown as RecordedSegmentPayload);

// 1. The checkpoint the client sends for a long question is accepted.
const input = {
  seq: 1,
  status: "live",
  kind: "lesson",
  baseCount: 0,
  question: longQuestion,
  preview: longQuestion,
  rawResponse: rows.map((row) => row.narration).join(" "),
  traceId: "trace-long-question",
  scene: { visualStatus: "text_only" },
  segments: rows,
} as unknown as TurnCheckpointInput;
const metadata = checkpointMetadata(input);
assert.equal(metadata.question, longQuestion, "the question is kept whole under the server cap");
assert((metadata.preview as string).length <= 200, "the preview is cut to what the server stores");
const parsed = parseCommon(JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>, "put");
assert(parsed.ok, `a long question checkpoint must be accepted: ${parsed.ok ? "" : parsed.error}`);
assert.equal(parsed.value.appendSegments.length, rows.length, "every taught row is accepted");

// 2. The server cuts an oversized preview from an older client instead of refusing the rows.
const legacy = parseCommon({ ...JSON.parse(JSON.stringify(metadata)), preview: longQuestion } as Record<string, unknown>, "put");
assert(legacy.ok, `an oversized preview must not refuse the checkpoint: ${legacy.ok ? "" : legacy.error}`);
assert((legacy.value.preview ?? "").length <= 2_000, "the oversized preview is cut");
assert.equal(legacy.value.appendSegments.length, rows.length, "the older client's rows are kept");

// 3. A close that creates the turn keeps the taught rows before the long question.
const close = JSON.parse(buildTurnCloseBody({
  seq: 2,
  status: "stopped",
  baseCount: 0,
  segments: rows,
  rawResponse: rows.map((row) => row.narration).join(" "),
  question: longQuestion,
  preview: longQuestion,
  kind: "lesson",
  sceneArtifacts: { turnPlan: { question: longQuestion.slice(0, 2_000) } },
  resumeState: { schemaVersion: "test" },
})) as Record<string, unknown>;
assert(new TextEncoder().encode(JSON.stringify(close)).byteLength <= KEEPALIVE_CLOSE_MAX_BYTES, "the close fits its budget");
assert(Array.isArray(close.appendSegments) && close.appendSegments.length === rows.length, "the close keeps every taught row");
assert(typeof close.question === "string" && close.question.length > 0, "the close still names the question");
const closeParsed = parseCommon(close, "patch");
assert(closeParsed.ok, `the close body is accepted: ${closeParsed.ok ? "" : closeParsed.error}`);

console.log("long question save: checkpoint accepted, oversized preview cut, close keeps every taught row");
