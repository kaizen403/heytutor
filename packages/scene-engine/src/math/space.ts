/**
 * Axonometric 3D helpers for space_frame / space_point / space_line / plane.
 * Callers pass world (x, y, z); the compiler projects to the 2D canvas.
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

export interface SpaceFrame {
  readonly origin: Point2;
  readonly scale: number;
}

const ISO_COS = Math.sqrt(3) / 2;
const ISO_SIN = 0.5;
const EPSILON = 1e-9;

export function vec3(x: number, y: number, z: number): Vec3 {
  if (![x, y, z].every(Number.isFinite)) {
    throw new Error("space coordinates must be finite");
  }
  return { x, y, z };
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vec3Scale(a: Vec3, scalar: number): Vec3 {
  return { x: a.x * scalar, y: a.y * scalar, z: a.z * scalar };
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vec3Length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function vec3Normalize(a: Vec3, name = "space vector"): Vec3 {
  const length = vec3Length(a);
  if (!(length > EPSILON)) throw new Error(`${name} must be nonzero`);
  return vec3Scale(a, 1 / length);
}

/** Textbook isometric: x right-up, y up, z left-up. */
export function isometricProject(point: Vec3, frame: SpaceFrame): Point2 {
  const x = (point.x - point.z) * ISO_COS;
  const y = point.y + (point.x + point.z) * ISO_SIN;
  return {
    x: frame.origin.x + x * frame.scale,
    y: frame.origin.y + y * frame.scale,
  };
}

export function spaceFrameAxisTips(axisLength: number): readonly [Vec3, Vec3, Vec3] {
  if (!(axisLength > 0) || !Number.isFinite(axisLength)) {
    throw new Error("space_frame axisLength must be a positive finite number");
  }
  return [
    { x: axisLength, y: 0, z: 0 },
    { x: 0, y: axisLength, z: 0 },
    { x: 0, y: 0, z: axisLength },
  ];
}

/** Point on ax+by+cz=d plus an orthonormal spanning pair. */
export function planeFromCartesian(
  a: number,
  b: number,
  c: number,
  d: number,
): { point: Vec3; u: Vec3; v: Vec3 } {
  const normal = vec3Normalize({ x: a, y: b, z: c }, "plane normal");
  const point = Math.abs(c) >= Math.abs(a) && Math.abs(c) >= Math.abs(b)
    ? { x: 0, y: 0, z: d / c }
    : Math.abs(b) >= Math.abs(a)
      ? { x: 0, y: d / b, z: 0 }
      : { x: d / a, y: 0, z: 0 };
  const helper = Math.abs(normal.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = vec3Normalize(vec3Cross(normal, helper), "plane spanning vector");
  const v = vec3Cross(normal, u);
  return { point, u, v };
}

export function planePatchCorners(
  point: Vec3,
  u: Vec3,
  v: Vec3,
  uSpan: number,
  vSpan: number,
): [Vec3, Vec3, Vec3, Vec3] {
  if (!(uSpan > 0) || !(vSpan > 0) || !Number.isFinite(uSpan) || !Number.isFinite(vSpan)) {
    throw new Error("plane spans must be positive finite numbers");
  }
  if (!(vec3Length(vec3Cross(u, v)) > EPSILON)) {
    throw new Error("plane spanning vectors must be linearly independent");
  }
  const halfU = vec3Scale(u, uSpan / 2);
  const halfV = vec3Scale(v, vSpan / 2);
  return [
    vec3Add(vec3Add(point, halfU), halfV),
    vec3Add(vec3Sub(point, halfU), halfV),
    vec3Sub(vec3Sub(point, halfU), halfV),
    vec3Add(vec3Sub(point, halfV), halfU),
  ];
}
