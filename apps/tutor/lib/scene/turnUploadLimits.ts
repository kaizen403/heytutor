import { MAX_TURN_BODY_BYTES } from "@/lib/http/resourceLimits";

export const MAX_TURN_UPLOAD_BYTES = MAX_TURN_BODY_BYTES;
const MAX_TURN_METADATA_BYTES = 256 * 1024;
export const MAX_TURN_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_TURN_TOTAL_AUDIO_BYTES = 32 * 1024 * 1024;
export const MAX_TURN_SEGMENTS = 256;

export type TurnUploadValidation =
  | { ok: true }
  | { ok: false; status: 400 | 411 | 413 | 415; error: string };

/**
 * Whether an audio part's first bytes match its declared type. Compare bytes,
 * never decoded text: a WAV's size field sits between "RIFF" and "WAVE", and
 * when those four bytes happen to be valid UTF-8 a decoder folds them into
 * fewer characters, so "WAVE" moves and a valid sentence (about one in twenty)
 * was refused, taking the whole lesson's save down with it.
 */
export function audioPrefixMatchesType(type: string, prefix: Uint8Array): boolean {
  const ascii = (at: number, tag: string) => [...tag].every((char, i) => prefix[at + i] === char.charCodeAt(0));
  if (type === "audio/wav") return prefix.length >= 12 && ascii(0, "RIFF") && ascii(8, "WAVE");
  if (type === "audio/mpeg") {
    return ascii(0, "ID3") || (prefix[0] === 0xff && ((prefix[1] ?? 0) & 0xe0) === 0xe0 && ((prefix[1] ?? 0) & 0x06) !== 0);
  }
  return false;
}

export function validateTurnUploadHeaders(headers: Headers): TurnUploadValidation {
  const contentType = headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !/\bboundary=/i.test(contentType)) {
    return { ok: false, status: 415, error: "multipart/form-data with a boundary is required" };
  }

  if (/\bchunked\b/i.test(headers.get("transfer-encoding") ?? "")) {
    return { ok: false, status: 411, error: "chunked turn uploads are not accepted" };
  }

  const rawLength = headers.get("content-length") ?? "";
  // The route stream-counts undeclared bodies before multipart parsing too.
  if (rawLength && !/^[1-9]\d*$/.test(rawLength)) {
    return { ok: false, status: 411, error: "content-length is invalid" };
  }
  if (rawLength) {
    const contentLength = Number(rawLength);
    if (!Number.isSafeInteger(contentLength) || contentLength > MAX_TURN_UPLOAD_BYTES) {
      return { ok: false, status: 413, error: "turn upload exceeds the request size limit" };
    }
  }

  return { ok: true };
}

