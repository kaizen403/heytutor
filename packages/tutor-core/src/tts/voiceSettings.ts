/**
 * How the tutor sounds. One copy, because there are two paths to the same
 * voice: the WebSocket stream and the HTTP fallback. They each held their own
 * literal, so a lesson could change character the moment the socket dropped.
 *
 * Speed is shared by Cartesia and ElevenLabs. The other dials are retained
 * for the ElevenLabs adapter; Cartesia receives only generation speed.
 *
 * The ElevenLabs dials, and why they sit where they do:
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

export type TutorVoiceSettings = {
  stability: number;
  similarity_boost: number;
  style?: number;
  use_speaker_boost?: boolean;
  speed?: number;
};

/**
 * How the one opening line of a turn is spoken.
 *
 * The body of a lesson is minutes of steady explanation and the dials above
 * are tuned for exactly that: a voice a student can follow while copying
 * algebra off a board. An opening is the opposite job. It is one sentence, the
 * student is not writing anything down yet, and it has to sound like a person
 * starting rather than a lesson already in progress.
 *
 * So it sits at the top of the documented expression range and at a pace close
 * to the voice's own: `style` at the ceiling of `TUTOR_VOICE_STYLE_RANGE`,
 * `stability` at its floor (stability is variability inverted, so lower is
 * more alive), and `speed` back near 1 because nobody is transcribing a
 * greeting. Everything else is held to the teaching voice so the timbre does
 * not change between the opening and the first step.
 */
export const TUTOR_OPENING_VOICE_SETTINGS = {
  stability: TUTOR_VOICE_STYLE_RANGE.min,
  similarity_boost: TUTOR_VOICE_SETTINGS.similarity_boost,
  style: TUTOR_VOICE_STYLE_RANGE.max,
  use_speaker_boost: TUTOR_VOICE_SETTINGS.use_speaker_boost,
  speed: 0.97,
} as const;

/** The dials for a segment's delivery. Anything unnamed teaches. */
export function voiceSettingsForDelivery(delivery?: string | null): TutorVoiceSettings {
  return delivery === "opening" ? TUTOR_OPENING_VOICE_SETTINGS : TUTOR_VOICE_SETTINGS;
}

/**
 * Cache identity for a set of dials.
 *
 * Generated audio is cached and matched by its spoken text alone, on both the
 * socket and the HTTP path. Two requests for the same sentence at two
 * different deliveries are not the same audio, so the delivery has to be part
 * of what a lookup matches, or an opening line prefetched by the lookahead
 * comes back in the flat teaching voice.
 */
export function voiceSettingsKey(settings?: TutorVoiceSettings | null): string {
  if (!settings) return "";
  return `${settings.stability}:${settings.similarity_boost}:${settings.style ?? ""}:${settings.speed ?? ""}`;
}
