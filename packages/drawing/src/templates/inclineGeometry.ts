/**
 * Deterministic incline-plane geometry for diagram templates.
 * Canvas uses y-down coordinates; ground is the horizontal base at the bottom.
 */

export interface InclineTriangle {
  baseLeft: [number, number];
  baseRight: [number, number];
  topRight: [number, number];
  angleDeg: number;
}

export interface SphereOnIncline {
  center: [number, number];
  contact: [number, number];
  radius: number;
}

export interface BlockOnIncline {
  corners: [[number, number], [number, number], [number, number], [number, number]];
  center: [number, number];
}

function round(n: number): number {
  return Math.round(n);
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Slope unit vector (up the ramp, left → right). */
export function inclineUnit(angleDeg: number): [number, number] {
  const t = degToRad(angleDeg);
  return [Math.cos(t), -Math.sin(t)];
}

/** Outward normal pointing above the ramp surface (y-down canvas). */
export function inclineOutwardNormal(angleDeg: number): [number, number] {
  const t = degToRad(angleDeg);
  return [-Math.sin(t), -Math.cos(t)];
}

export function buildInclineTriangle(
  baseLeftX: number,
  baseY: number,
  baseLength: number,
  angleDeg = 30,
): InclineTriangle {
  const rise = baseLength * Math.tan(degToRad(angleDeg));
  return {
    baseLeft: [baseLeftX, baseY],
    baseRight: [baseLeftX + baseLength, baseY],
    topRight: [baseLeftX + baseLength, round(baseY - rise)],
    angleDeg,
  };
}

export function pointOnIncline(tri: InclineTriangle, fraction: number): [number, number] {
  const [x1, y1] = tri.baseLeft;
  const [x2, y2] = tri.topRight;
  return [x1 + (x2 - x1) * fraction, y1 + (y2 - y1) * fraction];
}

export function placeSphereOnIncline(
  tri: InclineTriangle,
  fraction: number,
  radius: number,
): SphereOnIncline {
  const contact = pointOnIncline(tri, fraction);
  const [nx, ny] = inclineOutwardNormal(tri.angleDeg);
  return {
    contact: [round(contact[0]), round(contact[1])],
    center: [round(contact[0] + nx * radius), round(contact[1] + ny * radius)],
    radius,
  };
}

export function placeBlockOnIncline(
  tri: InclineTriangle,
  fraction: number,
  widthAlongSlope: number,
  heightPerpendicular: number,
): BlockOnIncline {
  const contactMid = pointOnIncline(tri, fraction);
  const [ux, uy] = inclineUnit(tri.angleDeg);
  const [nx, ny] = inclineOutwardNormal(tri.angleDeg);
  const halfW = widthAlongSlope / 2;
  const halfH = heightPerpendicular / 2;
  const cx = contactMid[0] + nx * halfH;
  const cy = contactMid[1] + ny * halfH;
  const center: [number, number] = [round(cx), round(cy)];

  const corners: BlockOnIncline["corners"] = [
    [round(cx - ux * halfW + nx * halfH), round(cy - uy * halfW + ny * halfH)],
    [round(cx + ux * halfW + nx * halfH), round(cy + uy * halfW + ny * halfH)],
    [round(cx + ux * halfW - nx * halfH), round(cy + uy * halfW - ny * halfH)],
    [round(cx - ux * halfW - nx * halfH), round(cy - uy * halfW - ny * halfH)],
  ];

  return { corners, center };
}

/** Two short lines marking angle θ at the base-left vertex. */
export function angleMarkerAtBase(
  tri: InclineTriangle,
  tickLength = 44,
): [[number, number, number, number], [number, number, number, number]] {
  const [ax, ay] = tri.baseLeft;
  const [ux, uy] = inclineUnit(tri.angleDeg);
  return [
    [round(ax + tickLength), ay, ax, ay],
    [round(ax + ux * tickLength), round(ay + uy * tickLength), ax, ay],
  ];
}

/** Distance from point to the incline segment (for verification). */
export function distanceToIncline(tri: InclineTriangle, px: number, py: number): number {
  const [x1, y1] = tri.baseLeft;
  const [x2, y2] = tri.topRight;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (len * len)));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}
