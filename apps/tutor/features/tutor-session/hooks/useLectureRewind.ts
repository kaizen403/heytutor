"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { WhiteboardHandle, CursorState } from "@heytutor/whiteboard";
import type { VerifiedDiagram } from "@heytutor/drawing";
import type { InkPace, TTSClient } from "@heytutor/tutor-core";
import type { TurnTelemetry } from "@/lib/obs/turnTelemetry";
import type { BoardEntry } from "@/lib/boards/types";
import type {
  RecordedSegmentPayload,
  StoredTurn,
} from "@/lib/boards/boardsClient";
import { stopReplayAudio } from "@/lib/replay/replayAudio";
import { createReplayAudioBlobUrl } from "@/lib/replay/replayTurns";
import type { ReplayCue } from "@/lib/replay/replayTimeline";
import {
  buildLectureTimeline,
  clampToLiveEdge,
  shouldEnterRewind,
} from "@/lib/replay/liveTimeline";
import type { SettingsState } from "@/features/tutor-session/components/SettingsDrawer";
import type { TutorPhase } from "../types";
import { waitForWhiteboard } from "../lib/whiteboardReady";
import { useBoardLayout } from "./useBoardLayout";
import { useCancelControl } from "./useCancelControl";
import { useCommandExecution } from "./useCommandExecution";
import { useReplay } from "./useReplay";

/** How often the live edge is re-measured while a lecture is running. */
const LIVE_EDGE_POLL_MS = 400;

export interface UseLectureRewindParams {
  sessionId: string;
  boards: BoardEntry[];
  /** Live lecture phase. Rewind is only offered while a lecture is running. */
  phase: TutorPhase;
  phaseRef: RefObject<TutorPhase>;
  isReplaying: boolean;
  storedTurnsRef: RefObject<StoredTurn[]>;
  /** Segments the in-progress turn has already taught. */
  recordedSegmentsRef: RefObject<RecordedSegmentPayload[]>;
  liveQuestionRef: RefObject<string>;
  speedRef: RefObject<number>;
  /** The live lesson's own pause flag — a rewind must not clear a pause it did not set. */
  livePausedRef: RefObject<boolean>;
  /**
   * Owned by the session so the turn runtime can read it synchronously: while
   * it is true the live lecture may not resume behind the student's back.
   */
  rewoundRef: RefObject<boolean>;
  setSettings: Dispatch<SetStateAction<SettingsState>>;
  pauseTurn: () => void;
  resumeTurn: () => void;
  enableKeyboardControls?: boolean;
  /** Off for the headless recorder: nobody is watching, so nothing is captured. */
  enabled?: boolean;
}

export interface LectureRewindApi {
  /** Handle for the overlay board the past is drawn on. */
  rewindBoardRef: RefObject<WhiteboardHandle | null>;
  /** True while the student is watching the past instead of the live board. */
  rewindActive: boolean;
  rewindPlaying: boolean;
  rewindProgressMs: number;
  rewindSegmentText: string;
  rewindCursorState: CursorState;
  /** End of everything taught so far — the live edge, and the scrub track's max. */
  liveEdgeMs: number;
  /** A live lecture with a past worth scrubbing back into. */
  canRewind: boolean;
  seekLecture: (ms: number) => void;
  toggleRewindPlayPause: () => void;
  /** Retunes the rewind's own audio and ink — the live elements are paused. */
  applyRewindSpeed: (rate: number) => void;
  goLive: () => void;
}

const noop = () => undefined;

/**
 * Time-shifted playback for a lecture that is still being taught.
 *
 * Scrubbing back pauses the live lecture and plays the recorded past on a
 * second whiteboard laid over the live one. The live board keeps its ink
 * untouched underneath — including the half-drawn segment the pause froze — so
 * rejoining is exact: drop the overlay and let the lecture carry on.
 *
 * Everything here is a second, isolated instance of the same runtime the live
 * lecture uses (layout, command execution, replay engine), wired to its own
 * refs so a rewind can never mutate live state.
 */
