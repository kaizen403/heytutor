let sharedAudioContext: AudioContext | null = null;
const lectureAudioContexts = new Set<AudioContext>();

/** One-sample WAV so HTMLMediaElement.play() can join the Watch click gesture. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

function resumeContext(ctx: AudioContext): void {
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
}

/** One AudioContext for live TTS and pre-mount unlock (admin Play gesture). */
export function getSharedAudioContext(): AudioContext {
  if (sharedAudioContext && sharedAudioContext.state !== "closed") {
    return sharedAudioContext;
  }
  sharedAudioContext = new AudioContext();
  return sharedAudioContext;
}

/**
 * Per-recording Web Audio graph. Concurrent lecture-lab shells must not share
 * decodeAudioData / BufferSource timelines or Watch Live speech starves.
 */
export function createLectureAudioContext(): AudioContext {
  const ctx = new AudioContext();
  lectureAudioContexts.add(ctx);
  return ctx;
}

export function releaseLectureAudioContext(ctx: AudioContext | null | undefined): void {
  if (!ctx) {
    return;
  }
  lectureAudioContexts.delete(ctx);
  if (ctx.state !== "closed") {
    void ctx.close().catch(() => undefined);
  }
}

/**
 * Hard silence for tab close / pagehide. Firefox often skips React unmount
 * (bfcache), so AudioContext and speechSynthesis keep talking after the
 * window is gone. Safe to call more than once.
 *
 * Do not use this to stop a single lecture while others are still teaching
 * on the same page — it closes every lecture graph.
 */
export function haltAllLectureAudio(): void {
  if (typeof window !== "undefined") {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // speechSynthesis is best-effort on teardown
    }
  }
  for (const ctx of [...lectureAudioContexts]) {
    releaseLectureAudioContext(ctx);
  }
  if (sharedAudioContext && sharedAudioContext.state !== "closed") {
    void sharedAudioContext.close().catch(() => undefined);
  }
  sharedAudioContext = null;
}

/**
 * Resume every lecture AudioContext inside a user gesture so a later
 * `TutorSessionShell` mount can decode/schedule TTS without a new suspended context.
 * Also primes HTMLAudio so stored MP3 replay is not autoplay-blocked after board restore.
 */
export function unlockTutorAudio(): void {
  if (typeof AudioContext === "undefined") {
    return;
  }
  resumeContext(getSharedAudioContext());
  for (const ctx of lectureAudioContexts) {
    resumeContext(ctx);
  }
  try {
    const ctx = getSharedAudioContext();
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
