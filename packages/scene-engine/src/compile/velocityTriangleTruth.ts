import type { SceneDocument, SceneIssue } from "../types";
import { motionUnitFactor } from "../physics/motionPlanAgreement";
import { convertMeasuredValue } from "../contracts/contractsV3";

type Point = { x: number; y: number };
type Path = {
  kind: "path";
  points: Point[];
  spaceLine?: unknown;
  spaceSegment?: unknown;
};
const symbolKey = (value: unknown) =>
  typeof value === "string"
    ? value
        .normalize("NFKC")
        .replace(/\\(?:mathrm|text)\b/g, "")
        .replace(/[\s_{}$]/g, "")
    : "";

/** A connected velocity triangle has one scale, even in a qualitative scene. */
export function validateVelocityTriangleTruth(
  document: SceneDocument,
  geometry: ReadonlyMap<string, unknown>,
): SceneIssue[] {
  const vectors = document.entities.flatMap((entity) => {
    if (entity.kind !== "vector") return [];
    const path = geometry.get(entity.id) as Path | undefined;
    // A spatial projection need not preserve lengths; this checks planar vectors.
    if (
      path?.kind !== "path" ||
      path.points.length !== 2 ||
      path.spaceLine ||
      path.spaceSegment
    )
      return [];
    const label = symbolKey(entity.label?.split(/[=≈]/)[0]);
    const quantityIds = document.annotations
      .filter(
        (annotation) =>
          ["label", "callout", "badge"].includes(annotation.kind) &&
          annotation.targetIds.length === 1 &&
          annotation.targetIds[0] === entity.id,
      )
      .map((annotation) => annotation.quantityId);
    const named = document.quantities.filter(
      (q) =>
        label && [q.id, q.symbol].some((name) => symbolKey(name) === label),
    );
    // An added annotation cannot erase a unique native-symbol obligation.
    const matches =
      named.length === 1
        ? named
        : document.quantities.filter((q) => quantityIds.includes(q.id));
    const q = matches.length === 1 ? matches[0] : undefined;
    const unit = motionUnitFactor(q?.unit);
    const si =
      q && typeof q.value === "number" && Number.isFinite(q.value)
        ? unit?.dimension === "velocity"
          ? q.value * unit.factor
          : convertMeasuredValue(q.value, q.unit, "m/s")
        : null;
    const speed = si !== null && Number.isFinite(si) ? Math.abs(si) : null;
    const [start, end] = path.points as [Point, Point];
    const construction = document.constructions.find(
      (c) => c.operator === "vector" && c.outputs.includes(entity.id),
    );
    const ref = (names: string[]) =>
      names
        .map((name) => construction?.inputs[name])
        .find((value) => value !== undefined);
    const tail = ref(["start", "from", "a", "origin"]),
      head = ref(["end", "to", "b"]);
    return [
      {
        id: entity.id,
        start,
        end,
        tail,
        head,
        length: Math.hypot(end.x - start.x, end.y - start.y),
        speed,
      },
    ];
  });
  const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) <= 1e-7;
  type Vector = (typeof vectors)[number];
  const byRefs = new Map<string, Vector[]>(),
    byPoints = new Map<string, Vector[]>();
  const bins = (a: Point, b: Point) =>
    [a.x, a.y, b.x, b.y].map((n) => Math.floor(n / 1e-7));
  for (const v of vectors) {
    const pointKey = bins(v.start, v.end).join(",");
    byPoints.set(pointKey, [...(byPoints.get(pointKey) ?? []), v]);
    if (typeof v.tail === "string" && typeof v.head === "string") {
      const key = JSON.stringify([v.tail, v.head]);
      byRefs.set(key, [...(byRefs.get(key) ?? []), v]);
    }
  }
  const resultants = (a: Vector, b: Vector) => {
    const found = new Set(
      typeof a.tail === "string" && typeof b.head === "string"
        ? (byRefs.get(JSON.stringify([a.tail, b.head])) ?? [])
        : [],
    );
    const coordinates = bins(a.start, b.end);
    // Adjacent bins preserve the geometric tolerance at bin boundaries.
    for (const dx of [-1, 0, 1])
      for (const dy of [-1, 0, 1])
        for (const ex of [-1, 0, 1])
          for (const ey of [-1, 0, 1]) {
            const key = coordinates
              .map((n, i) => n + [dx, dy, ex, ey][i]!)
              .join(",");
            for (const v of byPoints.get(key) ?? []) found.add(v);
          }
    return [...found];
  };
  const issues: SceneIssue[] = [];
  const checked = new Set<string>();
  for (const a of vectors)
    for (const b of vectors) {
      if (
        a.id === b.id ||
        a.speed === null ||
        b.speed === null ||
        a.speed === 0 ||
        b.speed === 0
      )
        continue;
      if (
        !same(a.end, b.start) &&
        !(typeof a.head === "string" && a.head === b.tail)
      )
        continue;
      for (const resultant of resultants(a, b).filter(
        (r) =>
          r.id !== a.id &&
          r.id !== b.id &&
          ((same(a.end, b.start) &&
            same(r.start, a.start) &&
            same(r.end, b.end)) ||
            (typeof a.tail === "string" &&
              typeof a.head === "string" &&
              typeof b.head === "string" &&
              a.head === b.tail &&
              r.tail === a.tail &&
              r.head === b.head)),
      )) {
        const triangle = [a, b, resultant];
        const key = triangle
          .map((v) => v.id)
          .sort()
          .join("\0");
        if (checked.has(key)) continue;
        checked.add(key);
        const mismatch =
          !same(a.end, b.start) ||
          !same(resultant.start, a.start) ||
          !same(resultant.end, b.end) ||
          triangle.some(
            (v) =>
              v.speed !== null &&
              Math.abs(v.length * a.speed! - a.length * v.speed) >
                5e-3 * Math.max(v.length * a.speed!, a.length * v.speed, 1e-9),
          );
        if (mismatch)
          issues.push({
            code: "velocity_triangle_scale_mismatch",
            severity: "fatal",
            failureKind: "truth",
            entityIds: triangle.map((v) => v.id),
            message:
              "A velocity triangle must close and use one scale for its named speed quantities.",
          });
      }
    }
  return issues;
}
