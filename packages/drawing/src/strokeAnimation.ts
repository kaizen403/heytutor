import type { Drawable, Op } from "roughjs/bin/core";

import { createPathElement } from "./shapePaths";

export interface Point {
  x: number;
  y: number;
}

export interface CancellableAnimation {
  cancel: () => void;
}

export interface StrokeAnimationOptions {
  pathData: string;
  duration: number;
  strokeWidth?: number;
  strokeColor?: string;
  onProgress?: (progress: number, cursorPos: Point) => void;
  onComplete?: () => void;
}

export interface RoughAnimationOptions {
  drawable: Drawable;
  ctx: CanvasRenderingContext2D;
  duration: number;
  onProgress?: (progress: number, cursorPos: Point) => void;
  onComplete?: () => void;
}

const DEFAULT_STROKE_WIDTH = 2;
const DEFAULT_STROKE_COLOR = "#333333";

function clampProgress(progress: number): number {
  return Math.min(Math.max(progress, 0), 1);
}

function animationProgress(startTime: number, duration: number, now: number): number {
  if (duration <= 0) {
    return 1;
  }

  return clampProgress((now - startTime) / duration);
}

function lastPointForOp(op: Op, fallback: Point): Point {
  if (op.op === "move" || op.op === "lineTo") {
    return { x: op.data[0] ?? fallback.x, y: op.data[1] ?? fallback.y };
  }

  return { x: op.data[4] ?? fallback.x, y: op.data[5] ?? fallback.y };
}

function drawRoughOps(ctx: CanvasRenderingContext2D, ops: Op[], endIndex: number): Point {
  let cursorPos: Point = { x: 0, y: 0 };

  ctx.beginPath();

  for (let index = 0; index < endIndex; index += 1) {
    const op = ops[index];

    if (!op) {
      continue;
    }

    if (op.op === "move") {
      const [x = cursorPos.x, y = cursorPos.y] = op.data;
      ctx.moveTo(x, y);
    } else if (op.op === "lineTo") {
      const [x = cursorPos.x, y = cursorPos.y] = op.data;
      ctx.lineTo(x, y);
    } else {
      const [cp1x = cursorPos.x, cp1y = cursorPos.y, cp2x = cursorPos.x, cp2y = cursorPos.y, x = cursorPos.x, y = cursorPos.y] = op.data;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
    }

    cursorPos = lastPointForOp(op, cursorPos);
  }

  ctx.stroke();
  return cursorPos;
}

/**
 * Animate SVG path progress with the same dash technique used by Konva paths.
 * The returned SVGPathElement is intentionally offscreen: callers receive frame
 * progress and cursor coordinates so they can mirror dash values onto Konva.
 */
export function animateStroke(options: StrokeAnimationOptions): CancellableAnimation {
  const {
    pathData,
    duration,
    strokeWidth = DEFAULT_STROKE_WIDTH,
    strokeColor = DEFAULT_STROKE_COLOR,
    onProgress,
    onComplete,
  } = options;
  const pathEl = createPathElement(pathData);
  const totalLength = pathEl.getTotalLength();
  let frameId: number | null = null;
  let startTime: number | null = null;
  let cancelled = false;

  pathEl.style.stroke = strokeColor;
  pathEl.style.strokeWidth = `${strokeWidth}`;
  pathEl.style.strokeDasharray = `${totalLength}`;
  pathEl.style.strokeDashoffset = `${totalLength}`;

  const finish = (): void => {
    const point = pathEl.getPointAtLength(totalLength);
    pathEl.style.strokeDashoffset = "0";
    onProgress?.(1, { x: point.x, y: point.y });
    onComplete?.();
  };

  const step = (now: number): void => {
    if (cancelled) {
      return;
    }

    startTime ??= now;
    const progress = animationProgress(startTime, duration, now);
    const drawnLength = progress * totalLength;
    const point = pathEl.getPointAtLength(drawnLength);

    pathEl.style.strokeDashoffset = `${totalLength - drawnLength}`;
    onProgress?.(progress, { x: point.x, y: point.y });

    if (progress < 1) {
      frameId = requestAnimationFrame(step);
      return;
    }

    finish();
  };

  frameId = requestAnimationFrame(step);

  return {
    cancel: () => {
      cancelled = true;
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    },
  };
}

/**
 * Animate Rough.js drawing operations by progressively replaying the op list.
 * Rough paths are not length-addressable, so op count is the timeline and the
 * cursor follows each operation endpoint as lines and bezier curves appear.
 */
export function animateRoughStroke(options: RoughAnimationOptions): CancellableAnimation {
  const { drawable, ctx, duration, onProgress, onComplete } = options;
  const ops = drawable.sets.flatMap((set) => set.ops);
  const totalOps = ops.length;
  let frameId: number | null = null;
  let startTime: number | null = null;
  let cancelled = false;

  ctx.strokeStyle = drawable.options.stroke ?? DEFAULT_STROKE_COLOR;
  ctx.lineWidth = drawable.options.strokeWidth ?? DEFAULT_STROKE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const renderFrame = (progress: number): Point => {
    const currentOpIndex = Math.min(Math.ceil(progress * totalOps), totalOps);

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    return drawRoughOps(ctx, ops, currentOpIndex);
  };

  const complete = (): void => {
    const cursorPos = renderFrame(1);
    onProgress?.(1, cursorPos);
    onComplete?.();
  };

  if (totalOps === 0) {
    frameId = requestAnimationFrame(() => {
      if (!cancelled) {
        onProgress?.(1, { x: 0, y: 0 });
        onComplete?.();
      }
    });

    return {
      cancel: () => {
        cancelled = true;
        if (frameId !== null) {
          cancelAnimationFrame(frameId);
        }
      },
    };
  }

  const step = (now: number): void => {
    if (cancelled) {
      return;
    }

    startTime ??= now;
    const progress = animationProgress(startTime, duration, now);
    const cursorPos = renderFrame(progress);

    onProgress?.(progress, cursorPos);

    if (progress < 1) {
      frameId = requestAnimationFrame(step);
      return;
    }

    complete();
  };

  frameId = requestAnimationFrame(step);

  return {
    cancel: () => {
      cancelled = true;
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    },
  };
}
