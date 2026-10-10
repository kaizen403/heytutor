import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import {
  isStoredCommandTrustedGeometry,
  lessonNarrationText,
  parseStoredSegmentCommands,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import {
  compactConversationHistory,
  createTTSClient,
  type ConversationExchange,
  type TTSClient,
  type TutorVoicePreferences,
} from "@heytutor/tutor-core";
import type { NotesEpoch } from "@/lib/client/exportNotesPdf";
import { buildLocalStoredTurn, enrichStoredSegmentsWithReplayAudio, releaseReplayAudioBytes } from "@/lib/replay/replayTurns";
import { boardPath, draftBoardPath, isUntouchedHomeBoard } from "@/features/tutor-session/lib/board/boardRoute";
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
  storedTurnStatus,
  type RecordedSegmentPayload,
  type SceneVisualStatus,
  type StoredTurn,
} from "@/lib/boards/boardsClient";
import {
  pageTurnsEndingAt,
  storedTurnContinuesBoard,
  storedTurnPageQuestion,
} from "@/lib/boards/boardContinuation";
import { storedCodeLessonPlan } from "@/lib/code-lesson/persistedCodeLesson";
import type { CodeLessonController } from "../lib/code-lesson/codeLessonController";
import { restoreDsaFrames } from "../lib/code-lesson/dsaFrames";
import { restoreVerifiedDiagramFromTurn } from "../lib/scene/restoreVerifiedDiagram";
import type { TutorPhase } from "../types";
import { waitForWhiteboard } from "../lib/board/whiteboardReady";
import { overlayLiveTurnEvent, liveTurnSave, type LiveTurnMirrorEvent, type LiveTurnSnapshot } from "../lib/turn/liveTurnSave";
import { IDLE_SAVE, type SaveStatus } from "../lib/turn/saveStatus";

/** How long reopening a board waits for its own unsent saves before reading it. */
const RESTORE_SAVE_DRAIN_MS = 8_000;

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
  /** The student opened a saved board, so a New board hold must let that route through. */
  onChooseBoard?: (id: string) => void;
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
  stopTurnRef: RefObject<
    ((options?: { keepVisibleBoard?: boolean; supersede?: boolean }) => void) | null
  >;
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
  activeVerifiedDiagramRef?: RefObject<VerifiedDiagram | null>;
  setActiveVerifiedDiagram?: (diagram: VerifiedDiagram | null) => void;
  fbdPhaseStartedRef?: RefObject<boolean>;
}

