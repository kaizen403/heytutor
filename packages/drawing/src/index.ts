export * from "./drawingProtocol";
export * from "./incrementalParser";
export * from "./shapePaths";
export * from "./handwriting";
export * from "./alignmentCheck";
export * from "./lessonPlanner";
export * from "./boardZones";
export * from "./commandPlacement";
export * from "./templates/registry";
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
