"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/features/app-shell/AppShell";
import { toShellProfile, useAccountMe } from "@/features/app-shell/useAccountMe";
import {
  lessonSettingsFromAccount,
  readSettingsCache,
  writeSettingsCache,
} from "@/lib/account/userSettings";
import { firstName, parseSubjects, profileSubtitle } from "@/lib/account/types";
import { suggestionsForSubjects } from "@/lib/account/homeSuggestions";
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
} from "@/features/tutor-session/components/SettingsDrawer";
import {
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
import { useVisualViewportInset } from "@/lib/client/useVisualViewportInset";
import { useLockWindowScrollOnFocus } from "@/lib/client/useLockWindowScrollOnFocus";
import { ThinkingOverlay } from "./components/ThinkingOverlay";
import { BoardBootSpinner } from "./components/BoardBootSpinner";
import { SessionInputChrome } from "./components/SessionInputChrome";
import { SessionHeader } from "./components/SessionHeader";
import { NotesChatSidebar } from "./components/NotesChatSidebar";
import { SessionBoardCanvas } from "./components/SessionBoardCanvas";
import { OutOfCreditsDialog } from "@/features/account/OutOfCreditsDialog";
import type { BillingFailure } from "@/lib/billing/billingClient";
import { rememberBillingFailure } from "@/lib/billing/billingClient";
import { isOutOfCreditsCode, studentBillingMessage } from "@/lib/billing/studentCopy";
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
  BOARD_WIDTH,
  BOARD_HEIGHT,
} from "./constants";
import type { LectureExportProgress } from "@/lib/lecture-export/exportLectureMp4";
import type { TutorPhase, SegmentPlanStats } from "./types";
import { createEmptySegmentPlanStats } from "./lib/turn/segmentPlanning";
import { lessonFollowUpMode } from "./lib/turn/lessonFollowUp";
import { buildLessonNotes } from "./lib/notes/lessonNotes";
import { sessionCapabilities, type TutorSessionVariant } from "./lib/sessionCapabilities";
import { buildMarkedDoubtPrompt, summarizeMarks, type BoardMark } from "./lib/board/boardMarking";
import { DOUBT_THINKING_FALLBACK, doubtThinkingAnchor } from "./lib/board/doubtAnchor";
import { doubtTurnTitle, isDoubtPrompt } from "./lib/input/askDoubt";
import type { BoardPageRecord, PageTurnKind } from "./lib/turn/doubtTurn";
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

function writeStoredSetting(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / quota */
  }
}

export type { TutorSessionVariant } from "./lib/sessionCapabilities";

