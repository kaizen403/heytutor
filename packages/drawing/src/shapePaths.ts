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
