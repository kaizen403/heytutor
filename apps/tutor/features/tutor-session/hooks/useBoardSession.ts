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
  type TutorVoicePreferences,
} from "@heytutor/tutor-core";
import type { NotesEpoch } from "@/lib/client/exportNotesPdf";
import { buildLocalStoredTurn } from "@/lib/replay/replayTurns";
import { boardPath, draftBoardPath } from "@/features/tutor-session/lib/board/boardRoute";
import {
  sortBoards,
  withArchived,
  withPinned,
  type BoardEntry,
} from "@/lib/boards/types";
import {
  createBoard,
  deleteBoardApi,
  updateBoard,
  fetchBoardDetail,
  fetchBoards,
  type RecordedSegmentPayload,
  type SceneVisualStatus,
  type StoredTurn,
} from "@/lib/boards/boardsClient";
import { storedCodeLessonPlan } from "@/lib/code-lesson/persistedCodeLesson";
import type { CodeLessonController } from "../lib/code-lesson/codeLessonController";
import { restoreDsaFrames } from "../lib/code-lesson/dsaFrames";
import type { TutorPhase } from "../types";
import { waitForWhiteboard } from "../lib/board/whiteboardReady";

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

export interface UseBoardSessionParams {
  sessionId: string;
  /** Home board: a real board with no database row and no `/c/` URL yet. */
  isDraft?: boolean;
  /** Mint a fresh home board and route to it, optionally carrying a question. */
  startDraftBoard?: (question?: string) => void;
  router: AppRouterInstance;
  phase: TutorPhase;
  speedMultiplier: number;
  /** Capture TTS without speaker playback. */
  muted?: boolean;
  whiteboardRef: RefObject<WhiteboardHandle | null>;
  cancelRef: RefObject<boolean>;
  notesEpochsRef: RefObject<NotesEpoch[]>;
  narrationSinceEpochRef: RefObject<string>;
  liveQuestionRef: RefObject<string>;
  /** Snapshot the current board as a notes page (see `useBoardLayout`). */
  captureNotesEpoch: () => boolean;
  ttsClientRef: RefObject<TTSClient | null>;
  /** Language/accent/latency from Settings; applied on first client create. */
  voicePreferencesRef: RefObject<TutorVoicePreferences>;
  speedRef: RefObject<number>;
  stopTurnRef: RefObject<(() => void) | null>;
  replayAudioRef: RefObject<HTMLAudioElement | null>;
  replayAudioPreloadRef: RefObject<Map<string, HTMLAudioElement>>;
  setNarrationText: Dispatch<SetStateAction<string>>;
  setCurrentSegmentText: Dispatch<SetStateAction<string>>;
  resetBoardLayout: (keepHeading?: boolean, forceSequentialWorkLayout?: boolean) => void;
  executeCommand: ExecuteCommand;
  /**
   * Watch auto-replay paints ink from the timeline. Instant restore would
   * dump the finished board (no pen) and then fight the replay clock.
   */
  skipInkRestoreRef?: RefObject<boolean>;
  /** Restored DSA turns re-commit their persisted CodeLessonPlan here. */
  codeLessonControllerRef?: RefObject<CodeLessonController | null>;
}