export function useLectureRewind({
  sessionId,
  boards,
  phase,
  phaseRef,
  isReplaying,
  storedTurnsRef,
  recordedSegmentsRef,
  liveQuestionRef,
  speedRef,
  livePausedRef,
  rewoundRef,
  setSettings,
  pauseTurn,
  resumeTurn,
  enableKeyboardControls = true,
  enabled = true,
}: UseLectureRewindParams): LectureRewindApi {
  const rewindBoardRef = useRef<WhiteboardHandle | null>(null);
  const rewindCancelRef = useRef(false);
  const rewindPausedRef = useRef(false);
  const rewindGenerationRef = useRef(0);
  const rewindCueRef = useRef<ReplayCue | null>(null);
  const rewindAudioRef = useRef<HTMLAudioElement | null>(null);
  const rewindAudioPreloadRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const rewindTurnsRef = useRef<StoredTurn[]>([]);
  const rewindQuestionRef = useRef("");
  const rewindFbdMarkedRef = useRef(false);
  const rewindFbdStartedRef = useRef(false);
  const rewindDiagramRef = useRef<VerifiedDiagram | null>(null);
  const rewindTelemetryRef = useRef<TurnTelemetry | null>(null);
  const rewindInkPaceRef = useRef<InkPace>("follow");
  const rewindAdaptiveFactorRef = useRef(1);
  /** Never populated: the past plays from captured audio, never from live TTS. */
  const rewindTtsClientRef = useRef<TTSClient | null>(null);
  /** Pinned to idle so the replay engine treats the overlay as a free board. */
  const rewindPhaseRef = useRef<TutorPhase>("idle");

  const [rewindActive, setRewindActive] = useState(false);
  const rewindActiveRef = rewoundRef;
  const [rewindPlaying, setRewindPlaying] = useState(false);
  const [rewindPaused, setRewindPaused] = useState(false);
  const [rewindProgressMs, setRewindProgressMs] = useState(0);
  const [rewindTotalMs, setRewindTotalMs] = useState(0);
  const [rewindSegmentText, setRewindSegmentText] = useState("");
  const [rewindPhase, setRewindPhase] = useState<TutorPhase>("idle");
  const [liveEdgeMs, setLiveEdgeMs] = useState(0);
  const liveEdgeMsRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  /** False when the student had already paused the lesson before scrubbing back. */
  const pausedByRewindRef = useRef(false);

  const lectureActive = enabled && phase !== "idle" && !isReplaying;
  const lectureActiveRef = useRef(lectureActive);
  useEffect(() => {
    lectureActiveRef.current = lectureActive;
  }, [lectureActive]);

  // --- live audio ---------------------------------------------------------
  // The in-progress turn's audio only exists as captured bytes. Mint one object
  // URL per segment and hold it until the turn is replaced, so re-measuring the
  // live edge four times a second does not leak a URL per tick.
  const liveAudioUrlsRef = useRef<Map<number, string>>(new Map());

  const releaseLiveAudioUrls = useCallback(() => {
    for (const url of liveAudioUrlsRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    liveAudioUrlsRef.current.clear();
  }, []);

  const liveAudioUrlFor = useCallback((segment: RecordedSegmentPayload) => {
    if (!segment.audioBytes || segment.audioBytes.length === 0) {
      return null;
    }
    const cached = liveAudioUrlsRef.current.get(segment.orderIndex);
    if (cached) {
      return cached;
    }
    const url = createReplayAudioBlobUrl(segment.audioBytes);
    liveAudioUrlsRef.current.set(segment.orderIndex, url);
    return url;
  }, []);

  const measureLiveEdge = useCallback(() => {
    const { turns, timeline } = buildLectureTimeline({
      storedTurns: storedTurnsRef.current,
      liveSegments: recordedSegmentsRef.current,
      liveQuestion: liveQuestionRef.current,
      audioUrlFor: liveAudioUrlFor,
    });
    rewindTurnsRef.current = turns;
    liveEdgeMsRef.current = timeline.totalMs;
    setLiveEdgeMs(timeline.totalMs);
  }, [storedTurnsRef, recordedSegmentsRef, liveQuestionRef, liveAudioUrlFor]);

  // --- rewind runtime -----------------------------------------------------
  const {
    cancellableDelay: rewindCancellableDelay,
    raceWithCancel: rewindRaceWithCancel,
    clearCancelTimers: clearRewindCancelTimers,
  } = useCancelControl(rewindCancelRef);

  const {
    boardLayoutRef: rewindLayoutRef,
    notesEpochsRef: rewindNotesEpochsRef,
    narrationSinceEpochRef: rewindNarrationRef,
    forceSequentialWorkLayoutRef: rewindSequentialRef,
    resetBoardLayout: resetRewindLayout,
    forgetErasedTextRects: forgetRewindErasedRects,
    resolveTextPlacement: resolveRewindTextPlacement,
  } = useBoardLayout({
    whiteboardRef: rewindBoardRef,
    cancelRef: rewindCancelRef,
    fbdPhaseStartedRef: rewindFbdStartedRef,
    liveQuestionRef: rewindQuestionRef,
    // The overlay is positioned by the live board's viewport; it never measures
    // a container of its own.
    viewportMode: "fixed",
  });

  const {
    executeCommand: executeRewindCommand,
    executeCommandWithCancel: executeRewindCommandWithCancel,
  } = useCommandExecution({
    whiteboardRef: rewindBoardRef,
    cancelRef: rewindCancelRef,
    speedRef,
    boardLayoutRef: rewindLayoutRef,
    forceSequentialWorkLayoutRef: rewindSequentialRef,
    fbdPhaseMarkedRef: rewindFbdMarkedRef,
    fbdPhaseStartedRef: rewindFbdStartedRef,
    activeVerifiedDiagramRef: rewindDiagramRef,
    turnTelemetryRef: rewindTelemetryRef,
    notesEpochsRef: rewindNotesEpochsRef,
    narrationSinceEpochRef: rewindNarrationRef,
    cancellableDelay: rewindCancellableDelay,
    forgetErasedTextRects: forgetRewindErasedRects,
    resetBoardLayout: resetRewindLayout,
    resolveTextPlacement: resolveRewindTextPlacement,
    raceWithCancel: rewindRaceWithCancel,
    inkPaceRef: rewindInkPaceRef,
    adaptiveFactorRef: rewindAdaptiveFactorRef,
  });

  const goLiveRef = useRef<() => void>(noop);

  const pauseRewind = useCallback(() => {
    if (rewindPausedRef.current) return;
    rewindPausedRef.current = true;
    setRewindPaused(true);
    rewindAudioRef.current?.pause();
    rewindBoardRef.current?.setPaused(true);
  }, []);

  const resumeRewind = useCallback(() => {
    if (!rewindPausedRef.current) return;
    rewindPausedRef.current = false;
    setRewindPaused(false);
    void rewindAudioRef.current?.play().catch(() => undefined);
    rewindBoardRef.current?.setPaused(false);
  }, []);

  const {
    playReplayFrom: playRewindFrom,
    seekReplay: seekRewind,
    toggleReplayPlayPause: toggleRewindPlayPause,
    handleReplaySpeedChange: applyRewindSpeed,
  } = useReplay({
    whiteboardRef: rewindBoardRef,
    cancelRef: rewindCancelRef,
    speedRef,
    isPausedRef: rewindPausedRef,
    replayAudioRef: rewindAudioRef,
    replayAudioPreloadRef: rewindAudioPreloadRef,
    storedTurnsRef: rewindTurnsRef,
    replayGenerationRef: rewindGenerationRef,
    replayCueRef: rewindCueRef,
    ttsClientRef: rewindTtsClientRef,
    notesEpochsRef: rewindNotesEpochsRef,
    narrationSinceEpochRef: rewindNarrationRef,
    liveQuestionRef: rewindQuestionRef,
    phaseRef: rewindPhaseRef,
    isReplaying: rewindPlaying,
    isPaused: rewindPaused,
    isDownloading: false,
    replayProgressMs: rewindProgressMs,
    boards,
    sessionId,
    setPhase: setRewindPhase,
    setCurrentSegmentText: setRewindSegmentText,
    // The live lesson owns the transcript; a rewind must not rewrite it.
    setNarrationText: noop,
    setIsPaused: setRewindPaused,
    setIsReplaying: setRewindPlaying,
    setReplayProgressMs: setRewindProgressMs,
    setReplayTotalMs: setRewindTotalMs,
    setSettings,
    setIsDownloading: noop,
    cancellableDelay: rewindCancellableDelay,
    raceWithCancel: rewindRaceWithCancel,
    executeCommandWithCancel: executeRewindCommandWithCancel,
    executeCommand: executeRewindCommand,
    resetBoardLayout: resetRewindLayout,
    // Reaching the live edge is not the end of the lecture — it is the present.
    finishLectureUi: () => goLiveRef.current(),
    pauseTurn: pauseRewind,
    resumeTurn: resumeRewind,
  });

  useEffect(() => {
    rewindPhaseRef.current = rewindPhase;
  }, [rewindPhase]);

  const playRewindFromRef = useRef(playRewindFrom);
  useEffect(() => {
    playRewindFromRef.current = playRewindFrom;
  }, [playRewindFrom]);

  // --- entering, leaving --------------------------------------------------
  const goLive = useCallback(() => {
    if (!rewindActiveRef.current) return;
    rewindActiveRef.current = false;

    // Retire this rewind generation before tearing anything down: the replay
    // loop checks it between cues and bails without touching the board again.
    rewindGenerationRef.current += 1;
    rewindCancelRef.current = true;
    clearRewindCancelTimers();

    stopReplayAudio(rewindAudioRef.current);
    rewindAudioRef.current = null;
    for (const preloaded of rewindAudioPreloadRef.current.values()) {
      stopReplayAudio(preloaded);
    }
    rewindAudioPreloadRef.current.clear();
    rewindCueRef.current = null;
    rewindPausedRef.current = false;
    pendingSeekRef.current = null;

    setRewindPaused(false);
    setRewindPlaying(false);
    setRewindSegmentText("");
    // Written straight through as well as through state: the replay engine
    // reads this ref to decide it may take the board, and a student can scrub
    // back again before React has flushed the effect that mirrors it.
    rewindPhaseRef.current = "idle";
    setRewindPhase("idle");
    setRewindActive(false);

    // The live board never lost its ink, so the lecture simply carries on from
    // the frame the rewind froze it at — unless the student had paused it
    // themselves before scrubbing back, in which case it stays paused.
    const shouldResume = pausedByRewindRef.current;
    pausedByRewindRef.current = false;
    if (shouldResume && phaseRef.current !== "idle") {
      resumeTurn();
    }
  }, [clearRewindCancelTimers, phaseRef, resumeTurn, rewindActiveRef]);

  useEffect(() => {
    goLiveRef.current = goLive;
  }, [goLive]);

  const enterRewind = useCallback(
    (ms: number) => {
      if (rewindActiveRef.current || !lectureActiveRef.current) return;
      const edge = liveEdgeMsRef.current;
      if (edge <= 0) return;

      // Freeze the lecture first: nothing may be added to the past while the
      // student is inside it.
      pausedByRewindRef.current = !livePausedRef.current;
      pauseTurn();
      rewindActiveRef.current = true;
      rewindCancelRef.current = false;
      rewindPausedRef.current = false;
      rewindGenerationRef.current += 1;
      rewindPhaseRef.current = "idle";
      resetRewindLayout(false, false);
      pendingSeekRef.current = clampToLiveEdge(ms, edge);
      setRewindPaused(false);
      setRewindProgressMs(pendingSeekRef.current);
      setRewindTotalMs(edge);
      setRewindActive(true);
    },
    [pauseTurn, resetRewindLayout, rewindActiveRef, livePausedRef],
  );

  /** One entry point for the scrub bar, whichever side of the live edge it is on. */
  const seekLecture = useCallback(
    (ms: number) => {
      if (rewindActiveRef.current) {
        if (!shouldEnterRewind(ms, liveEdgeMsRef.current)) {
          goLive();
          return;
        }
        const target = clampToLiveEdge(ms, liveEdgeMsRef.current);
        // Dragged again before the overlay board finished mounting: retarget
        // the pending start instead of seeking a player that has not begun.
        if (pendingSeekRef.current !== null) {
          pendingSeekRef.current = target;
          setRewindProgressMs(target);
          return;
        }
        seekRewind(target);
        return;
      }
      if (shouldEnterRewind(ms, liveEdgeMsRef.current)) {
        enterRewind(ms);
      }
    },
    [enterRewind, goLive, seekRewind, rewindActiveRef],
  );

  // Start playing the past once the overlay board has mounted its layers.
  useEffect(() => {
    if (!rewindActive) return;
    const target = pendingSeekRef.current;
    if (target === null) return;

    let abandoned = false;
    void (async () => {
      const ready = await waitForWhiteboard(rewindBoardRef);
      if (abandoned || !ready || !rewindActiveRef.current) return;
      pendingSeekRef.current = null;
      await playRewindFromRef.current(target);
    })();

    return () => {
      abandoned = true;
    };
  }, [rewindActive, rewindActiveRef]);

  // --- live edge tracking -------------------------------------------------
  useEffect(() => {
    if (!lectureActive) {
      // `liveEdgeMs` is read through `lectureActive` below, so the stale state
      // value never surfaces — no setState needed to retire it here.
      liveEdgeMsRef.current = 0;
      releaseLiveAudioUrls();
      return;
    }
    // While the student is in the past the lecture is frozen, so the edge is
    // too. Holding it still keeps the track under their thumb from moving.
    if (rewindActive) return;

    let lastSegmentCount = -1;
    let lastTurnCount = -1;

    const tick = () => {
      const segmentCount = recordedSegmentsRef.current.length;
      const turnCount = storedTurnsRef.current.length;
      if (segmentCount === lastSegmentCount && turnCount === lastTurnCount) {
        return;
      }
      // A shrinking segment list means a new question took the board; the
      // previous turn's captured audio is owned by the persisted turn now.
      if (segmentCount < lastSegmentCount) {
        releaseLiveAudioUrls();
      }
      lastSegmentCount = segmentCount;
      lastTurnCount = turnCount;
      measureLiveEdge();
    };

    tick();
    const timer = window.setInterval(tick, LIVE_EDGE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [
    lectureActive,
    rewindActive,
    measureLiveEdge,
    recordedSegmentsRef,
    releaseLiveAudioUrls,
    storedTurnsRef,
  ]);

  // A stopped or finished lecture has no live edge to rejoin — close the
  // overlay without resuming anything.
  useEffect(() => {
    if (rewindActive && !lectureActive) {
      goLive();
    }
  }, [rewindActive, lectureActive, goLive]);

  useEffect(() => {
    const preloadedAudio = rewindAudioPreloadRef.current;
    return () => {
      rewindGenerationRef.current += 1;
      rewindCancelRef.current = true;
      stopReplayAudio(rewindAudioRef.current);
      for (const preloaded of preloadedAudio.values()) {
        stopReplayAudio(preloaded);
      }
      preloadedAudio.clear();
      releaseLiveAudioUrls();
    };
  }, [releaseLiveAudioUrls]);

  // --- keyboard -----------------------------------------------------------
  useEffect(() => {
    if (!enableKeyboardControls || !rewindActive) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        goLive();
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        toggleRewindPlayPause();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enableKeyboardControls, rewindActive, goLive, toggleRewindPlayPause]);

  const reportedLiveEdgeMs = !lectureActive
    ? 0
    : rewindActive && rewindTotalMs > 0
      ? rewindTotalMs
      : liveEdgeMs;

  const rewindCursorState: CursorState = useMemo(() => {
    if (!rewindActive || rewindPaused) return "idle";
    return rewindPhase === "drawing" || rewindPhase === "speaking" ? "drawing" : "idle";
  }, [rewindActive, rewindPaused, rewindPhase]);

  return {
    rewindBoardRef,
    rewindActive,
    rewindPlaying: rewindPlaying && !rewindPaused,
    rewindProgressMs,
    rewindSegmentText,
    rewindCursorState,
    liveEdgeMs: reportedLiveEdgeMs,
    canRewind: lectureActive && reportedLiveEdgeMs > 0,
    seekLecture,
    toggleRewindPlayPause,
    applyRewindSpeed,
    goLive,
  };
}
