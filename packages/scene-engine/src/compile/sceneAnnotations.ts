/**
 * Compile scene-owned annotation kinds into render primitives.
 * Paths come from already-compiled target geometry — never from model pixels.
 */

import {
  SCENE_ANNOTATION_KINDS,
  type RenderPoint,
  type RenderPrimitive,
  type SceneAnnotation,
  type SceneAnnotationKind,
  type SceneDocument,
  type SceneIssue,
} from "../types";
import {
  bracePoints,
  congruenceCount,
  congruenceTickSegments,
  dropToAxes,
  encloseBounds,
  endpointMark,
  extendSegment,
  hatchRegion,
  hatchSegments,
  inflateClosedPath,
  localFrame,
  offsetClone,
  parallelChevrons,
  projectToSegment,
  rectanglePoints,
  senseArrows,
  signBadgeGeometry,
  slopeTriangle,
} from "./annotationMarks";

const TEXT_KINDS = new Set<string>(["label", "callout", "narration"]);
const TRANSIENT_DEFAULT = new Set<SceneAnnotationKind>(["enclose", "trace", "badge", "spin"]);
const INDIVIDUAL_TARGET_MARKS = new Set<SceneAnnotationKind>(["equal_tick", "equal_arc", "parallel_mark", "endpoint"]);

export function isSceneAnnotationKind(kind: string): kind is SceneAnnotationKind {
  return (SCENE_ANNOTATION_KINDS as readonly string[]).includes(kind);
}

export function appendCompiledAnnotations(
  document: SceneDocument,
  primitives: RenderPrimitive[],
  entityToGroup: Map<string, string>,
  issues: SceneIssue[],
  anchorPrimitives: RenderPrimitive[] = [],
  slopeAnchors: ReadonlyMap<string, readonly [RenderPoint, RenderPoint]> = new Map(),
): void {
  for (const annotation of document.annotations) {
    if (TEXT_KINDS.has(annotation.kind)) continue;
    if (!isSceneAnnotationKind(annotation.kind)) {
      issues.push({
        code: "unknown_annotation_kind",
        message: `Unsupported annotation kind ${annotation.kind}`,
        severity: "fatal",
        entityIds: [annotation.id],
      });
      continue;
    }
    const targets = targetPrimitives(annotation, document, [...primitives, ...anchorPrimitives]);
    if (targets.length === 0) {
      issues.push({
        code: "annotation_target_unrendered",
        message: `Annotation ${annotation.id} target is not rendered`,
        severity: "fatal",
        entityIds: [annotation.id, ...annotation.targetIds],
      });
      continue;
    }
    const groupId = groupFor(annotation, entityToGroup);
    if (!groupId) {
      issues.push({
        code: "annotation_target_unrendered",
        message: `Annotation ${annotation.id} has no reveal group`,
        severity: "fatal",
        entityIds: [annotation.id],
      });
      continue;
    }
    const transient = annotation.style?.transient ?? TRANSIENT_DEFAULT.has(annotation.kind);
    const provenance = {
      annotation: annotation.kind,
      annotationId: annotation.id,
      transient,
      dashed: annotation.kind === "enclose" || annotation.kind === "trace" || annotation.kind === "loop"
        || annotation.kind === "ghost" || annotation.kind === "extend" || annotation.kind === "drop",
      strokeRole: transient || annotation.kind === "enclose" || annotation.kind === "trace"
        ? "trace"
        : "construction",
    };
    const individualMarks = INDIVIDUAL_TARGET_MARKS.has(annotation.kind);
    const targetSets = individualMarks
      ? [...new Set(targets.map((target) => target.entityId))].map((id) => targets.filter((target) => target.entityId === id))
      : [targets];
    const extra = targetSets.flatMap((targetSet) => {
      const marks = geometryFor(annotation, targetSet, document, slopeAnchors.get(annotation.id));
      // One arc is the existing verified arc, so count=1 needs no extra ink.
      const existingArc = annotation.kind === "equal_arc" && (annotation.style?.count ?? 1) === 1 && targetSet.some((target) => target.kind === "arc");
      if (marks.length === 0 && !existingArc) {
        issues.push({ code: "annotation_geometry_unresolved", message: `Annotation ${annotation.id} cannot mark its target geometry`, severity: "fatal", entityIds: [annotation.id, ...targetSet.map((target) => target.entityId)] });
      }
      // A repeated mark belongs to each target's reveal. Keep a later edge's
      // tick or endpoint from appearing while that edge is still hidden.
      const markGroupId = individualMarks
        ? targetSet[0]?.groupId ?? groupId
        : groupId;
      return marks.map((primitive) => ({ primitive, groupId: markGroupId }));
    });
    extra.forEach(({ primitive, groupId: markGroupId }, index) => {
      primitives.push({
        ...primitive,
        id: `${annotation.id}_${index}`,
        entityId: annotation.id,
        groupId: markGroupId,
        provenance: { ...provenance, ...primitive.provenance },
      });
    });
    entityToGroup.set(annotation.id, groupId);
  }
}

