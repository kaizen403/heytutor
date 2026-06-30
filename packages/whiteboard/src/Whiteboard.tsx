"use client";

import Konva from "konva";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { textToStrokePaths } from "@heytutor/drawing";
import { Layer, Path as KonvaPath, Rect, Stage } from "react-konva";
import { VirtualCursor } from "./VirtualCursor";

export type CursorState = "idle" | "thinking" | "speaking" | "drawing" | "erasing";

export interface WhiteboardProps {
  width?: number;
  height?: number;
  cursorState?: CursorState;
  inkColor?: string;
}

export interface WriteSchedule {
  /** Start time (ms from audible audio start) for each non-space character, in order. */
  charStartOffsetsMs: number[];
  /** Spoken duration (ms) for each character — pen speed elastically tracks this. */
  charDurationsMs?: number[];
  /**
   * Returns the current audio playback position in ms from audible start (pause-aware,
   * may be negative before the audio is audible). Each character is held until the
   * audio clock reaches its scheduled offset, keeping writing locked to the voice.
   */
  getAudioPositionMs: () => number;
  onCharacterStart?: (event: {
    char: string;
    index: number;
    targetMs: number;
    audioPositionMs: number;
  }) => void;
}

export type AnnotationKind =
  | "underline"
  | "circle_around"
  | "arrow"
  | "highlight"
  | "scribble";

export interface AnnotationOptions {
  strokeWidth?: number;
  fillColor?: string;
  fillOpacity?: number;
}

export interface WhiteboardHandle {
  drawShape: (pathData: string, duration: number) => Promise<void>;
  drawAnnotation: (
    kind: AnnotationKind,
    pathData: string,
    duration: number,
    options?: AnnotationOptions,
  ) => Promise<void>;
  writeText: (
    text: string,
    x: number,
    y: number,
    duration: number,
    schedule?: WriteSchedule,
  ) => Promise<void>;
  clearBoard: (duration?: number) => Promise<void>;
  eraseRegion: (x: number, y: number, width: number, height: number, duration: number) => Promise<void>;
  /** Split diagram vector lines that pass through a label emphasis region. */
  punchDiagramLineGapsInRect: (
    rect: { x: number; y: number; width: number; height: number },
    margin?: number,
  ) => void;
  setCursorPos: (x: number, y: number) => void;
  setCursorState: (state: CursorState) => void;
  flyCursorTo: (x: number, y: number, duration: number, targetRotation?: number) => Promise<void>;
  setPaused: (paused: boolean) => void;
  cancelAnimations: () => void;
  setAnimationSpeed: (multiplier: number) => void;
  getDrawLayer: () => Konva.Layer | null;
  getAnimLayer: () => Konva.Layer | null;
  getCursorLayer: () => Konva.Layer | null;
}

