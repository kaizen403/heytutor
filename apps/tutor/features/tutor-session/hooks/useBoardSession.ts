import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import {
  isStoredCommandTrustedGeometry,
  lessonNarrationText,
  parseStoredSegmentCommands,
} from "@heytutor/drawing";
import {
  createTTSClient,
  type ConversationExchange,
  type TTSClient,
} from "@heytutor/tutor-core";
import type { NotesEpoch } from "@/lib/client/exportNotesPdf";
import { buildLocalStoredTurn } from "@/lib/replay/replayTurns";
import { nextQuestionBoardPath } from "@/features/tutor-session/lib/lessonFollowUp";
import type { BoardEntry } from "@/lib/boards/types";
import {
  createBoard,
  deleteBoardApi,
  fetchBoardDetail,
  fetchBoards,
  type RecordedSegmentPayload,
  type StoredTurn,
} from "@/lib/boards/boardsClient";
import type { TutorPhase } from "../types";

type ExecuteCommandOptions = {
  durationScale?: number;
  applyLayout?: boolean;
  trustedDiagramGeometry?: boolean;
  isCancelled?: () => boolean;
};

type ExecuteCommand = (
  command: import("@heytutor/drawing").DrawCommand,
  options?: ExecuteCommandOptions,
) => Promise<void>;

