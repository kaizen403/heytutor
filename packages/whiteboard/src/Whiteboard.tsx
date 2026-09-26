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
  resolveWriteWaitClockMs,
  shouldReleaseAudioPositionWait,
  textToStrokePaths,
  snapToBoardTypeScale,
  BOARD_TYPE_SCALE,
  DIAGRAM_ZONE,
  MAX_BOARD_FONT_SIZE,
  MIN_BOARD_FONT_SIZE,
  WORK_ZONE,
  type DrawCommandInkSettings,
} from "@heytutor/drawing";
import {
  DEFAULT_WHITEBOARD_TIME_SOURCE,
  shouldHideCursorForCapture,
  type CaptureFrameOptions,
  type WhiteboardTimeSource,
} from "./whiteboardClock";
import { Layer, Path as KonvaPath, Rect, Stage } from "react-konva";
import { VirtualCursor } from "./VirtualCursor";
import { cursorOpacity, type CursorState } from "./cursorState";
import { DrawTransactionRegistry } from "./drawTransactionRegistry";
import {
  advanceSpeedAwareProgress,
  audioWaitAlreadyDue,
  handwritingProgress,
  handwritingVariation,
  pacedGlyphPosition,
  pacedStrokeDistance,
  paceScaleForLagMs,
  dampPaceScale,
  GLYPH_SLOT_FALLBACK_MS,
  GLYPH_SLOT_MIN_MS,
  lingeringGlyphProgress,
  planGlyphPacing,
  pointAlongSamples,
  resolveShapeDurationMs,
  samplePolyline,
  scheduledGlyphBudgetMs,
  tweenStartDeltaMs,
  writeUsesStrokePenMotion,
} from "./penMotion";
import {
  AIR_LIFT_PX,
  CURSOR_ALPHA_EPSILON,
  CURSOR_FADE_TIME_CONSTANT_MS,
  ERASER_BLEND_TIME_CONSTANT_MS,
  FLIGHT_LIFT_PX,
  HOP_LIFT_PX,
  MAX_FRAME_DT_MS,
  NibTracker,
  SWAP_DURATION_MS,
  SWAP_HURRY_MS,
  WAIT_SETTLE_MS,
  advanceIdleHold,
  approachFraction,
  bowedPoint,
  carryBow,
  carryEase,
  flightBow,
  flightRotationBlend,
  flourishPose,
  hopDurationMs,
  idleHoldStart,
  instrumentSwapPose,
  lerpAngle,
  nibTravelFor,
  shapeReachMs,
  planGlyphSegments,
  reachEase,
  restingTilt,
  settleWaitingPose,
  SPIN_GHOST_COUNT,
  scratchStrokePath,
  spinGhosts,
  thinkingPose,
  tremor,
  waitingPose,
} from "./penChoreography";
import {
  IDLE_RELEASE_MS,
  idlePose,
  idleReleaseMs,
  releaseIdlePose,
  type IdlePose,
} from "./penIdle";
import type { StuntKind } from "./penStunts";
import {
  DEFAULT_INK_THICKNESS,
  commandInkStyle,
  instrumentForActivity,
  instrumentInkStyle,
  type InstrumentInkStyle,
  type InstrumentKind,
  type PenActivity,
} from "./instruments";
import { BOARD_INK_ATTR, boardInkKindAt, type BoardInkKind } from "./inkKind";

export interface WhiteboardProps {
  width?: number;
  height?: number;
  cursorState?: CursorState;
  inkColor?: string;
  pencilColor?: string;
  markerThickness?: number;
  pencilThickness?: number;
  /**
   * What the hand does while the tutor is thinking. `spin` plays with whatever
   * is in hand where it last wrote — the repertoire of idle gestures in
   * `penIdle`, one at a time with rests between them, so a long narration is a
   * hand holding a pen rather than a barrel turning on a loop. `doodle`
   * scribbles in the bottom-left margin the way you would on rough paper; that
   * scratch ink lives on the cursor layer, so it is never board content and
   * never lands in a snapshot.
   */
  thinkingMotion?: "spin" | "doodle" | "none";
  /**
   * Marker stunts: which tricks the idle hand may play on top of the small
   * fidgets it always plays. The student picks them, so this is a list and not
   * a switch; an empty list is the hand with no tricks at all. Read live
   * through a ref, so changing the selection mid-lesson lands on the next
   * pause rather than restarting the one in flight.
   */
  markerStunts?: readonly StuntKind[];
}

export interface WriteSchedule {
  /** Start time (ms from audible audio start) for each non-space character, in order. */
  charStartOffsetsMs: number[];
  /**
   * Spoken slot (media ms) of each character. The ink of a character fills its
   * slot: see `scheduledGlyphBudgetMs` for the floor, the cap and the linger.
   */
  charDurationsMs?: number[];
  /**
   * Returns the current audio playback position in ms from audible start (pause-aware,
   * may be negative before the audio is audible). Each character is held until the
   * audio clock reaches its scheduled offset, keeping writing locked to the voice.
   */
  getAudioPositionMs: () => number;
  /**
   * Media ms per wall ms of the voice this schedule follows (1.5 at the default
   * playback speed). Glyph tweens are timed in media ms against the schedule
   * and converted to wall time with this, locked to the wall clock, so the
   * board's adaptive animation speed is not applied a second time on top of a
   * clock that already encodes the catch-up. Absent, the board's own animation
   * speed stands in for it.
   */
  getPlaybackRate?: () => number;
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
  inkSettings?: DrawCommandInkSettings;
  fillColor?: string;
  fillOpacity?: number;
  /** Remove the gesture after a short fade so review traces do not overwrite ink. */
  transient?: boolean;
  /** Allows the owning turn or transaction to abort stale annotation work. */
  shouldCancel?: () => boolean;
}

export interface ShapeDrawOptions {
  dashed?: boolean;
  inkSettings?: DrawCommandInkSettings;
  strokeWidth?: number;
  /**
   * What this stroke commits to, which is what decides the instrument.
   * The figure and its scaffolding — a guide, a tick, a hatch, a dropped line —
   * are both laid down in pencil. See `instrumentForActivity`.
   */
  strokeRole?: "primary" | "construction" | "trace";
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
  /**
   * The voice is describing this stroke right now, and `duration` is its
   * spoken window. The stroke takes that time (stretched at most 1.5x over the
   * hand-speed floor) instead of the 320 ms scene ceiling, so an intro figure
   * is drawn under the sentence that names it rather than in its first 3 s.
   */
  cued?: boolean;
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
    inkSettings?: DrawCommandInkSettings,
  ) => Promise<void>;
  getInkSettings: () => DrawCommandInkSettings;
  clearBoard: (duration?: number) => Promise<void>;
  eraseRegion: (
    x: number,
    y: number,
    width: number,
    height: number,
    duration: number,
    shouldCancel?: () => boolean,
  ) => Promise<void>;
  /**
   * Wipe every work-column stroke, including glyphs that spilled past the
   * column into the figure. Geometric `eraseRegion` stops at the column edge
   * and leaves those tails on the board.
   */
  eraseWorkInk: (duration: number, shouldCancel?: () => boolean) => Promise<void>;
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
  /**
   * Capture the current board as a canvas (no PNG encode). Used by lecture MP4
   * export. Keeps the pen unless `hideCursor` is set.
   */
  captureFrame: (options?: CaptureFrameOptions) => HTMLCanvasElement | null;
  /** Swap the animation clock. Pass null to restore the wall-clock default. */
  setTimeSource: (source: WhiteboardTimeSource | null) => void;
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
  /** Squash across the barrel: 1 face-on, 0 edge-on. Carries the swap. */
  flatten: number;
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
/** Warm night-light paper: still light for marker contrast, blue pulled down. */
export const WHITEBOARD_COLOR = "#F6E4C4";
const DEFAULT_INK_COLOR = "#222222";
/** Highlighter yellow, laid under the ink so the writing stays crisp. */
const HIGHLIGHT_FILL = "#FFD84D";
const HIGHLIGHT_OPACITY = 0.34;
const ANNOTATION_STROKE_WIDTH = 3.25;
/** A box is a quiet gesture — it frames the formula, it does not shout. */
const BOX_STROKE_WIDTH = 2;
/** Scene-engine figure ink, before the pencil's own thinning. */
const SHAPE_STROKE_WIDTH = 1.15;
/** Marks eligible for gap cutting retain this tag when thickness changes. */
const SCENE_LEAD_ATTR = "sceneLead";
/** Scene setup ink: visible, not a 10s sketch. Matches tutor-core SCENE_MAX_MS. */
const SCENE_SHAPE_MAX_MS = 320;
const SCENE_SHAPE_MIN_MS = 70;
const DIAGRAM_LINE_PATH_RE =
  /^M\s*([-\d.]+)\s+([-\d.]+)\s+L\s*([-\d.]+)\s+([-\d.]+)\s*$/;
