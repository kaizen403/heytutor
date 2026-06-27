import type { RecordedSegmentPayload, StoredSegment, StoredTurn } from "@/lib/boardsClient";

export function createReplayAudioBlobUrl(bytes: Uint8Array): string {
  return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }));
}

export function enrichStoredSegmentsWithReplayAudio(
  segments: StoredSegment[],
  recorded: RecordedSegmentPayload[],
  registerBlobUrl: (url: string) => void,
): StoredSegment[] {
  return segments.map((segment) => {
    if (segment.audioUrl) {
      return segment;
    }

    const captured = recorded.find((entry) => entry.orderIndex === segment.orderIndex);
    if (!captured?.audioBytes?.length) {
      return segment;
    }

    const audioUrl = createReplayAudioBlobUrl(captured.audioBytes);
    registerBlobUrl(audioUrl);
    return { ...segment, audioUrl };
  });
}

export function buildLocalStoredTurn(
  payload: {
    question: string;
    rawResponse: string;
    speedMultiplier: number;
    segments: RecordedSegmentPayload[];
  },
  orderIndex: number,
  registerBlobUrl: (url: string) => void,
): StoredTurn {
  return {
    id: `local-${crypto.randomUUID()}`,
    orderIndex,
    question: payload.question,
    rawResponse: payload.rawResponse,
    speedMultiplier: payload.speedMultiplier,
    segments: payload.segments.map((segment) => {
      const audioUrl =
        segment.audioBytes && segment.audioBytes.length > 0
          ? createReplayAudioBlobUrl(segment.audioBytes)
          : null;
      if (audioUrl) {
        registerBlobUrl(audioUrl);
      }

      return {
        id: `local-seg-${segment.orderIndex}`,
        orderIndex: segment.orderIndex,
        narration: segment.narration,
        spokenText: segment.spokenText,
        command: segment.command,
        audioUrl,
        durationMs: segment.durationMs,
        timings: segment.timings,
      };
    }),
  };
}
