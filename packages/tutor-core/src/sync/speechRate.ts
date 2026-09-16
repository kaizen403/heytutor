/**
 * How fast the voice speaks, in media ms per spoken character.
 *
 * Measured on 10 Sep 2026 over 19 aligned sentences of one lesson (concave
 * mirror, f = 15 cm, u = 20 cm): pooled 86.2 ms per character, median 11.7
 * characters per second, per sentence between 70 and 100 ms. Every estimate
 * in the sync path had assumed 15 characters per second (66 ms), so the
 * estimated schedule ran a quarter fast and the pen finished one to two
 * seconds before the voice on 27 of 33 rows. The runner's own guess was 85.
 *
 * One number now feeds all of them, and a session refines it from the
 * sentences it has already heard: an exponential moving average over
 * segments long enough to carry a rate (short exclamations are noisy), kept
 * inside the range any real voice setting produces.
 */
export const defaultSpeechMsPerChar = 86;
export const SPEECH_MS_PER_CHAR_MIN = 60;
export const SPEECH_MS_PER_CHAR_MAX = 130;
export const SPEECH_RATE_EMA_ALPHA = 0.35;
export const SPEECH_RATE_MIN_SAMPLE_CHARS = 20;
/** Shortest speech estimate handed to any clock; a one word beat still has a body. */
export const MIN_SPEECH_ESTIMATE_MS = 700;

export interface SpeechRateState {
  msPerChar: number;
  /** Segments that moved the average. */
  samples: number;
}

export function clampSpeechMsPerChar(msPerChar: number): number {
  if (!Number.isFinite(msPerChar)) {
    return defaultSpeechMsPerChar;
  }
  return Math.min(Math.max(msPerChar, SPEECH_MS_PER_CHAR_MIN), SPEECH_MS_PER_CHAR_MAX);
}

export function createSpeechRateState(seedMsPerChar = defaultSpeechMsPerChar): SpeechRateState {
  return { msPerChar: clampSpeechMsPerChar(seedMsPerChar), samples: 0 };
}

/**
 * Fold one finished segment into the rate. Returns a new state; the old one
 * is untouched so callers can hold it in a ref or a reducer alike. Segments
 * under SPEECH_RATE_MIN_SAMPLE_CHARS or without a positive duration leave the
 * rate where it was.
 */
export function observeSpeechRate(
  state: SpeechRateState,
  spokenChars: number,
  durationMs: number,
): SpeechRateState {
  if (
    !Number.isFinite(spokenChars) ||
    !Number.isFinite(durationMs) ||
    spokenChars < SPEECH_RATE_MIN_SAMPLE_CHARS ||
    durationMs <= 0
  ) {
    return state;
  }
  const sample = clampSpeechMsPerChar(durationMs / spokenChars);
  const next = state.msPerChar + SPEECH_RATE_EMA_ALPHA * (sample - state.msPerChar);
  return { msPerChar: clampSpeechMsPerChar(next), samples: state.samples + 1 };
}

/** Media ms the voice needs for this many spoken characters at the given rate. */
export function estimateSpeechDurationMs(
  spokenChars: number,
  msPerChar = defaultSpeechMsPerChar,
  minMs = MIN_SPEECH_ESTIMATE_MS,
): number {
  return Math.max(Math.round(Math.max(spokenChars, 0) * clampSpeechMsPerChar(msPerChar)), minMs);
}

/** Stateful wrapper for a session: one per lesson, fed every `segment timings` line. */
export class SpeechRateEstimator {
  private state: SpeechRateState;

  constructor(seedMsPerChar = defaultSpeechMsPerChar) {
    this.state = createSpeechRateState(seedMsPerChar);
  }

  get msPerChar(): number {
    return this.state.msPerChar;
  }

  get samples(): number {
    return this.state.samples;
  }

  /** Returns the rate after folding this segment in. */
  observe(spokenChars: number, durationMs: number): number {
    this.state = observeSpeechRate(this.state, spokenChars, durationMs);
    return this.state.msPerChar;
  }

  estimateMs(spokenChars: number, minMs = MIN_SPEECH_ESTIMATE_MS): number {
    return estimateSpeechDurationMs(spokenChars, this.state.msPerChar, minMs);
  }

  reset(seedMsPerChar = defaultSpeechMsPerChar): void {
    this.state = createSpeechRateState(seedMsPerChar);
  }
}