/**
 * The states in which the hand is allowed to play with the instrument.
 *
 * `speaking` belongs here and used not to. The marker tour holds `speaking`
 * while it walks a figure, and a walk is a hop and then a dwell: for the whole
 * of every dwell nothing was running at all, so the marker stood dead still on
 * a cell while the tutor talked over it.
 */
const IDLE_ELIGIBLE_STATES: readonly CursorState[] = ["thinking", "speaking"];

/** A stable empty selection, so the default prop is not a new array per render. */
const NO_STUNTS: readonly StuntKind[] = [];

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

/**
 * Every ink path on the board is styled here, so the mark on the board and the
 * instrument shown holding it can never disagree: lead is greyer, thinner and
 * lets the board through; ink is full weight and opaque.
 */
function inkPathConfig(
  pathData: string,
  strokeWidth: number,
  style: InstrumentInkStyle,
): Konva.PathConfig {
  return {
    data: pathData,
    stroke: style.color,
    strokeWidth: strokeWidth * style.widthScale,
    opacity: style.opacity,
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

/**
 * Milliseconds per character below which text is lettered with whatever
 * instrument is already in hand, rather than swapping to the pen.
 *
 * It is the line between a compiler-owned diagram label, which is part of the
 * sketch, and teaching prose, which the student watches being written. A
 * caller that hands a diagram label a generous budget crosses it and pays for
 * an instrument swap on every label: a fourteen-label figure redraw spent six
 * seconds swapping pens, and the sentence introducing it had long finished.
 */
export const LETTERED_IN_HAND_MS_PER_CHAR = 24;

export const Whiteboard = forwardRef<WhiteboardHandle, WhiteboardProps>(
  function Whiteboard(
    {
      width = DEFAULT_WIDTH,
      height = DEFAULT_HEIGHT,
      cursorState = "idle",
      inkColor = DEFAULT_INK_COLOR,
      pencilColor = inkColor,
      markerThickness = DEFAULT_INK_THICKNESS,
      pencilThickness = DEFAULT_INK_THICKNESS,
      thinkingMotion = "spin",
      markerStunts = NO_STUNTS,
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
    /**
     * Sampled points per glyph stroke, keyed by path data. Sampling walks
     * Konva's getPointAtLength up to 65 times per stroke, and it was redone
     * for every stroke of every character on every row; a lesson writes the
     * same few hundred glyph paths over and over, so it is done once each.
     */
    const strokeSampleCacheRef = useRef<Map<string, { x: number; y: number }[]>>(new Map());
    const mountedRef = useRef(true);
    // iPhone 3x backing stores for 1200×700 × several layers is enough for
    // Safari to kill the tab mid-lecture. Cap at 2; the board is already
    // CSS-scaled on a phone so 3x is invisible extra memory.
    const pixelRatioRef = useRef(
      typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    );
    const isPausedRef = useRef(false);
    const animationSpeedRef = useRef(1);
    // Damping state for the reactive shape-speed scheme — mirrors the
    // `previousScheduledBudgetMs` local in writeText, but persists across
    // separate drawShape calls within a turn. It holds a *speed*, so a run of
    // short shapes cannot teach the damper that this is a fast figure.
    const previousPaceScaleRef = useRef<number | null>(null);
    const cursorViewRef = useRef<CursorView>({
      x: width / 2,
      y: height / 2,
      rotation: HANDWRITING_ROTATION,
      scale: 1,
      spin: 0,
      lift: 0,
      fade: 1,
      flatten: 1,
      spinVelocity: 0,
    });
    /**
     * Which pause of this board's life the hand is on. It lives outside the
     * idle effect on purpose: the effect remounts every turn, and a counter
     * inside it would restart at 1 each time — so the first pause of every turn
     * in a lecture would play the same gestures in the same order.
     */
    const idlePauseRef = useRef(0);
    const [nib] = useState(() => new NibTracker(width / 2, height / 2, HANDWRITING_ROTATION));
    const cursorGroupRef = useRef<Konva.Group>(null);
    const poseNodesRef = useRef<PoseNodes>({ group: null, lift: null, spin: null, ghosts: [] });
    const dusterRef = useRef<Konva.Rect>(null);
    const instrumentRef = useRef<InstrumentKind>("pen");
    const [activeInstrument, setActiveInstrument] = useState<InstrumentKind>("pen");
    const [activeCursorState, setActiveCursorState] = useState<CursorState>(cursorState);
    const activeCursorStateRef = useRef<CursorState>(cursorState);
    /**
     * The instrument's own opacity, eased rather than switched.
     *
     * `cursorOpacity` is a step function — `idle` is 0 — and it used to be read
     * straight into `group.opacity()`. A lecture is a run of turns, so the board
     * dropped back to `idle` between them and the pen blinked out of existence
     * and back mid-lesson. The target is still the same step; only the approach
     * to it is smoothed, so the pen is set down and picked up rather than
     * deleted and re-created.
     */
    const stateOpacityRef = useRef(cursorOpacity(cursorState));
    /**
     * How far the hand-over to the eraser has run, 0 (pen) to 1 (duster).
     *
     * The two used to be a React branch: `erasing` unmounted the instrument and
     * mounted a block in its place, so a wipe began by deleting the marker off
     * the board and ended by deleting the block. Both nodes are mounted all the
     * time now and this crossfades between them, which is a hand putting one
     * thing down and picking another up.
     */
    const eraserBlendRef = useRef(cursorState === "erasing" ? 1 : 0);
    /**
     * The alphas last painted on the two nodes. React renders read this rather
     * than recomputing from `cursorOpacity`, so a re-render lands on exactly
     * the frame the imperative fade is on instead of snapping back to the step.
     */
    const cursorAlphaRef = useRef({
      pen: cursorState === "erasing" ? 0 : cursorOpacity(cursorState),
      duster: cursorState === "erasing" ? cursorOpacity(cursorState) : 0,
    });
    const inkColorRef = useRef(inkColor);
    const inkPreferencesRef = useRef({ pencilColor, markerThickness, pencilThickness });
    const getInkSettings = useCallback((): DrawCommandInkSettings => ({
      markerColor: inkColorRef.current,
      pencilColor: inkPreferencesRef.current.pencilColor,
      markerThickness: inkPreferencesRef.current.markerThickness,
      pencilThickness: inkPreferencesRef.current.pencilThickness,
    }), []);
    const styleForCommand = useCallback((recorded?: DrawCommandInkSettings): InstrumentInkStyle =>
      commandInkStyle(instrumentRef.current, getInkSettings(), recorded), [getInkSettings]);
    /**
     * The stunt setting, read on the frame the pose is computed. A prop in the
     * idle effect's dependency list would tear the effect down and rebuild it,
     * which restarts the pause the student is in the middle of watching.
     */
    const markerStuntsRef = useRef(markerStunts);

    useEffect(() => {
      inkColorRef.current = inkColor;
    }, [inkColor]);

    useEffect(() => {
      inkPreferencesRef.current = { pencilColor, markerThickness, pencilThickness };
    }, [pencilColor, markerThickness, pencilThickness]);

    useEffect(() => {
      markerStuntsRef.current = markerStunts;
    }, [markerStunts]);

    const updateCursorState = useCallback((state: CursorState): void => {
      activeCursorStateRef.current = state;
      if (mountedRef.current) {
        setActiveCursorState(state);
      }
    }, []);

    const timeSourceRef = useRef<WhiteboardTimeSource>(DEFAULT_WHITEBOARD_TIME_SOURCE);
    const nowMs = useCallback(() => timeSourceRef.current.now(), []);

    const requestTrackedFrame = useCallback((callback: FrameRequestCallback): number => {
      const frameId = timeSourceRef.current.requestFrame((time) => {
        frameIdsRef.current.delete(frameId);
        callback(time);
      });

      frameIdsRef.current.add(frameId);
      return frameId;
    }, []);

    const cancelTrackedFrame = useCallback((frameId: number): void => {
      timeSourceRef.current.cancelFrame(frameId);
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

    /**
     * Paint the instrument's visibility.
     *
     * One place decides how visible the marker is, and it is the *eased* state
     * opacity, never the step function. `cursorOpacity` is a step — `idle` is
     * 0 — and the render used to read it straight into the node's `visible` and
     * `opacity` props. That meant every React render during the fade snapped
     * the marker back to the step and, at `idle`, hid the node outright: the
     * ease was still running, on a node nobody could see. That is the pen
     * disappearing mid-lesson, and no amount of smoothing upstream survives it.
     *
     * The node is left mounted and `visible` only drops once the fade has
     * actually reached zero, so there is nothing left to see when it does.
     */
    const paintCursorAlpha = useCallback((): void => {
      const alpha = stateOpacityRef.current * cursorViewRef.current.fade;
      const blend = eraserBlendRef.current;
      const penAlpha = alpha * (1 - blend);
      const dusterAlpha = alpha * blend;
      cursorAlphaRef.current = { pen: penAlpha, duster: dusterAlpha };
      const group = cursorGroupRef.current;
      if (group) {
        group.opacity(penAlpha);
        group.visible(penAlpha > CURSOR_ALPHA_EPSILON);
      }
      const duster = dusterRef.current;
      if (duster) {
        duster.opacity(dusterAlpha);
        duster.visible(dusterAlpha > CURSOR_ALPHA_EPSILON);
      }
    }, []);

    const setCursorViewSafely = useCallback(
      (
        x: number,
        y: number,
        rotation = cursorViewRef.current.rotation,
        scale = cursorViewRef.current.scale,
        pose?: {
          spin?: number;
          lift?: number;
          fade?: number;
          flatten?: number;
          spinVelocity?: number;
        },
      ): void => {
        const spin = pose?.spin ?? 0;
        const lift = pose?.lift ?? 0;
        const fade = pose?.fade ?? 1;
        const flatten = pose?.flatten ?? 1;
        const spinVelocity = pose?.spinVelocity ?? 0;
        cursorViewRef.current = { x, y, rotation, scale, spin, lift, fade, flatten, spinVelocity };
        const group = cursorGroupRef.current;
        if (group) {
          group.x(x);
          group.y(y);
          group.rotation(rotation);
          // Flatten is across the barrel only, so a turn in the fingers goes
          // thin rather than transparent.
          group.scaleX(scale * flatten);
          group.scaleY(scale);
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
        paintCursorAlpha();
        cursorLayerRef.current?.batchDraw();
      },
      [paintCursorAlpha, resolvePoseNodes],
    );

    /**
     * The hand does not hold the barrel at a fixed angle: it rolls a few
     * degrees into the stroke, lags behind the turn with a capped rate, and
     * drifts. `NibTracker` owns that; these helpers just paint its answer.
     */

    /** Trace: the nib is on the ink, so its travel steers the barrel. */
    const moveNib = useCallback(
      (x: number, y: number, activity: PenActivity = "write"): void => {
        const now = nowMs();
        setCursorViewSafely(x, y, nib.move(x, y, activity, now) + tremor(now), 1);
      },
      [nib, nowMs, setCursorViewSafely],
    );

    /** Reposition: place the nib without letting the jump rewrite the heading. */
    const jumpNib = useCallback(
      (x: number, y: number, activity: PenActivity = "write"): void => {
        const now = nowMs();
        setCursorViewSafely(x, y, nib.jump(x, y, activity, now) + tremor(now), 1);
      },
      [nib, nowMs, setCursorViewSafely],
    );

    /** In the air: the nib is off the board, travelling between strokes. */
    const hoverNib = useCallback(
      (x: number, y: number, activity: PenActivity, lift: number): void => {
        const now = nowMs();
        setCursorViewSafely(x, y, nib.jump(x, y, activity, now) + tremor(now), 1, { lift });
      },
      [nib, nowMs, setCursorViewSafely],
    );

    /** Land the pen at an exact pose — used at the end of a flight or sweep. */
    const settleNib = useCallback(
      (x: number, y: number, rotation: number): void => {
        nib.settle(x, y, rotation, nowMs());
        setCursorViewSafely(x, y, rotation, 1);
      },
      [nib, nowMs, setCursorViewSafely],
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
          // Tweens are chained: one resolves, the next is created, and its
          // first frame is a whole rAF away. Timing that frame from creation
          // rather than from when it happens to run is what keeps a word
          // moving — otherwise every glyph, and every hop between glyphs,
          // opened with a stalled frame and the hand stuttered letter by
          // letter.
          const createdAtMs = nowMs();
          let lastNow: number | null = null;
          let elapsedMediaMs = 0;
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

            if (isPausedRef.current) {
              lastNow = null;
              frameId = requestTrackedFrame(step);
              return;
            }

            if (lastNow === null) {
              // Credit the gap since the tween was created, capped so a stall
              // or a hidden tab cannot swallow a whole glyph in one step.
              lastNow = now - tweenStartDeltaMs(createdAtMs, now, MAX_FRAME_DT_MS);
            }
            const wallDeltaMs = now - lastNow;
            lastNow = now;
            const speed = playback?.lockToWallClock ? 1 : animationSpeedRef.current;
            const advanced = advanceSpeedAwareProgress({
              elapsedMediaMs,
              durationMs: duration,
              wallDeltaMs,
              speed,
            });
            elapsedMediaMs = advanced.elapsedMediaMs;
            const progress = duration <= 0 ? 1 : advanced.progress;

            onFrame(progress);

            if (progress < 1) {
              frameId = requestTrackedFrame(step);
              return;
            }

            cleanup();
          };

          animationCleanupsRef.current.add(cleanup);

          // A zero-duration tween is a seek landing straight on its finished
          // state, so settle it in place rather than scheduling a frame for it.
          // Going through rAF costs ~16ms per tween, and a catch-up runs one
          // per command — which is what made scrubbing back a few seconds
          // redraw the whole lecture mark by mark.
          if (duration <= 0) {
            if (shouldCancel?.()) {
              cleanup();
              return;
            }
            onFrame(1);
            cleanup();
            return;
          }

          frameId = requestTrackedFrame(step);
        }),
      [cancelTrackedFrame, nowMs, requestTrackedFrame],
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
            flatten: pose.flatten,
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

        if (distance < 6) {
          settleNib(x, y, fixedRotation);
          return;
        }

        const flightDuration = resolveFlightDuration(distance, duration);
        const bow = flightBow(distance);

        // Crossing the board is a real movement of the arm: the nib leaves the
        // surface, swings over an arc rather than sliding down a ruled line,
        // commits early and places itself late, and the barrel only rolls to
        // its landing tilt on the approach.
        await animateOver(flightDuration, (linearProgress) => {
          const easedProgress = reachEase(linearProgress);
          const arc = Math.sin(Math.PI * linearProgress);
          const point = bowedPoint(start, end, easedProgress, bow);

          setCursorViewSafely(
            point.x,
            point.y,
            lerpAngle(startRotation, fixedRotation, flightRotationBlend(linearProgress)) - arc * 4,
            1,
            { lift: FLIGHT_LIFT_PX * arc },
          );
        });

        settleNib(x, y, fixedRotation);
      },
      [animateOver, setCursorViewSafely, settleNib],
    );

    /**
     * The carry from one glyph to the next. Unlike a flight it keeps the
     * barrel's heading and tilt, so the pen arrives already writing.
     *
     * It bows over the gap and keeps its speed at both ends: the hand is still
     * moving when it leaves a letter and when it meets the next one. Easing to
     * a stop between every pair of letters is what made a written line read as
     * a row of stamps.
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
        const bow = carryBow(distanceBetween(start, { x, y }));
        await animateOver(durationMs, (progress) => {
          const eased = carryEase(progress);
          const arc = Math.sin(Math.PI * progress);
          const point = bowedPoint(start, { x, y }, eased, bow);
          hoverNib(point.x, point.y, activity, HOP_LIFT_PX * arc);
        }, undefined, playback);
        jumpNib(x, y, activity);
      },
      [animateOver, hoverNib, jumpNib],
    );

    /**
     * Carry the nib somewhere without making the caller wait for it.
     *
     * There is one place on the board where the nib genuinely has nowhere to
     * be: a label that is stamped down whole rather than written. The ink is
     * already there, so a reach charged against the caller's budget would cost
     * spoken time for nothing — a fourteen-label figure would spend four
     * seconds of narration watching the pen catch up. But leaving it as a
     * `jumpNib` meant the marker blinked to the end of every label it did not
     * write, which is the teleport the student actually sees.
     *
     * So the hand goes there on its own time. The glide yields the frame
     * anything else writes the cursor, which is what stops it fighting the
     * next stroke for the pen.
     */
    const glideNibTo = useCallback(
      (x: number, y: number, activity: PenActivity): void => {
        const start = { x: cursorViewRef.current.x, y: cursorViewRef.current.y };
        const distance = distanceBetween(start, { x, y });
        if (nibTravelFor(distance) === "settle") {
          jumpNib(x, y, activity);
          return;
        }
        const end = { x, y };
        const bow = carryBow(distance);
        let written: Point | null = null;
        const ours = (): boolean =>
          written === null ||
          (cursorViewRef.current.x === written.x && cursorViewRef.current.y === written.y);

        void animateOver(
          shapeReachMs(distance),
          (progress) => {
            if (!ours()) return;
            const eased = reachEase(progress);
            const arc = Math.sin(Math.PI * progress);
            const point = bowedPoint(start, end, eased, bow);
            hoverNib(point.x, point.y, activity, HOP_LIFT_PX * arc);
            written = { x: cursorViewRef.current.x, y: cursorViewRef.current.y };
          },
          () => !ours(),
        );
      },
      [animateOver, hoverNib, jumpNib],
    );

    const cancelAnimations = useCallback((): void => {
      Array.from(animationCleanupsRef.current).forEach((cleanup) => cleanup());
      Array.from(frameIdsRef.current).forEach((frameId) => timeSourceRef.current.cancelFrame(frameId));
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

    const tagBoardInk = useCallback((node: Konva.Node, kind: BoardInkKind): void => {
      node.setAttr(BOARD_INK_ATTR, kind);
    }, []);

    const destroyTaggedInk = useCallback((nodes: Set<Konva.Node>, kind: BoardInkKind): void => {
      nodes.forEach((node) => {
        if (node.getAttr(BOARD_INK_ATTR) === kind) {
          node.destroy();
          nodes.delete(node);
        }
      });
    }, []);

    const drawShape = useCallback(
      async (pathData: string, duration: number, options?: ShapeDrawOptions): Promise<void> => {
        const drawLayer = drawLayerRef.current;
        const animLayer = animLayerRef.current;

        if (!drawLayer || !animLayer || options?.shouldCancel?.()) {
          return;
        }

        // The figure and the scaffolding it hangs off are both pencil. The twirl
        // only plays on an actual change, and the compiler emits construction
        // ink after the structure it hangs off, so a scene picks the pencil up
        // once rather than once per stroke.
        const activity: PenActivity = options?.strokeRole === "construction" ? "sketch" : "draw";
        await equipInstrumentFor(activity);
        if (options?.shouldCancel?.()) {
          return;
        }

        // Reactive shape speed: when an audio clock is available, lean the
        // hand's speed against the lag — the same scheme writeText uses per
        // character, applied here to the whole figure. Positive lag (voice
        // ahead of the ink) hurries the hand; negative lag (ink ahead) lets it
        // linger. Eased between shapes, so a figure accelerates and slows
        // rather than switching between two speeds.
        let paceScale = 1;
        if (options?.getAudioPositionMs && typeof options.targetMs === "number") {
          const lagMs = options.getAudioPositionMs() - options.targetMs;
          paceScale = dampPaceScale(previousPaceScaleRef.current, paceScaleForLagMs(lagMs));
          previousPaceScaleRef.current = paceScale;
        }
        let effectiveDuration = duration;

        // Styled for whatever is now in hand, so a figure drawn in pencil
        // actually lands in lead rather than in the pen's ink.
        const inkStyle = styleForCommand(options?.inkSettings);
        const path = new Konva.Path(
          inkPathConfig(pathData, options?.strokeWidth ?? SHAPE_STROKE_WIDTH, inkStyle),
        );
        tagBoardInk(path, "scene");
        if (Math.abs((options?.strokeWidth ?? SHAPE_STROKE_WIDTH) - SHAPE_STROKE_WIDTH) < 0.01) {
          path.setAttr(SCENE_LEAD_ATTR, true);
        }
        const totalLength = path.getLength();

        // How long this line takes is decided by how long the line is, so every
        // shape in one figure is drawn at the same hand speed instead of each
        // being given the same millisecond budget regardless of its length.
        // A cued stroke is the exception: the voice is on it and the requested
        // time is its spoken window, so the scene ceiling is not applied (see
        // `resolveShapeDurationMs`).
        effectiveDuration = resolveShapeDurationMs({
          lengthPx: totalLength,
          requestedMs: effectiveDuration,
          minMs: SCENE_SHAPE_MIN_MS,
          sceneMaxMs: SCENE_SHAPE_MAX_MS,
          pace: options?.pace,
          cued: options?.cued,
          paceScale,
        });

        // Dashed lines are construction lines — appear instantly with a
        // brief opacity fade instead of the stroke-by-stroke reveal. A cued
        // one fades in over its spoken window like any other cued stroke.
        if (options?.dashed) {
          path.dash([6, 5]);
          path.opacity(0);
          animLayer.add(path);
          trackNode(path, animNodesRef.current);
          animLayer.batchDraw();

          const dashedFadeMs = options?.cued
            ? effectiveDuration
            : Math.min(options?.pace === "scene" ? SCENE_SHAPE_MAX_MS : duration, 300);
          await animateOver(dashedFadeMs, (progress) => {
            path.opacity(progress * inkStyle.opacity);
            const point = path.getPointAtLength(progress * totalLength);
            if (point) {
              moveNib(point.x, point.y, activity);
            }
            animLayer.batchDraw();
          });

          if (options?.shouldCancel?.()) {
            path.destroy();
            untrackNode(path, animNodesRef.current);
            animLayer.batchDraw();
            return;
          }

          path.opacity(inkStyle.opacity);
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

        // The nib has to *get* to the start of the shape. It used to simply be
        // there on the first frame of the reveal, so every stroke of a figure
        // began with the instrument appearing somewhere else on the board.
        //
        // The reach comes out of the shape's own budget, the way a glyph pays
        // for its hop: an arc that arrives late is worse than an arc drawn a
        // little faster, because the voice is already talking about it.
        const startPoint = pathSamples[0] ?? { x: 0, y: 0 };
        const reachPx = distanceBetween(cursorViewRef.current, startPoint);
        const travel = nibTravelFor(reachPx);
        const reachMs = shapeReachMs(reachPx);
        if (travel !== "settle") {
          effectiveDuration = Math.max(effectiveDuration - reachMs, SCENE_SHAPE_MIN_MS);
        }
        if (travel === "fly") {
          await flyCursorTo(startPoint.x, startPoint.y, reachMs, restingTilt(activity));
        } else if (travel === "hop") {
          await hopNib(startPoint.x, startPoint.y, reachMs, activity);
        } else {
          jumpNib(startPoint.x, startPoint.y, activity);
        }
        if (options?.shouldCancel?.()) {
          path.destroy();
          untrackNode(path, animNodesRef.current);
          animLayer.batchDraw();
          return;
        }

        const shapeVariation = handwritingVariation(pathData.length + totalLength);
        await animateOver(effectiveDuration, (progress) => {
          const drawnLength = pacedStrokeDistance(
            pathSamples,
            totalLength,
            progress,
            effectiveDuration,
            shapeVariation,
          );
          const point = pointAlongSamples(pathSamples, totalLength, drawnLength);

          path.dashOffset(totalLength - drawnLength);
          moveNib(point.x, point.y, activity);
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
      [
        animateOver,
        equipInstrumentFor,
        flyCursorTo,
        hopNib,
        jumpNib,
        moveNib,
        styleForCommand,
        tagBoardInk,
        trackNode,
        untrackNode,
      ],
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
          if (node.getAttr(SCENE_LEAD_ATTR) !== true || !node.strokeEnabled()) {
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

            const replacement = new Konva.Path({
              data: `M ${sx} ${sy} L ${ex} ${ey}`,
              stroke: node.stroke(),
              strokeWidth: node.strokeWidth(),
              opacity: node.opacity(),
              fillEnabled: false,
              lineCap: "round",
              lineJoin: "round",
              listening: false,
            });
            tagBoardInk(
              replacement,
              (node.getAttr(BOARD_INK_ATTR) as BoardInkKind | undefined) ?? "scene",
            );
            replacement.setAttr(SCENE_LEAD_ATTR, true);
            replacements.push(replacement);
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
      [tagBoardInk, trackNode],
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
          const box = mark.getClientRect();
          tagBoardInk(mark, boardInkKindAt(box.x));

          // A highlighter lays colour down *behind a moving nib*. Fading the
          // whole patch up at once is the one thing a real marker never does,
          // so the mark is wiped in left to right and the marker rides the edge.
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
          tagBoardInk(sweep, boardInkKindAt(box.x));
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
        // A gesture is made with whatever is already in hand, so it is styled
        // by that instrument too — a circle drawn round a pencilled figure is
        // in lead, not suddenly in ink.
        const path = new Konva.Path(
          inkPathConfig(
            pathData,
            strokeWidth,
            styleForCommand(options.inkSettings),
          ),
        );
        tagBoardInk(path, boardInkKindAt(path.getClientRect().x));
        const totalLength = Math.max(path.getLength(), 1);

        path.dash([totalLength]);
        path.dashOffset(totalLength);
        animLayer.add(path);
        trackNode(path, animNodesRef.current);
        animLayer.batchDraw();

        const annotationSamples = sampleKonvaPath(path, totalLength);
        const annotationVariation = handwritingVariation(pathData.length + duration);
        await animateOver(duration, (progress) => {
          const drawnLength = pacedStrokeDistance(
            annotationSamples,
            totalLength,
            progress,
            duration,
            annotationVariation,
          );
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
      [animateOver, equipInstrumentFor, moveNib, styleForCommand, tagBoardInk, trackNode, untrackNode],
    );

    const waitForAudioPosition = useCallback(
      (
        targetMs: number,
        getAudioPositionMs: () => number,
        originWallMs: number,
        getPlaybackRate?: () => number,
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
          const waitStartMs = nowMs();
          let idled = false;

          const mediaRate = (): number => {
            const fromSchedule = getPlaybackRate?.();
            const rate =
              typeof fromSchedule === "number" && Number.isFinite(fromSchedule) && fromSchedule > 0
                ? fromSchedule
                : animationSpeedRef.current;
            return Math.max(rate, 0.1);
          };

          const currentClockMs = (): number => {
            const rawPositionMs = getAudioPositionMs();
            if (rawPositionMs > 0 && rawPositionMs === lastRawPositionMs) {
              stalledFrames += 1;
            } else {
              stalledFrames = 0;
              lastRawPositionMs = rawPositionMs;
            }
            const elapsedMs = (nowMs() - originWallMs - pausedTotalMs) * mediaRate();
            const resolved = resolveWriteWaitClockMs({
              rawPositionMs,
              elapsedMediaMs: elapsedMs,
              stalledFrames,
              maxPositionMs,
            });
            maxPositionMs = resolved.maxPositionMs;
            return resolved.positionMs;
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
                pausedAt = nowMs();
              }
              stalledFrames = 0;
              frameId = requestTrackedFrame(step);
              return;
            }
            if (pausedAt !== null) {
              pausedTotalMs += nowMs() - pausedAt;
              pausedAt = null;
            }

            const positionMs = currentClockMs();
            const elapsedMs = (nowMs() - originWallMs - pausedTotalMs) * mediaRate();
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

            // The hand comes back to the board just before the voice reaches
            // this character, so writing resumes from rest instead of the pen
            // snapping out of a drift on the frame the letter falls due.
            const pose = settleWaitingPose(
              waitingPose(nowMs() - waitStartMs - pausedTotalMs),
              clamp((targetMs - positionMs) / WAIT_SETTLE_MS, 0, 1),
            );
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
          const immediate = currentClockMs();
          if (audioWaitAlreadyDue(immediate, targetMs)) {
            cleanup();
            return;
          }
          frameId = requestTrackedFrame(step);
        }),
      [cancelTrackedFrame, nowMs, requestTrackedFrame, setCursorViewSafely, settleNib],
    );

    const writeText = useCallback(
      async (
        text: string,
        x: number,
        y: number,
        duration: number,
        schedule?: WriteSchedule,
        fontSize: number = BOARD_TYPE_SCALE.label,
        shouldCancel?: () => boolean,
        inkSettings?: DrawCommandInkSettings,
      ): Promise<void> => {
        const drawLayer = drawLayerRef.current;
        const animLayer = animLayerRef.current;

        if (!drawLayer || !animLayer || shouldCancel?.()) {
          return;
        }

        const inkKind = boardInkKindAt(x);

        // Teaching prose is written with the pen. Compiler-owned diagram labels
        // are part of the sketch and are lettered with whatever is already in
        // hand — otherwise every reveal group would pay for a swap each way.
        const labelSized =
          !schedule && duration <= text.replace(/\s+/g, "").length * LETTERED_IN_HAND_MS_PER_CHAR;
        const scheduledWrite = Boolean(schedule?.charStartOffsetsMs && schedule.charStartOffsetsMs.length > 0);

        // Whatever a caller hands down, the pen only ever writes at a step on
        // the board's type scale. That is what keeps one board to a handful of
        // sizes instead of a different one on every row.
        const resolvedFontSize = snapToBoardTypeScale(
          Math.min(Math.max(fontSize, MIN_BOARD_FONT_SIZE), MAX_BOARD_FONT_SIZE),
        );

        try {
          // Paths and the instrument swap overlap so a 340 ms pen-from-pencil
          // flourish cannot eat the first spoken syllable. Scheduled rows hurry
          // the swap: the voice is already on the word.
          const pathsPromise = textToStrokePaths(text, x, y, resolvedFontSize);
          if (!labelSized) {
            await Promise.all([
              equipInstrumentFor("write", scheduledWrite),
              pathsPromise,
            ]);
            if (shouldCancel?.()) {
              return;
            }
          }

          // Read after the equip: teaching prose is always in pen, but a
          // compiler-owned label is lettered with whatever the hand is already
          // holding, so a name on a pencilled figure is written in the same lead.
          const inkStyle = styleForCommand(inkSettings);
          const characterPaths = await pathsPromise;

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
                  fill: inkStyle.color,
                  opacity: inkStyle.opacity,
                  listening: false,
                });
                tagBoardInk(textNode, inkKind);
                drawLayer.add(textNode);
                trackNode(textNode, completedNodesRef.current);
                continue;
              }
              for (const stroke of charPath.strokes) {
                const pathNode = new Konva.Path(
                  inkPathConfig(stroke.pathData, stroke.width, inkStyle),
                );
                tagBoardInk(pathNode, inkKind);
                drawLayer.add(pathNode);
                trackNode(pathNode, completedNodesRef.current);
              }
            }
            const last = charInfos.at(-1)?.charPath;
            if (last) {
              // The label is already on the board; the hand catches up to it on
              // its own time rather than appearing at the end of it.
              glideNibTo(last.x + last.width, last.y, "write");
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
          const slots = schedule?.charDurationsMs;
          const scheduleOriginMs = nowMs();
          // Scheduled glyphs are budgeted in media ms against the voice and
          // run in wall time locked to the wall clock: the schedule already
          // carries the catch-up, so the board's adaptive speed must not be
          // applied on top of it. Without a rate from the schedule the board's
          // own speed stands in (in replay that is the playback rate exactly).
          const playbackRate = (): number => {
            const rate = schedule?.getPlaybackRate?.() ?? animationSpeedRef.current;
            return Number.isFinite(rate) && rate > 0 ? rate : 1;
          };
          const scheduledPlayback = { lockToWallClock: true } as const;

          if (scheduled && offsets && audioPositionMs) {
            const firstCue = offsets[0] ?? 0;
            const firstStroke = charInfos[0]?.charPath.strokes[0];
            const approachFirstGlyph = async (): Promise<void> => {
              if (!firstStroke) {
                return;
              }
              const dist = Math.hypot(
                firstStroke.startX - cursorViewRef.current.x,
                firstStroke.startY - cursorViewRef.current.y,
              );
              const travel = nibTravelFor(dist);
              if (travel === "settle") {
                jumpNib(firstStroke.startX, firstStroke.startY, "write");
                return;
              }
              // If the word is already being said, still fly/hop — a jump
              // across the board is the "not smooth" teleport. Cap the fly so
              // a late cue cannot spend 300 ms of spoken time in the air.
              const due = audioWaitAlreadyDue(audioPositionMs(), firstCue);
              if (travel === "fly") {
                const reachMs = shapeReachMs(dist);
                await flyCursorTo(
                  firstStroke.startX,
                  firstStroke.startY,
                  due ? Math.min(reachMs, 140) : reachMs,
                  HANDWRITING_ROTATION,
                );
                return;
              }
              await hopNib(
                firstStroke.startX,
                firstStroke.startY,
                hopDurationMs(dist) / playbackRate(),
                "write",
                scheduledPlayback,
              );
            };
            await Promise.all([
              approachFirstGlyph(),
              waitForAudioPosition(firstCue, audioPositionMs, scheduleOriginMs, playbackRate),
            ]);
            if (!mountedRef.current || shouldCancel?.()) return;
          }

          const flyBudgetMs = Math.min(totalStrokes * 2, duration * 0.06);
          const drawBudgetMs = Math.max(duration - flyBudgetMs, totalStrokes * 3);
          const totalPathLength = charInfos.reduce((sum, info) => sum + info.pathLength, 0);
          const fallbackDrawMs =
            fallbackCount > 0 ? (drawBudgetMs * fallbackCount) / totalStrokes : 0;
          let previousScheduledInkMs: number | null = null;

          for (let ci = 0; ci < charInfos.length; ci++) {
            if (!mountedRef.current || shouldCancel?.()) return;

            const { charPath, pathLength, strokeLengths } = charInfos[ci];

            let charBudgetMs: number;
            // Media ms the hand stays on the glyph's last stroke after the ink,
            // when the spoken slot is longer than a glyph should take.
            let lingerMs = 0;
            if (scheduled && offsets && audioPositionMs) {
              const start = offsets[Math.min(ci, offsets.length - 1)] ?? 0;
              // Hold this character until the voice reaches its spoken moment.
              // Missing/stuck clocks fall through to wall time from this WRITE start.
              await waitForAudioPosition(start, audioPositionMs, scheduleOriginMs, playbackRate);
              if (!mountedRef.current || shouldCancel?.()) return;
              schedule?.onCharacterStart?.({
                char: charPath.char,
                index: ci,
                targetMs: start,
                audioPositionMs: audioPositionMs(),
              });
              // The slot is the character's spoken window. The schedule names
              // it directly; the gap to the next cue can only be shorter (a
              // schedule pulled forward to catch the voice compresses it), so
              // the smaller of the two is the slot the ink has to fill.
              const namedSlotMs = slots?.[ci];
              const cueGapMs = ci + 1 < offsets.length ? (offsets[ci + 1] ?? start) - start : Infinity;
              const slotMs = Math.min(
                typeof namedSlotMs === "number" && Number.isFinite(namedSlotMs) && namedSlotMs > 0
                  ? namedSlotMs
                  : Infinity,
                cueGapMs,
              );
              const lagMs = audioPositionMs() - start;
              const budget = scheduledGlyphBudgetMs({
                slotMs: Number.isFinite(slotMs) ? slotMs : GLYPH_SLOT_FALLBACK_MS,
                lagMs,
                previousMs: previousScheduledInkMs,
              });
              charBudgetMs = budget.inkMs;
              lingerMs = budget.lingerMs;
              previousScheduledInkMs = budget.inkMs;
            } else {
              const pulse =
                0.86 +
                0.28 * (0.5 + 0.5 * handwritingVariation(ci * 31 + (charPath.char.codePointAt(0) ?? 0)));
              charBudgetMs =
                charPath.strokes.length === 0
                  ? Math.max(fallbackDrawMs, 30)
                  : Math.max((pathLength / Math.max(totalPathLength, 1)) * drawBudgetMs * pulse, 3);
            }

            if (charPath.strokes.length === 0) {
              const textNode = new Konva.Text({
                text: charPath.char,
                x: charPath.x,
                y: charPath.y,
                opacity: 0,
                fontFamily: "Caveat, cursive",
                fontSize: charPath.fontSize ?? resolvedFontSize,
                fill: inkStyle.color,
                listening: false,
                perfectDrawEnabled: false,
              });
              tagBoardInk(textNode, inkKind);

              const charDuration = Math.max(charBudgetMs, 30);
              animLayer.add(textNode);
              trackNode(textNode, animNodesRef.current);
              animLayer.batchDraw();

              const fadeVariation = handwritingVariation(ci * 13 + 7);
              // A scheduled fade fills its slot the way a stroked glyph does:
              // media ms, converted to wall time, locked to the wall clock.
              const fadeTotalMs = charDuration + lingerMs;
              await animateOver(
                scheduled ? fadeTotalMs / playbackRate() : charDuration,
                (progress) => {
                  const eased = scheduled
                    ? lingeringGlyphProgress(
                        progress * fadeTotalMs,
                        charDuration,
                        lingerMs,
                        fadeVariation,
                      )
                    : handwritingProgress(progress, charDuration, fadeVariation);
                  textNode.opacity(eased * inkStyle.opacity);
                  moveNib(charPath.x + charPath.width * eased, charPath.y, "write");
                  animLayer.batchDraw();
                },
                undefined,
                scheduled ? scheduledPlayback : undefined,
              );

              if (shouldCancel?.()) {
                textNode.destroy();
                untrackNode(textNode, animNodesRef.current);
                animLayer.batchDraw();
                return;
              }

              textNode.opacity(inkStyle.opacity);
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
            if (nibTravelFor(dist) === "fly") {
              // Same reach policy as a shape: budget the speed, not a flat cap,
              // or crossing the board to the next line is a whip.
              await flyCursorTo(
                firstStroke.startX,
                firstStroke.startY,
                shapeReachMs(dist),
                HANDWRITING_ROTATION,
              );
            } else if (hopMs > 0) {
              // The hop comes out of this character's own time so the ink
              // never drifts behind the voice for the sake of a nicer arc.
              // Its length is a media budget like the glyph's, so a scheduled
              // hop is converted to wall time the same way.
              await hopNib(
                firstStroke.startX,
                firstStroke.startY,
                scheduled ? hopMs / playbackRate() : hopMs,
                "write",
                scheduled ? scheduledPlayback : undefined,
              );
              // What the hop leaves the glyph is floored at half the slot
              // floor, so a between-word carry never reduces the letter after
              // it to a stamp.
              charBudgetMs = Math.max(charBudgetMs - hopMs, scheduled ? GLYPH_SLOT_MIN_MS / 2 : 28);
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
                inkPathConfig(stroke.pathData, stroke.width, inkStyle),
              );
              tagBoardInk(pathNode, inkKind);
              // Length and samples were measured once for this path data:
              // the length when the row was planned, the samples the first
              // time this glyph was ever written on this board.
              const totalLength = Math.max(strokeLengths[si] ?? pathNode.getLength(), 1);
              pathNode.dash([totalLength]);
              pathNode.dashOffset(totalLength);
              animLayer.add(pathNode);
              trackNode(pathNode, animNodesRef.current);
              let samples = strokeSampleCacheRef.current.get(stroke.pathData);
              if (!samples) {
                samples = sampleKonvaPath(pathNode, totalLength);
                if (strokeSampleCacheRef.current.size > 4000) {
                  strokeSampleCacheRef.current.clear();
                }
                strokeSampleCacheRef.current.set(stroke.pathData, samples);
              }
              strokeNodes.push({ pathNode, totalLength, samples });
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
            // The glyph's own time map. Spending the budget by arc length
            // alone drags the nib through every bend of an 'a' at the speed it
            // crosses the stem, which is the one thing a hand never does: this
            // weights each sampled step by how tight the turn is and how close
            // it is to a pen-down or pen-up, so the letter is written rather
            // than unrolled.
            const pacing = planGlyphPacing(
              segments.map((segment) =>
                segment.kind === "ink"
                  ? { kind: "ink" as const, samples: strokeNodes[segment.stroke]!.samples }
                  : { kind: "air" as const, samples: [segment.from, segment.to] },
              ),
            );
            const glyphMs = Math.max(charBudgetMs, 36);
            const glyphVariation = handwritingVariation(
              ci * 17 + (charPath.char.codePointAt(0) ?? 0),
            );
            // A linger is spent on the last stroke only: the share of the
            // glyph's time map its final ink segment owns bounds the tail, so
            // the slow finish never reaches back into the air before it.
            const lastInkSegment = segments.length - 1;
            const lastStrokeShare =
              pacing.totalWeight > 0
                ? pacing.steps
                    .filter((step) => step.segment === lastInkSegment)
                    .reduce((sum, step) => sum + step.weight, 0) / pacing.totalWeight
                : 0;
            const glyphTotalMs = glyphMs + lingerMs;
            // Scheduled: media ms against the voice, run in wall time locked
            // to the wall clock. Unscheduled: the board's animation speed, as
            // before.
            const tweenMs = scheduled ? glyphTotalMs / playbackRate() : glyphMs;

            await animateOver(tweenMs, (progress) => {
              const eased = scheduled
                ? lingeringGlyphProgress(
                    progress * glyphTotalMs,
                    glyphMs,
                    lingerMs,
                    glyphVariation,
                    lastStrokeShare * 0.85,
                  )
                : handwritingProgress(progress, glyphMs, glyphVariation);
              const placed = pacedGlyphPosition(pacing, eased);
              const segment = segments[placed.segment]!;
              const pacedLength = Math.max(pacing.segmentLengths[placed.segment] ?? 0, 1e-6);
              for (let si = 0; si < strokeNodes.length; si++) {
                const node = strokeNodes[si]!;
                if (si < segment.stroke) {
                  node.pathNode.dashOffset(0);
                } else if (si === segment.stroke && segment.kind === "ink") {
                  // Sampled distance rescaled onto Konva's own curve length,
                  // or the tail of every stroke stays unpainted.
                  const inked = (placed.distance / pacedLength) * node.totalLength;
                  node.pathNode.dashOffset(node.totalLength - inked);
                } else {
                  node.pathNode.dashOffset(node.totalLength);
                }
              }
              if (segment.kind === "air") {
                const t = clamp(placed.distance / pacedLength, 0, 1);
                const point = bowedPoint(segment.from, segment.to, t, carryBow(pacedLength));
                hoverNib(point.x, point.y, "write", AIR_LIFT_PX * Math.sin(Math.PI * t));
              } else {
                const active = strokeNodes[segment.stroke]!;
                const point = pointAlongSamples(
                  active.samples,
                  pacedLength,
                  placed.distance,
                );
                moveNib(point.x, point.y, "write");
              }
              animLayer.batchDraw();
            }, undefined, scheduled ? scheduledPlayback : undefined);

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
          const inkStyle = styleForCommand(inkSettings);
          const textNode = new Konva.Text({
            text,
            x,
            y,
            opacity: 0,
            fontFamily: "Caveat, cursive",
            fontSize: resolvedFontSize,
            fill: inkStyle.color,
            listening: false,
          });
          tagBoardInk(textNode, inkKind);

          animLayer.add(textNode);
          trackNode(textNode, animNodesRef.current);
          // The glyph path lookup failed and this line is being faded in
          // instead of written, but the hand still has to get to the start of
          // it. Bridged like any other reposition: a fallback is still watched.
          const fallbackReach = distanceBetween(cursorViewRef.current, { x, y });
          if (nibTravelFor(fallbackReach) === "settle") {
            jumpNib(x, y, "write");
          } else {
            await flyCursorTo(x, y, shapeReachMs(fallbackReach), HANDWRITING_ROTATION);
          }
          animLayer.batchDraw();

          await animateOver(duration, (progress) => {
            textNode.opacity(progress * inkStyle.opacity);
            moveNib(x + textNode.getTextWidth() * progress, y, "write");
            animLayer.batchDraw();
          });

          if (shouldCancel?.()) {
            textNode.destroy();
            untrackNode(textNode, animNodesRef.current);
            animLayer.batchDraw();
            return;
          }

          textNode.opacity(inkStyle.opacity);
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
        glideNibTo,
        hopNib,
        hoverNib,
        jumpNib,
        moveNib,
        nowMs,
        styleForCommand,
        tagBoardInk,
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

    const eraseWorkInk = useCallback(
      async (duration: number, shouldCancel?: () => boolean): Promise<void> => {
        const drawLayer = drawLayerRef.current;
        const animLayer = animLayerRef.current;
        const cursorLayer = cursorLayerRef.current;
        const highlightLayer = highlightLayerRef.current;

        if (!drawLayer || !animLayer || !cursorLayer || shouldCancel?.()) {
          return;
        }

        // Drop every work stroke first, including glyphs that spilled past the
        // column. A geometric wipe stops at the column edge and leaves those
        // tails sitting in the figure.
        destroyTaggedInk(completedNodesRef.current, "work");
        destroyTaggedInk(animNodesRef.current, "work");
        drawLayer.batchDraw();
        animLayer.batchDraw();
        highlightLayer?.batchDraw();

        if (duration <= 0) {
          return;
        }

        const previousCursorState = activeCursorStateRef.current;
        updateCursorState("erasing");
        const x = WORK_ZONE.x;
        const y = WORK_ZONE.y;
        const regionWidth = DIAGRAM_ZONE.x - WORK_ZONE.x;
        const regionHeight = WORK_ZONE.height;
        const targetY = y + regionHeight / 2;
        await flyCursorTo(x, targetY, Math.min(duration * 0.3, 800));
        if (shouldCancel?.()) {
          updateCursorState(previousCursorState);
          return;
        }
        const sweepDuration = Math.max(duration * 0.7, 100);
        await animateOver(sweepDuration, (progress) => {
          const sweepX = x + regionWidth * progress;
          setCursorViewSafely(sweepX, targetY, 0, 1);
          cursorLayer.batchDraw();
        }, shouldCancel);
        if (!shouldCancel?.()) updateCursorState(previousCursorState);
      },
      [animateOver, destroyTaggedInk, flyCursorTo, setCursorViewSafely, updateCursorState],
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
        previousPaceScaleRef.current = null;
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
      let lastFrameMs = nowMs();
      let hold = idleHoldStart();
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
          stroke: instrumentInkStyle("pencil", inkColorRef.current, inkPreferencesRef.current).color,
          strokeWidth: SCRATCH_STROKE_WIDTH * inkPreferencesRef.current.pencilThickness,
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
        // A paused board or any real drawing work outranks the fidget, and the
        // hand has to be still for a real beat before it starts scribbling —
        // otherwise the gap between two commands is enough to send the pen off
        // to the margin and back.
        const workInFlight = isPausedRef.current || animationCleanupsRef.current.size > 0;
        const advanced = advanceIdleHold(hold, { workInFlight, nowMs: now });
        hold = advanced.state;
        if (advanced.justEngaged) {
          // Leave from where the pen actually is.
          origin = { ...cursorViewRef.current };
          anchor = { x: origin.x, y: origin.y };
          phase = "travel";
          phaseStartMs = clockMs;
        }
        if (advanced.justReleased) {
          settleNib(cursorViewRef.current.x, cursorViewRef.current.y, cursorViewRef.current.rotation);
        }
        if (advanced.engaged) {
          clockMs += delta;
          advance();
          fadeOldStrokes();
          cursorLayer.batchDraw();
        }
        frameId = requestTrackedFrame(step);
      };

      // Whatever is in hand stays in it; the fidget is a pause, not a new
      // activity, and a forced swap here read as the tutor changing its mind.
      frameId = requestTrackedFrame(step);

      return () => {
        cancelled = true;
        if (frameId !== null) cancelTrackedFrame(frameId);
        for (const entry of live) entry.node.destroy();
        live.length = 0;
        active = null;
        const view = cursorViewRef.current;
        setCursorViewSafely(view.x, view.y, view.rotation, 1);
        cursorLayer.batchDraw();
      };
    }, [
      activeCursorState,
      cancelTrackedFrame,
      height,
      moveNib,
      nib,
      nowMs,
      requestTrackedFrame,
      setCursorViewSafely,
      settleNib,
      thinkingMotion,
      width,
    ]);

    /**
     * The idle hand. Most of a lesson is narration over ink that is already up,
     * so the pen spends most of its time with nothing to draw while the voice
     * carries on. This is what it does then: `penIdle` supplies a repertoire of
     * gestures — a roll between the fingers, a tap, a bob, a drift out and
     * back, a sway, leaning off to look at the board, a loop, a jab of
     * emphasis, a jitter, and now and then the full twirl — sequenced with real
     * rests and seeded per pause, so no two pauses play the same performance.
     *
     * It used to be the twirl alone, forever, on a fixed period: a pen turning
     * in one spot for as long as the tutor was talking, which reads as a
     * loading spinner rather than a person holding a pen. Driven through the
     * cached pose nodes, never a React render per frame.
     */
    useEffect(() => {
      if (thinkingMotion !== "spin") {
        return undefined;
      }

      let cancelled = false;
      let frameId: number | null = null;
      let hold = idleHoldStart();
      let anchor = { ...cursorViewRef.current };
      let pose: IdlePose | null = null;
      let releasedAtMs: number | null = null;
      let releaseWindowMs = IDLE_RELEASE_MS;
      let written: CursorView | null = null;

      const paint = (next: IdlePose): void => {
        setCursorViewSafely(
          anchor.x + next.dx,
          anchor.y + next.dy,
          anchor.rotation + next.tiltOffset,
          next.scale,
          { spin: next.spin, lift: next.lift, spinVelocity: next.spinVelocity },
        );
        written = { ...cursorViewRef.current };
      };

      /**
       * True while the pose on screen is still the one this effect painted.
       * The release ease-out below has to stop the instant real work claims the
       * cursor, or the fidget would fight the stroke for the pen.
       */
      const stillOurs = (): boolean => {
        if (!written) return false;
        const view = cursorViewRef.current;
        return (
          view.x === written.x &&
          view.y === written.y &&
          view.rotation === written.rotation &&
          view.scale === written.scale &&
          view.spin === written.spin &&
          view.lift === written.lift
        );
      };

      const step = (now: number): void => {
        if (cancelled) return;
        // A paused board or any real drawing work outranks the fidget, and both
        // count as work in flight, so the hold has to be re-earned afterwards
        // rather than resuming the instant a tween ends.
        //
        // So does a state the hand has no business playing in. That is read
        // here rather than gating the effect, because tearing the effect down
        // mid-gesture ran its cleanup, and the cleanup wrote the instrument
        // back to rest on that single frame: a twirl caught at 180° snapped,
        // and a lifted nib dropped. Handled as work in flight instead, the
        // same release ease that covers a stroke arriving covers this too.
        const state = activeCursorStateRef.current;
        const workInFlight =
          !IDLE_ELIGIBLE_STATES.includes(state) ||
          isPausedRef.current ||
          animationCleanupsRef.current.size > 0;
        const advanced = advanceIdleHold(hold, { workInFlight, nowMs: now });
        hold = advanced.state;

        if (advanced.justEngaged) {
          // Play with the pen where the pen *is*. This used to anchor once, when
          // the board entered `thinking` — which is the top of a live turn, not
          // a pause in it — so any gap between two commands snatched the
          // instrument back across the board and spun it there.
          anchor = { ...cursorViewRef.current };
          // Seeded per pause, so the gesture order, the moods and the
          // handedness are different every time the hand goes idle in a lesson.
          idlePauseRef.current += 1;
          releasedAtMs = null;
        }
        if (advanced.justReleased) {
          // Work arrives mid-gesture, which is the normal case. Rather than
          // snap the pose away on that frame, the hand puts the instrument down
          // over the next few — finishing a turn instead of unwinding it — and
          // yields the moment the stroke itself writes the cursor. A stunt can
          // be caught with the pen well off the board, so the window it is
          // given opens with how far it has to come back.
          if (pose) {
            releasedAtMs = now;
            releaseWindowMs = idleReleaseMs(pose);
          } else {
            releasedAtMs = null;
            settleNib(anchor.x, anchor.y, anchor.rotation);
          }
        }
        if (advanced.engaged) {
          pose = idlePose(advanced.heldMs, idlePauseRef.current, {
            stunts: markerStuntsRef.current,
          });
          paint(pose);
        } else if (releasedAtMs !== null && pose) {
          if (!stillOurs()) {
            releasedAtMs = null;
            pose = null;
          } else {
            const k = 1 - clamp((now - releasedAtMs) / releaseWindowMs, 0, 1);
            paint(releaseIdlePose(pose, k));
            if (k <= 0) {
              releasedAtMs = null;
              pose = null;
              settleNib(anchor.x, anchor.y, anchor.rotation);
            }
          }
        }
        frameId = requestTrackedFrame(step);
      };

      // Whatever the hand is holding stays in it. Forcing a swap to the pen
      // here meant a pause in the middle of a figure put the pencil down for
      // no reason and picked it straight back up on the next stroke.
      frameId = requestTrackedFrame(step);

      return () => {
        cancelled = true;
        if (frameId !== null) cancelTrackedFrame(frameId);
        // The instrument is left exactly where it stands. This used to write
        // `scale 1` with no pose, which is a hard reset of spin, lift, scale
        // and fade on the unmount frame.
        const view = cursorViewRef.current;
        setCursorViewSafely(view.x, view.y, view.rotation, view.scale, {
          spin: view.spin,
          lift: view.lift,
          fade: view.fade,
          flatten: view.flatten,
          spinVelocity: view.spinVelocity,
        });
      };
    }, [cancelTrackedFrame, nowMs, requestTrackedFrame, setCursorViewSafely, settleNib, thinkingMotion]);

    useLayoutEffect(() => {
      const view = cursorViewRef.current;
      // The instrument art was re-created, so the cached lift/spin nodes are stale.
      poseNodesRef.current = { group: null, lift: null, spin: null, ghosts: [] };
      setCursorViewSafely(view.x, view.y, view.rotation, view.scale, {
        spin: view.spin,
        lift: view.lift,
        fade: view.fade,
        flatten: view.flatten,
        spinVelocity: view.spinVelocity,
      });
    }, [activeCursorState, activeInstrument, setCursorViewSafely]);

    useEffect(() => {
      activeCursorStateRef.current = cursorState;
      setActiveCursorState(cursorState);
    }, [cursorState]);

    /**
     * Ease the instrument toward whatever the new state asks for: how visible
     * it is, and which of the two things in the hand is showing.
     *
     * Nothing else about the pose moves — it fades where it stands, so a state
     * change never relocates the marker — and nothing here ever writes a
     * visibility straight from the step function. Both targets are approached
     * at a frame-rate-independent rate, so a wipe that starts and a state that
     * changes on the same frame still read as one hand.
     */
    useEffect(() => {
      const alphaTarget = cursorOpacity(activeCursorState);
      const blendTarget = activeCursorState === "erasing" ? 1 : 0;
      const settled = (): boolean =>
        Math.abs(stateOpacityRef.current - alphaTarget) < 1e-3 &&
        Math.abs(eraserBlendRef.current - blendTarget) < 1e-3;

      if (settled()) {
        stateOpacityRef.current = alphaTarget;
        eraserBlendRef.current = blendTarget;
        paintCursorAlpha();
        cursorLayerRef.current?.batchDraw();
        return undefined;
      }

      let cancelled = false;
      let frameId: number | null = null;
      let lastMs = nowMs();

      const step = (now: number): void => {
        if (cancelled) return;
        const delta = Math.min(Math.max(now - lastMs, 0), MAX_FRAME_DT_MS);
        lastMs = now;

        const alphaK = approachFraction(delta, CURSOR_FADE_TIME_CONSTANT_MS);
        const nextAlpha =
          stateOpacityRef.current + (alphaTarget - stateOpacityRef.current) * alphaK;
        stateOpacityRef.current = Math.abs(nextAlpha - alphaTarget) < 1e-3 ? alphaTarget : nextAlpha;

        const blendK = approachFraction(delta, ERASER_BLEND_TIME_CONSTANT_MS);
        const nextBlend = eraserBlendRef.current + (blendTarget - eraserBlendRef.current) * blendK;
        eraserBlendRef.current = Math.abs(nextBlend - blendTarget) < 1e-3 ? blendTarget : nextBlend;

        paintCursorAlpha();
        cursorLayerRef.current?.batchDraw();

        if (!settled()) {
          frameId = requestTrackedFrame(step);
        }
      };

      frameId = requestTrackedFrame(step);
      return () => {
        cancelled = true;
        if (frameId !== null) cancelTrackedFrame(frameId);
      };
    }, [
      activeCursorState,
      cancelTrackedFrame,
      nowMs,
      paintCursorAlpha,
      requestTrackedFrame,
    ]);

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
          Array.from(frameIds).forEach((frameId) => timeSourceRef.current.cancelFrame(frameId));
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
        eraseWorkInk,
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
          const hideCursor = shouldHideCursorForCapture("snapshot");
          const cursorWasVisible = cursorLayer ? cursorLayer.visible() : false;
          if (cursorLayer && hideCursor) {
            cursorLayer.visible(false);
          }
          try {
            return stage.toDataURL({ pixelRatio });
          } finally {
            if (cursorLayer && hideCursor) {
              cursorLayer.visible(cursorWasVisible);
            }
          }
        },
        captureFrame: (options?: CaptureFrameOptions): HTMLCanvasElement | null => {
          const drawLayer = drawLayerRef.current;
          const cursorLayer = cursorLayerRef.current;
          if (!drawLayer) {
            return null;
          }
          const stage = drawLayer.getStage();
          if (!stage) {
            return null;
          }
          const pixelRatio = options?.pixelRatio ?? 1;
          const hideCursor = shouldHideCursorForCapture("frame", options?.hideCursor);
          const cursorWasVisible = cursorLayer ? cursorLayer.visible() : false;
          if (cursorLayer && hideCursor) {
            cursorLayer.visible(false);
          }
          try {
            return stage.toCanvas({ pixelRatio });
          } finally {
            if (cursorLayer && hideCursor) {
              cursorLayer.visible(cursorWasVisible);
            }
          }
        },
        setTimeSource: (source: WhiteboardTimeSource | null) => {
          timeSourceRef.current = source ?? DEFAULT_WHITEBOARD_TIME_SOURCE;
        },
        getInkSettings,
      }),
      [abortDrawTransaction, beginDrawTransaction, cancelAnimations, clearBoard, commitDrawTransaction, drawAnnotation, drawShape, eraseRegion, eraseWorkInk, finishAbortedDrawTransaction, flourishPen, flyCursorTo, getInkSettings, punchDiagramLineGapsInRect, setCursorViewSafely, setSpotlight, swapInstrument, updateCursorState, writeText],
    );

    return (
      <Stage
        width={width}
        height={height}
        pixelRatio={pixelRatioRef.current}
        style={{ backgroundColor: WHITEBOARD_COLOR, display: "block" }}
        perfectDrawEnabled={false}
      >
        <Layer listening={false} perfectDrawEnabled={false}>
          <Rect
            x={0}
            y={0}
            width={width}
            height={height}
            fill={WHITEBOARD_COLOR}
            listening={false}
            perfectDrawEnabled={false}
          />
        </Layer>
        <Layer ref={highlightLayerRef} listening={false} perfectDrawEnabled={false} />
        <Layer ref={drawLayerRef} listening={false} perfectDrawEnabled={false} />
        <Layer ref={animLayerRef} listening={false} perfectDrawEnabled={false}>
          <KonvaPath data={HIDDEN_PATH_DATA} visible={false} listening={false} />
        </Layer>
        <Layer ref={spotlightLayerRef} listening={false} perfectDrawEnabled={false} />
        {/*
          Both the marker and the eraser are mounted for the whole life of the
          board, and `paintCursorAlpha` crossfades between them. They used to be
          a React branch on `erasing`: the marker was destroyed and a block
          created in its place, then the reverse when the wipe finished — two
          hard pops per erase, and the imperative fade had nothing to fade.

          Neither node reads `cursorOpacity` here. That is a step function whose
          `idle` is 0, so a render mid-fade snapped the marker to the step and,
          at `idle`, hid it outright. Visibility is the eased value or nothing.
        */}
        <Layer ref={cursorLayerRef} listening={false} perfectDrawEnabled={false}>
          <VirtualCursor
            ref={cursorGroupRef}
            x={cursorViewRef.current.x}
            y={cursorViewRef.current.y}
            rotation={cursorViewRef.current.rotation}
            spin={cursorViewRef.current.spin}
            lift={cursorViewRef.current.lift}
            scale={cursorViewRef.current.scale}
            color={activeInstrument === "highlighter" ? HIGHLIGHT_FILL : activeInstrument === "pencil" ? pencilColor : inkColor}
            instrument={activeInstrument}
            visible={cursorAlphaRef.current.pen > CURSOR_ALPHA_EPSILON}
            opacity={cursorAlphaRef.current.pen}
            glowRadius={activeCursorState === "drawing" ? 8 : 6}
          />
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
            visible={cursorAlphaRef.current.duster > CURSOR_ALPHA_EPSILON}
            opacity={cursorAlphaRef.current.duster}
            shadowColor="#999999"
            shadowBlur={10}
            shadowOpacity={0.4}
            listening={false}
            perfectDrawEnabled={false}
          />
        </Layer>
      </Stage>
    );
  },
);
