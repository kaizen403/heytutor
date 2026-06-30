"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { InputBar } from "@/components/InputBar";
import { ResponseBubble } from "@/components/ResponseBubble";
import { TranscriptDialog } from "@/components/TranscriptDialog";
import { BoardHistory, type BoardEntry } from "@/components/BoardHistory";
import { LessonActions } from "@/components/LessonActions";
import { ReplayControls } from "@/components/ReplayControls";
import { SettingsDrawer, type SettingsState, getMarkerColorHex } from "@/components/SettingsDrawer";
import { playReplayAudio, stopReplayAudio } from "@/lib/replayAudio";
import {
  buildReplayTimeline,
  findCueAtTime,
  getPartialCommandCount,
  type ReplayCue,
} from "@/lib/replayTimeline";
import {
  buildLocalStoredTurn,
  enrichStoredSegmentsWithReplayAudio,
} from "@/lib/replayTurns";
import type { WhiteboardHandle, CursorState, WriteSchedule, AnnotationKind } from "@heytutor/whiteboard";

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
  underlinePath,
  emphasisEllipsePath,
  arrowPath,
  highlightRectPath,
  scribblePath,
  parseStoredSegmentCommands,
  serializeSegmentCommands,
  IncrementalTagParser,
  checkSegmentAlignment,
  buildLessonSegments,
  drainCompleteStepBlocks,
  lessonNarrationText,
  measureTextWidth,
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
import { useIsMobile } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";
import {
  createBoard,
  deleteBoardApi,
  fetchBoardDetail,
  fetchBoards,
  saveTurn,
  updateBoard,
  type RecordedSegmentPayload,
  type StoredSegment,
  type StoredTurn,
} from "@/lib/boardsClient";

type TutorPhase = "idle" | "thinking" | "drawing" | "speaking";

const BOARD_WIDTH = DS.Canvas.width;
const BOARD_HEIGHT = DS.Canvas.height;
const WHITEBOARD_COLOR = "#F8F6F0";
const MAX_LLM_CONTINUATIONS = 3;

