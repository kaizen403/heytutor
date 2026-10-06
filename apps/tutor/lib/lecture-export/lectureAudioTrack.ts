import { replayAudioBytesForUrl } from "@/lib/replay/replayTurns";
import type { ReplayCue } from "@/lib/replay/replayTimeline";
import { dataUrlToBytes, lectureAudioFetchUrl } from "./lectureAudioUrl";

export const LECTURE_EXPORT_SAMPLE_RATE = 44_100;

export type PcmTrack = {
  channels: Float32Array[];
  sampleRate: number;
};

export function resolveLectureAudioUrl(cue: ReplayCue): string | null {
  const url = cue.audioUrl?.trim();
  return url ? url : null;
}

export function frameCountForDuration(durationMs: number, sampleRate: number): number {
  return Math.max(0, Math.round((sampleRate * Math.max(durationMs, 0)) / 1000));
}

export function silencePcm(
  durationMs: number,
  sampleRate: number,
  channelCount: number,
): Float32Array[] {
  const frames = frameCountForDuration(durationMs, sampleRate);
  const channels = Math.max(1, channelCount);
  return Array.from({ length: channels }, () => new Float32Array(frames));
}

export function fitPcmToDuration(
  channels: Float32Array[],
  sampleRate: number,
  durationMs: number,
): Float32Array[] {
  const targetFrames = frameCountForDuration(durationMs, sampleRate);
  if (channels.length === 0) {
    return silencePcm(durationMs, sampleRate, 1);
  }
  return channels.map((channel) => {
    const out = new Float32Array(targetFrames);
    const copy = Math.min(channel.length, targetFrames);
    if (copy > 0) {
      out.set(channel.subarray(0, copy));
    }
    return out;
  });
}

