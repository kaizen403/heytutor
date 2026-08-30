"use client";

import Konva from "konva";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  resolveScheduledWriteClockMs,
  shouldReleaseAudioPositionWait,
  textToStrokePaths,
  cancelFrame,
  scheduleFrame,
} from "@heytutor/drawing";
import { Layer, Path as KonvaPath, Rect, Stage } from "react-konva";
import { VirtualCursor } from "./VirtualCursor";
import { cursorOpacity, type CursorState } from "./cursorState";
import { DrawTransactionRegistry } from "./drawTransactionRegistry";
import {
  audioWaitAlreadyDue,
  handwritingProgress,
  pointAlongSamples,
  samplePolyline,
  splitDrawnLength,
  writeUsesStrokePenMotion,
} from "./penMotion";
import {
  AIR_LIFT_PX,
  FLIGHT_LIFT_PX,
  HOP_LIFT_PX,
  NibTracker,
  SWAP_DURATION_MS,
  SWAP_HURRY_MS,
  flourishPose,
  hopDurationMs,
  instrumentSwapPose,
  lerpAngle,
  planGlyphSegments,
  restingTilt,
  SPIN_GHOST_COUNT,
  scratchStrokePath,
  spinGhosts,
  spinningPose,
  thinkingPose,
  tremor,
  waitingPose,
} from "./penChoreography";
import {
  instrumentForActivity,
  type InstrumentKind,
  type PenActivity,
} from "./instruments";

export interface WhiteboardProps {
  width?: number;
  height?: number;
  cursorState?: CursorState;
  inkColor?: string;
  /**
   * What the hand does while the tutor is thinking. `spin` lifts the pencil
   * off the board where it last wrote and twirls it — the same gesture every
   * pending state in the app shows. `doodle` scribbles in the bottom-left
   * margin the way you would on rough paper; that scratch ink lives on the
   * cursor layer, so it is never board content and never lands in a snapshot.
   */
  thinkingMotion?: "spin" | "doodle" | "none";
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
  /** A hand-drawn box round a work-area formula: "hold on to this". */
  | "box"
  | "highlight"
  | "scribble";

export interface AnnotationOptions {
  strokeWidth?: number;
  fillColor?: string;
  fillOpacity?: number;
  /** Remove the gesture after a short fade so review traces do not overwrite ink. */
  transient?: boolean;
  /** Allows the owning turn or transaction to abort stale annotation work. */
  shouldCancel?: () => boolean;
}

export interface ShapeDrawOptions {
  dashed?: boolean;
  strokeWidth?: number;
  /** When provided, the shape draw duration is damped against the audio clock
   * — the same reactive scheme used for handwritten text. If the voice is ahead
   * of the ink, the pen speeds up; if behind, it slows down. */
  getAudioPositionMs?: () => number;
  /** The audio position (ms) this shape should align with. Lag = audioPos - this. */
  targetMs?: number;
  /**
   * Engine pedagogical pace. `scene` caps wall-clock stroke time so a long
   * path (train, circuit, busy body) reveals as a figure, not a pen performance.
   * `follow` keeps the caller duration (formulas / key construction).
   */
  pace?: "follow" | "scene";
  /** Allows the owner to abort stale work between animation frames. */
  shouldCancel?: () => boolean;
}

export interface WhiteboardHandle {
  drawShape: (pathData: string, duration: number, options?: ShapeDrawOptions) => Promise<void>;
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
    fontSize?: number,
    shouldCancel?: () => boolean,
  ) => Promise<void>;
  clearBoard: (duration?: number) => Promise<void>;
  eraseRegion: (
    x: number,
    y: number,
    width: number,
    height: number,
    duration: number,
    shouldCancel?: () => boolean,
  ) => Promise<void>;
  /** Split diagram vector lines that pass through a label emphasis region. */
  punchDiagramLineGapsInRect: (
    rect: { x: number; y: number; width: number; height: number },
    margin?: number,
  ) => void;
  setCursorPos: (x: number, y: number) => void;
  setCursorState: (state: CursorState) => void;
  /** Twirl the current instrument away and pick this one up. */
  setInstrument: (instrument: InstrumentKind, hurry?: boolean) => Promise<void>;
  /** Spin the instrument in place — a beat of punctuation between steps. */
  flourishPen: (turns?: number) => Promise<void>;
  flyCursorTo: (x: number, y: number, duration: number, targetRotation?: number) => Promise<void>;
  setPaused: (paused: boolean) => void;
  cancelAnimations: () => void;
  beginDrawTransaction: () => string;
  commitDrawTransaction: (transactionId: string) => void;
  abortDrawTransaction: (transactionId: string) => void;
  finishAbortedDrawTransaction: (transactionId: string) => void;
  setAnimationSpeed: (multiplier: number) => void;
  getDrawLayer: () => Konva.Layer | null;
  getAnimLayer: () => Konva.Layer | null;
  getCursorLayer: () => Konva.Layer | null;
  /**
   * Capture the current board (draw + highlight + anim layers, cursor excluded)
   * as a PNG data URL. Hides the cursor layer during capture and restores it
   * afterwards. Returns null if the stage is not mounted.
   */
  captureSnapshot: (pixelRatio?: number) => string | null;
  setSpotlight: (
    spotlight: {
      veil: { x: number; y: number; width: number; height: number };
      hole: { x: number; y: number; width: number; height: number };
      opacity?: number;
    } | null,
  ) => void;
}

interface CursorView {
  x: number;
  y: number;
  /** Barrel tilt about the nib. */
  rotation: number;
  scale: number;
  /** Twirl about the barrel mid-point, used by swaps and flourishes. */
  spin: number;
  /** How far the instrument is pulled back off the board, in px. */
  lift: number;
  /** Extra fade multiplied into the state opacity during a swap. */
  fade: number;
  /** Twirl rate as a fraction of the mean; drives the motion-blur trail. */
  spinVelocity: number;
}

interface PoseNodes {
  group: Konva.Group | null;
  lift: Konva.Group | null;
  spin: Konva.Group | null;
  /** Trailing silhouettes, nearest the barrel first. */
  ghosts: Konva.Group[];
}

interface Point {
  x: number;
  y: number;
}

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 700;
const WHITEBOARD_COLOR = "#F8F6F0";
const DEFAULT_INK_COLOR = "#222222";
/** Highlighter yellow, laid under the ink so the writing stays crisp. */
const HIGHLIGHT_FILL = "#FFD84D";
const HIGHLIGHT_OPACITY = 0.34;
const ANNOTATION_STROKE_WIDTH = 3.25;
/** A box is a quiet gesture — it frames the formula, it does not shout. */
const BOX_STROKE_WIDTH = 2;
const SHAPE_STROKE_WIDTH = 2.5;
/** Scene setup ink: visible, not a 10s sketch. Matches tutor-core SCENE_MAX_MS. */
const SCENE_SHAPE_MAX_MS = 320;
const SCENE_SHAPE_MIN_MS = 70;
const DIAGRAM_LINE_PATH_RE =
  /^M\s*([-\d.]+)\s+([-\d.]+)\s+L\s*([-\d.]+)\s+([-\d.]+)\s*$/;
const DUSTER_WIDTH = 28;
const DUSTER_HEIGHT = 14;
const DUSTER_COLOR = "#D4CDBE";
const DUSTER_STROKE = "#B8B0A0";
const DUSTER_CORNER_RADIUS = 3;
/** Fallback tilt for callers that do not name an activity. */
const HANDWRITING_ROTATION = restingTilt("write");
/** Margin the hand scribbles in while thinking, as a fraction of the board. */
const SCRATCH_BOX_RATIO = { x: 0.052, y: 0.924, width: 0.163, height: 0.058 } as const;
const SCRATCH_TRAVEL_MS = 420;
const SCRATCH_HOP_MS = 190;
const SCRATCH_STROKE_MS = 880;
const SCRATCH_FIDGET_MS = 620;
const SCRATCH_FLOURISH_MS = 620;
const SCRATCH_HOLD_MS = 900;
const SCRATCH_FADE_MS = 700;
const SCRATCH_MAX_LIVE = 4;
const SCRATCH_OPACITY = 0.32;
const SCRATCH_STROKE_WIDTH = 1.5;
const THINKING_FLOURISH_EVERY = 4;
const HIDDEN_PATH_DATA = "M 0 0";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function smoothstep(progress: number): number {
  return progress * progress * (3 - 2 * progress);
}

