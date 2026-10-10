import { parseStoredSegmentCommands } from "@heytutor/drawing";
import { speechAudioMimeType } from "@heytutor/tutor-core";
import type {
  RecordedSegmentPayload,
  SceneVisualStatus,
  StoredSegment,
  StoredTurn,
} from "@/lib/boards/boardsClient";

/**
 * Bytes behind each in-tab lecture clip. The download reads these directly:
 * `fetch` of a blob URL is blocked by connect-src, so the file was silence
 * even though replay could play the same clip.
 */
const replayAudioBytesByUrl = new Map<string, Uint8Array>();

export function createReplayAudioBlobUrl(bytes: Uint8Array): string {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy], { type: speechAudioMimeType(copy) }));
  replayAudioBytesByUrl.set(url, copy);
  return url;
}

export function replayAudioBytesForUrl(url: string): Uint8Array | null {
  return replayAudioBytesByUrl.get(url) ?? null;
}

export function releaseReplayAudioBytes(url: string): void {
  replayAudioBytesByUrl.delete(url);
}

export function enrichStoredSegmentsWithReplayAudio(
  segments: StoredSegment[],
  recorded: RecordedSegmentPayload[],
  registerBlobUrl: (url: string) => void,
): StoredSegment[] {
  return segments.map((segment) => {
    // Canonical figure insertion may shift every rendered row. A submitted
    // index is a recording identity; the canonical display index is not.
    const captured = segment.audioRef === undefined
      ? recorded.find((entry) => entry.orderIndex === segment.orderIndex &&
        entry.narration === segment.narration && entry.spokenText === segment.spokenText &&
        JSON.stringify(parseStoredSegmentCommands(entry.command)) === JSON.stringify(parseStoredSegmentCommands(segment.command)))
      : Number.isSafeInteger(segment.audioRef) && segment.audioRef !== null && segment.audioRef >= 0
        ? recorded.find((entry) => entry.orderIndex === segment.audioRef)
        : undefined;
    if (!captured?.audioBytes?.length) {
      return segment;
    }

    // Prefer the bytes captured in this tab. After saveTurn the API row may
    // already carry a public R2 URL, and that URL is not always fetchable
    // from the browser (missing CORS, r2.dev blocked). The blob is.
    const audioUrl = createReplayAudioBlobUrl(captured.audioBytes);
    registerBlobUrl(audioUrl);
    return { ...segment, audioUrl };
  });
}

export function buildLocalStoredTurn(
  payload: {
    turnId?: string;
    question: string;
    rawResponse: string;
    speedMultiplier: number;
    traceId?: string | null;
    sceneDocument?: unknown | null;
    sceneEngineVersion?: string | null;
    validationReport?: unknown | null;
    visualStatus?: SceneVisualStatus | null;
    sceneArtifacts?: unknown | null;
    segments: RecordedSegmentPayload[];
  },
  orderIndex: number,
  registerBlobUrl: (url: string) => void,
): StoredTurn {
  const turnId = payload.turnId ?? `local-${crypto.randomUUID()}`;
  return {
    id: turnId,
    orderIndex,
    question: payload.question,
    rawResponse: payload.rawResponse,
    speedMultiplier: payload.speedMultiplier,
    traceId: payload.traceId ?? null,
    sceneDocument: payload.sceneDocument ?? null,
    sceneEngineVersion: payload.sceneEngineVersion ?? null,
    validationReport: payload.validationReport ?? null,
    visualStatus: payload.visualStatus ?? null,
    sceneArtifacts: payload.sceneArtifacts ?? null,
    segments: payload.segments.map((segment) => {
      const audioUrl =
        segment.audioBytes && segment.audioBytes.length > 0
          ? createReplayAudioBlobUrl(segment.audioBytes)
          : null;
      if (audioUrl) {
        registerBlobUrl(audioUrl);
      }

      return {
        id: `${turnId}:seg:${segment.orderIndex}`,
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
