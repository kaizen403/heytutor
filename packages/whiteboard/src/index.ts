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
  instrumentMetrics,
  instrumentPalette,
  type InstrumentKind,
  type InstrumentMetrics,
  type InstrumentPalette,
  type PenActivity,
} from "./instruments";
export {
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
  IDLE_RELEASE_MS,
  idleGestureAt,
  idleGestureSequence,
  idleMood,
  idlePose,
  releaseIdlePose,
  type IdleGesture,
  type IdleGestureKind,
  type IdleMood,
  type IdlePose,
} from "./penIdle";
export { PenSpinner, type PenSpinnerProps } from "./PenSpinner";
export { SpeakingWaveform } from "./SpeakingWaveform";
export { ThinkingSpinner } from "./ThinkingSpinner";
