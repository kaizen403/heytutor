import type { StoredTurn } from "@/lib/boards/boardsClient";
import {
  concatPcm,
  fetchLectureAudioBytes,
  mixCueAudio,
  resolveLectureAudioUrl,
  type PcmTrack,
} from "@/lib/lecture-export/lectureAudioTrack";
import type { ReplayCue } from "./replayTimeline";

export const LECTURE_PLAYER_SAMPLE_RATE = 24_000;

export type LecturePlayerTrack = {
  url: string;
  durationMs: number;
  missingAudioCues: number;
};

const TRACK_CACHE_LIMIT = 3;

type TrackCacheEntry = {
  key: string;
  promise: Promise<LecturePlayerTrack>;
};

const trackCache: TrackCacheEntry[] = [];

export function lecturePlayerTrackKey(turns: StoredTurn[]): string {
  return JSON.stringify(
    turns.map((turn) => [
      turn.id,
      turn.segments.map((segment) => [
        segment.id,
        segment.orderIndex,
        segment.durationMs,
        segment.audioUrl,
      ]),
    ]),
  );
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) {
    return new Float32Array(0);
  }
  if (channels.length === 1) {
    return channels[0]!;
  }
  const length = channels.reduce((max, channel) => Math.max(max, channel.length), 0);
  const out = new Float32Array(length);
  const count = channels.length;
  for (let index = 0; index < length; index++) {
    let sum = 0;
    for (const channel of channels) {
      sum += channel[index] ?? 0;
    }
    out[index] = sum / count;
  }
  return out;
}

function floatToPcm16(sample: number): number {
  const x = Math.max(-1, Math.min(1, sample));
  if (x >= 0) {
    return Math.round(x * 0x7fff);
  }
  return Math.round(x * 0x8000);
}

export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataSize = samples.length * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) {
      bytes[offset + index] = text.charCodeAt(index);
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);
  for (let index = 0; index < samples.length; index++) {
    view.setInt16(44 + index * 2, floatToPcm16(samples[index]!), true);
  }
  return bytes;
}

