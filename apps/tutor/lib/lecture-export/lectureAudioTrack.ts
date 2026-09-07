import type { ReplayCue } from "@/lib/replay/replayTimeline";
import { lectureAudioFetchUrl } from "./lectureAudioUrl";

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

export function resampleChannel(
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

export function resampleTrack(track: PcmTrack, toRate: number): PcmTrack {
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

export async function fetchLectureAudioBytes(url: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(lectureAudioFetchUrl(url));
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

export async function decodeLectureAudioBytes(
  bytes: Uint8Array,
  decode: (data: ArrayBuffer) => Promise<PcmTrack>,
): Promise<PcmTrack | null> {
  try {
    return await decode(bytesToArrayBuffer(bytes));
  } catch {
    return null;
  }
}

export type BuiltLectureAudioTrack = {
  channels: Float32Array[];
  sampleRate: number;
  durationMs: number;
  missingAudioCues: number;
};

export async function buildLectureAudioTrack(options: {
  cues: ReplayCue[];
  sampleRate?: number;
  fetchBytes?: (url: string) => Promise<Uint8Array | null>;
  decodeBytes?: (data: ArrayBuffer) => Promise<PcmTrack | null>;
}): Promise<BuiltLectureAudioTrack> {
  const sampleRate = options.sampleRate ?? LECTURE_EXPORT_SAMPLE_RATE;
  const fetchBytes = options.fetchBytes ?? fetchLectureAudioBytes;
  const decodeBytes = options.decodeBytes;
  const parts: Float32Array[][] = [];
  let channelCount = 1;
  let missingAudioCues = 0;

  const decodedTracks: Array<PcmTrack | null> = [];
  for (const cue of options.cues) {
    const spoken = cue.narration.trim().length > 0;
    const url = resolveLectureAudioUrl(cue);
    if (!spoken || !url || !decodeBytes) {
      decodedTracks.push(null);
      if (spoken && !url) {
        missingAudioCues += 1;
      }
      continue;
    }
    const bytes = await fetchBytes(url);
    const decoded = bytes ? await decodeBytes(bytesToArrayBuffer(bytes)) : null;
    if (!decoded) {
      decodedTracks.push(null);
      missingAudioCues += 1;
      continue;
    }
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
  };
}
