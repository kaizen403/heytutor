export interface PlayReplayAudioOptions {
  playbackRate?: number;
  maxDurationMs?: number;
  startAtMs?: number;
  onStart?: (durationMs: number) => void;
  shouldCancel?: () => boolean;
  /** Live playback-rate reader so mid-cue speed changes retune timeout + element. */
  getPlaybackRate?: () => number;
}

const LOAD_TIMEOUT_MS = 12_000;

export function applyReplayPlaybackRate(
  audio: HTMLAudioElement,
  rate: number,
): void {
  const safeRate = Math.max(rate, 0.1);
  audio.playbackRate = safeRate;
  // Keep pitch natural while speeding/slowing mid-lecture.
  if ("preservesPitch" in audio) {
    (audio as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true;
  }
}

export function playReplayAudio(
  url: string,
  options: PlayReplayAudioOptions = {},
): { audio: HTMLAudioElement; done: Promise<void> } {
  const audio = new Audio(url);
  applyReplayPlaybackRate(audio, options.playbackRate ?? 1);
  audio.preload = "auto";

  let cancelInterval: number | null = null;
  let loadTimeoutId: number | null = null;
  let playbackTimeoutId: number | null = null;
  let ratePollId: number | null = null;
  let finishPlayback: ((error?: unknown) => void) | null = null;
  let started = false;
  let mediaDurationMs = options.maxDurationMs ?? 60_000;

  const done = new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = (error?: unknown) => {
      if (settled) {
        return;
      }

      settled = true;

      if (cancelInterval !== null) {
        window.clearInterval(cancelInterval);
        cancelInterval = null;
      }
      if (loadTimeoutId !== null) {
        window.clearTimeout(loadTimeoutId);
        loadTimeoutId = null;
      }
      if (playbackTimeoutId !== null) {
        window.clearTimeout(playbackTimeoutId);
        playbackTimeoutId = null;
      }
      if (ratePollId !== null) {
        window.clearInterval(ratePollId);
        ratePollId = null;
      }

      audio.onplay = null;
      audio.onloadedmetadata = null;
      audio.onended = null;
      audio.onerror = null;
      finishPlayback = null;

      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    finishPlayback = finish;

    const currentRate = (): number =>
      Math.max(options.getPlaybackRate?.() ?? audio.playbackRate ?? 1, 0.1);

    const armPlaybackTimeout = () => {
      if (playbackTimeoutId !== null) {
        window.clearTimeout(playbackTimeoutId);
      }
      const remainingMediaMs = Math.max(
        mediaDurationMs - Math.round((audio.currentTime || 0) * 1000),
        500,
      );
      const wallBudgetMs = remainingMediaMs / currentRate() + 8_000;
      playbackTimeoutId = window.setTimeout(() => {
        finish(new Error(`Replay audio playback timeout: ${url}`));
      }, Math.max(wallBudgetMs, 15_000));
    };

    const notifyStart = () => {
      if (started) {
        return;
      }
      started = true;
      if (loadTimeoutId !== null) {
        window.clearTimeout(loadTimeoutId);
        loadTimeoutId = null;
      }
      const durationMs =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? Math.round(audio.duration * 1000)
          : options.maxDurationMs ?? 700;
      mediaDurationMs = durationMs;
      options.onStart?.(durationMs);
      armPlaybackTimeout();
    };

    loadTimeoutId = window.setTimeout(() => {
      finish(new Error(`Replay audio load timeout: ${url}`));
    }, LOAD_TIMEOUT_MS);

    audio.onloadedmetadata = () => {
      if (options.startAtMs && options.startAtMs > 0) {
        audio.currentTime = Math.min(
          options.startAtMs / 1000,
          Number.isFinite(audio.duration) ? audio.duration : options.startAtMs / 1000,
        );
      }
      notifyStart();
    };

    audio.onplay = () => {
      notifyStart();
    };

    audio.onended = () => finish();
    audio.onerror = () => finish(new Error(`Replay audio failed: ${url}`));

    // Keep element rate + watchdog aligned when the user changes speed mid-cue.
    ratePollId = window.setInterval(() => {
      if (settled) {
        return;
      }
      const rate = currentRate();
      if (Math.abs(audio.playbackRate - rate) > 0.001) {
        applyReplayPlaybackRate(audio, rate);
        if (started) {
          armPlaybackTimeout();
        }
      }
    }, 100);

    void audio.play().catch((error: unknown) => finish(error));
  });

  if (options.shouldCancel) {
    cancelInterval = window.setInterval(() => {
      if (options.shouldCancel?.()) {
        audio.pause();
        finishPlayback?.();
      }
    }, 32);
    void done.finally(() => {
      if (cancelInterval !== null) {
        window.clearInterval(cancelInterval);
        cancelInterval = null;
      }
    });
  }

  return { audio, done };
}

export function stopReplayAudio(audio: HTMLAudioElement | null): void {
  if (!audio) {
    return;
  }

  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

/** Wait until media time reaches targetMs, tracking live playbackRate changes. */
export function waitForReplayMediaTime(
  audio: HTMLAudioElement,
  targetMs: number,
  options: {
    shouldCancel?: () => boolean;
    getPlaybackRate?: () => number;
  } = {},
): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const startWall = performance.now();
    const targetSec = Math.max(targetMs, 0) / 1000;

    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    const step = () => {
      if (done) return;
      if (options.shouldCancel?.()) {
        finish();
        return;
      }
      const rate = Math.max(options.getPlaybackRate?.() ?? audio.playbackRate ?? 1, 0.1);
      if (Math.abs(audio.playbackRate - rate) > 0.001) {
        applyReplayPlaybackRate(audio, rate);
      }
      if (audio.currentTime + 0.01 >= targetSec || audio.ended) {
        finish();
        return;
      }
      // Bound wait so a stalled element cannot freeze the lecture.
      if (performance.now() - startWall > Math.max(targetMs / rate + 4_000, 8_000)) {
        finish();
        return;
      }
      window.requestAnimationFrame(step);
    };

    window.requestAnimationFrame(step);
  });
}

/** Wall-clock delay that shortens/lengthens when speed changes mid-wait. */
export function speedAwareDelay(
  mediaDurationMs: number,
  options: {
    shouldCancel?: () => boolean;
    getPlaybackRate: () => number;
  },
): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let mediaElapsedMs = 0;
    let lastWall = performance.now();
    const schedule = globalThis.setTimeout.bind(globalThis);

    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    const step = () => {
      if (done) return;
      if (options.shouldCancel?.()) {
        finish();
        return;
      }
      const now = performance.now();
      const rate = Math.max(options.getPlaybackRate(), 0.1);
      mediaElapsedMs += (now - lastWall) * rate;
      lastWall = now;
      if (mediaElapsedMs >= mediaDurationMs) {
        finish();
        return;
      }
      schedule(step, 16);
    };

    schedule(step, 16);
  });
}
