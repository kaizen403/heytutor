export * from "./protocol/drawingProtocol";
export { unwrapMathMarkup } from "./protocol/mathMarkup";
export * from "./protocol/incrementalParser";
export * from "./handwriting/shapePaths";
export * from "./handwriting/handwriting";
export * from "./protocol/alignmentCheck";
export * from "./layout/lessonPlanner";
export * from "./protocol/verifiedDiagram";
export * from "./protocol/referencePicture";
export {
  admitReferencePictureCommand,
  REFERENCE_PICTURE_ENTITY_ID,
  isBlockedVerifiedDiagramCommand,
  prepareVerifiedLessonSegments,
  foldWritelessFocusRuns,
  createWritelessFocusFolder,
  isDevanagariWrite,
  spokenFocusTarget,
  anchorToTextRect,
  resolveVerifiedDiagramFocusTarget,
  type BoardTextRect,
  type PreparedVerifiedSegments,
} from "./protocol/commandPlacement";
export {
  parseFocusSpec,
  parseWorkRowSelector,
  resolveWorkAreaRow,
  resolveVerifiedDiagramFocusTargets,
  focusEmphasisOf,
  takeDeferredAnnotations,
  remainingDeferredAnnotations,
  peekDeferredAnnotation,
  acknowledgeDeferredAnnotation,
  hitTestVerifiedAnchor,
  type FocusEmphasis,
  type SemanticFocusSpec,
  type WorkRowSelector,
  type WorkAreaRow,
} from "./protocol/semanticGesture";
export { BOARD_CANVAS, DIAGRAM_ZONE, WORK_ZONE, SECOND_WORK_ZONE, clampToDiagramZone, isInDiagramZone } from "./layout/boardZones";
export * from "./layout/boardTypography";
export {
  createScheduledWriteClock,
  resolveScheduledWriteClockMs,
  resolveWriteWaitClockMs,
  shouldReleaseAudioPositionWait,
  simulateScheduledWriteWait,
  WRITE_CLOCK_STALL_FRAMES,
  type ScheduledWriteClockInput,
  type SimulatedWriteWaitResult,
} from "./sync/writeAudioClock";
export { scheduleFrame, cancelFrame } from "./sync/scheduleFrame";
