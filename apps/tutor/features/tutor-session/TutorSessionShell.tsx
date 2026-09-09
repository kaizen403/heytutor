"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  isTutorAccent,
  isTutorAudioLanguage,
} from "@/features/tutor-session/components/SettingsDrawer";
import {
  familiarityFromStoredValue,
  toVoiceKey,
  type SubjectFamiliarity,
  type TutorVoicePreferences,
} from "@heytutor/tutor-core";
import {
  CanvasLanding,
  CanvasLandingDoodles,
} from "@/features/tutor-session/components/CanvasLanding";
import { LandingPixelField } from "@/features/tutor-session/components/LandingPixelField";
import { type ReplayCue } from "@/lib/replay/replayTimeline";
import type { WhiteboardHandle, CursorState } from "@heytutor/whiteboard";
import { useIsCompactNav, useIsMobile } from "@/lib/client/useMediaQuery";
import { ThinkingOverlay } from "./components/ThinkingOverlay";
import { BoardBootSpinner } from "./components/BoardBootSpinner";
import { SessionInputChrome } from "./components/SessionInputChrome";
import { SessionHeader } from "./components/SessionHeader";
import { NotesChatSidebar } from "./components/NotesChatSidebar";
import { SessionBoardCanvas } from "./components/SessionBoardCanvas";
import { Whiteboard } from "./components/WhiteboardLoader";
import { CodeLessonPanel } from "./components/CodeLessonPanel";
import { CodeLessonController } from "./lib/code-lesson/codeLessonController";
import { useReplay } from "./hooks/useReplay";
import { useLectureRewind } from "./hooks/useLectureRewind";
import { useLecturePageHalt } from "./hooks/useLecturePageHalt";
import { useLectureExport } from "./hooks/useLectureExport";
import { useBoardMarking } from "./hooks/useBoardMarking";
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
import type { LectureExportProgress } from "@/lib/lecture-export/exportLectureMp4";
import type { TutorPhase, SegmentPlanStats } from "./types";
import { createEmptySegmentPlanStats } from "./lib/turn/segmentPlanning";
import { lessonFollowUpMode } from "./lib/turn/lessonFollowUp";
import { buildLessonNotes } from "./lib/notes/lessonNotes";
import { buildMarkedDoubtPrompt } from "./lib/board/boardMarking";
import type { NotesChatTag } from "./lib/notes/notesChatTag";
import { canStartStoredLectureReplay } from "./lib/replay/autoReplay";

const FAST_MODE_STORAGE_KEY = "htutor_fast_mode";
const SUBTITLES_STORAGE_KEY = "htutor_subtitles";
const SPEED_STORAGE_KEY = "htutor_speed";
const MARKER_COLOR_STORAGE_KEY = "htutor_marker_color";
/** Held its old name so a returning student keeps the level they chose. */
const FAMILIARITY_STORAGE_KEY = "htutor_lesson_depth";
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

/** The student Download / Replay actions, published so admin Watch can offer them. */
export type TutorSessionExportApi = {
  canReplay: boolean;
  canDownload: boolean;
  canDownloadLecture: boolean;
  isReplaying: boolean;
  isDownloading: boolean;
  isExportingLecture: boolean;
  lectureExportProgress: LectureExportProgress | null;
  lectureExportError: string | null;
  replayLecture: () => boolean;
  downloadNotesPdf: () => void;
  downloadLectureMp4: () => void;
  cancelLectureExport: () => void;
};

