/** Owned annotation geometry: ticks, angle families, sign badges, and label anchors. */

export interface MarkPoint {
  x: number;
  y: number;
}

export type CongruenceCount = 1 | 2 | 3;

const EPSILON = 1e-6;

export function congruenceCount(value: unknown): CongruenceCount {
  const count = typeof value === "number" ? value : Number(value);
  if (count === 2 || count === 3) return count;
  return 1;
}

export function angleMarkRadii(baseRadius: number, count: CongruenceCount): number[] {
  const gap = Math.max(baseRadius * 0.16, 0.12);
  return Array.from({ length: count }, (_, index) => baseRadius + index * gap);
}

export function pointAlongPolyline(points: MarkPoint[], at: number): MarkPoint {
  const start = points[0];
  if (!start) return { x: 0, y: 0 };
  if (points.length === 1) return start;
  const lengths = [0];
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const next = points[index]!;
    total += Math.hypot(next.x - previous.x, next.y - previous.y);
    lengths.push(total);
  }
  if (total < EPSILON) return start;
  const target = Math.min(1, Math.max(0, at)) * total;
  for (let index = 1; index < points.length; index++) {
    if (target > lengths[index]!) continue;
    const span = lengths[index]! - lengths[index - 1]!;
    const t = span < EPSILON ? 0 : (target - lengths[index - 1]!) / span;
    const previous = points[index - 1]!;
    const next = points[index]!;
    return {
      x: previous.x + (next.x - previous.x) * t,
      y: previous.y + (next.y - previous.y) * t,
    };
  }
  return points.at(-1) ?? start;
}

export function congruenceTickSegments(
  start: MarkPoint,
  end: MarkPoint,
  count: CongruenceCount,
  at = 0.5,
  size?: number,
): MarkPoint[][] {
  const span = Math.hypot(end.x - start.x, end.y - start.y);
  if (span < EPSILON) return [];
  const tickSize = size ?? span * 0.08;
  const alongX = (end.x - start.x) / span;
  const alongY = (end.y - start.y) / span;
  const normalX = -alongY;
  const normalY = alongX;
  const center = {
    x: start.x + (end.x - start.x) * at,
    y: start.y + (end.y - start.y) * at,
  };
  const spacing = tickSize * 0.42;
  const offsets = count === 1 ? [0] : count === 2 ? [-spacing / 2, spacing / 2] : [-spacing, 0, spacing];
  return offsets.map((offset) => {
    const mid = {
      x: center.x + alongX * offset,
      y: center.y + alongY * offset,
    };
    return [
      { x: mid.x - normalX * tickSize / 2, y: mid.y - normalY * tickSize / 2 },
      { x: mid.x + normalX * tickSize / 2, y: mid.y + normalY * tickSize / 2 },
    ];
  });
}

