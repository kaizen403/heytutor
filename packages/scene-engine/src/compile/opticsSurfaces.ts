/**
 * Spherical surfaces and thin-lens sections from signed Cartesian radii.
 *
 * Light travels in the +axis direction (object space on the negative side).
 * A positive radius puts the centre of curvature downstream of the vertex,
 * so the surface bulges toward the incident light (convex). A negative
 * radius puts the centre upstream (concave). Infinite radius is a plane.
 *
 * Geometry only — no topic templates, no pixels.
 */

export interface OpticsPoint {
  x: number;
  y: number;
}

export type SphericalSurfaceKind = "convex" | "concave" | "plano";

export interface SphericalSurfaceSpec {
  vertex: OpticsPoint;
  axisFrom: OpticsPoint;
  axisTo: OpticsPoint;
  halfHeight: number;
  center?: OpticsPoint;
  signedRadius?: number;
  kind?: SphericalSurfaceKind;
}

export type SphericalSurfaceGeometry =
  | { kind: "arc"; center: OpticsPoint; radius: number; startAngle: number; endAngle: number }
  | { kind: "path"; points: [OpticsPoint, OpticsPoint] };

export interface LensSectionSpec {
  center: OpticsPoint;
  axisFrom: OpticsPoint;
  axisTo: OpticsPoint;
  radius1: number;
  radius2: number;
  halfHeight: number;
  thickness?: number;
}

const EPSILON = 1e-9;
const PLANO_RATIO = 40;
const ARC_SAMPLES = 24;

export function axisDirection(from: OpticsPoint, to: OpticsPoint): OpticsPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const span = Math.hypot(dx, dy) || 1;
  const hat = { x: dx / span, y: dy / span };
  return hat.x < 0 ? { x: -hat.x, y: -hat.y } : hat;
}

export function perpendicular(hat: OpticsPoint): OpticsPoint {
  return { x: -hat.y, y: hat.x };
}

export function sagOf(signedRadius: number, halfHeight: number): number {
  if (isPlano(signedRadius, halfHeight)) return 0;
  const radius = Math.abs(signedRadius);
  const height = Math.min(halfHeight, 0.95 * radius);
  return radius - Math.sqrt(Math.max(0, radius * radius - height * height));
}

export function isPlano(signedRadius: number, halfHeight: number): boolean {
  if (!Number.isFinite(signedRadius)) return true;
  return Math.abs(signedRadius) > PLANO_RATIO * Math.max(halfHeight, EPSILON);
}

export function resolveSignedRadius(spec: SphericalSurfaceSpec, hat: OpticsPoint): number {
  if (spec.center) {
    const inferred =
      (spec.center.x - spec.vertex.x) * hat.x + (spec.center.y - spec.vertex.y) * hat.y;
    if (Math.abs(inferred) > EPSILON) return inferred;
  }
  if (typeof spec.signedRadius === "number" && Number.isFinite(spec.signedRadius)) {
    return spec.signedRadius;
  }
  if (spec.kind === "plano") return Number.POSITIVE_INFINITY;
  const display = 2.8 * spec.halfHeight;
  if (spec.kind === "concave") return -display;
  return display;
}

export function sphericalSurfaceGeometry(spec: SphericalSurfaceSpec): SphericalSurfaceGeometry {
  if (!(spec.halfHeight > 0)) throw new Error("spherical_surface halfHeight must be positive");
  const hat = axisDirection(spec.axisFrom, spec.axisTo);
  const signedRadius = resolveSignedRadius(spec, hat);
  if (isPlano(signedRadius, spec.halfHeight)) {
    const perp = perpendicular(hat);
    return {
      kind: "path",
      points: [
        {
          x: spec.vertex.x + perp.x * spec.halfHeight,
          y: spec.vertex.y + perp.y * spec.halfHeight,
        },
        {
          x: spec.vertex.x - perp.x * spec.halfHeight,
          y: spec.vertex.y - perp.y * spec.halfHeight,
        },
      ],
    };
  }
  const radius = Math.abs(signedRadius);
  const height = Math.min(spec.halfHeight, 0.95 * radius);
  const center = spec.center ?? {
    x: spec.vertex.x + hat.x * signedRadius,
    y: spec.vertex.y + hat.y * signedRadius,
  };
  const fromCenter = { x: spec.vertex.x - center.x, y: spec.vertex.y - center.y };
  const vertexAngle = Math.atan2(fromCenter.y, fromCenter.x);
  const halfAngle = Math.asin(height / radius);
  return {
    kind: "arc",
    center,
    radius,
    startAngle: vertexAngle - halfAngle,
    endAngle: vertexAngle + halfAngle,
  };
}

export function lensSectionOutline(spec: LensSectionSpec): OpticsPoint[] {
  if (!(spec.halfHeight > 0)) throw new Error("lens_section halfHeight must be positive");
  const hat = axisDirection(spec.axisFrom, spec.axisTo);
  const height = spec.halfHeight;
  const sag1 = sagOf(spec.radius1, height);
  const sag2 = sagOf(spec.radius2, height);
  const thickness = spec.thickness !== undefined && spec.thickness > 0
    ? spec.thickness
    : sag1 + sag2 + Math.max(0.12 * height, 0.35);
  const vertex1 = {
    x: spec.center.x - hat.x * thickness / 2,
    y: spec.center.y - hat.y * thickness / 2,
  };
  const vertex2 = {
    x: spec.center.x + hat.x * thickness / 2,
    y: spec.center.y + hat.y * thickness / 2,
  };
  const left = surfacePoints(vertex1, spec.radius1, hat, height);
  const right = surfacePoints(vertex2, spec.radius2, hat, height);
  return [...left, ...right.slice().reverse()];
}

function surfacePoints(
  vertex: OpticsPoint,
  signedRadius: number,
  hat: OpticsPoint,
  halfHeight: number,
): OpticsPoint[] {
  const perp = perpendicular(hat);
  const points: OpticsPoint[] = [];
  const plano = isPlano(signedRadius, halfHeight);
  const radius = Math.abs(signedRadius);
  const center = {
    x: vertex.x + hat.x * (plano ? 0 : signedRadius),
    y: vertex.y + hat.y * (plano ? 0 : signedRadius),
  };
  for (let index = 0; index <= ARC_SAMPLES; index += 1) {
    const y = halfHeight * (1 - 2 * index / ARC_SAMPLES);
    if (plano) {
      points.push({
        x: vertex.x + perp.x * y,
        y: vertex.y + perp.y * y,
      });
      continue;
    }
    const clamped = Math.max(-0.95 * radius, Math.min(0.95 * radius, y));
    const along = -Math.sign(signedRadius) * Math.sqrt(Math.max(0, radius * radius - clamped * clamped));
    points.push({
      x: center.x + hat.x * along + perp.x * clamped,
      y: center.y + hat.y * along + perp.y * clamped,
    });
  }
  return points;
}
