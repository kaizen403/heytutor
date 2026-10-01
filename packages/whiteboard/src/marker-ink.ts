/** Production student highlighter. Shared by the live board and its walkthrough. */
export interface MarkPoint {
  x: number;
  y: number;
}
export interface MarkRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface MarkerStroke {
  points: MarkPoint[];
  targets: { kind: string; rect: MarkRect }[];
}

/** Nib width in board px — a shade under one work-row's cap height. */
const NIB_WIDTH = 21;
/** Nib angle. The same tilt the tutor's own pen rests at. */
const NIB_ANGLE_RAD = (-35 * Math.PI) / 180;
const NIB_EDGE = {
  x: Math.cos(NIB_ANGLE_RAD),
  y: Math.sin(NIB_ANGLE_RAD),
};

const HIGHLIGHT_FILL = "rgba(74, 158, 255, 0.42)";
const HIGHLIGHT_DRAFT_FILL = "rgba(74, 158, 255, 0.32)";
/** The darker rim a wet highlighter leaves at the edge of a pass. */
const HIGHLIGHT_EDGE = "rgba(28, 79, 156, 0.30)";
const HALO_FILL = "rgba(74, 158, 255, 0.10)";
const HALO_EDGE = "rgba(47, 111, 208, 0.55)";
const HALO_PAD = 7;

/**
 * The marker the pointer becomes. Drawn as a real OS cursor so it tracks with
 * zero latency — an element chasing pointermove always trails the hand.
 */
export const MARKER_CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g transform="rotate(32 16 16)">
    <rect x="10.5" y="3" width="11" height="19" rx="2.6" fill="#4A9EFF" stroke="#131312" stroke-width="1.4"/>
    <rect x="10.5" y="8" width="11" height="2.4" fill="#1C4F9C" opacity="0.85"/>
    <path d="M10.5 22h11l-2 5.4h-7z" fill="#E6F1FF" stroke="#131312" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M12.6 27.4h6.8" stroke="#1C4F9C" stroke-width="1.6" stroke-linecap="round"/>
  </g>
</svg>`;

export const MARKER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  MARKER_CURSOR_SVG.replace(/\s+/g, " "),
)}") 9 28, crosshair`;

/** Sweep the nib along the path, as one fillable region. */
function buildChiselPath(points: MarkPoint[]): Path2D | null {
  if (points.length === 0) {
    return null;
  }
  const half = NIB_WIDTH / 2;
  const ex = NIB_EDGE.x * half;
  const ey = NIB_EDGE.y * half;
  const path = new Path2D();

  if (points.length === 1) {
    // A tap still leaves the nib's own footprint.
    const [only] = points;
    path.moveTo(only.x - ex, only.y - ey);
    path.lineTo(only.x + ex, only.y + ey);
    path.lineTo(only.x + ex + 1.5, only.y + ey + 1.5);
    path.lineTo(only.x - ex + 1.5, only.y - ey + 1.5);
    path.closePath();
    return path;
  }

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    path.moveTo(a.x - ex, a.y - ey);
    path.lineTo(a.x + ex, a.y + ey);
    path.lineTo(b.x + ex, b.y + ey);
    path.lineTo(b.x - ex, b.y - ey);
    path.closePath();
  }
  return path;
}

function traceRoundedRect(
  context: CanvasRenderingContext2D,
  rect: MarkRect,
  radius: number,
): void {
  const { x, y, width, height } = rect;
  if (typeof context.roundRect === "function") {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

export function paintBoardMarks(
  context: CanvasRenderingContext2D,
  marks: MarkerStroke[],
  draftPoints: MarkPoint[],
): void {
  // What the mark resolved to, drawn behind the ink: the board answering
  // "yes, this line" while the student is still holding the marker.
  context.save();
  for (const mark of marks) {
    const targets = mark.targets;
    for (const target of targets) {
      if (target.kind === "region") continue;
      const halo: MarkRect = {
        x: target.rect.x - HALO_PAD,
        y: target.rect.y - HALO_PAD,
        width: target.rect.width + HALO_PAD * 2,
        height: target.rect.height + HALO_PAD * 2,
      };
      traceRoundedRect(context, halo, 8);
      context.fillStyle = HALO_FILL;
      context.fill();
      context.strokeStyle = HALO_EDGE;
      context.lineWidth = 1.25;
      context.setLineDash([5, 4]);
      context.stroke();
      context.setLineDash([]);
    }
  }
  context.restore();

  context.save();
  context.globalCompositeOperation = "multiply";
  context.lineJoin = "round";

  const paint = (points: MarkPoint[], fill: string) => {
    const path = buildChiselPath(points);
    if (!path) return;
    context.fillStyle = fill;
    context.fill(path, "nonzero");
    context.strokeStyle = HIGHLIGHT_EDGE;
    context.lineWidth = 1;
    context.stroke(path);
  };

  for (const mark of marks) {
    paint(mark.points, HIGHLIGHT_FILL);
  }
  if (draftPoints.length > 0) {
    paint(draftPoints, HIGHLIGHT_DRAFT_FILL);
  }
  context.restore();
}
