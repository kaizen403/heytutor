import type { Vec2 } from "../organic/layout";

/** A separate simple ring attached at one vertex; every edge retains unit length. */
export function attachedRingCoordinates(
  ring: readonly number[],
  first: number,
  at: Vec2,
  outward: Vec2,
): ReadonlyMap<number, Vec2> | null {
  const size = ring.length;
  const start = ring.indexOf(first);
  const length = Math.hypot(outward.x, outward.y);
  if (size < 3 || size > 8 || start < 0 || new Set(ring).size !== size
    || !ring.every((atom) => Number.isInteger(atom) && atom >= 0)
    || ![at.x, at.y, outward.x, outward.y].every(Number.isFinite) || length < 1e-9) return null;
  const radius = 1 / (2 * Math.sin(Math.PI / size));
  const radial = { x: -outward.x * radius / length, y: -outward.y * radius / length };
  const center = { x: at.x - radial.x, y: at.y - radial.y };
  const coordinates = new Map<number, Vec2>([[first, { ...at }]]);
  for (let step = 1; step < size; step++) {
    const angle = step * 2 * Math.PI / size;
    coordinates.set(ring[(start + step) % size]!, {
      x: center.x + radial.x * Math.cos(angle) - radial.y * Math.sin(angle),
      y: center.y + radial.x * Math.sin(angle) + radial.y * Math.cos(angle),
    });
  }
  return coordinates;
}
