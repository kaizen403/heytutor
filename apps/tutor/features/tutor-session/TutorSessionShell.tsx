"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BoardHistory, SIDEBAR_WIDTH } from "@/features/tutor-session/components/BoardHistory";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  SettingsDrawer,
  DEFAULT_SETTINGS,
  getMarkerColorHex,
  type SettingsState,
  SPEED_MIN,
  SPEED_MAX,
  isMarkerColorId,
  isLessonDepth,
  isTutorAccent,
  isTutorAudioLanguage,
} from "@/features/tutor-session/components/SettingsDrawer";
import { toVoiceKey, type LessonDepth } from "@heytutor/tutor-core";
import {
  CanvasLanding,
  CanvasLandingDoodles,
} from "@/features/tutor-session/components/CanvasLanding";
import { type ReplayCue } from "@/lib/replay/replayTimeline";
import { resolveLecturePlayback } from "@/lib/replay/liveTimeline";
import type { WhiteboardHandle, CursorState } from "@heytutor/whiteboard";
import { useIsCompactNav, useIsMobile } from "@/lib/client/useMediaQuery";
import { ThinkingOverlay } from "./components/ThinkingOverlay";
import { PenSpinner } from "@heytutor/whiteboard/pen-spinner";
import { SessionInputChrome } from "./components/SessionInputChrome";
import { SessionHeader } from "./components/SessionHeader";
import { NotesChatSidebar } from "./components/NotesChatSidebar";
import { SessionBoardCanvas } from "./components/SessionBoardCanvas";
import { Whiteboard } from "./components/WhiteboardLoader";
import { useReplay } from "./hooks/useReplay";
import { useLectureRewind } from "./hooks/useLectureRewind";
import { useCommandExecution } from "./hooks/useCommandExecution";
import { useCancelControl } from "./hooks/useCancelControl";
import { useTurnLifecycle } from "./hooks/useTurnLifecycle";
import { useBoardLayout } from "./hooks/useBoardLayout";
import { useBoardSession } from "./hooks/useBoardSession";
import { useAdaptiveDrawSpeed } from "./hooks/useAdaptiveDrawSpeed";
import { useNotesChat } from "./hooks/useNotesChat";
import {
  type TutorSegment,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import {
  type InkPace,
  type TTSClient,
} from "@heytutor/tutor-core";
import { type TurnTelemetry } from "@/lib/obs/turnTelemetry";
import { type RecordedSegmentPayload } from "@/lib/boards/boardsClient";
import { liveNotesPayload } from "@/lib/boards/notesChatClient";
import {
  DEFAULT_REPLAY_SPEED,
  syncControlledPlaybackRate,
} from "@/lib/replay/replayAudio";
import {
  PAGE_GUTTER_X,
  PAGE_GUTTER_Y,
  NOTES_CHAT_RAIL_WIDTH,
  LANDING_SUGGESTIONS,
  BOARD_WIDTH,
  BOARD_HEIGHT,
} from "./constants";
import type { TutorPhase, SegmentPlanStats } from "./types";
import { createEmptySegmentPlanStats } from "./lib/segmentPlanning";
import { lessonFollowUpMode } from "./lib/lessonFollowUp";
import { buildLessonNotes } from "./lib/lessonNotes";
import { resolveActiveStatus } from "./lib/statusConfig";
import { canStartStoredLectureReplay } from "./lib/autoReplay";

const FAST_MODE_STORAGE_KEY = "htutor_fast_mode";
const SUBTITLES_STORAGE_KEY = "htutor_subtitles";
const SPEED_STORAGE_KEY = "htutor_speed";
const MARKER_COLOR_STORAGE_KEY = "htutor_marker_color";
const LESSON_DEPTH_STORAGE_KEY = "htutor_lesson_depth";
const AUDIO_LANGUAGE_STORAGE_KEY = "htutor_audio_language";
const ACCENT_STORAGE_KEY = "htutor_accent";
const NARRATION_STORAGE_KEY = "htutor_narration";
const LOW_LATENCY_STORAGE_KEY = "htutor_low_latency_voice";

function readStoredSetting(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredSetting(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / quota */
  }
}

export type TutorSessionVariant = "full" | "headless" | "embed";

export type TutorSessionError = {
  message: string;
  question: string;
};

export type TutorSessionShellProps = {
  sessionId: string;
  variant?: TutorSessionVariant;
  /** Submitted once the board and whiteboard are ready. */
  autoQuestion?: string;
  /** Start stored-turn replay once the board is restored. Used by `/c/{id}?replay=1`. */
  autoReplay?: boolean;
  /** Capture TTS bytes; do not play through speakers. Defaults on for `headless`. */
  muteAudio?: boolean;
  /** Controlled playback rate (admin Watch). Same model as student replay; default 1.5×. */
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
  onPhase?: (phase: TutorPhase) => void;
  /** Fired after the turn is persisted (and saved when `onComplete` is set). */
  onComplete?: () => void;
  onError?: (error: TutorSessionError) => void;
};

export function TutorSessionShell({
  sessionId,
  variant = "full",
  autoQuestion,
  autoReplay = false,
  muteAudio,
  playbackRate,
  onPlaybackRateChange,
  onPhase,
  onComplete,
  onError,
}: TutorSessionShellProps) {
  const router = useRouter();
  const isHeadless = variant === "headless";
  const isEmbed = variant === "embed";
  const mutePlayback = isHeadless ? (muteAudio ?? true) : (muteAudio ?? false);
  /** Admin Watch drives the rate through props; only the student's own choice persists. */
  const speedIsControlled = playbackRate !== undefined;

  const whiteboardRef = useRef<WhiteboardHandle>(null);
  const pendingQuestionRef = useRef<string | null>(null);
  const autoSubmitDoneRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<TutorPhase>("idle");
  const phaseRef = useRef<TutorPhase>("idle");
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [narrationText, setNarrationText] = useState("");
  const [currentSegmentText, setCurrentSegmentText] = useState("");
  const [lastError, setLastError] = useState<{ message: string; question: string } | null>(null);
  const ttsClientRef = useRef<TTSClient | null>(null);
  const replayAudioRef = useRef<HTMLAudioElement | null>(null);
  const replayAudioPreloadRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const cancelRef = useRef(false);
  const turnActiveRef = useRef(false);
  const turnGenerationRef = useRef(0);
  const turnAbortRef = useRef<AbortController | null>(null);
  const segmentChainRef = useRef(Promise.resolve());
  const drawChainRef = useRef(Promise.resolve());
  const collectedSegmentsRef = useRef<TutorSegment[]>([]);
  const recordedSegmentsRef = useRef<RecordedSegmentPayload[]>([]);
  const rawResponseRef = useRef("");
  const currentTraceIdRef = useRef<string | null>(null);
  const turnTelemetryRef = useRef<TurnTelemetry | null>(null);
  const turnStatsRef = useRef({ drawMs: 0, ttsChars: 0 });
  const [isDownloading, setIsDownloading] = useState(false);
  const fbdPhaseMarkedRef = useRef(false);
  const fbdPhaseStartedRef = useRef(false);
  const activeVerifiedDiagramRef = useRef<VerifiedDiagram | null>(null);
  const [activeVerifiedDiagram, setActiveVerifiedDiagram] = useState<VerifiedDiagram | null>(null);
  const segmentPlanStatsRef = useRef<SegmentPlanStats>(createEmptySegmentPlanStats());
  const stopTurnRef = useRef<(() => void) | null>(null);
  const pendingSegmentCountRef = useRef(0);
  const narrationDensityRef = useRef(0);
  const inkPaceRef = useRef<InkPace>("follow");
  const adaptiveFactorRef = useRef(1);
  const [settings, setSettings] = useState<SettingsState>({
    speedMultiplier: DEFAULT_REPLAY_SPEED,
    ...DEFAULT_SETTINGS,
  });
  const speedRef = useRef(DEFAULT_REPLAY_SPEED);
  const fastModeRef = useRef(true);
  const lessonDepthRef = useRef<LessonDepth>(DEFAULT_SETTINGS.lessonDepth);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [liveQuestion, setLiveQuestion] = useState("");
  const liveQuestionRef = useRef("");
  /** null = follow the automatic rule; true/false = the student decided. */
  const [notesOpenOverride, setNotesOpenOverride] = useState<boolean | null>(null);
  const isCompactNav = useIsCompactNav();
  const isMobile = useIsMobile();
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayProgressMs, setReplayProgressMs] = useState(0);
  const [replayTotalMs, setReplayTotalMs] = useState(0);
  const replayGenerationRef = useRef(0);
  const replayCueRef = useRef<ReplayCue | null>(null);
  /** True while the student has scrolled back into a lecture still in progress. */
  const rewoundRef = useRef(false);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    onPhase?.(phase);
  }, [phase, onPhase]);

  useEffect(() => {
    if (isHeadless || typeof window === "undefined") {
      return;
    }
    const overrides: Partial<SettingsState> = {};

    if (readStoredSetting(FAST_MODE_STORAGE_KEY) === "0") {
      overrides.fastMode = false;
      fastModeRef.current = false;
    }
    // Subtitles ship off; only an explicit opt-in turns them back on.
    if (readStoredSetting(SUBTITLES_STORAGE_KEY) === "1") {
      overrides.subtitlesEnabled = true;
    }
    const storedSpeed = Number(readStoredSetting(SPEED_STORAGE_KEY));
    if (
      !speedIsControlled &&
      Number.isFinite(storedSpeed) &&
      storedSpeed >= SPEED_MIN &&
      storedSpeed <= SPEED_MAX
    ) {
      overrides.speedMultiplier = storedSpeed;
    }
    const storedMarkerColor = readStoredSetting(MARKER_COLOR_STORAGE_KEY);
    if (isMarkerColorId(storedMarkerColor)) {
      overrides.markerColor = storedMarkerColor;
    }
    const storedDepth = readStoredSetting(LESSON_DEPTH_STORAGE_KEY);
    if (isLessonDepth(storedDepth)) {
      overrides.lessonDepth = storedDepth;
      lessonDepthRef.current = storedDepth;
    }
    const storedLanguage = readStoredSetting(AUDIO_LANGUAGE_STORAGE_KEY);
    if (isTutorAudioLanguage(storedLanguage)) {
      overrides.audioLanguage = storedLanguage;
    }
    const storedAccent = readStoredSetting(ACCENT_STORAGE_KEY);
    if (isTutorAccent(storedAccent)) {
      overrides.accent = storedAccent;
    }
    // Narration ships on; only an explicit opt-out silences it.
    if (readStoredSetting(NARRATION_STORAGE_KEY) === "0") {
      overrides.narrationEnabled = false;
    }
    if (readStoredSetting(LOW_LATENCY_STORAGE_KEY) === "1") {
      overrides.lowLatencyVoice = true;
    }

    if (Object.keys(overrides).length === 0) {
      return;
    }
    // Read after mount so SSR HTML stays the production default.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings((current) => ({ ...current, ...overrides }));
  }, [isHeadless, speedIsControlled]);

  useEffect(() => {
    fastModeRef.current = settings.fastMode;
    if (isHeadless || typeof window === "undefined") {
      return;
    }
    writeStoredSetting(FAST_MODE_STORAGE_KEY, settings.fastMode ? "1" : "0");
  }, [settings.fastMode, isHeadless]);

  useEffect(() => {
    if (isHeadless || typeof window === "undefined") {
      return;
    }
    writeStoredSetting(SUBTITLES_STORAGE_KEY, settings.subtitlesEnabled ? "1" : "0");
  }, [settings.subtitlesEnabled, isHeadless]);

  useEffect(() => {
    if (isHeadless || speedIsControlled || typeof window === "undefined") {
      return;
    }
    writeStoredSetting(SPEED_STORAGE_KEY, String(settings.speedMultiplier));
  }, [settings.speedMultiplier, isHeadless, speedIsControlled]);

  useEffect(() => {
    if (isHeadless || typeof window === "undefined") {
      return;
    }
    writeStoredSetting(MARKER_COLOR_STORAGE_KEY, settings.markerColor);
  }, [settings.markerColor, isHeadless]);

  useEffect(() => {
    lessonDepthRef.current = settings.lessonDepth;
    if (isHeadless || typeof window === "undefined") {
      return;
    }
    writeStoredSetting(LESSON_DEPTH_STORAGE_KEY, settings.lessonDepth);
  }, [settings.lessonDepth, isHeadless]);

  // Language/accent/latency reach the server as one voice key; the TTS client
  // reconnects on the next segment so the new voice is used.
  useEffect(() => {
    ttsClientRef.current?.setVoicePreferences?.({
      voiceKey: toVoiceKey(settings.audioLanguage, settings.accent),
      lowLatency: settings.lowLatencyVoice,
    });
    if (isHeadless || typeof window === "undefined") {
      return;
    }
    writeStoredSetting(AUDIO_LANGUAGE_STORAGE_KEY, settings.audioLanguage);
    writeStoredSetting(ACCENT_STORAGE_KEY, settings.accent);
    writeStoredSetting(LOW_LATENCY_STORAGE_KEY, settings.lowLatencyVoice ? "1" : "0");
  }, [
    settings.audioLanguage,
    settings.accent,
    settings.lowLatencyVoice,
    isHeadless,
  ]);

  useEffect(() => {
    // A headless/muted embed stays silent regardless of the student's choice.
    ttsClientRef.current?.setMuted?.(mutePlayback || !settings.narrationEnabled);
    if (isHeadless || typeof window === "undefined") {
      return;
    }
    writeStoredSetting(NARRATION_STORAGE_KEY, settings.narrationEnabled ? "1" : "0");
  }, [settings.narrationEnabled, mutePlayback, isHeadless]);

  // Keep AudioContext eligible for audible playback after long planning awaits.
  useEffect(() => {
    const handler = () => {
      ttsClientRef.current?.unlockAudio?.();
    };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart"];
    for (const event of events) {
      window.addEventListener(event, handler, { passive: true });
    }
    return () => {
      for (const event of events) {
        window.removeEventListener(event, handler);
      }
    };
  }, []);

  const skipInkRestoreRef = useRef(autoReplay);
  // Read only by the async board-detail restore, so an effect is soon enough.
  useEffect(() => {
    skipInkRestoreRef.current = autoReplay;
  }, [autoReplay]);

  const cursorState: CursorState =
    phase === "thinking" || phase === "planning"
      ? "thinking"
      : isReplaying || phase === "drawing" || phase === "speaking"
        ? "drawing"
        : "idle";

  const { cancellableDelay, raceWithCancel, clearCancelTimers } = useCancelControl(cancelRef);

  const {
    boardContainerRef,
    boardViewport,
    boardLayoutRef,
    notesEpochsRef,
    narrationSinceEpochRef,
    forceSequentialWorkLayoutRef,
    resetBoardLayout,
    beginBoardEpoch,
    captureNotesEpoch,
    forgetErasedTextRects,
    resolveTextPlacement,
    reserveTextCommandPlacement,
  } = useBoardLayout({
    whiteboardRef,
    cancelRef,
    fbdPhaseStartedRef,
    liveQuestionRef,
    viewportMode: isHeadless ? "fixed" : "fit",
  });

  // Adaptive drawing speed: polls audio lag + queue depth + narration density
  // and pushes a dynamic animation-speed factor to the whiteboard. Pedagogical
  // pace (follow vs scene) caps catch-up so formulas stay readable.
  useAdaptiveDrawSpeed({
    whiteboardRef,
    ttsClientRef,
    turnActiveRef,
    speedRef,
    pendingSegmentCountRef,
    narrationDensityRef,
    inkPaceRef,
    adaptiveFactorRef,
  });

  const { executeCommand, executeCommandWithCancel } = useCommandExecution({
    whiteboardRef,
    cancelRef,
    speedRef,
    boardLayoutRef,
    forceSequentialWorkLayoutRef,
    fbdPhaseMarkedRef,
    fbdPhaseStartedRef,
    activeVerifiedDiagramRef,
    turnTelemetryRef,
    notesEpochsRef,
    narrationSinceEpochRef,
    cancellableDelay,
    forgetErasedTextRects,
    resetBoardLayout,
    resolveTextPlacement,
    raceWithCancel,
    inkPaceRef,
    adaptiveFactorRef,
  });

  const handleRetraceEntity = useCallback((entityId: string) => {
    void executeCommand(
      {
        type: "FOCUS",
        params: [],
        text: entityId,
        charPosition: 0,
        narrationBefore: "",
      },
      { applyLayout: false, inkPace: "follow" },
    );
  }, [executeCommand]);

  const {
    boards,
    setBoards,
    boardLoaded,
    storedTurnsRef,
    storedTurnsCount,
    setStoredTurnsCount,
    conversationHistoryRef,
    inputInteracted,
    setInputInteracted,
    createNewBoard,
    startNextQuestion,
    switchBoard,
    deleteBoard,
    ensureTTSClient,
    registerReplayBlobUrl,
    revokeUnreferencedReplayBlobUrls,
    persistTurnForReplay,
  } = useBoardSession({
    sessionId,
    router,
    phase,
    speedMultiplier: settings.speedMultiplier,
    muted: mutePlayback || !settings.narrationEnabled,
    whiteboardRef,
    cancelRef,
    notesEpochsRef,
    narrationSinceEpochRef,
    liveQuestionRef,
    captureNotesEpoch,
    ttsClientRef,
    speedRef,
    stopTurnRef,
    replayAudioRef,
    replayAudioPreloadRef,
    setNarrationText,
    setCurrentSegmentText,
    resetBoardLayout,
    executeCommand,
    skipInkRestoreRef,
  });

  const {
    finishLectureUi,
    stopTurn,
    pauseTurn,
    resumeTurn,
    handleQuestion,
    handleAskDoubt,
  } = useTurnLifecycle({
    sessionId,
    autoQuestion,
    replaceAutoQuestionUrl: variant === "full",
    enableKeyboardControls: variant !== "headless",
    onComplete,
    onError,
    phase,
    isReplaying,
    boardLoaded,
    narrationText,
    boards,
    whiteboardRef,
    pendingQuestionRef,
    autoSubmitDoneRef,
    phaseRef,
    isPausedRef,
    rewoundRef,
    conversationHistoryRef,
    liveQuestionRef,
    ttsClientRef,
    replayAudioRef,
    replayAudioPreloadRef,
    cancelRef,
    turnActiveRef,
    turnGenerationRef,
    turnAbortRef,
    segmentChainRef,
    drawChainRef,
    collectedSegmentsRef,
    recordedSegmentsRef,
    storedTurnsRef,
    rawResponseRef,
    currentTraceIdRef,
    turnTelemetryRef,
    turnStatsRef,
    narrationSinceEpochRef,
    boardLayoutRef,
    fbdPhaseMarkedRef,
    fbdPhaseStartedRef,
    activeVerifiedDiagramRef,
    setActiveVerifiedDiagram,
    segmentPlanStatsRef,
    stopTurnRef,
    speedRef,
    fastModeRef,
    lessonDepthRef,
    pendingSegmentCountRef,
    narrationDensityRef,
    replayGenerationRef,
    replayCueRef,
    setPhase,
    setIsPaused,
    setNarrationText,
    setCurrentSegmentText,
    setLastError,
    setInputInteracted,
    setLiveQuestion,
    setIsReplaying,
    setReplayProgressMs,
    setReplayTotalMs,
    setStoredTurnsCount,
    setBoards,
    ensureTTSClient,
    executeCommandWithCancel,
    cancellableDelay,
    raceWithCancel,
    clearCancelTimers,
    resetBoardLayout,
    beginBoardEpoch,
    reserveTextCommandPlacement,
    persistTurnForReplay,
    registerReplayBlobUrl,
    revokeUnreferencedReplayBlobUrls,
  });

  const notesEnabled = !isEmbed && !isHeadless;
  const lectureInProgress = phase !== "idle" && !isReplaying;
  /*
   * These four refs are the live turn buffers: `useTurnControl` pushes a
   * segment into them for every spoken beat, on the audio-synced path. They
   * are refs precisely so that a segment arriving does not re-render the
   * shell — making them state would put a render between the voice and the
   * ink, which is the sync this board is built to protect.
   *
   * Reading them here is therefore deliberate, and safe: the dependency list
   * below carries a state mirror of each buffer's observable size
   * (`storedTurnsCount`, `narrationText`, `currentSegmentText`), so the notes
   * are rebuilt exactly when their contents have changed.
   */
  /* eslint-disable react-hooks/refs, react-hooks/exhaustive-deps -- see the note above */
  const lessonNotes = useMemo(
    () =>
      buildLessonNotes({
        persistedTurns: storedTurnsRef.current,
        lectureInProgress,
        live: lectureInProgress
          ? {
              question:
                liveQuestion || storedTurnsRef.current.at(-1)?.question || "",
              collectedSegments: collectedSegmentsRef.current,
              recordedSegments: recordedSegmentsRef.current,
              currentSegmentText,
              rawResponse: rawResponseRef.current,
              sceneArtifacts:
                storedTurnsRef.current.at(-1)?.question === liveQuestion
                  ? storedTurnsRef.current.at(-1)?.sceneArtifacts
                  : undefined,
            }
          : null,
      }),
    [
      currentSegmentText,
      lectureInProgress,
      liveQuestion,
      narrationText,
      sessionId,
      storedTurnsCount,
    ],
  );
  /* eslint-enable react-hooks/refs, react-hooks/exhaustive-deps */
  const {
    messages: notesMessages,
    sending: notesSending,
    error: notesError,
    send: sendNotesChat,
    stop: stopNotesChat,
  } = useNotesChat(sessionId, notesEnabled);

  // Switching boards is a fresh start: drop the draft question and hand the
  // notes rail back to the automatic rule. Adjusting state while rendering on
  // a changed input is the supported pattern; an effect here would render the
  // previous session's state first and then correct it.
  const [notesSessionId, setNotesSessionId] = useState(sessionId);
  if (notesSessionId !== sessionId) {
    setNotesSessionId(sessionId);
    setNotesOpenOverride(null);
    setLiveQuestion("");
  }

  const notesAutoOpen =
    notesEnabled && !isMobile && (phase !== "idle" || storedTurnsCount > 0);
  const notesOpen = notesOpenOverride ?? notesAutoOpen;
  const setNotesOpen = setNotesOpenOverride;

  const toggleNotes = () => {
    setNotesOpenOverride(!notesOpen);
  };

  const notesRailOpen = notesEnabled && notesOpen && !isMobile;

  const handleNotesChatSend = useCallback(
    (message: string) => {
      const liveTurn = lessonNotes.turns[lessonNotes.turns.length - 1] ?? null;
      void sendNotesChat(message, liveNotesPayload(liveTurn), lectureInProgress);
    },
    [lectureInProgress, lessonNotes, sendNotesChat],
  );

  const {
    replayLecture,
    downloadNotesPdf,
    seekReplay,
    toggleReplayPlayPause,
    handleReplaySpeedChange: applyReplaySpeed,
  } = useReplay({
    whiteboardRef,
    cancelRef,
    speedRef,
    isPausedRef,
    replayAudioRef,
    replayAudioPreloadRef,
    storedTurnsRef,
    replayGenerationRef,
    replayCueRef,
    ttsClientRef,
    notesEpochsRef,
    narrationSinceEpochRef,
    liveQuestionRef,
    phaseRef,
    isReplaying,
    isPaused,
    isDownloading,
    replayProgressMs,
    boards,
    sessionId,
    setPhase,
    setCurrentSegmentText,
    setNarrationText,
    setIsPaused,
    setIsReplaying,
    setReplayProgressMs,
    setReplayTotalMs,
    setSettings,
    setIsDownloading,
    cancellableDelay,
    raceWithCancel,
    executeCommandWithCancel,
    executeCommand,
    resetBoardLayout,
    finishLectureUi,
    pauseTurn,
    resumeTurn,
  });

  const {
    rewindBoardRef,
    rewindActive,
    rewindPlaying,
    rewindProgressMs,
    rewindSegmentText,
    rewindCursorState,
    liveEdgeMs,
    canRewind,
    seekLecture,
    toggleRewindPlayPause,
    applyRewindSpeed,
    goLive,
  } = useLectureRewind({
    sessionId,
    boards,
    phase,
    phaseRef,
    isReplaying,
    storedTurnsRef,
    recordedSegmentsRef,
    liveQuestionRef,
    speedRef,
    livePausedRef: isPausedRef,
    rewoundRef,
    setSettings,
    pauseTurn,
    resumeTurn,
    enableKeyboardControls: variant !== "headless",
    enabled: !isHeadless,
  });

  // One scrub bar, two timelines behind it: a finished lecture end to end, or
  // a running one that stops at the live edge.
  const {
    mode: playbackMode,
    visible: showPlaybackControls,
    playing: playbackPlaying,
  } = resolveLecturePlayback({
    isHeadless,
    isReplaying,
    isPaused,
    rewindActive,
    rewindPlaying,
    canRewind,
  });

  const handlePlaybackSeek = useCallback(
    (ms: number) => {
      if (isReplaying) {
        seekReplay(ms);
        return;
      }
      seekLecture(ms);
    },
    [isReplaying, seekReplay, seekLecture],
  );

  const handlePlaybackPlayPause = useCallback(() => {
    if (isReplaying) {
      toggleReplayPlayPause();
      return;
    }
    if (rewindActive) {
      toggleRewindPlayPause();
    }
  }, [isReplaying, rewindActive, toggleReplayPlayPause, toggleRewindPlayPause]);

  /**
   * The lesson chrome's pause button while rewound means "take me back to the
   * lecture" — the live turn cannot resume under a board showing the past.
   */
  const handleLessonPauseToggle = useCallback(() => {
    if (rewindActive) {
      goLive();
      return;
    }
    if (isPaused) {
      resumeTurn();
    } else {
      pauseTurn();
    }
  }, [rewindActive, goLive, isPaused, resumeTurn, pauseTurn]);

  const handleReplaySpeedChange = (rate: number) => {
    // While rewound it is the overlay's audio and ink that are playing; the
    // live elements are paused and would only be retuned on the way back.
    if (rewindActive) {
      applyRewindSpeed(rate);
    } else {
      applyReplaySpeed(rate);
    }
    onPlaybackRateChange?.(rate);
  };

  useEffect(() => {
    syncControlledPlaybackRate(playbackRate, speedRef.current, applyReplaySpeed);
  }, [playbackRate, applyReplaySpeed]);

  const autoReplayStartedRef = useRef(false);
  useEffect(() => {
    autoReplayStartedRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (!autoReplay) {
      autoReplayStartedRef.current = false;
    }
  }, [autoReplay]);

  useEffect(() => {
    if (
      !canStartStoredLectureReplay({
        autoReplay,
        isHeadless,
        boardLoaded,
        storedTurnsCount,
        isReplaying,
        alreadyStarted: autoReplayStartedRef.current,
        viewportMeasured: boardViewport.measured,
      })
    ) {
      return;
    }
    if (!replayLecture()) {
      return;
    }
    autoReplayStartedRef.current = true;
  }, [
    autoReplay,
    isHeadless,
    boardLoaded,
    storedTurnsCount,
    isReplaying,
    replayLecture,
    storedTurnsRef,
    boardViewport.measured,
    boardViewport.scale,
  ]);

  const stopTurnOnUnmountRef = useRef(stopTurn);
  useEffect(() => {
    stopTurnOnUnmountRef.current = stopTurn;
  }, [stopTurn]);
  useEffect(() => {
    return () => {
      stopTurnOnUnmountRef.current();
    };
  }, []);

  if (isHeadless) {
    return (
      <div
        ref={boardContainerRef}
        data-tutor-session="headless"
        style={{
          position: "relative",
          width: BOARD_WIDTH,
          height: BOARD_HEIGHT,
          flexShrink: 0,
        }}
      >
        <Whiteboard
          ref={whiteboardRef}
          width={BOARD_WIDTH}
          height={BOARD_HEIGHT}
          cursorState={cursorState}
          inkColor={getMarkerColorHex(settings.markerColor)}
        />
        {phase === "planning" && (
          <ThinkingOverlay message="planning the diagram…" />
        )}
        {phase === "thinking" && <ThinkingOverlay />}
      </div>
    );
  }

  const activeStatus = resolveActiveStatus(phase, isReplaying, isPaused, rewindActive);

  const activeBoard = boards.find((b) => b.id === sessionId);
  const activeBoardTitle = activeBoard?.title ?? "";
  const canReplay = phase === "idle" && storedTurnsCount > 0 && !isReplaying;
  const canDownload = phase === "idle" && storedTurnsCount > 0 && !isReplaying;
  const isInputOverlay = !isEmbed && phase === "idle" && boardLoaded && !inputInteracted;
  const inputSubmitMode = lessonFollowUpMode(storedTurnsCount > 0);
  const showBoardLoading = !boardLoaded;

  const inputChrome = (
    <SessionInputChrome
      isInputOverlay={isInputOverlay}
      phase={phase}
      isPaused={isPaused}
      inputSubmitMode={inputSubmitMode}
      onSubmit={storedTurnsCount > 0 ? startNextQuestion : handleQuestion}
      onAskDoubt={handleAskDoubt}
      onPauseToggle={handleLessonPauseToggle}
      onCancel={stopTurn}
      onUserInteractionChange={setInputInteracted}
      onOpenSettings={() => setSettingsOpen(true)}
    />
  );

  const showEmptyLanding = isInputOverlay && storedTurnsCount === 0;
  const fullBleedLanding = showEmptyLanding;
  const framePad = isCompactNav ? 20 : 32;

  return (
    <div
      className={
        isEmbed
          ? "relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
          : "relative flex h-dvh max-h-dvh min-w-0 overflow-hidden"
      }
      data-tutor-session={isEmbed ? "embed" : "full"}
      style={{
        background: "var(--wb-bg)",
      }}
    >
      {!isEmbed ? (
        <>
          <BoardHistory
            boards={boards}
            activeBoardId={sessionId}
            busyBoardId={phase !== "idle" || isReplaying ? sessionId : null}
            onSelect={switchBoard}
            onNew={createNewBoard}
            onDelete={deleteBoard}
            disabled={phase !== "idle"}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            onWidthChange={setSidebarWidth}
            onResizingChange={setSidebarResizing}
            onOpenSettings={() => setSettingsOpen(true)}
          />

          <BoardHistory
            busyBoardId={phase !== "idle" || isReplaying ? sessionId : null}
            variant="drawer"
            open={mobileNavOpen}
            onOpenChange={setMobileNavOpen}
            boards={boards}
            activeBoardId={sessionId}
            onSelect={switchBoard}
            onNew={createNewBoard}
            onDelete={deleteBoard}
            disabled={phase !== "idle"}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </>
      ) : null}

      {notesRailOpen ? (
        <div
          className="flex"
          style={{
            position: "fixed",
            right: 0,
            top: 0,
            zIndex: 40,
            width: NOTES_CHAT_RAIL_WIDTH,
            height: "100dvh",
            borderLeft: "1px solid rgba(242, 242, 244, 0.08)",
          }}
        >
          <NotesChatSidebar
            notes={lessonNotes}
            messages={notesMessages}
            sending={notesSending}
            error={notesError}
            onClose={toggleNotes}
            onSend={handleNotesChatSend}
            onStop={stopNotesChat}
          />
        </div>
      ) : null}

      {notesEnabled ? (
        <Sheet open={isMobile && notesOpen} onOpenChange={(open) => {
          setNotesOpen(open);
        }}>
          <SheetContent
            side="right"
            className="w-[min(100%,380px)] border-l border-[rgba(242,242,244,0.08)] p-0 sm:max-w-[380px]"
          >
            <SheetTitle className="sr-only">Ask me anything</SheetTitle>
            <NotesChatSidebar
              notes={lessonNotes}
              messages={notesMessages}
              sending={notesSending}
              error={notesError}
              onSend={handleNotesChatSend}
              onStop={stopNotesChat}
            />
          </SheetContent>
        </Sheet>
      ) : null}

      <div
        className={`relative z-10 flex min-h-0 min-w-0 flex-1 flex-col ${
          isEmbed ? "h-full" : ""
        } ${
          isEmbed ? "" : "md:mr-[var(--tutor-notes-width)] md:ml-[var(--tutor-sidebar-width)]"
        }`}
        style={{
          ["--tutor-sidebar-width" as string]:
            isEmbed || sidebarCollapsed ? "0px" : `${sidebarWidth}px`,
          ["--tutor-notes-width" as string]: notesRailOpen
            ? `${NOTES_CHAT_RAIL_WIDTH}px`
            : "0px",
          paddingLeft: `max(${PAGE_GUTTER_X}px, env(safe-area-inset-left))`,
          paddingRight: `max(${PAGE_GUTTER_X}px, env(safe-area-inset-right))`,
          paddingTop: `max(12px, env(safe-area-inset-top))`,
          paddingBottom: `max(12px, env(safe-area-inset-bottom))`,
          transition: sidebarResizing
            ? "none"
            : "margin-left 0.25s cubic-bezier(0.16, 1, 0.3, 1), margin-right 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {!isEmbed ? (
          <SessionHeader
            showNavButton
            navButtonClassName={sidebarCollapsed ? undefined : "md:hidden"}
            onExpandSidebar={() => {
              if (isMobile) {
                setMobileNavOpen(true);
                return;
              }
              setSidebarCollapsed(false);
            }}
            boardTitle={activeBoardTitle}
            canReplay={canReplay}
            canDownload={canDownload}
            isReplaying={isReplaying}
            isDownloading={isDownloading}
            phase={phase}
            activeStatus={activeStatus}
            compactActions={isCompactNav}
            notesOpen={notesOpen}
            showNotesToggle={notesEnabled}
            onToggleNotes={toggleNotes}
            onReplay={replayLecture}
            onDownload={downloadNotesPdf}
            onStop={stopTurn}
          />
        ) : null}

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={boardContainerRef}
            className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden"
            style={{
              marginTop: PAGE_GUTTER_Y,
            }}
          >
            {fullBleedLanding && (
              <div className="absolute inset-0 z-20 flex flex-col overflow-y-auto overscroll-contain rounded-2xl border border-[rgba(242,242,244,0.08)] bg-[#0B0B0C]">
                <div className="flex min-h-full w-full flex-col [justify-content:safe_center] px-4 py-6 sm:px-8 sm:py-10">
                  <CanvasLanding
                    suggestions={LANDING_SUGGESTIONS}
                    onSubmit={(question) => void handleQuestion(question)}
                    onOpenSettings={() => setSettingsOpen(true)}
                  />
                </div>
                <CanvasLandingDoodles />
              </div>
            )}

            <div
              className={`wb-frame relative max-w-full ${
                fullBleedLanding ? "pointer-events-none invisible absolute" : ""
              }`}
              style={{
                width: BOARD_WIDTH * boardViewport.scale + framePad,
                height: BOARD_HEIGHT * boardViewport.scale + framePad,
                maxWidth: "100%",
              }}
              aria-hidden={fullBleedLanding || undefined}
            >
            <div className="wb-surface absolute overflow-hidden">
            {isInputOverlay && !fullBleedLanding && (
              <div
                className="pointer-events-none absolute inset-0 z-10"
                style={{
                  backgroundColor: "rgba(13, 17, 23, 0.55)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                }}
              />
            )}

            {showBoardLoading && (
              <div
                className="absolute inset-0 z-30 flex items-center justify-center"
                style={{
                  backgroundColor: "rgba(13, 17, 23, 0.55)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                }}
              >
                <div className="flex flex-col items-center gap-3">
                  <PenSpinner size={44} ink="#C9C9D2" label="Loading board" />
                  <p className="text-sm text-[#A6A6AE]">Loading board…</p>
                </div>
              </div>
            )}

            {isEmbed && boardLoaded && storedTurnsCount === 0 ? (
              <div className="absolute inset-0 z-20 flex items-center justify-center">
                <p className="text-sm text-[#A6A6AE]">No saved lecture on this board.</p>
              </div>
            ) : null}

            {isInputOverlay && storedTurnsCount > 0 && (
              <div
                className="absolute inset-0 z-20 flex flex-col items-center justify-center px-3 sm:px-4"
                style={{ pointerEvents: "none" }}
              >
                <div className="w-full max-w-[720px]" style={{ pointerEvents: "auto" }}>
                  {inputChrome}
                </div>
              </div>
            )}

            {/* The live turn may well be thinking about its next step, but the
                student is looking at an earlier part of the lecture — don't
                curtain off the board they are actually watching. */}
            {phase === "planning" && !rewindActive && (
              <ThinkingOverlay message="planning the diagram…" />
            )}

            {phase === "thinking" && !rewindActive && <ThinkingOverlay />}

            <SessionBoardCanvas
              boardViewport={boardViewport}
              whiteboardRef={whiteboardRef}
              cursorState={cursorState}
              settings={settings}
              phase={phase}
              currentSegmentText={currentSegmentText}
              lastError={lastError}
              isReplaying={isReplaying}
              replayProgressMs={isReplaying ? replayProgressMs : rewindProgressMs}
              replayTotalMs={replayTotalMs}
              playbackMode={playbackMode}
              playbackPlaying={playbackPlaying}
              showPlaybackControls={showPlaybackControls}
              liveEdgeMs={liveEdgeMs}
              rewindBoardRef={rewindBoardRef}
              rewindActive={rewindActive}
              rewindCursorState={rewindCursorState}
              rewindSegmentText={rewindSegmentText}
              verifiedDiagram={activeVerifiedDiagram}
              onRetraceEntity={handleRetraceEntity}
              onRetryError={(question) => {
                setLastError(null);
                void handleQuestion(question);
              }}
              onDismissError={() => setLastError(null)}
              onReplayPlayPause={handlePlaybackPlayPause}
              onReplaySeek={handlePlaybackSeek}
              onReplaySpeedChange={handleReplaySpeedChange}
              onGoLive={goLive}
              onStop={stopTurn}
            />
            </div>
            </div>
          </div>
        </main>

        {!isEmbed && !isInputOverlay && (
          <footer
            className="relative shrink-0"
            style={{ paddingTop: PAGE_GUTTER_Y }}
          >
            {inputChrome}
          </footer>
        )}

        {!isEmbed ? (
          <SettingsDrawer
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            settings={settings}
            onSettingsChange={setSettings}
          />
        ) : null}
      </div>
    </div>
  );
}