function inkPathConfig(pathData: string, strokeWidth: number, color: string): Konva.PathConfig {
  return {
    data: pathData,
    stroke: color,
    strokeWidth,
    fillEnabled: false,
    lineCap: "round",
    lineJoin: "round",
    listening: false,
    perfectDrawEnabled: false,
    shadowForStrokeEnabled: false,
    hitStrokeWidth: 0,
  };
}

function sampleKonvaPath(path: Konva.Path, totalLength: number): { x: number; y: number }[] {
  return samplePolyline(totalLength, (distance) => {
    const point = path.getPointAtLength(distance);
    return { x: point?.x ?? 0, y: point?.y ?? 0 };
  });
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

export const Whiteboard = forwardRef<WhiteboardHandle, WhiteboardProps>(
  function Whiteboard(
    {
      width = DEFAULT_WIDTH,
      height = DEFAULT_HEIGHT,
      cursorState = "idle",
      inkColor = DEFAULT_INK_COLOR,
      thinkingMotion = "spin",
    },
    ref,
  ) {
    const drawLayerRef = useRef<Konva.Layer>(null);
    const highlightLayerRef = useRef<Konva.Layer>(null);
    const spotlightNodesRef = useRef<Konva.Rect[]>([]);
    const spotlightLayerRef = useRef<Konva.Layer>(null);
    const animLayerRef = useRef<Konva.Layer>(null);
    const cursorLayerRef = useRef<Konva.Layer>(null);
    const frameIdsRef = useRef<Set<number>>(new Set());
    const animationCleanupsRef = useRef<Set<() => void>>(new Set());
    const completedNodesRef = useRef<Set<Konva.Node>>(new Set());
    const animNodesRef = useRef<Set<Konva.Node>>(new Set());
    const drawTransactionsRef = useRef(new DrawTransactionRegistry<Konva.Node>());
    const strokeLengthCacheRef = useRef<Map<string, number>>(new Map());
    const mountedRef = useRef(true);
    const isPausedRef = useRef(false);
    const animationSpeedRef = useRef(1);
    // Damping state for the reactive shape-speed scheme — mirrors the
    // `previousScheduledBudgetMs` local in writeText, but persists across
    // separate drawShape calls within a turn.
    const previousShapeBudgetMsRef = useRef<number | null>(null);
    const cursorViewRef = useRef<CursorView>({
      x: width / 2,
      y: height / 2,
      rotation: HANDWRITING_ROTATION,
      scale: 1,
      spin: 0,
      lift: 0,
      fade: 1,
      spinVelocity: 0,
    });
    const [nib] = useState(() => new NibTracker(width / 2, height / 2, HANDWRITING_ROTATION));
    const cursorGroupRef = useRef<Konva.Group>(null);
    const poseNodesRef = useRef<PoseNodes>({ group: null, lift: null, spin: null, ghosts: [] });
    const dusterRef = useRef<Konva.Rect>(null);
    const instrumentRef = useRef<InstrumentKind>("pen");
    const [activeInstrument, setActiveInstrument] = useState<InstrumentKind>("pen");
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
      const frameId = scheduleFrame((time) => {
        frameIdsRef.current.delete(frameId);
        callback(time);
      });

      frameIdsRef.current.add(frameId);
      return frameId;
    }, []);

    const cancelTrackedFrame = useCallback((frameId: number): void => {
      cancelFrame(frameId);
      frameIdsRef.current.delete(frameId);
    }, []);

    /**
     * The lift and spin groups live inside the instrument art, so they are
     * looked up by name once per mounted cursor instead of being re-rendered
     * through React on every animation frame.
     */
    const resolvePoseNodes = useCallback((group: Konva.Group): PoseNodes => {
      const cached = poseNodesRef.current;
      if (cached.group === group && cached.lift && cached.spin) {
        return cached;
      }
      const ghosts: Konva.Group[] = [];
      for (let index = 0; index < SPIN_GHOST_COUNT; index++) {
        const ghost = group.findOne<Konva.Group>(`.pen-ghost-${index}`);
        if (ghost) ghosts.push(ghost);
      }
      const resolved: PoseNodes = {
        group,
        lift: group.findOne<Konva.Group>(".pen-lift") ?? null,
        spin: group.findOne<Konva.Group>(".pen-spin") ?? null,
        ghosts,
      };
      poseNodesRef.current = resolved;
      return resolved;
    }, []);

    const setCursorViewSafely = useCallback(
      (
        x: number,
        y: number,
        rotation = cursorViewRef.current.rotation,
        scale = cursorViewRef.current.scale,
        pose?: { spin?: number; lift?: number; fade?: number; spinVelocity?: number },
      ): void => {
        const spin = pose?.spin ?? 0;
        const lift = pose?.lift ?? 0;
        const fade = pose?.fade ?? 1;
        const spinVelocity = pose?.spinVelocity ?? 0;
        cursorViewRef.current = { x, y, rotation, scale, spin, lift, fade, spinVelocity };
        const group = cursorGroupRef.current;
        if (group) {
          group.x(x);
          group.y(y);
          group.rotation(rotation);
          group.scaleX(scale);
          group.scaleY(scale);
          group.opacity(cursorOpacity(activeCursorStateRef.current) * fade);
          const nodes = resolvePoseNodes(group);
          nodes.lift?.y(-lift);
          nodes.spin?.rotation(spin);
          // Motion blur: a trail only exists while the barrel is turning, and
          // it widens and fades with the rate, so a flick smears and a coast
          // tightens back to a clean silhouette.
          if (nodes.ghosts.length > 0) {
            const ghosts = spinVelocity > 0 ? spinGhosts(spinVelocity) : [];
            for (let index = 0; index < nodes.ghosts.length; index++) {
              const node = nodes.ghosts[index]!;
              const ghost = ghosts[index];
              if (!ghost) {
                node.opacity(0);
                continue;
              }
              node.rotation(spin - ghost.offset);
              node.opacity(ghost.opacity);
            }
          }
        }
        const duster = dusterRef.current;
        if (duster) {
          duster.x(x - DUSTER_WIDTH / 2);
          duster.y(y - DUSTER_HEIGHT / 2);
          duster.rotation(rotation);
          duster.scaleX(scale);
          duster.scaleY(scale);
        }
        cursorLayerRef.current?.batchDraw();
      },
      [resolvePoseNodes],
    );

    /**
     * The hand does not hold the barrel at a fixed angle: it rolls a few
     * degrees into the stroke, lags behind the turn with a capped rate, and
     * drifts. `NibTracker` owns that; these helpers just paint its answer.
     */

    /** Trace: the nib is on the ink, so its travel steers the barrel. */
    const moveNib = useCallback(
      (x: number, y: number, activity: PenActivity = "write"): void => {
        const now = performance.now();
        setCursorViewSafely(x, y, nib.move(x, y, activity, now) + tremor(now), 1);
      },
      [nib, setCursorViewSafely],
    );

    /** Reposition: place the nib without letting the jump rewrite the heading. */
    const jumpNib = useCallback(
      (x: number, y: number, activity: PenActivity = "write"): void => {
        const now = performance.now();
        setCursorViewSafely(x, y, nib.jump(x, y, activity, now) + tremor(now), 1);
      },
      [nib, setCursorViewSafely],
    );

    /** In the air: the nib is off the board, travelling between strokes. */
    const hoverNib = useCallback(
      (x: number, y: number, activity: PenActivity, lift: number): void => {
        const now = performance.now();
        setCursorViewSafely(x, y, nib.jump(x, y, activity, now) + tremor(now), 1, { lift });
      },
      [nib, setCursorViewSafely],
    );

    /** Land the pen at an exact pose — used at the end of a flight or sweep. */
    const settleNib = useCallback(
      (x: number, y: number, rotation: number): void => {
        nib.settle(x, y, rotation, performance.now());
        setCursorViewSafely(x, y, rotation, 1);
      },
      [nib, setCursorViewSafely],
    );

    const animateOver = useCallback(
      (
        duration: number,
        onFrame: (progress: number) => void,
        shouldCancel?: () => boolean,
        playback?: { lockToWallClock?: boolean },
      ): Promise<void> =>
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
            if (shouldCancel?.()) {
              cleanup();
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

            const speed = playback?.lockToWallClock ? 1 : animationSpeedRef.current;
            const progress =
              duration <= 0
                ? 1
                : clamp(
                    ((now - startTime - pausedAccumMs) / duration) * speed,
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

    const applyInstrument = useCallback((kind: InstrumentKind): void => {
      instrumentRef.current = kind;
      if (mountedRef.current) {
        setActiveInstrument(kind);
      }
    }, []);

    /**
     * Put one instrument down and pick the next one up: the barrel rises off
     * the board, flips once between the fingers, blanks at the top of the arc,
     * and the new instrument lands in its place. `hurry` keeps the same gesture
     * for callers on a tight audio budget (compiler labels, catch-up writing).
     */
    const swapInstrument = useCallback(
      async (kind: InstrumentKind, hurry = false): Promise<void> => {
        if (instrumentRef.current === kind) {
          return;
        }
        if (!mountedRef.current || !cursorGroupRef.current) {
          applyInstrument(kind);
          return;
        }

        const { x, y, rotation } = cursorViewRef.current;
        let handedOver = false;

        await animateOver(hurry ? SWAP_HURRY_MS : SWAP_DURATION_MS, (progress) => {
          const pose = instrumentSwapPose(progress);
          if (!handedOver && pose.showIncoming) {
            handedOver = true;
            applyInstrument(kind);
          }
          setCursorViewSafely(x, y, rotation, pose.scale, {
            spin: pose.spin,
            lift: pose.lift,
            fade: pose.opacity,
          });
        });

        if (!handedOver) {
          applyInstrument(kind);
        }
        setCursorViewSafely(x, y, rotation, 1);
      },
      [animateOver, applyInstrument, setCursorViewSafely],
    );

    /** Reach for whatever this kind of work is done with. */
    const equipInstrumentFor = useCallback(
      (activity: PenActivity, hurry = false): Promise<void> =>
        swapInstrument(instrumentForActivity(activity), hurry),
      [swapInstrument],
    );

    /** Spin in place without changing instrument. */
    const flourishPen = useCallback(
      async (turns = 1): Promise<void> => {
        const { x, y, rotation } = cursorViewRef.current;
        await animateOver(SCRATCH_FLOURISH_MS, (progress) => {
          const pose = flourishPose(progress, turns);
          setCursorViewSafely(x, y, rotation, pose.scale, {
            spin: pose.spin,
            lift: pose.lift,
          });
        });
        setCursorViewSafely(x, y, rotation, 1);
      },
      [animateOver, setCursorViewSafely],
    );

    const cancelAnimations = useCallback((): void => {
      Array.from(animationCleanupsRef.current).forEach((cleanup) => cleanup());
      Array.from(frameIdsRef.current).forEach((frameId) => cancelFrame(frameId));
      frameIdsRef.current.clear();
    }, []);

    const clearTrackedNodes = useCallback((nodes: Set<Konva.Node>): void => {
      nodes.forEach((node) => {
        node.destroy();
      });
      nodes.clear();
    }, []);

    const trackNode = useCallback((node: Konva.Node, nodes: Set<Konva.Node>): boolean => {
      if (!drawTransactionsRef.current.track(node)) return false;
      nodes.add(node);
      return true;
    }, []);

    const untrackNode = useCallback((node: Konva.Node, nodes: Set<Konva.Node>): void => {
      nodes.delete(node);
    }, []);

    const beginDrawTransaction = useCallback((): string => {
      return drawTransactionsRef.current.begin();
    }, []);

    const commitDrawTransaction = useCallback((transactionId: string): void => {
      drawTransactionsRef.current.commit(transactionId);
    }, []);

    const abortDrawTransaction = useCallback((transactionId: string): void => {
      const nodes = drawTransactionsRef.current.abort(transactionId);
      nodes.forEach((node) => {
        animNodesRef.current.delete(node);
        completedNodesRef.current.delete(node);
      });
      animLayerRef.current?.batchDraw();
      drawLayerRef.current?.batchDraw();
      highlightLayerRef.current?.batchDraw();
    }, []);

    const finishAbortedDrawTransaction = useCallback((transactionId: string): void => {
      drawTransactionsRef.current.finishAborted(transactionId);
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
      async (pathData: string, duration: number, options?: ShapeDrawOptions): Promise<void> => {
        const drawLayer = drawLayerRef.current;
        const animLayer = animLayerRef.current;

        if (!drawLayer || !animLayer || options?.shouldCancel?.()) {
          return;
        }

        // Diagram geometry is sketched, not inked — reach for the pencil. The
        // twirl only plays on an actual change, so a scene of forty strokes
        // pays for it once, at the moment the lesson turns from words to figure.
        await equipInstrumentFor("draw");
        if (options?.shouldCancel?.()) {
          return;
        }

        // Reactive shape speed: when an audio clock is available, dampen the
        // draw duration against the lag — the same scheme writeText uses per
        // character, applied here to the whole stroke. Positive lag (voice
        // ahead) shortens the budget; negative lag (ink ahead) lengthens it.
        let effectiveDuration = duration;
        if (options?.getAudioPositionMs && typeof options.targetMs === "number") {
          const lagMs = options.getAudioPositionMs() - options.targetMs;
          const targetBudgetMs =
            lagMs > 220
              ? clamp(duration * 0.55, 120, duration * 0.8)
              : lagMs > 100
                ? clamp(duration * 0.72, 140, duration * 0.9)
                : lagMs < -220
                  ? clamp(duration * 1.3, duration, duration * 1.6)
                  : clamp(duration * 1.05, duration * 0.9, duration * 1.2);

          const prev = previousShapeBudgetMsRef.current;
          if (prev !== null) {
            effectiveDuration = clamp(
              prev * 0.65 + targetBudgetMs * 0.35,
              prev * 0.72,
              prev * 1.28,
            );
          } else {
            effectiveDuration = targetBudgetMs;
          }
          previousShapeBudgetMsRef.current = effectiveDuration;
        }

        if (options?.pace === "scene") {
          effectiveDuration = clamp(effectiveDuration, SCENE_SHAPE_MIN_MS, SCENE_SHAPE_MAX_MS);
        }

        const path = new Konva.Path(
          inkPathConfig(pathData, options?.strokeWidth ?? SHAPE_STROKE_WIDTH, inkColorRef.current),
        );
        const totalLength = path.getLength();

        // Dashed lines are construction lines — appear instantly with a
        // brief opacity fade instead of the stroke-by-stroke reveal.
        if (options?.dashed) {
          path.dash([6, 5]);
          path.opacity(0);
          animLayer.add(path);
          trackNode(path, animNodesRef.current);
          animLayer.batchDraw();

          await animateOver(Math.min(options?.pace === "scene" ? SCENE_SHAPE_MAX_MS : duration, 300), (progress) => {
            path.opacity(progress);
            const point = path.getPointAtLength(progress * totalLength);
            if (point) {
              moveNib(point.x, point.y, "draw");
            }
            animLayer.batchDraw();
          });

          if (options?.shouldCancel?.()) {
            path.destroy();
            untrackNode(path, animNodesRef.current);
            animLayer.batchDraw();
            return;
          }

          path.opacity(1);
          path.moveTo(drawLayer);
          untrackNode(path, animNodesRef.current);
          trackNode(path, completedNodesRef.current);
          animLayer.batchDraw();
          drawLayer.batchDraw();
          return;
        }

        path.dash([totalLength]);
        path.dashOffset(totalLength);
        animLayer.add(path);
        trackNode(path, animNodesRef.current);
        animLayer.batchDraw();

        const pathSamples = sampleKonvaPath(path, totalLength);
        await animateOver(effectiveDuration, (progress) => {
          const eased = handwritingProgress(progress, effectiveDuration);
          const drawnLength = eased * totalLength;
          const point = pointAlongSamples(pathSamples, totalLength, drawnLength);

          path.dashOffset(totalLength - drawnLength);
          moveNib(point.x, point.y, "draw");
          animLayer.batchDraw();
        });

        if (options?.shouldCancel?.()) {
          path.destroy();
          untrackNode(path, animNodesRef.current);
          animLayer.batchDraw();
          return;
        }

        path.dash([]);
        path.dashOffset(0);
        path.moveTo(drawLayer);
        untrackNode(path, animNodesRef.current);
        trackNode(path, completedNodesRef.current);
        animLayer.batchDraw();
        drawLayer.batchDraw();
      },
      [animateOver, equipInstrumentFor, moveNib, trackNode, untrackNode],
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
          trackNode(path, completedNodesRef.current);
        });

        if (toDestroy.length > 0 || replacements.length > 0) {
          drawLayer.batchDraw();
        }
      },
      [trackNode],
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

        if (!drawLayer || !animLayer || options.shouldCancel?.()) {
          return;
        }

        // A highlighter is a different object and worth the swap. Underlines,
        // arrows and circles are gestures made with whatever is already in
        // hand, so they never interrupt a reveal to fetch another pen.
        if (kind === "highlight") {
          await equipInstrumentFor("highlight");
          if (options.shouldCancel?.()) {
            return;
          }
        }

        if (kind === "highlight") {
          const targetLayer = highlightLayer ?? drawLayer;
          const mark = new Konva.Path({
            data: pathData,
            fill: options.fillColor ?? HIGHLIGHT_FILL,
            opacity: options.fillOpacity ?? HIGHLIGHT_OPACITY,
            strokeEnabled: false,
            listening: false,
            perfectDrawEnabled: false,
            hitStrokeWidth: 0,
          });

          // A highlighter lays colour down *behind a moving nib*. Fading the
          // whole patch up at once is the one thing a real marker never does,
          // so the mark is wiped in left to right and the marker rides the edge.
          const box = mark.getClientRect();
          // A degenerate path would leave the clip at zero width forever, i.e.
          // a highlight that silently never appears. Commit it outright.
          if (!(box.width > 0) || !(box.height > 0)) {
            targetLayer.add(mark);
            trackNode(mark, completedNodesRef.current);
            targetLayer.batchDraw();
            return;
          }
          const bleed = 1.5;
          const clipY = box.y - bleed;
          const clipHeight = box.height + bleed * 2;
          const sweep = new Konva.Group({
            listening: false,
            clip: { x: box.x - bleed, y: clipY, width: 0, height: clipHeight },
          });
          sweep.add(mark);
          targetLayer.add(sweep);
          trackNode(sweep, completedNodesRef.current);
          targetLayer.batchDraw();

          const sweepWidth = box.width + bleed * 2;
          const nibY = box.y + box.height / 2;
          await animateOver(
            duration,
            (progress) => {
              const eased = smoothstep(progress);
              sweep.clip({
                x: box.x - bleed,
                y: clipY,
                width: sweepWidth * eased,
                height: clipHeight,
              });
              moveNib(box.x + box.width * eased, nibY, "highlight");
              targetLayer.batchDraw();
            },
            options.shouldCancel,
          );

          if (options.shouldCancel?.()) {
            sweep.destroy();
            untrackNode(sweep, completedNodesRef.current);
            targetLayer.batchDraw();
            return;
          }

          sweep.clip({ x: box.x - bleed, y: clipY, width: sweepWidth, height: clipHeight });
          targetLayer.batchDraw();
          return;
        }

        const strokeWidth =
          options.strokeWidth ?? (kind === "box" ? BOX_STROKE_WIDTH : ANNOTATION_STROKE_WIDTH);
        const path = new Konva.Path(
          inkPathConfig(pathData, strokeWidth, inkColorRef.current),
        );
        const totalLength = Math.max(path.getLength(), 1);

        path.dash([totalLength]);
        path.dashOffset(totalLength);
        animLayer.add(path);
        trackNode(path, animNodesRef.current);
        animLayer.batchDraw();

        const annotationSamples = sampleKonvaPath(path, totalLength);
        await animateOver(duration, (progress) => {
          const eased = handwritingProgress(progress, duration);
          const drawnLength = eased * totalLength;
          const point = pointAlongSamples(annotationSamples, totalLength, drawnLength);

          path.dashOffset(totalLength - drawnLength);
          moveNib(point.x, point.y, "annotate");
          animLayer.batchDraw();
        });

        if (options.shouldCancel?.()) {
          path.destroy();
          untrackNode(path, animNodesRef.current);
          animLayer.batchDraw();
          return;
        }

        if (options.transient) {
          await animateOver(180, (progress) => {
            path.opacity(1 - progress);
            animLayer.batchDraw();
          });
          path.destroy();
          untrackNode(path, animNodesRef.current);
          animLayer.batchDraw();
          return;
        }

        path.dash([]);
        path.dashOffset(0);
        path.moveTo(drawLayer);
        untrackNode(path, animNodesRef.current);
        trackNode(path, completedNodesRef.current);
        animLayer.batchDraw();
        drawLayer.batchDraw();
      },
      [animateOver, equipInstrumentFor, moveNib, trackNode, untrackNode],
    );

    const flyCursorTo = useCallback(
      async (
        x: number,
        y: number,
        duration: number,
        targetRotation?: number,
      ): Promise<void> => {
        const start = { x: cursorViewRef.current.x, y: cursorViewRef.current.y };
        const startRotation = cursorViewRef.current.rotation;
        const end = { x, y };
        const distance = distanceBetween(start, end);
        const fixedRotation = targetRotation ?? HANDWRITING_ROTATION;

        if (distance < 15) {
          settleNib(x, y, fixedRotation);
          return;
        }

        const flightDuration = resolveFlightDuration(distance, duration);

        // Crossing the board is a real movement: the nib leaves the surface,
        // the barrel rolls toward its landing tilt, and it touches down again.
        await animateOver(flightDuration, (linearProgress) => {
          const easedProgress = smoothstep(linearProgress);
          const arc = Math.sin(Math.PI * linearProgress);
          const point = {
            x: start.x + (end.x - start.x) * easedProgress,
            y: start.y + (end.y - start.y) * easedProgress,
          };

          setCursorViewSafely(
            point.x,
            point.y,
            lerpAngle(startRotation, fixedRotation, easedProgress) - arc * 4,
            1,
            { lift: FLIGHT_LIFT_PX * arc },
          );
        });

        settleNib(x, y, fixedRotation);
      },
      [animateOver, setCursorViewSafely, settleNib],
    );

    /**
     * The short lift between one glyph and the next. Unlike a flight it keeps
     * the barrel's heading and tilt, so the pen arrives already writing.
     */
    const hopNib = useCallback(
      async (
        x: number,
        y: number,
        durationMs: number,
        activity: PenActivity,
        playback?: { lockToWallClock?: boolean },
      ): Promise<void> => {
        const start = { x: cursorViewRef.current.x, y: cursorViewRef.current.y };
        await animateOver(durationMs, (progress) => {
          const eased = smoothstep(progress);
          const arc = Math.sin(Math.PI * progress);
          hoverNib(
            start.x + (x - start.x) * eased,
            start.y + (y - start.y) * eased,
            activity,
            HOP_LIFT_PX * arc,
          );
        }, undefined, playback);
        jumpNib(x, y, activity);
      },
      [animateOver, hoverNib, jumpNib],
    );

    const waitForAudioPosition = useCallback(
      (
        targetMs: number,
        getAudioPositionMs: () => number,
        originWallMs: number,
      ): Promise<void> =>
        new Promise((resolve) => {
          let done = false;
          let frameId: number | null = null;
          let lastRawPositionMs = -1;
          let stalledFrames = 0;
          let pausedAt: number | null = null;
          let pausedTotalMs = 0;
          let maxPositionMs = 0;
          // The pen is parked here doing nothing while the voice catches up.
          // Rather than freeze mid-sentence it breathes, and rolls between the
          // fingers on a long hold — motion that costs the schedule nothing.
          const anchor = { ...cursorViewRef.current };
          const waitStartMs = performance.now();
          let idled = false;

          const currentClockMs = (): number => {
            const rawPositionMs = getAudioPositionMs();
            if (rawPositionMs > 0 && rawPositionMs === lastRawPositionMs) {
              stalledFrames += 1;
            } else {
              stalledFrames = 0;
              lastRawPositionMs = rawPositionMs;
            }
            const elapsedMs = performance.now() - originWallMs - pausedTotalMs;
            const positionMs = Math.max(
              maxPositionMs,
              resolveScheduledWriteClockMs({
                rawPositionMs,
                elapsedWallMs: elapsedMs,
                stalledFrames,
              }),
            );
            maxPositionMs = positionMs;
            return positionMs;
          };

          const cleanup = (): void => {
            if (done) return;
            done = true;
            if (frameId !== null) {
              cancelTrackedFrame(frameId);
              frameId = null;
            }
            // Hand the exact parked pose back, so the character that was
            // waiting starts from where it would have without the idle.
            if (idled) {
              settleNib(anchor.x, anchor.y, anchor.rotation);
              idled = false;
            }
            animationCleanupsRef.current.delete(cleanup);
            resolve();
          };

          const step = (): void => {
            if (done) return;
            if (!mountedRef.current) {
              cleanup();
              return;
            }

            if (isPausedRef.current) {
              if (pausedAt === null) {
                pausedAt = performance.now();
              }
              stalledFrames = 0;
              frameId = requestTrackedFrame(step);
              return;
            }
            if (pausedAt !== null) {
              pausedTotalMs += performance.now() - pausedAt;
              pausedAt = null;
            }

            const positionMs = currentClockMs();
            const elapsedMs = performance.now() - originWallMs - pausedTotalMs;
            if (
              audioWaitAlreadyDue(positionMs, targetMs) ||
              shouldReleaseAudioPositionWait({
                positionMs,
                targetMs,
                elapsedMs,
                clockEverStarted: positionMs > 0 || elapsedMs > 0,
                stalledFrames,
              })
            ) {
              cleanup();
              return;
            }

            const pose = waitingPose(performance.now() - waitStartMs - pausedTotalMs);
            if (pose.active) {
              idled = true;
              setCursorViewSafely(
                anchor.x + pose.dx,
                anchor.y + pose.dy,
                anchor.rotation + pose.tiltOffset,
                pose.scale,
                { spin: pose.spin, lift: pose.lift },
              );
            }
            frameId = requestTrackedFrame(step);
          };

          animationCleanupsRef.current.add(cleanup);
          const immediate = resolveScheduledWriteClockMs({
            rawPositionMs: getAudioPositionMs(),
            elapsedWallMs: performance.now() - originWallMs,
            stalledFrames: 0,
          });
          if (audioWaitAlreadyDue(immediate, targetMs)) {
            cleanup();
            return;
          }
          frameId = requestTrackedFrame(step);
        }),
      [cancelTrackedFrame, requestTrackedFrame, setCursorViewSafely, settleNib],
    );

    const writeText = useCallback(
      async (
        text: string,
        x: number,
        y: number,
        duration: number,
        schedule?: WriteSchedule,
        fontSize = 32,
        shouldCancel?: () => boolean,
      ): Promise<void> => {
        const drawLayer = drawLayerRef.current;
        const animLayer = animLayerRef.current;

        if (!drawLayer || !animLayer || shouldCancel?.()) {
          return;
        }

        // Teaching prose is written with the pen. Compiler-owned diagram labels
        // are part of the sketch and are lettered with whatever is already in
        // hand — otherwise every reveal group would pay for a swap each way.
        const labelSized = !schedule && duration <= text.replace(/\s+/g, "").length * 24;
        if (!labelSized) {
          await equipInstrumentFor("write");
          if (shouldCancel?.()) {
            return;
          }
        }

        const resolvedFontSize = Math.min(Math.max(fontSize, 12), 40);

        try {
          const characterPaths = await textToStrokePaths(text, x, y, resolvedFontSize);

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

          // Compiler-owned labels have tiny budgets and no audio schedule. Rendering
          // every glyph stroke on a separate animation frame turns a 260 ms label into
          // several seconds. Commit those paths in one batch; teaching text keeps the
          // normal handwritten reveal.
          const visibleCharacterCount = charInfos.filter(
            (info) => info.charPath.char.trim().length > 0,
          ).length;
          if (
            !writeUsesStrokePenMotion({
              hasSchedule: Boolean(schedule),
              durationMs: duration,
              visibleCharacterCount,
            })
          ) {
            for (const { charPath } of charInfos) {
              if (shouldCancel?.()) return;
              if (charPath.strokes.length === 0) {
                const textNode = new Konva.Text({
                  text: charPath.char,
                  x: charPath.x,
                  y: charPath.y,
                  fontFamily: "Caveat, cursive",
                  fontSize: charPath.fontSize ?? resolvedFontSize,
                  fill: inkColorRef.current,
                  listening: false,
                });
                drawLayer.add(textNode);
                trackNode(textNode, completedNodesRef.current);
                continue;
              }
              for (const stroke of charPath.strokes) {
                const pathNode = new Konva.Path({
                  data: stroke.pathData,
                  stroke: inkColorRef.current,
                  strokeWidth: stroke.width,
                  fillEnabled: false,
                  lineCap: "round",
                  lineJoin: "round",
                  listening: false,
                });
                drawLayer.add(pathNode);
                trackNode(pathNode, completedNodesRef.current);
              }
            }
            const last = charInfos.at(-1)?.charPath;
            if (last) {
              jumpNib(last.x + last.width, last.y, "write");
            }
            drawLayer.batchDraw();
            return;
          }

          // When a schedule is supplied, each character is gated against the true audio
          // playback clock so writing tracks the narration word by word — and never drifts,
          // because every character re-anchors to the real audio position.
          const offsets = schedule?.charStartOffsetsMs;
          const scheduled = Array.isArray(offsets) && offsets.length > 0;
          const audioPositionMs = schedule?.getAudioPositionMs;
          const scheduleOriginMs = performance.now();

          const flyBudgetMs = Math.min(totalStrokes * 2, duration * 0.06);
          const drawBudgetMs = Math.max(duration - flyBudgetMs, totalStrokes * 3);
          const totalPathLength = charInfos.reduce((sum, info) => sum + info.pathLength, 0);
          const fallbackDrawMs =
            fallbackCount > 0 ? (drawBudgetMs * fallbackCount) / totalStrokes : 0;
          let previousScheduledBudgetMs = 72;

          for (let ci = 0; ci < charInfos.length; ci++) {
            if (!mountedRef.current || shouldCancel?.()) return;

            const { charPath, strokeLengths, pathLength } = charInfos[ci];

            let charBudgetMs: number;
            if (scheduled && offsets && audioPositionMs) {
              const start = offsets[Math.min(ci, offsets.length - 1)] ?? 0;
              // Hold this character until the voice reaches its spoken moment.
              // Missing/stuck clocks fall through to wall time from this WRITE start.
              await waitForAudioPosition(start, audioPositionMs, scheduleOriginMs);
              if (!mountedRef.current || shouldCancel?.()) return;
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
                perfectDrawEnabled: false,
              });

              const charDuration = Math.max(charBudgetMs, 30);
              animLayer.add(textNode);
              trackNode(textNode, animNodesRef.current);
              animLayer.batchDraw();

              await animateOver(charDuration, (progress) => {
                textNode.opacity(progress);
                moveNib(charPath.x + charPath.width * progress, charPath.y, "write");
                animLayer.batchDraw();
              }, undefined, scheduled ? { lockToWallClock: true } : undefined);

              if (shouldCancel?.()) {
                textNode.destroy();
                untrackNode(textNode, animNodesRef.current);
                animLayer.batchDraw();
                return;
              }

              textNode.opacity(1);
              textNode.moveTo(drawLayer);
              untrackNode(textNode, animNodesRef.current);
              trackNode(textNode, completedNodesRef.current);
              animLayer.batchDraw();
              drawLayer.batchDraw();
              continue;
            }

            const firstStroke = charPath.strokes[0]!;
            const dist = Math.hypot(
              firstStroke.startX - cursorViewRef.current.x,
              firstStroke.startY - cursorViewRef.current.y,
            );
            const hopMs = hopDurationMs(dist);
            if (dist > 72) {
              await flyCursorTo(
                firstStroke.startX,
                firstStroke.startY,
                Math.min(140, dist * 0.35),
                HANDWRITING_ROTATION,
              );
            } else if (hopMs > 0) {
              // The hop comes out of this character's own time so the ink
              // never drifts behind the voice for the sake of a nicer arc.
              await hopNib(
                firstStroke.startX,
                firstStroke.startY,
                hopMs,
                "write",
                scheduled ? { lockToWallClock: true } : undefined,
              );
              charBudgetMs = Math.max(charBudgetMs - hopMs, 28);
            } else {
              jumpNib(firstStroke.startX, firstStroke.startY, "write");
            }
            if (!mountedRef.current || shouldCancel?.()) return;

            const strokeNodes: Array<{
              pathNode: Konva.Path;
              totalLength: number;
              samples: { x: number; y: number }[];
            }> = [];
            for (let si = 0; si < charPath.strokes.length; si++) {
              const stroke = charPath.strokes[si]!;
              const pathNode = new Konva.Path(
                inkPathConfig(stroke.pathData, stroke.width, inkColorRef.current),
              );
              const totalLength = Math.max(pathNode.getLength(), 1);
              pathNode.dash([totalLength]);
              pathNode.dashOffset(totalLength);
              animLayer.add(pathNode);
              trackNode(pathNode, animNodesRef.current);
              strokeNodes.push({
                pathNode,
                totalLength,
                samples: sampleKonvaPath(pathNode, totalLength),
              });
            }
            if (strokeNodes.length === 0) continue;
            animLayer.batchDraw();

            // Strokes interleaved with the air between them, so the dot of an
            // i is reached by a lifted pen instead of a teleport.
            const segments = planGlyphSegments(
              strokeNodes.map((node) => ({
                length: node.totalLength,
                start: node.samples[0] ?? { x: 0, y: 0 },
                end: node.samples[node.samples.length - 1] ?? { x: 0, y: 0 },
              })),
            );
            const segmentLengths = segments.map((segment) => segment.length);
            const glyphLength = segmentLengths.reduce((sum, length) => sum + length, 0);
            const glyphMs = Math.max(charBudgetMs, 36);

            await animateOver(glyphMs, (progress) => {
              const eased = handwritingProgress(progress, glyphMs);
              const drawn = eased * glyphLength;
              const split = splitDrawnLength(segmentLengths, drawn);
              const segment = segments[split.index]!;
              for (let si = 0; si < strokeNodes.length; si++) {
                const node = strokeNodes[si]!;
                if (si < segment.stroke) {
                  node.pathNode.dashOffset(0);
                } else if (si === segment.stroke && segment.kind === "ink") {
                  node.pathNode.dashOffset(node.totalLength - split.inStroke);
                } else {
                  node.pathNode.dashOffset(node.totalLength);
                }
              }
              if (segment.kind === "air") {
                const t = split.inStroke / Math.max(segment.length, 1e-6);
                hoverNib(
                  segment.from.x + (segment.to.x - segment.from.x) * t,
                  segment.from.y + (segment.to.y - segment.from.y) * t,
                  "write",
                  AIR_LIFT_PX * Math.sin(Math.PI * clamp(t, 0, 1)),
                );
              } else {
                const active = strokeNodes[segment.stroke]!;
                const point = pointAlongSamples(active.samples, active.totalLength, split.inStroke);
                moveNib(point.x, point.y, "write");
              }
              animLayer.batchDraw();
            }, undefined, scheduled ? { lockToWallClock: true } : undefined);

            if (shouldCancel?.()) {
              for (const node of strokeNodes) {
                node.pathNode.destroy();
                untrackNode(node.pathNode, animNodesRef.current);
              }
              animLayer.batchDraw();
              return;
            }

            for (const node of strokeNodes) {
              node.pathNode.dash([]);
              node.pathNode.dashOffset(0);
              node.pathNode.moveTo(drawLayer);
              untrackNode(node.pathNode, animNodesRef.current);
              trackNode(node.pathNode, completedNodesRef.current);
            }
            animLayer.batchDraw();
            drawLayer.batchDraw();
          }
        } catch {
          const textNode = new Konva.Text({
            text,
            x,
            y,
            opacity: 0,
            fontFamily: "Caveat, cursive",
            fontSize: resolvedFontSize,
            fill: inkColorRef.current,
            listening: false,
          });

          animLayer.add(textNode);
          trackNode(textNode, animNodesRef.current);
          jumpNib(x, y, "write");
          animLayer.batchDraw();

          await animateOver(duration, (progress) => {
            textNode.opacity(progress);
            moveNib(x + textNode.getTextWidth() * progress, y, "write");
            animLayer.batchDraw();
          });

          if (shouldCancel?.()) {
            textNode.destroy();
            untrackNode(textNode, animNodesRef.current);
            animLayer.batchDraw();
            return;
          }

          textNode.opacity(1);
          textNode.moveTo(drawLayer);
          untrackNode(textNode, animNodesRef.current);
          trackNode(textNode, completedNodesRef.current);
          animLayer.batchDraw();
          drawLayer.batchDraw();
        }
      },
      [
        animateOver,
        equipInstrumentFor,
        flyCursorTo,
        hopNib,
        hoverNib,
        jumpNib,
        moveNib,
        trackNode,
        untrackNode,
        waitForAudioPosition,
      ],
    );

    const eraseRegion = useCallback(
      async (
        x: number,
        y: number,
        regionWidth: number,
        regionHeight: number,
        duration: number,
        shouldCancel?: () => boolean,
      ): Promise<void> => {
        const drawLayer = drawLayerRef.current;
        const animLayer = animLayerRef.current;
        const cursorLayer = cursorLayerRef.current;
        const highlightLayer = highlightLayerRef.current;

        if (!drawLayer || !animLayer || !cursorLayer || shouldCancel?.()) {
          return;
        }

        const previousCursorState = activeCursorStateRef.current;
        updateCursorState("erasing");

        const targetY = y + regionHeight / 2;
        await flyCursorTo(x, targetY, Math.min(duration * 0.3, 800));
        if (shouldCancel?.()) return;

        const sweepDuration = Math.max(duration * 0.7, 100);
        await animateOver(sweepDuration, (progress) => {
          const sweepX = x + regionWidth * progress;
          setCursorViewSafely(sweepX, targetY, 0, 1);

          const erasedRect = { x, y, width: regionWidth * progress, height: regionHeight };
          destroyNodesInRect(completedNodesRef.current, erasedRect);
          destroyNodesInRect(animNodesRef.current, erasedRect);

          drawLayer.batchDraw();
          animLayer.batchDraw();
          highlightLayer?.batchDraw();
          cursorLayer.batchDraw();
        }, shouldCancel);

        if (!shouldCancel?.()) updateCursorState(previousCursorState);
      },
      [animateOver, destroyNodesInRect, flyCursorTo, setCursorViewSafely, updateCursorState],
    );

    const clearBoard = useCallback(
      async (duration?: number): Promise<void> => {
        const drawLayer = drawLayerRef.current;
        const animLayer = animLayerRef.current;
        const cursorLayer = cursorLayerRef.current;
        const highlightLayer = highlightLayerRef.current;

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
            highlightLayer?.batchDraw();
            cursorLayer.batchDraw();
          });

          updateCursorState(previousCursorState);
        } else {
          clearTrackedNodes(animNodesRef.current);
          clearTrackedNodes(completedNodesRef.current);
          animLayer.batchDraw();
          drawLayer.batchDraw();
          highlightLayer?.batchDraw();
          cursorLayer.batchDraw();
        }

        // Reset the reactive shape-speed damping so the next turn starts fresh.
        previousShapeBudgetMsRef.current = null;
        drawTransactionsRef.current.clear();
        for (const node of spotlightNodesRef.current) node.destroy();
        spotlightNodesRef.current = [];
        highlightLayer?.batchDraw();
        spotlightLayerRef.current?.batchDraw();
      },
      [animateOver, clearTrackedNodes, destroyNodesInRect, flyCursorTo, setCursorViewSafely, updateCursorState, height, width],
    );

    const setSpotlight = useCallback((
      spotlight: {
        veil: { x: number; y: number; width: number; height: number };
        hole: { x: number; y: number; width: number; height: number };
        opacity?: number;
      } | null,
    ): void => {
      const spotlightLayer = spotlightLayerRef.current;
      for (const node of spotlightNodesRef.current) node.destroy();
      spotlightNodesRef.current = [];
      if (!spotlightLayer || !spotlight) {
        spotlightLayer?.batchDraw();
        return;
      }
      const opacity = spotlight.opacity ?? 0.36;
      const veil = spotlight.veil;
      const hole = spotlight.hole;
      const bands = [
        { x: veil.x, y: veil.y, width: veil.width, height: Math.max(0, hole.y - veil.y) },
        {
          x: veil.x,
          y: hole.y + hole.height,
          width: veil.width,
          height: Math.max(0, veil.y + veil.height - (hole.y + hole.height)),
        },
        {
          x: veil.x,
          y: hole.y,
          width: Math.max(0, hole.x - veil.x),
          height: hole.height,
        },
        {
          x: hole.x + hole.width,
          y: hole.y,
          width: Math.max(0, veil.x + veil.width - (hole.x + hole.width)),
          height: hole.height,
        },
      ];
      for (const band of bands) {
        if (band.width < 1 || band.height < 1) continue;
        const rect = new Konva.Rect({
          ...band,
          fill: "#1A1A1A",
          opacity,
          listening: false,
        });
        spotlightLayer.add(rect);
        spotlightNodesRef.current.push(rect);
      }
      spotlightLayer.batchDraw();
    }, []);

    /**
     * Rough-paper fidget. While the tutor is thinking, the hand takes the pencil
     * down to the bottom-left margin and scribbles: a stroke, a hover with the
     * odd tap against the board, a twirl every few cycles. The scratch ink is
     * added to the cursor layer, which `captureSnapshot` hides and no draw
     * transaction owns — it is a gesture, never board content, so it can never
     * be mistaken for teaching ink.
     */
    useEffect(() => {
      if (thinkingMotion !== "doodle" || activeCursorState !== "thinking") {
        return undefined;
      }
      const cursorLayer = cursorLayerRef.current;
      if (!cursorLayer) {
        return undefined;
      }

      const box = {
        x: width * SCRATCH_BOX_RATIO.x,
        y: height * SCRATCH_BOX_RATIO.y,
        width: width * SCRATCH_BOX_RATIO.width,
        height: height * SCRATCH_BOX_RATIO.height,
      };

      let cancelled = false;
      let frameId: number | null = null;
      let clockMs = 0;
      let lastFrameMs = performance.now();
      let phase: "travel" | "trace" | "fidget" | "flourish" = "travel";
      let phaseStartMs = 0;
      let travelMs = SCRATCH_TRAVEL_MS;
      let cycle = 0;
      let origin = { ...cursorViewRef.current };
      let anchor = { x: origin.x, y: origin.y };
      let active: {
        node: Konva.Path;
        length: number;
        samples: { x: number; y: number }[];
      } | null = null;
      const live: Array<{ node: Konva.Path; bornMs: number }> = [];

      const strokeStart = (index: number): { x: number; y: number } => {
        const path = new Konva.Path({ data: scratchStrokePath(index, box) });
        const point = path.getPointAtLength(0);
        const start = { x: point?.x ?? box.x, y: point?.y ?? box.y };
        path.destroy();
        return start;
      };

      let target = strokeStart(0);

      const beginTrace = (): void => {
        const node = new Konva.Path({
          data: scratchStrokePath(cycle, box),
          stroke: inkColorRef.current,
          strokeWidth: SCRATCH_STROKE_WIDTH,
          opacity: SCRATCH_OPACITY,
          fillEnabled: false,
          lineCap: "round",
          lineJoin: "round",
          listening: false,
          perfectDrawEnabled: false,
        });
        const length = Math.max(node.getLength(), 1);
        node.dash([length]);
        node.dashOffset(length);
        cursorLayer.add(node);
        // Under the instrument, so the pencil is never hidden by its own ink.
        node.moveToBottom();
        live.push({ node, bornMs: clockMs });
        while (live.length > SCRATCH_MAX_LIVE) {
          live.shift()?.node.destroy();
        }
        active = {
          node,
          length,
          samples: samplePolyline(length, (distance) => {
            const point = node.getPointAtLength(distance);
            return { x: point?.x ?? 0, y: point?.y ?? 0 };
          }),
        };
        phase = "trace";
        phaseStartMs = clockMs;
      };

      const fadeOldStrokes = (): void => {
        for (let index = live.length - 1; index >= 0; index--) {
          const entry = live[index]!;
          if (entry.node === active?.node) continue;
          const age = clockMs - entry.bornMs - SCRATCH_HOLD_MS;
          if (age <= 0) continue;
          const remaining = 1 - age / SCRATCH_FADE_MS;
          if (remaining <= 0) {
            entry.node.destroy();
            live.splice(index, 1);
            continue;
          }
          entry.node.opacity(SCRATCH_OPACITY * remaining);
        }
      };

      const advance = (): void => {
        const elapsed = clockMs - phaseStartMs;

        if (phase === "travel") {
          const progress = Math.min(elapsed / travelMs, 1);
          const eased = smoothstep(progress);
          const arc = Math.sin(Math.PI * progress);
          setCursorViewSafely(
            anchor.x + (target.x - anchor.x) * eased,
            anchor.y + (target.y - anchor.y) * eased,
            lerpAngle(origin.rotation, restingTilt("idle"), eased),
            1,
            { lift: FLIGHT_LIFT_PX * 1.5 * arc },
          );
          if (progress >= 1) {
            settleNib(target.x, target.y, restingTilt("idle"));
            beginTrace();
          }
          return;
        }

        if (phase === "trace") {
          if (!active) {
            phase = "fidget";
            phaseStartMs = clockMs;
            return;
          }
          const progress = Math.min(elapsed / SCRATCH_STROKE_MS, 1);
          const drawn = handwritingProgress(progress, SCRATCH_STROKE_MS) * active.length;
          active.node.dashOffset(active.length - drawn);
          const point = pointAlongSamples(active.samples, active.length, drawn);
          moveNib(point.x, point.y, "idle");
          if (progress >= 1) {
            anchor = { x: point.x, y: point.y };
            active = null;
            phase = "fidget";
            phaseStartMs = clockMs;
          }
          return;
        }

        if (phase === "fidget") {
          const pose = thinkingPose(clockMs);
          setCursorViewSafely(
            anchor.x + pose.dx,
            anchor.y + pose.dy,
            nib.tilt + pose.tiltOffset,
            pose.scale,
            { spin: pose.spin, lift: pose.lift },
          );
          if (elapsed >= SCRATCH_FIDGET_MS) {
            cycle += 1;
            if (cycle % THINKING_FLOURISH_EVERY === 0) {
              phase = "flourish";
            } else {
              origin = { ...cursorViewRef.current };
              target = strokeStart(cycle);
              travelMs = SCRATCH_HOP_MS;
              phase = "travel";
            }
            phaseStartMs = clockMs;
          }
          return;
        }

        const progress = Math.min(elapsed / SCRATCH_FLOURISH_MS, 1);
        const pose = flourishPose(progress, 1);
        setCursorViewSafely(anchor.x, anchor.y, nib.tilt, pose.scale, {
          spin: pose.spin,
          lift: pose.lift,
        });
        if (progress >= 1) {
          origin = { ...cursorViewRef.current };
          target = strokeStart(cycle);
          travelMs = SCRATCH_HOP_MS;
          phase = "travel";
          phaseStartMs = clockMs;
        }
      };

      const step = (now: number): void => {
        if (cancelled) return;
        const delta = Math.min(Math.max(now - lastFrameMs, 0), 64);
        lastFrameMs = now;
        // A paused board or any real drawing work outranks the fidget: the
        // clock simply does not advance, so the loop resumes where it stopped.
        if (!isPausedRef.current && animationCleanupsRef.current.size === 0) {
          clockMs += delta;
          advance();
          fadeOldStrokes();
          cursorLayer.batchDraw();
        }
        frameId = requestAnimationFrame(step);
      };

      // Rough work is pencil work.
      void swapInstrument("pencil");
      frameId = requestAnimationFrame(step);

      return () => {
        cancelled = true;
        if (frameId !== null) cancelAnimationFrame(frameId);
        for (const entry of live) entry.node.destroy();
        live.length = 0;
        active = null;
        const view = cursorViewRef.current;
        setCursorViewSafely(view.x, view.y, view.rotation, 1);
        cursorLayer.batchDraw();
      };
    }, [
      activeCursorState,
      height,
      moveNib,
      nib,
      setCursorViewSafely,
      settleNib,
      swapInstrument,
      thinkingMotion,
      width,
    ]);

    /**
     * The twirl. While a response is pending the pencil rises off the board
     * where it last wrote and spins about the barrel mid-point at a steady
     * rate — the gesture the rest of the app shows for the same wait, so the
     * board and the chrome agree on what "thinking" looks like. Driven through
     * the cached pose nodes, never a React render per frame.
     */
    useEffect(() => {
      if (thinkingMotion !== "spin" || activeCursorState !== "thinking") {
        return undefined;
      }

      let cancelled = false;
      let frameId: number | null = null;
      let clockMs = 0;
      let lastFrameMs = performance.now();
      // The clock only starts once the pencil is in hand, so the swap's own
      // flip lands before the twirl begins instead of fighting it.
      let armed = false;
      const anchor = { ...cursorViewRef.current };

      const step = (now: number): void => {
        if (cancelled) return;
        const delta = Math.min(Math.max(now - lastFrameMs, 0), 64);
        lastFrameMs = now;
        // A paused board or any real drawing work outranks the twirl: the
        // clock simply does not advance, so the spin resumes where it stopped.
        if (armed && !isPausedRef.current && animationCleanupsRef.current.size === 0) {
          clockMs += delta;
          const pose = spinningPose(clockMs);
          setCursorViewSafely(
            anchor.x + pose.dx,
            anchor.y + pose.dy,
            anchor.rotation,
            pose.scale,
            { spin: pose.spin, lift: pose.lift, spinVelocity: pose.velocity },
          );
        }
        frameId = requestAnimationFrame(step);
      };

      // Rough work is pencil work.
      void swapInstrument("pencil").then(() => {
        if (!cancelled) armed = true;
      });
      frameId = requestAnimationFrame(step);

      return () => {
        cancelled = true;
        if (frameId !== null) cancelAnimationFrame(frameId);
        const view = cursorViewRef.current;
        setCursorViewSafely(view.x, view.y, view.rotation, 1);
      };
    }, [activeCursorState, setCursorViewSafely, swapInstrument, thinkingMotion]);

    useLayoutEffect(() => {
      const view = cursorViewRef.current;
      // The instrument art was re-created, so the cached lift/spin nodes are stale.
      poseNodesRef.current = { group: null, lift: null, spin: null, ghosts: [] };
      setCursorViewSafely(view.x, view.y, view.rotation, view.scale, {
        spin: view.spin,
        lift: view.lift,
        fade: view.fade,
        spinVelocity: view.spinVelocity,
      });
    }, [activeCursorState, activeInstrument, setCursorViewSafely]);

    useEffect(() => {
      activeCursorStateRef.current = cursorState;
      setActiveCursorState(cursorState);
    }, [cursorState]);

    useEffect(
      () => {
        mountedRef.current = true;
        const animationCleanups = animationCleanupsRef.current;
        const frameIds = frameIdsRef.current;
        const animNodes = animNodesRef.current;
        const completedNodes = completedNodesRef.current;
        const drawTransactions = drawTransactionsRef.current;

        return () => {
          mountedRef.current = false;
          Array.from(animationCleanups).forEach((cleanup) => cleanup());
          Array.from(frameIds).forEach((frameId) => cancelFrame(frameId));
          frameIds.clear();
          clearTrackedNodes(animNodes);
          clearTrackedNodes(completedNodes);
          drawTransactions.clear();
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
        setSpotlight,
        eraseRegion,
        punchDiagramLineGapsInRect,
        setCursorPos: (x: number, y: number) => setCursorViewSafely(x, y),
        setCursorState: updateCursorState,
        setInstrument: swapInstrument,
        flourishPen,
        flyCursorTo,
        setPaused: (paused: boolean) => {
          isPausedRef.current = paused;
        },
        cancelAnimations,
        beginDrawTransaction,
        commitDrawTransaction,
        abortDrawTransaction,
        finishAbortedDrawTransaction,
        setAnimationSpeed: (multiplier: number) => {
          animationSpeedRef.current = Math.max(0.25, Math.min(multiplier, 4));
        },
        getDrawLayer: () => drawLayerRef.current,
        getAnimLayer: () => animLayerRef.current,
        getCursorLayer: () => cursorLayerRef.current,
        captureSnapshot: (pixelRatio: number = 2): string | null => {
          const drawLayer = drawLayerRef.current;
          const cursorLayer = cursorLayerRef.current;
          if (!drawLayer) {
            return null;
          }
          const stage = drawLayer.getStage();
          if (!stage) {
            return null;
          }
          const cursorWasVisible = cursorLayer ? cursorLayer.visible() : false;
          if (cursorLayer) {
            cursorLayer.visible(false);
          }
          try {
            return stage.toDataURL({ pixelRatio });
          } finally {
            if (cursorLayer) {
              cursorLayer.visible(cursorWasVisible);
            }
          }
        },
      }),
      [abortDrawTransaction, beginDrawTransaction, cancelAnimations, clearBoard, commitDrawTransaction, drawAnnotation, drawShape, eraseRegion, finishAbortedDrawTransaction, flourishPen, flyCursorTo, punchDiagramLineGapsInRect, setCursorViewSafely, setSpotlight, swapInstrument, updateCursorState, writeText],
    );

    return (
      <Stage
        width={width}
        height={height}
        style={{ backgroundColor: WHITEBOARD_COLOR }}
        perfectDrawEnabled={false}
      >
        <Layer ref={highlightLayerRef} listening={false} perfectDrawEnabled={false} />
        <Layer ref={drawLayerRef} listening={false} perfectDrawEnabled={false} />
        <Layer ref={animLayerRef} listening={false} perfectDrawEnabled={false}>
          <KonvaPath data={HIDDEN_PATH_DATA} visible={false} listening={false} />
        </Layer>
        <Layer ref={spotlightLayerRef} listening={false} perfectDrawEnabled={false} />
        <Layer ref={cursorLayerRef} listening={false} perfectDrawEnabled={false}>
          {activeCursorState === "erasing" ? (
            <Rect
              ref={dusterRef}
              x={cursorViewRef.current.x - DUSTER_WIDTH / 2}
              y={cursorViewRef.current.y - DUSTER_HEIGHT / 2}
              width={DUSTER_WIDTH}
              height={DUSTER_HEIGHT}
              fill={DUSTER_COLOR}
              stroke={DUSTER_STROKE}
              strokeWidth={1}
              cornerRadius={DUSTER_CORNER_RADIUS}
              rotation={cursorViewRef.current.rotation}
              scaleX={cursorViewRef.current.scale}
              scaleY={cursorViewRef.current.scale}
              opacity={cursorOpacity(activeCursorState)}
              shadowColor="#999999"
              shadowBlur={10}
              shadowOpacity={0.4}
              listening={false}
              perfectDrawEnabled={false}
            />
          ) : (
            <VirtualCursor
              ref={cursorGroupRef}
              x={cursorViewRef.current.x}
              y={cursorViewRef.current.y}
              rotation={cursorViewRef.current.rotation}
              spin={cursorViewRef.current.spin}
              lift={cursorViewRef.current.lift}
              scale={cursorViewRef.current.scale}
              color={activeInstrument === "highlighter" ? HIGHLIGHT_FILL : inkColor}
              instrument={activeInstrument}
              visible={cursorOpacity(activeCursorState) > 0}
              opacity={cursorOpacity(activeCursorState) * cursorViewRef.current.fade}
              glowRadius={activeCursorState === "drawing" ? 8 : 6}
            />
          )}
        </Layer>
      </Stage>
    );
  },
);