export type TutorSessionError = {
  message: string;
  question: string;
  billing?: BillingFailure;
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
   * Controlled Ask panel. A host that carries its own Notes control — admin
   * Watch has one in the drawer header — drives the same panel the pull tab on
   * the board's edge opens, rather than mounting a second, poorer one.
   */
  notesOpen?: boolean;
  onNotesOpenChange?: (open: boolean) => void;
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
  notesOpen: notesOpenProp,
  onNotesOpenChange,
  belowBoardPanel,
}: TutorSessionShellProps) {
  const router = useRouter();
  const accountMe = useAccountMe();
  const isHeadless = variant === "headless";
  /**
   * What this surface may do, and — separately — whether it draws the app
   * frame. Admin Watch is a `panel`: the whole lesson, inside a drawer that
   * brings its own header, so everything below keys off the capability rather
   * than off "is this the main page".
   */
  const can = sessionCapabilities(variant);
  /** No sidebar, no session header: the surface brings its own frame. */
  const frameless = !can.appChrome && !isHeadless;
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
  const [lastError, setLastError] = useState<TutorSessionError | null>(null);
  const [creditsOpen, setCreditsOpen] = useState(false);
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
  const teachingPrefsRef = useRef({
    teachingNote: "",
    alwaysShowUnits: false,
    alwaysStateLawFirst: false,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [liveQuestion, setLiveQuestion] = useState("");
  const liveQuestionRef = useRef("");
  /** The page on the board and the turn teaching on it; see `lib/turn/doubtTurn`. */
  const boardPageRef = useRef<BoardPageRecord | null>(null);
  /** A stopped replay left the board on one of its pages; see the turn types. */
  const boardShowsStoppedReplayRef = useRef(false);
  /** A doubt is thought about over its own page; a lesson over clean paper. */
  const [liveTurnKind, setLiveTurnKind] = useState<PageTurnKind>("lesson");
  /** The student's rings, kept on the page while the tutor thinks about them. */
  const [heldDoubtMarks, setHeldDoubtMarks] = useState<BoardMark[]>([]);
  /** Where the clicker sits while a doubt is thought about. Board units. */
  const [doubtThinkingAt, setDoubtThinkingAt] = useState<{ x: number; y: number } | null>(null);
  /** null = follow the automatic rule; true/false = the student decided. */
  const [notesOpenOverride, setNotesOpenOverride] = useState<boolean | null>(null);
  const isCompactNav = useIsCompactNav();
  const isMobile = useIsMobile();
  const keyboardInset = useVisualViewportInset();
  useLockWindowScrollOnFocus(!isHeadless);
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

  // A page record describes the page the live turns drew. Another board, or a
  // replay redrawing this one from saved turns, is a different page: a doubt
  // asked over it reads the saved turns instead.
  useEffect(() => {
    boardPageRef.current = null;
    boardShowsStoppedReplayRef.current = false;
  }, [sessionId]);
  useEffect(() => {
    if (!isReplaying) return;
    boardPageRef.current = null;
    // A replay that runs to the end leaves the last saved page up; only one
    // stopped part way through sets this again (in `stopTurn`).
    boardShowsStoppedReplayRef.current = false;
  }, [isReplaying]);

  useEffect(() => {
    if (isHeadless || typeof window === "undefined") {
      return;
    }
    const cache = readSettingsCache();
    if (speedIsControlled) {
      delete cache.speedMultiplier;
    }
    if (Object.keys(cache).length > 0) {
      if (cache.fastMode === false) fastModeRef.current = false;
      if (cache.familiarity) familiarityRef.current = cache.familiarity;
      // Read after mount so SSR HTML stays the production default.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettings((current) => ({ ...current, ...cache }));
    }
    const language = cache.audioLanguage ?? DEFAULT_SETTINGS.audioLanguage;
    const accent = cache.accent ?? DEFAULT_SETTINGS.accent;
    const lowLatency = cache.lowLatencyVoice ?? DEFAULT_SETTINGS.lowLatencyVoice;
    voicePreferencesRef.current = {
      voiceKey: toVoiceKey(language, accent),
      lowLatency,
    };

    let cancelled = false;
    void fetch("/api/account/settings")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { settings?: Parameters<typeof lessonSettingsFromAccount>[0] };
      })
      .then((data) => {
        if (cancelled || !data?.settings) return;
        const next = lessonSettingsFromAccount(data.settings);
        teachingPrefsRef.current = {
          teachingNote: data.settings.teachingNote,
          alwaysShowUnits: data.settings.alwaysShowUnits,
          alwaysStateLawFirst: data.settings.alwaysStateLawFirst,
        };
        if (speedIsControlled) {
          next.speedMultiplier = speedRef.current;
        }
        setSettings(next);
        writeSettingsCache(next);
        fastModeRef.current = next.fastMode;
        familiarityRef.current = next.familiarity;
      })
      .catch(() => {
        /* cache remains the lesson sheet until the server answers */
      })
      .finally(() => {
        if (!cancelled) setSettingsHydrated(true);
      });
    return () => {
      cancelled = true;
    };
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
    if (!settingsHydrated || !can.persistSettings) return;
    writeSettingsCache(settings);
    const timer = window.setTimeout(() => {
      void fetch("/api/account/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      }).catch(() => {
        /* local cache still holds the last choice */
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [settings, settingsHydrated, can.persistSettings]);

  useEffect(() => {
    if (!accountMe?.settings) return;
    teachingPrefsRef.current = {
      teachingNote: accountMe.settings.teachingNote,
      alwaysShowUnits: accountMe.settings.alwaysShowUnits,
      alwaysStateLawFirst: accountMe.settings.alwaysStateLawFirst,
    };
  }, [accountMe]);

  useEffect(() => {
    if (lastError?.billing && isOutOfCreditsCode(lastError.billing.code)) {
      setCreditsOpen(true);
    } else if (!lastError) {
      setCreditsOpen(false);
    }
  }, [lastError]);

  const handleBillingFailure = useCallback((failure: BillingFailure) => {
    rememberBillingFailure(failure);
    setLastError({
      message: studentBillingMessage(failure.code),
      question: "",
      billing: failure,
    });
  }, []);
  const goUsage = useCallback(() => {
    router.push("/usage");
  }, [router]);

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
    Planning and the wait for the first teaching token cover the board with
    the pending clicker. The Konva marker stays down (`idle`) so its contact
    shadow and idle fidget cannot sit on empty paper under that overlay.

    Once the lesson is speaking or drawing, the React prop stays on
    `thinking` so it cannot overwrite an imperative walk — mapping those
    phases to `drawing` used to freeze the pen the moment TTS started.
    `idle` is opacity 0, and is only for after a turn finishes.
  */
  const waitingToTeach = phase === "planning" || phase === "thinking";
  const cursorState: CursorState =
    phase === "idle" && !isReplaying
      ? "idle"
      : isReplaying
        ? "drawing"
        : waitingToTeach
          ? "idle"
          : "thinking";
  const pendingInk = getMarkerColorHex(settings.markerColor);

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
    activeVerifiedDiagramRef,
    setActiveVerifiedDiagram,
    fbdPhaseStartedRef,
  });

  const {
    finishLectureUi,
    stopTurn,
    pauseTurn,
    resumeTurn,
    handleQuestion,
    handleAskDoubt,
    flushPausedLesson,
    pausedLessonOffer,
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
    boardPageRef,
    boardShowsStoppedReplayRef,
    setLiveTurnKind,
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
    teachingPrefsRef,
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

  const notesEnabled = can.notes;
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
    setLiveTurnKind("lesson");
    setHeldDoubtMarks([]);
    setDoubtThinkingAt(null);
  }

  /*
    The Ask panel stays tucked until it is asked for. It used to open itself as
    soon as a lesson started, which took a third of the screen away from the
    board at exactly the moment the board mattered most, and did it as a slide
    from the right that the student had not triggered. The pull tab on the
    right edge is now the only way in on desktop.
  */
  const notesOpen = notesOpenProp ?? notesOpenOverride ?? false;
  const setNotesOpen = (open: boolean): void => {
    onNotesOpenChange?.(open);
    if (notesOpenProp === undefined) {
      setNotesOpenOverride(open);
    }
  };

  const toggleNotes = () => {
    setNotesOpen(!notesOpen);
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
    activeVerifiedDiagramRef,
    setActiveVerifiedDiagram,
    fbdPhaseStartedRef,
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
    boardPageRef,
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
  const canMark = can.marking && boardLoaded && !rewindActive && boardHasContent;

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
  /** The doubt last asked: a retry asks it again, under its title, from its place. */
  const lastDoubtRef = useRef<{ typed: string; title: string; at: { x: number; y: number } } | null>(
    null,
  );
  const submitDoubt = useCallback(
    (doubt: string) => {
      const marks = marking.marks;
      // The page stays up while the tutor thinks, so the wait is shown on it:
      // the student's rings stay where they drew them and a small clicker sits
      // beside them, or at the row the answer starts on when nothing was marked.
      const at = doubtThinkingAnchor(marks, boardLayoutRef.current, fbdPhaseStartedRef.current);
      const title = doubtTurnTitle(doubt, summarizeMarks(marks));
      lastDoubtRef.current = { typed: doubt, title, at };
      setHeldDoubtMarks(marks);
      setDoubtThinkingAt(at);
      if (marks.length === 0) {
        marking.disarm();
        handleAskDoubt(doubt, { title });
        return;
      }
      const prompt = buildMarkedDoubtPrompt(marks, doubt, liveQuestionRef.current);
      marking.disarm();
      handleAskDoubt(doubt, { prompt, title });
    },
    [boardLayoutRef, handleAskDoubt, marking],
  );

  // The rings are what the tutor is thinking about. They go when the answer
  // starts, the tutor's own ink taking over from them, or when the doubt ends
  // without one.
  const doubtWaitSeenRef = useRef(false);
  useEffect(() => {
    if (heldDoubtMarks.length === 0 && doubtThinkingAt === null) return;
    if (phase === "planning" || phase === "thinking") {
      doubtWaitSeenRef.current = true;
      return;
    }
    const answerStarted = phase === "speaking" || phase === "drawing";
    const doubtEnded = phase === "idle" && (doubtWaitSeenRef.current || lastError !== null);
    if (answerStarted || doubtEnded) {
      doubtWaitSeenRef.current = false;
      setHeldDoubtMarks([]);
      setDoubtThinkingAt(null);
    }
  }, [doubtThinkingAt, heldDoubtMarks.length, lastError, phase]);

  /** While the tutor thinks, the board keeps showing the rings the doubt was asked with. */
  const boardMarking = useMemo(
    () =>
      marking.armed || heldDoubtMarks.length === 0
        ? marking
        : { ...marking, marks: heldDoubtMarks },
    [heldDoubtMarks, marking],
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

  const canReplay = phase === "idle" && storedTurnsCount > 0 && !isReplaying && !isExportingLecture;
  const canDownload = phase === "idle" && storedTurnsCount > 0 && !isReplaying && !isExportingLecture;
  const canDownloadNotes =
    boardLoaded && storedTurnsCount > 0 && !isDownloading && !isExportingLecture;
  useEffect(() => {
    if (!onExportApi) {
      return;
    }
    onExportApi({
      canReplay,
      canDownload: frameless ? canDownloadNotes : canDownload,
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
    frameless,
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
        {waitingToTeach && (
          <ThinkingOverlay
            ink={pendingInk}
            onBoardAt={
              liveTurnKind === "lesson" ? null : (doubtThinkingAt ?? DOUBT_THINKING_FALLBACK)
            }
          />
        )}
      </div>
    );
  }

  const activeBoard = boards.find((b) => b.id === sessionId);
  const activeBoardTitle = activeBoard?.title ?? "";
  const isInputOverlay = can.appChrome && phase === "idle" && boardLoaded && !inputInteracted;
  const inputSubmitMode = pausedLessonOffer
    ? "follow-up"
    : lessonFollowUpMode(storedTurnsCount > 0);

  const billingNotice = lastError?.billing ?? null;

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
      compact={isMobile}
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
      pausedLessonOffer={pausedLessonOffer}
      onContinueLecture={flushPausedLesson}
      billingNotice={billingNotice}
      onUpgrade={goUsage}
      onBillingFailure={handleBillingFailure}
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

  const sessionBody = (
    <>
      {notesRailOpen ? (
        <div
          className="flex"
          style={{
            position: "fixed",
            right: 0,
            top: 0,
            // Above a host overlay when there is one: admin Watch is a fixed
            // drawer of its own, and a rail below it would open behind it.
            zIndex: frameless ? 70 : 40,
            width: NOTES_CHAT_RAIL_WIDTH,
            height: "100dvh",
            borderLeft: "1px solid rgba(255, 255, 255, 0.08)",
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
          style={frameless ? { zIndex: 69 } : undefined}
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
          frameless ? "h-full md:mr-[var(--tutor-notes-width)]" : "md:mr-[var(--tutor-notes-width)]"
        }`}
        style={{
          ["--tutor-notes-width" as string]: notesRailOpen
            ? `${NOTES_CHAT_RAIL_WIDTH}px`
            : "0px",
          paddingLeft: `max(${isMobile ? 6 : PAGE_GUTTER_X}px, env(safe-area-inset-left))`,
          paddingRight: `max(${isMobile ? 6 : PAGE_GUTTER_X}px, env(safe-area-inset-right))`,
          paddingTop: `max(${isMobile ? 6 : 12}px, env(safe-area-inset-top))`,
          paddingBottom: keyboardInset > 0
            ? `${keyboardInset}px`
            : `max(${isMobile ? 8 : 12}px, env(safe-area-inset-bottom))`,
          transition: sidebarResizing
            ? "none"
            : "margin-left 0.25s cubic-bezier(0.16, 1, 0.3, 1), margin-right 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {can.appChrome ? (
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
                <div className="relative z-10 flex min-h-full w-full flex-col [justify-content:safe_center] px-3 py-3 sm:px-8 sm:py-5">
                  <CanvasLanding
                    suggestions={suggestionsForSubjects(parseSubjects(accountMe?.profile?.subjects))}
                    onSubmit={(question) => void handleQuestion(question)}
                    onOpenSettings={() => setSettingsOpen(true)}
                    familiarity={settings.familiarity}
                    onFamiliarityChange={(familiarity) =>
                      setSettings((c) => ({ ...c, familiarity }))
                    }
                    greeting={
                      accountMe?.profile
                        ? `What are you stuck on, ${firstName(accountMe.profile.name, accountMe.profile.email)}?`
                        : undefined
                    }
                    goalLabel={accountMe?.profile ? profileSubtitle(accountMe.profile) : null}
                    billingNotice={billingNotice}
                    onUpgrade={goUsage}
                    onBillingFailure={handleBillingFailure}
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
                must not show. The face is the bezel's own matte grey,
                unmarked, with the boot arc on it: the same 252° sweep the
                on-canvas ThinkingSpinner draws, so boot → thinking reads as
                one pending family. It stays mounted and fades out when the
                board reports ready: no hard cut, no white flash. */}
            <div
              className="wb-boot-face fx-grain absolute inset-0 z-30 flex items-center justify-center"
              data-hidden={boardLoaded || undefined}
              aria-hidden={boardLoaded || undefined}
            >
              <div className="relative flex flex-col items-center gap-3">
                <BoardBootSpinner label="Loading the board" />
                <p className="type-accent-xs wb-boot-label animate-wb-breathe">
                  loading the board
                </p>
              </div>
            </div>

            {!can.appChrome && boardLoaded && storedTurnsCount === 0 && !can.askQuestions ? (
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

            {/* A rewound lecture is the past: don't cover the board they
                are actually watching with the pending clicker. */}
            {waitingToTeach && !rewindActive && (
              <ThinkingOverlay
                ink={pendingInk}
                onBoardAt={
                  liveTurnKind === "lesson" ? null : (doubtThinkingAt ?? DOUBT_THINKING_FALLBACK)
                }
                scale={boardViewport.scale}
              />
            )}

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
              marking={boardMarking}
              onRetraceEntity={handleRetraceEntity}
              onRetryError={(question) => {
                setLastError(null);
                // A failed doubt is asked again as a doubt, on the same page,
                // under the same title and from the same place.
                if (isDoubtPrompt(question)) {
                  const last = lastDoubtRef.current;
                  if (last) setDoubtThinkingAt(last.at);
                  handleAskDoubt(last?.typed ?? "", { prompt: question, title: last?.title });
                  return;
                }
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

        {can.askQuestions && !isInputOverlay && (
          <footer
            className="relative shrink-0"
            style={{ paddingTop: isMobile ? 4 : PAGE_GUTTER_Y }}
          >
            {inputChrome}
          </footer>
        )}

        {can.settings ? (
          <SettingsDrawer
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            settings={settings}
            onSettingsChange={setSettings}
          />
        ) : null}
        <OutOfCreditsDialog
          open={creditsOpen}
          onOpenChange={setCreditsOpen}
          ageBand={accountMe?.profile?.ageBand}
        />
      </div>
    </>
  );

  if (frameless) {
    return (
      <div
        className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
        data-tutor-session={variant}
        style={{ background: "var(--wb-bg)" }}
      >
        {sessionBody}
      </div>
    );
  }

  return (
    <AppShell
      variant="session"
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
      profile={toShellProfile(accountMe?.profile)}
      onOpenLessonSettings={() => setSettingsOpen(true)}
      sidebarCollapsed={sidebarCollapsed}
      onSidebarCollapsedChange={setSidebarCollapsed}
      mobileNavOpen={mobileNavOpen}
      onMobileNavOpenChange={setMobileNavOpen}
      onSidebarResizingChange={setSidebarResizing}
    >
      {sessionBody}
    </AppShell>
  );
}
