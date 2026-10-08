import type { RenderPoint } from "../types";
import { hypot2, invalid, unit2 } from "./sourceScalars";

export type NetworkBranchKind = "resistor" | "source" | "wire" | "open" | "detector";

function detectorRing(center: RenderPoint, direction: RenderPoint, normal: RenderPoint, radius: number): RenderPoint[] {
  const samples = 16;
  const ring = Array.from({ length: samples }, (_, index) => {
    const angle = (2 * Math.PI * index) / samples;
    return {
      x: center.x + direction.x * radius * Math.cos(angle) + normal.x * radius * Math.sin(angle),
      y: center.y + direction.y * radius * Math.cos(angle) + normal.y * radius * Math.sin(angle),
    };
  });
  const first = ring[0];
  if (!first) invalid("detector", "a detector ring needs a center");
  return [...ring, first];
}

/** Branch ink. A detector is a ring on its own leads, never a renamed wire. */
export function branchGlyph(kind: NetworkBranchKind, start: RenderPoint, end: RenderPoint, lane: number, emf = 0): RenderPoint[][] {
  const span = hypot2({ x: end.x - start.x, y: end.y - start.y });
  if (!(span > 1e-6)) invalid("branches", "branch terminals must be distinct");
  const direction = unit2({ x: end.x - start.x, y: end.y - start.y }, "branch");
  const normal = { x: -direction.y, y: direction.x };
  const place = (along: number, across = 0): RenderPoint => ({
    x: start.x + direction.x * span * along + normal.x * (across + lane),
    y: start.y + direction.y * span * along + normal.y * (across + lane),
  });
  const connectTerminals = (paths: RenderPoint[][]): RenderPoint[][] => lane === 0
    ? paths
    : [[start, place(0)], ...paths, [place(1), end]];
  if (kind === "wire") return connectTerminals([[place(0), place(1)]]);
  if (kind === "open") return connectTerminals([[place(0), place(0.42)], [place(0.58), place(1)]]);
  if (kind === "source") {
    const longAt = emf >= 0 ? 0.58 : 0.42;
    const shortAt = emf >= 0 ? 0.42 : 0.58;
    return connectTerminals([
      [place(0), place(0.42)],
      [place(longAt, -0.22), place(longAt, 0.22)],
      [place(shortAt, -0.11), place(shortAt, 0.11)],
      [place(0.58), place(1)],
    ]);
  }
  if (kind === "detector") {
    const radius = Math.min(0.22, span * 0.18);
    const edge = radius / span;
    return connectTerminals([[place(0), place(0.5 - edge)], detectorRing(place(0.5), direction, normal, radius), [place(0.5 + edge), place(1)]]);
  }
  return connectTerminals([[
    place(0), place(0.18),
    place(0.28, 0.16), place(0.4, -0.16), place(0.52, 0.16), place(0.64, -0.16), place(0.76, 0.16),
    place(0.82), place(1),
  ]]);
}