function targetPrimitives(
  annotation: SceneAnnotation,
  document: SceneDocument,
  primitives: RenderPrimitive[],
): RenderPrimitive[] {
  const ids = new Set(annotation.targetIds);
  for (const group of document.revealGroups) {
    if (ids.has(group.id)) group.entityIds.forEach((id) => ids.add(id));
  }
  return primitives.filter((primitive) =>
    ids.has(primitive.entityId) && primitive.kind !== "label" && primitive.provenance?.measurementRole !== "witness" && primitive.provenance?.annotationId !== annotation.id,
  );
}

function groupFor(annotation: SceneAnnotation, entityToGroup: Map<string, string>): string | undefined {
  for (const id of annotation.targetIds) {
    const groupId = entityToGroup.get(id);
    if (groupId) return groupId;
  }
  return undefined;
}

function geometryFor(annotation: SceneAnnotation, targets: RenderPrimitive[], document: SceneDocument, slopeAnchors?: readonly [RenderPoint, RenderPoint]): Omit<RenderPrimitive, "id" | "entityId" | "groupId">[] {
  const count = congruenceCount(annotation.style?.count ?? 1);
  const ink = targets;
  const points = ink.flatMap((primitive) => primitive.points);
  const extentPoints = ink.flatMap(annotationExtentPoints);
  if (points.length === 0) return [];
  switch (annotation.kind) {
    case "enclose": {
      const bounds = encloseBounds(extentPoints, ink.some((primitive) => primitive.kind === "point") ? 10 : 8);
      return [{
        kind: "rectangle",
        points: rectanglePoints(bounds),
        provenance: { annotation: "enclose" },
      }];
    }
    case "highlight": {
      const closed = ink.find((primitive) => primitive.kind === "polygon" || primitive.kind === "rectangle");
      if (closed && closed.points.length >= 3) {
        return [{
          kind: closed.kind,
          points: closed.points,
          provenance: { annotation: "highlight", fillRole: "region" },
        }];
      }
      const bounds = encloseBounds(extentPoints, 4);
      return [{
        kind: "rectangle",
        points: rectanglePoints(bounds),
        provenance: { annotation: "highlight", fillRole: "region" },
      }];
    }
    case "trace":
      return ink.flatMap((primitive) => [{
        kind: primitive.kind,
        points: primitive.points,
        radius: primitive.radius,
        startAngle: primitive.startAngle,
        endAngle: primitive.endAngle,
        provenance: { annotation: "trace", strokeRole: "trace" },
      }]);
    case "badge": {
      const anchor = points[0] ?? { x: 0, y: 0 };
      return [{
        kind: "point",
        points: [anchor],
        text: (annotation.text ?? "1").slice(0, 2),
        labelPlacement: "automatic",
        provenance: { annotation: "badge" },
      }];
    }
    case "spin": {
      const path = lineEnds(ink);
      if (!path) return [];
      const badge = signBadgeGeometry(path, annotation.text ?? "clockwise");
      return badge.paths.map((segment) => ({
        kind: "polyline" as const,
        points: segment,
        provenance: { annotation: "spin", strokeRole: "construction" },
      }));
    }
    case "equal_tick": {
      const path = straightLineEnds(ink);
      if (!path) return [];
      return congruenceTickSegments(path.start, path.end, count).map((segment) => ({
        kind: "line" as const,
        points: segment,
        provenance: { annotation: "equal_tick", strokeRole: "construction", correspondingFamily: count },
      }));
    }
    case "equal_arc": {
      const arc = ink.find((primitive) => primitive.kind === "arc" && primitive.radius);
      if (!arc?.radius || arc.startAngle === undefined || arc.endAngle === undefined) return [];
      const extra = count - 1;
      return Array.from({ length: Math.max(0, extra) }, (_, index) => ({
        kind: "arc" as const,
        points: arc.points,
        radius: arc.radius! + (index + 1) * Math.max(arc.radius! * 0.16, 6),
        startAngle: arc.startAngle,
        endAngle: arc.endAngle,
        provenance: { annotation: "equal_arc" },
      }));
    }
    case "parallel_mark": {
      const path = straightLineEnds(ink);
      if (!path) return [];
      return parallelChevrons(path.start, path.end, count).map((segment) => ({
        kind: "polyline" as const,
        points: segment,
        provenance: { annotation: "parallel_mark", strokeRole: "construction" },
      }));
    }
    case "hatch": {
      const closed = ink.find((primitive) => primitive.kind === "polygon" || primitive.kind === "rectangle");
      const segments = closed && closed.points.length >= 3
        ? hatchRegion(closed.points)
        : (() => {
            const path = lineEnds(ink);
            return path ? hatchSegments(path.start, path.end) : [];
          })();
      return segments.map((segment) => ({
        kind: "line" as const,
        points: segment,
        provenance: { annotation: "hatch", strokeRole: "construction" },
      }));
    }
    case "brace": {
      const path = lineEnds(ink);
      if (!path) return [];
      const brace = bracePoints(path.start, path.end);
      const result: Omit<RenderPrimitive, "id" | "entityId" | "groupId">[] = [{
        kind: "polyline",
        points: brace,
        provenance: { annotation: "brace", strokeRole: "construction" },
      }];
      if (annotation.text) {
        const mid = brace[2] ?? { x: (path.start.x + path.end.x) / 2, y: (path.start.y + path.end.y) / 2 };
        result.push({
          kind: "label",
          points: [mid],
          text: annotation.text.slice(0, 16),
          labelPlacement: "absolute",
          provenance: { annotation: "brace" },
        });
      }
      return result;
    }
    case "endpoint": {
      const point = ink.find((primitive) => primitive.kind === "point")?.points[0]
        ?? points[0];
      if (!point) return [];
      const style = annotation.style?.pointStyle ?? "open";
      return endpointMark(point, style).map((mark) => ({
        kind: mark.kind === "rectangle" ? "rectangle" : mark.kind === "circle" ? "circle" : mark.kind === "point" ? "point" : "line",
        points: mark.points,
        radius: mark.radius,
        provenance: { annotation: "endpoint", pointStyle: style },
      }));
    }
    case "loop": {
      const closed = ink.find((primitive) =>
        primitive.kind === "polygon" || primitive.kind === "rectangle" || (primitive.kind === "polyline" && primitive.points.length > 3),
      );
      const ring = closed ? inflateClosedPath(closed.points) : inflateClosedPath(convexHull(extentPoints));
      if (ring.length < 3) {
        const bounds = encloseBounds(extentPoints, 14);
        return [{ kind: "rectangle", points: rectanglePoints(bounds), provenance: { annotation: "loop" } }];
      }
      return [{
        kind: "polygon",
        points: ring,
        provenance: { annotation: "loop", dashed: true, strokeRole: "construction" },
      }];
    }
    case "sense": {
      const path = lineEnds(ink);
      if (!path) return [];
      return senseArrows(path.start, path.end, count).map((segment) => ({
        kind: "polyline" as const,
        points: segment,
        provenance: { annotation: "sense", strokeRole: "construction" },
      }));
    }
    case "drop": {
      const point = ink.find((primitive) => primitive.kind === "point")?.points[0]
        ?? points[0];
      if (!point) return [];
      const axes = ink.find((primitive) => primitive.kind === "axes");
      const dropped = axes && axes.points.length >= 4
        ? dropToAxes(point, axes.points)
        : (() => {
            const path = lineEnds(ink.filter((primitive) => primitive.kind !== "point"));
            if (!path) return null;
            const foot = projectToSegment(point, path.start, path.end);
            return Math.hypot(point.x - foot.x, point.y - foot.y) < 2 ? null : [point, foot] as const;
          })();
      if (!dropped) return [];
      return [{
        kind: "line",
        points: [...dropped],
        provenance: { annotation: "drop", dashed: true, strokeRole: "construction" },
      }];
    }
    case "ghost":
      return ink.flatMap((primitive) => [{
        kind: primitive.kind,
        points: offsetClone(primitive.points),
        radius: primitive.radius,
        startAngle: primitive.startAngle,
        endAngle: primitive.endAngle,
        provenance: { annotation: "ghost", dashed: true, strokeRole: "construction" },
      }]);
    case "extend": {
      const path = lineEnds(ink);
      if (!path) return [];
      return [{
        kind: "line",
        points: extendSegment(path.start, path.end),
        provenance: { annotation: "extend", dashed: true, strokeRole: "construction" },
      }];
    }
    case "frame": {
      const origin = ink.find((primitive) => primitive.kind === "point")?.points[0]
        ?? points[0];
      if (!origin) return [];
      const path = lineEnds(ink.filter((primitive) => primitive.kind !== "point"));
      const tangent = path
        ? { x: path.end.x - path.start.x, y: path.end.y - path.start.y }
        : { x: 1, y: 0 };
      return localFrame(origin, tangent).map((segment) => ({
        kind: "polyline" as const,
        points: segment,
        provenance: { annotation: "frame", strokeRole: "construction" },
      }));
    }
    case "polarity": {
      const owner = document.constructions.find((construction) => construction.outputs.includes(annotation.targetIds[0]!));
      const sourceIndex = owner?.operator === "kirchhoff_network"
        && Array.isArray(owner.inputs.nodes) && Array.isArray(owner.inputs.branches)
        ? owner.outputs.indexOf(annotation.targetIds[0]!) - owner.inputs.nodes.length : -1;
      const branch = sourceIndex >= 0 && Array.isArray(owner?.inputs.branches) ? owner.inputs.branches[sourceIndex] : undefined;
      const physicalSource = owner?.operator === "symbol" && ["battery", "cell"].includes(String(owner.inputs.symbol).toLowerCase())
        || typeof branch === "object" && branch !== null && "kind" in branch && branch.kind === "source";
      if (physicalSource) {
        const strokes = ink.filter((primitive) => primitive.kind !== "label");
        const plates = [strokes[1], strokes[2]];
        if (plates.some((plate) => plate?.points.length !== 2)) return [];
        const length = (plate: RenderPrimitive): number => Math.hypot(plate.points[1]!.x - plate.points[0]!.x, plate.points[1]!.y - plate.points[0]!.y);
        const firstPositive = length(plates[0]!) > length(plates[1]!);
        return plates.map((plate, index) => ({ kind: "label" as const,
          points: [{ x: (plate!.points[0]!.x + plate!.points[1]!.x) / 2, y: (plate!.points[0]!.y + plate!.points[1]!.y) / 2 }],
          text: (index === 0) === firstPositive ? "+" : "−", labelPlacement: "automatic",
          provenance: { annotation: "polarity" } }));
      }
      const path = lineEnds(ink);
      const start = path?.start ?? points[0];
      const end = path?.end ?? points.at(-1);
      if (!start || !end) return [];
      const marks = (annotation.text && annotation.text.length >= 2 ? annotation.text : "+-").slice(0, 2);
      return [
        { kind: "label" as const, points: [start], text: marks[0]!, labelPlacement: "automatic", provenance: { annotation: "polarity" } },
        { kind: "label" as const, points: [end], text: marks[1]!, labelPlacement: "automatic", provenance: { annotation: "polarity" } },
      ];
    }
    case "slope_triangle": {
      const poly = ink.find((primitive) => primitive.points.length >= 2);
      if (!poly) return [];
      const [start, end] = slopeAnchors ?? [poly.points[0]!, poly.points.at(-1)!];
      if (Math.abs(end.x - start.x) < 2 || Math.abs(end.y - start.y) < 2) return [];
      return [{
        kind: "polygon", points: slopeTriangle(start, end),
        provenance: { annotation: "slope_triangle", strokeRole: "construction" },
      }];
    }
    default:
      return [];
  }
}

