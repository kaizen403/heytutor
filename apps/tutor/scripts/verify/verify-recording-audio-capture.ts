import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { saveTurn } from "../../lib/boards/boardsClient";
import {
  recordingAudioCaptureComplete,
  recordingAudioPersistenceComplete,
} from "../../features/tutor-session/lib/turn/recordingAudioCapture";

const captured = { narration: "The first step", audioBytes: new Uint8Array([1, 2]) };
const silentCommand = { narration: "  ", audioBytes: null };

assert.equal(
  recordingAudioCaptureComplete([captured, { narration: "The next step", audioBytes: null }]),
  false,
  "a narrated segment without captured bytes cannot complete an automatic recording",
);
assert.equal(
  recordingAudioCaptureComplete([captured, { narration: "Another step", audioBytes: new Uint8Array() }]),
  false,
  "zero-length captured audio is also incomplete",
);
assert.equal(
  recordingAudioCaptureComplete([silentCommand, captured]),
  true,
  "silent board commands do not require their own audio",
);
assert.equal(
  recordingAudioCaptureComplete([silentCommand]),
  false,
  "an automatic recording with no captured narration cannot be complete",
);
assert.equal(recordingAudioPersistenceComplete(
  [{ orderIndex: 1, narration: "Captured sentence" }],
  [
    { orderIndex: 1, narration: "Captured sentence", audioUrl: "/audio/first.mp3" },
    { orderIndex: 2, narration: "Server-added sentence", audioUrl: null },
  ],
), false, "a server-generated narrated segment without audio cannot complete the recording");
// Keep the guard at the automatic-recording completion boundary, after the
// partial turn has been saved. Student turns (without onComplete) are untouched.
const handler = readFileSync(fileURLToPath(new URL(
  "../../features/tutor-session/hooks/turn/useQuestionHandler.ts", import.meta.url,
)), "utf8");
const completionStart = handler.indexOf("            if (onComplete) {");
const completionEnd = handler.indexOf("\n          }\n        }\n      } catch (error)", completionStart);
assert(completionStart > 0 && completionEnd > completionStart, "completion slice anchors (both must exist)");
const completion = handler.slice(completionStart, completionEnd);
assert(completion.includes("const saved = await completed;"), "partial board is saved before outcome");
assert.match(completion, /if \(saved\.ok\) \{\s*if \([\s\S]*?recordingAudioCaptureComplete\(recordedSegmentsRef\.current\)[\s\S]*?recordingAudioPersistenceComplete\(liveSave\.submittedRows\(\), saved\.turn\.segments\)[\s\S]*?emitError\(/,
  "only automatic recordings with captured and persisted audio may complete");
assert.match(completion, /emitError\(\{[\s\S]*?\}\);\s*\} else \{\s*onComplete\(\);\s*\}/,
  "missing audio must report failure without completing the job");
const liveSaveSource = readFileSync(fileURLToPath(new URL(
  "../../features/tutor-session/lib/turn/liveTurnSave.ts", import.meta.url,
)), "utf8");
assert.match(liveSaveSource, /if \(turn\.final\) this\.settleComplete\(turn, \{ ok: true, turn: result\.turn \}\);/,
  "completion must inspect the server's saved turn, not the local blob-URL replay copy");

async function verifySavedAudio(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const inputSegments = [
    { orderIndex: 0, ...silentCommand, spokenText: "", command: null, durationMs: 50, timings: null },
    { orderIndex: 1, ...captured, spokenText: captured.narration, command: null, durationMs: 500, timings: null },
    { orderIndex: 2, narration: "Next step", spokenText: "Next step", command: null,
      audioBytes: new Uint8Array([3, 4]), durationMs: 500, timings: null },
  ];
  let uploads = 0;
  let missingAudio = true;
  globalThis.fetch = async (_url, init) => {
    uploads++;
    assert.equal(init?.method, "POST");
    const form = init?.body;
    assert.ok(form instanceof FormData);
    assert.ok(form.get("audio-1") instanceof Blob);
    assert.ok(form.get("audio-2") instanceof Blob);
    assert.equal(form.get("audio-0"), null);
    return Response.json({ turn: {
      id: "saved-turn", segments: [
        { orderIndex: 0, narration: "  ", audioUrl: null },
        { orderIndex: 1, narration: captured.narration, audioUrl: "/audio/first.mp3" },
        { orderIndex: 2, narration: "Next step", audioUrl: missingAudio ? null : "/audio/next.mp3" },
      ],
    } });
  };
  try {
    const payload = { question: "Example", rawResponse: "Answer", speedMultiplier: 1, segments: inputSegments };
    const failedUpload = await saveTurn("board-1", payload);
    assert.ok(failedUpload, "the board is still saved on partial S3 upload failure");
    assert.equal(uploads, 1, "do not resubmit a persisted turn or re-upload audio");
    assert.equal(recordingAudioCaptureComplete(inputSegments), true);
    assert.equal(recordingAudioPersistenceComplete(inputSegments, failedUpload.segments), false,
      "a missing server audioUrl makes the auto recording incomplete");
    missingAudio = false;
    const successfulUpload = await saveTurn("board-1", payload);
    assert.ok(successfulUpload);
    assert.equal(uploads, 2);
    assert.equal(recordingAudioPersistenceComplete(inputSegments, successfulUpload.segments), true,
      "each narrated segment has a matching persisted URL");
    assert.equal(recordingAudioPersistenceComplete(inputSegments, successfulUpload.segments.slice(0, 2)), false,
      "an omitted narrated segment is not complete");
    assert.equal(recordingAudioPersistenceComplete(inputSegments, [
      successfulUpload.segments[0],
      successfulUpload.segments[1],
      { ...successfulUpload.segments[2], orderIndex: 3 },
    ]), false, "another segment's URL cannot stand in for a missing narrated segment");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void verifySavedAudio().then(() => {
  console.log("verify-recording-audio-capture: capture and persisted URLs required; partial upload keeps board without completion");
}).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
