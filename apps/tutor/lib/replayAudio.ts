export interface PlayReplayAudioOptions {
  playbackRate?: number;
  maxDurationMs?: number;
  startAtMs?: number;
  onStart?: (durationMs: number) => void;
  shouldCancel?: () => boolean;
}

const LOAD_TIMEOUT_MS = 12_000;

export function playReplayAudio(
  url: string,
  options: PlayReplayAudioOptions = {},
): { audio: HTMLAudioElement; done: Promise<void> } {
  const audio = new Audio(url);
  audio.playbackRate = options.playbackRate ?? 1;
  audio.preload = "auto";

  let cancelInterval: number | null = null;
  let loadTimeoutId: number | null = null;
  let playbackTimeoutId: number | null = null;
  let finishPlayback: ((error?: unknown) => void) | null = null;
  let started = false;

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
      options.onStart?.(durationMs);
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
      const durationMs =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? Math.round(audio.duration * 1000)
          : options.maxDurationMs ?? 60_000;
      playbackTimeoutId = window.setTimeout(() => {
        finish(new Error(`Replay audio playback timeout: ${url}`));
      }, Math.max(durationMs + 8_000, 15_000));
    };

    audio.onplay = () => {
      notifyStart();
    };

    audio.onended = () => finish();
    audio.onerror = () => finish(new Error(`Replay audio failed: ${url}`));

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