function resampleChannel(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || input.length === 0) {
    return input;
  }
  const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(outLen);
  const scale = fromRate / toRate;
  for (let i = 0; i < outLen; i++) {
    const src = i * scale;
    const index = Math.floor(src);
    const frac = src - index;
    const a = input[index] ?? 0;
    const b = input[index + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function resampleTrack(track: PcmTrack, toRate: number): PcmTrack {
  if (track.sampleRate === toRate) {
    return track;
  }
  return {
    sampleRate: toRate,
    channels: track.channels.map((channel) =>
      resampleChannel(channel, track.sampleRate, toRate),
    ),
  };
}

/**
 * Time-compress PCM so a 1× recording plays at `playbackRate` in any player.
 * Same pitch shift as HTML `playbackRate` — the file is shorter, not stretched.
 */
export function speedPcmTrack(track: PcmTrack, playbackRate: number): PcmTrack {
  const rate =
    Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  if (Math.abs(rate - 1) < 1e-9) {
    return track;
  }
  return {
    sampleRate: track.sampleRate,
    channels: track.channels.map((channel) =>
      resampleChannel(channel, track.sampleRate * rate, track.sampleRate),
    ),
  };
}

export function concatPcm(parts: Float32Array[][], channelCount: number): Float32Array[] {
  const channels = Math.max(1, channelCount);
  const total = parts.reduce((sum, part) => sum + (part[0]?.length ?? 0), 0);
  const out = Array.from({ length: channels }, () => new Float32Array(total));
  let offset = 0;
  for (const part of parts) {
    const length = part[0]?.length ?? 0;
    for (let channel = 0; channel < channels; channel++) {
      const source = part[channel] ?? part[0] ?? new Float32Array(length);
      if (source.length === length) {
        out[channel]!.set(source, offset);
      } else {
        out[channel]!.set(source.subarray(0, Math.min(source.length, length)), offset);
      }
    }
    offset += length;
  }
  return out;
}

export type CueAudioResult = {
  channels: Float32Array[];
  usedStoredAudio: boolean;
};

export function mixCueAudio(options: {
  durationMs: number;
  sampleRate: number;
  channelCount: number;
  decoded: PcmTrack | null;
}): CueAudioResult {
  const { durationMs, sampleRate, channelCount } = options;
  if (!options.decoded) {
    return {
      channels: silencePcm(durationMs, sampleRate, channelCount),
      usedStoredAudio: false,
    };
  }
  const aligned = resampleTrack(options.decoded, sampleRate);
  const padded = fitPcmToDuration(aligned.channels, sampleRate, durationMs);
  while (padded.length < channelCount) {
    padded.push(new Float32Array(padded[0]?.length ?? 0));
  }
  return {
    channels: padded.slice(0, channelCount),
    usedStoredAudio: true,
  };
}

/** A clip that has not arrived in this long becomes silence, not a stuck "Preparing". */
export const LECTURE_AUDIO_FETCH_TIMEOUT_MS = 15_000;
export const LECTURE_AUDIO_DECODE_TIMEOUT_MS = 10_000;

/** Resolves to null when `work` takes longer than `timeoutMs` or throws. */
export async function withLectureAudioTimeout<T>(
  work: Promise<T | null>,
  timeoutMs: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, timeoutMs));
  });
  try {
    return await Promise.race([work.catch(() => null), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function fetchLectureAudioBytes(url: string): Promise<Uint8Array | null> {
  // In-tab clips are blob: or data: URLs. fetch() of those is connect-src, and
  // a policy of 'self' turns every spoken cue into silence in the download.
  // Replay never hits that path — it plays the URL on an <audio> element.
  if (url.startsWith("blob:")) {
    const held = replayAudioBytesForUrl(url);
    if (held) return held;
  }
  if (url.startsWith("data:")) {
    return dataUrlToBytes(url);
  }
  try {
    const signal =
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(LECTURE_AUDIO_FETCH_TIMEOUT_MS)
        : undefined;
    const response = await fetch(lectureAudioFetchUrl(url), signal ? { signal } : undefined);
    if (!response.ok) {
      return null;
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export type BuiltLectureAudioTrack = {
  channels: Float32Array[];
  sampleRate: number;
  durationMs: number;
  missingAudioCues: number;
  /** Cues with narration. */
  spokenCues: number;
  /** Spoken cues whose recorded voice made it into the track. */
  voicedCues: number;
};

export async function buildLectureAudioTrack(options: {
  cues: ReplayCue[];
  sampleRate?: number;
  fetchBytes?: (url: string) => Promise<Uint8Array | null>;
  decodeBytes?: (data: ArrayBuffer) => Promise<PcmTrack | null>;
  /** In-memory clip for a cue (a live turn's audio), read before its URL. */
  cueBytes?: (cue: ReplayCue) => Uint8Array | null;
  fetchTimeoutMs?: number;
  decodeTimeoutMs?: number;
  /** Stop fetching once the export is cancelled; the rest becomes silence. */
  shouldCancel?: () => boolean;
}): Promise<BuiltLectureAudioTrack> {
  const sampleRate = options.sampleRate ?? LECTURE_EXPORT_SAMPLE_RATE;
  const fetchBytes = options.fetchBytes ?? fetchLectureAudioBytes;
  const decodeBytes = options.decodeBytes;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? LECTURE_AUDIO_FETCH_TIMEOUT_MS;
  const decodeTimeoutMs = options.decodeTimeoutMs ?? LECTURE_AUDIO_DECODE_TIMEOUT_MS;
  const parts: Float32Array[][] = [];
  let channelCount = 1;
  let missingAudioCues = 0;
  let spokenCues = 0;
  let voicedCues = 0;

  const decodedTracks: Array<PcmTrack | null> = [];
  for (const cue of options.cues) {
    const spoken = cue.narration.trim().length > 0;
    if (spoken) spokenCues += 1;
    const held = spoken ? options.cueBytes?.(cue) ?? null : null;
    const url = resolveLectureAudioUrl(cue);
    const hasSource = Boolean(held?.length) || Boolean(url);
    if (!spoken || !hasSource || !decodeBytes || options.shouldCancel?.()) {
      decodedTracks.push(null);
      if (spoken && (!hasSource || options.shouldCancel?.())) {
        missingAudioCues += 1;
      }
      continue;
    }
    const bytes = held?.length
      ? held
      : await withLectureAudioTimeout(fetchBytes(url!), fetchTimeoutMs);
    // Empty bytes make decodeAudioData reject; they are silence, not an error.
    const decoded = bytes && bytes.length > 0
      ? await withLectureAudioTimeout(decodeBytes(bytesToArrayBuffer(bytes)), decodeTimeoutMs)
      : null;
    if (!decoded) {
      decodedTracks.push(null);
      missingAudioCues += 1;
      continue;
    }
    voicedCues += 1;
    channelCount = Math.max(channelCount, decoded.channels.length);
    decodedTracks.push(decoded);
  }

  for (let index = 0; index < options.cues.length; index++) {
    const cue = options.cues[index]!;
    const mixed = mixCueAudio({
      durationMs: cue.durationMs,
      sampleRate,
      channelCount,
      decoded: decodedTracks[index] ?? null,
    });
    parts.push(mixed.channels);
  }

  const channels = concatPcm(parts, channelCount);
  const durationMs = options.cues.reduce((sum, cue) => sum + cue.durationMs, 0);
  return {
    channels,
    sampleRate,
    durationMs,
    missingAudioCues,
    spokenCues,
    voicedCues,
  };
}