export function signBadgeGeometry(
  target: { start: MarkPoint; end: MarkPoint },
  sense: string,
  at = 0.72,
): { paths: MarkPoint[][]; directed: boolean } {
  const span = Math.hypot(target.end.x - target.start.x, target.end.y - target.start.y);
  const length = Math.max(span * 0.18, 0.35);
  const origin = {
    x: target.start.x + (target.end.x - target.start.x) * at,
    y: target.start.y + (target.end.y - target.start.y) * at,
  };
  const ux = span < EPSILON ? 1 : (target.end.x - target.start.x) / span;
  const uy = span < EPSILON ? 0 : (target.end.y - target.start.y) / span;
  const nx = -uy;
  const ny = ux;
  const normalized = sense.trim().toLowerCase();
  if (normalized === "clockwise" || normalized === "counterclockwise") {
    const sign = normalized === "clockwise" ? 1 : -1;
    const radius = Math.max(span * 0.12, 0.28);
    const startAngle = -Math.PI * 0.65;
    const endAngle = Math.PI * 0.55;
    const samples: MarkPoint[] = [];
    for (let index = 0; index <= 10; index++) {
      const angle = startAngle + (endAngle - startAngle) * (index / 10);
      samples.push({
        x: origin.x + Math.cos(angle) * radius * ux + Math.sin(angle) * radius * nx * sign,
        y: origin.y + Math.cos(angle) * radius * uy + Math.sin(angle) * radius * ny * sign,
      });
    }
    const tip = samples.at(-1)!;
    const prev = samples.at(-2) ?? origin;
    const hx = tip.x - prev.x;
    const hy = tip.y - prev.y;
    const head = Math.hypot(hx, hy) || 1;
    const headLen = Math.max(length * 0.22, 0.12);
    return {
      directed: true,
      paths: [
        samples,
        [
          tip,
          {
            x: tip.x - (hx / head) * headLen + (-hy / head) * headLen * 0.45,
            y: tip.y - (hy / head) * headLen + (hx / head) * headLen * 0.45,
          },
        ],
        [
          tip,
          {
            x: tip.x - (hx / head) * headLen - (-hy / head) * headLen * 0.45,
            y: tip.y - (hy / head) * headLen - (hx / head) * headLen * 0.45,
          },
        ],
      ],
    };
  }
  const tip = { x: origin.x + ux * length, y: origin.y + uy * length };
  const headLen = length * 0.28;
  return {
    directed: true,
    paths: [
      [origin, tip],
      [
        tip,
        { x: tip.x - ux * headLen + nx * headLen * 0.45, y: tip.y - uy * headLen + ny * headLen * 0.45 },
      ],
      [
        tip,
        { x: tip.x - ux * headLen - nx * headLen * 0.45, y: tip.y - uy * headLen - ny * headLen * 0.45 },
      ],
    ],
  };
}

export function labelAnchorForPath(
  points: MarkPoint[],
  directed: boolean,
  infinite: boolean,
): MarkPoint {
  const start = points[0];
  const end = points.at(-1);
  if (!start) return { x: 0, y: 0 };
  if (!end || points.length === 1) return start;
  if (infinite) return start;
  return pointAlongPolyline(points, directed ? 0.82 : 0.5);
}

export function arcLabelAnchor(
  center: MarkPoint,
  radius: number,
  startAngle: number,
  endAngle: number,
): MarkPoint {
  let sweep = endAngle - startAngle;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  const mid = startAngle + sweep / 2;
  const lift = radius * 1.28;
  return {
    x: center.x + Math.cos(mid) * lift,
    y: center.y + Math.sin(mid) * lift,
  };
}

export function isMeasurementLabelText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (/^[A-Za-zΑ-ω][A-Za-z0-9Α-ω₀-₉_]*$/.test(normalized)) return false;
  if (/[=]|°/.test(normalized)) return true;
  if (/^\d/.test(normalized)) return true;
  if (/\d/.test(normalized) && /(?:ohm|cm|m\/s|newton|\bN\b|\bA\b|Ω)/i.test(normalized)) return true;
  return false;
}

export function formatAngleMeasureDegrees(_radians: number, expected?: unknown): string | undefined {
  if (typeof expected === "number" && Number.isFinite(expected)) {
    return `${trimMeasure(expected)}°`;
  }
  if (expected && typeof expected === "object") {
    const record = expected as { value?: unknown; unit?: unknown };
    if (typeof record.value === "number" && Number.isFinite(record.value)) {
      const unit = typeof record.unit === "string" ? record.unit : "degree";
      return /rad/i.test(unit) ? `${trimMeasure(record.value)} rad` : `${trimMeasure(record.value)}°`;
    }
  }
  return undefined;
}

export function sceneCaptionText(parts: string[]): string | undefined {
  const unique: string[] = [];
  for (const part of parts) {
    const compact = part.replace(/\s+/g, " ").trim();
    if (!compact || unique.includes(compact)) continue;
    unique.push(compact.length > 88 ? `${compact.slice(0, 85).trim()}…` : compact);
  }
  return unique.length > 0 ? unique.join(" · ") : undefined;
}

export function encloseBounds(
  points: MarkPoint[],
  pad = 10,
): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) return { x: 0, y: 0, width: 24, height: 24 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(18, maxX - minX + pad * 2);
  const height = Math.max(18, maxY - minY + pad * 2);
  return {
    x: (minX + maxX) / 2 - width / 2,
    y: (minY + maxY) / 2 - height / 2,
    width,
    height,
  };
}

