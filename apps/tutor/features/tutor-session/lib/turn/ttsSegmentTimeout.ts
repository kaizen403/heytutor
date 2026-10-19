/**
 * How long the segment runner may wait for speak() to finish.
 *
 * speak() covers first-chunk latency plus the whole playback. An 18s hard cap
 * is shorter than a normal DSA paragraph on HTTP TTS: Langfuse 5c194366 timed
 * out three segments in a row at exactly 18000ms while audio was still
 * arriving, then abandonSpeaking stopped both the voice and the code typing.
 */
const TTS_FIRST_CHUNK_BUDGET_MS = 15_000;
export const TTS_SEGMENT_TIMEOUT_CEILING_MS = 90_000;
const TTS_MS_PER_SPOKEN_CHAR = 90;

/** Match the lesson speed slider's 0.5x minimum; a malformed client rate must not remove the watchdog. */
export function segmentWatchdogPlaybackRate(playbackRate: number): number {
  return Number.isFinite(playbackRate) && playbackRate > 0 ? Math.max(.5, Math.min(playbackRate, 1)) : 1;
}

export function speakSegmentTimeoutMs(text: string, playbackRate = 1): number {
  const speechMs = Math.max(text.trim().length * TTS_MS_PER_SPOKEN_CHAR, 800);
  const naturalBudgetMs = Math.min(speechMs + TTS_FIRST_CHUNK_BUDGET_MS, TTS_SEGMENT_TIMEOUT_CEILING_MS);
  // The ceiling bounds natural speech, not slowed wall time. Scaling only
  // the per-character term would still cut long, valid 0.5x sentences at 90s.
  const rate = segmentWatchdogPlaybackRate(playbackRate);
  return naturalBudgetMs / rate;
}
