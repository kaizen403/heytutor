"use client";

import { resolveApiUrl } from "@heytutor/tutor-core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

export type VoiceInputState = "idle" | "listening" | "transcribing";

export interface UseVoiceInputOptions {
  /** Handed the finished transcript, already trimmed and non-empty. */
  onTranscript: (text: string) => void;
  /**
   * Fires the instant the mic opens. A live lesson pauses here — otherwise the
   * tutor's own narration is what gets transcribed.
   */
  onStart?: () => void;
  /** Language code for the spoken audio. Omitted lets Scribe detect it. */
  languageCode?: string;
  /** Longest single take. The recorder stops itself and transcribes. */
  maxDurationMs?: number;
  /** Nothing may open the mic while this is true. */
  disabled?: boolean;
}

export interface VoiceInput {
  /** This browser can record at all. False on anything without MediaRecorder. */
  supported: boolean;
  state: VoiceInputState;
  /** Recording or waiting on the transcript — either way the mic is in use. */
  busy: boolean;
  error: string | null;
  /**
   * The server has no `ELEVENLABS_STT_API_KEY`. Latches on the first refusal so
   * the caller can drop to the browser's own dictation instead of asking the
   * student to try again forever.
   */
  unavailable: boolean;
  /**
   * Live frequency data for the open mic, or null when nothing is recording.
   *
   * A ref rather than state on purpose: a level meter wants sixty reads a
   * second, and putting that through React would re-render the whole ask bar
   * on every frame. The visualiser polls this in its own rAF loop and writes
   * straight to the DOM.
   */
  analyserRef: RefObject<AnalyserNode | null>;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  /** Drop the take without transcribing it. */
  cancel: () => void;
  clearError: () => void;
}

const DEFAULT_MAX_DURATION_MS = 60_000;

/** Ordered best-first. Safari supports none of the webm entries and lands on mp4. */
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

// Recording support is a browser fact, not state — read it through an external
// store so the server render and the first client render agree.
const subscribeToNothing = () => () => {};
const readSupport = () =>
  typeof window !== "undefined" &&
  typeof MediaRecorder !== "undefined" &&
  typeof navigator !== "undefined" &&
  typeof navigator.mediaDevices?.getUserMedia === "function";
const readServerSupport = () => false;

/**
 * The mic in the ask bar: press, speak, press again, and the words are in the box.
 *
 * Recording is the browser's job and transcription is ElevenLabs' — the audio
 * goes to `/api/stt`, which holds the key. Nothing here ever sees it.
 */
