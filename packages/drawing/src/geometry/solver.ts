import { DIAGRAM_ZONE } from "../boardZones";
import type { SceneConstraint, SceneEntity, SceneSpec } from "./sceneSpec";

export interface SolvedPoint {
  id: string;
  x: number;
  y: number;
  fixed: boolean;
}

export interface SolveResult {
  points: Map<string, SolvedPoint>;
  residual: number;
  ok: boolean;
}

const ZONE = {
  minX: DIAGRAM_ZONE.x + 20,
  maxX: DIAGRAM_ZONE.x + DIAGRAM_ZONE.width - 20,
  minY: DIAGRAM_ZONE.y + 20,
  maxY: DIAGRAM_ZONE.y + DIAGRAM_ZONE.height - 20,
  cx: DIAGRAM_ZONE.centerX,
  cy: DIAGRAM_ZONE.centerY,
} as const;

function clamp(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, ZONE.minX), ZONE.maxX),
    y: Math.min(Math.max(y, ZONE.minY), ZONE.maxY),
  };
}

function seedPoint(entity: SceneEntity, index: number, total: number): SolvedPoint {
  const attrs = entity.attrs ?? {};
  if (typeof attrs.x === "number" && typeof attrs.y === "number") {
    const c = clamp(attrs.x, attrs.y);
    return { id: entity.id, x: c.x, y: c.y, fixed: true };
  }

  // Spread free points across the diagram zone as a stable seed.
  const t = total <= 1 ? 0.5 : index / (total - 1);
  const x = ZONE.minX + t * (ZONE.maxX - ZONE.minX) * 0.7 + 40;
  const y = ZONE.cy + ((index % 3) - 1) * 50;
  const c = clamp(x, y);
  return { id: entity.id, x: c.x, y: c.y, fixed: false };
}

function getPoint(points: Map<string, SolvedPoint>, id: string): SolvedPoint | undefined {
  return points.get(id);
}

/**
 * Lightweight iterative constraint solver (GeoLoom-style).
 * Seeds free points, then repeatedly nudges them to reduce constraint residuals.
 */
export function solveConstraints(spec: SceneSpec): SolveResult {
  const pointEntities = spec.entities.filter((e) => e.type === "point");
  const points = new Map<string, SolvedPoint>();

  pointEntities.forEach((entity, index) => {
    points.set(entity.id, seedPoint(entity, index, pointEntities.length));
  });

  // Ensure endpoints referenced by segments/rays exist as points.
  for (const entity of spec.entities) {
    for (const ref of [entity.from, entity.to, entity.center, ...(entity.points ?? []), ...(entity.through ?? [])]) {
      if (!ref || points.has(ref)) continue;
      const existing = spec.entities.find((e) => e.id === ref);
      if (existing?.type === "point") continue;
      // Synthetic free point for unresolved refs.
      const idx = points.size;
      points.set(ref, seedPoint({ id: ref, type: "point" }, idx, idx + 1));
    }
  }

  let residual = Number.POSITIVE_INFINITY;
  const maxIters = 40;

  for (let iter = 0; iter < maxIters; iter++) {
    let sumSq = 0;
    let count = 0;

    for (const constraint of spec.constraints) {
      const r = applyConstraint(constraint, points, spec.entities);
      sumSq += r * r;
      count += 1;
    }

    residual = count === 0 ? 0 : Math.sqrt(sumSq / count);
    if (residual < 0.75) break;
  }

  // Pack into diagram zone if anything drifted.
  for (const point of points.values()) {
    const c = clamp(point.x, point.y);
    point.x = Math.round(c.x);
    point.y = Math.round(c.y);
  }

  return {
    points,
    residual: Number.isFinite(residual) ? residual : 999,
    ok: residual < 40 || spec.constraints.length === 0,
  };
}