export function rectanglePoints(bounds: { x: number; y: number; width: number; height: number }): MarkPoint[] {
  return [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ];
}

export function hatchSegments(
  start: MarkPoint,
  end: MarkPoint,
  count = 6,
): MarkPoint[][] {
  const span = Math.hypot(end.x - start.x, end.y - start.y);
  if (span < EPSILON) return [];
  const ux = (end.x - start.x) / span;
  const uy = (end.y - start.y) / span;
  const nx = -uy;
  const ny = ux;
  const hatchLen = Math.min(16, Math.max(8, span * 0.16));
  const offset = 5;
  const marks = Math.max(3, count);
  return Array.from({ length: marks }, (_, index) => {
    const t = (index + 1) / (marks + 1);
    const mid = { x: start.x + ux * span * t, y: start.y + uy * span * t };
    const origin = { x: mid.x + nx * offset, y: mid.y + ny * offset };
    return [
      origin,
      { x: origin.x + (ux + nx) * hatchLen * 0.5, y: origin.y + (uy + ny) * hatchLen * 0.5 },
    ];
  });
}

export function hatchRegion(points: MarkPoint[], spacing = 14): MarkPoint[][] {
  if (points.length < 3) return [];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const segments: MarkPoint[][] = [];
  for (let x = minX - (maxY - minY); x < maxX + (maxY - minY); x += spacing) {
    segments.push([
      { x, y: minY },
      { x: x + (maxY - minY), y: maxY },
    ]);
  }
  return segments;
}

export function bracePoints(start: MarkPoint, end: MarkPoint, offset = 18): MarkPoint[] {
  const span = Math.hypot(end.x - start.x, end.y - start.y);
  if (span < EPSILON) return [start, end];
  const ux = (end.x - start.x) / span;
  const uy = (end.y - start.y) / span;
  const nx = -uy;
  const ny = ux;
  const lift = (p: MarkPoint, along: number, out: number): MarkPoint => ({
    x: p.x + ux * along + nx * out,
    y: p.y + uy * along + ny * out,
  });
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  return [
    lift(start, 0, offset * 0.35),
    lift(start, span * 0.18, offset),
    lift(mid, 0, offset * 1.2),
    lift(end, -span * 0.18, offset),
    lift(end, 0, offset * 0.35),
  ];
}

export function parallelChevrons(
  start: MarkPoint,
  end: MarkPoint,
  count: CongruenceCount,
): MarkPoint[][] {
  const span = Math.hypot(end.x - start.x, end.y - start.y);
  if (span < EPSILON) return [];
  const ux = (end.x - start.x) / span;
  const uy = (end.y - start.y) / span;
  const nx = -uy;
  const ny = ux;
  const size = Math.min(12, span * 0.1);
  const positions = count === 1 ? [0.5] : count === 2 ? [0.42, 0.54] : [0.38, 0.5, 0.62];
  return positions.flatMap((at) => {
    const tip = { x: start.x + ux * span * at, y: start.y + uy * span * at };
    const back = { x: tip.x - ux * size, y: tip.y - uy * size };
    return [
      [back, { x: tip.x + nx * size * 0.45, y: tip.y + ny * size * 0.45 }, tip],
      [back, { x: tip.x - nx * size * 0.45, y: tip.y - ny * size * 0.45 }, tip],
    ];
  });
}

export function inflateClosedPath(points: MarkPoint[], amount = 12): MarkPoint[] {
  if (points.length < 3) return points;
  const ring = points[0] && points.at(-1) && distance(points[0], points.at(-1)!) < EPSILON
    ? points.slice(0, -1)
    : points;
  const cx = ring.reduce((sum, point) => sum + point.x, 0) / ring.length;
  const cy = ring.reduce((sum, point) => sum + point.y, 0) / ring.length;
  return ring.map((point) => {
    const dx = point.x - cx;
    const dy = point.y - cy;
    const length = Math.hypot(dx, dy) || 1;
    return { x: point.x + dx / length * amount, y: point.y + dy / length * amount };
  });
}