export type TutorSessionShellProps = {
  sessionId: string;
  /** Home board: a real board with no database row and no `/c/` URL until the first question. */
  isDraft?: boolean;
  /** Mint a fresh home board and route to it, optionally carrying a question to auto-submit. */
  onStartDraftBoard?: (question?: string) => void;
  variant?: TutorSessionVariant;
  /** Submitted once the board and whiteboard are ready. */
  autoQuestion?: string;
  /** Start stored-turn replay once the board is restored. Used by `/c/{id}?replay=1`. */
  autoReplay?: boolean;
  /** Capture TTS bytes; do not play through speakers. Defaults on for `headless`. */
  muteAudio?: boolean;
  /** Controlled playback rate (admin Watch). Same model as student replay; default 1.5×. */
  playbackRate?: number;
  onPhase?: (phase: TutorPhase) => void;
  /** Fired after the turn is persisted (and saved when `onComplete` is set). */
  onComplete?: () => void;
  onError?: (error: TutorSessionError) => void;
  /** Admin Watch (and other embeds) mount the same Replay / Notes PDF / MP4 actions. */
  onExportApi?: (api: TutorSessionExportApi | null) => void;
  /**
   * Slot on the deck between the board and the transport bar, full width of the
   * board column. Outside `.wb-frame`, so its contents render at natural scale
   * rather than inside the board's transform — which is what a surface needs
   * when the board is scaled down too far to read (the DSA code panel on
   * mobile). Pass `null` to collapse the slot to nothing.
   *
   * Anything mounted here shares height with the board: `boardContainerRef` is
   * on the parent, so a node that grows shrinks `boardViewport.scale`, which
   * resizes the frame, which changes the space left for the node. Give it a
   * height that does not derive from its own content.
   */
  belowBoardPanel?: ReactNode;
};

