import {
  MAX_TURN_AUDIO_BYTES,
  MAX_TURN_SEGMENTS,
  MAX_TURN_UPLOAD_BYTES,
  validateTurnUploadHeaders,
  validateTurnUploadParts,
} from "../lib/turnUploadLimits";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const validHeaders = new Headers({
  "content-type": "multipart/form-data; boundary=verify",
  "content-length": "1024",
});
assert(validateTurnUploadHeaders(validHeaders).ok, "bounded multipart requests should pass preflight");

const missingLength = validateTurnUploadHeaders(new Headers({
  "content-type": "multipart/form-data; boundary=verify",
}));
assert(!missingLength.ok && missingLength.status === 411, "streamed uploads without a length must be rejected before buffering");

const oversized = validateTurnUploadHeaders(new Headers({
  "content-type": "multipart/form-data; boundary=verify",
  "content-length": String(MAX_TURN_UPLOAD_BYTES + 1),
}));
assert(!oversized.ok && oversized.status === 413, "oversized requests must be rejected before formData buffering");

const tooManySegments = validateTurnUploadParts(
  new FormData(),
  "{}",
  Array.from({ length: MAX_TURN_SEGMENTS + 1 }, (_, orderIndex) => ({ orderIndex })),
);
assert(!tooManySegments.ok && tooManySegments.status === 413, "segment count must be capped");

const largeAudio = new FormData();
largeAudio.append("metadata", "{}");
largeAudio.append(
  "audio-0",
  new File([new Uint8Array(MAX_TURN_AUDIO_BYTES + 1)], "large.mp3", { type: "audio/mpeg" }),
);
const oversizedAudio = validateTurnUploadParts(largeAudio, "{}", [{ orderIndex: 0 }]);
assert(!oversizedAudio.ok && oversizedAudio.status === 413, "individual audio parts must be capped");

const unknownPart = new FormData();
unknownPart.append("metadata", "{}");
unknownPart.append("surprise", "payload");
const unknownPartResult = validateTurnUploadParts(unknownPart, "{}", []);
assert(!unknownPartResult.ok && unknownPartResult.status === 400, "unknown multipart fields must be rejected");

const validParts = new FormData();
validParts.append("metadata", "{}");
validParts.append("audio-0", new File([new Uint8Array(32)], "audio.mp3", { type: "audio/mpeg" }));
assert(
  validateTurnUploadParts(validParts, "{}", [{ orderIndex: 0 }]).ok,
  "bounded audio for a declared segment should pass",
);

console.log("turn upload limit verification passed");
