/**
 * Streaming TTS stutters when the first MP3 slice starts immediately and the
 * next decode arrives after that slice has already finished. Hold a short
 * preroll, then schedule from a single concatenated buffer whenever we can.
 */

export const TTS_PREROLL_SEC = 0.4;
export const TTS_CHUNK_LOOKAHEAD_SEC = 0.02;

export interface DurationLike {
  duration: number;
}

export function decodedDurationSec(buffers: DurationLike[]): number {
  return buffers.reduce((sum, buffer) => sum + Math.max(buffer.duration, 0), 0);
}

export function shouldHoldForPreroll(options: {
  bufferedSec: number;
  streamComplete: boolean;
  prerollSec?: number;
}): boolean {
  if (options.streamComplete) {
    return false;
  }
  return options.bufferedSec < (options.prerollSec ?? TTS_PREROLL_SEC);
}

export function nextScheduleStartSec(options: {
  currentTime: number;
  scheduledEnd: number;
  lookaheadSec?: number;
}): number {
  const lookaheadSec = options.lookaheadSec ?? TTS_CHUNK_LOOKAHEAD_SEC;
  return Math.max(options.currentTime + lookaheadSec, options.scheduledEnd);
}

export function scheduleGapSec(options: {
  currentTime: number;
  scheduledEnd: number;
  lookaheadSec?: number;
}): number {
  return Math.max(0, nextScheduleStartSec(options) - options.scheduledEnd);
}

export interface ConcatableAudioBuffer {
  duration: number;
  length: number;
  sampleRate: number;
  numberOfChannels: number;
  getChannelData: (channel: number) => Float32Array;
}

export function canConcatAudioBuffers(buffers: ConcatableAudioBuffer[]): boolean {
  if (buffers.length <= 1) {
    return true;
  }
  const sampleRate = buffers[0]?.sampleRate;
  return (
    typeof sampleRate === "number" &&
    sampleRate > 0 &&
    buffers.every((buffer) => buffer.sampleRate === sampleRate && buffer.length > 0)
  );
}

export function concatDecodedAudioBuffers(
  ctx: Pick<AudioContext, "createBuffer">,
  buffers: ConcatableAudioBuffer[],
): AudioBuffer {
  if (buffers.length === 0) {
    throw new Error("no audio buffers to concat");
  }
  if (buffers.length === 1) {
    return buffers[0] as AudioBuffer;
  }
  if (!canConcatAudioBuffers(buffers)) {
    throw new Error("audio buffers cannot be concatenated");
  }

  const sampleRate = buffers[0].sampleRate;
  const channels = Math.max(...buffers.map((buffer) => buffer.numberOfChannels));
  const length = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
  const out = ctx.createBuffer(channels, length, sampleRate);
  let offset = 0;

  for (const buffer of buffers) {
    for (let channel = 0; channel < channels; channel++) {
      const source = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
      out.getChannelData(channel).set(source, offset);
    }
    offset += buffer.length;
  }

  return out;
}
