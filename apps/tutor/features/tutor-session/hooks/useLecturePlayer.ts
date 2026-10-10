"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import {
  createVirtualWhiteboardClock,
  type CursorState,
  type VirtualWhiteboardClock,
  type WhiteboardHandle,
} from "@heytutor/whiteboard";
import type { VerifiedDiagram } from "@heytutor/drawing";
import type { InkPace } from "@heytutor/tutor-core";
import { applyHtmlAudioPlaybackRate } from "@heytutor/tutor-core";
import type { TurnTelemetry } from "@/lib/obs/turnTelemetry";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { pageTurnsEndingAt, storedTurnContinuesBoard } from "@/lib/boards/boardContinuation";
import { storedCodeLessonPlan } from "@/lib/code-lesson/persistedCodeLesson";
import { renderCodePanelFrame } from "@/lib/code-render/renderCodeToCanvas";
import {
  buildCodeLessonExportTrack,
  codeLessonFrameSpec,
  type CodeLessonExportTrack,
} from "@/lib/lecture-export/codeLessonExportTrack";
import type { ExportExecuteCommand } from "@/lib/lecture-export/drawLectureTimeline";
import {
  buildLecturePlayerTimeline,
  createLecturePlayerStore,
  createSeekQueue,
  createSmoothedMediaClock,
  lecturePlayerKeyAction,
  lecturePaceRate,
  mediaSecondsForSeek,
  audioIsAtMediaEnd,
  planLectureSeek,
  skipTarget,
  LECTURE_PLAYER_SKIP_MS,
  type LecturePlayerControls,
  type LecturePlayerStatus,
  type LecturePlayerStore,
  type LecturePlayerTimeline,
} from "@/lib/replay/lecturePlayer";
import {
  buildLecturePlayerTrack,
  getLecturePlayerTrack,
  lecturePlayerTrackKey,
} from "@/lib/replay/lecturePlayerAudio";
import type { ReplayCue } from "@/lib/replay/replayTimeline";
import { BOARD_HEIGHT, BOARD_WIDTH, DSA_CODE_PANEL_RECT } from "../constants";
import { CodeLessonController } from "../lib/code-lesson/codeLessonController";
import { restoreDsaFrames } from "../lib/code-lesson/dsaFrames";
import { restoreVerifiedDiagramFromTurn } from "../lib/scene/restoreVerifiedDiagram";
import {
  completeReplayDiagramTurn,
  drawReplayDiagramTimeline,
} from "../lib/replay/completeReplayDiagram";
import { isTypingElement } from "../lib/board/boardFullscreen";
import { waitForWhiteboard } from "../lib/board/whiteboardReady";
import { useBoardLayout } from "./useBoardLayout";
import { useCancelControl } from "./useCancelControl";
import { useCommandExecution } from "./useCommandExecution";

/**
 * Seeks walk the board clock up to the target one display frame at a time,
 * the granularity playback runs at. A coarser step starts each glyph later
 * than playback would and lands on a different frame.
 */
const SEEK_STEP_MS = 1000 / 60;
/** How long the board may keep drawing after the voice ends. */
const END_OVERRUN_LIMIT_MS = 15_000;
/** A hidden tab stops animation frames while the voice keeps going. */
const HIDDEN_RESYNC_MS = 800;
const SEEKED_TIMEOUT_MS = 1_500;

type PageCodeTrack = {
  startMs: number;
  endMs: number;
  /** The code panel mounts with the page's first typed block. */
  visibleFromMs: number;
  track: CodeLessonExportTrack;
};

export interface UseLecturePlayerParams {
  sessionId: string;
  storedTurnsRef: RefObject<StoredTurn[]>;
  storedTurnsCount: number;
  /** The board holds a finished, fully recorded lecture and nothing else is running. */
  available: boolean;
  rate: number;
  onRateChange: (rate: number) => void;
  enableKeyboard?: boolean;
}

/** What the board draws for the player: plain data, no refs. */
export interface LecturePlayerView {
  active: boolean;
  revealed: boolean;
  cursorState: CursorState;
  segmentText: string;
}

export interface LecturePlayerApi {
  view: LecturePlayerView;
  playerBoardRef: RefObject<WhiteboardHandle | null>;
  codePanelCanvasRef: RefObject<HTMLCanvasElement | null>;
  freezeCanvasRef: RefObject<HTMLCanvasElement | null>;
  store: LecturePlayerStore;
  controls: LecturePlayerControls;
  /** The player board is mounted over the finished one. */
  active: boolean;
  /** The player board has its first frame and is shown. */
  revealed: boolean;
  /** The voice is running. */
  playing: boolean;
  segmentText: string;
  cursorState: CursorState;
  /** Header Replay and `?replay=1`: play the lecture from its start. */
  playFromStart: () => boolean;
  /** Drop the player and give the board back to the lesson. */
  close: () => void;
  halt: () => void;
}

function isPlayerControlElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (isTypingElement(target)) return true;
  const tag = target.tagName.toUpperCase();
  if (tag === "BUTTON" || tag === "A") return true;
  const role = target.getAttribute("role");
  return role === "slider" || role === "menuitem" || role === "menuitemradio";
}

const macrotaskWaiters: Array<() => void> = [];
let macrotaskChannel: MessageChannel | null = null;

/**
 * Resolves after every queued microtask has run. A timer would be clamped to
 * 4 ms once nested; a message is not.
 */
function nextMacrotask(): Promise<void> {
  if (!macrotaskChannel) {
    macrotaskChannel = new MessageChannel();
    macrotaskChannel.port1.onmessage = () => macrotaskWaiters.shift()?.();
  }
  const channel = macrotaskChannel;
  return new Promise((resolve) => {
    macrotaskWaiters.push(resolve);
    channel.port2.postMessage(null);
  });
}

/**
 * One board frame at the clock's current time, then everything it set off.
 * Playback gets the same from the browser: a frame, then a drained queue
 * before the next one. Seeks must match it or they land elsewhere.
 */
async function settleFrame(clock: VirtualWhiteboardClock): Promise<void> {
  clock.pump();
  await nextMacrotask();
}

function waitForSeeked(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      audio.removeEventListener("seeked", done);
      resolve();
    };
    const timer = window.setTimeout(done, SEEKED_TIMEOUT_MS);
    audio.addEventListener("seeked", done);
    queueMicrotask(() => {
      if (!audio.seeking) done();
    });
  });
}

function scheduleIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback, { timeout: 1_200 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, 200);
  return () => window.clearTimeout(handle);
}

function buildPageCodeTracks(
  turns: StoredTurn[],
  timeline: LecturePlayerTimeline,
): PageCodeTrack[] {
  const tracks: PageCodeTrack[] = [];
  const pages = new Map<number, ReplayCue[]>();
  for (const cue of timeline.cues) {
    const page = timeline.pageStartTurnIndex[cue.turnIndex] ?? cue.turnIndex;
    const cues = pages.get(page) ?? [];
    cues.push(cue);
    pages.set(page, cues);
  }
  for (const [page, cues] of pages) {
    const turn = turns[page];
    if (!turn || cues.length === 0) continue;
    const track = buildCodeLessonExportTrack(turn, cues);
    if (!track || track.blocks.length === 0) continue;
    const firstTyped = cues.find((cue) => cue.commands.some((command) => command.type === "TYPE"));
    tracks.push({
      startMs: cues[0]!.startMs,
      endMs: cues[cues.length - 1]!.endMs,
      visibleFromMs: firstTyped?.startMs ?? cues[0]!.startMs,
      track,
    });
  }
  return tracks;
}

/**
 * Plays a finished lecture on a board of its own, laid over the finished one.
 *
 * One stitched audio file is the clock. Every frame the board's virtual clock
 * is set from the audio position, so ink, the pen and the code panel are a
 * function of lecture time: pausing freezes a stroke mid-letter, a speed change
 * cannot pull voice and ink apart, and a seek lands on the frame playback
 * would have shown at that moment.
 */
