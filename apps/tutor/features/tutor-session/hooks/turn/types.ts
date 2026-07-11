import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import type { ReplayCue } from "@/lib/replayTimeline";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { DrawCommand, DiagramTemplate } from "@heytutor/drawing";
import type { ConversationExchange, TTSClient } from "@heytutor/tutor-core";
import type { TurnTelemetry } from "@/lib/turnTelemetry";
import type { RecordedSegmentPayload, StoredTurn } from "@/lib/boardsClient";
import type { BoardEntry } from "@/components/BoardHistory";
import type { TutorSegment } from "@heytutor/drawing";
import type { TutorPhase, BoardLayoutState, SegmentPlanStats } from "../../types";

export type ExecuteCommandOptions = {
  durationScale?: number;
  speechDurationMs?: number;
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
  skipTemplateDuplicateCheck?: boolean;
  skipGeometrySnap?: boolean;
};

export type UseTurnLifecycleParams = {
  sessionId: string;
  searchParams: ReadonlyURLSearchParams;
  phase: TutorPhase;
  isReplaying: boolean;
  boardLoaded: boolean;
  narrationText: string;
  boards: BoardEntry[];
  whiteboardRef: RefObject<WhiteboardHandle | null>;
  pendingQuestionRef: RefObject<string | null>;
  autoSubmitDoneRef: RefObject<boolean>;
  phaseRef: RefObject<TutorPhase>;
  isPausedRef: RefObject<boolean>;
  conversationHistoryRef: RefObject<ConversationExchange[]>;
  ttsClientRef: RefObject<TTSClient | null>;
  replayAudioRef: RefObject<HTMLAudioElement | null>;
  replayAudioPreloadRef: RefObject<Map<string, HTMLAudioElement>>;
  cancelRef: RefObject<boolean>;
  turnActiveRef: RefObject<boolean>;
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
  activeDiagramTemplateRef: RefObject<DiagramTemplate | null>;
  segmentPlanStatsRef: RefObject<SegmentPlanStats>;
  stopTurnRef: RefObject<(() => void) | null>;
  speedRef: RefObject<number>;
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
  setTranscriptOpen: Dispatch<SetStateAction<boolean>>;
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
  persistTurnForReplay: (
    question: string,
    rawResponse: string,
    recordedSegments: RecordedSegmentPayload[],
  ) => StoredTurn;
  registerReplayBlobUrl: (url: string) => void;
  revokeReplayBlobUrls: () => void;
};

export type UseSegmentRunnerParams = Pick<
  UseTurnLifecycleParams,
  | "sessionId"
  | "cancellableDelay"
  | "ensureTTSClient"
  | "executeCommandWithCancel"
  | "raceWithCancel"
  | "cancelRef"
  | "turnActiveRef"
  | "turnTelemetryRef"
  | "turnStatsRef"
  | "recordedSegmentsRef"
  | "narrationSinceEpochRef"
  | "currentTraceIdRef"
  | "setCurrentSegmentText"
  | "narrationDensityRef"
  | "activeDiagramTemplateRef"
  | "drawChainRef"
> & {
  applyTurnPhase: (next: TutorPhase) => void;
};

export type TurnControlApi = {
  finishLectureUi: () => void;
  applyTurnPhase: (next: TutorPhase) => void;
  enqueueSegment: (segment: TutorSegment) => void;
  processResponseText: (
    responseText: string,
    introSegments?: TutorSegment[],
    liveEnqueued?: boolean,
  ) => Promise<void>;
  stopTurn: () => void;
  pauseTurn: () => void;
  resumeTurn: () => void;
  handleAskDoubt: (question: string) => void;
};
