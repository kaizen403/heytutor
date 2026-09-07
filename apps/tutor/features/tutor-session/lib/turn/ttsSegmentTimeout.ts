/**
 * How long the segment runner may wait for speak() to finish.
 *
 * speak() covers first-chunk latency plus the whole playback. An 18s hard cap
 * is shorter than a normal DSA paragraph on HTTP TTS: Langfuse 5c194366 timed
 * out three segments in a row at exactly 18000ms while audio was still
 * arriving, then abandonSpeaking stopped both the voice and the code typing.
 */
export const TTS_FIRST_CHUNK_BUDGET_MS = 15_000;
export const TTS_SEGMENT_TIMEOUT_CEILING_MS = 90_000;
export const TTS_MS_PER_SPOKEN_CHAR = 90;

export function speakSegmentTimeoutMs(text: string): number {
  const speechMs = Math.max(text.trim().length * TTS_MS_PER_SPOKEN_CHAR, 800);
  return Math.min(speechMs + TTS_FIRST_CHUNK_BUDGET_MS, TTS_SEGMENT_TIMEOUT_CEILING_MS);
}