export function useLecturePlayer({
  sessionId,
  storedTurnsRef,
  storedTurnsCount,
  available,
  rate,
  onRateChange,
  enableKeyboard = true,
}: UseLecturePlayerParams): LecturePlayerApi {
  const store = useMemo(() => createLecturePlayerStore(), []);
  const seekQueue = useMemo(() => createSeekQueue(), []);
  const smoothClock = useMemo(() => createSmoothedMediaClock(), []);

  const playerBoardRef = useRef<WhiteboardHandle | null>(null);
  const codePanelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const freezeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clockRef = useRef<VirtualWhiteboardClock | null>(null);
  const timelineRef = useRef<LecturePlayerTimeline | null>(null);
  const codeTracksRef = useRef<PageCodeTrack[]>([]);
  const trackReadyRef = useRef(false);

  /** Bumped by every seek and by close: a stale draw loop checks it and stops. */
  const drawGenerationRef = useRef(0);
  /** Bumped by each activation and close, so a late board mount is ignored. */
  const activationRef = useRef(0);
  const supersededRef = useRef(false);
  const activeRef = useRef(false);
  const statusRef = useRef<LecturePlayerStatus>("unavailable");
  const wantsPlayingRef = useRef(false);
  const positionRef = useRef(0);
  const pendingStartRef = useRef<{ ms: number; play: boolean } | null>(null);
  const lastSyncedTurnRef = useRef(-1);
  const lastCueIndexRef = useRef(-1);
  /** The current draw loop has drawn every cue. */
  const drawDoneRef = useRef(true);
  const rateRef = useRef(rate);
  const onRateChangeRef = useRef(onRateChange);

  const cancelRef = useRef(false);
  const speedRef = useRef(1);
  const controllerRef = useRef<CodeLessonController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new CodeLessonController();
  }
  const diagramRef = useRef<VerifiedDiagram | null>(null);
  const fbdMarkedRef = useRef(false);
  const fbdStartedRef = useRef(false);
  const telemetryRef = useRef<TurnTelemetry | null>(null);
  const inkPaceRef = useRef<InkPace>("follow");
  const adaptiveFactorRef = useRef(1);
  const questionRef = useRef("");

  const [active, setActive] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [segmentText, setSegmentText] = useState("");
  // The store changes every frame; selecting the status re-renders only when it does.
  const status = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().status,
    () => store.getSnapshot().status,
  );

  const setPlayerStatus = useCallback(
    (next: LecturePlayerStatus) => {
      statusRef.current = next;
      store.set({ status: next });
    },
    [store],
  );

  useLayoutEffect(() => {
    onRateChangeRef.current = onRateChange;
  }, [onRateChange]);

  const clockNowMs = useCallback(() => clockRef.current?.now() ?? performance.now(), []);

  const boardDelay = useCallback(async (duration: number): Promise<void> => {
    const clock = clockRef.current;
    if (!clock) return;
    const generation = drawGenerationRef.current;
    const start = clock.now();
    while (
      generation === drawGenerationRef.current &&
      !cancelRef.current &&
      clock.now() - start < duration
    ) {
      await clock.waitForAdvance();
    }
  }, []);

  const { raceWithCancel } = useCancelControl(cancelRef);

  const {
    boardLayoutRef,
    notesEpochsRef,
    narrationSinceEpochRef,
    forceSequentialWorkLayoutRef,
    resetBoardLayout,
    forgetErasedTextRects,
    resolveTextPlacement,
  } = useBoardLayout({
    whiteboardRef: playerBoardRef,
    cancelRef,
    fbdPhaseStartedRef: fbdStartedRef,
    liveQuestionRef: questionRef,
    viewportMode: "fixed",
  });

  const { executeCommand } = useCommandExecution({
    whiteboardRef: playerBoardRef,
    cancelRef,
    speedRef,
    boardLayoutRef,
    forceSequentialWorkLayoutRef,
    fbdPhaseMarkedRef: fbdMarkedRef,
    fbdPhaseStartedRef: fbdStartedRef,
    activeVerifiedDiagramRef: diagramRef,
    turnTelemetryRef: telemetryRef,
    notesEpochsRef,
    narrationSinceEpochRef,
    cancellableDelay: boardDelay,
    forgetErasedTextRects,
    resetBoardLayout,
    resolveTextPlacement,
    raceWithCancel,
    inkPaceRef,
    adaptiveFactorRef,
    codeLessonControllerRef: controllerRef,
    nowMs: clockNowMs,
  });

  const executeRef = useRef(executeCommand);
  const resetLayoutRef = useRef(resetBoardLayout);
  useEffect(() => {
    executeRef.current = executeCommand;
    resetLayoutRef.current = resetBoardLayout;
  }, [executeCommand, resetBoardLayout]);

  // The code panel is drawn from lecture time, not typed by a controller, so
  // TYPE only settles the block's state and leaves the typing to the canvas.
  const executePlayerCommand = useCallback<ExportExecuteCommand>(
    (command, options) =>
      executeRef.current(
        command,
        command.type === "TYPE" ? { ...options, durationScale: 0 } : options,
      ),
    [],
  );

  const syncTurn = useCallback(
    (turnIndex: number) => {
      lastSyncedTurnRef.current = turnIndex;
      const turn = storedTurnsRef.current[turnIndex];
      if (turn && storedTurnContinuesBoard(turn)) return;
      questionRef.current = turn?.question ?? "";
      const controller = controllerRef.current!;
      const plan = turn ? storedCodeLessonPlan(turn.sceneArtifacts) : null;
      if (plan) controller.commit(plan);
      else controller.reset();
      restoreDsaFrames(controller, turn, plan);
      const diagram =
        controller.frames.current()?.presentation.diagram ?? restoreVerifiedDiagramFromTurn(turn);
      diagramRef.current = diagram;
      fbdStartedRef.current = Boolean(diagram);
    },
    [storedTurnsRef],
  );

  const publishCueText = useCallback((cues: readonly ReplayCue[], index: number) => {
    if (index === lastCueIndexRef.current) return;
    lastCueIndexRef.current = index;
    setSegmentText(cues[index]?.narration ?? "");
  }, []);

  const renderCodePanel = useCallback((ms: number) => {
    const canvas = codePanelCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const scale = canvas.width / BOARD_WIDTH;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const page = codeTracksRef.current.find(
      (candidate, index, all) =>
        ms >= candidate.startMs &&
        (ms < candidate.endMs || index === all.length - 1),
    );
    if (!page || ms < page.visibleFromMs) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    renderCodePanelFrame(ctx, codeLessonFrameSpec(page.track, ms), DSA_CODE_PANEL_RECT);
  }, []);

  const setFreezeVisible = useCallback((visible: boolean) => {
    const canvas = freezeCanvasRef.current;
    if (canvas) canvas.style.visibility = visible ? "visible" : "hidden";
  }, []);

  const paintFreeze = useCallback(() => {
    const canvas = freezeCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    const frame = playerBoardRef.current?.captureFrame({
      pixelRatio: canvas ? canvas.width / BOARD_WIDTH : 1,
      hideCursor: false,
    });
    if (!canvas || !ctx || !frame) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
    const code = codePanelCanvasRef.current;
    if (code) ctx.drawImage(code, 0, 0, canvas.width, canvas.height);
    return true;
  }, []);

  const drawBoardNow = useCallback(() => {
    playerBoardRef.current?.getDrawLayer()?.getStage()?.draw();
  }, []);

  const startAudio = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !activeRef.current) return;
    applyHtmlAudioPlaybackRate(audio, lecturePaceRate(rateRef.current));
    audio.muted = false;
    const seconds = mediaSecondsForSeek(positionRef.current, audio.duration);
    if (audioIsAtMediaEnd(audio) || Math.abs(audio.currentTime - seconds) > 0.05) {
      try {
        audio.currentTime = seconds;
      } catch {
        // Metadata may not be ready yet; play() still starts from the last seek.
      }
    }
    smoothClock.reset(positionRef.current, performance.now());
    if (!audio.paused && !audio.ended) {
      setPlayerStatus("playing");
      return;
    }
    try {
      await audio.play();
      if (!activeRef.current || seekQueue.busy()) return;
      if (!wantsPlayingRef.current) {
        audio.pause();
        setPlayerStatus("paused");
        return;
      }
      setPlayerStatus("playing");
    } catch {
      // Autoplay was refused (a fresh `?replay=1` load has no gesture yet).
      wantsPlayingRef.current = false;
      if (activeRef.current && !seekQueue.busy()) setPlayerStatus("paused");
    }
  }, [seekQueue, setPlayerStatus, smoothClock]);

  /**
   * Rebuild the board at `targetMs`, exactly as playback would show it.
   * Resolves true when this seek finished; false when a newer seek, a close,
   * or an unmount took over part way.
   */
  const runSeek = useCallback(
    async (targetMs: number): Promise<boolean> => {
      const wb = playerBoardRef.current;
      const clock = clockRef.current;
      const timeline = timelineRef.current;
      const audio = audioRef.current;
      if (!wb || !clock || !timeline || !audio) return false;
      const plan = planLectureSeek(timeline, targetMs);
      if (!plan) return false;

      const generation = ++drawGenerationRef.current;
      const current = () => generation === drawGenerationRef.current && !supersededRef.current;
      const stillOurs = () => generation === drawGenerationRef.current;

      // Keep the element playing (muted) when this seek should resume. A pause
      // here drops the scrub gesture, and play() after the board rebuild is
      // autoplay-blocked: the lecture looks right and the voice never starts.
      if (wantsPlayingRef.current) {
        audio.muted = true;
      } else {
        audio.pause();
        audio.muted = false;
      }
      if (paintFreeze()) setFreezeVisible(true);

      // Let the draw loop this seek replaces see it is stale and stop before
      // the board is wiped, so none of its ink lands on the new frame.
      wb.cancelAnimations();
      await settleFrame(clock);
      await settleFrame(clock);
      if (!current()) return false;

      await wb.clearBoard();
      resetLayoutRef.current(false, false);
      lastSyncedTurnRef.current = -1;
      lastCueIndexRef.current = -1;

      const { cues } = timeline;
      const catchUp = (async () => {
        for (let index = plan.epochCueIndex; index < plan.targetCueIndex; index++) {
          const cue = cues[index]!;
          if (cue.turnIndex !== lastSyncedTurnRef.current) syncTurn(cue.turnIndex);
          for (const command of cue.commands) {
            if (!current()) return;
            // Pure dwell and transient emphasis leave no mark to catch up to.
            // FOCUS also releases permanent verified labels. Its instant
            // executor path skips the gesture while retaining those marks.
            if (command.type === "PAUSE" || command.type === "POINT") {
              continue;
            }
            await executeRef.current(command, {
              durationScale: 0,
              applyLayout: false,
              isCancelled: () => !stillOurs(),
              trustedDiagramGeometry: cue.trustedDiagramGeometry,
            });
          }
          await completeReplayDiagramTurn({
            cue,
            nextCue: cues[index + 1],
            turn: storedTurnsRef.current[cue.turnIndex],
            pageTurns: pageTurnsEndingAt(storedTurnsRef.current, cue.turnIndex),
            diagram: diagramRef.current,
            executeCommand: executePlayerCommand,
            shouldCancel: () => !current(),
            durationScale: 0,
          });
        }
      })();
      // A finished mark still waits a frame for the odd tween with a floor (an
      // instrument swap). The board clock only moves when pumped, so the
      // catch-up drives it in long strides until the marks are all down.
      let caughtUp = false;
      void catchUp.finally(() => {
        caughtUp = true;
      });
      while (!caughtUp) {
        clock.setNow(clock.now() + 1_000);
        await settleFrame(clock);
      }
      await catchUp;
      if (!current()) return false;

      const targetCue = cues[plan.targetCueIndex]!;
      clock.setNow(targetCue.startMs);
      drawDoneRef.current = false;
      void drawReplayDiagramTimeline({
        cues,
        executeCommand: executePlayerCommand,
        getClockMs: clock.now,
        waitForAdvance: clock.waitForAdvance,
        shouldCancel: () => !stillOurs(),
        startCueIndex: plan.targetCueIndex,
        getTurn: (turnIndex) => storedTurnsRef.current[turnIndex],
        getPageTurns: (turnIndex) => pageTurnsEndingAt(storedTurnsRef.current, turnIndex),
        getDiagram: () => diagramRef.current,
        onCueStart: (cue, index) => {
          if (cue.turnIndex !== lastSyncedTurnRef.current) syncTurn(cue.turnIndex);
          if (activeRef.current && statusRef.current !== "seeking") publishCueText(cues, index);
        },
      })
        .catch((error: unknown) => {
          console.error("Lecture player draw failed:", error);
        })
        .finally(() => {
          if (stillOurs()) drawDoneRef.current = true;
        });

      await settleFrame(clock);
      let now = clock.now();
      while (now < plan.targetMs) {
        if (!current()) return false;
        now = Math.min(now + SEEK_STEP_MS, plan.targetMs);
        clock.setNow(now);
        await settleFrame(clock);
      }
      // The end of the lecture is the finished board, including ink that ran
      // past the last word.
      const overrunLimitMs = plan.targetMs + END_OVERRUN_LIMIT_MS;
      while (plan.targetMs >= timeline.totalMs && !drawDoneRef.current && now < overrunLimitMs) {
        if (!current()) return false;
        now += SEEK_STEP_MS;
        clock.setNow(now);
        await settleFrame(clock);
      }
      if (!current()) return false;

      positionRef.current = plan.targetMs;
      renderCodePanel(plan.targetMs);
      publishCueText(cues, plan.targetCueIndex);
      store.set({ positionMs: plan.targetMs });

      try {
        audio.currentTime = mediaSecondsForSeek(plan.targetMs, audio.duration);
      } catch {
        // The blob may not have reported duration yet.
      }
      await waitForSeeked(audio);
      if (!current()) return false;
      audio.muted = false;
      smoothClock.reset(plan.targetMs, performance.now());

      drawBoardNow();
      setRevealed(true);
      setFreezeVisible(false);
      return true;
    },
    [
      drawBoardNow,
      executePlayerCommand,
      paintFreeze,
      publishCueText,
      renderCodePanel,
      setFreezeVisible,
      smoothClock,
      store,
      syncTurn,
      storedTurnsRef,
    ],
  );

  const requestSeek = useCallback(
    (ms: number, play: boolean) => {
      const timeline = timelineRef.current;
      if (!timeline || !activeRef.current) return;
      const target = Math.max(0, Math.min(Number.isFinite(ms) ? ms : 0, timeline.totalMs));
      wantsPlayingRef.current = play;
      positionRef.current = target;
      store.set({ positionMs: target });
      setPlayerStatus("seeking");
      const audio = audioRef.current;
      // Start the voice in this gesture, before the board catch-up awaits.
      // After `ended`, a play() issued seconds later is treated as autoplay.
      if (play && audio && audio.src) {
        audio.muted = true;
        try {
          audio.currentTime = mediaSecondsForSeek(target, audio.duration);
        } catch {
          // ignore
        }
        void audio.play().catch(() => undefined);
      }
      if (!seekQueue.request(target)) {
        supersededRef.current = true;
        return;
      }
      const activation = activationRef.current;
      void (async () => {
        let next: number | null = target;
        let finished = false;
        while (next !== null) {
          supersededRef.current = false;
          finished = await runSeek(next);
          if (activation !== activationRef.current) {
            seekQueue.clear();
            return;
          }
          next = seekQueue.finish();
        }
        if (!finished || !activeRef.current) return;
        const atEnd = positionRef.current >= timeline.totalMs;
        if (atEnd) {
          wantsPlayingRef.current = false;
          setPlayerStatus("ended");
          return;
        }
        if (wantsPlayingRef.current) {
          await startAudio();
        } else {
          setPlayerStatus("paused");
        }
      })();
    },
    [runSeek, seekQueue, setPlayerStatus, startAudio, store],
  );

  const activate = useCallback(
    (ms: number, play: boolean) => {
      if (activeRef.current) {
        requestSeek(ms, play);
        return;
      }
      const activation = ++activationRef.current;
      activeRef.current = true;
      wantsPlayingRef.current = play;
      clockRef.current = createVirtualWhiteboardClock(0);
      setRevealed(false);
      setActive(true);
      store.set({ active: true });
      setPlayerStatus("seeking");
      void (async () => {
        const ready = await waitForWhiteboard(playerBoardRef);
        if (activation !== activationRef.current || !activeRef.current) return;
        const wb = playerBoardRef.current;
        const clock = clockRef.current;
        if (!ready || !wb || !clock) {
          activeRef.current = false;
          setActive(false);
          store.set({ active: false });
          setPlayerStatus("ready");
          return;
        }
        wb.setTimeSource(clock.source);
        wb.setAnimationSpeed(1);
        requestSeek(ms, play);
      })();
    },
    [requestSeek, setPlayerStatus, store],
  );

  const start = useCallback(
    (ms: number, play: boolean) => {
      // A track that failed to load leaves Replay to the in-place engine.
      if (!available || !timelineRef.current || store.getSnapshot().error) return false;
      if (!trackReadyRef.current) {
        pendingStartRef.current = { ms, play };
        wantsPlayingRef.current = play;
        return true;
      }
      activate(ms, play);
      return true;
    },
    [activate, available, store],
  );

  const close = useCallback(() => {
    activationRef.current += 1;
    drawGenerationRef.current += 1;
    seekQueue.clear();
    pendingStartRef.current = null;
    wantsPlayingRef.current = false;
    // Wake the stale draw loop's clock waits so it sees the new generation.
    clockRef.current?.pump();
    playerBoardRef.current?.cancelAnimations();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.muted = false;
    }
    lastCueIndexRef.current = -1;
    positionRef.current = timelineRef.current?.totalMs ?? 0;
    const wasActive = activeRef.current;
    activeRef.current = false;
    if (!wasActive) return;
    setActive(false);
    setRevealed(false);
    setSegmentText("");
    store.set({ active: false, positionMs: timelineRef.current?.totalMs ?? 0 });
    if (statusRef.current !== "unavailable") {
      setPlayerStatus(trackReadyRef.current ? "ready" : "loading");
    }
  }, [seekQueue, setPlayerStatus, store]);

  const halt = useCallback(() => {
    drawGenerationRef.current += 1;
    activationRef.current += 1;
    audioRef.current?.pause();
  }, []);

  const play = useCallback(() => {
    if (!activeRef.current) {
      const total = timelineRef.current?.totalMs ?? 0;
      const from = positionRef.current >= total ? 0 : positionRef.current;
      start(from, true);
      return;
    }
    if (statusRef.current === "ended") {
      requestSeek(0, true);
      return;
    }
    wantsPlayingRef.current = true;
    if (statusRef.current === "seeking") return;
    void startAudio();
  }, [requestSeek, start, startAudio]);

  const pause = useCallback(() => {
    wantsPlayingRef.current = false;
    if (!activeRef.current) {
      pendingStartRef.current = null;
      return;
    }
    if (statusRef.current === "seeking") return;
    audioRef.current?.pause();
    if (statusRef.current === "playing") setPlayerStatus("paused");
  }, [setPlayerStatus]);

  const seek = useCallback(
    (ms: number) => {
      if (!activeRef.current) {
        start(ms, true);
        return;
      }
      // A lecture that ran to its end plays again from wherever it is sent.
      requestSeek(
        ms,
        statusRef.current === "playing" || statusRef.current === "ended" || wantsPlayingRef.current,
      );
    },
    [requestSeek, start],
  );

  const skip = useCallback(
    (deltaMs: number) => {
      const total = timelineRef.current?.totalMs ?? 0;
      seek(skipTarget(positionRef.current, deltaMs, total));
    },
    [seek],
  );

  const setRate = useCallback((next: number) => {
    onRateChangeRef.current(next);
  }, []);

  const toggle = useCallback(() => {
    if (statusRef.current === "playing" || (statusRef.current === "seeking" && wantsPlayingRef.current)) {
      pause();
    } else {
      play();
    }
  }, [pause, play]);

  const controls = useMemo<LecturePlayerControls>(
    () => ({ play, pause, toggle, seek, skip, setRate }),
    [pause, play, seek, setRate, skip, toggle],
  );

  const playFromStart = useCallback(() => start(0, true), [start]);

  // --- rate -----------------------------------------------------------------
  useEffect(() => {
    rateRef.current = rate;
    store.set({ rate });
    const audio = audioRef.current;
    if (audio) {
      applyHtmlAudioPlaybackRate(audio, lecturePaceRate(rate));
      smoothClock.reset(positionRef.current, performance.now());
    }
  }, [rate, smoothClock, store]);

  // --- audio element ----------------------------------------------------------
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.preservesPitch = true;
    audioRef.current = audio;

    const onEnded = () => {
      if (!activeRef.current || statusRef.current === "seeking") return;
      // A delayed `ended` from the previous finish must not silence a seek back.
      if (Number.isFinite(audio.duration) && audio.currentTime < audio.duration - 0.2) return;
      const total = timelineRef.current?.totalMs ?? 0;
      positionRef.current = total;
      clockRef.current?.setNow(total);
      clockRef.current?.pump();
      renderCodePanel(total);
      store.set({ positionMs: total });
      wantsPlayingRef.current = false;
      setPlayerStatus("ended");
    };
    // The OS media keys and a headset unplug pause the element directly.
    const onPause = () => {
      if (!activeRef.current || statusRef.current !== "playing" || audio.ended) return;
      wantsPlayingRef.current = false;
      setPlayerStatus("paused");
    };
    const onPlay = () => {
      if (!activeRef.current || statusRef.current !== "paused") return;
      wantsPlayingRef.current = true;
      smoothClock.reset(positionRef.current, performance.now());
      setPlayerStatus("playing");
    };
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("play", onPlay);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("play", onPlay);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    };
  }, [renderCodePanel, setPlayerStatus, smoothClock, store]);

  // --- timeline + stitched track -------------------------------------------
  useEffect(() => {
    if (!available) {
      trackReadyRef.current = false;
      timelineRef.current = null;
      pendingStartRef.current = null;
      if (activeRef.current) close();
      store.set({ durationMs: 0, loadedMs: 0, chapters: [], positionMs: 0, error: null });
      setPlayerStatus("unavailable");
      return undefined;
    }
    if (activeRef.current) return undefined;

    const turns = storedTurnsRef.current;
    const timeline = buildLecturePlayerTimeline(turns);
    timelineRef.current = timeline;
    codeTracksRef.current = buildPageCodeTracks(turns, timeline);
    trackReadyRef.current = false;
    positionRef.current = timeline.totalMs;
    store.set({
      durationMs: timeline.totalMs,
      positionMs: timeline.totalMs,
      chapters: timeline.chapters,
      loadedMs: 0,
      error: null,
    });
    setPlayerStatus("loading");

    let cancelled = false;
    const key = `${sessionId}:${lecturePlayerTrackKey(turns)}`;
    const cancelIdle = scheduleIdle(() => {
      void getLecturePlayerTrack(key, () =>
        buildLecturePlayerTrack({
          cues: timeline.cues,
          onProgress: (loadedMs) => {
            if (!cancelled) store.set({ loadedMs });
          },
        }),
      )
        .then((track) => {
          if (cancelled) return;
          const audio = audioRef.current;
          if (!audio) return;
          if (audio.src !== track.url) {
            audio.src = track.url;
            audio.load();
          }
          audio.playbackRate = lecturePaceRate(rateRef.current);
          trackReadyRef.current = true;
          store.set({ loadedMs: timeline.totalMs });
          if (!activeRef.current) setPlayerStatus("ready");
          const pending = pendingStartRef.current;
          pendingStartRef.current = null;
          if (pending) activate(pending.ms, pending.play);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          console.error("Lecture track failed to load:", error);
          pendingStartRef.current = null;
          store.set({ error: "The lecture audio could not be loaded." });
          if (!activeRef.current) setPlayerStatus("ready");
        });
    });
    return () => {
      cancelled = true;
      cancelIdle();
    };
    // storedTurnsCount stands in for the turns ref: a saved turn changes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, sessionId, storedTurnsCount]);

  // --- frame loop -----------------------------------------------------------
  useEffect(() => {
    if (!active) return undefined;
    let frameId = 0;
    let lastWallMs = performance.now();
    const tick = () => {
      frameId = window.requestAnimationFrame(tick);
      const wallMs = performance.now();
      const wallDeltaMs = Math.min(wallMs - lastWallMs, 50);
      lastWallMs = wallMs;
      const audio = audioRef.current;
      const clock = clockRef.current;
      const timeline = timelineRef.current;
      if (!audio || !clock || !timeline) return;
      // Ink that runs past the last word finishes after the voice stops, on
      // the same clock, so the final frame is the finished board.
      if (statusRef.current === "ended" && !drawDoneRef.current) {
        clock.setNow(clock.now() + wallDeltaMs * Math.max(lecturePaceRate(rateRef.current), 0.1));
        clock.pump();
        renderCodePanel(timeline.totalMs);
        return;
      }
      if (statusRef.current !== "playing") return;
      const pace = lecturePaceRate(rateRef.current);
      if (Math.abs(audio.playbackRate - pace) > 0.001) {
        applyHtmlAudioPlaybackRate(audio, pace);
      }
      const ms = Math.min(
        smoothClock.sample({
          mediaMs: audio.currentTime * 1000,
          wallMs: performance.now(),
          playing: !audio.paused,
          rate: audio.playbackRate,
        }),
        timeline.totalMs,
      );
      positionRef.current = ms;
      clock.setNow(ms);
      clock.pump();
      renderCodePanel(ms);
      store.set({ positionMs: ms });
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [active, renderCodePanel, smoothClock, store]);

  // --- hidden tab -----------------------------------------------------------
  useEffect(() => {
    if (!active) return undefined;
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = performance.now();
        return;
      }
      if (
        statusRef.current === "playing" &&
        hiddenAt > 0 &&
        performance.now() - hiddenAt > HIDDEN_RESYNC_MS
      ) {
        const audio = audioRef.current;
        if (audio) requestSeek(audio.currentTime * 1000, true);
      }
      hiddenAt = 0;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [active, requestSeek]);

  // --- keyboard -------------------------------------------------------------
  useEffect(() => {
    if (!enableKeyboard || !available) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const action = lecturePlayerKeyAction({
        key: event.key,
        withModifier: event.ctrlKey || event.metaKey || event.altKey,
        typing: isPlayerControlElement(event.target) || isTypingElement(document.activeElement),
        dialogOpen: Boolean(document.querySelector('[role="dialog"][data-state="open"]')),
      });
      if (!action) return;
      event.preventDefault();
      const total = timelineRef.current?.totalMs ?? 0;
      if (action === "toggle") toggle();
      else if (action === "back") skip(-LECTURE_PLAYER_SKIP_MS);
      else if (action === "forward") skip(LECTURE_PLAYER_SKIP_MS);
      else if (action === "start") seek(0);
      else if (action === "end") seek(total);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [available, enableKeyboard, seek, skip, toggle]);

  // --- unmount --------------------------------------------------------------
  useEffect(() => {
    return () => {
      drawGenerationRef.current += 1;
      activationRef.current += 1;
      activeRef.current = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      close();
    };
  }, [close, sessionId]);

  // The player board mounts with its layout at the fixed board size, so the
  // code panel and freeze canvases share its 1200x700 space.
  useEffect(() => {
    if (!active) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    for (const canvas of [codePanelCanvasRef.current, freezeCanvasRef.current]) {
      if (!canvas) continue;
      canvas.width = Math.round(BOARD_WIDTH * pixelRatio);
      canvas.height = Math.round(BOARD_HEIGHT * pixelRatio);
    }
  }, [active]);

  const cursorState: CursorState = active && status !== "ended" ? "drawing" : "idle";
  const view = useMemo<LecturePlayerView>(
    () => ({ active, revealed, cursorState, segmentText }),
    [active, cursorState, revealed, segmentText],
  );

  return {
    view,
    playerBoardRef,
    codePanelCanvasRef,
    freezeCanvasRef,
    store,
    controls,
    active,
    revealed,
    playing: active && status === "playing",
    segmentText,
    cursorState,
    playFromStart,
    close,
    halt,
  };
}
