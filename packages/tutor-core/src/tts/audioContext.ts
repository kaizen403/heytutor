let sharedAudioContext: AudioContext | null = null;
const lectureAudioContexts = new Set<AudioContext>();
const audioHolds = new Map<AudioContext, AudioBufferSourceNode>();

/** One-sample WAV so HTMLMediaElement.play() can join the Watch click gesture. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

function resumeContext(ctx: AudioContext): void {
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
}

function releaseContextHold(ctx: AudioContext): void {
  const source = audioHolds.get(ctx);
  if (!source) {
    return;
  }
  audioHolds.delete(ctx);
  try {
    source.stop();
  } catch {
    // already stopped
  }
}

/**
 * Keep a silent loop playing so a long plan cannot re-suspend WebAudio after
 * the submit gesture. A suspended context at first speech is the silent
 * 1.5–2× board dump: ink runs on the wall clock, then the lecture "starts".
 */
function holdContext(ctx: AudioContext): void {
  if (ctx.state === "closed") {
    return;
  }
  resumeContext(ctx);
  if (audioHolds.has(ctx)) {
    return;
  }
  try {
    const sampleRate = ctx.sampleRate > 0 ? ctx.sampleRate : 44_100;
    const buffer = ctx.createBuffer(1, sampleRate, sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    // Inaudible, not zero: some engines treat a 0-gain loop as silence and
    // re-suspend the context during a long plan.
    gain.gain.value = 0.00001;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0);
    audioHolds.set(ctx, source);
  } catch {
    // resume is still enough; some test fakes omit GainNode/loop.
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
  releaseContextHold(ctx);
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
    releaseContextHold(sharedAudioContext);
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
  const shared = getSharedAudioContext();
  holdContext(shared);
  for (const ctx of lectureAudioContexts) {
    holdContext(ctx);
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