export function endpointMark(
  point: MarkPoint,
  style: "filled" | "open" | "cross" | "square",
  radius = 5,
): { kind: "point" | "circle" | "line" | "rectangle"; points: MarkPoint[]; radius?: number }[] {
  if (style === "filled") return [{ kind: "point", points: [point] }];
  if (style === "open") return [{ kind: "circle", points: [point], radius }];
  if (style === "square") {
    return [{
      kind: "rectangle",
      points: rectanglePoints({ x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2 }),
    }];
  }
  return [
    { kind: "line", points: [{ x: point.x - radius, y: point.y - radius }, { x: point.x + radius, y: point.y + radius }] },
    { kind: "line", points: [{ x: point.x - radius, y: point.y + radius }, { x: point.x + radius, y: point.y - radius }] },
  ];
}

export function senseArrows(start: MarkPoint, end: MarkPoint, count: CongruenceCount = 2): MarkPoint[][] {
  const span = Math.hypot(end.x - start.x, end.y - start.y);
  if (span < EPSILON) return [];
  const ats = count === 1 ? [0.55] : count === 2 ? [0.34, 0.68] : [0.28, 0.52, 0.76];
  return ats.flatMap((at) => {
    const origin = {
      x: start.x + (end.x - start.x) * (at - 0.08),
      y: start.y + (end.y - start.y) * (at - 0.08),
    };
    const tip = {
      x: start.x + (end.x - start.x) * at,
      y: start.y + (end.y - start.y) * at,
    };
    return signBadgeGeometry({ start: origin, end: tip }, "positive", 1).paths;
  });
}

export function projectToSegment(point: MarkPoint, start: MarkPoint, end: MarkPoint): MarkPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denom = dx * dx + dy * dy;
  if (denom < EPSILON) return start;
  const t = Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / denom));
  return { x: start.x + dx * t, y: start.y + dy * t };
}

export function dropToAxes(point: MarkPoint, axes: MarkPoint[]): [MarkPoint, MarkPoint] | null {
  if (axes.length < 4) return null;
  const horizontal = projectToSegment(point, axes[0]!, axes[1]!);
  const vertical = projectToSegment(point, axes[2]!, axes[3]!);
  const useHorizontal = Math.hypot(point.x - horizontal.x, point.y - horizontal.y)
    <= Math.hypot(point.x - vertical.x, point.y - vertical.y);
  const foot = useHorizontal ? horizontal : vertical;
  if (Math.hypot(point.x - foot.x, point.y - foot.y) < 2) return null;
  return [point, foot];
}

export function extendSegment(start: MarkPoint, end: MarkPoint, factor = 0.34): [MarkPoint, MarkPoint] {
  return [
    end,
    {
      x: end.x + (end.x - start.x) * factor,
      y: end.y + (end.y - start.y) * factor,
    },
  ];
}

export function offsetClone(points: MarkPoint[], amount = 6): MarkPoint[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [{ x: points[0]!.x + amount, y: points[0]!.y - amount }];
  const start = points[0]!;
  const end = points.at(-1)!;
  const span = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const nx = -(end.y - start.y) / span * amount;
  const ny = (end.x - start.x) / span * amount;
  return points.map((point) => ({ x: point.x + nx, y: point.y + ny }));
}

export function localFrame(origin: MarkPoint, tangent: MarkPoint, size = 28): MarkPoint[][] {
  const span = Math.hypot(tangent.x, tangent.y) || 1;
  const ux = tangent.x / span;
  const uy = tangent.y / span;
  const nx = -uy;
  const ny = ux;
  const axis = (dx: number, dy: number): MarkPoint[] => [
    origin,
    { x: origin.x + dx * size, y: origin.y + dy * size },
  ];
  return [axis(ux, uy), axis(nx, ny)];
}

export function slopeTriangle(start: MarkPoint, end: MarkPoint): MarkPoint[] {
  return [start, { x: end.x, y: start.y }, end];
}

function distance(a: MarkPoint, b: MarkPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function trimMeasure(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
