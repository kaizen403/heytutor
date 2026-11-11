let sharedAudioContext: AudioContext | null = null;
// Reserve independent graphs for the admin queue's maximum five shells after the Watch gesture.
const primedLectureContexts: AudioContext[] = [];
const LATE_LECTURE_RESERVE = 5;
const lectureAudioContexts = new Set<AudioContext>();
const audioHolds = new Map<AudioContext, AudioBufferSourceNode>();
const closingContexts = new WeakSet<AudioContext>();
/**
 * WebKit lifts its autoplay block per media element: a gesture unlocks only
 * the elements it touches, and a fresh `new Audio()` is refused again unless
 * it starts within about a second of another clip ending. Speech clips play
 * on these elements, primed inside a gesture, so a pause between sentences
 * cannot bring the permission prompt back.
 */
const primedSpeechAudio: HTMLAudioElement[] = [];
const PRIMED_SPEECH_AUDIO = 2;

/** One-sample WAV so HTMLMediaElement.play() can join the Watch click gesture. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

/**
 * Stop can close a context while a gesture's resume() or a pause's suspend()
 * is still pending, and the browser rejects that promise. Only that race is
 * expected; any other rejection still surfaces.
 */
export function settleContextChange(ctx: AudioContext, pending: Promise<void> | undefined): Promise<void> {
  return Promise.resolve(pending).catch((error: unknown) => {
    if (ctx.state === "closed" || closingContexts.has(ctx)) return;
    throw error;
  });
}

function closeContext(ctx: AudioContext): void {
  closingContexts.add(ctx);
  void ctx.close().catch(() => undefined);
}

function resumeContext(ctx: AudioContext): void {
  if (ctx.state === "suspended") {
    void settleContextChange(ctx, ctx.resume());
  }
}

/** An idle element a gesture already unlocked, or null when none is left. */
export function takePrimedSpeechAudio(): HTMLAudioElement | null {
  return primedSpeechAudio.shift() ?? null;
}

/** Return an unloaded element that came from `takePrimedSpeechAudio`. */
export function returnPrimedSpeechAudio(audio: HTMLAudioElement): void {
  if (primedSpeechAudio.includes(audio) || primedSpeechAudio.length >= LATE_LECTURE_RESERVE) return;
  primedSpeechAudio.push(audio);
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
  // Take a context constructed and resumed during the Watch click.
  let ctx = primedLectureContexts.shift();
  while (ctx?.state === "closed") ctx = primedLectureContexts.shift();
  ctx ??= new AudioContext();
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
    closeContext(ctx);
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
  for (const ctx of primedLectureContexts.splice(0)) {
    releaseLectureAudioContext(ctx);
  }
  if (sharedAudioContext && sharedAudioContext.state !== "closed") {
    releaseContextHold(sharedAudioContext);
    closeContext(sharedAudioContext);
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
  // The reserve includes graphs already leased to mounted lectures. Repeated
  // Watch gestures must not allocate five more when all five are in use.
  for (let i = primedLectureContexts.length - 1; i >= 0; i--) {
    if (primedLectureContexts[i].state === "closed") primedLectureContexts.splice(i, 1);
  }
  const activeLectures = [...lectureAudioContexts].filter((ctx) => ctx.state !== "closed");
  while (primedLectureContexts.length + activeLectures.length < LATE_LECTURE_RESERVE) {
    primedLectureContexts.push(new AudioContext());
  }
  for (const ctx of primedLectureContexts) holdContext(ctx);
  for (const ctx of activeLectures) {
    holdContext(ctx);
  }
  if (typeof window !== "undefined") {
    window.speechSynthesis?.resume();
    try {
      const prime = new Audio(SILENT_WAV);
      prime.volume = 0.01;
      void prime.play().catch(() => undefined);
      while (primedSpeechAudio.length < PRIMED_SPEECH_AUDIO) primedSpeechAudio.push(new Audio());
      // Only idle elements are here; a clip that is playing is never touched.
      for (const audio of primedSpeechAudio) {
        audio.src = SILENT_WAV;
        void audio.play().catch(() => undefined);
      }
    } catch {
      // HTMLAudio unlock is best-effort; TTS still uses the shared AudioContext.
    }
  }
}
