/**
 * How the tutor sounds. One copy, because there are two paths to the same
 * voice: the WebSocket stream and the HTTP fallback. They each held their own
 * literal, so a lesson could change character the moment the socket dropped.
 *
 * The dials, and why they sit where they do:
 *
 * - `stability` is variability, inverted. Low is expressive and occasionally
 *   uneven; high is steady and flat. A teacher reading the same shape of
 *   sentence forty times in a row goes monotone at high stability, which is
 *   what makes a lesson tiring to listen to.
 * - `style` is how much of the voice's own delivery comes through: emphasis,
 *   lift into a question, the drop at the end of an explanation. It is the
 *   dial that carries expression, and it was low enough that every sentence
 *   landed the same way, on the same flat full stop.
 * - `similarity_boost` holds the timbre to the cloned voice. Raising style
 *   without this drifts.
 * - `speed` is generation speed, not playback rate: playback rate shifts pitch
 *   and makes a chipmunk, generation speed keeps the voice and changes the
 *   pace of delivery. Below 1 is slower than the voice's natural pace, which
 *   is deliberate for a tutor being followed on a board.
 *
 * Raising `style` costs some stability and a little latency. That trade is the
 * point: a lesson is minutes of continuous speech, and a flat one is worse
 * than an occasionally uneven one.
 */
export const TUTOR_VOICE_SETTINGS = {
  stability: 0.4,
  similarity_boost: 0.75,
  style: 0.35,
  use_speaker_boost: true,
  speed: 0.88,
} as const;

/**
 * Expression has a working range. Below the floor the delivery flattens into
 * the same cadence every sentence; above the ceiling the voice starts to
 * over-perform and wander off the cloned timbre.
 */
export const TUTOR_VOICE_STYLE_RANGE = { min: 0.3, max: 0.6 } as const;
