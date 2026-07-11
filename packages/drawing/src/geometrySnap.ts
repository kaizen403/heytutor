import type { DrawCommand } from "./drawingProtocol";
import { DIAGRAM_ZONE } from "./boardZones";
import type { DiagramTemplate, TemplateAnchor } from "./templates/types";

export interface SnapPoint {
  x: number;
  y: number;
  id?: string;
}

const DEFAULT_SNAP_TOLERANCE = 28;
/** Optics rays: slightly looser so LLM endpoints still attach to planes. */
const OPTICS_RAY_TOLERANCE = 40;
/** Project onto a vertical optical plane when within this horizontal distance. */
const OPTICAL_PLANE_PROJECTION_PX = 45;

/** Shared with opticsPrecision / opticsFamily — pole at (610, 300). */
export const MIRROR_POLE_X = 610;
export const LENS_O_X = 650;
export const AXIS_Y = 300;

/**
 * Mirror arc: endpoints at x=690, control chosen so B(0.5) = pole (610, 300).
 * (Control at 610 would put the mid-curve at x=650 — the old bug.)
 * Solve: 0.5*690 + 0.5*cx = 610 → cx = 530.
 */
export const OPTICS_MIRROR_CURVE: readonly [number, number, number, number, number, number] = [
  690,
  175,
  530,
  AXIS_Y,
  690,
  425,
];

const OPTICS_LENS_LEFT_CURVE: readonly [number, number, number, number, number, number] = [
  LENS_O_X, 200, 620, 300, LENS_O_X, 400,
];
const OPTICS_LENS_RIGHT_CURVE: readonly [number, number, number, number, number, number] = [
  LENS_O_X, 200, 680, 300, LENS_O_X, 400,
];

const OPTICS_COMBO_L1_LEFT: readonly [number, number, number, number, number, number] = [
  620, 210, 600, 300, 620, 390,
];
const OPTICS_COMBO_L1_RIGHT: readonly [number, number, number, number, number, number] = [
  620, 210, 640, 300, 620, 390,
];
const OPTICS_COMBO_L2_LEFT: readonly [number, number, number, number, number, number] = [
  680, 210, 660, 300, 680, 390,
];
const OPTICS_COMBO_L2_RIGHT: readonly [number, number, number, number, number, number] = [
  680, 210, 700, 300, 680, 390,
];

const AXIS_ANCHOR_IDS = new Set([
  "O",
  "F",
  "F2",
  "C",
  "pole",
  "optical center",
  "optical centre",
  "center",
  "focus",
  "focal",
]);

function anchorCenter(anchor: TemplateAnchor): SnapPoint {
  return {
    x: anchor.x + anchor.width / 2,
    y: anchor.y + anchor.height / 2,
    id: anchor.id,
  };
}

/** Point-mark anchors (C/F/O) may sit above the axis for label targeting; rays still snap on-axis. */
const AXIS_POINT_ANCHOR_IDS = new Set(["C", "F", "F2", "O", "pole"]);

