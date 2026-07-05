export * from "./drawingProtocol";
export * from "./incrementalParser";
export * from "./shapePaths";
export * from "./handwriting";
export * from "./alignmentCheck";
export * from "./lessonPlanner";
export * from "./templates/registry";
export {
  isBlockedTemplateDiagramDraw,
  isDuplicateTemplateDraw,
  prepareTemplateLessonSegments,
  repairDiagramCommand,
  snapLabelToTemplateAnchor,
  resolveAnnotationWithAnchors,
  anchorToTextRect,
  type BoardTextRect,
  type PreparedTemplateSegments,
} from "./commandPlacement";
export { collectTemplateSnapPoints, snapGeometryCommand, snapPointToTemplate } from "./geometrySnap";
export { BOARD_CANVAS, DIAGRAM_ZONE, WORK_ZONE, SECOND_WORK_ZONE, clampToDiagramZone, isInDiagramZone } from "./boardZones";
export { DIAGRAM_MARKING_GUIDANCE } from "./templates/annotationGuidance";
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
