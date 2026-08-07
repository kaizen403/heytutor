export const MAX_TURN_UPLOAD_BYTES = 32 * 1024 * 1024;
export const MAX_TURN_METADATA_BYTES = 256 * 1024;
export const MAX_TURN_AUDIO_BYTES = 8 * 1024 * 1024;
export const MAX_TURN_TOTAL_AUDIO_BYTES = 24 * 1024 * 1024;
export const MAX_TURN_SEGMENTS = 128;

export type TurnUploadValidation =
  | { ok: true }
  | { ok: false; status: 400 | 411 | 413 | 415; error: string };

export function validateTurnUploadHeaders(headers: Headers): TurnUploadValidation {
  const contentType = headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !/\bboundary=/i.test(contentType)) {
    return { ok: false, status: 415, error: "multipart/form-data with a boundary is required" };
  }

  if (/\bchunked\b/i.test(headers.get("transfer-encoding") ?? "")) {
    return { ok: false, status: 411, error: "chunked turn uploads are not accepted" };
  }

  const rawLength = headers.get("content-length") ?? "";
  if (!/^[1-9]\d*$/.test(rawLength)) {
    return { ok: false, status: 411, error: "content-length is required for turn uploads" };
  }
  const contentLength = Number(rawLength);
  if (!Number.isSafeInteger(contentLength) || contentLength > MAX_TURN_UPLOAD_BYTES) {
    return { ok: false, status: 413, error: "turn upload exceeds the request size limit" };
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
    if (value.type !== "audio/mpeg") {
      return { ok: false, status: 415, error: `audio part ${name} must be audio/mpeg` };
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