export function useBoardSession({
  sessionId,
  isDraft = false,
  startDraftBoard,
  router,
  phase,
  speedMultiplier,
  muted = false,
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
  const isDraftRef = useRef(isDraft);

  useEffect(() => {
    activeSessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    isDraftRef.current = isDraft;
  }, [isDraft]);

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
    (question = "") => {
      // Already sitting on the unsaved home board: ask it here rather than
      // throwing away a blank board to mint another blank board.
      if (isDraft && storedTurnsCount === 0 && !question.trim()) return;
      if (startDraftBoard) {
        startDraftBoard(question);
        return;
      }
      router.push(draftBoardPath(question));
    },
    [isDraft, storedTurnsCount, startDraftBoard, router],
  );

  const createNewBoard = useCallback(() => {
    openBoard();
  }, [openBoard]);

  const startNextQuestion = useCallback(
    (question: string) => {
      openBoard(question);
    },
    [openBoard],
  );

  /**
   * The home board becomes real: its row is written and it takes over the URL.
   * `replaceState` rather than a route push — a navigation here would remount
   * the shell and kill the turn that just started.
   */
  const committedDraftRef = useRef<string | null>(null);
  const commitDraftBoard = useCallback(async (): Promise<boolean> => {
    if (!isDraft || committedDraftRef.current === sessionId) return false;

    const board = await createBoard(sessionId);
    if (!board) return false;

    committedDraftRef.current = sessionId;
    setBoards((prev) => [board, ...prev.filter((b) => b.id !== board.id)]);
    window.history.replaceState(null, "", boardPath(board.id));
    return true;
  }, [isDraft, sessionId]);

  const switchBoard = useCallback(
    (id: string) => {
      if (id === sessionId) return;
      router.push(boardPath(id));
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
            router.push(boardPath(remaining[0]!.id));
          } else {
            openBoard();
          }
        }
      })();
    },
    [sessionId, router, openBoard, phase, stopTurnRef, boards],
  );

  /**
   * Pin, archive and rename all follow the same shape: update the list right
   * away so the row moves under the click, then roll back if the write fails.
   * Waiting on the round trip made the sidebar feel broken on a slow network.
   */
  const applyBoardPatch = useCallback(
    (
      id: string,
      optimistic: (board: BoardEntry) => BoardEntry,
      patch: { title?: string; pinned?: boolean; archived?: boolean },
    ) => {
      void (async () => {
        const previous = boards;
        setBoards(sortBoards(boards.map((b) => (b.id === id ? optimistic(b) : b))));
        const updated = await updateBoard(id, patch);
        if (!updated) {
          setBoards(previous);
          return;
        }
        setBoards((current) =>
          sortBoards(current.map((b) => (b.id === id ? { ...b, ...updated } : b))),
        );
      })();
    },
    [boards, setBoards],
  );

  const togglePinBoard = useCallback(
    (id: string) => {
      const board = boards.find((b) => b.id === id);
      if (!board) return;
      const pinned = board.pinnedAt == null;
      applyBoardPatch(id, (b) => withPinned(b, pinned), { pinned });
    },
    [boards, applyBoardPatch],
  );

  const toggleArchiveBoard = useCallback(
    (id: string) => {
      const board = boards.find((b) => b.id === id);
      if (!board) return;
      const archived = board.archivedAt == null;
      applyBoardPatch(id, (b) => withArchived(b, archived), { archived });
    },
    [boards, applyBoardPatch],
  );

  const renameBoard = useCallback(
    (id: string, title: string) => {
      const next = title.trim().slice(0, 200);
      if (!next) return;
      applyBoardPatch(id, (b) => ({ ...b, title: next }), { title: next });
    },
    [applyBoardPatch],
  );

  const ensureTTSClient = useCallback((): TTSClient => {
    if (!ttsClientRef.current) {
      ttsClientRef.current = createTTSClient({
        muted,
        voicePreferences: voicePreferencesRef.current,
      });
    } else {
      ttsClientRef.current.setMuted?.(muted);
    }
    ttsClientRef.current.setPlaybackRate(speedRef.current);
    return ttsClientRef.current;
  }, [ttsClientRef, voicePreferencesRef, speedRef, muted]);

  // Create the TTS client once on mount only. Re-creating it when `muted`
  // flips (promoting a headless lecture to Watch Live) runs the cleanup's
  // stop(), closing the WebSocket relay and silencing live playback.
  useEffect(() => {
    ensureTTSClient();

    return () => {
      ttsClientRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply mute changes reactively without tearing down the connection.
  useEffect(() => {
    ttsClientRef.current?.setMuted?.(muted);
  }, [muted, ttsClientRef]);

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
      scene?: {
        sceneDocument?: unknown | null;
        sceneEngineVersion?: string | null;
        validationReport?: unknown | null;
        visualStatus?: SceneVisualStatus | null;
        sceneArtifacts?: unknown | null;
      },
    ): StoredTurn => {
      const orderIndex = storedTurnsRef.current.length;
      return buildLocalStoredTurn(
        {
          question,
          rawResponse,
          speedMultiplier: speedRef.current,
          segments: recordedSegments,
          ...scene,
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
    async (boardId: string, generation: number, draft: boolean) => {
      const isStale = () =>
        generation !== restoreGenerationRef.current ||
        boardId !== activeSessionIdRef.current;

      try {
        // An unsaved home board has nothing to fetch and must not be written:
        // it starts empty, and only a question puts it in the database.
        let detail = draft ? null : await fetchBoardDetail(boardId);
        if (isStale()) return;

        if (!detail && !draft) {
          await createBoard(boardId);
          if (isStale()) return;
          detail = await fetchBoardDetail(boardId);
        }

        if (isStale()) return;

        if (!detail && !draft) {
          return;
        }

        const turns = detail?.turns ?? [];

        storedTurnsRef.current = turns;
        setStoredTurnsCount(turns.length);
        // Reset the input overlay state for the restored board: a board with no
        // turns shows the Accelute landing (inputInteracted=false), while a board
        // with prior turns shows the doubt InputBar (inputInteracted=true).
        setInputInteracted(turns.length > 0);
        conversationHistoryRef.current = turns.map((turn) => ({
          user: turn.question,
          assistant: lessonNarrationText(turn.rawResponse),
        }));

        const lastTurn = turns[turns.length - 1];
        const lastNarration = lastTurn
          ? lessonNarrationText(lastTurn.rawResponse)
          : "";

        notesEpochsRef.current = [];
        narrationSinceEpochRef.current = lastNarration;
        liveQuestionRef.current = lastTurn?.question ?? "";
        setNarrationText(lastNarration);
        setCurrentSegmentText("");

        const whiteboardReady = await waitForWhiteboard(whiteboardRef);
        if (isStale()) return;
        if (!whiteboardReady) {
          return;
        }

        await whiteboardRef.current?.clearBoard();
        resetBoardLayout(false, false);
        codeLessonControllerRef?.current?.reset();

        if (turns.length === 0 || skipInkRestoreRef?.current) {
          return;
        }

        // Each stored turn is one notes page. Snapshot the previous turn's ink
        // before this turn's CLEAR wipes it, so Download notes survives a reload.
        let restoredInk = false;
        for (const turn of turns) {
          if (isStale()) return;
          if (restoredInk) {
            captureNotesEpoch();
            restoredInk = false;
          }
          liveQuestionRef.current = turn.question;
          narrationSinceEpochRef.current = lessonNarrationText(turn.rawResponse);

          // A DSA turn's TYPE commands reveal blocks of this plan; committing
          // it first also brings the code panel back for the restored board.
          const codeLesson = storedCodeLessonPlan(turn.sceneArtifacts);
          const controller = codeLessonControllerRef?.current;
          if (codeLesson) {
            controller?.commit(codeLesson);
          } else {
            controller?.reset();
          }
          // The restored board replays this turn's FRAME cues, so it needs the
          // same walk-through the live turn compiled.
          if (controller) restoreDsaFrames(controller, turn, codeLesson);

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
              if (command.type !== "CLEAR") {
                restoredInk = true;
              }
            }
          }

          // The lesson already finished when it was recorded: restored panels
          // open in "complete" mode so type-along is immediately available.
          if (codeLesson) {
            codeLessonControllerRef?.current?.markLessonComplete();
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
      liveQuestionRef,
      captureNotesEpoch,
      setNarrationText,
      setCurrentSegmentText,
      setStoredTurnsCount,
      setInputInteracted,
      skipInkRestoreRef,
      codeLessonControllerRef,
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

    // Read through a ref, and never depend on it: claiming the URL flips
    // `isDraft` mid-lesson, and re-running this would stop the turn that just
    // claimed it and wipe the board out from under the student.
    const draft = isDraftRef.current && committedDraftRef.current !== sessionId;
    queueMicrotask(() => {
      void restoreBoardFromApiRef.current(sessionId, generation, draft);
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
    togglePinBoard,
    toggleArchiveBoard,
    renameBoard,
    commitDraftBoard,
    ensureTTSClient,
    registerReplayBlobUrl,
    revokeReplayBlobUrls,
    revokeUnreferencedReplayBlobUrls,
    persistTurnForReplay,
  };
}
