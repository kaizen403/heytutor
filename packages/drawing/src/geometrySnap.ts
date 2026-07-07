import type { DrawCommand } from "./drawingProtocol";
import { DIAGRAM_ZONE } from "./boardZones";
import type { DiagramTemplate, TemplateAnchor } from "./templates/types";

export interface SnapPoint {
  x: number;
  y: number;
  id?: string;
}

const DEFAULT_SNAP_TOLERANCE = 28;
const OPTICS_MIRROR_CURVE: readonly [number, number, number, number, number, number] = [
  690,
  175,
  610,
  300,
  690,
  425,
];

function anchorCenter(anchor: TemplateAnchor): SnapPoint {
  return {
    x: anchor.x + anchor.width / 2,
    y: anchor.y + anchor.height / 2,
    id: anchor.id,
  };
}

/** Sample points along a quadratic bezier (mirror arcs, curves). */
function sampleQuadraticBezier(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  steps = 5,
): SnapPoint[] {
  const points: SnapPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    points.push({
      x: mt * mt * x0 + 2 * mt * t * cx + t * t * x1,
      y: mt * mt * y0 + 2 * mt * t * cy + t * t * y1,
    });
  }
  return points;
}

function collectSkeletonSnapPoints(template: DiagramTemplate): SnapPoint[] {
  const points: SnapPoint[] = [];

  for (const cmd of template.commands) {
    if (cmd.type === "DRAW_LINE" && cmd.params.length >= 4) {
      const last = cmd.params[cmd.params.length - 1]!;
      if (cmd.params.length >= 8 && last === 2) {
        const spline = cmd.params.slice(0, -1);
        for (let i = 0; i < spline.length; i += 2) {
          points.push({ x: spline[i]!, y: spline[i + 1]! });
        }
        if (spline.length >= 6) {
          points.push(
            ...sampleQuadraticBezier(
              spline[0]!,
              spline[1]!,
              spline[2]!,
              spline[3]!,
              spline[4]!,
              spline[5]!,
            ),
          );
        }
        continue;
      }

      const [x1, y1, x2, y2] = cmd.params;
      points.push({ x: x1, y: y1 }, { x: x2, y: y2 });
      points.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 });
    }

    if (cmd.type === "DRAW_CIRCLE" && cmd.params.length >= 3) {
      const [cx, cy, r] = cmd.params;
      points.push({ x: cx, y: cy }, { x: cx + r, y: cy }, { x: cx - r, y: cy });
    }

    if (cmd.type === "DRAW_RECT" && cmd.params.length >= 4) {
      const [x, y, w, h] = cmd.params;
      points.push(
        { x, y },
        { x: x + w, y },
        { x, y: y + h },
        { x: x + w, y: y + h },
        { x: x + w / 2, y: y + h / 2 },
      );
    }
  }

  return points;
}

export function collectTemplateSnapPoints(template: DiagramTemplate): SnapPoint[] {
  const points = [
    ...template.anchors.map(anchorCenter),
    ...collectSkeletonSnapPoints(template),
  ];

  if (template.id === "optics_ray") {
    const axisY = 300;
    for (let x = 480; x <= 880; x += 40) {
      points.push({ x, y: axisY, id: "axis" });
    }
    points.push(
      ...sampleQuadraticBezier(...OPTICS_MIRROR_CURVE, 12).map((p) => ({
        ...p,
        id: "mirror",
      })),
    );
  }

  return points;
}

function distance(a: SnapPoint, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function snapPointToTemplate(
  x: number,
  y: number,
  snapPoints: SnapPoint[],
  tolerance = DEFAULT_SNAP_TOLERANCE,
): { x: number; y: number; snapped: boolean } {
  if (!Number.isFinite(x) || !Number.isFinite(y) || snapPoints.length === 0) {
    return { x, y, snapped: false };
  }

  let best: SnapPoint | null = null;
  let bestDist = tolerance + 1;

  for (const point of snapPoints) {
    const d = distance(point, { x, y });
    if (d < bestDist) {
      bestDist = d;
      best = point;
    }
  }

  if (best && bestDist <= tolerance) {
    return { x: best.x, y: best.y, snapped: true };
  }

  return { x, y, snapped: false };
}

function snapAxisY(template: DiagramTemplate, x: number, y: number): { x: number; y: number } {
  if (template.id !== "optics_ray") {
    return { x, y };
  }

  const axisY = 300;
  if (
    Math.abs(y - axisY) <= 18 &&
    x >= DIAGRAM_ZONE.x &&
    x <= DIAGRAM_ZONE.x + DIAGRAM_ZONE.width
  ) {
    return { x, y: axisY };
  }

  return { x, y };
}

export function snapGeometryCommand(
  command: DrawCommand,
  template: DiagramTemplate | null,
): DrawCommand {
  if (!template) {
    return command;
  }

  const snapPoints = collectTemplateSnapPoints(template);

  if (command.type === "DRAW_LINE" || command.type === "ARROW") {
    const params = [...command.params];
    const last = params[params.length - 1];
    const hasBezierFlag = params.length >= 7 && last === 2;

    if (params.length < 4) {
      return command;
    }

    if (hasBezierFlag) {
      const next = [...params];
      for (let i = 0; i + 1 < next.length - 1; i += 2) {
        const snapped = snapPointToTemplate(next[i]!, next[i + 1]!, snapPoints);
        const axis = snapAxisY(template, snapped.x, snapped.y);
        next[i] = axis.x;
        next[i + 1] = axis.y;
      }
      return { ...command, params: next };
    }

    let [x1, y1, x2, y2] = params;
    const snapped1 = snapPointToTemplate(x1, y1, snapPoints);
    const snapped2 = snapPointToTemplate(x2, y2, snapPoints);
    x1 = snapped1.x;
    y1 = snapped1.y;
    x2 = snapped2.x;
    y2 = snapped2.y;

    const axis1 = snapAxisY(template, x1, y1);
    const axis2 = snapAxisY(template, x2, y2);

    const next = [...params];
    next[0] = axis1.x;
    next[1] = axis1.y;
    next[2] = axis2.x;
    next[3] = axis2.y;
    return { ...command, params: next };
  }

  if (command.type === "DIMENSION" && command.params.length >= 5) {
    const next = [...command.params];
    const s1 = snapPointToTemplate(next[0]!, next[1]!, snapPoints);
    const s2 = snapPointToTemplate(next[2]!, next[3]!, snapPoints);
    next[0] = snapAxisY(template, s1.x, s1.y).x;
    next[1] = snapAxisY(template, s1.x, s1.y).y;
    next[2] = snapAxisY(template, s2.x, s2.y).x;
    next[3] = snapAxisY(template, s2.x, s2.y).y;
    return { ...command, params: next };
  }

  return command;
}
