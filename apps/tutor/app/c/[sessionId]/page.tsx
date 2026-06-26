"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { InputBar } from "@/components/InputBar";
import { ResponseBubble } from "@/components/ResponseBubble";
import { TranscriptDialog } from "@/components/TranscriptDialog";
import { BoardHistory, type BoardEntry } from "@/components/BoardHistory";
import { SettingsDrawer, type SettingsState, getMarkerColorHex } from "@/components/SettingsDrawer";
import type { WhiteboardHandle, CursorState, WriteSchedule } from "@heytutor/whiteboard";

const Whiteboard = dynamic(
  () => import("@heytutor/whiteboard").then((mod) => mod.Whiteboard),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "2px solid transparent",
            borderTopColor: "#0077CC",
            borderBottomColor: "#0077CC",
            animation: "wb-spin 0.8s linear infinite",
          }}
        />
      </div>
    ),
  },
);
import {
  parseDrawingCommands,
  getSegmentCommands,
  type DrawCommand,
  type TutorSegment,
  cuboidPath,
  cubePath,
  rectPath,
  circlePath,
  linePath,
  IncrementalTagParser,
  checkSegmentAlignment,
  buildLessonSegments,
  lessonNarrationText,
} from "@heytutor/drawing";
import {
  streamLLMResponse,
  createTTSClient,
  TUTOR_SYSTEM_PROMPT,
  TUTOR_CONTINUATION_PROMPT,
  getCommandDrawDurationMs,
  getCommandSpeechWindow,
  getEstimatedWriteCharScheduleMs,
  getWriteCharScheduleMs,
  isWriteScheduleUsable,
  validateAudioTimingsForNarration,
  getDrawingDuration,
  getFlightDuration,
  tutorDebug,
  mathToSpeech,
  type AudioTimings,
  type ConversationExchange,
  type TTSClient,
} from "@heytutor/tutor-core";
import { DS } from "@heytutor/design-tokens";
import { createTurnTelemetry, type TurnTelemetry } from "@/lib/turnTelemetry";
import {
  createBoard,
  deleteBoardApi,
  fetchBoardDetail,
  fetchBoards,
  saveTurn,
  updateBoard,
  type RecordedSegmentPayload,
  type StoredTurn,
} from "@/lib/boardsClient";

type TutorPhase = "idle" | "thinking" | "drawing" | "speaking";

const BOARD_WIDTH = DS.Canvas.width;
const BOARD_HEIGHT = DS.Canvas.height;
const MAX_LLM_CONTINUATIONS = 3;

const TEXT_LAYOUT = {
  marginX: 90,
  firstTextMaxY: 180,
  topY: 64,
  headingBottomY: 118,
  workTopY: 142,
  bottomY: 645,
  lineHeight: 54,
  textHeight: 42,
  eraseX: 70,
  eraseY: 126,
  eraseWidth: 1060,
  eraseHeight: 520,
};

interface BoardTextRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BoardLayoutState {
  rects: BoardTextRect[];
  nextY: number;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function estimateBoardTextWidth(text: string): number {
  return clampNumber(text.length * 18 + 28, 80, BOARD_WIDTH - TEXT_LAYOUT.marginX * 2);
}

function textRectsOverlap(a: BoardTextRect, b: BoardTextRect, padding = 12): boolean {
  return (
    a.x < b.x + b.width + padding &&
    a.x + a.width + padding > b.x &&
    a.y < b.y + b.height + padding &&
    a.y + a.height + padding > b.y
  );
}

function isTeachingResponseIncomplete(
  text: string,
  contentChars?: number,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  const endsCleanly =
    /[.!?]\s*$/.test(trimmed) ||
    /\[\/STEP\]\s*$/.test(trimmed) ||
    /\]\s*$/.test(trimmed);
  if (endsCleanly && (contentChars ?? trimmed.length) < 7000) {
    return false;
  }

  return !endsCleanly || (contentChars ?? 0) >= 7000;
}

/** Fixed draw budget for geometric commands — independent of TTS length. */
const FIXED_SHAPE_DRAW_MS: Partial<Record<DrawCommand["type"], number>> = {
  DRAW_CIRCLE: 1050,
  DRAW_LINE: 420,
  DRAW_RECT: 850,
  DRAW_CUBE: 1100,
  DRAW_CUBOID: 1200,
};

function normalizeSegmentForAlignment(segment: TutorSegment): TutorSegment {
  const commands = getSegmentCommands(segment);
  if (commands.length === 0) {
    return segment;
  }

  const alignedCommands = commands.filter((command) => {
    const alignment = checkSegmentAlignment({ ...segment, command });
    if (!alignment.aligned) {
      tutorDebug("alignment", "skipping misaligned draw command", {
        reason: alignment.reason,
        narration_preview: segment.narration.slice(0, 80),
        command_type: command.type,
      });
      return false;
    }
    return true;
  });

  if (alignedCommands.length === commands.length) {
    return segment;
  }

  return {
    ...segment,
    command: alignedCommands[0] ?? null,
    commands: alignedCommands,
  };
}

function stopReplayAudio(audio: HTMLAudioElement | null): void {
  if (!audio) {
    return;
  }

  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

function playReplayAudio(
  url: string,
  options: {
    playbackRate?: number;
    onStart?: (durationMs: number) => void;
    shouldCancel?: () => boolean;
  } = {},
): { audio: HTMLAudioElement; done: Promise<void> } {
  const audio = new Audio(url);
  audio.playbackRate = options.playbackRate ?? 1;
  audio.preload = "auto";

  let cancelInterval: number | null = null;
  let finishPlayback: ((error?: unknown) => void) | null = null;

  const done = new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = (error?: unknown) => {
      if (settled) {
        return;
      }

      settled = true;

      if (cancelInterval !== null) {
        window.clearInterval(cancelInterval);
        cancelInterval = null;
      }

      audio.onplay = null;
      audio.onended = null;
      audio.onerror = null;
      finishPlayback = null;

      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    finishPlayback = finish;

    audio.onplay = () => {
      const durationMs =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? Math.round(audio.duration * 1000)
          : 700;
      options.onStart?.(durationMs);
    };

    audio.onended = () => finish();
    audio.onerror = () => finish(new Error(`Replay audio failed: ${url}`));

    void audio.play().catch((error: unknown) => finish(error));
  });

  if (options.shouldCancel) {
    cancelInterval = window.setInterval(() => {
      if (options.shouldCancel?.()) {
        audio.pause();
        finishPlayback?.();
      }
    }, 32);
    void done.finally(() => {
      if (cancelInterval !== null) {
        window.clearInterval(cancelInterval);
        cancelInterval = null;
      }
    });
  }

  return { audio, done };
}

