import { applyHtmlAudioPlaybackRate } from "@heytutor/tutor-core";
import { DEFAULT_PLAYBACK_SPEED } from "@/lib/account/lessonSettings";

export const DEFAULT_REPLAY_SPEED = DEFAULT_PLAYBACK_SPEED;

/** Retry from the interrupted word only when per-character alignment is trustworthy. */
export function remainingReplaySpeech(
  spokenText: string,
  playedMs: number,
  timings?: { charStartTimes: number[] } | null,
): string {
  if (!timings || timings.charStartTimes.length !== spokenText.length || playedMs <= 0) {
    return spokenText;
  }
  const firstUnheard = timings.charStartTimes.findIndex((start) => start * 1000 > playedMs);
  // The final character can have started but not finished when media fails.
  const interruptedAt = firstUnheard < 0 ? spokenText.length - 1 : firstUnheard;
  const wordStart = spokenText.lastIndexOf(" ", interruptedAt - 1) + 1;
  return spokenText.slice(wordStart).trim();
}

export interface PlayReplayAudioOptions {
  audio?: HTMLAudioElement;
  playbackRate?: number;
  maxDurationMs?: number;
  startAtMs?: number;
  onStart?: (durationMs: number) => void;
  /** Position sampled before a failed media element is unloaded/reset. */
  onFailure?: (playedMs: number) => void;
  shouldCancel?: () => boolean;
  /** Current user pause state, including before the queued media pause event. */
  isPaused?: () => boolean;
  /** Live playback-rate reader so mid-cue speed changes retune timeout + element. */
  getPlaybackRate?: () => number;
}

const LOAD_TIMEOUT_MS = 6_000;

export function applyReplayPlaybackRate(
  audio: HTMLAudioElement,
  rate: number,
): void {
  applyHtmlAudioPlaybackRate(audio, rate);
}

/**
 * Apply an in-flight replay speed to HTML audio, live TTS, and ink together.
 * The admin Watch overlay drives this. The student transport that also used
 * it has been removed from the tutor.
 */
export function applyReplaySpeed(options: {
  rate: number;
  audio?: HTMLAudioElement | null;
  preloaded?: Iterable<HTMLAudioElement>;
  setTtsPlaybackRate?: (rate: number) => void;
  setAnimationSpeed?: (rate: number) => void;
}): number {
  const safeRate = Math.max(options.rate, 0.1);
  options.setTtsPlaybackRate?.(safeRate);
  options.setAnimationSpeed?.(safeRate);
  if (options.audio) {
    applyReplayPlaybackRate(options.audio, safeRate);
  }
  if (options.preloaded) {
    for (const audio of options.preloaded) {
      applyReplayPlaybackRate(audio, safeRate);
    }
  }
  return safeRate;
}

/**
 * Sync a controlled `playbackRate` prop onto `applySpeed` without render-phase setState.
 * Overlay dropdowns should pass the same apply helper the session hooks use.
 */
export function syncControlledPlaybackRate(
  playbackRate: number | undefined,
  currentRate: number,
  applySpeed: (rate: number) => void,
): void {
  if (typeof playbackRate !== "number" || !Number.isFinite(playbackRate)) {
    return;
  }
  const safeRate = Math.max(playbackRate, 0.1);
  if (Math.abs(currentRate - safeRate) < 0.001) {
    return;
  }
  applySpeed(safeRate);
}

