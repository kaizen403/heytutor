/**
 * Lecture playback rate. Generation stays at the tutor's natural voice;
 * this module retimes already-produced audio so a mid-lesson speed change
 * takes effect on the current sentence, not the next one.
 */

export const MIN_PLAYBACK_RATE = 0.1;
export const MAX_PLAYBACK_RATE = 4;

export function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    return 1;
  }
  return Math.min(Math.max(rate, MIN_PLAYBACK_RATE), MAX_PLAYBACK_RATE);
}

export function applyHtmlAudioPlaybackRate(audio: HTMLAudioElement, rate: number): void {
  const safe = clampPlaybackRate(rate);
  audio.playbackRate = safe;
  if ("preservesPitch" in audio) {
    (audio as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true;
  }
}

export function applyHtmlAudioMute(audio: HTMLAudioElement, muted: boolean): void {
  audio.muted = muted;
  audio.volume = muted ? 0 : 1;
}

export function applyBufferSourcePlaybackRate(
  source: AudioBufferSourceNode,
  rate: number,
): void {
  const safe = clampPlaybackRate(rate);
  if (source.playbackRate) {
    source.playbackRate.value = safe;
  }
}

export interface RateMediaClock {
  elapsedMediaSec: number;
  lastCtxTime: number | null;
  rate: number;
}

export function createRateMediaClock(rate = 1): RateMediaClock {
  return {
    elapsedMediaSec: 0,
    lastCtxTime: null,
    rate: clampPlaybackRate(rate),
  };
}

export function startRateMediaClock(clock: RateMediaClock, ctxTime: number): void {
  clock.elapsedMediaSec = 0;
  clock.lastCtxTime = ctxTime;
}

export function mediaPositionSec(clock: RateMediaClock, ctxTime: number): number {
  if (clock.lastCtxTime === null) {
    return clock.elapsedMediaSec;
  }
  return clock.elapsedMediaSec + (ctxTime - clock.lastCtxTime) * clock.rate;
}

export function setRateMediaClockRate(
  clock: RateMediaClock,
  ctxTime: number,
  rate: number,
): void {
  if (clock.lastCtxTime !== null) {
    clock.elapsedMediaSec = mediaPositionSec(clock, ctxTime);
    clock.lastCtxTime = ctxTime;
  }
  clock.rate = clampPlaybackRate(rate);
}

export function remainingWallSec(remainingMediaSec: number, rate: number): number {
  return Math.max(remainingMediaSec, 0) / clampPlaybackRate(rate);
}
