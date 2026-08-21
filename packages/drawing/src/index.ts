export * from "./protocol/drawingProtocol";
export * from "./protocol/incrementalParser";
export * from "./handwriting/shapePaths";
export * from "./handwriting/handwriting";
export * from "./protocol/alignmentCheck";
export * from "./layout/lessonPlanner";
export * from "./protocol/verifiedDiagram";
export {
  isBlockedVerifiedDiagramCommand,
  prepareVerifiedLessonSegments,
  spokenFocusTarget,
  anchorToTextRect,
  resolveVerifiedDiagramFocusTarget,
  type BoardTextRect,
  type PreparedVerifiedSegments,
} from "./protocol/commandPlacement";
export { BOARD_CANVAS, DIAGRAM_ZONE, WORK_ZONE, SECOND_WORK_ZONE, clampToDiagramZone, isInDiagramZone } from "./layout/boardZones";
export {
  animateStroke,
  animateRoughStroke,
  type CancellableAnimation,
  type StrokeAnimationOptions,
  type RoughAnimationOptions,
} from "./animation/strokeAnimation";
export {
  getPathLength,
  getPointAtLength,
  animateBezierArc,
  animateAlongPath,
  type Point,
  type BezierAnimationOptions,
  type PathFollowOptions,
} from "./animation/cursorAnimation";