export function TutorSessionShell({
  sessionId,
  isDraft = false,
  onStartDraftBoard,
  variant = "full",
  autoQuestion,
  autoReplay = false,
  muteAudio,
  playbackRate,
  onPhase,
  onComplete,
  onError,
  onExportApi,
  belowBoardPanel,
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
  // Persist writes must wait until stored values are applied, otherwise the
  // first paint writes defaults and clobbers language/speed/colour on reload.
  // Headless boards have no stored settings to hydrate, so they start hydrated.
  const [settingsHydrated, setSettingsHydrated] = useState(isHeadless);
  const voicePreferencesRef = useRef<TutorVoicePreferences>({
    voiceKey: toVoiceKey(DEFAULT_SETTINGS.audioLanguage, DEFAULT_SETTINGS.accent),
    lowLatency: DEFAULT_SETTINGS.lowLatencyVoice,
  });
  const speedRef = useRef(DEFAULT_REPLAY_SPEED);
  const fastModeRef = useRef(true);
  const familiarityRef = useRef<SubjectFamiliarity>(DEFAULT_SETTINGS.familiarity);
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
  // Written by the session hooks; nothing reads it since the transport went.
  const [, setReplayTotalMs] = useState(0);
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
    // Reads back a pre-rename "concise|standard|thorough" as its level.
    const storedLevel = familiarityFromStoredValue(readStoredSetting(FAMILIARITY_STORAGE_KEY));
    if (storedLevel) {
      overrides.familiarity = storedLevel;
      familiarityRef.current = storedLevel;
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

    if (Object.keys(overrides).length > 0) {
      // Read after mount so SSR HTML stays the production default.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettings((current) => ({ ...current, ...overrides }));
    }
    const language = overrides.audioLanguage ?? DEFAULT_SETTINGS.audioLanguage;
    const accent = overrides.accent ?? DEFAULT_SETTINGS.accent;
    const lowLatency = overrides.lowLatencyVoice ?? DEFAULT_SETTINGS.lowLatencyVoice;
    voicePreferencesRef.current = {
      voiceKey: toVoiceKey(language, accent),
      lowLatency,
    };
    setSettingsHydrated(true);
  }, [isHeadless, speedIsControlled]);

  useEffect(() => {
    fastModeRef.current = settings.fastMode;
    if (!settingsHydrated || isHeadless || typeof window === "undefined") {
      return;
    }
    writeStoredSetting(FAST_MODE_STORAGE_KEY, settings.fastMode ? "1" : "0");
  }, [settings.fastMode, isHeadless, settingsHydrated]);

  useEffect(() => {
    if (!settingsHydrated || isHeadless || typeof window === "undefined") {
      return;
    }
    writeStoredSetting(SUBTITLES_STORAGE_KEY, settings.subtitlesEnabled ? "1" : "0");
  }, [settings.subtitlesEnabled, isHeadless, settingsHydrated]);

  useEffect(() => {
    if (!settingsHydrated || isHeadless || speedIsControlled || typeof window === "undefined") {
      return;
    }
    writeStoredSetting(SPEED_STORAGE_KEY, String(settings.speedMultiplier));
  }, [settings.speedMultiplier, isHeadless, speedIsControlled, settingsHydrated]);

  useEffect(() => {
    if (!settingsHydrated || isHeadless || typeof window === "undefined") {
      return;
    }
    writeStoredSetting(MARKER_COLOR_STORAGE_KEY, settings.markerColor);
  }, [settings.markerColor, isHeadless, settingsHydrated]);

  useEffect(() => {
    familiarityRef.current = settings.familiarity;
    if (!settingsHydrated || isHeadless || typeof window === "undefined") {
      return;
    }
    writeStoredSetting(FAMILIARITY_STORAGE_KEY, settings.familiarity);
  }, [settings.familiarity, isHeadless, settingsHydrated]);

  // Language/accent/latency reach the server as one voice key; the TTS client
  // reconnects on the next segment so the new voice is used.
  useEffect(() => {
    if (!settingsHydrated) {
      return;
    }
    const voicePreferences: TutorVoicePreferences = {
      voiceKey: toVoiceKey(settings.audioLanguage, settings.accent),
      lowLatency: settings.lowLatencyVoice,
    };
    voicePreferencesRef.current = voicePreferences;
    ttsClientRef.current?.setVoicePreferences?.(voicePreferences);
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
    settingsHydrated,
  ]);

  useEffect(() => {
    // A headless/muted embed stays silent regardless of the student's choice.
    ttsClientRef.current?.setMuted?.(mutePlayback || !settings.narrationEnabled);
    if (!settingsHydrated || isHeadless || typeof window === "undefined") {
      return;
    }
    writeStoredSetting(NARRATION_STORAGE_KEY, settings.narrationEnabled ? "1" : "0");
  }, [settings.narrationEnabled, mutePlayback, isHeadless, settingsHydrated]);

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

  /*
    A live turn keeps the marker on `thinking` so it stays visible and runs
    the spin that is already on the whiteboard. `idle` is opacity 0 — that
    is only for after a turn finishes.

    Speaking and drawing used to map to `drawing` here. The React prop then
    overwrote every imperative walk the moment TTS started, so the close of
    a code lesson left a still (or invisible) pen while the tutor kept talking.
  */
  const cursorState: CursorState =
    phase === "idle" && !isReplaying
      ? "idle"
      : isReplaying
        ? "drawing"
        : "thinking";

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
    reserveTextCommandPlacements,
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

  // The code-lesson controller lives outside React state (like the whiteboard
  // handle) so tutor typing never re-renders the shell per character.
  const [codeLessonController] = useState(() => new CodeLessonController());
  const codeLessonControllerRef = useRef<CodeLessonController | null>(codeLessonController);

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
    codeLessonControllerRef,
    setActiveVerifiedDiagram,
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
    togglePinBoard,
    toggleArchiveBoard,
    renameBoard,
    commitDraftBoard,
    ensureTTSClient,
    registerReplayBlobUrl,
    revokeUnreferencedReplayBlobUrls,
    persistTurnForReplay,
  } = useBoardSession({
    sessionId,
    isDraft,
    startDraftBoard: onStartDraftBoard,
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
    voicePreferencesRef,
    speedRef,
    stopTurnRef,
    replayAudioRef,
    replayAudioPreloadRef,
    setNarrationText,
    setCurrentSegmentText,
    resetBoardLayout,
    executeCommand,
    skipInkRestoreRef,
    codeLessonControllerRef,
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
    isDraft,
    commitDraftBoard,
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
    codeLessonControllerRef,
    segmentPlanStatsRef,
    stopTurnRef,
    speedRef,
    fastModeRef,
    familiarityRef,
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
    reserveTextCommandPlacements,
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

  /*
    The Ask panel stays tucked until it is asked for. It used to open itself as
    soon as a lesson started, which took a third of the screen away from the
    board at exactly the moment the board mattered most, and did it as a slide
    from the right that the student had not triggered. The pull tab on the
    right edge is now the only way in on desktop.
  */
  const notesOpen = notesOpenOverride ?? false;
  const setNotesOpen = setNotesOpenOverride;

  const toggleNotes = () => {
    setNotesOpenOverride(!notesOpen);
  };

  const notesRailOpen = notesEnabled && notesOpen && !isMobile;

  const handleNotesChatSend = useCallback(
    (message: string, tag: NotesChatTag | null = null) => {
      const liveTurn = lessonNotes.turns[lessonNotes.turns.length - 1] ?? null;
      void sendNotesChat(message, liveNotesPayload(liveTurn), lectureInProgress, tag);
    },
    [lectureInProgress, lessonNotes, sendNotesChat],
  );

  const {
    replayLecture,
    downloadNotesPdf,
    handleReplaySpeedChange: applyReplaySpeed,
  } = useReplay({
    whiteboardRef,
    cancelRef,
    speedRef,
    isPausedRef,
    replayAudioRef,
    replayAudioPreloadRef,
    storedTurnsRef,
    codeLessonControllerRef,
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
    rewindSegmentText,
    rewindCursorState,
    goLive,
    haltRewind,
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

  const {
    exportBoardRef,
    exportBoardMounted,
    isExportingLecture,
    lectureExportProgress,
    lectureExportError,
    canDownloadLecture,
    downloadLectureMp4,
    cancelLectureExport,
  } = useLectureExport({
    storedTurnsRef,
    storedTurnsCount,
    phase,
    isReplaying,
    sessionId,
    enabled: !isHeadless,
  });



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

  /**
   * Mark & Ask.
   *
   * A student who did not follow a step points at it. The marker is offered
   * once there is something on the board to point at, and picking it up quiets
   * the tutor — a doubt is composed in silence, not over the voice.
   *
   * The marks resolve to exact board lines and figure entities, so the doubt
   * turn is asked about content the board really holds. See `lib/board/boardMarking`.
   */
  const boardHasContent =
    // "planning" and "thinking" are a blank or clearing board: offering the
    // marker there lets a student ring empty paper and get a region back.
    phase === "drawing" ||
    phase === "speaking" ||
    storedTurnsCount > 0 ||
    narrationText.trim().length > 0;
  const canMark = !isEmbed && boardLoaded && !rewindActive && boardHasContent;

  const quietTutorForMarking = useCallback(() => {
    if (!rewindActive && !isPausedRef.current && phaseRef.current !== "idle") {
      pauseTurn();
    }
  }, [pauseTurn, rewindActive]);

  const marking = useBoardMarking({
    boardLayoutRef,
    verifiedDiagram: activeVerifiedDiagram,
    enabled: canMark,
    onArm: quietTutorForMarking,
  });

  /**
   * A marked doubt is already a complete, board-grounded question, so it is
   * handed to the turn whole rather than being wrapped a second time. With no
   * marks this is the plain doubt path, unchanged.
   */
  const submitDoubt = useCallback(
    (doubt: string) => {
      const marks = marking.marks;
      if (marks.length === 0) {
        marking.disarm();
        handleAskDoubt(doubt);
        return;
      }
      const prompt = buildMarkedDoubtPrompt(marks, doubt, liveQuestionRef.current);
      marking.disarm();
      handleAskDoubt(doubt, { prompt });
    },
    [handleAskDoubt, marking],
  );

  /** A new question replaces the board the marks were about. */
  const submitQuestionAndDropMarks = useCallback(
    (question: string) => {
      marking.disarm();
      if (storedTurnsCount > 0) {
        startNextQuestion(question);
        return;
      }
      void handleQuestion(question);
    },
    [handleQuestion, marking, startNextQuestion, storedTurnsCount],
  );

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

  useLecturePageHalt(() => {
    stopTurnOnUnmountRef.current();
    ttsClientRef.current?.stop();
    haltRewind();
  });

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

  const activeBoard = boards.find((b) => b.id === sessionId);
  const activeBoardTitle = activeBoard?.title ?? "";
  const canReplay = phase === "idle" && storedTurnsCount > 0 && !isReplaying && !isExportingLecture;
  const canDownload = phase === "idle" && storedTurnsCount > 0 && !isReplaying && !isExportingLecture;
  /** Admin Watch auto-replays; Notes PDF can still export from stored turns. */
  const canDownloadNotes =
    boardLoaded && storedTurnsCount > 0 && !isDownloading && !isExportingLecture;
  useEffect(() => {
    if (!onExportApi) {
      return;
    }
    onExportApi({
      canReplay,
      canDownload: isEmbed ? canDownloadNotes : canDownload,
      canDownloadLecture,
      isReplaying,
      isDownloading,
      isExportingLecture,
      lectureExportProgress,
      lectureExportError,
      replayLecture,
      downloadNotesPdf,
      downloadLectureMp4,
      cancelLectureExport,
    });
  }, [
    onExportApi,
    isEmbed,
    canReplay,
    canDownload,
    canDownloadNotes,
    canDownloadLecture,
    isReplaying,
    isDownloading,
    isExportingLecture,
    lectureExportProgress,
    lectureExportError,
    replayLecture,
    downloadNotesPdf,
    downloadLectureMp4,
    cancelLectureExport,
  ]);
  useEffect(() => {
    return () => onExportApi?.(null);
  }, [onExportApi]);
  const isInputOverlay = !isEmbed && phase === "idle" && boardLoaded && !inputInteracted;
  const inputSubmitMode = lessonFollowUpMode(storedTurnsCount > 0);

  const inputChrome = (
    <SessionInputChrome
      isInputOverlay={isInputOverlay}
      phase={phase}
      isPaused={isPaused}
      inputSubmitMode={inputSubmitMode}
      onSubmit={submitQuestionAndDropMarks}
      onAskDoubt={submitDoubt}
      onPauseToggle={handleLessonPauseToggle}
      onCancel={stopTurn}
      onUserInteractionChange={setInputInteracted}
      onOpenSettings={() => setSettingsOpen(true)}
      familiarity={settings.familiarity}
      onFamiliarityChange={(familiarity) => setSettings((c) => ({ ...c, familiarity }))}
      canMark={canMark}
      markingArmed={marking.armed}
      marks={marking.marks}
      atMarkLimit={marking.atMarkLimit}
      onToggleMarking={marking.toggle}
      onRemoveMark={marking.remove}
      onClearMarks={marking.clear}
      onDisarmMarking={marking.disarm}
    />
  );

  const showEmptyLanding = isInputOverlay && storedTurnsCount === 0;
  const fullBleedLanding = showEmptyLanding;

  /*
    What sits on the deck between the board and the transport.

    Below `md` the board scales under ~0.6 and code inside the frame stops
    being readable, so a DSA lesson moves its panel out of the board and onto
    the deck, where it renders at natural scale. Desktop resolves to null and
    the slot collapses, so it costs nothing there.

    An explicit `belowBoardPanel` wins: the prop is the caller's override, and
    this is only the default for the one surface that cannot be passed in from
    outside because `codeLessonController` lives in here.
  */
  const deckPanel =
    belowBoardPanel ??
    (isMobile && codeLessonController.getActivePlan() ? (
      <CodeLessonPanel controller={codeLessonController} variant="below" />
    ) : null);
  const framePad = isCompactNav ? 20 : 32;

  return (
    <div
      className={
        isEmbed
          ? "relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
          : "fx-aurora-soft relative flex h-dvh max-h-dvh min-w-0 overflow-hidden"
      }
      data-tutor-session={isEmbed ? "embed" : "full"}
      style={isEmbed ? { background: "var(--wb-bg)" } : undefined}
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
            onTogglePin={togglePinBoard}
            onToggleArchive={toggleArchiveBoard}
            onRename={renameBoard}
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
            onTogglePin={togglePinBoard}
            onToggleArchive={toggleArchiveBoard}
            onRename={renameBoard}
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
            borderLeft: "1px solid rgba(202, 229, 241, 0.08)",
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

      {notesEnabled && !isMobile && !notesRailOpen ? (
        <button
          type="button"
          onClick={toggleNotes}
          className="wb-notes-pull"
          aria-label="Open the Ask panel"
          aria-expanded={false}
          title="Ask me anything about this lesson"
        >
          <span className="wb-notes-pull__grip" aria-hidden />
        </button>
      ) : null}

      {notesEnabled ? (
        <Sheet open={isMobile && notesOpen} onOpenChange={(open) => {
          setNotesOpen(open);
        }}>
          <SheetContent
            side="right"
            className="w-[min(100%,380px)] border-l border-stroke p-0 sm:max-w-[380px]"
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
            canDownloadLecture={canDownloadLecture}
            isReplaying={isReplaying}
            isDownloading={isDownloading}
            isExportingLecture={isExportingLecture}
            lectureExportProgress={lectureExportProgress}
            lectureExportError={lectureExportError}
            phase={phase}
            compactActions={isCompactNav}
            notesOpen={notesOpen}
            showNotesToggle={notesEnabled}
            onToggleNotes={toggleNotes}
            onReplay={replayLecture}
            onDownload={downloadNotesPdf}
            onDownloadLecture={downloadLectureMp4}
            onCancelLectureExport={cancelLectureExport}
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
              <div className="glass-deep absolute inset-0 z-20 flex flex-col overflow-hidden rounded-2xl">
                <LandingPixelField />
                <div className="relative z-10 flex min-h-full w-full flex-col [justify-content:safe_center] px-4 py-4 sm:px-8 sm:py-5">
                  <CanvasLanding
                    suggestions={LANDING_SUGGESTIONS}
                    onSubmit={(question) => void handleQuestion(question)}
                    onOpenSettings={() => setSettingsOpen(true)}
                    familiarity={settings.familiarity}
                    onFamiliarityChange={(familiarity) =>
                      setSettings((c) => ({ ...c, familiarity }))
                    }
                  />
                </div>
                <CanvasLandingDoodles />
              </div>
            )}

            <div
              className={`flex min-h-0 max-w-full flex-col items-center ${
                fullBleedLanding ? "pointer-events-none invisible absolute" : ""
              }`}
              aria-hidden={fullBleedLanding || undefined}
            >
            <div
              className="wb-frame relative max-w-full"
              style={{
                width: BOARD_WIDTH * boardViewport.scale + framePad,
                height: BOARD_HEIGHT * boardViewport.scale + framePad,
                maxWidth: "100%",
              }}
            >
            <div className="wb-surface absolute overflow-hidden">
            {isInputOverlay && !fullBleedLanding && (
              <div className="wb-scrim-strong pointer-events-none absolute inset-0 z-10" />
            )}

            {/* The board's off-state: while the Konva chunk loads, the paper
                must not show. The face is opaque navy (the bezel's own
                language) with the sky boot arc — the same 252° sweep the
                on-canvas ThinkingSpinner draws, so boot → thinking reads as
                one pending family. It stays mounted and fades out when the
                board reports ready: no hard cut, no white flash. */}
            <div
              className="wb-boot-face absolute inset-0 z-30 flex items-center justify-center"
              data-hidden={boardLoaded || undefined}
              aria-hidden={boardLoaded || undefined}
            >
              <div className="fx-grid-fine absolute inset-0" />
              <div className="relative flex flex-col items-center gap-3">
                <BoardBootSpinner label="Loading the board" />
                <p className="type-accent-xs wb-boot-label animate-wb-breathe">
                  loading the board
                </p>
              </div>
            </div>

            {isEmbed && boardLoaded && storedTurnsCount === 0 ? (
              <div className="absolute inset-0 z-20 flex items-center justify-center">
                <p className="wb-scrim-ink-soft text-sm font-medium">No saved lecture on this board.</p>
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
              exportBoardRef={exportBoardRef}
              exportBoardMounted={exportBoardMounted}
              rewindBoardRef={rewindBoardRef}
              rewindActive={rewindActive}
              rewindCursorState={rewindCursorState}
              rewindSegmentText={rewindSegmentText}
              verifiedDiagram={activeVerifiedDiagram}
              codeLessonPanel={<CodeLessonPanel controller={codeLessonController} />}
              marking={marking}
              onRetraceEntity={handleRetraceEntity}
              onRetryError={(question) => {
                setLastError(null);
                void handleQuestion(question);
              }}
              onDismissError={() => setLastError(null)}
            />
            </div>
            </div>

            {deckPanel ? (
              <div className="w-full" style={{ width: BOARD_WIDTH * boardViewport.scale + framePad, maxWidth: "100%" }}>
                {deckPanel}
              </div>
            ) : null}

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
