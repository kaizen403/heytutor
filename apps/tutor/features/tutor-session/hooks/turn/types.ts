import type { SubjectFamiliarity } from "@heytutor/tutor-core";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ReplayCue } from "@/lib/replay/replayTimeline";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { DrawCommand, VerifiedDiagram } from "@heytutor/drawing";
import type { ConversationExchange, InkPace, TTSClient } from "@heytutor/tutor-core";
import type { TurnTelemetry } from "@/lib/obs/turnTelemetry";
import type { RecordedSegmentPayload, StoredTurn } from "@/lib/boards/boardsClient";
import type { BoardEntry } from "@/lib/boards/types";
import type { TutorSegment } from "@heytutor/drawing";
import type { TutorPhase, BoardLayoutState, SegmentPlanStats } from "../../types";
import type { CodeLessonController } from "../../lib/code-lesson/codeLessonController";

export type ExecuteCommandOptions = {
  durationScale?: number;
  speechDurationMs?: number;
  /** This command's slice of the segment's spoken time. */
  speechShareMs?: number;
  writeSchedule?: {
    charStartOffsetsMs: number[];
    charDurationsMs: number[];
    getAudioPositionMs: () => number;
    onCharacterStart?: (info: {
      char: string;
      index: number;
      targetMs: number;
      audioPositionMs: number;
    }) => void;
  };
  applyLayout?: boolean;
  segmentNarration?: string;
  /** Preserve coordinates emitted by the verified scene compiler. */
  trustedDiagramGeometry?: boolean;
  /** Stops a command whose owning turn has been superseded. */
  isCancelled?: () => boolean;
  /** Text row was reserved before audio started; preserve the resolved coordinates. */
  textPlacementReserved?: boolean;
  /** Engine-selected pedagogical pace. Runtime-owned — never LLM. */
  inkPace?: InkPace;
};

