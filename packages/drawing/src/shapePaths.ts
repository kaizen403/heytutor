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
  const pad = 6;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2 + pad;
  const ry = height / 2 + pad;
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
