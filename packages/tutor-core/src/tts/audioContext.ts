let sharedAudioContext: AudioContext | null = null;

/** One-sample WAV so HTMLMediaElement.play() can join the Watch click gesture. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

/** One AudioContext for live TTS and pre-mount unlock (admin Play gesture). */
export function getSharedAudioContext(): AudioContext {
  if (sharedAudioContext && sharedAudioContext.state !== "closed") {
    return sharedAudioContext;
  }
  sharedAudioContext = new AudioContext();
  return sharedAudioContext;
}

/**
 * Resume the shared Web Audio graph inside a user gesture so a later
 * `TutorSessionShell` mount can decode/schedule TTS without a new suspended context.
 * Also primes HTMLAudio so stored MP3 replay is not autoplay-blocked after board restore.
 */
export function unlockTutorAudio(): void {
  if (typeof AudioContext === "undefined") {
    return;
  }
  const ctx = getSharedAudioContext();
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  try {
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // Some browsers reject a 1-sample buffer; AudioContext resume is still enough for TTS.
  }
  if (typeof window !== "undefined") {
    window.speechSynthesis?.resume();
    try {
      const prime = new Audio(SILENT_WAV);
      prime.volume = 0.01;
      void prime.play().catch(() => undefined);
    } catch {
      // HTMLAudio unlock is best-effort; TTS still uses the shared AudioContext.
    }
  }
}
