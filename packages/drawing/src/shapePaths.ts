const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * Format a numeric coordinate for compact, stable SVG path output.
 * Keeping a few decimals is enough for canvas drawing and path measuring.
 */
function coord(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid SVG path coordinate: ${value}`);
  }

  return Number.parseFloat(value.toFixed(3)).toString();
}

/**
 * Generate a cuboid (3D box) as a single SVG path string.
 *
 * Drawing order intentionally matches how a teacher would sketch the shape:
 * front face, four depth edges, then the visible back face. Separate `M`
 * commands keep every segment measurable while preserving stroke animation
 * order for `stroke-dashoffset` based drawing.
 */
export function cuboidPath(
  x: number,
  y: number,
  width: number,
  height: number,
  depth: number,
): string {
  const x2 = x + width;
  const y2 = y + height;
  const dx = x + depth;
  const dy = y - depth;
  const dx2 = x2 + depth;
  const dy2 = y2 - depth;

  return [
    `M ${coord(x)} ${coord(y)}`,
    `L ${coord(x2)} ${coord(y)}`,
    `L ${coord(x2)} ${coord(y2)}`,
    `L ${coord(x)} ${coord(y2)}`,
    "Z",
    `M ${coord(x)} ${coord(y)}`,
    `L ${coord(dx)} ${coord(dy)}`,
    `M ${coord(x2)} ${coord(y)}`,
    `L ${coord(dx2)} ${coord(dy)}`,
    `M ${coord(x2)} ${coord(y2)}`,
    `L ${coord(dx2)} ${coord(dy2)}`,
    `M ${coord(x)} ${coord(y2)}`,
    `L ${coord(dx)} ${coord(dy2)}`,
    `M ${coord(dx)} ${coord(dy)}`,
    `L ${coord(dx2)} ${coord(dy)}`,
    `L ${coord(dx2)} ${coord(dy2)}`,
    `L ${coord(dx)} ${coord(dy2)}`,
    "Z",
  ].join(" ");
}

/** Generate an isometric cube using a half-size depth offset. */
export function cubePath(x: number, y: number, size: number): string {
  return cuboidPath(x, y, size, size, size * 0.5);
}

/** Generate a closed 2D rectangle path. */
export function rectPath(
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  return [
    `M ${coord(x)} ${coord(y)}`,
    `L ${coord(x + width)} ${coord(y)}`,
    `L ${coord(x + width)} ${coord(y + height)}`,
    `L ${coord(x)} ${coord(y + height)}`,
    "Z",
  ].join(" ");
}

/**
 * Generate a circle approximated by four cubic bezier curves.
 * The kappa constant minimizes visual error for circular arcs.
 */
export function circlePath(cx: number, cy: number, radius: number): string {
  const kappa = 0.552284749831;
  const control = radius * kappa;

  return [
    `M ${coord(cx + radius)} ${coord(cy)}`,
    `C ${coord(cx + radius)} ${coord(cy + control)} ${coord(cx + control)} ${coord(cy + radius)} ${coord(cx)} ${coord(cy + radius)}`,
    `C ${coord(cx - control)} ${coord(cy + radius)} ${coord(cx - radius)} ${coord(cy + control)} ${coord(cx - radius)} ${coord(cy)}`,
    `C ${coord(cx - radius)} ${coord(cy - control)} ${coord(cx - control)} ${coord(cy - radius)} ${coord(cx)} ${coord(cy - radius)}`,
    `C ${coord(cx + control)} ${coord(cy - radius)} ${coord(cx + radius)} ${coord(cy - control)} ${coord(cx + radius)} ${coord(cy)}`,
    "Z",
  ].join(" ");
}

/** Generate a straight line path from one point to another. */
export function linePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  return `M ${coord(x1)} ${coord(y1)} L ${coord(x2)} ${coord(y2)}`;
}

/** Generate a connected polyline path from [x1,y1,x2,y2,...]. */
export function polylinePath(points: number[]): string {
  if (points.length < 4) {
    return linePath(points[0] ?? 0, points[1] ?? 0, points[2] ?? 0, points[3] ?? 0);
  }

  const segments: string[] = [`M ${coord(points[0] ?? 0)} ${coord(points[1] ?? 0)}`];
  for (let i = 2; i + 1 < points.length; i += 2) {
    segments.push(`L ${coord(points[i] ?? 0)} ${coord(points[i + 1] ?? 0)}`);
  }

  return segments.join(" ");
}

/** Slightly wavy underline segment for emphasis on existing text. */
export function underlinePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);

  if (length < 4) {
    return linePath(x1, y1, x2, y2);
  }

  const waveCount = Math.max(Math.round(length / 48), 2);
  const amplitude = Math.min(length * 0.018, 3.5);
  const perpX = (-dy / length) * amplitude;
  const perpY = (dx / length) * amplitude;
  const segments: string[] = [`M ${coord(x1)} ${coord(y1)}`];

  for (let i = 1; i <= waveCount; i++) {
    const t = i / waveCount;
    const px = x1 + dx * t;
    const py = y1 + dy * t;
    const sign = i % 2 === 0 ? 1 : -1;
    segments.push(`L ${coord(px + perpX * sign)} ${coord(py + perpY * sign)}`);
  }

  return segments.join(" ");
}

/** Open emphasis ellipse around a region — not a closed diagram circle. */
export function emphasisEllipsePath(
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const padX = 6;
  const padYTop = 5;
  const padYBottom = 2;
  const cx = x + width / 2;
  const cy = y + padYTop + (height - padYTop - padYBottom) / 2;
  const rx = width / 2 + padX;
  const ry = (height - padYTop - padYBottom) / 2 + (padYTop + padYBottom) / 2;
  const kappa = 0.552284749831;
  const cRx = rx * kappa;
  const cRy = ry * kappa;

  return [
    `M ${coord(cx + rx)} ${coord(cy)}`,
    `C ${coord(cx + rx)} ${coord(cy + cRy)} ${coord(cx + cRx)} ${coord(cy + ry)} ${coord(cx)} ${coord(cy + ry)}`,
    `C ${coord(cx - cRx)} ${coord(cy + ry)} ${coord(cx - rx)} ${coord(cy + cRy)} ${coord(cx - rx)} ${coord(cy)}`,
    `C ${coord(cx - rx)} ${coord(cy - cRy)} ${coord(cx - cRx)} ${coord(cy - ry)} ${coord(cx)} ${coord(cy - ry)}`,
    `C ${coord(cx + cRx)} ${coord(cy - ry)} ${coord(cx + rx)} ${coord(cy - cRy)} ${coord(cx + rx)} ${coord(cy)}`,
  ].join(" ");
}

/** Line with arrowhead at the end point. */
export function arrowPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);

  if (length < 2) {
    return linePath(x1, y1, x2, y2);
  }

  const headLen = Math.min(Math.max(length * 0.14, 10), 22);
  const angle = Math.atan2(dy, dx);
  const leftAngle = angle + Math.PI * 0.82;
  const rightAngle = angle - Math.PI * 0.82;
  const leftX = x2 + headLen * Math.cos(leftAngle);
  const leftY = y2 + headLen * Math.sin(leftAngle);
  const rightX = x2 + headLen * Math.cos(rightAngle);
  const rightY = y2 + headLen * Math.sin(rightAngle);

  return [
    linePath(x1, y1, x2, y2),
    `M ${coord(x2)} ${coord(y2)} L ${coord(leftX)} ${coord(leftY)}`,
    `M ${coord(x2)} ${coord(y2)} L ${coord(rightX)} ${coord(rightY)}`,
  ].join(" ");
}

/** Closed rectangle for translucent highlight fill. */
export function highlightRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  return rectPath(x, y, width, height);
}

/** Quick jagged emphasis stroke through a bbox or polyline. */
export function scribblePath(points: number[]): string {
  if (points.length < 4) {
    return linePath(points[0] ?? 0, points[1] ?? 0, points[2] ?? 0, points[3] ?? 0);
  }

  if (points.length >= 6) {
    const segments = [`M ${coord(points[0])} ${coord(points[1])}`];
    for (let i = 2; i + 1 < points.length; i += 2) {
      segments.push(`L ${coord(points[i])} ${coord(points[i + 1])}`);
    }
    return segments.join(" ");
  }

  const [x1, y1, x2, y2] = points;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const midY = (minY + maxY) / 2;
  const jitter = Math.max((maxX - minX) * 0.08, 4);

  return [
    `M ${coord(minX)} ${coord(midY)}`,
    `L ${coord(minX + (maxX - minX) * 0.33)} ${coord(midY - jitter)}`,
    `L ${coord(minX + (maxX - minX) * 0.66)} ${coord(midY + jitter)}`,
    `L ${coord(maxX)} ${coord(midY)}`,
  ].join(" ");
}

/**
 * Generate an ellipse with separate x/y radii, approximated by four cubic
 * bezier curves — a generalized version of `circlePath`.
 */
export function ellipsePath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): string {
  const kappa = 0.552284749831;
  const cRx = rx * kappa;
  const cRy = ry * kappa;

  return [
    `M ${coord(cx + rx)} ${coord(cy)}`,
    `C ${coord(cx + rx)} ${coord(cy + cRy)} ${coord(cx + cRx)} ${coord(cy + ry)} ${coord(cx)} ${coord(cy + ry)}`,
    `C ${coord(cx - cRx)} ${coord(cy + ry)} ${coord(cx - rx)} ${coord(cy + cRy)} ${coord(cx - rx)} ${coord(cy)}`,
    `C ${coord(cx - rx)} ${coord(cy - cRy)} ${coord(cx - cRx)} ${coord(cy - ry)} ${coord(cx)} ${coord(cy - ry)}`,
    `C ${coord(cx + cRx)} ${coord(cy - ry)} ${coord(cx + rx)} ${coord(cy - cRy)} ${coord(cx + rx)} ${coord(cy)}`,
    "Z",
  ].join(" ");
}

/**
 * Curved arrow for organic chemistry electron-pushing mechanisms.
 * A quadratic bezier from (x1,y1) through control point (cx,cy) to (x2,y2),
 * with an arrowhead at the end oriented along the tangent at t=1.
 */
export function curvedArrowPath(
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
): string {
  // Tangent at t=1 for a quadratic bezier points from control to end.
  const tdx = x2 - cx;
  const tdy = y2 - cy;
  const tlen = Math.hypot(tdx, tdy);

  if (tlen < 2) {
    // Degenerate — fall back to a straight arrow.
    return arrowPath(x1, y1, x2, y2);
  }

  const headLen = 14;
  const angle = Math.atan2(tdy, tdx);
  const leftAngle = angle + Math.PI * 0.82;
  const rightAngle = angle - Math.PI * 0.82;
  const leftX = x2 + headLen * Math.cos(leftAngle);
  const leftY = y2 + headLen * Math.sin(leftAngle);
  const rightX = x2 + headLen * Math.cos(rightAngle);
  const rightY = y2 + headLen * Math.sin(rightAngle);

  return [
    `M ${coord(x1)} ${coord(y1)} Q ${coord(cx)} ${coord(cy)} ${coord(x2)} ${coord(y2)}`,
    `M ${coord(x2)} ${coord(y2)} L ${coord(leftX)} ${coord(leftY)}`,
    `M ${coord(x2)} ${coord(y2)} L ${coord(rightX)} ${coord(rightY)}`,
  ].join(" ");
}

/**
 * Smooth cubic bezier spline through a series of points using
 * Catmull-Rom-to-Bezier conversion. The flat array is [x1,y1,x2,y2,...].
 * A tension of 0.5 produces natural curves for parabolas, sinusoids, etc.
 */
export function bezierSplinePath(points: number[]): string {
  if (points.length < 4) {
    return linePath(points[0] ?? 0, points[1] ?? 0, points[2] ?? 0, points[3] ?? 0);
  }

  const pts: Array<[number, number]> = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    pts.push([points[i]!, points[i + 1]!]);
  }

  if (pts.length < 2) {
    return `M ${coord(pts[0]![0])} ${coord(pts[0]![1])}`;
  }

  const tension = 0.5;
  const segments: string[] = [`M ${coord(pts[0]![0])} ${coord(pts[0]![1])}`];

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1]!;

    const c1x = p1[0] + (p2[0] - p0[0]) * tension / 3;
    const c1y = p1[1] + (p2[1] - p0[1]) * tension / 3;
    const c2x = p2[0] - (p3[0] - p1[0]) * tension / 3;
    const c2y = p2[1] - (p3[1] - p1[1]) * tension / 3;

    segments.push(
      `C ${coord(c1x)} ${coord(c1y)} ${coord(c2x)} ${coord(c2y)} ${coord(p2[0])} ${coord(p2[1])}`,
    );
  }

  return segments.join(" ");
}

/**
 * A thin measurement bar that floats *beside* the geometry it measures.
 *
 * Unlike an engineering dimension bracket, this deliberately does NOT draw
 * extension/witness lines back to the measured points, so the marking never
 * touches or boxes-in the diagram. It is a light "from here to here" bar with
 * small end ticks, meant to be rendered dashed and thin. `offset` pushes the
 * bar perpendicular to the span (positive = below a left-to-right span).
 *
 * Returns `labelCenterX` (the bar midpoint) so the renderer can horizontally
 * centre the distance text, and `labelY` (text top) placed clear of the bar.
 */
export function dimensionPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  offset: number,
): { path: string; labelCenterX: number; labelY: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  // Unit normal (bar sits along this direction, away from the geometry).
  const nx = -dy / len;
  const ny = dx / len;

  const e1x = x1 + nx * offset;
  const e1y = y1 + ny * offset;
  const e2x = x2 + nx * offset;
  const e2y = y2 + ny * offset;

  // Small end ticks, perpendicular to the bar (i.e. along the normal), just to
  // cap the span. They stay short so nothing reads as a box.
  const capHalf = 5;
  const cx = nx * capHalf;
  const cy = ny * capHalf;

  const path = [
    `M ${coord(e1x)} ${coord(e1y)} L ${coord(e2x)} ${coord(e2y)}`,
    `M ${coord(e1x - cx)} ${coord(e1y - cy)} L ${coord(e1x + cx)} ${coord(e1y + cy)}`,
    `M ${coord(e2x - cx)} ${coord(e2y - cy)} L ${coord(e2x + cx)} ${coord(e2y + cy)}`,
  ].join(" ");

  const barMidX = (e1x + e2x) / 2;
  const barMidY = (e1y + e2y) / 2;

  // Place the distance text on the far side of the bar so it never overlaps
  // either the bar or the geometry. `labelY` is the text *top* — leave a real
  // air gap (not 6px) so handwriting never sits on the dotted bar.
  const TEXT_HEIGHT = 34;
  const TEXT_GAP = 18;
  const labelY =
    offset >= 0
      ? barMidY + capHalf + TEXT_GAP
      : barMidY - capHalf - TEXT_GAP - TEXT_HEIGHT;

  return {
    path,
    labelCenterX: barMidX,
    labelY,
  };
}

/**
 * A short tick that marks an exact point on the diagram, so a label can point
 * at "this spot" rather than sitting on top of a line. Defaults to a small
 * vertical tick (used to mark points on a horizontal principal axis / wire).
 */
export function pointTickPath(
  x: number,
  y: number,
  half = 6,
  orientation: "vertical" | "horizontal" = "vertical",
): string {
  if (orientation === "horizontal") {
    return `M ${coord(x - half)} ${coord(y)} L ${coord(x + half)} ${coord(y)}`;
  }
  return `M ${coord(x)} ${coord(y - half)} L ${coord(x)} ${coord(y + half)}`;
}

/**
 * Labels are written by the handwriting engine, not represented as geometry.
 * The coordinates are accepted to keep the shape API consistent.
 */
export function labelPath(text: string, _x: number, _y: number): string {
  return text;
}

/**
 * Create an SVG path element for browser-native path length measurement.
 * Consumers use `getTotalLength()` and `getPointAtLength()` for stroke
 * animation and cursor tracking. This helper must run in a browser context.
 */
export function createPathElement(pathData: string): SVGPathElement {
  if (typeof document === "undefined") {
    throw new Error("createPathElement can only be used in a browser context.");
  }

  const path = document.createElementNS(SVG_NAMESPACE, "path");
  path.setAttribute("d", pathData);
  path.setAttribute("fill", "none");
  return path;
}