export function useVoiceInput({
  onTranscript,
  onStart,
  languageCode,
  maxDurationMs = DEFAULT_MAX_DURATION_MS,
  disabled = false,
}: UseVoiceInputOptions): VoiceInput {
  const supported = useSyncExternalStore(subscribeToNothing, readSupport, readServerSupport);
  const [state, setState] = useState<VoiceInputState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<number | null>(null);
  /** Bumped on every take, so a superseded one cannot land its transcript. */
  const takeRef = useRef(0);
  const discardRef = useRef(false);
  const mountedRef = useRef(true);

  // Read long after the take starts; kept in refs so start() does not become a
  // new function on every parent render.
  const onTranscriptRef = useRef(onTranscript);
  const onStartRef = useRef(onStart);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onStartRef.current = onStart;
  }, [onStart, onTranscript]);

  const releaseStream = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    analyserRef.current = null;
    // Every AudioContext holds a hardware audio thread, and browsers cap how
    // many a page may have. Closing is not optional here.
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => {
        /* already closing */
      });
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      takeRef.current += 1;
      discardRef.current = true;
      try {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      } catch {
        /* already stopped */
      }
      releaseStream();
    };
  }, [releaseStream]);

  const transcribe = useCallback(
    async (audio: Blob, take: number) => {
      const form = new FormData();
      form.set("audio", audio);
      if (languageCode) form.set("language_code", languageCode);

      try {
        const response = await fetch(resolveApiUrl("/api/stt"), {
          method: "POST",
          body: form,
        });
        const data = (await response.json().catch(() => ({}))) as {
          text?: unknown;
          error?: unknown;
          unconfigured?: unknown;
        };
        if (!mountedRef.current || takeRef.current !== take) return;

        if (!response.ok) {
          if (data.unconfigured === true) setUnavailable(true);
          setError(
            typeof data.error === "string" ? data.error : "Could not transcribe that.",
          );
          return;
        }
        if (typeof data.text !== "string" || !data.text.trim()) {
          setError("Could not make out any speech in that.");
          return;
        }
        setError(null);
        onTranscriptRef.current(data.text.trim());
      } catch {
        if (!mountedRef.current || takeRef.current !== take) return;
        setError("Could not reach the transcriber. Check your connection.");
      } finally {
        if (mountedRef.current && takeRef.current === take) setState("idle");
      }
    },
    [languageCode],
  );

  const start = useCallback(() => {
    if (disabled || !supported || state !== "idle") return;

    const take = takeRef.current + 1;
    takeRef.current = take;
    discardRef.current = false;
    chunksRef.current = [];
    setError(null);
    setState("listening");
    onStartRef.current?.();

    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        if (!mountedRef.current || takeRef.current !== take) return;
        setState("idle");
        setError("Microphone access was blocked. Allow it in your browser to dictate.");
        return;
      }

      // The permission prompt is slow enough that the student may have clicked
      // off already; if this take was superseded, hand the mic straight back.
      if (!mountedRef.current || takeRef.current !== take) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const mimeType = pickMimeType();
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      } catch {
        stream.getTracks().forEach((track) => track.stop());
        if (!mountedRef.current || takeRef.current !== take) return;
        setState("idle");
        setError("This browser cannot record audio.");
        return;
      }

      streamRef.current = stream;
      recorderRef.current = recorder;

      // Tap the same stream the recorder is on, for the level meter. A failure
      // here costs the visualisation, never the recording, so it is swallowed.
      try {
        const AudioContextCtor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (AudioContextCtor) {
          const context = new AudioContextCtor();
          const analyser = context.createAnalyser();
          analyser.fftSize = 256;
          // Enough smoothing that the bars breathe instead of flickering, not
          // so much that they lag behind the voice.
          analyser.smoothingTimeConstant = 0.72;
          context.createMediaStreamSource(stream).connect(analyser);
          audioContextRef.current = context;
          analyserRef.current = analyser;
        }
      } catch {
        /* no meter; the recording is unaffected */
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const chunks = chunksRef.current;
        chunksRef.current = [];
        const discarded = discardRef.current;
        const recordedType = recorder.mimeType;
        releaseStream();

        if (!mountedRef.current || takeRef.current !== take || discarded) return;

        const audio = new Blob(chunks, { type: recordedType || "audio/webm" });
        if (audio.size === 0) {
          setState("idle");
          setError("Nothing was recorded. Hold the mic a moment longer.");
          return;
        }
        setState("transcribing");
        void transcribe(audio, take);
      };

      recorder.onerror = () => {
        releaseStream();
        if (!mountedRef.current || takeRef.current !== take) return;
        setState("idle");
        setError("The recording failed. Try again.");
      };

      recorder.start();

      // A forgotten open mic is a bill and a privacy problem, so a take has a
      // hard ceiling: it stops itself and transcribes what it has.
      stopTimerRef.current = window.setTimeout(() => {
        stopTimerRef.current = null;
        if (recorderRef.current?.state === "recording") {
          recorderRef.current.stop();
        }
      }, maxDurationMs);
    })();
  }, [disabled, maxDurationMs, releaseStream, state, supported, transcribe]);

  const stop = useCallback(() => {
    if (state !== "listening") return;
    const recorder = recorderRef.current;
    if (!recorder) {
      // getUserMedia is still resolving, so onstop will never fire for this
      // take. Abandon it; the async body sees the bumped counter and cleans up.
      takeRef.current += 1;
      setState("idle");
      return;
    }
    if (recorder.state === "recording") recorder.stop();
  }, [state]);

  const cancel = useCallback(() => {
    if (state === "idle") return;
    discardRef.current = true;
    takeRef.current += 1;
    try {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    } catch {
      /* already stopped */
    }
    releaseStream();
    setState("idle");
  }, [releaseStream, state]);

  const toggle = useCallback(() => {
    if (state === "listening") stop();
    else if (state === "idle") start();
  }, [start, state, stop]);

  const clearError = useCallback(() => setError(null), []);

  return {
    supported,
    state,
    busy: state !== "idle",
    error,
    unavailable,
    analyserRef,
    start,
    stop,
    toggle,
    cancel,
    clearError,
  };
}