function snapAnchorForGeometry(anchor: TemplateAnchor, opticsAxis: boolean): SnapPoint {
  const center = anchorCenter(anchor);
  if (opticsAxis && AXIS_POINT_ANCHOR_IDS.has(anchor.id)) {
    return { x: center.x, y: AXIS_Y, id: anchor.id };
  }
  return center;
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

/** Dense samples along a vertical optical plane (thin-lens / instrument convention). */
function sampleVerticalPlane(
  planeX: number,
  yMin: number,
  yMax: number,
  step: number,
  id: string,
): SnapPoint[] {
  const points: SnapPoint[] = [];
  for (let y = yMin; y <= yMax; y += step) {
    points.push({ x: planeX, y, id });
  }
  return points;
}

function isQuadraticBezierParams(params: number[]): boolean {
  return params.length >= 7 && params[params.length - 1] === 2;
}

function collectSkeletonSnapPoints(template: DiagramTemplate): SnapPoint[] {
  const points: SnapPoint[] = [];

  for (const cmd of template.commands) {
    if (cmd.type === "DRAW_LINE" && cmd.params.length >= 4) {
      // Unify with snapGeometryCommand: 7-param quadratic (x0,y0,cx,cy,x1,y1,2).
      if (isQuadraticBezierParams(cmd.params)) {
        const spline = cmd.params.slice(0, -1);
        for (let i = 0; i + 1 < spline.length; i += 2) {
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

function isOpticsAxisTemplate(id: string): boolean {
  return (
    id === "optics_mirror" ||
    id === "optics_ray" ||
    id === "optics_lens" ||
    id === "optics_lens_combo" ||
    id === "optics_instrument"
  );
}

function opticalPlanesForTemplate(templateId: string): Array<{ x: number; yMin: number; yMax: number; id: string }> {
  if (templateId === "optics_lens") {
    return [{ x: LENS_O_X, yMin: 200, yMax: 400, id: "lens-plane" }];
  }
  if (templateId === "optics_lens_combo") {
    return [
      { x: 620, yMin: 210, yMax: 390, id: "combo-plane-1" },
      { x: 680, yMin: 210, yMax: 390, id: "combo-plane-2" },
    ];
  }
  if (templateId === "optics_instrument") {
    return [
      { x: 520, yMin: 220, yMax: 380, id: "instrument-obj" },
      { x: 820, yMin: 220, yMax: 380, id: "instrument-eye" },
    ];
  }
  if (templateId === "optics_mirror" || templateId === "optics_ray") {
    // Pole plane fallback for axis-level rays aimed at the mirror.
    return [{ x: MIRROR_POLE_X, yMin: 200, yMax: 400, id: "mirror-pole-plane" }];
  }
  return [];
}

export function collectTemplateSnapPoints(template: DiagramTemplate): SnapPoint[] {
  const opticsAxis = isOpticsAxisTemplate(template.id);
  const points = [
    ...template.anchors.map((anchor) => snapAnchorForGeometry(anchor, opticsAxis)),
    ...collectSkeletonSnapPoints(template),
  ];

  if (isOpticsAxisTemplate(template.id)) {
    for (let x = 440; x <= 920; x += 40) {
      points.push({ x, y: AXIS_Y, id: "axis" });
    }
  }

  if (template.id === "optics_mirror" || template.id === "optics_ray") {
    points.push(
      ...sampleQuadraticBezier(...OPTICS_MIRROR_CURVE, 12).map((p) => ({
        ...p,
        id: "mirror",
      })),
    );
  }

  if (template.id === "optics_lens") {
    // Decorative outline samples (lower priority than lens-plane projection).
    points.push(
      ...sampleQuadraticBezier(...OPTICS_LENS_LEFT_CURVE, 10).map((p) => ({
        ...p,
        id: "lens-left",
      })),
      ...sampleQuadraticBezier(...OPTICS_LENS_RIGHT_CURVE, 10).map((p) => ({
        ...p,
        id: "lens-right",
      })),
    );
  }

  if (template.id === "optics_lens_combo") {
    for (const curve of [
      OPTICS_COMBO_L1_LEFT,
      OPTICS_COMBO_L1_RIGHT,
      OPTICS_COMBO_L2_LEFT,
      OPTICS_COMBO_L2_RIGHT,
    ] as const) {
      points.push(
        ...sampleQuadraticBezier(...curve, 8).map((p) => ({
          ...p,
          id: "lens-combo",
        })),
      );
    }
  }

  // Optical planes: dense vertical samples so bends attach to the physics plane.
  for (const plane of opticalPlanesForTemplate(template.id)) {
    points.push(...sampleVerticalPlane(plane.x, plane.yMin, plane.yMax, 15, plane.id));
  }

  if (template.id === "optics_prism") {
    const faces: Array<[number, number, number, number]> = [
      [700, 180, 560, 420],
      [560, 420, 840, 420],
      [840, 420, 700, 180],
    ];
    for (const [x1, y1, x2, y2] of faces) {
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        points.push({
          x: x1 + (x2 - x1) * t,
          y: y1 + (y2 - y1) * t,
          id: "prism-face",
        });
      }
    }
  }

  if (template.id === "optics_tir") {
    for (let x = 460; x <= 900; x += 40) {
      points.push({ x, y: AXIS_Y, id: "tir-interface" });
    }
    for (let y = 180; y <= 420; y += 40) {
      points.push({ x: 680, y, id: "tir-normal" });
    }
  }

  if (template.id === "optics_refraction_plane") {
    for (const y of [220, 380]) {
      for (let x = 520; x <= 820; x += 40) {
        points.push({ x, y, id: "slab-face" });
      }
    }
    for (const x of [520, 820]) {
      for (let y = 220; y <= 380; y += 40) {
        points.push({ x, y, id: "slab-side" });
      }
    }
  }

  return points;
}

function distance(a: SnapPoint, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isDecorativeLensId(id: string | undefined): boolean {
  return id === "lens-left" || id === "lens-right" || id === "lens-combo";
}

function isOpticalPlaneId(id: string | undefined): boolean {
  return (
    id === "lens-plane" ||
    id === "combo-plane-1" ||
    id === "combo-plane-2" ||
    id === "instrument-obj" ||
    id === "instrument-eye" ||
    id === "mirror-pole-plane"
  );
}

/**
 * Prefer projecting onto a vertical optical plane when the endpoint is near it.
 * Keeps ray bends on the thin-lens / instrument plane instead of decorative bulges.
 */
function projectToOpticalPlane(
  template: DiagramTemplate,
  x: number,
  y: number,
): { x: number; y: number; snapped: boolean; id?: string } | null {
  const planes = opticalPlanesForTemplate(template.id);
  if (planes.length === 0) {
    return null;
  }

  let best: { x: number; y: number; id: string; dist: number } | null = null;
  for (const plane of planes) {
    if (y < plane.yMin - 20 || y > plane.yMax + 20) {
      continue;
    }
    const dist = Math.abs(x - plane.x);
    if (dist <= OPTICAL_PLANE_PROJECTION_PX && (!best || dist < best.dist)) {
      const clampedY = Math.min(Math.max(y, plane.yMin), plane.yMax);
      best = { x: plane.x, y: clampedY, id: plane.id, dist };
    }
  }

  if (!best) {
    return null;
  }

  return { x: best.x, y: best.y, snapped: true, id: best.id };
}

export function snapPointToTemplate(
  x: number,
  y: number,
  snapPoints: SnapPoint[],
  tolerance = DEFAULT_SNAP_TOLERANCE,
): { x: number; y: number; snapped: boolean; id?: string } {
  if (!Number.isFinite(x) || !Number.isFinite(y) || snapPoints.length === 0) {
    return { x, y, snapped: false };
  }

  let best: SnapPoint | null = null;
  let bestDist = tolerance + 1;

  for (const point of snapPoints) {
    const d = distance(point, { x, y });
    // Prefer optical-plane samples over decorative curve samples at equal distance.
    if (d < bestDist || (d === bestDist && isOpticalPlaneId(point.id) && isDecorativeLensId(best?.id))) {
      bestDist = d;
      best = point;
    } else if (
      best &&
      isDecorativeLensId(best.id) &&
      isOpticalPlaneId(point.id) &&
      d <= bestDist + 8
    ) {
      // Plane wins over nearby decorative bulge.
      bestDist = d;
      best = point;
    }
  }

  if (best && bestDist <= tolerance) {
    return { x: best.x, y: best.y, snapped: true, id: best.id };
  }

  return { x, y, snapped: false };
}

function isNearAxisAnchor(
  snapPoints: SnapPoint[],
  x: number,
  y: number,
): boolean {
  for (const point of snapPoints) {
    if (!point.id || !AXIS_ANCHOR_IDS.has(point.id)) {
      continue;
    }
    if (distance(point, { x, y }) <= 24) {
      return true;
    }
  }
  return false;
}

/**
 * Flatten to principal axis only for true axis-level marks (near F/C/O) or
 * clearly horizontal axis rays — never for off-axis lens junctions.
 */
function snapAxisY(
  template: DiagramTemplate,
  x: number,
  y: number,
  options: {
    snapPoints: SnapPoint[];
    otherY?: number;
    forceHorizontalRay?: boolean;
  },
): { x: number; y: number } {
  if (!isOpticsAxisTemplate(template.id)) {
    return { x, y };
  }

  const nearAnchor = isNearAxisAnchor(options.snapPoints, x, y);
  const looksHorizontal =
    options.forceHorizontalRay === true ||
    (options.otherY !== undefined && Math.abs(y - options.otherY) <= 12 && Math.abs(y - AXIS_Y) <= 18);

  if (
    Math.abs(y - AXIS_Y) <= 18 &&
    x >= DIAGRAM_ZONE.x &&
    x <= DIAGRAM_ZONE.x + DIAGRAM_ZONE.width &&
    (nearAnchor || looksHorizontal)
  ) {
    return { x, y: AXIS_Y };
  }

  return { x, y };
}

function snapEndpoint(
  template: DiagramTemplate,
  x: number,
  y: number,
  snapPoints: SnapPoint[],
  otherY: number | undefined,
  isRay: boolean,
): { x: number; y: number; snapped: boolean } {
  const plane = projectToOpticalPlane(template, x, y);
  if (plane) {
    // Plane projection wins for near-plane bends; skip decorative nearest-neighbor.
    const axis = snapAxisY(template, plane.x, plane.y, {
      snapPoints,
      otherY,
      forceHorizontalRay: false,
    });
    // If plane projection put us off-axis, keep the projected y (don't flatten).
    if (Math.abs(plane.y - AXIS_Y) > 18) {
      return { x: plane.x, y: plane.y, snapped: true };
    }
    return { x: axis.x, y: axis.y, snapped: true };
  }

  const tolerance = isRay && isOpticsAxisTemplate(template.id) ? OPTICS_RAY_TOLERANCE : DEFAULT_SNAP_TOLERANCE;
  // Exclude decorative lens curves from nearest-neighbor when planes exist —
  // they already lost to projection; avoid pulling leftover endpoints onto bulges.
  const filtered =
    opticalPlanesForTemplate(template.id).length > 0
      ? snapPoints.filter((p) => !isDecorativeLensId(p.id))
      : snapPoints;

  const snapped = snapPointToTemplate(x, y, filtered, tolerance);
  const axis = snapAxisY(template, snapped.x, snapped.y, {
    snapPoints,
    otherY,
  });
  return { x: axis.x, y: axis.y, snapped: snapped.snapped };
}

export function snapGeometryCommand(
  command: DrawCommand,
  template: DiagramTemplate | null,
): DrawCommand {
  if (!template) {
    return command;
  }

  const snapPoints = collectTemplateSnapPoints(template);
  const isRay = command.type === "DRAW_LINE" || command.type === "ARROW";

  if (isRay) {
    const params = [...command.params];
    const hasBezierFlag = isQuadraticBezierParams(params);

    if (params.length < 4) {
      return command;
    }

    if (hasBezierFlag) {
      const next = [...params];
      for (let i = 0; i + 1 < next.length - 1; i += 2) {
        const snapped = snapEndpoint(
          template,
          next[i]!,
          next[i + 1]!,
          snapPoints,
          undefined,
          true,
        );
        next[i] = snapped.x;
        next[i + 1] = snapped.y;
      }
      return { ...command, params: next };
    }

    const [x1, y1, x2, y2] = params;
    const forceHorizontal = Math.abs(y1 - y2) <= 12 && Math.abs((y1 + y2) / 2 - AXIS_Y) <= 18;
    const snapped1 = snapEndpoint(template, x1, y1, snapPoints, y2, true);
    const snapped2 = snapEndpoint(template, x2, y2, snapPoints, y1, true);

    // Re-apply axis flatten for true horizontal axis rays after both ends known.
    let ax1 = snapped1.x;
    let ay1 = snapped1.y;
    let ax2 = snapped2.x;
    let ay2 = snapped2.y;
    if (forceHorizontal) {
      ay1 = AXIS_Y;
      ay2 = AXIS_Y;
    }

    const next = [...params];
    next[0] = ax1;
    next[1] = ay1;
    next[2] = ax2;
    next[3] = ay2;
    return { ...command, params: next };
  }

  if (command.type === "DIMENSION" && command.params.length >= 5) {
    const next = [...command.params];
    const s1 = snapEndpoint(template, next[0]!, next[1]!, snapPoints, next[3], false);
    const s2 = snapEndpoint(template, next[2]!, next[3]!, snapPoints, next[1], false);
    next[0] = s1.x;
    next[1] = s1.y;
    next[2] = s2.x;
    next[3] = s2.y;
    return { ...command, params: next };
  }

  return command;
}
