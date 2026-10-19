import { validateSceneDocument } from "../document/validation";
import type { SceneConstruction, SceneDocument, SceneIssue } from "../types";
import { readUniformCircularSource } from "./uniformCircularSource";

export const VERIFIED_CIRCULAR_PARTS_POLICY = "uniform-circular-semantic/v1";
const VERIFIED_CUE =
  "The circular interval, its endpoint velocities and displacement.";
const VERIFIED_REASON =
  "Source-verified circular interval with endpoint velocities and displacement.";
type Point = { x: number; y: number };
const close = (a: number, b: number) =>
  Number.isFinite(a) &&
  Number.isFinite(b) &&
  Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
const same = (a: Point, b: Point) => close(a.x, b.x) && close(a.y, b.y);
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const record = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** Parse only explicit angular intervals; never infer a requested sweep from diagram geometry. */
function sourceSweep(question: string): number | null {
  const values: number[] = [];
  const fractions: Record<string, number> = {
    quarter: 1 / 4,
    half: 1 / 2,
    "three quarters": 3 / 4,
    "three-quarters": 3 / 4,
  };
  for (const match of question.matchAll(
    /\b(?:one |a )?(quarter|half|three[- ]quarters)(?:[- ](?:turn|revolution)| (?:of (?:the |a )?way |of (?:a|one) (?:turn|revolution) ?)?(?:around|round)(?: the)? circle)/gi,
  )) {
    values.push(fractions[match[1]!.toLowerCase()]! * 2 * Math.PI);
  }
  for (const match of question.matchAll(
    /\b(?:turns? through|rotates? through|sweeps? (?:through )?)\s+(\d+(?:\.\d+)?)\s*(?:°|degrees?)\b/gi,
  ))
    values.push((Number(match[1]) * Math.PI) / 180);
  if (values.length !== 1 || !(values[0]! > 0 && values[0]! < 2 * Math.PI))
    return null;
  return values[0]!;
}

/**
 * Independent source/graph proof, rerun during compilation and save. No marker,
 * entity name, role, planner answer or assertion is treated as authority.
 * Deliberately bounded to a single uniform-motion interval with its chord and
 * endpoint tangents. Unsupported graphs keep the existing strict rejection.
 */