export function useBoardSession({
  sessionId,
  isDraft = false,
  startDraftBoard,
  onChooseBoard,
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
  activeVerifiedDiagramRef,
  setActiveVerifiedDiagram,
  fbdPhaseStartedRef,
}: UseBoardSessionParams) {
  const [boards, setBoards] = useState<BoardEntry[]>([]);
  const [boardLoaded, setBoardLoaded] = useState(false);
  const storedTurnsRef = useRef<StoredTurn[]>([]);
  const [storedTurnsCount, setStoredTurnsCount] = useState(0);
  const conversationHistoryRef = useRef<ConversationExchange[]>([]);
  const [inputInteracted, setInputInteracted] = useState(false);
  const replayBlobUrlsRef = useRef<string[]>([]);
  const restoreGenerationRef = useRef(0);
  /**
   * The restored page's ink loop while it runs. Replay stops it and waits for
   * it before clearing the board: a row the loop writes after replay's layout
   * reset re-enters the work column and pushes every replayed row down.
   */
  const restoreInkRef = useRef<{ cancelled: boolean; done: Promise<void> } | null>(null);
  const activeSessionIdRef = useRef(sessionId);
  const isDraftRef = useRef(isDraft);
  // Commit the active board before paint and before asynchronous continuations.
  // An abandoned concurrent render must not change these ownership checks.
  useLayoutEffect(() => {
    activeSessionIdRef.current = sessionId;
    isDraftRef.current = isDraft;
  }, [sessionId, isDraft]);

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
      // throwing away a blank board to mint another blank board. A lesson that
      // was stopped before its turn was saved still counts as used.
      const untouchedHome = isUntouchedHomeBoard({
        isDraft,
        storedTurnsCount,
        inputInteracted,
        phaseIsIdle: phase === "idle",
        question,
        boardTitle: boards.find((board) => board.id === sessionId)?.title,
      });
      if (untouchedHome) return;
      // Leaving is an event boundary: a save resolving before React commits
      // the next board must already be unable to claim the old board's URL.
      activeSessionIdRef.current = "";
      // Idle stop used to return before invalidating the turn. Stragglers then
      // woke on the new board once restore cleared the cancel flag.
      stopTurnRef.current?.({ supersede: true });
      if (startDraftBoard) {
        startDraftBoard(question);
        return;
      }
      router.push(draftBoardPath(question));
    },
    [isDraft, storedTurnsCount, inputInteracted, phase, boards, sessionId, startDraftBoard, router, stopTurnRef],
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

    setBoards((prev) => [board, ...prev.filter((b) => b.id !== board.id)]);
    // New board already left this lesson. Claiming its URL now would put
    // `/c/{id}` back in the bar and the router can snap the screen back to it.
    // Leave the commit marker alone too, so the board now on screen can still
    // claim its own URL.
    if (activeSessionIdRef.current !== sessionId) return true;
    committedDraftRef.current = sessionId;
    // Keep Next's history state. A null state desyncs the App Router and can
    // remount the session layout, which kills the turn that just claimed the URL.
    window.history.replaceState(window.history.state ?? {}, "", boardPath(board.id));
    return true;
  }, [isDraft, sessionId]);

  const switchBoard = useCallback(
    (id: string) => {
      if (id === sessionId) return;
      activeSessionIdRef.current = id;
      onChooseBoard?.(id);
      router.push(boardPath(id));
    },
    [sessionId, router, onChooseBoard],
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
            onChooseBoard?.(remaining[0]!.id);
            router.push(boardPath(remaining[0]!.id));
          } else {
            openBoard();
          }
        }
      })();
    },
    [sessionId, router, openBoard, phase, stopTurnRef, boards, onChooseBoard],
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

  // A running turn can retain the first render's callback. Read the current
  // mute state so opening Watch Live cannot be undone by the next segment.
  const mutedRef = useRef(muted);
  const ensureTTSClient = useCallback((): TTSClient => {
    if (!ttsClientRef.current) {
      ttsClientRef.current = createTTSClient({
        muted: mutedRef.current,
        voicePreferences: voicePreferencesRef.current,
      });
    } else {
      ttsClientRef.current.setMuted?.(mutedRef.current);
    }
    ttsClientRef.current.setPlaybackRate(speedRef.current);
    return ttsClientRef.current;
  }, [ttsClientRef, voicePreferencesRef, speedRef]);

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
    mutedRef.current = muted;
    ttsClientRef.current?.setMuted?.(muted);
  }, [muted, ttsClientRef]);

  const registerReplayBlobUrl = useCallback((url: string) => {
    replayBlobUrlsRef.current.push(url);
  }, []);

  const revokeReplayBlobUrls = useCallback(() => {
    for (const url of replayBlobUrlsRef.current) {
      URL.revokeObjectURL(url);
      releaseReplayAudioBytes(url);
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
        releaseReplayAudioBytes(url);
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

  /**
   * The live save's local copy of a stopped or finished turn, so replay, notes,
   * downloads and the next doubt see it at once. Only onto the board that turn
   * belongs to, and only while that board is open: a lesson stopped by a board
   * switch must not land among the next board's turns. Replaced in place by
   * the server's answer (with the clips still played from memory).
   */
  const mirrorLiveTurn = useCallback(
    (event: LiveTurnMirrorEvent) => {
      if (event.boardId !== activeSessionIdRef.current) return;
      const existing = storedTurnsRef.current.find((turn) => turn.id === event.turnId);
      let turn: StoredTurn;
      if (event.source === "local") {
        const local = persistTurnForReplay(event.turn.question, event.turn.rawResponse, event.rows, {
          sceneDocument: event.turn.sceneDocument,
          sceneEngineVersion: event.turn.sceneEngineVersion,
          validationReport: event.turn.validationReport,
          visualStatus: event.turn.visualStatus,
          sceneArtifacts: event.turn.sceneArtifacts,
        });
        turn = {
          ...event.turn,
          id: event.turnId,
          orderIndex: existing?.orderIndex ?? local.orderIndex,
          segments: local.segments,
        };
      } else {
        turn = {
          ...event.turn,
          segments: enrichStoredSegmentsWithReplayAudio(event.turn.segments, event.rows, registerReplayBlobUrl),
        };
      }
      storedTurnsRef.current = overlayLiveTurnEvent(storedTurnsRef.current, event, turn);
      setStoredTurnsCount(storedTurnsRef.current.length);
      if (!existing) {
        setBoards((prev) =>
          prev.map((board) => (board.id === event.boardId ? { ...board, preview: event.preview.slice(0, 60) } : board)),
        );
      }
    },
    [persistTurnForReplay, registerReplayBlobUrl, storedTurnsRef],
  );
  const mirrorLiveTurnRef = useRef(mirrorLiveTurn);
  useLayoutEffect(() => {
    mirrorLiveTurnRef.current = mirrorLiveTurn;
  }, [mirrorLiveTurn]);
  useEffect(
    () =>
      liveTurnSave().attach(cancelRef, {
        openBoardId: () => activeSessionIdRef.current,
        mirror: (event) => mirrorLiveTurnRef.current(event),
      }),
    [cancelRef],
  );

  // What the header chip and the failure banner show for the open board.
  const subscribeLiveSave = useCallback((listener: () => void) => liveTurnSave().subscribe(listener), []);
  const saveStatus: SaveStatus = useSyncExternalStore(
    subscribeLiveSave,
    () => liveTurnSave().statusFor(sessionId),
    () => IDLE_SAVE,
  );
  /** A live or stopped turn on this board has a finished step (downloads enable on it). */
  const hasLiveTurn: boolean = useSyncExternalStore(
    subscribeLiveSave,
    () => liveTurnSave().hasLiveTurn(cancelRef, sessionId),
    () => false,
  );
  /** Send this board's failed save again, without teaching again. */
  const retrySave = useCallback(() => {
    liveTurnSave().retry(activeSessionIdRef.current);
  }, []);
  /**
   * The live or just stopped turn on the open board: finished steps only, clips
   * in memory, under its saved turn id. Null once it completed.
   */
  const getLiveTurn = useCallback(
    (): LiveTurnSnapshot | null => liveTurnSave().liveTurnFor(cancelRef, activeSessionIdRef.current),
    [cancelRef],
  );

  const executeCommandRef = useRef(executeCommand);
  useEffect(() => {
    executeCommandRef.current = executeCommand;
  }, [executeCommand]);

  const restoreBoardFromApi = useCallback(
    async (boardId: string, generation: number, draft: boolean) => {
      if (generation !== restoreGenerationRef.current || boardId !== activeSessionIdRef.current) return;
      let finishInk: () => void = () => {};
      const ink = { cancelled: false, done: new Promise<void>((resolve) => { finishInk = resolve; }) };
      restoreInkRef.current = ink;
      const isStale = () =>
        ink.cancelled ||
        generation !== restoreGenerationRef.current ||
        boardId !== activeSessionIdRef.current;

      try {
        // An unsaved home board has nothing to fetch and must not be written:
        // it starts empty, and only a question puts it in the database.
        // A lesson stopped here a moment ago may still be on its way to the
        // server: read the board after it lands (or after a short wait).
        if (!draft) await liveTurnSave().drained(boardId, RESTORE_SAVE_DRAIN_MS);
        if (isStale()) return;
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

        // The server copy, with this tab's own ended turns laid over it where
        // their save failed or has not landed yet: the board, replay, notes
        // and Continue keep what the student saw, and the save goes on.
        storedTurnsRef.current = detail?.turns ?? [];
        if (!draft) {
          for (const local of liveTurnSave().reopen(boardId)) mirrorLiveTurnRef.current(local);
        }
        const turns = storedTurnsRef.current;

        storedTurnsRef.current = turns;
        setStoredTurnsCount(turns.length);
        // Reset the input overlay state for the restored board: a board with no
        // turns shows the Accelute landing (inputInteracted=false), while a board
        // with prior turns shows the doubt InputBar (inputInteracted=true).
        setInputInteracted(turns.length > 0);
        conversationHistoryRef.current = compactConversationHistory(
          turns.map((turn) => ({
            user: turn.question,
            assistant: lessonNarrationText(turn.rawResponse),
          })),
        );

        const lastTurn = turns[turns.length - 1];
        const lastNarration = lastTurn
          ? lessonNarrationText(lastTurn.rawResponse)
          : "";
        // The page on screen is the last turn's page, which may be a lesson
        // and the doubts answered under it.
        const lastPageNarration = pageTurnsEndingAt(turns)
          .map((turn) => lessonNarrationText(turn.rawResponse).trim())
          .filter(Boolean)
          .join(" ");

        notesEpochsRef.current = [];
        narrationSinceEpochRef.current = lastPageNarration || lastNarration;
        liveQuestionRef.current = lastTurn ? storedTurnPageQuestion(lastTurn) : "";
        setNarrationText(lastNarration);
        setCurrentSegmentText("");

        const whiteboardReady = await waitForWhiteboard(whiteboardRef, 8_000, isStale);
        if (isStale()) return;
        if (!whiteboardReady) {
          return;
        }

        await whiteboardRef.current?.clearBoard();
        if (isStale()) return;
        resetBoardLayout(false, false);
        codeLessonControllerRef?.current?.reset();

        // The overlay is "loading the board", and it only leaves when this
        // flag flips. Ink after this is the finished page, drawn with no
        // stroke delays, so it should not keep the spinner up.
        if (!isStale()) setBoardLoaded(true);

        if (turns.length === 0 || skipInkRestoreRef?.current) {
          return;
        }

        // Each page is one notes page. Snapshot the previous page's ink before
        // this turn's CLEAR wipes it, so Download notes survives a reload. A
        // doubt answered on the lesson's page is part of that page: same notes
        // page, same question, same figure and code panel.
        let restoredInk = false;
        const inkStale = () => isStale() || ink.cancelled;
        for (const turn of turns) {
          if (inkStale()) return;
          const continuesPage = storedTurnContinuesBoard(turn);
          if (restoredInk && !continuesPage) {
            captureNotesEpoch();
            restoredInk = false;
          }
          liveQuestionRef.current = storedTurnPageQuestion(turn);
          const turnNarration = lessonNarrationText(turn.rawResponse);
          narrationSinceEpochRef.current = continuesPage
            ? [narrationSinceEpochRef.current, turnNarration]
                .map((part) => part.trim())
                .filter(Boolean)
                .join(" ")
            : turnNarration;

          // A DSA turn's TYPE commands reveal blocks of this plan; committing
          // it first also brings the code panel back for the restored board.
          const codeLesson = continuesPage ? null : storedCodeLessonPlan(turn.sceneArtifacts);
          if (!continuesPage) {
            const controller = codeLessonControllerRef?.current;
            if (codeLesson) {
              controller?.commit(codeLesson);
            } else {
              controller?.reset();
            }
            // The restored board replays this turn's FRAME cues, so it needs the
            // same walk-through the live turn compiled.
            if (controller) restoreDsaFrames(controller, turn, codeLesson);
            const diagram =
              controller?.frames.current()?.presentation.diagram
              ?? restoreVerifiedDiagramFromTurn(turn);
            if (activeVerifiedDiagramRef) {
              activeVerifiedDiagramRef.current = diagram;
            }
            setActiveVerifiedDiagram?.(diagram);
            if (fbdPhaseStartedRef) {
              fbdPhaseStartedRef.current = Boolean(diagram);
            }
          }

          for (const segment of turn.segments) {
            if (inkStale()) return;

            const commands = parseStoredSegmentCommands(segment.command);
            const trustedDiagramGeometry = isStoredCommandTrustedGeometry(segment.command);
            for (const command of commands) {
              if (inkStale() || cancelRef.current) {
                return;
              }

              // The boot face covers the board until this loop ends, so no
              // one sees it: stamp finished ink. Any other scale still plays
              // every FOCUS tour and pen swap at full length behind the loader.
              await executeCommandRef.current(command, {
                durationScale: 0,
                applyLayout: false,
                trustedDiagramGeometry,
                isCancelled: inkStale,
              });
              if (command.type !== "CLEAR") {
                restoredInk = true;
              }
            }
          }

          // A finished lesson opens its panel in "complete" mode so type-along
          // is available at once. A stopped one has more to teach.
          if (codeLesson && storedTurnStatus(turn) === "complete") {
            codeLessonControllerRef?.current?.markLessonComplete();
          }
        }

        if (isStale()) return;
      } catch {
        // Network-level fetch failures must still clear the loading overlay.
      } finally {
        if (restoreInkRef.current === ink) restoreInkRef.current = null;
        finishInk();
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
      activeVerifiedDiagramRef,
      setActiveVerifiedDiagram,
      fbdPhaseStartedRef,
    ],
  );

  /**
   * Stop every phase of restoration and wait for its last mutation, including
   * a pending initial clear. Fetched turns and conversation history remain.
   */
  const settleBoardRestore = useCallback(async (): Promise<void> => {
    // Also invalidate a queued restore that has not registered its work yet.
    const generation = ++restoreGenerationRef.current;
    const ink = restoreInkRef.current;
    if (!ink) return;
    ink.cancelled = true;
    await ink.done;
    if (generation === restoreGenerationRef.current) setBoardLoaded(true);
  }, []);

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
    settleBoardRestore,
    saveStatus,
    retrySave,
    getLiveTurn,
    hasLiveTurn,
  };
}