export function validateTurnUploadParts(
  formData: FormData,
  metadataRaw: string,
  segments: Array<{ orderIndex?: unknown }>,
): TurnUploadValidation {
  if (new TextEncoder().encode(metadataRaw).byteLength > MAX_TURN_METADATA_BYTES) {
    return { ok: false, status: 413, error: "turn metadata exceeds the size limit" };
  }
  if (!Array.isArray(segments)) {
    return { ok: false, status: 400, error: "segments must be an array" };
  }
  if (segments.length > MAX_TURN_SEGMENTS) {
    return { ok: false, status: 413, error: "turn has too many segments" };
  }

  const orderIndexes = new Set<number>();
  for (const segment of segments) {
    if (!Number.isInteger(segment?.orderIndex) || (segment.orderIndex as number) < 0) {
      return { ok: false, status: 400, error: "segment order indexes must be non-negative integers" };
    }
    orderIndexes.add(segment.orderIndex as number);
  }
  if (orderIndexes.size !== segments.length) {
    return { ok: false, status: 400, error: "segment order indexes must be unique" };
  }

  let metadataParts = 0;
  let totalAudioBytes = 0;
  const audioIndexes = new Set<number>();
  for (const [name, value] of formData.entries()) {
    if (name === "metadata") {
      metadataParts += 1;
      if (typeof value !== "string") {
        return { ok: false, status: 400, error: "metadata must be a text field" };
      }
      continue;
    }

    const match = /^audio-(0|[1-9]\d*)$/.exec(name);
    if (!match || !(value instanceof File)) {
      return { ok: false, status: 400, error: `unexpected multipart field ${name}` };
    }
    const orderIndex = Number(match[1]);
    if (!orderIndexes.has(orderIndex) || audioIndexes.has(orderIndex)) {
      return { ok: false, status: 400, error: `audio part ${name} has no unique matching segment` };
    }
    if (value.type !== "audio/mpeg" && value.type !== "audio/wav") {
      return { ok: false, status: 415, error: `audio part ${name} must be audio/mpeg or audio/wav` };
    }
    if (value.size > MAX_TURN_AUDIO_BYTES) {
      return { ok: false, status: 413, error: `audio part ${name} exceeds the size limit` };
    }
    totalAudioBytes += value.size;
    if (totalAudioBytes > MAX_TURN_TOTAL_AUDIO_BYTES) {
      return { ok: false, status: 413, error: "turn audio exceeds the total size limit" };
    }
    audioIndexes.add(orderIndex);
  }

  if (metadataParts !== 1) {
    return { ok: false, status: 400, error: "exactly one metadata field is required" };
  }
  return { ok: true };
}

/** A checkpoint carries the scene, new rows and a bounded resume state. */
export const MAX_CHECKPOINT_METADATA_BYTES = 384 * 1024;
/** Merged (stored plus appended) turn metadata keeps today's one-shot limit. */
export const MAX_TURN_MERGED_METADATA_BYTES = MAX_TURN_METADATA_BYTES;
export const MAX_TURN_AUDIO_TOTAL_BYTES = MAX_TURN_TOTAL_AUDIO_BYTES;

/**
 * Shape checks for one checkpoint request: exactly one metadata text field and
 * `audio-{i}` files of an allowed type and size. Which indexes may carry audio
 * depends on the stored turn, so the handler checks that after loading it.
 */
export function validateCheckpointUploadParts(
  formData: FormData,
  metadataRaw: string,
): TurnUploadValidation & { audioIndexes?: number[] } {
  if (new TextEncoder().encode(metadataRaw).byteLength > MAX_CHECKPOINT_METADATA_BYTES) {
    return { ok: false, status: 413, error: "checkpoint metadata exceeds the size limit" };
  }
  let metadataParts = 0;
  let totalAudioBytes = 0;
  const audioIndexes: number[] = [];
  for (const [name, value] of formData.entries()) {
    if (name === "metadata") {
      metadataParts += 1;
      if (typeof value !== "string") {
        return { ok: false, status: 400, error: "metadata must be a text field" };
      }
      continue;
    }
    const match = /^audio-(0|[1-9]\d{0,5})$/.exec(name);
    if (!match || !(value instanceof File)) {
      return { ok: false, status: 400, error: `unexpected multipart field ${name}` };
    }
    const index = Number(match[1]);
    if (audioIndexes.includes(index)) {
      return { ok: false, status: 400, error: `audio part ${name} is repeated` };
    }
    if (value.type !== "audio/mpeg" && value.type !== "audio/wav") {
      return { ok: false, status: 415, error: `audio part ${name} must be audio/mpeg or audio/wav` };
    }
    if (value.size > MAX_TURN_AUDIO_BYTES) {
      return { ok: false, status: 413, error: `audio part ${name} exceeds the size limit` };
    }
    totalAudioBytes += value.size;
    if (totalAudioBytes > MAX_TURN_TOTAL_AUDIO_BYTES) {
      return { ok: false, status: 413, error: "turn audio exceeds the total size limit" };
    }
    audioIndexes.push(index);
  }
  if (metadataParts !== 1) {
    return { ok: false, status: 400, error: "exactly one metadata field is required" };
  }
  return { ok: true, audioIndexes };
}