export default function TutorSessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const whiteboardRef = useRef<WhiteboardHandle>(null);
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const [boardScale, setBoardScale] = useState(1);
  const [phase, setPhase] = useState<TutorPhase>("idle");
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [narrationText, setNarrationText] = useState("");
  const [currentSegmentText, setCurrentSegmentText] = useState("");
  const conversationHistoryRef = useRef<ConversationExchange[]>([]);
  const ttsClientRef = useRef<TTSClient | null>(null);
  const replayAudioRef = useRef<HTMLAudioElement | null>(null);
  const cancelRef = useRef(false);
  const delayTimersRef = useRef<number[]>([]);
  const turnAbortRef = useRef<AbortController | null>(null);
  const segmentChainRef = useRef(Promise.resolve());
  const collectedSegmentsRef = useRef<TutorSegment[]>([]);
  const recordedSegmentsRef = useRef<RecordedSegmentPayload[]>([]);
  const storedTurnsRef = useRef<StoredTurn[]>([]);
  const [storedTurnsCount, setStoredTurnsCount] = useState(0);
  const rawResponseRef = useRef("");
  const currentTraceIdRef = useRef<string | null>(null);
  const turnTelemetryRef = useRef<TurnTelemetry | null>(null);
  const turnStatsRef = useRef({ drawMs: 0, ttsChars: 0 });
  const boardLayoutRef = useRef<BoardLayoutState>({
    rects: [],
    nextY: TEXT_LAYOUT.topY,
  });
  const [settings, setSettings] = useState<SettingsState>({
    speedMultiplier: 1.5,
    audioLanguage: "english",
    accent: "us",
    subtitlesEnabled: true,
    subtitleLanguage: "english",
    markerColor: "black",
  });
  const speedRef = useRef(1.5);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [boards, setBoards] = useState<BoardEntry[]>([]);
  const [boardLoaded, setBoardLoaded] = useState(false);
  const [whiteboardReady, setWhiteboardReady] = useState(false);
  const [inputInteracted, setInputInteracted] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const setWhiteboardRef = useCallback((instance: WhiteboardHandle | null) => {
    whiteboardRef.current = instance;
    setWhiteboardReady(instance !== null);
  }, []);

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

  useEffect(() => {
    speedRef.current = settings.speedMultiplier;
  }, [settings.speedMultiplier]);

  useEffect(() => {
    const container = boardContainerRef.current;
    if (!container) return;

    const updateScale = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      setBoardScale(
        Math.min(width / BOARD_WIDTH, height / BOARD_HEIGHT),
      );
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(container);
    return () => observer.disconnect();
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
        await deleteBoardApi(id);
        let remaining: BoardEntry[] = [];
        setBoards((prev) => {
          remaining = prev.filter((b) => b.id !== id);
          return remaining;
        });

        if (id === sessionId) {
          if (remaining.length > 0) {
            router.push(`/c/${remaining[0]!.id}`);
          } else {
            router.push("/");
          }
        }
      })();
    },
    [sessionId, router],
  );

  useEffect(() => {
    ttsClientRef.current = createTTSClient();

    return () => {
      ttsClientRef.current?.stop();
    };
  }, []);

  const cursorState: CursorState =
    phase === "thinking"
      ? "thinking"
      : phase === "drawing" || phase === "speaking"
        ? "drawing"
        : "idle";

  const cancelWatchIntervalRef = useRef<number | null>(null);

  const resetBoardLayout = useCallback((keepHeading = false): void => {
    const headingRects = keepHeading
      ? boardLayoutRef.current.rects.filter((rect) => rect.y < TEXT_LAYOUT.headingBottomY)
      : [];

    boardLayoutRef.current = {
      rects: headingRects,
      nextY: keepHeading && headingRects.length > 0 ? TEXT_LAYOUT.workTopY : TEXT_LAYOUT.topY,
    };
  }, []);

  const forgetErasedTextRects = useCallback((eraseRect: BoardTextRect): void => {
    boardLayoutRef.current.rects = boardLayoutRef.current.rects.filter(
      (rect) => !textRectsOverlap(rect, eraseRect, 0),
    );
    const remainingBottom = boardLayoutRef.current.rects.reduce(
      (bottom, rect) => Math.max(bottom, rect.y + TEXT_LAYOUT.lineHeight),
      TEXT_LAYOUT.topY,
    );
    boardLayoutRef.current.nextY = Math.max(remainingBottom, TEXT_LAYOUT.topY);
  }, []);

  const resolveTextPlacement = useCallback(
    async (
      command: DrawCommand,
      x: number,
      y: number,
      applyLayout: boolean,
    ): Promise<{ x: number; y: number }> => {
      if (!applyLayout || !command.text) {
        return { x, y };
      }

      const width = estimateBoardTextWidth(command.text);
      const height = TEXT_LAYOUT.textHeight;
      const maxX = BOARD_WIDTH - TEXT_LAYOUT.marginX - width;
      let layout = boardLayoutRef.current;
      const candidateX = clampNumber(x, TEXT_LAYOUT.marginX, Math.max(TEXT_LAYOUT.marginX, maxX));
      let candidateY = clampNumber(y, TEXT_LAYOUT.topY, TEXT_LAYOUT.bottomY - height);

      if (layout.rects.length === 0 && candidateY > TEXT_LAYOUT.firstTextMaxY) {
        candidateY = TEXT_LAYOUT.topY;
      }

      const findOpenY = (startY: number): number | null => {
        for (
          let tryY = clampNumber(startY, TEXT_LAYOUT.topY, TEXT_LAYOUT.bottomY - height);
          tryY <= TEXT_LAYOUT.bottomY - height;
          tryY += TEXT_LAYOUT.lineHeight
        ) {
          const rect = { x: candidateX, y: tryY, width, height };
          if (!layout.rects.some((occupied) => textRectsOverlap(rect, occupied))) {
            return tryY;
          }
        }
        return null;
      };

      let openY = findOpenY(candidateY);

      if (openY === null) {
        const wb = whiteboardRef.current;
        if (wb && !cancelRef.current) {
          tutorDebug("draw", "layout erasing work area", {
            text: command.text.slice(0, 60),
            rect_count: layout.rects.length,
          });
          await wb.eraseRegion(
            TEXT_LAYOUT.eraseX,
            TEXT_LAYOUT.eraseY,
            TEXT_LAYOUT.eraseWidth,
            TEXT_LAYOUT.eraseHeight,
            700,
          );
        }
        resetBoardLayout(true);
        layout = boardLayoutRef.current;
        openY = findOpenY(TEXT_LAYOUT.workTopY) ?? TEXT_LAYOUT.workTopY;
      }

      const rect = { x: candidateX, y: openY, width, height };
      boardLayoutRef.current.rects.push(rect);
      boardLayoutRef.current.nextY = Math.max(
        boardLayoutRef.current.nextY,
        openY + TEXT_LAYOUT.lineHeight,
      );

      return { x: rect.x, y: rect.y };
    },
    [resetBoardLayout],
  );

  const waitForCancel = useCallback((): Promise<void> => {
    if (cancelRef.current) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      if (cancelWatchIntervalRef.current !== null) {
        window.clearInterval(cancelWatchIntervalRef.current);
      }

      cancelWatchIntervalRef.current = window.setInterval(() => {
        if (!cancelRef.current) {
          return;
        }

        if (cancelWatchIntervalRef.current !== null) {
          window.clearInterval(cancelWatchIntervalRef.current);
          cancelWatchIntervalRef.current = null;
        }

        resolve();
      }, 32);
    });
  }, []);

  const cancellableDelay = useCallback((duration: number): Promise<void> => {
    if (cancelRef.current) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const timeoutId = window.setTimeout(() => {
        delayTimersRef.current = delayTimersRef.current.filter((id) => id !== timeoutId);
        resolve();
      }, duration);
      delayTimersRef.current.push(timeoutId);
    });
  }, []);

  const raceWithCancel = useCallback(
    async <T,>(promise: Promise<T>): Promise<T | undefined> => {
      if (cancelRef.current) {
        return undefined;
      }

      const result = await Promise.race([
        promise.then((value) => ({ kind: "value" as const, value })),
        waitForCancel().then(() => ({ kind: "cancelled" as const })),
      ]);

      if (result.kind === "cancelled" || cancelRef.current) {
        return undefined;
      }

      return result.value;
    },
    [waitForCancel],
  );

  const executeCommand = useCallback(
    async (
      command: DrawCommand,
      options: {
        durationScale?: number;
        speechDurationMs?: number;
        writeSchedule?: WriteSchedule;
        applyLayout?: boolean;
      } = {},
    ): Promise<void> => {
      const wb = whiteboardRef.current;
      if (!wb || cancelRef.current) return;

      tutorDebug("draw", "executeCommand start", {
        type: command.type,
        text: command.text?.slice(0, 60),
        params: command.params,
        speech_duration_ms: options.speechDurationMs,
        duration_scale: options.durationScale,
      });

      const durationScale = options.durationScale ?? 1;
      const speechDurationMs = options.speechDurationMs;
      const writeSchedule = options.writeSchedule;

      const scaledDuration = (duration: number) =>
        Math.max(Math.round((duration / speedRef.current) * durationScale), 50);

      const speechSplit = (command: DrawCommand) => {
        if (speechDurationMs === undefined) {
          return {
            flightMs: scaledDuration(getFlightDuration(command)),
            drawMs: scaledDuration(getDrawingDuration(command)),
          };
        }

        // speechDurationMs is actual TTS audio length — do not divide by speedRef
        // (speedRef only affects replay; live TTS is not sped up).
        const totalMs = Math.max(Math.round(speechDurationMs), 50);
        const flight = getFlightDuration(command);
        const draw = getDrawingDuration(command);
        const defaultTotal = flight + draw;

        if (defaultTotal <= 0) {
          return { flightMs: 0, drawMs: totalMs };
        }

        const flightMs = Math.round(totalMs * (flight / defaultTotal));
        return { flightMs, drawMs: Math.max(totalMs - flightMs, 50) };
      };

      switch (command.type) {
        case "DRAW_CUBOID": {
          const [x, y, w, h, d] = command.params;
          if ([x, y, w, h, d].every(Number.isFinite)) {
            const { flightMs, drawMs } = speechSplit(command);
            await wb.flyCursorTo(x, y, flightMs);
            if (cancelRef.current) return;
            await wb.drawShape(cuboidPath(x, y, w, h, d), drawMs);
          }
          break;
        }
        case "DRAW_CUBE": {
          const [x, y, size] = command.params;
          if ([x, y, size].every(Number.isFinite)) {
            const { flightMs, drawMs } = speechSplit(command);
            await wb.flyCursorTo(x, y, flightMs);
            if (cancelRef.current) return;
            await wb.drawShape(cubePath(x, y, size), drawMs);
          }
          break;
        }
        case "DRAW_RECT": {
          const [x, y, w, h] = command.params;
          if ([x, y, w, h].every(Number.isFinite)) {
            const { flightMs, drawMs } = speechSplit(command);
            await wb.flyCursorTo(x, y, flightMs);
            if (cancelRef.current) return;
            await wb.drawShape(rectPath(x, y, w, h), drawMs);
          }
          break;
        }
        case "DRAW_CIRCLE": {
          const [cx, cy, radius] = command.params;
          if ([cx, cy, radius].every(Number.isFinite)) {
            const { flightMs, drawMs } = speechSplit(command);
            await wb.flyCursorTo(cx + radius, cy, flightMs);
            if (cancelRef.current) return;
            await wb.drawShape(circlePath(cx, cy, radius), drawMs);
          }
          break;
        }
        case "DRAW_LINE": {
          const [x1, y1, x2, y2] = command.params;
          if ([x1, y1, x2, y2].every(Number.isFinite)) {
            const { flightMs, drawMs } = speechSplit(command);
            await wb.flyCursorTo(x1, y1, flightMs);
            if (cancelRef.current) return;
            const lineLength = Math.hypot(x2 - x1, y2 - y1);
            await wb.drawShape(
              lineLength < 2 ? circlePath(x1, y1, 4) : linePath(x1, y1, x2, y2),
              drawMs,
            );
          }
          break;
        }
        case "WRITE":
        case "LABEL": {
          const [x, y] = command.params;
          if (command.text && Number.isFinite(x) && Number.isFinite(y)) {
            const placement = await resolveTextPlacement(
              command,
              x,
              y,
              options.applyLayout !== false,
            );
            if (writeSchedule && writeSchedule.charStartOffsetsMs.length > 0) {
              // Scheduled writing: each character is held against the true audio clock so
              // the pen tracks the narration token by token. Keep the approach flight short
              // because the first character's offset already holds the pen until its cue.
              await wb.flyCursorTo(placement.x, placement.y, 60, -35);
              if (cancelRef.current) return;
              await wb.writeText(command.text, placement.x, placement.y, 0, writeSchedule);
            } else {
              const { flightMs, drawMs } = speechSplit(command);
              await wb.flyCursorTo(placement.x, placement.y, flightMs, -35);
              if (cancelRef.current) return;
              await wb.writeText(command.text, placement.x, placement.y, drawMs);
            }
          }
          break;
        }
        case "PAUSE": {
          const pauseMs =
            speechDurationMs !== undefined
              ? Math.max(Math.round(speechDurationMs), 50)
              : scaledDuration(command.params[0] ?? 500);
          await cancellableDelay(pauseMs);
          break;
        }
        case "CLEAR": {
          // Starting a fresh answer should not waste time showing the duster.
          await wb.clearBoard();
          resetBoardLayout();
          break;
        }
        case "ERASE": {
          const [x, y, w, h] = command.params;
          if ([x, y, w, h].every(Number.isFinite)) {
            const { flightMs, drawMs } = speechSplit(command);
            await wb.flyCursorTo(x, y, flightMs);
            if (cancelRef.current) return;
            await wb.eraseRegion(x, y, w, h, drawMs);
            forgetErasedTextRects({ x, y, width: w, height: h });
          }
          break;
        }
      }

      tutorDebug("draw", "executeCommand done", { type: command.type });
    },
    [cancellableDelay, forgetErasedTextRects, resetBoardLayout, resolveTextPlacement],
  );

  const executeCommandWithCancel = useCallback(
    async (
      command: DrawCommand,
      options: {
        durationScale?: number;
        speechDurationMs?: number;
        writeSchedule?: WriteSchedule;
        applyLayout?: boolean;
      } = {},
    ): Promise<void> => {
      await raceWithCancel(executeCommand(command, options));
    },
    [executeCommand, raceWithCancel],
  );

  const restoreBoardFromApi = useCallback(
    async (boardId: string) => {
      setBoardLoaded(false);

      let detail = await fetchBoardDetail(boardId);

      if (!detail) {
        await createBoard(boardId);
        detail = await fetchBoardDetail(boardId);
      }

      if (!detail) {
        setBoardLoaded(true);
        return;
      }

      storedTurnsRef.current = detail.turns;
      setStoredTurnsCount(detail.turns.length);
      conversationHistoryRef.current = detail.turns.map((turn) => ({
        user: turn.question,
        assistant: lessonNarrationText(turn.rawResponse),
      }));

      const lastTurn = detail.turns[detail.turns.length - 1];
      const lastNarration = lastTurn
        ? lessonNarrationText(lastTurn.rawResponse)
        : "";

      whiteboardRef.current?.clearBoard();
      resetBoardLayout();
      setNarrationText(lastNarration);
      setCurrentSegmentText("");

      for (const turn of detail.turns) {
        for (const segment of turn.segments) {
          if (segment.command && !cancelRef.current) {
            await executeCommand(segment.command, { durationScale: 0.05, applyLayout: false });
          }
        }
      }

      setBoardLoaded(true);
    },
    [executeCommand, resetBoardLayout],
  );

  useEffect(() => {
    if (!sessionId) return;

    cancelRef.current = false;
    queueMicrotask(() => {
      void restoreBoardFromApi(sessionId);
    });
  }, [sessionId, restoreBoardFromApi]);

  const runSegment = useCallback(
    async (
      segment: TutorSegment,
      index: number,
      allSegments: TutorSegment[],
    ): Promise<void> => {
      const tts = ttsClientRef.current;
      if (!tts || cancelRef.current) return;

      tutorDebug("segment", "runSegment start", {
        index,
        narration_preview: segment.narration.slice(0, 80),
        narration_chars: segment.narration.length,
        command_type: segment.command?.type ?? null,
        command_text: segment.command?.text?.slice(0, 60),
      });

      const tel = turnTelemetryRef.current;
      const segmentName = `segment-${index}`;
      const segmentSpan = tel?.span(segmentName);

      if (cancelRef.current) {
        segmentSpan?.end({ skipped: true, reason: "cancelled" });
        return;
      }

      setPhase("speaking");
      setCurrentSegmentText(segment.narration);

      const previousText = allSegments[index - 1]?.narration;
      const nextText = allSegments[index + 1]?.narration;
      const narration = segment.narration.trim();

      if (!narration && !segment.command) {
        tutorDebug("segment", "skipped empty segment", { index });
        segmentSpan?.end({ skipped: true });
        return;
      }

      const segmentCommands = getSegmentCommands(segment);
      const totalDrawWeight = segmentCommands.reduce(
        (sum, cmd) => sum + getCommandDrawDurationMs(cmd),
        0,
      );

      const hasNarration = narration.length > 0;
      const hasCommand = segmentCommands.length > 0;

      if (hasNarration) {
        turnStatsRef.current.ttsChars += narration.length;
      }

      const segmentMetadata = {
        chars: narration.length,
        has_command: hasCommand,
        command_type: segmentCommands[0]?.type ?? null,
        command_count: segmentCommands.length,
      };

      let capturedAudio: Uint8Array | null = null;
      let capturedTimings: AudioTimings | null = null;
      let capturedDurationMs: number | null = null;
      const estimateSpeechMs = Math.max(narration.length * 85, 700);
      const naturalDrawMs = Math.max(
        segmentCommands.reduce((sum, cmd) => sum + getCommandDrawDurationMs(cmd), 0),
        200,
      );
      let audioStartedAtMs: number | null = null;
      let timingTelemetryCount = 0;
      let lastTimingTelemetryChars = -1;
      const timingWaiters: Array<(timings: AudioTimings | null) => void> = [];

      // The ground-truth audio clock: position (ms) within the currently speaking segment,
      // measured from when its audio actually became audible. The Web Audio client schedules
      // playback ~150ms ahead and pauses freeze it, so this is far more accurate than
      // performance.now() at onStart. Monotonic + guarded so the prefetch pipeline flipping
      // to the next job at segment end can't make the clock jump backward and stall a gate.
      let maxAudioPositionMs = -Infinity;
      const wallClockMs = (): number =>
        audioStartedAtMs === null ? 0 : performance.now() - audioStartedAtMs;
      const liveAudioPositionMs = (): number => {
        const position = tts.getPlaybackPositionMs();
        if (position === null || position + 50 < maxAudioPositionMs) {
          return Math.max(maxAudioPositionMs, wallClockMs());
        }
        maxAudioPositionMs = Math.max(maxAudioPositionMs, position);
        return position;
      };

      const waitForInitialTimings = (timeoutMs = 40): Promise<AudioTimings | null> => {
        if (capturedTimings && capturedTimings.charStartTimes.length > 0) {
          return Promise.resolve(capturedTimings);
        }

        return new Promise((resolve) => {
          let settled = false;
          const waiter = (timings: AudioTimings | null) => {
            if (settled) {
              return;
            }
            settled = true;
            window.clearTimeout(timeoutId);
            resolve(timings);
          };
          const timeoutId = window.setTimeout(() => {
            if (settled) {
              return;
            }
            settled = true;
            const waiterIndex = timingWaiters.indexOf(waiter);
            if (waiterIndex >= 0) {
              timingWaiters.splice(waiterIndex, 1);
            }
            resolve(capturedTimings);
          }, timeoutMs);

          timingWaiters.push(waiter);
        });
      };

      const runDraw = async (
        totalSpeechMs: number,
        audioTimings?: AudioTimings | null,
      ): Promise<void> => {
        const drawName = `draw-${index}`;
        const drawSpan = tel?.span(drawName, segmentName);
        const drawStart = performance.now();

        try {
          for (const command of segmentCommands) {
            if (cancelRef.current) {
              return;
            }

            const isTextCommand = command.type === "WRITE" || command.type === "LABEL";
            const elapsedAtCommandStart =
              audioStartedAtMs === null ? 0 : performance.now() - audioStartedAtMs;

            // Live writing must start with the explanation, even if ElevenLabs alignment
            // arrives late or not at all. Prefer real timings only when already available;
            // otherwise use an immediate script-derived schedule and keep drawing moving.
            const timingValidation =
              isTextCommand && hasNarration && capturedTimings
                ? validateAudioTimingsForNarration(narration, capturedTimings)
                : null;
            const segmentDurationMs =
              timingValidation?.totalDurationMs ??
              (capturedTimings?.totalDuration
                ? Math.round(capturedTimings.totalDuration * 1000)
                : totalSpeechMs);
            const timedSchedule =
              isTextCommand && hasNarration && capturedTimings && timingValidation?.valid
                ? getWriteCharScheduleMs(narration, command, capturedTimings)
                : null;
            const estimatedSchedule =
              isTextCommand && hasNarration
                ? getEstimatedWriteCharScheduleMs(narration, command)
                : null;
            const usableTimedSchedule =
              timedSchedule && isWriteScheduleUsable(timedSchedule, narration, segmentDurationMs)
                ? timedSchedule
                : null;
            const writeSchedule = usableTimedSchedule ?? estimatedSchedule;

            if (writeSchedule && writeSchedule.offsetsMs.length > 0) {
              const audioPosAtScheduleMs = Math.round(liveAudioPositionMs());
              const firstOffsetMs = writeSchedule.offsetsMs[0] ?? 0;
              const scheduleMetadata = {
                segment_index: index,
                text: command.text?.slice(0, 60),
                schedule_source: writeSchedule.source,
                timing_chars: capturedTimings?.charStartTimes.length ?? 0,
                first_offset_ms: firstOffsetMs,
                audio_pos_ms: audioPosAtScheduleMs,
                start_lag_ms: audioPosAtScheduleMs - firstOffsetMs,
                matched: writeSchedule.matched,
                syncable: true,
                valid_timing: writeSchedule.validTiming,
                reason:
                  writeSchedule.reason ??
                  timingValidation?.reason ??
                  (timedSchedule && !usableTimedSchedule ? "schedule-offset-too-late" : null),
              };
              tutorDebug("draw", "write schedule ready", {
                index,
                ...scheduleMetadata,
              });
              tel?.mark("write-schedule-ready", scheduleMetadata);

              let loggedChars = 0;
              await executeCommandWithCancel(command, {
                writeSchedule: {
                  charStartOffsetsMs: writeSchedule.offsetsMs,
                  charDurationsMs: writeSchedule.charDurationsMs,
                  getAudioPositionMs: liveAudioPositionMs,
                  onCharacterStart: ({ char, index: charIndex, targetMs, audioPositionMs }) => {
                    if (loggedChars >= 8) {
                      return;
                    }
                    loggedChars++;
                    const charMetadata = {
                      segment_index: index,
                      char,
                      char_index: charIndex,
                      target_ms: Math.round(targetMs),
                      audio_pos_ms: Math.round(audioPositionMs),
                      lag_ms: Math.round(audioPositionMs - targetMs),
                    };
                    tutorDebug("draw", "write char start", charMetadata);
                    tel?.mark("write-char-start", charMetadata);
                  },
                },
              });
              continue;
            }

            if (isTextCommand && hasNarration) {
              const revealMs = Math.min(
                Math.max((command.text?.replace(/\s/g, "").length ?? 1) * 28, 320),
                950,
              );
              const scheduleMetadata = {
                segment_index: index,
                text: command.text?.slice(0, 60),
                schedule_source: "none",
                timing_chars: capturedTimings?.charStartTimes.length ?? 0,
                syncable: false,
                valid_timing: timingValidation?.valid ?? false,
                reason: timingValidation?.reason ?? "text-not-spoken",
              };
              tutorDebug("draw", "write unsyncable reveal", {
                index,
                ...scheduleMetadata,
              });
              tel?.mark("write-schedule-ready", scheduleMetadata);
              await executeCommandWithCancel(command, {
                speechDurationMs: revealMs,
              });
              continue;
            }

            const commandWeight = getCommandDrawDurationMs(command);
            const naturalDrawMs = getCommandDrawDurationMs(command);
            const commandSpeechMs =
              totalDrawWeight > 0
                ? Math.max(Math.round(totalSpeechMs * (commandWeight / totalDrawWeight)), 50)
                : Math.max(Math.round(totalSpeechMs / segmentCommands.length), 50);
            const speechWindow =
              hasNarration && (capturedTimings ?? audioTimings)
                ? getCommandSpeechWindow(narration, command, capturedTimings ?? audioTimings)
                : null;
            const startDelayMs = speechWindow
              ? Math.max(Math.round(speechWindow.startMs - elapsedAtCommandStart), 0)
              : 0;

            if (startDelayMs > 0) {
              await cancellableDelay(startDelayMs);
              if (cancelRef.current) {
                return;
              }
            }

            const commandBudgetMs =
              isTextCommand
                ? (speechWindow?.durationMs ?? naturalDrawMs)
                : command.type === "PAUSE"
                  ? commandSpeechMs
                  : (FIXED_SHAPE_DRAW_MS[command.type] ??
                    Math.min(speechWindow?.durationMs ?? commandSpeechMs, naturalDrawMs));

            await executeCommandWithCancel(command, {
              speechDurationMs: commandBudgetMs,
            });
          }
        } finally {
          const drawMs = Math.round(performance.now() - drawStart);
          turnStatsRef.current.drawMs += drawMs;
          tel?.mark("draw-complete", {
            segment_index: index,
            command_count: segmentCommands.length,
            duration_ms: drawMs,
          });
          drawSpan?.end({
            command_count: segmentCommands.length,
            duration_ms: drawMs,
          });
        }
      };

      const captureTimings = (timings: AudioTimings) => {
        capturedTimings = timings;
        const validation = validateAudioTimingsForNarration(narration, timings);
        if (timings.totalDuration > 0) {
          capturedDurationMs = Math.round(timings.totalDuration * 1000);
        }
        if (timingTelemetryCount < 3 && timings.charStartTimes.length !== lastTimingTelemetryChars) {
          timingTelemetryCount++;
          lastTimingTelemetryChars = timings.charStartTimes.length;
          tel?.mark("tts-timing-received", {
            segment_index: index,
            timing_chars: timings.charStartTimes.length,
            total_duration_ms: capturedDurationMs,
          });
          tel?.mark("tts-timing-validation", {
            segment_index: index,
            valid: validation.valid,
            reason: validation.reason ?? null,
            total_duration_ms: validation.totalDurationMs,
            expected_max_ms: validation.expectedMaxMs,
          });
        }
        if (timings.charStartTimes.length > 0 && timingWaiters.length > 0) {
          const waiters = timingWaiters.splice(0);
          for (const resolve of waiters) {
            resolve(timings);
          }
        }
      };

      const speakOptions = {
        previousText,
        nextText,
        traceId: currentTraceIdRef.current ?? undefined,
        sessionId: sessionId ?? undefined,
        onAudioCaptured: (audio: { bytes: Uint8Array }) => {
          capturedAudio = audio.bytes;
        },
        onTimings: captureTimings,
      };

      try {
        if (hasNarration && !hasCommand) {
          tutorDebug("segment", "narration-only", { index });
          await raceWithCancel(tts.speakSegment(narration, speakOptions));
          if (cancelRef.current) return;
          tutorDebug("segment", "narration-only complete", { index });
        } else if (!hasNarration && hasCommand) {
          tutorDebug("segment", "draw-only", { index });
          await runDraw(naturalDrawMs);
          if (cancelRef.current) return;
          tutorDebug("segment", "draw-only complete", { index });
        } else if (hasNarration && hasCommand) {
          tutorDebug("segment", "paired narration+draw", { index });

          let drawPromise: Promise<void> | null = null;
          let speechSettled = false;
          const waitForDraw = new Promise<void>((resolve) => {
            const poll = () => {
              if (drawPromise) {
                void drawPromise.finally(resolve);
                return;
              }
              if (speechSettled || cancelRef.current) {
                resolve();
                return;
              }
              window.requestAnimationFrame(poll);
            };
            poll();
          });

          const speechPromise = raceWithCancel(
            tts.speakSegment(narration, {
              ...speakOptions,
              onStart: () => {
                if (cancelRef.current) return;
                tutorDebug("tts", "segment audio started", { index });
                tel?.mark("tts-start", {
                  segment_index: index,
                  chars: narration.length,
                  command_count: segmentCommands.length,
                });
                setPhase("drawing");
                audioStartedAtMs = performance.now();
                drawPromise = (async () => {
                  const needsPhraseTiming = segmentCommands.some(
                    (command) => command.type === "WRITE" || command.type === "LABEL",
                  );
                  const timingWaitStart = performance.now();
                  const timings = needsPhraseTiming
                    ? await waitForInitialTimings()
                    : capturedTimings;
                  tutorDebug("draw", "initial timing wait done", {
                    index,
                    waited_ms: Math.round(performance.now() - timingWaitStart),
                    timing_chars: timings?.charStartTimes.length ?? 0,
                    audio_pos_ms: Math.round(liveAudioPositionMs()),
                  });
                  if (cancelRef.current) return;
                  const totalMs =
                    timings?.totalDuration && timings.totalDuration > 0
                      ? Math.round(timings.totalDuration * 1000)
                      : estimateSpeechMs;
                  await runDraw(totalMs, timings);
                })();
              },
              onTimings: (timings) => {
                captureTimings(timings);
                if (timings.totalDuration > 0) {
                  tutorDebug("tts", "segment timings", {
                    index,
                    total_duration_ms: Math.round(timings.totalDuration * 1000),
                  });
                }
              },
            }),
          ).finally(() => {
            speechSettled = true;
          });

          await Promise.all([
            speechPromise,
            waitForDraw,
          ]);

          if (cancelRef.current) return;
          tutorDebug("segment", "paired narration+draw complete", { index });
        }
      } finally {
        if (!cancelRef.current) {
          recordedSegmentsRef.current.push({
            orderIndex: index,
            narration: segment.narration,
            spokenText: mathToSpeech(narration),
            command: segment.command,
            audioBytes: capturedAudio,
            durationMs: capturedDurationMs,
            timings: capturedTimings,
          });
        }
        tutorDebug("segment", "runSegment end", { index, ...segmentMetadata });
        segmentSpan?.end(segmentMetadata);
      }
    },
    [sessionId, cancellableDelay, executeCommandWithCancel, raceWithCancel],
  );

  const enqueueSegment = useCallback(
    (segment: TutorSegment) => {
      const segmentToRun = normalizeSegmentForAlignment(segment);
      collectedSegmentsRef.current.push(segmentToRun);
      const index = collectedSegmentsRef.current.length - 1;

      tutorDebug("parser", "segment enqueued", {
        index,
        narration_preview: segmentToRun.narration.slice(0, 80),
        command_type: segmentToRun.command?.type ?? null,
      });

      segmentChainRef.current = segmentChainRef.current.then(async () => {
        if (cancelRef.current) {
          return;
        }

        try {
          await runSegment(segmentToRun, index, collectedSegmentsRef.current);
        } catch (error) {
          console.error(`Segment ${index} failed:`, error);
          tutorDebug("segment", "segment failed", {
            index,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    },
    [runSegment],
  );

  const processResponseText = useCallback(
    async (responseText: string) => {
      const parsed = parseDrawingCommands(responseText);

      if (parsed.commands.length === 0 && !parsed.narration.trim() && !/\[STEP\]/i.test(responseText)) {
        const message = "no response from ai";
        setNarrationText(message);
        setCurrentSegmentText(message);
        return;
      }

      const segments = buildLessonSegments(responseText);

      tutorDebug("turn", "lesson segments built", {
        segment_count: segments.length,
        structured: /\[STEP\]/i.test(responseText),
      });

      if (segments.length === 0) {
        return;
      }

      collectedSegmentsRef.current = [];
      recordedSegmentsRef.current = [];
      segmentChainRef.current = Promise.resolve();

      for (const segment of segments) {
        enqueueSegment(segment);
      }

      await segmentChainRef.current;
      setNarrationText(lessonNarrationText(responseText));
    },
    [enqueueSegment],
  );

  const stopTurn = useCallback(() => {
    if (phase === "idle") {
      return;
    }

    cancelRef.current = true;

    if (cancelWatchIntervalRef.current !== null) {
      window.clearInterval(cancelWatchIntervalRef.current);
      cancelWatchIntervalRef.current = null;
    }

    for (const timerId of delayTimersRef.current) {
      window.clearTimeout(timerId);
    }
    delayTimersRef.current = [];

    isPausedRef.current = false;
    setIsPaused(false);
    turnAbortRef.current?.abort();
    stopReplayAudio(replayAudioRef.current);
    replayAudioRef.current = null;
    ttsClientRef.current?.stop();
    whiteboardRef.current?.cancelAnimations();
    whiteboardRef.current?.setPaused(false);

    segmentChainRef.current = Promise.resolve();
    collectedSegmentsRef.current = [];

    setPhase("idle");
    setCurrentSegmentText("");
    setTranscriptOpen(false);
  }, [phase]);

  const pauseTurn = useCallback(() => {
    if (phase === "idle" || isPausedRef.current) {
      return;
    }

    isPausedRef.current = true;
    setIsPaused(true);
    ttsClientRef.current?.pause();
    whiteboardRef.current?.setPaused(true);
    tutorDebug("turn", "paused");
  }, [phase]);

  const resumeTurn = useCallback(() => {
    if (!isPausedRef.current) {
      return;
    }

    isPausedRef.current = false;
    setIsPaused(false);
    ttsClientRef.current?.resume();
    whiteboardRef.current?.setPaused(false);
    tutorDebug("turn", "resumed");
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        stopTurn();
        return;
      }

      if (event.key !== " " || phase === "idle") {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      if (isPausedRef.current) {
        resumeTurn();
      } else {
        pauseTurn();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pauseTurn, phase, resumeTurn, stopTurn]);

  const handleQuestion = useCallback(
    async (question: string) => {
      const wb = whiteboardRef.current;
      if (!wb || phase !== "idle") return;

      tutorDebug("turn", "question submitted", {
        question_preview: question.slice(0, 120),
        board_id: sessionId,
      });

      cancelRef.current = false;
      isPausedRef.current = false;
      setIsPaused(false);
      setTranscriptOpen(false);
      const abortController = new AbortController();

      const boardIdForName = sessionId;
      if (boardIdForName) {
        const needsName = boards.find(
          (b) => b.id === boardIdForName,
        )?.title === "new board";
        if (needsName) {
          void fetch("/api/board-name", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ question }),
          })
            .then((r) => r.json())
            .then((data) => {
              const title: string | undefined = data?.title;
              if (!title) return;
              void updateBoard(boardIdForName, { title }).then((board) => {
                if (!board) return;
                setBoards((prev) =>
                  prev.map((b) => (b.id === boardIdForName ? { ...b, title: board.title } : b)),
                );
              });
            })
            .catch(() => {
              // ignore — keep "new board" as fallback
            });
        }
      }
      turnAbortRef.current = abortController;
      let turnCancelled = false;
      setPhase("thinking");
      setNarrationText("");
      setCurrentSegmentText("");
      collectedSegmentsRef.current = [];
      recordedSegmentsRef.current = [];
      rawResponseRef.current = "";
      currentTraceIdRef.current = null;
      segmentChainRef.current = Promise.resolve();
      turnStatsRef.current = { drawMs: 0, ttsChars: 0 };
      resetBoardLayout();

      const tel = createTurnTelemetry();
      turnTelemetryRef.current = tel;
      const thinkingSpan = tel.span("thinking");
      let thinkingEnded = false;

      const endThinking = (metadata?: Record<string, unknown>) => {
        if (thinkingEnded) {
          return;
        }

        thinkingEnded = true;
        thinkingSpan.end(metadata);
      };

      const wsSpan = tel.span("websocket-connect");
      let wsEnded = false;

      const endWsConnect = (metadata: Record<string, unknown>) => {
        if (wsEnded) {
          return;
        }

        wsEnded = true;
        wsSpan.end(metadata);
      };

      void ttsClientRef.current?.prewarm({
        onConnect: ({ ms, ok }) => {
          endWsConnect({
            latency_ms: Math.round(ms),
            ok,
          });
        },
      });

      try {
        const parser = new IncrementalTagParser({
          onSegmentReady: (segment) => {
            tutorDebug("parser", "segment ready from stream", {
              narration_preview: segment.narration.slice(0, 80),
              command_type: segment.command?.type ?? null,
              deferred: true,
            });
          },
        });

        tutorDebug("turn", "LLM stream starting");

        let fullResponse = "";
        let lastStreamStats: Awaited<ReturnType<typeof streamLLMResponse>>["streamStats"];
        let traceId: string | null = null;
        let continueCount = 0;

        while (continueCount <= MAX_LLM_CONTINUATIONS) {
          const isContinuation = continueCount > 0;
          const streamResult = await streamLLMResponse(
            {
              systemPrompt: isContinuation
                ? TUTOR_CONTINUATION_PROMPT
                : TUTOR_SYSTEM_PROMPT,
              userPrompt: isContinuation ? "continue" : question,
              conversationHistory: isContinuation
                ? [
                    ...conversationHistoryRef.current,
                    {
                      user: question,
                      assistant: lessonNarrationText(fullResponse),
                    },
                  ]
                : conversationHistoryRef.current,
              proxyUrl: "/api/chat",
              sessionId: sessionId ?? undefined,
              signal: abortController.signal,
              onTraceId: (id) => {
                currentTraceIdRef.current = id;
                tel.setTrace(id, sessionId ?? undefined);
              },
            },
            (delta) => {
              endThinking({ phase: "first_token", delta_chars: delta.length });
              if (delta.includes("[")) {
                tutorDebug("parser", "draw tag delta", {
                  delta_chars: delta.length,
                  preview: delta.slice(0, 80),
                });
              }
              parser.push(delta);
            },
          );

          fullResponse += streamResult.text;
          traceId = streamResult.traceId;
          lastStreamStats = streamResult.streamStats;

          if (cancelRef.current) {
            break;
          }

          if (
            !isTeachingResponseIncomplete(
              streamResult.text,
              streamResult.streamStats?.contentChars,
            )
          ) {
            break;
          }

          continueCount += 1;
          if (continueCount > MAX_LLM_CONTINUATIONS) {
            break;
          }

          tutorDebug("turn", "continuing truncated LLM response", {
            continuation: continueCount,
            response_chars: fullResponse.length,
          });
        }

        const rawResponse = fullResponse;
        const streamStats = lastStreamStats;

        tutorDebug("turn", "LLM stream finished", {
          response_chars: rawResponse.length,
          trace_id: traceId,
          stream_stats: streamStats,
          segments_so_far: collectedSegmentsRef.current.length,
          continuations: continueCount,
        });

        if (cancelRef.current) {
          turnCancelled = true;
          return;
        }

        if (traceId) {
          currentTraceIdRef.current = traceId;
          tel.setTrace(traceId, sessionId ?? undefined);
        }

        if (!thinkingEnded) {
          endThinking({ phase: "no_first_token" });
        }

        parser.flush();

        const responseText = rawResponse.trim();
        rawResponseRef.current = responseText;

        if (responseText.length === 0) {
          const reasoningOnly = (streamStats?.reasoningChars ?? 0) > 0;
          const message = reasoningOnly
            ? "the model returned reasoning only with no teaching output. try asking again."
            : "the ai returned an empty response. try asking again.";
          tutorDebug("turn", "empty response", {
            reasoning_chars: streamStats?.reasoningChars ?? 0,
            stream_stats: streamStats,
          });
          setNarrationText(message);
          setCurrentSegmentText(message);
          return;
        }

        tutorDebug("turn", "planning lesson from full response");
        await processResponseText(responseText);

        const finalNarration =
          responseText.length > 0 ? lessonNarrationText(responseText) : narrationText;

        if (finalNarration.trim() && !turnCancelled && !cancelRef.current) {
          conversationHistoryRef.current.push({
            user: question,
            assistant: finalNarration,
          });

          if (conversationHistoryRef.current.length > 10) {
            conversationHistoryRef.current.shift();
          }

          const currentId = sessionId;
          if (currentId && rawResponseRef.current) {
            const savedTurn = await saveTurn(currentId, {
              question,
              rawResponse: rawResponseRef.current,
              speedMultiplier: speedRef.current,
              traceId: currentTraceIdRef.current,
              segments: recordedSegmentsRef.current,
            });

            if (savedTurn) {
              storedTurnsRef.current = [...storedTurnsRef.current, savedTurn];
              setStoredTurnsCount(storedTurnsRef.current.length);
            }

            setBoards((prev) =>
              prev.map((b) =>
                b.id === currentId ? { ...b, preview: question.slice(0, 60) } : b,
              ),
            );
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          turnCancelled = true;
          endThinking({ phase: "cancelled" });
          return;
        }

        if (cancelRef.current) {
          turnCancelled = true;
          return;
        }

        console.error("Tutor error:", error);
        const message = "something went wrong. try asking again.";
        setNarrationText(message);
        setCurrentSegmentText(message);
        endThinking({ phase: "error" });
      } finally {
        turnAbortRef.current = null;
        endWsConnect({ ok: false, reason: "turn_complete_without_connect_event" });
        if (!thinkingEnded) {
          endThinking({ phase: turnCancelled ? "cancelled" : "turn_complete" });
        }

        tel.meta({
          total_duration_ms: tel.durationMs(),
          segment_count: collectedSegmentsRef.current.length,
          total_draw_ms: turnStatsRef.current.drawMs,
          total_tts_chars: turnStatsRef.current.ttsChars,
          question_preview: question.slice(0, 120),
          cancelled: turnCancelled,
        });

        tutorDebug("turn", "turn complete", {
          cancelled: turnCancelled,
          segment_count: collectedSegmentsRef.current.length,
          total_draw_ms: turnStatsRef.current.drawMs,
          total_tts_chars: turnStatsRef.current.ttsChars,
        });

        await tel.flush();
        turnTelemetryRef.current = null;

        isPausedRef.current = false;
        setIsPaused(false);
        whiteboardRef.current?.setPaused(false);
        ttsClientRef.current?.stop();
        setPhase("idle");
        setCurrentSegmentText("");
      }
    },
    [sessionId, boards, narrationText, phase, processResponseText, resetBoardLayout],
  );

  const handleAskDoubt = useCallback(
    (question: string) => {
      void handleQuestion(`I have a doubt about this: ${question}`);
    },
    [handleQuestion],
  );

  const replayLecture = useCallback(async () => {
    if (storedTurnsRef.current.length === 0) {
      return;
    }

    cancelRef.current = false;
    isPausedRef.current = false;
    setIsPaused(false);
    setPhase("speaking");
    whiteboardRef.current?.clearBoard();
    resetBoardLayout();

    try {
      for (const turn of storedTurnsRef.current) {
        for (const segment of turn.segments) {
          if (cancelRef.current) {
            break;
          }

          const narration = segment.narration.trim();
          const command = segment.command;

          if (narration) {
            setCurrentSegmentText(narration);
          }

          try {
            if (segment.audioUrl) {
              let replayDrawPromise: Promise<void> = Promise.resolve();
              const { audio, done } = playReplayAudio(segment.audioUrl, {
                playbackRate: speedRef.current,
                shouldCancel: () => cancelRef.current,
                onStart: (durationMs) => {
                  if (!command || cancelRef.current) {
                    return;
                  }

                  setPhase("drawing");
                  replayDrawPromise = (async () => {
                    const playbackRate = Math.max(speedRef.current, 0.1);
                    const isTextCommand =
                      command.type === "WRITE" || command.type === "LABEL";

                    const charSchedule =
                      isTextCommand && narration && segment.timings
                        ? getWriteCharScheduleMs(narration, command, segment.timings)
                        : null;

                    if (charSchedule && charSchedule.offsetsMs.length > 0) {
                      // audio.currentTime is the source timeline (independent of playbackRate),
                      // matching the recorded char timings — gate each character against it.
                      await executeCommandWithCancel(command, {
                        applyLayout: false,
                        writeSchedule: {
                          charStartOffsetsMs: charSchedule.offsetsMs,
                          charDurationsMs: charSchedule.charDurationsMs,
                          getAudioPositionMs: () => audio.currentTime * 1000,
                        },
                      });
                      return;
                    }

                    const speechWindow = segment.timings
                      ? getCommandSpeechWindow(narration, command, segment.timings)
                      : {
                          startMs: 0,
                          durationMs,
                          matched: false,
                        };
                    const startDelayMs = Math.max(
                      Math.round(speechWindow.startMs / playbackRate),
                      0,
                    );

                    if (startDelayMs > 0) {
                      await cancellableDelay(startDelayMs);
                    }
                    if (cancelRef.current) {
                      return;
                    }

                    await executeCommandWithCancel(command, {
                      applyLayout: false,
                      speechDurationMs: Math.max(
                        Math.round(speechWindow.durationMs / playbackRate),
                        50,
                      ),
                    });
                  })();
                },
              });

              replayAudioRef.current = audio;
              await raceWithCancel(done);
              await raceWithCancel(replayDrawPromise);
              replayAudioRef.current = null;
            } else if (command) {
              await executeCommandWithCancel(command, { applyLayout: false });
            } else if (narration) {
              const fallbackMs = segment.durationMs ?? Math.max(narration.length * 85, 700);
              await cancellableDelay(fallbackMs);
            }
          } catch (error) {
            tutorDebug("turn", "replay segment failed", {
              order_index: segment.orderIndex,
              audio_url: segment.audioUrl,
              error: error instanceof Error ? error.message : String(error),
            });

            if (command) {
              await executeCommandWithCancel(command, { applyLayout: false });
            }
          }
        }
      }

      const lastTurn = storedTurnsRef.current[storedTurnsRef.current.length - 1];
      if (lastTurn) {
        setNarrationText(lessonNarrationText(lastTurn.rawResponse));
      }
    } finally {
      stopReplayAudio(replayAudioRef.current);
      replayAudioRef.current = null;
      ttsClientRef.current?.stop();
      setPhase("idle");
      setCurrentSegmentText("");
    }
  }, [cancellableDelay, raceWithCancel, executeCommandWithCancel, resetBoardLayout]);

  const statusConfig: Record<
    TutorPhase,
    {
      color: string;
      label: string;
      dotClass: string;
      labelColor: string;
    }
  > = {
    idle: {
      color: "rgba(0,119,204,0.5)",
      label: "ready",
      dotClass: "",
      labelColor: "rgba(0,119,204,0.5)",
    },
    thinking: {
      color: "#0099E5",
      label: "thinking\u2026",
      dotClass: "animate-wb-pulse-amber",
      labelColor: "#0099E5",
    },
    drawing: {
      color: "#0077CC",
      label: "teaching\u2026",
      dotClass: "animate-wb-glow-blue",
      labelColor: "#0077CC",
    },
    speaking: {
      color: "#0077CC",
      label: "teaching\u2026",
      dotClass: "animate-wb-glow-blue",
      labelColor: "#0077CC",
    },
  };

  const pausedStatus = {
    color: "#333333",
    label: "paused",
    dotClass: "",
    labelColor: "#333333",
  };

  const activeStatus = isPaused ? pausedStatus : statusConfig[phase];

  const activeBoard = boards.find((b) => b.id === sessionId);
  const activeBoardTitle = activeBoard?.title ?? "";
  const canReplay = phase === "idle" && storedTurnsCount > 0;
  const isInputOverlay = phase === "idle" && !inputInteracted;

  const settingsButton = (
    <button
      type="button"
      aria-label="Settings"
      onClick={() => setSettingsOpen(true)}
      className="flex h-[52px] shrink-0 items-center justify-center px-2 transition-opacity hover:opacity-100"
      style={{
        border: "none",
        background: "transparent",
        cursor: "pointer",
        color: settings.speedMultiplier > 1 ? "#0077CC" : "rgba(51,51,51,0.7)",
        opacity: 0.8,
      }}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
  );

  const inputChrome = (
    <div
      className="flex w-full items-center gap-3"
      style={{
        maxWidth: isInputOverlay ? "720px" : "min(48rem, calc(100vw - 2rem))",
        margin: "0 auto",
      }}
    >
      <div className="min-w-0 flex-1">
        <InputBar
          onSubmit={handleQuestion}
          onAskDoubt={handleAskDoubt}
          disabled={phase !== "idle" || !boardLoaded || !whiteboardReady}
          isPaused={isPaused}
          onPauseToggle={() => (isPaused ? resumeTurn() : pauseTurn())}
          onCancel={stopTurn}
          placeholder="Ask anything"
          onUserInteractionChange={setInputInteracted}
        />
      </div>
      {settingsButton}
    </div>
  );

  return (
    <div
      className="relative flex h-screen overflow-hidden"
      style={{
        background: "#EAEAEA",
      }}
    >
      <BoardHistory
        boards={boards}
        activeBoardId={sessionId}
        onSelect={switchBoard}
        onNew={createNewBoard}
        onDelete={deleteBoard}
        disabled={phase !== "idle" || !boardLoaded || !whiteboardReady}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        profileOpen={profileOpen}
        onProfileToggle={() => setProfileOpen(!profileOpen)}
      />

      <div className="relative z-10 flex flex-1 flex-col min-h-0">
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            padding: "10px 16px 4px",
            flexShrink: 0,
          }}
        >
          {sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              style={{
                width: 30,
                height: 30,
                borderRadius: 6,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginRight: "auto",
                transition: "background 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(0,119,204,0.1)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
                              <svg
                  width="22"
                  height="22" viewBox="0 0 24 24" fill="none" stroke="#0099E5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {phase === "idle" && canReplay && (
              <button
                type="button"
                onClick={() => void replayLecture()}
                aria-label="Replay lecture"
                style={{
                  fontSize: "0.7rem",
                  color: "#0077CC",
                  background: "rgba(0, 119, 204, 0.1)",
                  border: "1px solid rgba(0, 119, 204, 0.25)",
                  borderRadius: 9999,
                  padding: "4px 10px",
                  cursor: "pointer",
                  transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(0, 119, 204, 0.2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(0, 119, 204, 0.1)";
                }}
              >
                Replay
              </button>
            )}
            {phase === "idle" && narrationText.trim().length > 0 && (
              <button
                type="button"
                onClick={() => setTranscriptOpen(true)}
                aria-label="View lesson transcript"
                style={{
                  fontSize: "0.7rem",
                  color: "#0099E5",
                  background: "rgba(0, 119, 204, 0.1)",
                  border: "1px solid rgba(0, 119, 204, 0.25)",
                  borderRadius: 9999,
                  padding: "4px 10px",
                  cursor: "pointer",
                  transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(0, 119, 204, 0.2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(0, 119, 204, 0.1)";
                }}
              >
                Transcript
              </button>
            )}
            {phase !== "idle" && (
              <button
                type="button"
                onClick={stopTurn}
                aria-label="Stop teaching"
                style={{
                  fontSize: "0.7rem",
                  color: "#9E4040",
                  background: "rgba(217, 112, 112, 0.12)",
                  border: "1px solid rgba(217, 112, 112, 0.35)",
                  borderRadius: 9999,
                  padding: "4px 10px",
                  cursor: "pointer",
                  transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(217, 112, 112, 0.22)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(217, 112, 112, 0.12)";
                }}
              >
                Stop
              </button>
            )}
            {phase !== "idle" && (
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${activeStatus.dotClass}`}
                style={{
                  backgroundColor: activeStatus.color,
                }}
              />
            )}
            {phase !== "idle" && (
              <span
                style={{
                  fontSize: "0.7rem",
                  color: activeStatus.labelColor,
                  transition: "color 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              >
                {activeStatus.label}
              </span>
            )}
          </div>
        </div>

        <main className="relative flex flex-1 flex-col min-h-0 px-6 pt-2 pb-2">
          {activeBoardTitle && activeBoardTitle !== "new board" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "6px 12px",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontSize: "1.05rem",
                  fontWeight: 600,
                  color: "#0099E5",
                  textTransform: "capitalize",
                  letterSpacing: "0.01em",
                  userSelect: "none",
                }}
              >
                {activeBoardTitle}
              </span>
            </div>
          )}

          <div
            className="relative min-h-0 flex-1 overflow-hidden"
            style={{
              background:
                "linear-gradient(180deg, #FFFFFF 0%, #EAEAEA 50%, #EAEAEA 100%)",
              borderRadius: "8px",
              boxShadow:
                "0 16px 48px -10px rgba(0,119,204,0.15), 0 4px 16px -4px rgba(0,0,0,0.1), inset 0 0 0 1px rgba(0,119,204,0.08), inset 0 2px 6px rgba(255,255,255,0.7)",
            }}
          >
            {isInputOverlay && (
              <div
                className="pointer-events-none absolute inset-0 z-10"
                style={{
                  backgroundColor: "rgba(234, 234, 234, 0.6)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                }}
              />
            )}

            {isInputOverlay && (
              <div
                className="absolute inset-0 z-20 flex flex-col items-center justify-center px-4"
                style={{ pointerEvents: "none" }}
              >
                <div style={{ width: "100%", maxWidth: "720px", pointerEvents: "auto" }}>
                  {inputChrome}
                </div>
              </div>
            )}

            {phase === "thinking" && (
              <div
                className="absolute inset-0 z-20 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(234,234,234,0.92) 100%)",
                  backdropFilter: "blur(2px)",
                }}
              >
                <div className="absolute top-0 left-0 right-0 h-1 overflow-hidden">
                  <div className="wb-progress-bar" />
                </div>
                <div className="flex h-full flex-col items-center justify-center gap-4">
                  <div
                    className="h-10 w-10 rounded-full border-2 border-transparent"
                    style={{
                      borderTopColor: "#0077CC",
                      borderBottomColor: "#0077CC",
                      animation: "wb-spin 0.8s linear infinite",
                    }}
                  />
                  <p style={{ fontSize: "0.9rem", color: "#0077CC", fontWeight: 500 }}>
                    thinking about how to teach this…
                  </p>
                </div>
              </div>
            )}

            <ResponseBubble
              text={currentSegmentText}
              visible={
                settings.subtitlesEnabled &&
                (phase === "speaking" || phase === "drawing")
              }
            />

            <TranscriptDialog
              text={narrationText}
              open={transcriptOpen}
              onClose={() => setTranscriptOpen(false)}
            />

            <div
              ref={boardContainerRef}
              className="absolute inset-0 z-[1] flex items-center justify-center overflow-hidden"
            >
              <div
                style={{
                  width: BOARD_WIDTH * boardScale,
                  height: BOARD_HEIGHT * boardScale,
                  position: "relative",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: BOARD_WIDTH,
                    height: BOARD_HEIGHT,
                    transform: `scale(${boardScale})`,
                    transformOrigin: "top left",
                  }}
                >
                  <Whiteboard
                    ref={setWhiteboardRef}
                    width={BOARD_WIDTH}
                    height={BOARD_HEIGHT}
                    cursorState={cursorState}
                    inkColor={getMarkerColorHex(settings.markerColor)}
                  />
                </div>
              </div>
            </div>
          </div>
        </main>

        {!isInputOverlay && (
          <footer className="relative shrink-0 px-3 pb-3 pt-2">
            {inputChrome}
          </footer>
        )}

        <SettingsDrawer
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={settings}
          onSettingsChange={setSettings}
        />
      </div>
    </div>
  );
}
