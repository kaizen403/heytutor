export {
  Whiteboard,
  WHITEBOARD_COLOR,
  LETTERED_IN_HAND_MS_PER_CHAR,
  type WhiteboardHandle,
  type WhiteboardProps,
  type WriteSchedule,
  type AnnotationKind,
  type AnnotationOptions,
  type ShapeDrawOptions,
} from "./Whiteboard";
export { BOARD_INK_ATTR, boardInkKindAt, type BoardInkKind } from "./inkKind";
export {
  createVirtualWhiteboardClock,
  DEFAULT_WHITEBOARD_TIME_SOURCE,
  shouldHideCursorForCapture,
  type BoardCaptureKind,
  type CaptureFrameOptions,
  type VirtualWhiteboardClock,
  type WhiteboardTimeSource,
} from "./whiteboardClock";
export { cursorOpacity, type CursorState } from "./cursorState";
export {
  INSTANT_LABEL_MS_PER_CHAR,
  advanceSpeedAwareProgress,
  writeUsesStrokePenMotion,
} from "./penMotion";
export { DrawTransactionRegistry, type DrawTransactionNode } from "./drawTransactionRegistry";
export { VirtualCursor, type VirtualCursorProps } from "./VirtualCursor";
export {
  instrumentForActivity,
  instrumentInkStyle,
  INK_THICKNESS_MIN,
  INK_THICKNESS_MAX,
  INK_THICKNESS_STEP,
  DEFAULT_INK_THICKNESS,
  instrumentMetrics,
  instrumentPalette,
  instrumentShapes,
  type InstrumentKind,
  type InkStylePreferences,
  type InstrumentMetrics,
  type InstrumentPalette,
  type InstrumentShape,
  type PenActivity,
} from "./instruments";
export {
  CURSOR_ALPHA_EPSILON,
  CURSOR_FADE_TIME_CONSTANT_MS,
  ERASER_BLEND_TIME_CONSTANT_MS,
  approachFraction,
  RESTING_TILT,
  SPIN_PERIOD_MS,
  flourishPose,
  instrumentSwapPose,
  restingTilt,
  spinningPose,
  thinkingPose,
  type InstrumentPose,
  type SpinningPose,
  type ThinkingPose,
} from "./penChoreography";
export {
  IDLE_GESTURE_KINDS,
  IDLE_RELEASE_MAX_MS,
  IDLE_RELEASE_MS,
  idleGestureAt,
  idleGestureSequence,
  idleMood,
  idlePose,
  idleReleaseMs,
  performanceDurationMs,
  releaseIdlePose,
  type IdleGesture,
  type IdleGestureKind,
  type IdleMood,
  type IdleOptions,
  type IdlePerformanceKind,
  type IdlePose,
} from "./penIdle";
export {
  STUNT_COPY,
  STUNT_KINDS,
  STUNT_LIFT_MAX_PX,
  STUNT_MS,
  STUNT_TRAVEL_MAX_PX,
  isStuntKind,
  parseStuntKinds,
  serializeStuntKinds,
  stuntFrame,
  type StuntCopy,
  type StuntFrame,
  type StuntKind,
} from "./penStunts";
export { MarkerStuntPreview, type MarkerStuntPreviewProps } from "./MarkerStuntPreview";
export { PenSpinner, type PenSpinnerProps } from "./PenSpinner";
export { SpeakingWaveform } from "./SpeakingWaveform";
export { ThinkingSpinner } from "./ThinkingSpinner";