async function waitForWhiteboard(
  whiteboardRef: RefObject<WhiteboardHandle | null>,
  maxMs = 4000,
): Promise<boolean> {
  const start = Date.now();
  while (!whiteboardRef.current) {
    if (Date.now() - start >= maxMs) {
      return false;
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }
  return true;
}

export interface UseBoardSessionParams {
  sessionId: string;
  router: AppRouterInstance;
  phase: TutorPhase;
  speedMultiplier: number;
  whiteboardRef: RefObject<WhiteboardHandle | null>;
  cancelRef: RefObject<boolean>;
  notesEpochsRef: RefObject<NotesEpoch[]>;
  narrationSinceEpochRef: RefObject<string>;
  ttsClientRef: RefObject<TTSClient | null>;
  speedRef: RefObject<number>;
  stopTurnRef: RefObject<(() => void) | null>;
  replayAudioRef: RefObject<HTMLAudioElement | null>;
  replayAudioPreloadRef: RefObject<Map<string, HTMLAudioElement>>;
  setNarrationText: Dispatch<SetStateAction<string>>;
  setCurrentSegmentText: Dispatch<SetStateAction<string>>;
  resetBoardLayout: (keepHeading?: boolean, forceSequentialWorkLayout?: boolean) => void;
  executeCommand: ExecuteCommand;
}

export function useBoardSession({
  sessionId,
  router,
  phase,
  speedMultiplier,
  whiteboardRef,
  cancelRef,
  notesEpochsRef,
  narrationSinceEpochRef,
  ttsClientRef,
  speedRef,
  stopTurnRef,
  replayAudioRef,
  replayAudioPreloadRef,
  setNarrationText,
  setCurrentSegmentText,
  resetBoardLayout,
  executeCommand,
}: UseBoardSessionParams) {
  const [boards, setBoards] = useState<BoardEntry[]>([]);
  const [boardLoaded, setBoardLoaded] = useState(false);
  const storedTurnsRef = useRef<StoredTurn[]>([]);
  const [storedTurnsCount, setStoredTurnsCount] = useState(0);
  const conversationHistoryRef = useRef<ConversationExchange[]>([]);
  const [inputInteracted, setInputInteracted] = useState(false);
  const replayBlobUrlsRef = useRef<string[]>([]);
  const restoreGenerationRef = useRef(0);
  const activeSessionIdRef = useRef(sessionId);

  useEffect(() => {
    activeSessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    const rate = Math.max(speedMultiplier, 0.1);
    speedRef.current = rate;
    ttsClientRef.current?.setPlaybackRate(rate);
    whiteboardRef.current?.setAnimationSpeed(rate);
    // Settings drawer and replay controls share speedMultiplier — keep the
    // playing lecture element in lockstep when speed changes mid-cue.
    const playing = replayAudioRef.current;
    if (playing) {
      playing.playbackRate = rate;
      if ("preservesPitch" in playing) {
        (playing as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true;
      }
    }
    for (const preloaded of replayAudioPreloadRef.current.values()) {
      preloaded.playbackRate = rate;
      if ("preservesPitch" in preloaded) {
        (preloaded as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true;
      }
    }
  }, [speedMultiplier, speedRef, ttsClientRef, whiteboardRef, replayAudioRef, replayAudioPreloadRef]);

  const boardsFetchedRef = useRef(false);
  useEffect(() => {
    if (boardsFetchedRef.current) return;
    boardsFetchedRef.current = true;
    void fetchBoards().then((list) => {
      setBoards((prev) => {
        const existingIds = new Set(prev.map((b) => b.id));
        const newOnes = list.filter((b) => !existingIds.has(b.id));
        return [...prev, ...newOnes];
      });
    });
  }, []);

  const openBoard = useCallback(
    async (question = "") => {
      const unused = boards.find(
        (b) => b.title === "new board" && !b.preview,
      );
      if (unused) {
        if (unused.id === sessionId && !question.trim()) return;
        if (unused.id !== sessionId) {
          router.push(nextQuestionBoardPath(unused.id, question));
          return;
        }
      }
      const board = await createBoard();
      if (!board) return;
      setBoards((prev) => [board, ...prev.filter((b) => b.id !== board.id)]);
      router.push(nextQuestionBoardPath(board.id, question));
    },
    [boards, sessionId, router],
  );

  const createNewBoard = useCallback(() => {
    void openBoard();
  }, [openBoard]);

  const startNextQuestion = useCallback(
    (question: string) => {
      void openBoard(question);
    },
    [openBoard],
  );

  const switchBoard = useCallback(
    (id: string) => {
      if (id === sessionId) return;
      router.push(`/c/${id}`);
    },
    [sessionId, router],
  );

  const deleteBoard = useCallback(
    (id: string) => {
      void (async () => {
        if (id === sessionId && phase !== "idle") {
          stopTurnRef.current?.();
        }

        const ok = await deleteBoardApi(id);
        if (!ok) {
          return;
        }

        // Filter before setState — React may defer updaters, so reading a
        // variable assigned inside the updater can leave navigation on [].
        const remaining = boards.filter((b) => b.id !== id);
        setBoards(remaining);

        if (id === sessionId) {
          if (remaining.length > 0) {
            router.push(`/c/${remaining[0]!.id}`);
          } else {
            createNewBoard();
          }
        }
      })();
    },
    [sessionId, router, createNewBoard, phase, stopTurnRef, boards],
  );

  const ensureTTSClient = useCallback((): TTSClient => {
    if (!ttsClientRef.current) {
      ttsClientRef.current = createTTSClient();
    }
    ttsClientRef.current.setPlaybackRate(speedRef.current);
    return ttsClientRef.current;
  }, [ttsClientRef, speedRef]);

  useEffect(() => {
    ensureTTSClient();

    return () => {
      ttsClientRef.current?.stop();
    };
  }, [ensureTTSClient, ttsClientRef]);

  const registerReplayBlobUrl = useCallback((url: string) => {
    replayBlobUrlsRef.current.push(url);
  }, []);

  const revokeReplayBlobUrls = useCallback(() => {
    for (const url of replayBlobUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    replayBlobUrlsRef.current = [];
  }, []);

  /** Revoke blob URLs no longer referenced by stored turns (keep pending local audio). */
  const revokeUnreferencedReplayBlobUrls = useCallback(() => {
    const referenced = new Set<string>();
    for (const turn of storedTurnsRef.current) {
      for (const segment of turn.segments) {
        if (segment.audioUrl?.startsWith("blob:")) {
          referenced.add(segment.audioUrl);
        }
      }
    }

    const kept: string[] = [];
    for (const url of replayBlobUrlsRef.current) {
      if (referenced.has(url)) {
        kept.push(url);
      } else {
        URL.revokeObjectURL(url);
      }
    }
    replayBlobUrlsRef.current = kept;
  }, [storedTurnsRef]);

  const persistTurnForReplay = useCallback(
    (
      question: string,
      rawResponse: string,
      recordedSegments: RecordedSegmentPayload[],
    ): StoredTurn => {
      const orderIndex = storedTurnsRef.current.length;
      return buildLocalStoredTurn(
        {
          question,
          rawResponse,
          speedMultiplier: speedRef.current,
          segments: recordedSegments,
        },
        orderIndex,
        registerReplayBlobUrl,
      );
    },
    [registerReplayBlobUrl, storedTurnsRef, speedRef],
  );

  const executeCommandRef = useRef(executeCommand);
  useEffect(() => {
    executeCommandRef.current = executeCommand;
  }, [executeCommand]);

  const restoreBoardFromApi = useCallback(
    async (boardId: string, generation: number) => {
      const isStale = () =>
        generation !== restoreGenerationRef.current ||
        boardId !== activeSessionIdRef.current;

      try {
        let detail = await fetchBoardDetail(boardId);
        if (isStale()) return;

        if (!detail) {
          await createBoard(boardId);
          if (isStale()) return;
          detail = await fetchBoardDetail(boardId);
        }

        if (isStale()) return;

        if (!detail) {
          return;
        }

        storedTurnsRef.current = detail.turns;
        setStoredTurnsCount(detail.turns.length);
        // Reset the input overlay state for the restored board: a board with no
        // turns shows the Accelute landing (inputInteracted=false), while a board
        // with prior turns shows the doubt InputBar (inputInteracted=true).
        setInputInteracted(detail.turns.length > 0);
        conversationHistoryRef.current = detail.turns.map((turn) => ({
          user: turn.question,
          assistant: lessonNarrationText(turn.rawResponse),
        }));

        const lastTurn = detail.turns[detail.turns.length - 1];
        const lastNarration = lastTurn
          ? lessonNarrationText(lastTurn.rawResponse)
          : "";

        whiteboardRef.current?.clearBoard();
        resetBoardLayout(false, false);
        notesEpochsRef.current = [];
        narrationSinceEpochRef.current = "";
        setNarrationText(lastNarration);
        setCurrentSegmentText("");

        if (detail.turns.length === 0) {
          return;
        }

        const whiteboardReady = await waitForWhiteboard(whiteboardRef);
        if (isStale()) return;
        if (!whiteboardReady) {
          return;
        }

        for (const turn of detail.turns) {
          if (isStale()) return;

          for (const segment of turn.segments) {
            if (isStale()) return;

            const commands = parseStoredSegmentCommands(segment.command);
            const trustedDiagramGeometry = isStoredCommandTrustedGeometry(segment.command);
            for (const command of commands) {
              if (isStale() || cancelRef.current) {
                return;
              }

              await executeCommandRef.current(command, {
                durationScale: 0.05,
                applyLayout: false,
                trustedDiagramGeometry,
                isCancelled: isStale,
              });
            }
          }
        }

        if (isStale()) return;
      } catch {
        // Network-level fetch failures must still clear the loading overlay.
      } finally {
        if (!isStale()) {
          setBoardLoaded(true);
        }
      }
    },
    [
      resetBoardLayout,
      whiteboardRef,
      cancelRef,
      storedTurnsRef,
      conversationHistoryRef,
      notesEpochsRef,
      narrationSinceEpochRef,
      setNarrationText,
      setCurrentSegmentText,
      setStoredTurnsCount,
      setInputInteracted,
    ],
  );

  const restoreBoardFromApiRef = useRef(restoreBoardFromApi);
  useEffect(() => {
    restoreBoardFromApiRef.current = restoreBoardFromApi;
  }, [restoreBoardFromApi]);

  useEffect(() => {
    return () => {
      revokeReplayBlobUrls();
    };
  }, [revokeReplayBlobUrls]);

  // Reset board state when sessionId changes. Using the "adjust state during
  // render" pattern recommended by React docs — safe because React re-renders
  // immediately before committing.
  const [prevSessionId, setPrevSessionId] = useState(sessionId);
  if (sessionId !== prevSessionId) {
    setPrevSessionId(sessionId);
    setBoardLoaded(false);
    setStoredTurnsCount(0);
    setInputInteracted(false);
  }

  useEffect(() => {
    if (!sessionId) return;

    const generation = ++restoreGenerationRef.current;
    stopTurnRef.current?.();
    revokeReplayBlobUrls();
    cancelRef.current = false;

    queueMicrotask(() => {
      void restoreBoardFromApiRef.current(sessionId, generation);
    });
  }, [sessionId, cancelRef, stopTurnRef, revokeReplayBlobUrls]);

  return {
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
    revokeReplayBlobUrls,
    revokeUnreferencedReplayBlobUrls,
    persistTurnForReplay,
  };
}
