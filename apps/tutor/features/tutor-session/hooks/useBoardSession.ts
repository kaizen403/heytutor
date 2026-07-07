import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import { lessonNarrationText, parseStoredSegmentCommands } from "@heytutor/drawing";
import {
  createTTSClient,
  type ConversationExchange,
  type TTSClient,
} from "@heytutor/tutor-core";
import type { NotesEpoch } from "@/lib/exportNotesPdf";
import { buildLocalStoredTurn } from "@/lib/replayTurns";
import type { BoardEntry } from "@/components/BoardHistory";
import {
  createBoard,
  deleteBoardApi,
  fetchBoardDetail,
  fetchBoards,
  type RecordedSegmentPayload,
  type StoredTurn,
} from "@/lib/boardsClient";
import type { TutorPhase } from "../types";

type ExecuteCommandOptions = {
  durationScale?: number;
  applyLayout?: boolean;
};

type ExecuteCommand = (
  command: import("@heytutor/drawing").DrawCommand,
  options?: ExecuteCommandOptions,
) => Promise<void>;

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
    speedRef.current = speedMultiplier;
    ttsClientRef.current?.setPlaybackRate(speedMultiplier);
  }, [speedMultiplier, speedRef, ttsClientRef]);

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

  const createNewBoard = useCallback(() => {
    void (async () => {
      const unused = boards.find(
        (b) => b.title === "new board" && !b.preview,
      );
      if (unused) {
        if (unused.id === sessionId) return;
        router.push(`/c/${unused.id}`);
        return;
      }
      const board = await createBoard();
      if (!board) return;
      setBoards((prev) => [board, ...prev.filter((b) => b.id !== board.id)]);
      router.push(`/c/${board.id}`);
    })();
  }, [boards, sessionId, router]);

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

        let remaining: BoardEntry[] = [];
        setBoards((prev) => {
          remaining = prev.filter((b) => b.id !== id);
          return remaining;
        });

        if (id === sessionId) {
          if (remaining.length > 0) {
            router.push(`/c/${remaining[0]!.id}`);
          } else {
            createNewBoard();
          }
        }
      })();
    },
    [sessionId, router, createNewBoard, phase, stopTurnRef],
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

  const restoreBoardFromApi = useCallback(
    async (boardId: string, generation: number) => {
      const isStale = () =>
        generation !== restoreGenerationRef.current ||
        boardId !== activeSessionIdRef.current;

      setBoardLoaded(false);

      let detail = await fetchBoardDetail(boardId);
      if (isStale()) return;

      if (!detail) {
        await createBoard(boardId);
        if (isStale()) return;
        detail = await fetchBoardDetail(boardId);
      }

      if (isStale()) return;

      if (!detail) {
        setBoardLoaded(true);
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
        setBoardLoaded(true);
      }

      for (const turn of detail.turns) {
        if (isStale()) return;

        for (const segment of turn.segments) {
          if (isStale()) return;

          const commands = parseStoredSegmentCommands(segment.command);
          for (const command of commands) {
            if (isStale() || cancelRef.current) {
              return;
            }

            await executeCommand(command, { durationScale: 0.05, applyLayout: false });
          }
        }
      }

      if (isStale()) return;

      setBoardLoaded(true);
    },
    [
      executeCommand,
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

  useEffect(() => {
    return () => {
      revokeReplayBlobUrls();
    };
  }, [revokeReplayBlobUrls]);

  useEffect(() => {
    if (!sessionId) return;

    const generation = ++restoreGenerationRef.current;
    stopTurnRef.current?.();
    revokeReplayBlobUrls();
    cancelRef.current = false;

    queueMicrotask(() => {
      void restoreBoardFromApi(sessionId, generation);
    });
  }, [sessionId, restoreBoardFromApi, cancelRef, stopTurnRef, revokeReplayBlobUrls]);

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
    switchBoard,
    deleteBoard,
    ensureTTSClient,
    registerReplayBlobUrl,
    revokeReplayBlobUrls,
    persistTurnForReplay,
  };
}
