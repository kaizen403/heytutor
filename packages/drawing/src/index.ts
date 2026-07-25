export * from "./drawingProtocol";
export * from "./incrementalParser";
export * from "./shapePaths";
export * from "./handwriting";
export * from "./alignmentCheck";
export * from "./lessonPlanner";
export * from "./verifiedDiagram";
export {
  isBlockedVerifiedDiagramCommand,
  prepareVerifiedLessonSegments,
  anchorToTextRect,
  resolveVerifiedDiagramFocusTarget,
  type BoardTextRect,
  type PreparedVerifiedSegments,
} from "./commandPlacement";
export { BOARD_CANVAS, DIAGRAM_ZONE, WORK_ZONE, SECOND_WORK_ZONE, clampToDiagramZone, isInDiagramZone } from "./boardZones";
export {
  animateStroke,
  animateRoughStroke,
  type CancellableAnimation,
  type StrokeAnimationOptions,
  type RoughAnimationOptions,
} from "./strokeAnimation";
export {
  getPathLength,
  getPointAtLength,
  animateBezierArc,
  animateAlongPath,
  type Point,
  type BezierAnimationOptions,
  type PathFollowOptions,
} from "./cursorAnimation";
