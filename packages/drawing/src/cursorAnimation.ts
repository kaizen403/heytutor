export interface Point {
  x: number;
  y: number;
}

export interface BezierAnimationOptions {
  start: Point;
  end: Point;
  duration: number;
  onFrame: (pos: Point, rotation: number, scale: number) => void;
  onComplete?: () => void;
}

export interface PathFollowOptions {
  pathData: string;
  duration: number;
  onFrame: (pos: Point, progress: number) => void;
  onComplete?: () => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_ORIGIN: Point = { x: 0, y: 0 };

function createPathElement(pathData: string): SVGPathElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pathData);
  return path;
}

function clampProgress(progress: number): number {
  return Math.min(Math.max(progress, 0), 1);
}

export function animateBezierArc({
  start,
  end,
  duration,
  onFrame,
  onComplete,
}: BezierAnimationOptions): { cancel: () => void } {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const distance = Math.hypot(deltaX, deltaY);
  const midPoint: Point = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
  const arcHeight = Math.min(distance * 0.2, 80);
  const controlPoint: Point = {
    x: midPoint.x,
    y: midPoint.y - arcHeight,
  };
  const startTime = performance.now();
  const safeDuration = Math.max(duration, 0);
  let frameId: number | null = null;
  let cancelled = false;

  const tick = (time: number) => {
    if (cancelled) {
      return;
    }

    const linearProgress = safeDuration === 0 ? 1 : clampProgress((time - startTime) / safeDuration);
    const t = linearProgress * linearProgress * (3 - 2 * linearProgress);
    const oneMinusT = 1 - t;

    const pos: Point = {
      x:
        oneMinusT * oneMinusT * start.x +
        2 * oneMinusT * t * controlPoint.x +
        t * t * end.x,
      y:
        oneMinusT * oneMinusT * start.y +
        2 * oneMinusT * t * controlPoint.y +
        t * t * end.y,
    };
    const tangentX =
      2 * oneMinusT * (controlPoint.x - start.x) +
      2 * t * (end.x - controlPoint.x);
    const tangentY =
      2 * oneMinusT * (controlPoint.y - start.y) +
      2 * t * (end.y - controlPoint.y);
    const rotation = Math.atan2(tangentY, tangentX) * (180 / Math.PI) + 90;
    const scale = 1 + Math.sin(linearProgress * Math.PI) * 0.3;

    onFrame(pos, rotation, scale);

    if (linearProgress >= 1) {
      onComplete?.();
      return;
    }

    frameId = requestAnimationFrame(tick);
  };

  frameId = requestAnimationFrame(tick);

  return {
    cancel: () => {
      cancelled = true;
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    },
  };
}

export function getPointAtLength(pathData: string, distance: number): Point {
  const path = createPathElement(pathData);

  if (!path) {
    return DEFAULT_ORIGIN;
  }

  const totalLength = path.getTotalLength();
  const point = path.getPointAtLength(Math.min(Math.max(distance, 0), totalLength));

  return { x: point.x, y: point.y };
}

export function getPathLength(pathData: string): number {
  const path = createPathElement(pathData);
  return path?.getTotalLength() ?? 0;
}

export function animateAlongPath({
  pathData,
  duration,
  onFrame,
  onComplete,
}: PathFollowOptions): { cancel: () => void } {
  const totalLength = getPathLength(pathData);
  const startTime = performance.now();
  const safeDuration = Math.max(duration, 0);
  let frameId: number | null = null;
  let cancelled = false;

  const tick = (time: number) => {
    if (cancelled) {
      return;
    }

    const progress = safeDuration === 0 ? 1 : clampProgress((time - startTime) / safeDuration);
    const point = getPointAtLength(pathData, progress * totalLength);

    onFrame(point, progress);

    if (progress >= 1) {
      onComplete?.();
      return;
    }

    frameId = requestAnimationFrame(tick);
  };

  frameId = requestAnimationFrame(tick);

  return {
    cancel: () => {
      cancelled = true;
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    },
  };
}
