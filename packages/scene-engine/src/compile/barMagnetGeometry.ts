import type { RenderPoint } from "../types";
import { add2, hypot2, unit2 } from "./sourceScalars";

export interface BarMagnetFigure {
  readonly bar: readonly RenderPoint[];
  readonly north: RenderPoint;
  readonly south: RenderPoint;
  readonly lobes: readonly (readonly RenderPoint[])[];
}

function scale(point: RenderPoint, factor: number): RenderPoint {
  return { x: point.x * factor, y: point.y * factor };
}

function bezier(start: RenderPoint, control1: RenderPoint, control2: RenderPoint, end: RenderPoint): RenderPoint[] {
  return Array.from({ length: 25 }, (_, index) => {
    const t = index / 24;
    const u = 1 - t;
    return {
      x: u * u * u * start.x + 3 * u * u * t * control1.x + 3 * u * t * t * control2.x + t * t * t * end.x,
      y: u * u * u * start.y + 3 * u * u * t * control1.y + 3 * u * t * t * control2.y + t * t * t * end.y,
    };
  });
}

/**
 * External field line. It leaves the north face going outward and enters the
 * south face from outside, so it does not cross the bar.
 */
function externalLoop(origin: RenderPoint, axis: RenderPoint, normal: RenderPoint, faceOffset: number, bulge: number): RenderPoint[] {
  const north = add2(origin, scale(axis, 0.7), "north");
  const south = add2(origin, scale(axis, -0.7), "south");
  const start = add2(north, scale(normal, faceOffset), "start");
  const end = add2(south, scale(normal, faceOffset), "end");
  const control1 = add2(add2(north, scale(axis, bulge), "out"), scale(normal, faceOffset + bulge), "lift");
  const control2 = add2(add2(south, scale(axis, -bulge), "out"), scale(normal, faceOffset + bulge), "lift");
  return bezier(start, control1, control2, end);
}

/**
 * Finite bar magnet. Field lines leave the north face and enter the south face
 * outside the bar. They are not chords through the centre.
 */
export function barMagnetFigure(origin: RenderPoint, moment: RenderPoint, displayScale: number): BarMagnetFigure {
  const axis = unit2(moment, "moment");
  const north = add2(origin, scale(axis, 0.7), "north");
  const south = add2(origin, scale(axis, -0.7), "south");
  const bar = [
    add2(origin, { x: -axis.x * 0.7 - axis.y * 0.18, y: -axis.y * 0.7 + axis.x * 0.18 }, "bar"),
    add2(origin, { x: axis.x * 0.7 - axis.y * 0.18, y: axis.y * 0.7 + axis.x * 0.18 }, "bar"),
    add2(origin, { x: axis.x * 0.7 + axis.y * 0.18, y: axis.y * 0.7 - axis.x * 0.18 }, "bar"),
    add2(origin, { x: -axis.x * 0.7 + axis.y * 0.18, y: -axis.y * 0.7 - axis.x * 0.18 }, "bar"),
  ];
  const lobes = [0.55, 0.95].flatMap((bulge) => [-1, 1].map((side) => {
    const normal = { x: -axis.y * side, y: axis.x * side };
    const faceOffset = bulge < 0.7 ? 0.14 : 0.04;
    return externalLoop(origin, axis, normal, faceOffset * displayScale, bulge * displayScale);
  }));
  if (hypot2(moment) === 0) return { bar, north, south, lobes };
  return { bar, north, south, lobes };
}