export function playReplayAudio(
  url: string,
  options: PlayReplayAudioOptions = {},
): { audio: HTMLAudioElement; done: Promise<void> } {
  const audio = options.audio ?? new Audio(url);
  applyReplayPlaybackRate(audio, options.playbackRate ?? 1);
  audio.preload = "auto";

  let cancelInterval: number | null = null;
  let loadTimeoutId: number | null = null;
  let playbackTimeoutId: number | null = null;
  let ratePollId: number | null = null;
  let started = false;
  let mediaDurationMs = options.maxDurationMs ?? 60_000;

  const done = new Promise<void>((resolve, reject) => {
    let settled = false;
    let pauseEpoch = 0;

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

      audio.onpause = null;
      audio.onplay = null;
      audio.onplaying = null;
      audio.onloadedmetadata = null;
      audio.onended = null;
      audio.onerror = null;

      if (error) {
        options.onFailure?.(Number.isFinite(audio.currentTime) ? audio.currentTime * 1000 : 0);
      }
      if (error || options.shouldCancel?.()) {
        stopReplayAudio(audio);
      }

      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

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
        playbackTimeoutId = null;
        // The control marks pause synchronously, but the browser may queue
        // `pause` behind this watchdog. Resume/playing arms a fresh budget.
        if (options.isPaused?.() || audio.paused) return;
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
    };

    const armLoadTimeout = () => {
      if (loadTimeoutId !== null) window.clearTimeout(loadTimeoutId);
      loadTimeoutId = window.setTimeout(() => {
        loadTimeoutId = null;
        // pause() may have run while its media event is still queued. Resume's
        // play event arms a fresh bounded wait rather than charging paused time.
        if (options.isPaused?.() || audio.paused) return;
        finish(new Error(`Replay audio load timeout: ${url}`));
      }, LOAD_TIMEOUT_MS);
    };
    armLoadTimeout();

    const seekToStart = () => {
      if (options.startAtMs && options.startAtMs > 0) {
        audio.currentTime = Math.min(
          options.startAtMs / 1000,
          Number.isFinite(audio.duration) ? audio.duration : options.startAtMs / 1000,
        );
      }
    };

    audio.onloadedmetadata = () => {
      seekToStart();
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        mediaDurationMs = Math.round(audio.duration * 1000);
      }
    };

    // Metadata and `play` can arrive while the media element is still
    // buffering. The board clock starts only when audio can actually play.
    audio.onplaying = () => {
      if (audio.paused || options.isPaused?.() || settled) return;
      notifyStart();
      if (loadTimeoutId !== null) {
        window.clearTimeout(loadTimeoutId);
        loadTimeoutId = null;
      }
      armPlaybackTimeout();
    };
    audio.onpause = () => {
      if (!audio.paused || settled) return;
      pauseEpoch++;
      if (loadTimeoutId !== null) {
        window.clearTimeout(loadTimeoutId);
        loadTimeoutId = null;
      }
      if (playbackTimeoutId !== null) {
        window.clearTimeout(playbackTimeoutId);
        playbackTimeoutId = null;
      }
    };
    audio.onplay = () => {
      // A resumed element can buffer again before `playing`; bound that wait.
      // A queued play event may also arrive after pause, so never arm it then.
      if (!settled && !audio.paused && !options.isPaused?.()) armLoadTimeout();
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
        if (started && !audio.paused && !options.isPaused?.()) {
          armPlaybackTimeout();
        }
      }
    }, 100);

    if (audio.readyState >= 1) {
      seekToStart();
    }
    const playEpoch = pauseEpoch;
    void audio.play().catch((error: unknown) => {
      // A pause interrupts a pending play() promise, sometimes after resume.
      // The resumed element still owns this cue until `ended` or a real error.
      if (pauseEpoch !== playEpoch || options.isPaused?.()
        || (error instanceof Error && error.name === "AbortError" && !audio.paused)) return;
      finish(error);
    });
    if (options.shouldCancel) {
      cancelInterval = window.setInterval(() => {
        if (options.shouldCancel?.()) finish();
      }, 32);
    }
  });

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

/** Wait until a draw clock (media or wall fallback) reaches targetMs. */
export function waitUntilDrawClock(
  getPositionMs: () => number,
  targetMs: number,
  options: {
    shouldCancel?: () => boolean;
    isPaused?: () => boolean;
    getPlaybackRate?: () => number;
    nowMs?: () => number;
  } = {},
): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const nowMs = options.nowMs ?? (() => performance.now());
    let lastWall = nowMs();
    let activeWallMs = 0;
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
      const now = nowMs();
      if (options.isPaused?.()) {
        // Keep stateful media/wall fallback clocks sampled without advancing
        // the draw target or charging paused time against the deadline.
        getPositionMs();
        lastWall = now;
        schedule(step, 16);
        return;
      }
      activeWallMs += now - lastWall;
      lastWall = now;
      const rate = Math.max(options.getPlaybackRate?.() ?? 1, 0.1);
      if (getPositionMs() + 10 >= targetMs) {
        finish();
        return;
      }
      if (activeWallMs > Math.max(targetMs / rate + 4_000, 8_000)) {
        finish();
        return;
      }
      schedule(step, 16);
    };

    schedule(step, 0);
  });
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
  const fallbackClock = createAccumulatingMediaClock({
    getPlaybackRate: () => options.getPlaybackRate?.() ?? audio.playbackRate ?? 1,
    isPaused: () => audio.paused,
  });
  return waitUntilDrawClock(
    () => {
      const media = Number.isFinite(audio.currentTime) ? audio.currentTime * 1000 : 0;
      if (media > 0 || audio.ended) {
        return media;
      }
      return fallbackClock.positionMs();
    },
    targetMs,
    { ...options, isPaused: () => audio.paused },
  );
}

/** Media-time clock that accumulates wall delta × live rate (no jump on change). */
export function createAccumulatingMediaClock(options: {
  getPlaybackRate: () => number;
  nowMs?: () => number;
  isPaused?: () => boolean;
}): { positionMs: () => number; nowMs: () => number; setPaused: (paused: boolean) => void } {
  const nowMs = options.nowMs ?? (() => performance.now());
  let mediaMs = 0;
  let lastWall = nowMs();
  let activeWall = lastWall;
  let paused = options.isPaused?.() ?? false;
  const advance = (now: number, nextPaused: boolean) => {
    if (!paused) activeWall += Math.max(now - lastWall, 0);
    lastWall = now;
    paused = nextPaused;
  };
  const activeNow = () => {
    const now = nowMs();
    const observedPaused = options.isPaused?.() ?? paused;
    if (observedPaused !== paused) {
      // A sampled-only transition has no trustworthy transition timestamp.
      // Drop this ambiguous interval; controls use setPaused for exact edges.
      paused = observedPaused;
      lastWall = now;
    } else {
      advance(now, paused);
    }
    return activeWall;
  };
  let lastActive = activeWall;
  return {
    // Called by the pause/resume control itself: no draw/timer sample is needed
    // during a backgrounded pause to exclude its wall time.
    setPaused: (nextPaused) => { advance(nowMs(), nextPaused); },
    nowMs: activeNow,
    positionMs: () => {
      const now = activeNow();
      mediaMs += (now - lastActive) * Math.max(options.getPlaybackRate(), 0.1);
      lastActive = now;
      return mediaMs;
    },
  };
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