export type UseTurnLifecycleParams = {
  sessionId: string;
  /** Home board: no database row and no `/c/` URL until this first question. */
  isDraft?: boolean;
  /**
   * Writes the home board's row and hands it the `/c/{id}` URL. Resolves true
   * when this call is the one that created it, so the naming pass knows the
   * board is brand new even though `boards` has not caught up yet.
   */
  commitDraftBoard?: () => Promise<boolean>;
  /** Submit this question once the board and whiteboard are ready. */
  autoQuestion?: string | null;
  /** Strip `?q=` from the URL after consuming autoQuestion (student `/c/` path). */
  replaceAutoQuestionUrl?: boolean;
  /** Space-to-pause / Escape-to-stop. Off for the headless admin runner. */
  enableKeyboardControls?: boolean;
  onComplete?: () => void;
  onError?: (error: { message: string; question: string }) => void;
  phase: TutorPhase;
  isReplaying: boolean;
  boardLoaded: boolean;
  narrationText: string;
  boards: BoardEntry[];
  whiteboardRef: RefObject<WhiteboardHandle | null>;
  pendingQuestionRef: RefObject<string | null>;
  /**
   * `${boardId}::${question}` already auto-submitted. A plain boolean latch
   * never resets — the shell stays mounted across `/c/A` -> `/c/B`, so the
   * second "Next Question" of a session would drop its `?q=` silently.
   */
  autoSubmitDoneRef: RefObject<string | null>;
  phaseRef: RefObject<TutorPhase>;
  isPausedRef: RefObject<boolean>;
  /** True while the student is watching an earlier part of this same lecture. */
  rewoundRef?: RefObject<boolean>;
  conversationHistoryRef: RefObject<ConversationExchange[]>;
  /** Question owning the turn in flight — the context a mid-lesson doubt needs. */
  liveQuestionRef: RefObject<string>;
  ttsClientRef: RefObject<TTSClient | null>;
  replayAudioRef: RefObject<HTMLAudioElement | null>;
  replayAudioPreloadRef: RefObject<Map<string, HTMLAudioElement>>;
  cancelRef: RefObject<boolean>;
  turnActiveRef: RefObject<boolean>;
  /** Monotonic owner for async work. A segment may only mutate the board for its turn. */
  turnGenerationRef: RefObject<number>;
  turnAbortRef: RefObject<AbortController | null>;
  segmentChainRef: RefObject<Promise<void>>;
  /** Serializes ink so drawing trails speech without blocking the next paragraph. */
  drawChainRef: RefObject<Promise<void>>;
  collectedSegmentsRef: RefObject<TutorSegment[]>;
  recordedSegmentsRef: RefObject<RecordedSegmentPayload[]>;
  storedTurnsRef: RefObject<StoredTurn[]>;
  rawResponseRef: RefObject<string>;
  currentTraceIdRef: RefObject<string | null>;
  turnTelemetryRef: RefObject<TurnTelemetry | null>;
  turnStatsRef: RefObject<{ drawMs: number; ttsChars: number }>;
  narrationSinceEpochRef: RefObject<string>;
  boardLayoutRef: RefObject<BoardLayoutState>;
  fbdPhaseMarkedRef: RefObject<boolean>;
  fbdPhaseStartedRef: RefObject<boolean>;
  activeVerifiedDiagramRef: RefObject<VerifiedDiagram | null>;
  setActiveVerifiedDiagram?: Dispatch<SetStateAction<VerifiedDiagram | null>>;
  /** Owns the DSA code panel; DSA turns commit their CodeLessonPlan here. */
  codeLessonControllerRef?: RefObject<CodeLessonController | null>;
  segmentPlanStatsRef: RefObject<SegmentPlanStats>;
  stopTurnRef: RefObject<(() => void) | null>;
  speedRef: RefObject<number>;
  /** Prefer Fireworks Fast routers when configured. Default on. */
  fastModeRef: RefObject<boolean>;
  /**
   * Familiarity of the subject, chosen per question in the chat bar (Settings
   * only supplies the default). Shifts the teaching-prompt step budget and
   * selects the scaffolding addon.
   */
  familiarityRef: RefObject<SubjectFamiliarity>;
  /** Live count of segments enqueued but not yet finished — drives adaptive speed. */
  pendingSegmentCountRef: RefObject<number>;
  /** Narration density (chars per ms) of the current segment — drives adaptive speed. */
  narrationDensityRef: RefObject<number>;
  replayGenerationRef: RefObject<number>;
  replayCueRef: RefObject<ReplayCue | null>;
  setPhase: Dispatch<SetStateAction<TutorPhase>>;
  setIsPaused: Dispatch<SetStateAction<boolean>>;
  setNarrationText: Dispatch<SetStateAction<string>>;
  setCurrentSegmentText: Dispatch<SetStateAction<string>>;
  setLastError: Dispatch<SetStateAction<{ message: string; question: string } | null>>;
  setInputInteracted: Dispatch<SetStateAction<boolean>>;
  setLiveQuestion?: Dispatch<SetStateAction<string>>;
  setIsReplaying: Dispatch<SetStateAction<boolean>>;
  setReplayProgressMs: Dispatch<SetStateAction<number>>;
  setReplayTotalMs: Dispatch<SetStateAction<number>>;
  setStoredTurnsCount: Dispatch<SetStateAction<number>>;
  setBoards: Dispatch<SetStateAction<BoardEntry[]>>;
  ensureTTSClient: () => TTSClient;
  executeCommandWithCancel: (
    command: DrawCommand,
    options?: ExecuteCommandOptions,
  ) => Promise<void>;
  cancellableDelay: (duration: number) => Promise<void>;
  raceWithCancel: <T>(promise: Promise<T>) => Promise<T | undefined>;
  clearCancelTimers: () => void;
  resetBoardLayout: (keepHeading?: boolean, forceSequentialWorkLayout?: boolean) => void;
  beginBoardEpoch: () => Promise<void>;
  reserveTextCommandPlacements: (command: DrawCommand) => Promise<DrawCommand[]>;
  persistTurnForReplay: (
    question: string,
    rawResponse: string,
    recordedSegments: RecordedSegmentPayload[],
    scene?: {
      sceneDocument?: unknown | null;
      sceneEngineVersion?: string | null;
      validationReport?: unknown | null;
      visualStatus?: import("@/lib/boards/boardsClient").SceneVisualStatus | null;
      sceneArtifacts?: unknown | null;
    },
  ) => StoredTurn;
  registerReplayBlobUrl: (url: string) => void;
  revokeUnreferencedReplayBlobUrls: () => void;
};

export type UseSegmentRunnerParams = Pick<
  UseTurnLifecycleParams,
  | "sessionId"
  | "cancellableDelay"
  | "ensureTTSClient"
  | "executeCommandWithCancel"
  | "raceWithCancel"
  | "cancelRef"
  | "isPausedRef"
  | "turnActiveRef"
  | "turnGenerationRef"
  | "turnTelemetryRef"
  | "turnStatsRef"
  | "recordedSegmentsRef"
  | "narrationSinceEpochRef"
  | "currentTraceIdRef"
  | "setCurrentSegmentText"
  | "narrationDensityRef"
  | "drawChainRef"
  | "reserveTextCommandPlacements"
> & {
  applyTurnPhase: (next: TutorPhase) => void;
};

export type TurnControlApi = {
  finishLectureUi: (turnGeneration?: number) => void;
  applyTurnPhase: (next: TutorPhase) => void;
  enqueueSegment: (segment: TutorSegment, turnGeneration?: number) => void;
  enqueueVerifiedIntro: (segments: TutorSegment[], turnGeneration?: number) => void;
  processResponseText: (
    responseText: string,
    introSegments?: TutorSegment[],
    liveEnqueued?: boolean,
    turnGeneration?: number,
    givenSegments?: TutorSegment[],
  ) => Promise<void>;
  stopTurn: () => void;
  pauseTurn: () => void;
  resumeTurn: () => void;
  /** `options.prompt` carries an already-composed, board-grounded doubt. */
  handleAskDoubt: (question: string, options?: { prompt?: string }) => void;
};