function certifyCircularParts(
  document: SceneDocument,
  question: unknown,
): Map<string, string> | false {
  if (
    typeof question !== "string" ||
    document.source.question !== question ||
    document.visualDecision.mode !== "scene"
  )
    return false;
  if (
    !/\b(?:constant|uniform|steady)\s+(?:speed|angular (?:speed|velocity))\b|\buniform circular motion\b/i.test(
      question,
    )
  )
    return false;
  if (
    /\b(?:increas|decreas|changing|non[- ]?uniform|from rest|tangential acceleration|angular acceleration)/i.test(
      question,
    )
  )
    return false;
  const source = readUniformCircularSource(question);
  const sweep = sourceSweep(question);
  if (
    source?.status !== "numeric" ||
    !source.sense ||
    sweep === null ||
    source.radiusUnit !== "m"
  )
    return false;
  if (
    document.constructions.length > 40 ||
    document.entities.length > 40 ||
    document.annotations.length > 16
  )
    return false;
  try {
    const quantities = new Map(document.quantities.map((q) => [q.id, q]));
    const unitKey = (value: unknown): string | null =>
      typeof value === "string" ? value.replace(/²/g, "^2").replace(/\s/g, "") : null;
    const consistentUnits = (value: unknown, expected: string | null, seen = new Set<unknown>()): boolean => {
      if (typeof value === "number") return Number.isFinite(value);
      if (seen.size > 16 || seen.has(value)) return false;
      seen.add(value);
      if (typeof value === "string" && quantities.has(value))
        return consistentUnits(quantities.get(value), expected, seen);
      if (!record(value) || !("value" in value)) return false;
      if (value.unit !== undefined && unitKey(value.unit) !== expected) return false;
      return consistentUnits(value.value, expected, seen);
    };
    // Scalar equality cannot erase a contradictory unit in a nested quantity.
    if (document.quantities.some((q) => !consistentUnits(q, unitKey(q.unit)))) return false;
    const scalar = (value: unknown, seen = new Set<unknown>()): number => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (seen.size > 16 || seen.has(value)) throw new Error("cyclic scalar");
      seen.add(value);
      if (typeof value === "string" && quantities.has(value))
        return scalar(quantities.get(value)!.value, seen);
      if (record(value) && "value" in value) return scalar(value.value, seen);
      throw new Error("unsupported scalar");
    };
    const producers = new Map<string, SceneConstruction>();
    for (const construction of document.constructions) {
      if (
        construction.outputs.length !== 1 ||
        producers.has(construction.outputs[0]!)
      )
        return false;
      producers.set(construction.outputs[0]!, construction);
    }
    const points = new Map<string, Point>();
    for (const construction of document.constructions.filter(
      (c) => c.operator === "point",
    )) {
      if (
        construction.inputs.coordinateSpace !== "world" ||
        Object.keys(construction.inputs).some(
          (key) => !["x", "y", "coordinateSpace"].includes(key),
        )
      )
        return false;
      points.set(construction.outputs[0]!, {
        x: scalar(construction.inputs.x),
        y: scalar(construction.inputs.y),
      });
    }
    const point = (id: unknown): Point => {
      if (typeof id !== "string" || !points.has(id))
        throw new Error("unproved point");
      return points.get(id)!;
    };
    const circles = document.constructions.filter(
      (c) => c.operator === "circle",
    );
    const arcs = document.constructions.filter((c) => c.operator === "arc");
    if (circles.length !== 1 || arcs.length !== 1) return false;
    const circle = circles[0]!;
    const arc = arcs[0]!;
    if (
      Object.keys(circle.inputs).some(
        (key) => !["center", "radius"].includes(key),
      ) ||
      Object.keys(arc.inputs).some(
        (key) =>
          !["center", "radius", "startAngle", "endAngle", "angleUnit"].includes(
            key,
          ),
      )
    )
      return false;
    const center = point(circle.inputs.center);
    if (
      !same(center, point(arc.inputs.center)) ||
      !close(scalar(circle.inputs.radius), source.radiusM) ||
      !close(scalar(arc.inputs.radius), source.radiusM)
    )
      return false;
    const angleUnit = arc.inputs.angleUnit;
    if (
      !["degrees", "degree", "deg", "radians", "radian", "rad"].includes(
        String(angleUnit),
      )
    )
      return false;
    const scale = String(angleUnit).startsWith("deg") ? Math.PI / 180 : 1;
    const rawStart = scalar(arc.inputs.startAngle);
    const rawEnd = scalar(arc.inputs.endAngle);
    const start = rawStart * scale;
    const end = rawEnd * scale;
    // The generic compiler's legacy angle reader recognizes only "degrees"
    // explicitly, then treats magnitudes over 2π as degrees. Do not certify
    // aliases or wrapped radians when that reader would draw a different arc.
    const compiledAngle = (value: number) =>
      angleUnit === "degrees" || Math.abs(value) > 2 * Math.PI
        ? value * Math.PI / 180
        : value;
    if (!close(start, compiledAngle(rawStart)) || !close(end, compiledAngle(rawEnd))) return false;
    const sense = source.sense === "anticlockwise" ? 1 : -1;
    if (
      !close(end - start, sense * sweep) ||
      (source.phase !== null && !close(Math.cos(start - source.phase), 1))
    )
      return false;
    const onCircle = (angle: number): Point => ({
      x: center.x + source.radiusM * Math.cos(angle),
      y: center.y + source.radiusM * Math.sin(angle),
    });
    const first = onCircle(start);
    const last = onCircle(end);
    const firstIds = [...points]
      .filter(([, p]) => same(p, first))
      .map(([id]) => id);
    const lastIds = [...points]
      .filter(([, p]) => same(p, last))
      .map(([id]) => id);
    if (firstIds.length !== 1 || lastIds.length !== 1) return false;
    const firstId = firstIds[0]!;
    const lastId = lastIds[0]!;
    const kinds = new Map<
      string,
      "radius" | "chord" | "velocity" | "angle" | "point" | "path"
    >();
    kinds.set(circle.outputs[0]!, "path");
    kinds.set(arc.outputs[0]!, "path");
    const usedPoints = new Set<string>([
      String(circle.inputs.center),
      String(arc.inputs.center),
      firstId,
      lastId,
    ]);
    const vectors: Array<{ at: string; length: number }> = [];
    let chordCount = 0;
    for (const construction of document.constructions) {
      const { inputs, operator } = construction;
      const id = construction.outputs[0]!;
      if (["point", "circle", "arc"].includes(operator)) continue;
      if (operator === "segment") {
        if (Object.keys(inputs).some((key) => !["start", "end"].includes(key)))
          return false;
        const a = point(inputs.start);
        const b = point(inputs.end);
        const radius =
          (same(a, center) && (same(b, first) || same(b, last))) ||
          (same(b, center) && (same(a, first) || same(a, last)));
        const chord =
          (same(a, first) && same(b, last)) ||
          (same(a, last) && same(b, first));
        if (!radius && !chord) return false;
        kinds.set(id, radius ? "radius" : "chord");
        if (chord) chordCount++;
        usedPoints.add(String(inputs.start));
        usedPoints.add(String(inputs.end));
      } else if (operator === "vector") {
        if (
          Object.keys(inputs).some(
            (key) => !["start", "end", "direction", "length"].includes(key),
          )
        )
          return false;
        const a = point(inputs.start);
        let delta: Point;
        if (inputs.end !== undefined) {
          const b = point(inputs.end);
          delta = { x: b.x - a.x, y: b.y - a.y };
          usedPoints.add(String(inputs.end));
          if (
            inputs.length !== undefined &&
            !close(scalar(inputs.length), Math.hypot(delta.x, delta.y))
          )
            return false;
          if (inputs.direction !== undefined) {
            if (
              !Array.isArray(inputs.direction) ||
              inputs.direction.length !== 2
            )
              return false;
            const dx = scalar(inputs.direction[0]);
            const dy = scalar(inputs.direction[1]);
            if (
              !close(dx * delta.y - dy * delta.x, 0) ||
              dx * delta.x + dy * delta.y <= 0
            )
              return false;
          }
        } else {
          if (!Array.isArray(inputs.direction) || inputs.direction.length !== 2)
            return false;
          const dx = scalar(inputs.direction[0]);
          const dy = scalar(inputs.direction[1]);
          const norm = Math.hypot(dx, dy);
          const length = scalar(inputs.length);
          if (!(norm > 0 && length > 0)) return false;
          delta = { x: (dx / norm) * length, y: (dy / norm) * length };
        }
        const at = same(a, first) ? firstId : same(a, last) ? lastId : null;
        if (!at) return false;
        const length = Math.hypot(delta.x, delta.y);
        const rx = a.x - center.x;
        const ry = a.y - center.y;
        if (
          !(length > 0) ||
          !close(delta.x * rx + delta.y * ry, 0) ||
          (rx * delta.y - ry * delta.x) * sense <= 0
        )
          return false;
        vectors.push({ at, length });
        kinds.set(id, "velocity");
        usedPoints.add(String(inputs.start));
      } else if (operator === "angle_mark" || operator === "right_angle_mark") {
        if (sweep > Math.PI) return false;
        if (
          Object.keys(inputs).some(
            (key) => !["vertex", "a", "b", "radius"].includes(key),
          ) ||
          !same(point(inputs.vertex), center)
        )
          return false;
        const arm = (value: unknown): Point => {
          if (typeof value !== "string") throw new Error("unproved angle arm");
          if (points.has(value)) {
            usedPoints.add(value);
            return point(value);
          }
          const c = producers.get(value);
          if (c?.operator !== "segment" || !same(point(c.inputs.start), center))
            throw new Error("unproved radius arm");
          return point(c.inputs.end);
        };
        const a = arm(inputs.a);
        const b = arm(inputs.b);
        if (!(
          (same(a, first) && same(b, last)) ||
          (same(a, last) && same(b, first))
        ))
          return false;
        if (operator === "right_angle_mark" && !close(sweep, Math.PI / 2))
          return false;
        kinds.set(id, "angle");
        usedPoints.add(String(inputs.vertex));
      } else return false;
    }
    if (
      chordCount !== 1 ||
      vectors.length !== 2 ||
      vectors[0]!.at === vectors[1]!.at ||
      !close(vectors[0]!.length, vectors[1]!.length)
    )
      return false;
    if ([...points.keys()].some((id) => !usedPoints.has(id))) return false;
    for (const id of points.keys()) kinds.set(id, "point");
    const allowedQuantity = (value: number, unit: unknown): boolean => {
      const u =
        typeof unit === "string"
          ? unit.replace(/²/g, "^2").replace(/\s/g, "")
          : "";
      const duration = sweep / source.angularSpeed;
      return (
        (u === "m" && close(value, source.radiusM)) ||
        (u === "m/s" &&
          (close(value, source.speed) ||
            close(value, distance(first, last) / duration))) ||
        (u === "m/s^2" &&
          close(value, (2 * source.speed * Math.sin(sweep / 2)) / duration)) ||
        (u === "s" && close(value, duration))
      );
    };
    if (
      document.quantities.some((q) => !allowedQuantity(scalar(q.value), q.unit))
    )
      return false;
    const textAllowed = (text: string, ids: string[]): boolean => {
      if (ids.length !== 1) return false;
      const kind = kinds.get(ids[0]!);
      if (!kind) return false;
      const compact = text.trim();
      if (kind === "point") return /^[A-Za-z](?:[01]|[′'])?$/.test(compact);
      if (kind === "chord")
        return ["displacement", "Δr", "displacement Δr"].includes(compact);
      if (kind === "path") return compact === source.sense;
      if (kind === "angle")
        return (
          (compact === "π/2" && close(sweep, Math.PI / 2)) || compact === "θ"
        );
      const match = /^(r|v)\s*=\s*([+-]?\d+(?:\.\d+)?)\s*(m|m\/s)$/.exec(
        compact,
      );
      return (
        !!match &&
        ((kind === "radius" &&
          match[1] === "r" &&
          match[3] === "m" &&
          close(Number(match[2]), source.radiusM)) ||
          (kind === "velocity" &&
            match[1] === "v" &&
            match[3] === "m/s" &&
            close(Number(match[2]), source.speed)))
      );
    };
    if (
      document.entities.some(
        (entity) =>
          !kinds.has(entity.id) ||
          (entity.label !== undefined &&
            !textAllowed(entity.label, [entity.id])),
      )
    )
      return false;
    for (const annotation of document.annotations) {
      if (
        !["label", "callout", "sense", "trace"].includes(annotation.kind) ||
        !annotation.text ||
        !textAllowed(annotation.text, annotation.targetIds)
      )
        return false;
      if (
        ["sense", "trace"].includes(annotation.kind) &&
        annotation.text !== source.sense
      )
        return false;
      if (annotation.quantityId !== undefined) {
        const q = quantities.get(annotation.quantityId);
        const kind = kinds.get(annotation.targetIds[0]!);
        if (
          !q ||
          !(
            (kind === "radius" &&
              close(scalar(q.value), source.radiusM) &&
              q.unit === "m") ||
            (kind === "velocity" &&
              close(scalar(q.value), source.speed) &&
              q.unit === "m/s")
          )
        )
          return false;
      }
    }
    const roles = new Map<string, string>();
    for (const [id, kind] of kinds) {
      const entity = document.entities.find((entry) => entry.id === id);
      const expectedKind =
        kind === "point"
          ? "point"
          : kind === "radius" || kind === "chord"
            ? "segment"
            : kind === "velocity"
              ? "vector"
              : producers.get(id)!.operator;
      if (!entity || entity.kind !== expectedKind) return false;
      if (
        kind !== "point" &&
        (!document.requiredEntityIds.includes(id) ||
          !document.revealGroups.some((group) => group.entityIds.includes(id)))
      )
        return false;
      roles.set(
        id,
        kind === "point"
          ? "circular construction point"
          : kind === "radius"
            ? "radius"
            : kind === "chord"
              ? "displacement"
              : kind === "velocity"
                ? "tangent velocity"
                : kind === "angle"
                  ? "swept angle"
                  : producers.get(id)!.operator === "circle"
                    ? "circular path"
                    : "travelled circular arc",
      );
    }
    if (
      document.source.verifiedPartsPolicy === VERIFIED_CIRCULAR_PARTS_POLICY &&
      (document.visualDecision.reason !== VERIFIED_REASON ||
        document.teachingTimeline.length !== 0 ||
        document.revealGroups.some(
          (group) => group.narrationCue !== VERIFIED_CUE,
        ) ||
        document.entities.some(
          (entity) =>
            entity.role !== roles.get(entity.id) ||
            entity.semantic !== undefined ||
            entity.provenance !== undefined,
        ))
    )
      return false;
    return roles;
  } catch {
    return false;
  }
}

export function provesVerifiedCircularParts(
  document: SceneDocument,
  question: unknown,
): boolean {
  return certifyCircularParts(document, question) !== false;
}

export function prepareVerifiedCircularParts(
  candidate: Record<string, unknown>,
  question: string,
  enabled = false,
): { candidate: Record<string, unknown>; issues: SceneIssue[] } {
  if (!enabled) return { candidate, issues: [] };
  const validated = validateSceneDocument(candidate);
  if (!validated.document) return { candidate, issues: [] };
  const roles = certifyCircularParts(validated.document, question);
  if (!roles) return { candidate, issues: [] };
  const document = validated.document;
  return {
    candidate: {
      ...document,
      visualDecision: { ...document.visualDecision, reason: VERIFIED_REASON },
      entities: document.entities.map((entity) => ({
        id: entity.id,
        kind: entity.kind,
        role: roles.get(entity.id)!,
        ...(entity.label !== undefined ? { label: entity.label } : {}),
      })),
      revealGroups: document.revealGroups.map((group) => ({
        ...group,
        narrationCue: VERIFIED_CUE,
      })),
      teachingTimeline: [],
      source: {
        ...document.source,
        verifiedPartsPolicy: VERIFIED_CIRCULAR_PARTS_POLICY,
      },
    },
    issues: [
      {
        code: "ucm_source_mismatch",
        severity: "warning",
        path: "source",
        message:
          "Certified the original circular interval, chord and tangent graph against source radius, speed, sweep and sense.",
      },
    ],
  };
}