function lineEnds(primitives: RenderPrimitive[]): { start: RenderPoint; end: RenderPoint } | null {
  const path = primitives.find((primitive) =>
    (primitive.kind === "line" || primitive.kind === "polyline" || primitive.kind === "ray" || primitive.kind === "vector" || primitive.kind === "dimension")
    && primitive.points.length >= 2,
  );
  if (!path) return null;
  const start = path.points[0];
  const end = path.points.at(-1);
  if (!start || !end) return null;
  return { start, end };
}

/** Circular primitives store their centre; bounds must cover their stroke. */
function annotationExtentPoints(primitive: RenderPrimitive): RenderPoint[] {
  const center = primitive.points[0];
  if (!center || !primitive.radius || (primitive.kind !== "circle" && primitive.kind !== "arc")) return primitive.points;
  const rawStart = primitive.kind === "arc" ? primitive.startAngle ?? 0 : 0;
  const rawEnd = primitive.kind === "arc" ? primitive.endAngle ?? 2 * Math.PI : 2 * Math.PI;
  const tau = 2 * Math.PI;
  const span = Math.max(-tau, Math.min(tau, rawEnd - rawStart));
  const start = ((rawStart % tau) + tau) % tau;
  const end = start + span;
  const angles = Array.from({ length: 65 }, (_, index) => start + (end - start) * index / 64);
  // Include exact extrema even when an arc starts between sample positions.
  for (let index = Math.ceil(Math.min(start, end) / (Math.PI / 2)); index <= Math.floor(Math.max(start, end) / (Math.PI / 2)); index += 1) angles.push(index * Math.PI / 2);
  return angles.map((angle) => ({ x: center.x + primitive.radius! * Math.cos(angle), y: center.y + primitive.radius! * Math.sin(angle) }));
}

/** Straight-edge marks cannot use an imaginary chord through a bent path. */
function straightLineEnds(primitives: RenderPrimitive[]): { start: RenderPoint; end: RenderPoint } | null {
  const path = primitives.find((primitive) =>
    ["line", "polyline", "ray", "vector", "dimension"].includes(primitive.kind) && primitive.points.length >= 2,
  );
  if (!path) return null;
  const start = path.points[0]!;
  const end = path.points.at(-1)!;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.05) return null;
  let previous = -0.05;
  for (const point of path.points) {
    const x = point.x - start.x;
    const y = point.y - start.y;
    const along = (x * dx + y * dy) / length;
    if (Math.abs(x * dy - y * dx) / length > 0.05 || along < previous - 0.05 || along > length + 0.05) return null;
    previous = along;
  }
  return { start, end };
}

function convexHull(points: RenderPoint[]): RenderPoint[] {
  const unique = points.filter((point, index) =>
    points.findIndex((candidate) => candidate.x === point.x && candidate.y === point.y) === index,
  );
  if (unique.length <= 2) return unique;
  const sorted = [...unique].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: RenderPoint, a: RenderPoint, b: RenderPoint) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: RenderPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: RenderPoint[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}
