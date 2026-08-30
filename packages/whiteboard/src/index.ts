export {
  Whiteboard,
  type WhiteboardHandle,
  type WhiteboardProps,
  type WriteSchedule,
  type AnnotationKind,
  type AnnotationOptions,
  type ShapeDrawOptions,
} from "./Whiteboard";
export { cursorOpacity, type CursorState } from "./cursorState";
export {
  INSTANT_LABEL_MS_PER_CHAR,
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
export { PenSpinner, type PenSpinnerProps } from "./PenSpinner";
export { SpeakingWaveform } from "./SpeakingWaveform";
export { ThinkingSpinner } from "./ThinkingSpinner";