const TEXT_LAYOUT = {
  marginX: 90,
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

const DIAGRAM_ZONE = {
  x: 400,
  y: 140,
  width: 500,
  height: 380,
};

function isInDiagramZone(x: number, y: number): boolean {
  return (
    x >= DIAGRAM_ZONE.x &&
    x <= DIAGRAM_ZONE.x + DIAGRAM_ZONE.width &&
    y >= DIAGRAM_ZONE.y &&
    y <= DIAGRAM_ZONE.y + DIAGRAM_ZONE.height
  );
}

interface BoardTextRect {
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  commandIndex?: number;
}

const ANNOTATION_SNAP_DISTANCE = 40;

interface BoardLayoutState {
  rects: BoardTextRect[];
  nextY: number;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function estimateBoardTextWidth(text: string): number {
  const measured = measureTextWidth(text, 32);
  return clampNumber(measured + 16, 40, BOARD_WIDTH - TEXT_LAYOUT.marginX * 2);
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
  UNDERLINE: 350,
  CIRCLE_AROUND: 700,
  ARROW: 500,
  HIGHLIGHT: 250,
  SCRIBBLE: 400,
};

function pointNearRect(px: number, py: number, rect: BoardTextRect, padding = ANNOTATION_SNAP_DISTANCE): boolean {
  return (
    px >= rect.x - padding &&
    px <= rect.x + rect.width + padding &&
    py >= rect.y - padding &&
    py <= rect.y + rect.height + padding
  );
}

function lineNearRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: BoardTextRect,
  padding = ANNOTATION_SNAP_DISTANCE,
): boolean {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  return pointNearRect(midX, midY, rect, padding);
}

function bboxNearRect(
  x: number,
  y: number,
  w: number,
  h: number,
  rect: BoardTextRect,
  padding = ANNOTATION_SNAP_DISTANCE,
): boolean {
  const cx = x + w / 2;
  const cy = y + h / 2;
  return pointNearRect(cx, cy, rect, padding);
}

function pointRectDistance(px: number, py: number, rect: BoardTextRect): number {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return Math.hypot(px - cx, py - cy);
}

function findNearestTextRect(
  probe: (rect: BoardTextRect) => boolean,
  rects: BoardTextRect[],
  referencePoint?: { x: number; y: number },
): BoardTextRect | null {
  const candidates = rects.filter(probe);
  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  if (!referencePoint) {
    return candidates[0];
  }
  let best = candidates[0];
  let bestDist = pointRectDistance(referencePoint.x, referencePoint.y, best);
  for (let i = 1; i < candidates.length; i++) {
    const d = pointRectDistance(referencePoint.x, referencePoint.y, candidates[i]);
    if (d < bestDist) {
      best = candidates[i];
      bestDist = d;
    }
  }
  return best;
}

function registerBoardAnchor(layout: BoardLayoutState, rect: BoardTextRect): void {
  layout.rects.push(rect);
}

function getWorkAreaFlowStartY(layout: BoardLayoutState): number {
  const hasHeading = layout.rects.some((rect) => rect.y < TEXT_LAYOUT.headingBottomY);
  const queuedY = Math.max(layout.nextY, TEXT_LAYOUT.topY);
  if (hasHeading && queuedY <= TEXT_LAYOUT.headingBottomY) {
    return TEXT_LAYOUT.workTopY;
  }
  return queuedY;
}

function overlapsWorkArea(rect: BoardTextRect): boolean {
  return textRectsOverlap(rect, {
    x: TEXT_LAYOUT.eraseX,
    y: TEXT_LAYOUT.eraseY,
    width: TEXT_LAYOUT.eraseWidth,
    height: TEXT_LAYOUT.eraseHeight,
  }, 0);
}

function underlineParamsForRect(match: BoardTextRect, pad: number): number[] {
  return [
    match.x - pad,
    match.y + match.height + 2,
    match.x + match.width + pad,
    match.y + match.height + 2,
  ];
}

function bboxParamsForRect(match: BoardTextRect, pad: number): number[] {
  return [match.x - pad, match.y - pad, match.width + pad * 2, match.height + pad * 2];
}

const NARRATION_LABEL_RULES: Array<{ cues: string[]; labels: string[] }> = [
  { cues: ["mass", "the mass", "mass is", "this mass", "labeled m", "label m"], labels: ["m", "M"] },
  { cues: ["friction", "frictional", "mu times", "mu is", "force of friction"], labels: ["f", "F_f", "f_k", "f_s"] },
  { cues: ["normal force", "normal from", "normal pushes", "normal", "surface pushes"], labels: ["N", "F_N"] },
  { cues: ["weight", "gravity", "gravitational", "mass times g", "mg", "w equals"], labels: ["mg", "W", "F_g"] },
  { cues: ["applied push", "applied force", "push to the right", "push to the left", "applied"], labels: ["F", "F_app", "P"] },
  { cues: ["tension", "rope pulls", "string pulls", "cable pulls"], labels: ["T", "F_T"] },
  { cues: ["velocity", "the velocity", "speed"], labels: ["v", "V"] },
  { cues: ["acceleration", "the acceleration", "accelerates"], labels: ["a", "A"] },
  { cues: ["force", "the force", "net force"], labels: ["F", "F_net"] },
  { cues: ["angle", "theta", "the angle"], labels: ["θ", "theta"] },
  { cues: ["coefficient", "mu", "friction coefficient"], labels: ["μ", "mu"] },
  { cues: ["distance", "displacement", "the distance"], labels: ["d", "x", "s"] },
  { cues: ["height", "the height", "falls from"], labels: ["h", "H"] },
  { cues: ["time", "the time"], labels: ["t", "T"] },
  { cues: ["energy", "kinetic energy", "potential energy"], labels: ["E", "KE", "PE", "U"] },
  { cues: ["momentum", "the momentum"], labels: ["p", "P"] },
  { cues: ["charge", "the charge"], labels: ["q", "Q"] },
  { cues: ["current", "the current"], labels: ["I", "i"] },
  { cues: ["voltage", "potential difference", "the voltage"], labels: ["V", "ΔV"] },
  { cues: ["resistance", "the resistance"], labels: ["R"] },
  { cues: ["power", "the power"], labels: ["P"] },
  { cues: ["frequency", "the frequency"], labels: ["f", "ν"] },
  { cues: ["wavelength", "the wavelength"], labels: ["λ", "lambda"] },
  { cues: ["temperature", "the temperature"], labels: ["T"] },
  { cues: ["pressure", "the pressure"], labels: ["P", "p"] },
  { cues: ["volume", "the volume"], labels: ["V", "v"] },
  { cues: ["density", "the density"], labels: ["ρ", "rho"] },
  { cues: ["area", "the area"], labels: ["A"] },
];

function normalizeLabel(text: string): string {
  return mathToSpeech(text).trim().replace(/\s+/g, "").toLowerCase();
}

function findAnchorByNarration(narration: string, rects: BoardTextRect[]): BoardTextRect | null {
  const normalized = narration.toLowerCase();

  for (const rule of NARRATION_LABEL_RULES) {
    if (!rule.cues.some((cue) => normalized.includes(cue))) {
      continue;
    }
    for (const label of rule.labels) {
      const target = normalizeLabel(label);
      const match = rects.find((rect) => normalizeLabel(rect.text ?? "") === target);
      if (match) {
        return match;
      }
    }
  }

  for (const rect of rects) {
    const rectText = (rect.text ?? "").trim().toLowerCase();
    if (rectText.length === 0 || rectText.length > 30) {
      continue;
    }
    if (normalized.includes(rectText)) {
      return rect;
    }
  }

  return null;
}

function resolveSnappedAnnotationParams(
  kind: DrawCommand["type"],
  params: number[],
  rects: BoardTextRect[],
  narration?: string,
): { params: number[]; snapped: boolean; rect: BoardTextRect | null } {
  const pad = 8;

  if (kind === "UNDERLINE" && params.length >= 4) {
    const [x1, y1, x2, y2] = params;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const match = findNearestTextRect(
      (rect) => lineNearRect(x1, y1, x2, y2, rect),
      rects,
      { x: midX, y: midY },
    );
    if (match) {
      return { params: underlineParamsForRect(match, pad), snapped: true, rect: match };
    }
  }

  if ((kind === "CIRCLE_AROUND" || kind === "HIGHLIGHT") && params.length >= 4) {
    const [x, y, w, h] = params;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const match = findNearestTextRect(
      (rect) => bboxNearRect(x, y, w, h, rect),
      rects,
      { x: cx, y: cy },
    );
    if (match) {
      return { params: bboxParamsForRect(match, pad), snapped: true, rect: match };
    }
    const nearby = findNearestTextRect(
      (rect) => pointNearRect(cx, cy, rect, ANNOTATION_SNAP_DISTANCE * 2),
      rects,
      { x: cx, y: cy },
    );
    if (nearby) {
      return { params: bboxParamsForRect(nearby, pad), snapped: true, rect: nearby };
    }
  }

  if (kind === "ARROW" && params.length >= 4) {
    const [x1, y1, x2, y2] = params;
    const match = findNearestTextRect(
      (rect) => pointNearRect(x2, y2, rect) || lineNearRect(x1, y1, x2, y2, rect),
      rects,
      { x: x2, y: y2 },
    );
    if (match) {
      const cx = match.x + match.width / 2;
      const cy = match.y + match.height / 2;
      const startFar = Math.hypot(x1 - cx, y1 - cy) > ANNOTATION_SNAP_DISTANCE * 2;
      return {
        params: startFar ? [x1, y1, cx, cy] : [x1, y1, x2, y2],
        snapped: true,
        rect: match,
      };
    }
  }

  if (kind === "SCRIBBLE" && params.length >= 4) {
    const [x1, y1, x2, y2] = params;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const match = findNearestTextRect(
      (rect) => lineNearRect(x1, y1, x2, y2, rect),
      rects,
      { x: midX, y: midY },
    );
    if (match) {
      return {
        params: [
          match.x,
          match.y + match.height * 0.35,
          match.x + match.width,
          match.y + match.height * 0.65,
        ],
        snapped: true,
        rect: match,
      };
    }
  }

  if (narration) {
    const match = findAnchorByNarration(narration, rects);
    if (match) {
      if (kind === "UNDERLINE") {
        return { params: underlineParamsForRect(match, pad), snapped: true, rect: match };
      }
      if (kind === "CIRCLE_AROUND" || kind === "HIGHLIGHT") {
        return { params: bboxParamsForRect(match, pad), snapped: true, rect: match };
      }
      if (kind === "ARROW" && params.length >= 4) {
        const [x1, y1] = params;
        const cx = match.x + match.width / 2;
        const cy = match.y + match.height / 2;
        return { params: [x1, y1, cx, cy], snapped: true, rect: match };
      }
      if (kind === "SCRIBBLE") {
        return {
          params: [
            match.x,
            match.y + match.height * 0.35,
            match.x + match.width,
            match.y + match.height * 0.65,
          ],
          snapped: true,
          rect: match,
        };
      }
    }
  }

  return { params, snapped: false, rect: null };
}

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

export default function TutorSessionPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = params.sessionId as string;

  const whiteboardRef = useRef<WhiteboardHandle>(null);
  const pendingQuestionRef = useRef<string | null>(null);
  const autoSubmitDoneRef = useRef(false);
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const [boardViewport, setBoardViewport] = useState({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const [phase, setPhase] = useState<TutorPhase>("idle");
  const [showThinkingOverlay, setShowThinkingOverlay] = useState(false);
  const [planningLesson, setPlanningLesson] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [narrationText, setNarrationText] = useState("");
  const [currentSegmentText, setCurrentSegmentText] = useState("");
  const conversationHistoryRef = useRef<ConversationExchange[]>([]);
  const ttsClientRef = useRef<TTSClient | null>(null);
  const replayAudioRef = useRef<HTMLAudioElement | null>(null);
  const cancelRef = useRef(false);
  const turnActiveRef = useRef(false);
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
  /** After a work-area erase, ignore LLM y coords and fill rows top-down. */
  const forceSequentialWorkLayoutRef = useRef(false);
  const fbdPhaseMarkedRef = useRef(false);
  const fbdPhaseStartedRef = useRef(false);
  const stopTurnRef = useRef<(() => void) | null>(null);
  const [settings, setSettings] = useState<SettingsState>({
    speedMultiplier: 1,
    audioLanguage: "english",
    accent: "us",
    subtitlesEnabled: true,
    subtitleLanguage: "english",
    markerColor: "black",
  });
  const speedRef = useRef(1);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isMobile = useIsMobile();
  const [boards, setBoards] = useState<BoardEntry[]>([]);
  const [boardLoaded, setBoardLoaded] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayProgressMs, setReplayProgressMs] = useState(0);
  const [replayTotalMs, setReplayTotalMs] = useState(0);
  const replayGenerationRef = useRef(0);
  const replayCueRef = useRef<ReplayCue | null>(null);
  const replayBlobUrlsRef = useRef<string[]>([]);
  const [inputInteracted, setInputInteracted] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

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
    ttsClientRef.current?.setPlaybackRate(settings.speedMultiplier);
  }, [settings.speedMultiplier]);

  useEffect(() => {
    const container = boardContainerRef.current;
    if (!container) return;

    const updateScale = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;

      const widthScale = width / BOARD_WIDTH;
      const heightScale = height / BOARD_HEIGHT;

      // Prefer filling the frame width; only letterbox horizontally if the full
      // canvas height would not fit.
      if (BOARD_HEIGHT * widthScale <= height) {
        const scale = widthScale;
        setBoardViewport({
          scale,
          offsetX: 0,
          offsetY: (height - BOARD_HEIGHT * scale) / 2,
        });
        return;
      }

      const scale = heightScale;
      setBoardViewport({
        scale,
        offsetX: (width - BOARD_WIDTH * scale) / 2,
        offsetY: 0,
      });
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
    [sessionId, router, createNewBoard, phase],
  );

  useEffect(() => {
    ttsClientRef.current = createTTSClient();
    ttsClientRef.current?.setPlaybackRate(speedRef.current);

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
    [registerReplayBlobUrl],
  );

  const resetBoardLayout = useCallback((keepHeading = false, forceSequentialWorkLayout?: boolean): void => {
    const headingRects = keepHeading
      ? boardLayoutRef.current.rects.filter((rect) => rect.y < TEXT_LAYOUT.headingBottomY)
      : [];

    boardLayoutRef.current = {
      rects: headingRects,
      nextY: keepHeading && headingRects.length > 0 ? TEXT_LAYOUT.workTopY : TEXT_LAYOUT.topY,
    };

    if (forceSequentialWorkLayout !== undefined) {
      forceSequentialWorkLayoutRef.current = forceSequentialWorkLayout;
    }
  }, []);

  const forgetErasedTextRects = useCallback((eraseRect: BoardTextRect): void => {
    boardLayoutRef.current.rects = boardLayoutRef.current.rects.filter(
      (rect) => !textRectsOverlap(rect, eraseRect, 0),
    );
    const hasHeading = boardLayoutRef.current.rects.some(
      (rect) => rect.y < TEXT_LAYOUT.headingBottomY,
    );
    const remainingBottom = boardLayoutRef.current.rects.reduce(
      (bottom, rect) => Math.max(bottom, rect.y + TEXT_LAYOUT.lineHeight),
      TEXT_LAYOUT.topY,
    );
    let nextY = Math.max(remainingBottom, TEXT_LAYOUT.topY);
    if (hasHeading && nextY <= TEXT_LAYOUT.headingBottomY) {
      nextY = TEXT_LAYOUT.workTopY;
    }
    boardLayoutRef.current.nextY = nextY;
    if (overlapsWorkArea(eraseRect)) {
      forceSequentialWorkLayoutRef.current = true;
    }
  }, []);

  const resolveTextPlacement = useCallback(
    async (
      command: DrawCommand,
      x: number,
      y: number,
      applyLayout: boolean,
    ): Promise<{ x: number; y: number }> => {
      if (!applyLayout || !command.text) {
        if (command.text && Number.isFinite(x) && Number.isFinite(y)) {
          registerBoardAnchor(boardLayoutRef.current, {
            x,
            y,
            width: estimateBoardTextWidth(command.text),
            height: TEXT_LAYOUT.textHeight,
            text: command.text,
          });
        }
        return { x, y };
      }

      if (isInDiagramZone(x, y)) {
        const width = estimateBoardTextWidth(command.text);
        const height = TEXT_LAYOUT.textHeight;
        registerBoardAnchor(boardLayoutRef.current, { x, y, width, height, text: command.text });
        return { x, y };
      }

      const width = estimateBoardTextWidth(command.text);
      const height = TEXT_LAYOUT.textHeight;
      const maxX = BOARD_WIDTH - TEXT_LAYOUT.marginX - width;
      let layout = boardLayoutRef.current;
      const candidateX = clampNumber(x, TEXT_LAYOUT.marginX, Math.max(TEXT_LAYOUT.marginX, maxX));

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

      const placementStartY = (() => {
        if (forceSequentialWorkLayoutRef.current) {
          return getWorkAreaFlowStartY(layout);
        }
        let candidateY = clampNumber(y, TEXT_LAYOUT.topY, TEXT_LAYOUT.bottomY - height);
        if (layout.rects.length === 0 && candidateY > TEXT_LAYOUT.workTopY) {
          candidateY = TEXT_LAYOUT.topY;
        }
        return candidateY;
      })();

      let openY = findOpenY(placementStartY);

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
        resetBoardLayout(true, true);
        layout = boardLayoutRef.current;
        openY = findOpenY(getWorkAreaFlowStartY(layout)) ?? TEXT_LAYOUT.workTopY;
      }

      const rect = { x: candidateX, y: openY, width, height, text: command.text };
      registerBoardAnchor(boardLayoutRef.current, rect);
      boardLayoutRef.current.nextY = Math.max(
        boardLayoutRef.current.nextY,
        openY + TEXT_LAYOUT.lineHeight,
      );

      return { x: rect.x, y: rect.y };
    },
    [resetBoardLayout],
  );

  const resolveAnnotationTarget = useCallback(
    (
      command: DrawCommand,
      kind: DrawCommand["type"],
      narration?: string,
    ): { params: number[]; snapped: boolean; rect: BoardTextRect | null } =>
      resolveSnappedAnnotationParams(
        kind,
        [...command.params],
        boardLayoutRef.current.rects,
        narration,
      ),
    [],
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
        segmentNarration?: string;
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
      const segmentNarration = options.segmentNarration;

      const markFbdDiagramStart = (x: number, y: number) => {
        if (fbdPhaseStartedRef.current || !isInDiagramZone(x, y)) {
          return;
        }
        fbdPhaseStartedRef.current = true;
        turnTelemetryRef.current?.mark("fbd-phase-start", { x: Math.round(x), y: Math.round(y) });
      };

      const scaledDuration = (duration: number) =>
        Math.max(Math.round((duration / speedRef.current) * durationScale), 50);

      const speechSplit = (command: DrawCommand) => {
        if (speechDurationMs === undefined) {
          return {
            flightMs: scaledDuration(getFlightDuration(command)),
            drawMs: scaledDuration(getDrawingDuration(command)),
          };
        }

        // speechDurationMs is the natural (1x) TTS audio length.
        // With HTMLAudioElement.preservesPitch, audio plays at speedRef.current,
        // so drawings must match the speed-adjusted duration to avoid silence gaps.
        const totalMs = Math.max(Math.round(speechDurationMs / speedRef.current), 50);
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
            markFbdDiagramStart(x, y);
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
            markFbdDiagramStart(x1, y1);
            const { flightMs, drawMs } = speechSplit(command);
            await wb.flyCursorTo(x1, y1, flightMs);
            if (cancelRef.current) return;
            const lineLength = Math.hypot(x2 - x1, y2 - y1);
            await wb.drawShape(
              lineLength < 2 ? circlePath(x1, y1, 4) : linePath(x1, y1, x2, y2),
              drawMs,
            );
            if (isInDiagramZone((x1 + x2) / 2, (y1 + y2) / 2)) {
              registerBoardAnchor(boardLayoutRef.current, {
                x: Math.min(x1, x2),
                y: Math.min(y1, y2),
                width: Math.abs(x2 - x1) || 20,
                height: Math.abs(y2 - y1) || 20,
                text: undefined,
              });
            }
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
            if (isInDiagramZone(placement.x, placement.y)) {
              const diagramLabels = boardLayoutRef.current.rects.filter(
                (r) => r.x >= DIAGRAM_ZONE.x,
              );
              const hasSurface = diagramLabels.length >= 2;
              const forceLabelCount = diagramLabels.filter((r) => {
                const t = (r.text ?? "").trim();
                return t === "F" || t === "f" || t === "N" || t === "mg";
              }).length;
              if (hasSurface && forceLabelCount >= 3 && !fbdPhaseMarkedRef.current) {
                turnTelemetryRef.current?.mark("fbd-phase-complete", {
                  force_labels: forceLabelCount,
                });
                fbdPhaseMarkedRef.current = true;
              }
            }
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
              ? Math.max(Math.round(speechDurationMs / speedRef.current), 50)
              : scaledDuration(command.params[0] ?? 500);
          await cancellableDelay(pauseMs);
          break;
        }
        case "CLEAR": {
          // Starting a fresh answer should not waste time showing the duster.
          await wb.clearBoard();
          resetBoardLayout(false, true);
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
        case "UNDERLINE":
        case "CIRCLE_AROUND":
        case "ARROW":
        case "HIGHLIGHT":
        case "SCRIBBLE": {
          const tel = turnTelemetryRef.current;
          tel?.mark("annotate-start", {
            type: command.type,
            params: command.params,
          });

          if (command.params.length >= 2) {
            const px = command.params[0];
            const py = command.params[1];
            if (command.type === "ARROW") {
              markFbdDiagramStart(px, py);
            }
            if (isInDiagramZone(px, py)) {
              tel?.mark("annotate-on-diagram", {
                type: command.type,
                x: px,
                y: py,
              });
            }
          }

          const { params, snapped, rect } = resolveAnnotationTarget(
            command,
            command.type,
            segmentNarration,
          );
          if (snapped) {
            tel?.mark("annotate-snap", {
              type: command.type,
              rect_text: rect?.text?.slice(0, 40),
              rect_x: rect?.x,
              rect_y: rect?.y,
            });
          }

          const { flightMs, drawMs } = speechSplit(command);
          const annotationKind = command.type.toLowerCase() as AnnotationKind;

          if (command.type === "UNDERLINE" && params.length >= 4) {
            const [x1, y1, x2, y2] = params;
            if ([x1, y1, x2, y2].every(Number.isFinite)) {
              await wb.flyCursorTo(x1, y1, flightMs);
              if (cancelRef.current) return;
              await wb.drawAnnotation(
                annotationKind,
                underlinePath(x1, y1, x2, y2),
                drawMs,
              );
            }
          } else if (command.type === "CIRCLE_AROUND" && params.length >= 4) {
            const [x, y, w, h] = params;
            if ([x, y, w, h].every(Number.isFinite)) {
              const emphasisRect =
                snapped && rect
                  ? rect
                  : { x, y, width: w, height: h };
              if (isInDiagramZone(emphasisRect.x, emphasisRect.y)) {
                wb.punchDiagramLineGapsInRect(emphasisRect, 10);
              }
              await wb.flyCursorTo(x + w / 2, y, flightMs);
              if (cancelRef.current) return;
              await wb.drawAnnotation(
                annotationKind,
                emphasisEllipsePath(x, y, w, h),
                drawMs,
              );
            }
          } else if (command.type === "ARROW" && params.length >= 4) {
            const [x1, y1, x2, y2] = params;
            if ([x1, y1, x2, y2].every(Number.isFinite)) {
              await wb.flyCursorTo(x1, y1, flightMs);
              if (cancelRef.current) return;
              await wb.drawAnnotation(
                annotationKind,
                arrowPath(x1, y1, x2, y2),
                drawMs,
              );
            }
          } else if (command.type === "HIGHLIGHT" && params.length >= 4) {
            const [x, y, w, h] = params;
            if ([x, y, w, h].every(Number.isFinite)) {
              await wb.flyCursorTo(x + w / 2, y + h / 2, flightMs);
              if (cancelRef.current) return;
              await wb.drawAnnotation(
                annotationKind,
                highlightRectPath(x, y, w, h),
                drawMs,
              );
            }
          } else if (command.type === "SCRIBBLE" && params.length >= 4) {
            if (params.every(Number.isFinite)) {
              const [x1, y1] = params;
              await wb.flyCursorTo(x1, y1, flightMs);
              if (cancelRef.current) return;
              await wb.drawAnnotation(
                annotationKind,
                scribblePath(params),
                drawMs,
              );
            }
          }

          tel?.mark("annotate-complete", { type: command.type, snapped });
          break;
        }
      }

      tutorDebug("draw", "executeCommand done", { type: command.type });
    },
    [cancellableDelay, forgetErasedTextRects, resetBoardLayout, resolveAnnotationTarget, resolveTextPlacement],
  );

  const executeCommandWithCancel = useCallback(
    async (
      command: DrawCommand,
      options: {
        durationScale?: number;
        speechDurationMs?: number;
        writeSchedule?: WriteSchedule;
        applyLayout?: boolean;
        segmentNarration?: string;
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
      resetBoardLayout(false, false);
      setNarrationText(lastNarration);
      setCurrentSegmentText("");

      if (detail.turns.length === 0) {
        setBoardLoaded(true);
      }

      for (const turn of detail.turns) {
        for (const segment of turn.segments) {
          const commands = parseStoredSegmentCommands(segment.command);
          for (const command of commands) {
            if (!cancelRef.current) {
              await executeCommand(command, { durationScale: 0.05, applyLayout: false });
            }
          }
        }
      }

      setBoardLoaded(true);
    },
    [executeCommand, resetBoardLayout],
  );

  useEffect(() => {
    return () => {
      revokeReplayBlobUrls();
    };
  }, [revokeReplayBlobUrls]);

  useEffect(() => {
    if (!sessionId) return;

    cancelRef.current = false;
    queueMicrotask(() => {
      void restoreBoardFromApi(sessionId);
    });
  }, [sessionId, restoreBoardFromApi]);

  const finishLectureUi = useCallback(() => {
    turnActiveRef.current = false;
    isPausedRef.current = false;
    setIsPaused(false);
    whiteboardRef.current?.setPaused(false);
    ttsClientRef.current?.stop();
    setPhase("idle");
    setShowThinkingOverlay(false);
    setPlanningLesson(false);
    setCurrentSegmentText("");
    setInputInteracted(true);
  }, []);

  const applyTurnPhase = useCallback((next: TutorPhase) => {
    if (turnActiveRef.current && !cancelRef.current) {
      setPhase(next);
    }
  }, []);

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

      applyTurnPhase("speaking");
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
      let speechComplete = false;
      let timingTelemetryCount = 0;
      let lastTimingTelemetryChars = -1;
      const timingWaiters: Array<(timings: AudioTimings | null) => void> = [];

      // Promise that resolves when TTS audio actually starts playing.
      // Non-text commands (DRAW_LINE, DRAW_RECT, etc.) start drawing immediately
      // without waiting for this. Text commands (WRITE/LABEL) await it inside
      // runDraw so they can sync handwriting with speech.
      let audioStartedFlag = false;
      let audioStartedResolver: (() => void) | null = null;
      const audioStartedPromise = new Promise<void>((resolve) => {
        audioStartedResolver = resolve;
      });

      const markSpeechComplete = () => {
        speechComplete = true;
        if (!audioStartedFlag) {
          audioStartedFlag = true;
          audioStartedResolver?.();
        }
      };

      // The ground-truth audio clock: position (ms) within the currently speaking segment,
      // measured from when its audio actually became audible. The Web Audio client schedules
      // playback ~150ms ahead and pauses freeze it, so this is far more accurate than
      // performance.now() at onStart. Monotonic + guarded so the prefetch pipeline flipping
      // to the next job at segment end can't make the clock jump backward and stall a gate.
      let maxAudioPositionMs = -Infinity;
      const wallClockMs = (): number =>
        audioStartedAtMs === null
          ? 0
          : (performance.now() - audioStartedAtMs) * speedRef.current;
      const liveAudioPositionMs = (): number => {
        const durationMs =
          capturedDurationMs ??
          (capturedTimings?.totalDuration
            ? Math.round(capturedTimings.totalDuration * 1000)
            : null);

        if (speechComplete && durationMs !== null && durationMs > 0) {
          const endPosition = durationMs + 40;
          maxAudioPositionMs = Math.max(maxAudioPositionMs, endPosition);
          return endPosition;
        }

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

            if (isTextCommand && hasNarration && !audioStartedFlag) {
              const audioWaitStart = performance.now();
              await raceWithCancel(audioStartedPromise);
              if (cancelRef.current) return;
              await waitForInitialTimings(40);
              if (cancelRef.current) return;
              tutorDebug("draw", "text command waited for audio start", {
                index,
                waited_ms: Math.round(performance.now() - audioWaitStart),
              });
            }

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
                segmentNarration: narration,
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
                segmentNarration: narration,
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
              segmentNarration: narration,
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
        onEnd: () => {
          markSpeechComplete();
        },
        onError: () => {
          markSpeechComplete();
        },
      };

      const speakSegmentWithTimeout = (
        text: string,
        options: Parameters<typeof tts.speakSegment>[1],
      ): Promise<void> => {
        const timeoutMs = Math.min(Math.max(text.length * 250, 45_000), 180_000);
        return raceWithCancel(
          Promise.race([
            tts.speakSegment(text, options),
            new Promise<never>((_, reject) => {
              window.setTimeout(
                () => reject(new Error(`tts segment timeout after ${timeoutMs}ms`)),
                timeoutMs,
              );
            }),
          ]),
        )
          .catch((error) => {
            tutorDebug("tts", "segment speech failed", {
              index,
              error: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => {
            markSpeechComplete();
          });
      };

      try {
        if (hasNarration && !hasCommand) {
          tutorDebug("segment", "narration-only", { index });
          await speakSegmentWithTimeout(narration, speakOptions);
          if (cancelRef.current) return;
          tutorDebug("segment", "narration-only complete", { index });
        } else if (!hasNarration && hasCommand) {
          tutorDebug("segment", "draw-only", { index });
          await runDraw(naturalDrawMs);
          if (cancelRef.current) return;
          tutorDebug("segment", "draw-only complete", { index });
        } else if (hasNarration && hasCommand) {
          tutorDebug("segment", "paired narration+draw", { index });

          const drawPromise = (async () => {
            await runDraw(estimateSpeechMs, null);
          })();

          const speechPromise = speakSegmentWithTimeout(
            narration,
            {
              ...speakOptions,
              onStart: () => {
                if (cancelRef.current || !turnActiveRef.current) return;
                audioStartedFlag = true;
                audioStartedResolver?.();
                tutorDebug("tts", "segment audio started", { index });
                tel?.mark("tts-start", {
                  segment_index: index,
                  chars: narration.length,
                  command_count: segmentCommands.length,
                });
                applyTurnPhase("drawing");
                audioStartedAtMs = performance.now();
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
            },
          );

          await Promise.all([
            speechPromise,
            drawPromise,
          ]);

          if (cancelRef.current) return;
          tutorDebug("segment", "paired narration+draw complete", { index });
        }
      } finally {
        if (!cancelRef.current) {
          const segmentCommands = getSegmentCommands(segment);
          recordedSegmentsRef.current.push({
            orderIndex: index,
            narration: segment.narration,
            spokenText: mathToSpeech(narration),
            command: serializeSegmentCommands(segmentCommands),
            audioBytes: capturedAudio,
            durationMs: capturedDurationMs,
            timings: capturedTimings,
          });
        }
        tutorDebug("segment", "runSegment end", { index, ...segmentMetadata });
        segmentSpan?.end(segmentMetadata);
      }
    },
    [sessionId, cancellableDelay, executeCommandWithCancel, raceWithCancel, applyTurnPhase],
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

      const alreadyQueued = collectedSegmentsRef.current.length;

      if (alreadyQueued > 0) {
        for (let i = alreadyQueued; i < segments.length; i++) {
          enqueueSegment(segments[i]);
        }
      } else {
        collectedSegmentsRef.current = [];
        recordedSegmentsRef.current = [];
        segmentChainRef.current = Promise.resolve();

        for (const segment of segments) {
          enqueueSegment(segment);
        }
      }

      await segmentChainRef.current;
      setNarrationText(lessonNarrationText(responseText));

      if (!cancelRef.current) {
        finishLectureUi();
      }
    },
    [enqueueSegment, finishLectureUi],
  );

  const stopTurn = useCallback(() => {
    if (phase === "idle" && !isReplaying) {
      return;
    }

    cancelRef.current = true;
    turnActiveRef.current = false;

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
    replayCueRef.current = null;
    replayGenerationRef.current += 1;
    ttsClientRef.current?.stop();
    whiteboardRef.current?.cancelAnimations();
    whiteboardRef.current?.setPaused(false);

    segmentChainRef.current = Promise.resolve();
    collectedSegmentsRef.current = [];

    setIsReplaying(false);
    setReplayProgressMs(0);
    setReplayTotalMs(0);
    finishLectureUi();
    setTranscriptOpen(false);
  }, [finishLectureUi, isReplaying, phase]);

  useEffect(() => {
    stopTurnRef.current = stopTurn;
  }, [stopTurn]);

  const pauseTurn = useCallback(() => {
    if (phase === "idle" || isPausedRef.current) {
      return;
    }

    isPausedRef.current = true;
    setIsPaused(true);
    ttsClientRef.current?.pause();
    replayAudioRef.current?.pause();
    whiteboardRef.current?.setPaused(true);
    tutorDebug("turn", "paused");
  }, [phase, isReplaying]);

  const resumeTurn = useCallback(() => {
    if (!isPausedRef.current) {
      return;
    }

    isPausedRef.current = false;
    setIsPaused(false);
    ttsClientRef.current?.resume();
    void replayAudioRef.current?.play().catch(() => undefined);
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
      if (!boardLoaded || !wb) {
        pendingQuestionRef.current = question;
        setInputInteracted(true);
        return;
      }
      if (phase !== "idle") return;

      pendingQuestionRef.current = null;

      tutorDebug("turn", "question submitted", {
        question_preview: question.slice(0, 120),
        board_id: sessionId,
      });

      cancelRef.current = false;
      isPausedRef.current = false;
      setIsPaused(false);
      setIsReplaying(false);
      setTranscriptOpen(false);
      turnActiveRef.current = true;
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
      revokeReplayBlobUrls();
      resetBoardLayout(false, false);
      fbdPhaseMarkedRef.current = false;
      fbdPhaseStartedRef.current = false;
      setShowThinkingOverlay(true);
      setPlanningLesson(false);

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
        let stepStreamBuffer = "";

        const enqueueStepBlock = (block: string) => {
          for (const segment of buildLessonSegments(block)) {
            enqueueSegment(segment);
          }
        };

        const parser = new IncrementalTagParser({
          onSegmentReady: (segment) => {
            tutorDebug("parser", "segment ready from stream", {
              narration_preview: segment.narration.slice(0, 80),
              command_type: segment.command?.type ?? null,
              deferred: stepStreamBuffer.length > 0 || /\[STEP\]/i.test(fullResponse),
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
              setShowThinkingOverlay(false);
              setPlanningLesson(true);
              stepStreamBuffer = drainCompleteStepBlocks(
                stepStreamBuffer + delta,
                enqueueStepBlock,
              );
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
        stepStreamBuffer = drainCompleteStepBlocks(stepStreamBuffer, enqueueStepBlock);

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

            let turnForReplay: StoredTurn | null = null;
            if (savedTurn) {
              turnForReplay = {
                ...savedTurn,
                segments: enrichStoredSegmentsWithReplayAudio(
                  savedTurn.segments,
                  recordedSegmentsRef.current,
                  registerReplayBlobUrl,
                ),
              };
            } else if (recordedSegmentsRef.current.length > 0) {
              turnForReplay = persistTurnForReplay(
                question,
                rawResponseRef.current,
                recordedSegmentsRef.current,
              );
            }

            if (turnForReplay) {
              storedTurnsRef.current = [...storedTurnsRef.current, turnForReplay];
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

        finishLectureUi();

        const telToFlush = turnTelemetryRef.current;
        turnTelemetryRef.current = null;
        void telToFlush?.flush();
      }
    },
    [sessionId, boards, narrationText, phase, processResponseText, resetBoardLayout, boardLoaded, persistTurnForReplay, registerReplayBlobUrl, revokeReplayBlobUrls, finishLectureUi, enqueueSegment],
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      const pending = pendingQuestionRef.current;
      if (!pending || !boardLoaded || !whiteboardRef.current) return;
      void handleQuestion(pending);
    }, 200);
    return () => window.clearInterval(interval);
  }, [boardLoaded, handleQuestion]);

  useEffect(() => {
    if (!boardLoaded || autoSubmitDoneRef.current) return;
    const q = searchParams.get("q");
    if (!q || q.trim().length === 0) return;
    autoSubmitDoneRef.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    pendingQuestionRef.current = q.trim();
    setInputInteracted(true);
  }, [boardLoaded, searchParams]);

  const handleAskDoubt = useCallback(
    (question: string) => {
      void handleQuestion(`I have a doubt about this: ${question}`);
    },
    [handleQuestion],
  );

  const runReplaySegmentDraw = useCallback(
    async (
      segment: StoredSegment,
      segmentCommands: DrawCommand[],
      narration: string,
      audio?: HTMLAudioElement,
      fallbackDurationMs?: number,
    ): Promise<void> => {
      if (segmentCommands.length === 0 || cancelRef.current) {
        return;
      }

      setPhase("drawing");
      const playbackRate = Math.max(speedRef.current, 0.1);
      const totalDrawWeight = segmentCommands.reduce(
        (sum, cmd) => sum + getCommandDrawDurationMs(cmd),
        0,
      );
      const durationMs =
        fallbackDurationMs ??
        segment.durationMs ??
        Math.max(narration.length * 85, 700);

      for (const command of segmentCommands) {
        if (cancelRef.current) {
          return;
        }

        const isTextCommand = command.type === "WRITE" || command.type === "LABEL";
        const charSchedule =
          isTextCommand && narration && segment.timings
            ? getWriteCharScheduleMs(narration, command, segment.timings)
            : null;

        if (charSchedule && charSchedule.offsetsMs.length > 0 && audio) {
          await executeCommandWithCancel(command, {
            applyLayout: false,
            writeSchedule: {
              charStartOffsetsMs: charSchedule.offsetsMs,
              charDurationsMs: charSchedule.charDurationsMs,
              getAudioPositionMs: () => audio.currentTime * 1000,
            },
          });
          continue;
        }

        const speechWindow =
          narration && segment.timings
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

        const commandWeight = getCommandDrawDurationMs(command);
        const commandBudgetMs =
          totalDrawWeight > 0
            ? Math.max(Math.round(durationMs * (commandWeight / totalDrawWeight)), 50)
            : Math.max(Math.round(speechWindow.durationMs), 50);

        await executeCommandWithCancel(command, {
          applyLayout: false,
          speechDurationMs: commandBudgetMs,
        });
      }
    },
    [cancellableDelay, executeCommandWithCancel],
  );

  const waitWhileReplayPaused = useCallback(async (generation: number) => {
    while (isPausedRef.current) {
      if (cancelRef.current || generation !== replayGenerationRef.current) {
        return false;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }
    return !cancelRef.current && generation === replayGenerationRef.current;
  }, []);

  const renderBoardAtTime = useCallback(
    async (timeMs: number, cues: ReplayCue[]) => {
      const wb = whiteboardRef.current;
      if (!wb) {
        return;
      }

      wb.clearBoard();
      resetBoardLayout(false, false);

      for (const cue of cues) {
        if (cue.startMs >= timeMs) {
          break;
        }

        const partialCount =
          cue.endMs <= timeMs
            ? cue.commands.length
            : getPartialCommandCount(cue, timeMs - cue.startMs);

        for (let i = 0; i < partialCount; i++) {
          if (cancelRef.current) {
            return;
          }
          await executeCommand(cue.commands[i]!, {
            durationScale: 0.05,
            applyLayout: false,
          });
        }
      }
    },
    [executeCommand, resetBoardLayout],
  );

  const playReplayCue = useCallback(
    async (
      cue: ReplayCue,
      offsetMs: number,
      generation: number,
      skipDraw: boolean,
    ) => {
      if (cancelRef.current || generation !== replayGenerationRef.current) {
        return;
      }

      const ready = await waitWhileReplayPaused(generation);
      if (!ready) {
        return;
      }

      replayCueRef.current = cue;
      if (cue.narration) {
        setCurrentSegmentText(cue.narration);
      }

      const fallbackDurationMs =
        cue.durationMsStored ?? Math.max(cue.narration.length * 85, 700);
      const remainingMs = Math.max(cue.durationMs - offsetMs, 0);

      try {
        if (cue.audioUrl) {
          setPhase("speaking");
          const { audio, done } = playReplayAudio(cue.audioUrl, {
            playbackRate: speedRef.current,
            maxDurationMs: fallbackDurationMs,
            startAtMs: offsetMs,
            shouldCancel: () =>
              cancelRef.current || generation !== replayGenerationRef.current,
          });
          replayAudioRef.current = audio;

          if (!skipDraw) {
            setPhase("drawing");
            const drawPromise = runReplaySegmentDraw(
              cue.segment,
              cue.commands,
              cue.narration,
              audio,
              fallbackDurationMs,
            );
            await Promise.all([
              raceWithCancel(done),
              raceWithCancel(drawPromise),
            ]);
          } else {
            await raceWithCancel(done);
          }
          replayAudioRef.current = null;
        } else if (!skipDraw && cue.commands.length > 0) {
          await runReplaySegmentDraw(
            cue.segment,
            cue.commands,
            cue.narration,
            undefined,
            fallbackDurationMs,
          );
        } else if (remainingMs > 0) {
          setPhase("speaking");
          await cancellableDelay(remainingMs);
        }
      } catch (error) {
        tutorDebug("turn", "replay segment failed", {
          order_index: cue.segment.orderIndex,
          audio_url: cue.audioUrl,
          error: error instanceof Error ? error.message : String(error),
        });

        if (!skipDraw && cue.commands.length > 0) {
          await runReplaySegmentDraw(
            cue.segment,
            cue.commands,
            cue.narration,
            undefined,
            fallbackDurationMs,
          );
        }
      }

      if (generation === replayGenerationRef.current) {
        setReplayProgressMs(cue.endMs);
      }
    },
    [
      cancellableDelay,
      raceWithCancel,
      runReplaySegmentDraw,
      waitWhileReplayPaused,
    ],
  );

  const playReplayFrom = useCallback(
    async (startMs: number) => {
      const wb = whiteboardRef.current;
      const timeline = buildReplayTimeline(storedTurnsRef.current);
      if (!wb || timeline.cues.length === 0) {
        return;
      }

      if (phase !== "idle" && !isReplaying) {
        return;
      }

      const generation = ++replayGenerationRef.current;
      cancelRef.current = false;
      isPausedRef.current = false;
      setIsPaused(false);
      setIsReplaying(true);
      setReplayTotalMs(timeline.totalMs);
      setReplayProgressMs(startMs);
      setPhase("speaking");

      stopReplayAudio(replayAudioRef.current);
      replayAudioRef.current = null;

      await renderBoardAtTime(startMs, timeline.cues);
      if (cancelRef.current || generation !== replayGenerationRef.current) {
        return;
      }

      const found = findCueAtTime(timeline.cues, startMs);
      if (!found) {
        stopReplayAudio(replayAudioRef.current);
        replayAudioRef.current = null;
        setIsReplaying(false);
        finishLectureUi();
        return;
      }

      try {
        for (let i = found.index; i < timeline.cues.length; i++) {
          if (cancelRef.current || generation !== replayGenerationRef.current) {
            break;
          }

          const cue = timeline.cues[i]!;
          const offsetMs = i === found.index ? found.offsetMs : 0;
          const skipDraw = i === found.index && offsetMs > 0;
          await playReplayCue(cue, offsetMs, generation, skipDraw);
        }

        const lastTurn =
          storedTurnsRef.current[storedTurnsRef.current.length - 1];
        if (lastTurn && generation === replayGenerationRef.current) {
          setNarrationText(lessonNarrationText(lastTurn.rawResponse));
        }
      } finally {
        if (generation !== replayGenerationRef.current) {
          return;
        }
        stopReplayAudio(replayAudioRef.current);
        replayAudioRef.current = null;
        replayCueRef.current = null;
        setIsReplaying(false);
        setReplayProgressMs(timeline.totalMs);
        finishLectureUi();
      }
    },
    [
      finishLectureUi,
      isReplaying,
      phase,
      playReplayCue,
      renderBoardAtTime,
    ],
  );

  const replayLecture = useCallback(() => {
    if (storedTurnsRef.current.length === 0 || isReplaying) {
      return;
    }
    void playReplayFrom(0);
  }, [isReplaying, playReplayFrom]);

  const seekReplay = useCallback(
    (timeMs: number) => {
      if (!isReplaying) {
        return;
      }
      void playReplayFrom(timeMs);
    },
    [isReplaying, playReplayFrom],
  );

  const toggleReplayPlayPause = useCallback(() => {
    if (!isReplaying) {
      return;
    }
    if (isPausedRef.current) {
      resumeTurn();
    } else {
      pauseTurn();
    }
  }, [isReplaying, pauseTurn, resumeTurn]);

  const handleReplaySpeedChange = useCallback((rate: number) => {
    speedRef.current = rate;
    setSettings((prev) => ({ ...prev, speedMultiplier: rate }));
    if (replayAudioRef.current) {
      replayAudioRef.current.playbackRate = rate;
    }
  }, []);

  useEffect(() => {
    if (!isReplaying || isPaused) {
      return;
    }

    let frameId = 0;
    const tick = () => {
      const cue = replayCueRef.current;
      const audio = replayAudioRef.current;
      if (cue && audio && !audio.paused && Number.isFinite(audio.currentTime)) {
        setReplayProgressMs(
          Math.min(cue.startMs + audio.currentTime * 1000, cue.endMs),
        );
      }
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [isReplaying, isPaused]);

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

  const activeStatus = isReplaying
    ? {
        color: "#0077CC",
        label: "replaying\u2026",
        dotClass: "animate-wb-glow-blue",
        labelColor: "#0077CC",
      }
    : isPaused
      ? pausedStatus
      : phase === "thinking" && planningLesson
        ? {
            color: "#0099E5",
            label: "planning lesson\u2026",
            dotClass: "animate-wb-pulse-amber",
            labelColor: "#0099E5",
          }
        : statusConfig[phase];

  const activeBoard = boards.find((b) => b.id === sessionId);
  const activeBoardTitle = activeBoard?.title ?? "";
  const canReplay = phase === "idle" && storedTurnsCount > 0 && !isReplaying;
  const canTranscript = phase === "idle" && narrationText.trim().length > 0 && !isReplaying;
  const isInputOverlay = phase === "idle" && !inputInteracted;
  const inputSubmitMode = storedTurnsCount > 0 ? "doubt" : "ask";

  const inputChrome = (
    <div
      className={`w-full ${isInputOverlay ? "max-w-full md:max-w-[720px]" : "max-w-3xl"}`}
      style={{ margin: "0 auto" }}
    >
      <InputBar
        onSubmit={handleQuestion}
        onAskDoubt={handleAskDoubt}
        disabled={phase !== "idle"}
        submitMode={inputSubmitMode}
        isPaused={isPaused}
        onPauseToggle={() => (isPaused ? resumeTurn() : pauseTurn())}
        onCancel={stopTurn}
        onUserInteractionChange={setInputInteracted}
        compact={isMobile}
      />
    </div>
  );

  return (
    <div
      className="relative flex h-dvh overflow-hidden"
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
        disabled={phase !== "idle"}
        variant={isMobile ? "drawer" : "sidebar"}
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        profileOpen={profileOpen}
        onProfileToggle={() => setProfileOpen(!profileOpen)}
      />

      <div
        className={cn(
          "relative z-10 flex min-h-0 flex-1 flex-col px-3 transition-[margin-left] duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)] md:px-7",
          !sidebarCollapsed && "md:ml-[260px]",
        )}
      >
        <div className="flex shrink-0 items-center justify-end gap-1 px-1 py-2.5 pt-2.5 md:px-4 md:pb-1">
          {isMobile && (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open board history"
              className="mr-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-md border-none bg-transparent transition-colors hover:bg-[rgba(0,119,204,0.1)] md:hidden"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#0099E5"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
          )}
          {!isMobile && sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Open sidebar"
              className="mr-auto hidden h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md border-none bg-transparent transition-colors hover:bg-[rgba(0,119,204,0.1)] md:flex"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#0099E5"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
          )}
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <LessonActions
              canReplay={canReplay}
              canTranscript={canTranscript}
              isReplaying={isReplaying}
              onReplay={replayLecture}
              onTranscript={() => setTranscriptOpen(true)}
              compact={isMobile}
            />
            {(phase !== "idle" || isReplaying) && (
              <button
                type="button"
                onClick={stopTurn}
                aria-label={isReplaying ? "Stop replay" : "Stop teaching"}
                className="flex shrink-0 items-center justify-center rounded-full border border-[rgba(217,112,112,0.35)] bg-[rgba(217,112,112,0.12)] px-2.5 py-1 text-[0.7rem] text-[#9E4040] transition-colors hover:bg-[rgba(217,112,112,0.22)] sm:px-2.5"
              >
                <span className="hidden sm:inline">Stop</span>
                <svg
                  className="sm:hidden"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden
                >
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              </button>
            )}
            {(phase !== "idle" || isReplaying) && (
              <span
                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${activeStatus.dotClass}`}
                style={{
                  backgroundColor: activeStatus.color,
                }}
              />
            )}
            {(phase !== "idle" || isReplaying) && (
              <span
                className="hidden text-[0.7rem] sm:inline"
                style={{
                  color: activeStatus.labelColor,
                  transition: "color 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              >
                {activeStatus.label}
              </span>
            )}
          </div>
        </div>

        <main className="relative flex flex-1 flex-col min-h-0">
          {activeBoardTitle && activeBoardTitle !== "new board" && (
            <div className="flex shrink-0 items-center justify-center px-3 py-1.5">
              <span
                className="select-none text-sm font-semibold capitalize tracking-wide text-[#0099E5] md:text-[1.05rem]"
              >
                {activeBoardTitle}
              </span>
            </div>
          )}

          <div
            className="relative mt-2 min-h-0 flex-1 overflow-hidden rounded-2xl md:mt-2.5"
            style={{
              background: WHITEBOARD_COLOR,
              boxShadow: "0 1px 4px rgba(0, 0, 0, 0.05), inset 0 0 0 1px rgba(0, 119, 204, 0.08)",
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
                <div className="pointer-events-auto w-full max-w-full md:max-w-[720px]">
                  {inputChrome}
                </div>
              </div>
            )}

            {showThinkingOverlay && (
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

            <TranscriptDialog
              text={narrationText}
              open={transcriptOpen}
              onClose={() => setTranscriptOpen(false)}
            />

            <button
              type="button"
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
              className={cn(
                "pointer-events-auto absolute right-3 z-40 flex h-10 w-10 items-center justify-center rounded-full transition-all",
                "border border-[rgba(119,176,170,0.35)] bg-white/90 shadow-sm backdrop-blur-sm",
                "hover:bg-white hover:shadow-md active:scale-95",
                isReplaying ? "bottom-24 md:bottom-28" : "bottom-3",
              )}
              style={{
                color: settings.speedMultiplier > 1 ? "#135D66" : "rgba(0,60,67,0.65)",
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>

            <div
              ref={boardContainerRef}
              className="absolute inset-0 z-[1] overflow-hidden"
            >
              <div
                style={{
                  position: "absolute",
                  top: boardViewport.offsetY,
                  left: boardViewport.offsetX,
                  width: BOARD_WIDTH * boardViewport.scale,
                  height: BOARD_HEIGHT * boardViewport.scale,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: BOARD_WIDTH,
                    height: BOARD_HEIGHT,
                    transform: `scale(${boardViewport.scale})`,
                    transformOrigin: "top left",
                  }}
                >
                  <Whiteboard
                    ref={whiteboardRef}
                    width={BOARD_WIDTH}
                    height={BOARD_HEIGHT}
                    cursorState={cursorState}
                    inkColor={getMarkerColorHex(settings.markerColor)}
                  />
                </div>

                <ResponseBubble
                  text={currentSegmentText}
                  visible={
                    settings.subtitlesEnabled &&
                    (phase === "speaking" || phase === "drawing")
                  }
                />

                <ReplayControls
                  visible={isReplaying}
                  playing={isReplaying && !isPaused}
                  progressMs={replayProgressMs}
                  totalMs={replayTotalMs}
                  playbackRate={settings.speedMultiplier}
                  onPlayPause={toggleReplayPlayPause}
                  onSeek={seekReplay}
                  onPlaybackRateChange={handleReplaySpeedChange}
                  onStop={stopTurn}
                />
              </div>
            </div>
          </div>
        </main>

        {!isInputOverlay && (
          <footer className="relative shrink-0 pb-3 pt-2">
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