interface CursorView {
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

interface Point {
  x: number;
  y: number;
}

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 700;
const WHITEBOARD_COLOR = "#F8F6F0";
const DEFAULT_INK_COLOR = "#222222";
const HIGHLIGHT_FILL = "#B8D4B8";
const HIGHLIGHT_OPACITY = 0.18;
const ANNOTATION_STROKE_WIDTH = 3.25;
const SHAPE_STROKE_WIDTH = 2.5;
const DIAGRAM_LINE_PATH_RE =
  /^M\s*([-\d.]+)\s+([-\d.]+)\s+L\s*([-\d.]+)\s+([-\d.]+)\s*$/;
const CURSOR_BLUE = "#3380FF";
const DUSTER_WIDTH = 28;
const DUSTER_HEIGHT = 14;
const DUSTER_COLOR = "#D4CDBE";
const DUSTER_STROKE = "#B8B0A0";
const DUSTER_CORNER_RADIUS = 3;
const HANDWRITING_ROTATION = -35;
const HIDDEN_PATH_DATA = "M 0 0";

function rotationFromPathTangent(
  path: Konva.Path,
  drawnLength: number,
  totalLength: number,
  fallbackRotation: number,
): number {
  const point = path.getPointAtLength(drawnLength);
  const aheadLength = Math.min(drawnLength + 2, totalLength);
  const aheadPoint = path.getPointAtLength(aheadLength);

  if (!point || !aheadPoint) {
    return fallbackRotation;
  }

  const dx = aheadPoint.x - point.x;
  const dy = aheadPoint.y - point.y;

  if (Math.abs(dx) <= 0.01 && Math.abs(dy) <= 0.01) {
    return fallbackRotation;
  }

  const rotation = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  return Math.max(-80, Math.min(80, rotation));
}

function clampPenRotation(rotation: number): number {
  return Math.max(-60, Math.min(-20, rotation));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function smoothstep(progress: number): number {
  return progress * progress * (3 - 2 * progress);
}

function distanceBetween(start: Point, end: Point): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function resolveFlightDuration(distance: number, requestedDuration: number): number {
  if (Number.isFinite(requestedDuration) && requestedDuration > 0) {
    return requestedDuration;
  }

  return clamp(distance / 800, 0.4, 1.2) * 1000;
}

function bezierPoint(start: Point, control: Point, end: Point, t: number): Point {
  const oneMinusT = 1 - t;

  return {
    x:
      oneMinusT * oneMinusT * start.x +
      2 * oneMinusT * t * control.x +
      t * t * end.x,
    y:
      oneMinusT * oneMinusT * start.y +
      2 * oneMinusT * t * control.y +
      t * t * end.y,
  };
}

function cursorOpacity(state: CursorState): number {
  if (state === "erasing") {
    return 0.95;
  }

  if (state === "thinking") {
    return 0.75;
  }

  if (state === "speaking") {
    return 0.9;
  }

  return 1;
}

export const Whiteboard = forwardRef<WhiteboardHandle, WhiteboardProps>(
  function Whiteboard(
    {
      width = DEFAULT_WIDTH,
      height = DEFAULT_HEIGHT,
      cursorState = "idle",
      inkColor = DEFAULT_INK_COLOR,
    },
    ref,
  ) {
    const drawLayerRef = useRef<Konva.Layer>(null);
    const highlightLayerRef = useRef<Konva.Layer>(null);
    const animLayerRef = useRef<Konva.Layer>(null);
    const cursorLayerRef = useRef<Konva.Layer>(null);
    const frameIdsRef = useRef<Set<number>>(new Set());
    const animationCleanupsRef = useRef<Set<() => void>>(new Set());
    const completedNodesRef = useRef<Set<Konva.Node>>(new Set());
    const animNodesRef = useRef<Set<Konva.Node>>(new Set());
    const strokeLengthCacheRef = useRef<Map<string, number>>(new Map());
    const mountedRef = useRef(true);
    const isPausedRef = useRef(false);
    const animationSpeedRef = useRef(1);
    const cursorViewRef = useRef<CursorView>({ x: width / 2, y: height / 2, rotation: 0, scale: 1 });
    const [cursorView, setCursorView] = useState<CursorView>(cursorViewRef.current);
    const [activeCursorState, setActiveCursorState] = useState<CursorState>(cursorState);
    const activeCursorStateRef = useRef<CursorState>(cursorState);
    const inkColorRef = useRef(inkColor);

    useEffect(() => {
      inkColorRef.current = inkColor;
    }, [inkColor]);

    const updateCursorState = useCallback((state: CursorState): void => {
      activeCursorStateRef.current = state;
      if (mountedRef.current) {
        setActiveCursorState(state);
      }
    }, []);

    const requestTrackedFrame = useCallback((callback: FrameRequestCallback): number => {
      const frameId = requestAnimationFrame((time) => {
        frameIdsRef.current.delete(frameId);
        callback(time);
      });

      frameIdsRef.current.add(frameId);
      return frameId;
    }, []);

    const cancelTrackedFrame = useCallback((frameId: number): void => {
      cancelAnimationFrame(frameId);
      frameIdsRef.current.delete(frameId);
    }, []);

    const setCursorViewSafely = useCallback(
      (x: number, y: number, rotation = cursorViewRef.current.rotation, scale = cursorViewRef.current.scale): void => {
        const nextView = { x, y, rotation, scale };

        cursorViewRef.current = nextView;
        if (mountedRef.current) {
          setCursorView(nextView);
        }
      },
      [],
    );

    const animateOver = useCallback(
      (duration: number, onFrame: (progress: number) => void): Promise<void> =>
        new Promise((resolve) => {
          let frameId: number | null = null;
          let startTime: number | null = null;
          let pauseStartedAt: number | null = null;
          let pausedAccumMs = 0;
          let isDone = false;

          const cleanup = (): void => {
            if (isDone) {
              return;
            }

            isDone = true;
            if (frameId !== null) {
              cancelTrackedFrame(frameId);
            }
            animationCleanupsRef.current.delete(cleanup);
            resolve();
          };

          const step = (now: number): void => {
            if (isDone) {
              return;
            }

            startTime ??= now;

            if (isPausedRef.current) {
              pauseStartedAt ??= now;
              frameId = requestTrackedFrame(step);
              return;
            }

            if (pauseStartedAt !== null) {
              pausedAccumMs += now - pauseStartedAt;
              pauseStartedAt = null;
            }

            const progress =
              duration <= 0
                ? 1
                : clamp(
                    ((now - startTime - pausedAccumMs) / duration) * animationSpeedRef.current,
                    0,
                    1,
                  );

            onFrame(progress);

            if (progress < 1) {
              frameId = requestTrackedFrame(step);
              return;
            }

            cleanup();
          };

          animationCleanupsRef.current.add(cleanup);
          frameId = requestTrackedFrame(step);
        }),
      [cancelTrackedFrame, requestTrackedFrame],
    );

    const cancelAnimations = useCallback((): void => {
      Array.from(animationCleanupsRef.current).forEach((cleanup) => cleanup());
      Array.from(frameIdsRef.current).forEach((frameId) => cancelAnimationFrame(frameId));
      frameIdsRef.current.clear();
    }, []);

    const clearTrackedNodes = useCallback((nodes: Set<Konva.Node>): void => {
      nodes.forEach((node) => {
        node.destroy();
      });
      nodes.clear();
    }, []);

    const destroyNodesInRect = useCallback(
      (nodes: Set<Konva.Node>, rect: { x: number; y: number; width: number; height: number }): void => {
        nodes.forEach((node) => {
          const clientRect = node.getClientRect();
          if (
            clientRect.x < rect.x + rect.width &&
            clientRect.x + clientRect.width > rect.x &&
            clientRect.y < rect.y + rect.height &&
            clientRect.y + clientRect.height > rect.y
          ) {
            node.destroy();
            nodes.delete(node);
          }
        });
      },
      [],
    );

    const drawShape = useCallback(
      async (pathData: string, duration: number): Promise<void> => {
        const drawLayer = drawLayerRef.current;
        const animLayer = animLayerRef.current;

        if (!drawLayer || !animLayer) {
          return;
        }

        const path = new Konva.Path({
          data: pathData,
          stroke: inkColorRef.current,
          strokeWidth: SHAPE_STROKE_WIDTH,
          fillEnabled: false,
          lineCap: "round",
          lineJoin: "round",
          listening: false,
        });
        const totalLength = path.getLength();

        path.dash([totalLength]);
        path.dashOffset(totalLength);
        animLayer.add(path);
        animNodesRef.current.add(path);
        animLayer.batchDraw();

        await animateOver(duration, (progress) => {
          const drawnLength = progress * totalLength;
          const point = path.getPointAtLength(drawnLength);

          path.dashOffset(totalLength - drawnLength);
          if (point) {
            setCursorViewSafely(point.x, point.y, HANDWRITING_ROTATION);
          }
          animLayer.batchDraw();
        });

        path.dash([]);
        path.dashOffset(0);
        path.moveTo(drawLayer);
        animNodesRef.current.delete(path);
        completedNodesRef.current.add(path);
        animLayer.batchDraw();
        drawLayer.batchDraw();
      },
      [animateOver, setCursorViewSafely],
    );

    const punchDiagramLineGapsInRect = useCallback(
      (
        rect: { x: number; y: number; width: number; height: number },
        margin = 8,
      ): void => {
        const drawLayer = drawLayerRef.current;
        if (!drawLayer) {
          return;
        }

        const gapLeft = rect.x - margin;
        const gapRight = rect.x + rect.width + margin;
        const gapTop = rect.y - margin;
        const gapBottom = rect.y + rect.height + margin;
        const toDestroy: Konva.Path[] = [];
        const replacements: Konva.Path[] = [];

        const considerNode = (node: Konva.Node, tracked: Set<Konva.Node>): void => {
          if (!(node instanceof Konva.Path)) {
            return;
          }
          if (node.strokeWidth() !== SHAPE_STROKE_WIDTH || !node.strokeEnabled()) {
            return;
          }

          const data = node.data()?.trim();
          if (!data) {
            return;
          }

          const match = data.match(DIAGRAM_LINE_PATH_RE);
          if (!match) {
            return;
          }

          const x1 = Number.parseFloat(match[1]);
          const y1 = Number.parseFloat(match[2]);
          const x2 = Number.parseFloat(match[3]);
          const y2 = Number.parseFloat(match[4]);
          if (![x1, y1, x2, y2].every(Number.isFinite)) {
            return;
          }

          const isHorizontal = Math.abs(y1 - y2) < 1;
          const isVertical = Math.abs(x1 - x2) < 1;
          if (!isHorizontal && !isVertical) {
            return;
          }

          const segments: Array<[number, number, number, number]> = [];

          if (isHorizontal) {
            const y = (y1 + y2) / 2;
            if (y < gapTop || y > gapBottom) {
              return;
            }

            const left = Math.min(x1, x2);
            const right = Math.max(x1, x2);
            if (right < gapLeft || left > gapRight) {
              return;
            }

            if (left < gapLeft - 0.5) {
              segments.push([left, y, Math.min(gapLeft, right), y]);
            }
            if (right > gapRight + 0.5) {
              segments.push([Math.max(gapRight, left), y, right, y]);
            }
          } else {
            const x = (x1 + x2) / 2;
            if (x < gapLeft || x > gapRight) {
              return;
            }

            const top = Math.min(y1, y2);
            const bottom = Math.max(y1, y2);
            if (bottom < gapTop || top > gapBottom) {
              return;
            }

            if (top < gapTop - 0.5) {
              segments.push([x, top, x, Math.min(gapTop, bottom)]);
            }
            if (bottom > gapBottom + 0.5) {
              segments.push([x, Math.max(gapBottom, top), x, bottom]);
            }
          }

          if (segments.length === 0) {
            toDestroy.push(node);
            tracked.delete(node);
            return;
          }

          toDestroy.push(node);
          tracked.delete(node);

          for (const [sx, sy, ex, ey] of segments) {
            if (Math.hypot(ex - sx, ey - sy) < 1) {
              continue;
            }

            replacements.push(
              new Konva.Path({
                data: `M ${sx} ${sy} L ${ex} ${ey}`,
                stroke: node.stroke(),
                strokeWidth: SHAPE_STROKE_WIDTH,
                fillEnabled: false,
                lineCap: "round",
                lineJoin: "round",
                listening: false,
              }),
            );
          }
        };

        Array.from(completedNodesRef.current).forEach((node) => {
          considerNode(node, completedNodesRef.current);
        });
        Array.from(animNodesRef.current).forEach((node) => {
          considerNode(node, animNodesRef.current);
        });

        toDestroy.forEach((node) => {
          node.destroy();
        });

        replacements.forEach((path) => {
          drawLayer.add(path);
          completedNodesRef.current.add(path);
        });

        if (toDestroy.length > 0 || replacements.length > 0) {
          drawLayer.batchDraw();
        }
      },
      [],
    );

    const drawAnnotation = useCallback(
      async (
        kind: AnnotationKind,
        pathData: string,
        duration: number,
        options: AnnotationOptions = {},
      ): Promise<void> => {
        const drawLayer = drawLayerRef.current;
        const highlightLayer = highlightLayerRef.current;
        const animLayer = animLayerRef.current;

        if (!drawLayer || !animLayer) {
          return;
        }

        if (kind === "highlight") {
          const targetLayer = highlightLayer ?? drawLayer;
          const rect = new Konva.Path({
            data: pathData,
            fill: options.fillColor ?? HIGHLIGHT_FILL,
            opacity: 0,
            strokeEnabled: false,
            listening: false,
          });

          targetLayer.add(rect);
          completedNodesRef.current.add(rect);
          targetLayer.batchDraw();

          await animateOver(duration, (progress) => {
            rect.opacity((options.fillOpacity ?? HIGHLIGHT_OPACITY) * progress);
            targetLayer.batchDraw();
          });

          rect.opacity(options.fillOpacity ?? HIGHLIGHT_OPACITY);
          targetLayer.batchDraw();
          return;
        }

        const strokeWidth = options.strokeWidth ?? ANNOTATION_STROKE_WIDTH;
        const path = new Konva.Path({
          data: pathData,
          stroke: inkColorRef.current,
          strokeWidth,
          fillEnabled: false,
          lineCap: "round",
          lineJoin: "round",
          listening: false,
        });
        const totalLength = Math.max(path.getLength(), 1);

        path.dash([totalLength]);
        path.dashOffset(totalLength);
        animLayer.add(path);
        animNodesRef.current.add(path);
        animLayer.batchDraw();

        await animateOver(duration, (progress) => {
          const drawnLength = progress * totalLength;
          const point = path.getPointAtLength(drawnLength);

          path.dashOffset(totalLength - drawnLength);
          if (point) {
            setCursorViewSafely(point.x, point.y, HANDWRITING_ROTATION);
          }
          animLayer.batchDraw();
        });

        path.dash([]);
        path.dashOffset(0);
        path.moveTo(drawLayer);
        animNodesRef.current.delete(path);
        completedNodesRef.current.add(path);
        animLayer.batchDraw();
        drawLayer.batchDraw();
      },
      [animateOver, setCursorViewSafely],
    );

    const flyCursorTo = useCallback(
      async (
        x: number,
        y: number,
        duration: number,
        targetRotation?: number,
      ): Promise<void> => {
        const start = { x: cursorViewRef.current.x, y: cursorViewRef.current.y };
        const end = { x, y };
        const distance = distanceBetween(start, end);
        const fixedRotation = targetRotation ?? HANDWRITING_ROTATION;

        if (distance === 0) {
          setCursorViewSafely(x, y, fixedRotation, 1);
          return;
        }

        if (distance < 15) {
          setCursorViewSafely(x, y, fixedRotation, 1);
          return;
        }

        const flightDuration = resolveFlightDuration(distance, duration);

        await animateOver(flightDuration, (linearProgress) => {
          const easedProgress = smoothstep(linearProgress);
          const point = {
            x: start.x + (end.x - start.x) * easedProgress,
            y: start.y + (end.y - start.y) * easedProgress,
          };

          setCursorViewSafely(point.x, point.y, fixedRotation, 1);
          cursorLayerRef.current?.batchDraw();
        });

        setCursorViewSafely(x, y, fixedRotation, 1);
      },
      [animateOver, setCursorViewSafely],
    );

    const waitForAudioPosition = useCallback(
      (targetMs: number, getAudioPositionMs: () => number): Promise<void> =>
        new Promise((resolve) => {
          let done = false;
          const startWall = performance.now();
          let lastPositionMs = -1;
          let stalledFrames = 0;

          const cleanup = (): void => {
            if (done) return;
            done = true;
            animationCleanupsRef.current.delete(cleanup);
            resolve();
          };

          const step = (): void => {
            if (done) return;
            if (!mountedRef.current) {
              cleanup();
              return;
            }
            const positionMs = getAudioPositionMs();
            if (positionMs >= targetMs) {
              cleanup();
              return;
            }
            if (positionMs > 0 && positionMs === lastPositionMs) {
              stalledFrames += 1;
              // Audio clock stopped advancing — release the pen instead of hanging the lesson.
              if (stalledFrames >= 30) {
                cleanup();
                return;
              }
            } else {
              stalledFrames = 0;
              lastPositionMs = positionMs;
            }
            // Safety valve: never hang the lesson if the audio clock stalls (errored audio).
            if (performance.now() - startWall > targetMs + 4000) {
              cleanup();
              return;
            }
            requestTrackedFrame(step);
          };

          animationCleanupsRef.current.add(cleanup);
          requestTrackedFrame(step);
        }),
      [requestTrackedFrame],
    );

    const writeText = useCallback(
      async (
        text: string,
        x: number,
        y: number,
        duration: number,
        schedule?: WriteSchedule,
      ): Promise<void> => {
        const drawLayer = drawLayerRef.current;
        const animLayer = animLayerRef.current;

        if (!drawLayer || !animLayer) {
          return;
        }

        try {
          const characterPaths = await textToStrokePaths(text, x, y, 32);

          if (characterPaths.length === 0) {
            return;
          }

          // Per-character stroke lengths, so a character's draw budget can be split
          // across its own strokes (used by both legacy and scheduled modes).
          const charInfos = characterPaths.map((charPath) => {
            const strokeLengths = charPath.strokes.map((stroke) => {
              const cacheKey = `${stroke.width}:${stroke.pathData}`;
              const cachedLength = strokeLengthCacheRef.current.get(cacheKey);
              if (cachedLength !== undefined) {
                return cachedLength;
              }

              const probe = new Konva.Path({
                data: stroke.pathData,
                strokeWidth: stroke.width,
              });
              const length = Math.max(probe.getLength(), 1);
              probe.destroy();
              strokeLengthCacheRef.current.set(cacheKey, length);
              if (strokeLengthCacheRef.current.size > 4000) {
                strokeLengthCacheRef.current.clear();
              }
              return length;
            });
            return {
              charPath,
              strokeLengths,
              pathLength: strokeLengths.reduce((sum, length) => sum + length, 0),
            };
          });

          const strokeCount = charInfos.reduce((sum, info) => sum + info.charPath.strokes.length, 0);
          const fallbackCount = charInfos.filter((info) => info.charPath.strokes.length === 0).length;
          const totalStrokes = strokeCount + fallbackCount;

          if (totalStrokes === 0) {
            return;
          }

          // When a schedule is supplied, each character is gated against the true audio
          // playback clock so writing tracks the narration word by word — and never drifts,
          // because every character re-anchors to the real audio position.
          const offsets = schedule?.charStartOffsetsMs;
          const scheduled = Array.isArray(offsets) && offsets.length > 0;
          const audioPositionMs = schedule?.getAudioPositionMs;

          const flyBudgetMs = Math.min(totalStrokes * 2, duration * 0.06);
          const drawBudgetMs = Math.max(duration - flyBudgetMs, totalStrokes * 3);
          const totalPathLength = charInfos.reduce((sum, info) => sum + info.pathLength, 0);
          const fallbackDrawMs =
            fallbackCount > 0 ? (drawBudgetMs * fallbackCount) / totalStrokes : 0;
          let previousScheduledBudgetMs = 72;

          for (let ci = 0; ci < charInfos.length; ci++) {
            if (!mountedRef.current) return;

            const { charPath, strokeLengths, pathLength } = charInfos[ci];

            let charBudgetMs: number;
            if (scheduled && offsets && audioPositionMs) {
              const start = offsets[Math.min(ci, offsets.length - 1)] ?? 0;
              // Hold this character until the voice actually reaches its spoken moment.
              await waitForAudioPosition(start, audioPositionMs);
              if (!mountedRef.current) return;
              schedule?.onCharacterStart?.({
                char: charPath.char,
                index: ci,
                targetMs: start,
                audioPositionMs: audioPositionMs(),
              });
              const next = ci + 1 < offsets.length ? offsets[ci + 1] : start + 160;
              const lagMs = Math.max(audioPositionMs() - start, 0);
              const spokenSlotMs = Math.max(next - start, 45);
              const targetBudgetMs =
                lagMs > 220
                  ? clamp(spokenSlotMs * 0.45, 28, 76)
                  : lagMs > 100
                    ? clamp(spokenSlotMs * 0.62, 34, 98)
                    : clamp(spokenSlotMs * 0.78, 42, 128);

              // Dampen speed changes so writing feels like a hand accelerating,
              // not a metronome that snaps between very fast and very slow.
              charBudgetMs = clamp(
                previousScheduledBudgetMs * 0.65 + targetBudgetMs * 0.35,
                previousScheduledBudgetMs * 0.72,
                previousScheduledBudgetMs * 1.28,
              );
              previousScheduledBudgetMs = charBudgetMs;
            } else {
              charBudgetMs =
                charPath.strokes.length === 0
                  ? Math.max(fallbackDrawMs, 30)
                  : Math.max((pathLength / Math.max(totalPathLength, 1)) * drawBudgetMs, 3);
            }

            if (charPath.strokes.length === 0) {
              const textNode = new Konva.Text({
                text: charPath.char,
                x: charPath.x,
                y: charPath.y,
                opacity: 0,
                fontFamily: "Caveat, cursive",
                fontSize: charPath.fontSize ?? 32,
                fill: inkColorRef.current,
                listening: false,
              });

              const charDuration = Math.max(charBudgetMs, 30);
              animLayer.add(textNode);
              animNodesRef.current.add(textNode);
              animLayer.batchDraw();

              await animateOver(charDuration, (progress) => {
                textNode.opacity(progress);
                setCursorViewSafely(
                  charPath.x + charPath.width * progress,
                  charPath.y,
                  HANDWRITING_ROTATION,
                );
                animLayer.batchDraw();
              });

              textNode.opacity(1);
              textNode.moveTo(drawLayer);
              animNodesRef.current.delete(textNode);
              completedNodesRef.current.add(textNode);
              animLayer.batchDraw();
              drawLayer.batchDraw();
              continue;
            }

            for (let si = 0; si < charPath.strokes.length; si++) {
              if (!mountedRef.current) return;

              const stroke = charPath.strokes[si];
              const pathLength = strokeLengths[si];
              const strokeDuration = scheduled
                ? Math.max((pathLength / Math.max(charInfos[ci].pathLength, 1)) * charBudgetMs, 9)
                : Math.max(
                    (pathLength / Math.max(totalPathLength, 1)) * drawBudgetMs,
                    3,
                  );
              const flyMs = scheduled
                ? Math.min(3, strokeDuration * 0.02)
                : Math.min(3, strokeDuration * 0.04);

              const cursorPos = cursorViewRef.current;
              const dist = Math.hypot(
                stroke.startX - cursorPos.x,
                stroke.startY - cursorPos.y,
              );

              if (scheduled && dist <= 36) {
                setCursorViewSafely(stroke.startX, stroke.startY, HANDWRITING_ROTATION);
              } else if (dist > 12) {
                await flyCursorTo(stroke.startX, stroke.startY, flyMs, HANDWRITING_ROTATION);
              } else {
                setCursorViewSafely(stroke.startX, stroke.startY, HANDWRITING_ROTATION);
              }
              if (!mountedRef.current) return;

              const pathNode = new Konva.Path({
                data: stroke.pathData,
                stroke: inkColorRef.current,
                strokeWidth: stroke.width,
                fillEnabled: false,
                lineCap: "round",
                lineJoin: "round",
                listening: false,
              });

              const totalLength = pathNode.getLength();
              if (totalLength <= 0) {
                pathNode.destroy();
                continue;
              }

              pathNode.dash([totalLength]);
              pathNode.dashOffset(totalLength);
              animLayer.add(pathNode);
              animNodesRef.current.add(pathNode);
              animLayer.batchDraw();

              await animateOver(strokeDuration, (progress) => {
                const drawnLength = progress * totalLength;
                const point = pathNode.getPointAtLength(drawnLength);

                pathNode.dashOffset(totalLength - drawnLength);
                if (point) {
                  setCursorViewSafely(point.x, point.y, HANDWRITING_ROTATION);
                }
                animLayer.batchDraw();
              });

              pathNode.dash([]);
              pathNode.dashOffset(0);
              pathNode.moveTo(drawLayer);
              animNodesRef.current.delete(pathNode);
              completedNodesRef.current.add(pathNode);
              animLayer.batchDraw();
              drawLayer.batchDraw();
            }
          }
        } catch {
          const textNode = new Konva.Text({
            text,
            x,
            y,
            opacity: 0,
            fontFamily: "Caveat, cursive",
            fontSize: 32,
            fill: inkColorRef.current,
            listening: false,
          });

          animLayer.add(textNode);
          animNodesRef.current.add(textNode);
          setCursorViewSafely(x, y, HANDWRITING_ROTATION);
          animLayer.batchDraw();

          await animateOver(duration, (progress) => {
            textNode.opacity(progress);
            setCursorViewSafely(x + textNode.getTextWidth() * progress, y, HANDWRITING_ROTATION);
            animLayer.batchDraw();
          });

          textNode.opacity(1);
          textNode.moveTo(drawLayer);
          animNodesRef.current.delete(textNode);
          completedNodesRef.current.add(textNode);
          animLayer.batchDraw();
          drawLayer.batchDraw();
        }
      },
      [animateOver, flyCursorTo, setCursorViewSafely, waitForAudioPosition],
    );

    const eraseRegion = useCallback(
      async (x: number, y: number, regionWidth: number, regionHeight: number, duration: number): Promise<void> => {
        const drawLayer = drawLayerRef.current;
        const animLayer = animLayerRef.current;
        const cursorLayer = cursorLayerRef.current;

        if (!drawLayer || !animLayer || !cursorLayer) {
          return;
        }

        const previousCursorState = activeCursorStateRef.current;
        updateCursorState("erasing");

        const targetY = y + regionHeight / 2;
        await flyCursorTo(x, targetY, Math.min(duration * 0.3, 800));

        const sweepDuration = Math.max(duration * 0.7, 100);
        await animateOver(sweepDuration, (progress) => {
          const sweepX = x + regionWidth * progress;
          setCursorViewSafely(sweepX, targetY, 0, 1);

          const erasedRect = { x, y, width: regionWidth * progress, height: regionHeight };
          destroyNodesInRect(completedNodesRef.current, erasedRect);
          destroyNodesInRect(animNodesRef.current, erasedRect);

          drawLayer.batchDraw();
          animLayer.batchDraw();
          cursorLayer.batchDraw();
        });

        updateCursorState(previousCursorState);
      },
      [animateOver, destroyNodesInRect, flyCursorTo, setCursorViewSafely, updateCursorState],
    );

    const clearBoard = useCallback(
      async (duration?: number): Promise<void> => {
        const drawLayer = drawLayerRef.current;
        const animLayer = animLayerRef.current;
        const cursorLayer = cursorLayerRef.current;

        if (!drawLayer || !animLayer || !cursorLayer) {
          return;
        }

        if (duration && duration > 0) {
          const previousCursorState = activeCursorStateRef.current;
          updateCursorState("erasing");

          const targetY = height / 2;
          await flyCursorTo(50, targetY, Math.min(duration * 0.3, 800));

          const sweepDuration = Math.max(duration * 0.7, 100);
          await animateOver(sweepDuration, (progress) => {
            const sweepX = 50 + (width - 50) * progress;
            setCursorViewSafely(sweepX, targetY, 0, 1);

            const erasedRect = { x: 0, y: 0, width: 50 + (width - 50) * progress, height };
            destroyNodesInRect(completedNodesRef.current, erasedRect);
            destroyNodesInRect(animNodesRef.current, erasedRect);

            drawLayer.batchDraw();
            animLayer.batchDraw();
            cursorLayer.batchDraw();
          });

          updateCursorState(previousCursorState);
        } else {
          clearTrackedNodes(animNodesRef.current);
          clearTrackedNodes(completedNodesRef.current);
          animLayer.batchDraw();
          drawLayer.batchDraw();
          cursorLayer.batchDraw();
        }
      },
      [animateOver, clearTrackedNodes, destroyNodesInRect, flyCursorTo, setCursorViewSafely, updateCursorState, height, width],
    );

    useEffect(() => {
      activeCursorStateRef.current = cursorState;
      setActiveCursorState(cursorState);
    }, [cursorState]);

    useEffect(
      () => {
        mountedRef.current = true;

        return () => {
          mountedRef.current = false;
          Array.from(animationCleanupsRef.current).forEach((cleanup) => cleanup());
          Array.from(frameIdsRef.current).forEach((frameId) => cancelAnimationFrame(frameId));
          frameIdsRef.current.clear();
          clearTrackedNodes(animNodesRef.current);
          clearTrackedNodes(completedNodesRef.current);
        };
      },
      [clearTrackedNodes],
    );

    useImperativeHandle(
      ref,
      () => ({
        drawShape,
        drawAnnotation,
        writeText,
        clearBoard,
        eraseRegion,
        punchDiagramLineGapsInRect,
        setCursorPos: (x: number, y: number) => setCursorViewSafely(x, y),
        setCursorState: updateCursorState,
        flyCursorTo,
        setPaused: (paused: boolean) => {
          isPausedRef.current = paused;
        },
        cancelAnimations,
        setAnimationSpeed: (multiplier: number) => {
          animationSpeedRef.current = Math.max(0.25, Math.min(multiplier, 4));
        },
        getDrawLayer: () => drawLayerRef.current,
        getAnimLayer: () => animLayerRef.current,
        getCursorLayer: () => cursorLayerRef.current,
      }),
      [cancelAnimations, clearBoard, drawAnnotation, drawShape, eraseRegion, flyCursorTo, punchDiagramLineGapsInRect, setCursorViewSafely, updateCursorState, writeText],
    );

    return (
      <Stage
        width={width}
        height={height}
        style={{ backgroundColor: WHITEBOARD_COLOR }}
      >
        <Layer ref={highlightLayerRef} listening={false} />
        <Layer ref={drawLayerRef} listening={false} />
        <Layer ref={animLayerRef} listening={false}>
          <KonvaPath data={HIDDEN_PATH_DATA} visible={false} listening={false} />
        </Layer>
        <Layer ref={cursorLayerRef} listening={false}>
          {activeCursorState === "erasing" ? (
            <Rect
              x={cursorView.x - DUSTER_WIDTH / 2}
              y={cursorView.y - DUSTER_HEIGHT / 2}
              width={DUSTER_WIDTH}
              height={DUSTER_HEIGHT}
              fill={DUSTER_COLOR}
              stroke={DUSTER_STROKE}
              strokeWidth={1}
              cornerRadius={DUSTER_CORNER_RADIUS}
              rotation={cursorView.rotation}
              scaleX={cursorView.scale}
              scaleY={cursorView.scale}
              opacity={cursorOpacity(activeCursorState)}
              shadowColor="#999999"
              shadowBlur={10}
              shadowOpacity={0.4}
              listening={false}
            />
          ) : (
            <VirtualCursor
              x={cursorView.x}
              y={cursorView.y}
              rotation={cursorView.rotation}
              scale={cursorView.scale}
              color={CURSOR_BLUE}
              visible={cursorOpacity(activeCursorState) > 0}
              opacity={cursorOpacity(activeCursorState)}
              glowRadius={activeCursorState === "drawing" ? 14 : 10}
            />
          )}
        </Layer>
      </Stage>
    );
  },
);