function applyConstraint(
  constraint: SceneConstraint,
  points: Map<string, SolvedPoint>,
  entities: SceneEntity[],
): number {
  const ids = constraint.entities;
  switch (constraint.type) {
    case "distance": {
      const a = getPoint(points, ids[0]!);
      const b = getPoint(points, ids[1]!);
      if (!a || !b || constraint.value === undefined) return 0;
      const target = constraint.value;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const err = dist - target;
      const nx = dx / dist;
      const ny = dy / dist;
      const half = err * 0.5;
      if (!a.fixed) {
        a.x += nx * half;
        a.y += ny * half;
      }
      if (!b.fixed) {
        b.x -= nx * half;
        b.y -= ny * half;
      }
      return err;
    }
    case "midpoint": {
      const mid = getPoint(points, ids[0]!);
      const a = getPoint(points, ids[1]!);
      const b = getPoint(points, ids[2]!);
      if (!mid || !a || !b) return 0;
      const tx = (a.x + b.x) / 2;
      const ty = (a.y + b.y) / 2;
      const err = Math.hypot(mid.x - tx, mid.y - ty);
      if (!mid.fixed) {
        mid.x = tx;
        mid.y = ty;
      }
      return err;
    }
    case "on": {
      // Point on segment/circle — project onto line between endpoints when possible.
      const p = getPoint(points, ids[0]!);
      const hostId = ids[1];
      if (!p || !hostId) return 0;
      const host = entities.find((e) => e.id === hostId);
      if (!host) return 0;
      if (host.type === "circle" && host.center) {
        const c = getPoint(points, host.center);
        const r = typeof host.attrs?.r === "number" ? host.attrs.r : 80;
        if (!c) return 0;
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        const dist = Math.hypot(dx, dy) || 1;
        const err = dist - r;
        if (!p.fixed) {
          p.x = c.x + (dx / dist) * r;
          p.y = c.y + (dy / dist) * r;
        }
        return err;
      }
      if (host.from && host.to) {
        const a = getPoint(points, host.from);
        const b = getPoint(points, host.to);
        if (!a || !b) return 0;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
        const tx = a.x + t * dx;
        const ty = a.y + t * dy;
        const err = Math.hypot(p.x - tx, p.y - ty);
        if (!p.fixed) {
          p.x = tx;
          p.y = ty;
        }
        return err;
      }
      return 0;
    }
    case "perpendicular": {
      // Make AB ⊥ CD by rotating B around A slightly toward the perpendicular.
      const a = getPoint(points, ids[0]!);
      const b = getPoint(points, ids[1]!);
      const c = getPoint(points, ids[2]!);
      const d = getPoint(points, ids[3]!);
      if (!a || !b || !c || !d) return 0;
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const cdx = d.x - c.x;
      const cdy = d.y - c.y;
      const dot = abx * cdx + aby * cdy;
      const abLen = Math.hypot(abx, aby) || 1;
      const cdLen = Math.hypot(cdx, cdy) || 1;
      const err = dot / (abLen * cdLen);
      if (!b.fixed) {
        // Nudge B along the direction that reduces the dot product.
        b.x -= (cdx / cdLen) * err * 8;
        b.y -= (cdy / cdLen) * err * 8;
      }
      return err * 40;
    }
    case "parallel": {
      const a = getPoint(points, ids[0]!);
      const b = getPoint(points, ids[1]!);
      const c = getPoint(points, ids[2]!);
      const d = getPoint(points, ids[3]!);
      if (!a || !b || !c || !d) return 0;
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const cdx = d.x - c.x;
      const cdy = d.y - c.y;
      const cross = abx * cdy - aby * cdx;
      const abLen = Math.hypot(abx, aby) || 1;
      const cdLen = Math.hypot(cdx, cdy) || 1;
      const err = cross / (abLen * cdLen);
      if (!b.fixed) {
        b.x += (-aby / abLen) * err * 8;
        b.y += (abx / abLen) * err * 8;
      }
      return Math.abs(err) * 40;
    }
    case "left_of":
    case "right_of":
    case "above":
    case "below": {
      const a = getPoint(points, ids[0]!);
      const b = getPoint(points, ids[1]!);
      if (!a || !b) return 0;
      const gap = constraint.value ?? 40;
      let err = 0;
      if (constraint.type === "left_of" && !a.fixed) {
        err = a.x - (b.x - gap);
        if (err > 0) a.x = b.x - gap;
      } else if (constraint.type === "right_of" && !a.fixed) {
        err = b.x + gap - a.x;
        if (a.x < b.x + gap) a.x = b.x + gap;
      } else if (constraint.type === "above" && !a.fixed) {
        err = a.y - (b.y - gap);
        if (err > 0) a.y = b.y - gap;
      } else if (constraint.type === "below" && !a.fixed) {
        err = b.y + gap - a.y;
        if (a.y < b.y + gap) a.y = b.y + gap;
      }
      return err;
    }
    case "along_axis": {
      const p = getPoint(points, ids[0]!);
      if (!p || p.fixed) return 0;
      const axisY = constraint.value ?? ZONE.cy;
      const err = p.y - axisY;
      p.y = axisY;
      return err;
    }
    case "equal_length": {
      const a = getPoint(points, ids[0]!);
      const b = getPoint(points, ids[1]!);
      const c = getPoint(points, ids[2]!);
      const d = getPoint(points, ids[3]!);
      if (!a || !b || !c || !d) return 0;
      const len1 = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const len2 = Math.hypot(d.x - c.x, d.y - c.y) || 1;
      const target = (len1 + len2) / 2;
      const err = len1 - len2;
      if (!b.fixed) {
        const s = target / len1;
        b.x = a.x + (b.x - a.x) * s;
        b.y = a.y + (b.y - a.y) * s;
      }
      if (!d.fixed) {
        const s = target / len2;
        d.x = c.x + (d.x - c.x) * s;
        d.y = c.y + (d.y - c.y) * s;
      }
      return err;
    }
    case "angle": {
      // entities: [vertex, armA, armB], value = desired interior angle in degrees
      const vertex = getPoint(points, ids[0]!);
      const armA = getPoint(points, ids[1]!);
      const armB = getPoint(points, ids[2]!);
      if (!vertex || !armA || !armB || constraint.value === undefined) return 0;
      const ax = armA.x - vertex.x;
      const ay = armA.y - vertex.y;
      const bx = armB.x - vertex.x;
      const by = armB.y - vertex.y;
      const lenA = Math.hypot(ax, ay) || 1;
      const lenB = Math.hypot(bx, by) || 1;
      const current = Math.atan2(ay, ax);
      const other = Math.atan2(by, bx);
      let delta = other - current;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      const targetRad = (constraint.value * Math.PI) / 180;
      const err = delta - targetRad;
      if (!armB.fixed) {
        const next = current + targetRad;
        armB.x = vertex.x + Math.cos(next) * lenB;
        armB.y = vertex.y + Math.sin(next) * lenB;
      } else if (!armA.fixed) {
        const next = other - targetRad;
        armA.x = vertex.x + Math.cos(next) * lenA;
        armA.y = vertex.y + Math.sin(next) * lenA;
      }
      return err * 40;
    }
    case "intersect": {
      // entities: [resultPoint, line1a, line1b, line2a, line2b]
      // Place result at intersection of segments (line1a→line1b) and (line2a→line2b).
      const result = getPoint(points, ids[0]!);
      const a = getPoint(points, ids[1]!);
      const b = getPoint(points, ids[2]!);
      const c = getPoint(points, ids[3]!);
      const d = getPoint(points, ids[4]!);
      if (!result || !a || !b || !c || !d) return 0;
      const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
      if (Math.abs(den) < 1e-6) return 0;
      const t =
        ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
      const ix = a.x + t * (b.x - a.x);
      const iy = a.y + t * (b.y - a.y);
      const err = Math.hypot(result.x - ix, result.y - iy);
      if (!result.fixed) {
        result.x = ix;
        result.y = iy;
      }
      return err;
    }
    case "reflect": {
      // entities: [image, object, mirrorA, mirrorB] — reflect object across mirror line.
      const image = getPoint(points, ids[0]!);
      const object = getPoint(points, ids[1]!);
      const m0 = getPoint(points, ids[2]!);
      const m1 = getPoint(points, ids[3]!);
      if (!image || !object || !m0 || !m1) return 0;
      const dx = m1.x - m0.x;
      const dy = m1.y - m0.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = ((object.x - m0.x) * dx + (object.y - m0.y) * dy) / len2;
      const projX = m0.x + t * dx;
      const projY = m0.y + t * dy;
      const rx = 2 * projX - object.x;
      const ry = 2 * projY - object.y;
      const err = Math.hypot(image.x - rx, image.y - ry);
      if (!image.fixed) {
        image.x = rx;
        image.y = ry;
      }
      return err;
    }
    default:
      return 0;
  }
}

export { ZONE as SOLVER_ZONE };