export async function decodeLectureAudioInBrowser(
  data: ArrayBuffer,
): Promise<PcmTrack | null> {
  if (typeof OfflineAudioContext === "undefined") {
    return null;
  }
  try {
    const context = new OfflineAudioContext(1, 1, LECTURE_PLAYER_SAMPLE_RATE);
    const buffer = await context.decodeAudioData(data);
    const channels: Float32Array[] = [];
    for (let index = 0; index < buffer.numberOfChannels; index++) {
      channels.push(buffer.getChannelData(index).slice());
    }
    return { channels, sampleRate: buffer.sampleRate };
  } catch {
    return null;
  }
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function lectureTrackCancelled(): DOMException {
  return new DOMException("Lecture track cancelled", "AbortError");
}

function revokeTrackUrl(url: string): void {
  URL.revokeObjectURL(url);
}

function scheduleRevoke(promise: Promise<LecturePlayerTrack>): void {
  void promise.then(
    (track) => {
      revokeTrackUrl(track.url);
    },
    () => undefined,
  );
}

export async function buildLecturePlayerTrack(options: {
  cues: ReplayCue[];
  decodeBytes?: (data: ArrayBuffer) => Promise<PcmTrack | null>;
  fetchBytes?: (url: string) => Promise<Uint8Array | null>;
  sampleRate?: number;
  concurrency?: number;
  onProgress?: (loadedMs: number, totalMs: number) => void;
  shouldCancel?: () => boolean;
  createObjectUrl?: (blob: Blob) => string;
}): Promise<LecturePlayerTrack> {
  const cues = options.cues;
  const decodeBytes = options.decodeBytes ?? decodeLectureAudioInBrowser;
  const fetchBytes = options.fetchBytes ?? fetchLectureAudioBytes;
  const sampleRate = options.sampleRate ?? LECTURE_PLAYER_SAMPLE_RATE;
  const concurrency = options.concurrency ?? 4;
  const createObjectUrl = options.createObjectUrl ?? URL.createObjectURL.bind(URL);
  const shouldCancel = options.shouldCancel;
  const onProgress = options.onProgress;

  const durationMs = cues.reduce((sum, cue) => sum + cue.durationMs, 0);
  const decodedTracks: Array<PcmTrack | null> = new Array(cues.length);
  const resolved = new Uint8Array(cues.length);
  let prefix = 0;
  let missingAudioCues = 0;
  let fail: unknown = null;

  const ensureNotCancelled = () => {
    if (fail) {
      throw fail;
    }
    if (shouldCancel?.()) {
      fail = lectureTrackCancelled();
      throw fail;
    }
  };

  const markResolved = (index: number) => {
    if (resolved[index]) {
      return;
    }
    resolved[index] = 1;
    const previous = prefix;
    while (prefix < cues.length && resolved[prefix]) {
      prefix += 1;
    }
    if (prefix !== previous) {
      onProgress?.(cues[prefix - 1]!.endMs, durationMs);
    }
  };

  const loadCue = async (index: number): Promise<PcmTrack | null> => {
    const cue = cues[index]!;
    const spoken = cue.narration.trim().length > 0;
    const url = resolveLectureAudioUrl(cue);
    if (!spoken || !url) {
      if (spoken && !url) {
        missingAudioCues += 1;
      }
      markResolved(index);
      return null;
    }
    ensureNotCancelled();
    const bytes = await fetchBytes(url);
    ensureNotCancelled();
    const decoded = bytes ? await decodeBytes(bytesToArrayBuffer(bytes)) : null;
    ensureNotCancelled();
    if (!decoded) {
      missingAudioCues += 1;
    }
    markResolved(index);
    return decoded;
  };

  const workerCount = Math.min(Math.max(1, concurrency), cues.length);
  if (workerCount > 0) {
    let nextIndex = 0;
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (true) {
          if (fail) {
            return;
          }
          const index = nextIndex;
          nextIndex += 1;
          if (index >= cues.length) {
            return;
          }
          try {
            decodedTracks[index] = await loadCue(index);
          } catch (error) {
            if (fail === null) {
              fail = error;
            }
            return;
          }
        }
      }),
    );
  }
  if (fail) {
    throw fail;
  }

  const parts: Float32Array[][] = [];
  for (let index = 0; index < cues.length; index++) {
    const cue = cues[index]!;
    const decoded = decodedTracks[index] ?? null;
    const mixed = mixCueAudio({
      durationMs: cue.durationMs,
      sampleRate,
      channelCount: Math.max(1, decoded?.channels.length ?? 1),
      decoded,
    });
    parts.push([mixToMono(mixed.channels)]);
  }

  const samples = concatPcm(parts, 1)[0] ?? new Float32Array(0);
  const bytes = encodeWavPcm16(samples, sampleRate);
  const blob = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
  const url = createObjectUrl(blob);
  onProgress?.(durationMs, durationMs);
  return {
    url,
    durationMs,
    missingAudioCues,
  };
}

export function getLecturePlayerTrack(
  key: string,
  build: () => Promise<LecturePlayerTrack>,
): Promise<LecturePlayerTrack> {
  const hit = trackCache.findIndex((entry) => entry.key === key);
  if (hit >= 0) {
    const [entry] = trackCache.splice(hit, 1);
    trackCache.push(entry!);
    return entry!.promise;
  }

  const promise = Promise.resolve().then(build);
  const entry: TrackCacheEntry = { key, promise };
  trackCache.push(entry);
  void promise.then(
    () => undefined,
    () => {
      const index = trackCache.indexOf(entry);
      if (index >= 0) {
        trackCache.splice(index, 1);
      }
    },
  );
  if (trackCache.length > TRACK_CACHE_LIMIT) {
    const evicted = trackCache.shift();
    if (evicted) {
      scheduleRevoke(evicted.promise);
    }
  }
  return promise;
}

export function clearLecturePlayerTrackCache(): void {
  const entries = trackCache.splice(0, trackCache.length);
  for (const entry of entries) {
    scheduleRevoke(entry.promise);
  }
}
