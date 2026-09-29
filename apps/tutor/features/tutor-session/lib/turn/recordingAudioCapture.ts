import type { RecordedSegmentPayload, StoredSegment } from "@/lib/boards/boardsClient";

/** Whether an automatic recording can be replayed with its complete narration. */
export function recordingAudioCaptureComplete(
  segments: readonly Pick<RecordedSegmentPayload, "narration" | "audioBytes">[],
): boolean {
  const narrated = segments.filter((segment) => segment.narration.trim().length > 0);
  return narrated.length > 0 && narrated.every((segment) => (segment.audioBytes?.length ?? 0) > 0);
}

/** Inspect the server's raw save response, not replay segments with local blob URLs. */
export function recordingAudioPersistenceComplete(
  submitted: readonly Pick<RecordedSegmentPayload, "orderIndex" | "narration">[],
  persisted: readonly Pick<StoredSegment, "orderIndex" | "narration" | "audioUrl">[],
): boolean {
  const narrated = submitted.filter((segment) => segment.narration.trim().length > 0);
  return narrated.length > 0 && narrated.every((segment) =>
    persisted.some((saved) =>
      saved.orderIndex === segment.orderIndex &&
      typeof saved.audioUrl === "string" && saved.audioUrl.trim().length > 0,
    ),
  ) && persisted.every((saved) =>
    !saved.narration.trim() || (typeof saved.audioUrl === "string" && saved.audioUrl.trim().length > 0),
  );
}
