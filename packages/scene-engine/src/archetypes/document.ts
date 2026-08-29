/**
 * A small builder over scene-document/v2 so generators read as geometry,
 * not as JSON plumbing. Every method declares the entity and the single
 * construction that produces it, in world coordinates.
 */
import {
  SCENE_DOCUMENT_VERSION,
  type SceneAnnotation,
  type SceneAssertion,
  type SceneConstruction,
  type SceneDocument,
  type SceneEntity,
  type SceneRevealGroup,
  type Severity,
} from "../types";

export interface Vec2 { x: number; y: number }

export const DEG = Math.PI / 180;

export const polar = (radius: number, degrees: number): Vec2 => ({ x: radius * Math.cos(degrees * DEG), y: radius * Math.sin(degrees * DEG) });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const rotate = (a: Vec2, degrees: number): Vec2 => ({
  x: a.x * Math.cos(degrees * DEG) - a.y * Math.sin(degrees * DEG),
  y: a.x * Math.sin(degrees * DEG) + a.y * Math.cos(degrees * DEG),
});
export const round = (value: number, digits = 4): number => Number(value.toFixed(digits));

/** Compact label: at most 16 characters, honest rounding for display. */
export function compact(text: string): string {
  return text.length <= 16 ? text : text.slice(0, 16);
}

export function fmt(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return "";
  const rounded = Number(value.toPrecision(digits));
  return String(rounded);
}

export function withUnit(value: number, unit: string | undefined, digits = 3): string {
  return compact(`${fmt(value, digits)}${unit ? ` ${unit}` : ""}`);
}

export class SceneBuilder {
  readonly entities: SceneEntity[] = [];
  readonly constructions: SceneConstruction[] = [];
  readonly assertions: SceneAssertion[] = [];
  readonly annotations: SceneAnnotation[] = [];
  readonly quantities: Array<Record<string, unknown> & { id: string }> = [];
  private readonly groups: SceneRevealGroup[] = [];
  private readonly ids = new Set<string>();

  constructor(readonly question: string, readonly reason: string, readonly archetype: string) {}

  private readonly helperIds = new Set<string>();

  private declare(entity: SceneEntity, construction: SceneConstruction): string {
    if (this.ids.has(entity.id)) throw new Error(`duplicate entity id ${entity.id}`);
    this.ids.add(entity.id);
    this.entities.push(entity);
    this.constructions.push(construction);
    return entity.id;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  quantity(id: string, symbol: string, value: number, unit = ""): string {
    this.quantities.push({ id, symbol, value: round(value, 6), unit });
    return id;
  }

  /**
   * A construction-only point: it positions other geometry but draws no dot.
   * The validator treats an unlabelled, generic-role point that feeds a
   * construction and is not required as solver-only, so it is left out of
   * requiredEntityIds and reveal groups. `role` must avoid the semantic words
   * the validator reserves (vertex, focus, pole, image, object, charge…).
   */
  helper(id: string, at: Vec2, role = "helper point"): string {
    this.helperIds.add(id);
    return this.point(id, at, /\bhelper\b/i.test(role) ? role : `${role} helper`);
  }

  point(id: string, at: Vec2, role: string, label?: string): string {
    return this.declare(
      { id, kind: "point", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "point", inputs: { x: round(at.x), y: round(at.y), coordinateSpace: "world" }, outputs: [id] },
    );
  }

  midpoint(id: string, a: string, b: string, role: string, label?: string): string {
    return this.declare(
      { id, kind: "point", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "midpoint", inputs: { a, b }, outputs: [id] },
    );
  }

  rotated(id: string, point: string, center: string, degrees: number, role: string, label?: string): string {
    return this.declare(
      { id, kind: "point", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "rotate", inputs: { point, center, angle: round(degrees), angleUnit: "degrees" }, outputs: [id] },
    );
  }

  segment(id: string, start: string, end: string, role: string, label?: string): string {
    return this.declare(
      { id, kind: "segment", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "segment", inputs: { start, end }, outputs: [id] },
    );
  }

  /**
   * A principal ray laid out from the paraxial mirror/lens formula. The
   * construction declares the approximation so the validator accepts a
   * reflected/refracted-ray role without a law-of-reflection operator; the
   * generator pairs it with converges and distance-ratio proofs.
   */
  paraxialRay(id: string, start: string, end: string, role: string, label?: string): string {
    return this.declare(
      { id, kind: "segment", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "segment", inputs: { start, end, approximation: "paraxial" }, outputs: [id] },
    );
  }

  line(id: string, start: string, end: string, role: string, label?: string): string {
    return this.declare(
      { id, kind: "line", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "line", inputs: { start, end }, outputs: [id] },
    );
  }

  ray(id: string, start: string, end: string, role: string, label?: string): string {
    return this.declare(
      { id, kind: "ray", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "ray", inputs: { start, end }, outputs: [id] },
    );
  }

  /**
   * Vector from a point: to another point, along a numeric direction, or along
   * a derived direction entity (e.g. a normal_at helper) with a display length.
   */
  vector(id: string, start: string, target: { end: string } | { direction: Vec2; length: number } | { along: string; length: number }, role: string, label?: string): string {
    const inputs: Record<string, unknown> = "end" in target
      ? { start, end: target.end }
      : "along" in target
        ? { start, direction: target.along, length: round(target.length) }
        : { start, direction: [round(target.direction.x), round(target.direction.y)], length: round(target.length) };
    return this.declare(
      { id, kind: "vector", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "vector", inputs, outputs: [id] },
    );
  }

  /** Resolve a vector into components along and perpendicular to a basis path. */
  components(parallelId: string, perpendicularId: string, origin: string, vector: string, basis: string, roles: [string, string], labels?: [string, string]): void {
    for (const [index, id] of [parallelId, perpendicularId].entries()) {
      if (this.ids.has(id)) throw new Error(`duplicate entity id ${id}`);
      this.ids.add(id);
      this.entities.push({ id, kind: "vector", role: roles[index]!, ...(labels?.[index] ? { label: compact(labels[index]!) } : {}) });
    }
    this.constructions.push({
      id: `make_${parallelId}_${perpendicularId}`,
      operator: "vector_components",
      inputs: { origin, vector, basis },
      outputs: [parallelId, perpendicularId],
    });
  }

  normalAt(id: string, point: string, surface: string, role: string, label?: string): string {
    return this.declare(
      { id, kind: "vector", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "normal_at", inputs: { point, surface }, outputs: [id] },
    );
  }

  circle(id: string, center: string, radius: number, role: string, label?: string): string {
    return this.declare(
      { id, kind: "circle", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "circle", inputs: { center, radius: round(radius) }, outputs: [id] },
    );
  }

  arc(id: string, center: string, radius: number, startDeg: number, endDeg: number, role: string, label?: string): string {
    return this.declare(
      { id, kind: "arc", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "arc", inputs: { center, radius: round(radius), startAngle: round(startDeg), endAngle: round(endDeg), angleUnit: "degrees" }, outputs: [id] },
    );
  }

  /**
   * Spherical surface from a vertex, signed Cartesian radius (light along +axis),
   * and aperture half-height. Positive radius is convex to incident light.
   */
  sphericalSurface(
    id: string,
    spec: {
      vertex: string;
      axis: string;
      halfHeight: number;
      center?: string;
      signedRadius?: number;
      kind?: "convex" | "concave" | "plano";
    },
    role: string,
    label?: string,
  ): string {
    const inputs: Record<string, unknown> = {
      vertex: spec.vertex,
      axis: spec.axis,
      halfHeight: round(spec.halfHeight),
    };
    if (spec.center) inputs.center = spec.center;
    if (spec.signedRadius !== undefined) inputs.signedRadius = round(spec.signedRadius);
    if (spec.kind) inputs.kind = spec.kind;
    return this.declare(
      { id, kind: "arc", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "spherical_surface", inputs, outputs: [id] },
    );
  }

  /**
   * Closed thin-lens outline from two signed Cartesian radii. Convex:
   * radius1 > 0, radius2 < 0. Concave: the opposite pair.
   */
  lensSection(
    id: string,
    spec: {
      center: string;
      axis: string;
      radius1: number;
      radius2: number;
      halfHeight: number;
      thickness?: number;
    },
    role: string,
    label?: string,
  ): string {
    return this.declare(
      { id, kind: "polygon", role, ...(label ? { label: compact(label) } : {}) },
      {
        id: `make_${id}`,
        operator: "lens_section",
        inputs: {
          center: spec.center,
          axis: spec.axis,
          radius1: round(spec.radius1),
          radius2: round(spec.radius2),
          halfHeight: round(spec.halfHeight),
          ...(spec.thickness !== undefined ? { thickness: round(spec.thickness) } : {}),
        },
        outputs: [id],
      },
    );
  }

  angleMark(id: string, vertex: string, a: string, b: string, label?: string, radius?: number): string {
    return this.declare(
      { id, kind: "angle_mark", role: "angle mark", ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "angle_mark", inputs: { vertex, a, b, ...(radius ? { radius: round(radius) } : {}) }, outputs: [id] },
    );
  }

  rightAngle(id: string, vertex: string, a: string, b: string): string {
    return this.declare(
      { id, kind: "right_angle_mark", role: "right angle mark" },
      { id: `make_${id}`, operator: "right_angle_mark", inputs: { vertex, a, b }, outputs: [id] },
    );
  }

  rectangle(id: string, center: string, width: number, height: number, role: string, label?: string): string {
    return this.declare(
      { id, kind: "rectangle", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "rectangle", inputs: { center, width: round(width), height: round(height) }, outputs: [id] },
    );
  }

  polygon(id: string, points: readonly string[], role: string, label?: string): string {
    return this.declare(
      { id, kind: "polygon", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "polygon", inputs: { points: [...points] }, outputs: [id] },
    );
  }

  polyline(id: string, points: readonly string[], role: string, label?: string): string {
    return this.declare(
      { id, kind: "polyline", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "polyline", inputs: { points: [...points] }, outputs: [id] },
    );
  }

  /** A closed box rotated by `degrees` about its centre, as four helper points plus a polygon. */
  box(id: string, center: Vec2, width: number, height: number, degrees: number, role: string, label?: string): string {
    const corners = [
      { x: -width / 2, y: -height / 2 }, { x: width / 2, y: -height / 2 },
      { x: width / 2, y: height / 2 }, { x: -width / 2, y: height / 2 },
    ].map((corner) => add(center, rotate(corner, degrees)));
    const ids = corners.map((corner, index) => this.point(`${id}_c${index}`, corner, `${role} corner`));
    return this.polygon(id, ids, role, label);
  }

  axes(id: string, xMin: number, xMax: number, yMin: number, yMax: number, role: string, label?: string): string {
    return this.declare(
      { id, kind: "axes", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "axes", inputs: { xMin: round(xMin), xMax: round(xMax), yMin: round(yMin), yMax: round(yMax) }, outputs: [id] },
    );
  }

  curve(id: string, expression: string, xMin: number, xMax: number, role: string, label?: string, samples = 65): string {
    return this.declare(
      { id, kind: "polyline", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "function_curve", inputs: { expression, variable: "x", xMin: round(xMin), xMax: round(xMax), samples }, outputs: [id] },
    );
  }

  region(id: string, upper: string, lower: string, role: string, xMin?: number, xMax?: number): string {
    return this.declare(
      { id, kind: "polygon", role },
      { id: `make_${id}`, operator: "function_region", inputs: { upper, lower, ...(xMin !== undefined ? { xMin: round(xMin) } : {}), ...(xMax !== undefined ? { xMax: round(xMax) } : {}) }, outputs: [id] },
    );
  }

  tangent(id: string, curve: string, at: number, role: string, label?: string, span = 2): string {
    return this.declare(
      { id, kind: "line", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "tangent_line", inputs: { curve, at: round(at), span }, outputs: [id] },
    );
  }

  symbol(id: string, symbol: string, start: string, end: string, role: string, label?: string): string {
    return this.declare(
      { id, kind: "component", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "symbol", inputs: { symbol, start, end }, outputs: [id] },
    );
  }

  connect(id: string, start: string, end: string, role = "wire"): string {
    return this.declare(
      { id, kind: "connector", role },
      { id: `make_${id}`, operator: "connect", inputs: { start, end }, outputs: [id] },
    );
  }

  dimension(id: string, start: string, end: string, role: string, label?: string): string {
    return this.declare(
      { id, kind: "dimension", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "dimension", inputs: { start, end }, outputs: [id] },
    );
  }

  spaceFrame(id: string, origin: string, role = "frame"): string {
    return this.declare(
      { id, kind: "polyline", role },
      { id: `make_${id}`, operator: "space_frame", inputs: { origin, scale: 1, axisLength: 3 }, outputs: [id] },
    );
  }

  spacePoint(id: string, frame: string, at: [number, number, number], role: string, label?: string): string {
    return this.declare(
      { id, kind: "point", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "space_point", inputs: { frame, x: round(at[0]), y: round(at[1]), z: round(at[2]) }, outputs: [id] },
    );
  }

  spaceLine(id: string, frame: string, point: string | [number, number, number], direction: [number, number, number], role: string, label?: string, tMin = -1.5, tMax = 1.5): string {
    return this.declare(
      { id, kind: "line", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "space_line", inputs: { frame, point, direction: direction.map((value) => round(value)), tMin, tMax }, outputs: [id] },
    );
  }

  plane(id: string, frame: string, coefficients: [number, number, number, number], role: string, label?: string, span = 2.5): string {
    const [a, b, c, d] = coefficients;
    return this.declare(
      { id, kind: "polygon", role, ...(label ? { label: compact(label) } : {}) },
      { id: `make_${id}`, operator: "plane", inputs: { frame, a: round(a), b: round(b), c: round(c), d: round(d), span }, outputs: [id] },
    );
  }

  /** Current-direction mark on a branch — every circuit figure carries one. */
  sense(id: string, targetId: string): void {
    this.annotations.push({ id, kind: "sense", targetIds: [targetId] });
  }

  /** Hatching on a contact surface (ground, incline, wall) — every contact figure carries one. */
  hatch(id: string, targetId: string): void {
    this.annotations.push({ id, kind: "hatch", targetIds: [targetId] });
  }

  assert(id: string, predicate: string, entities: readonly string[], expected: unknown = true, severity: Severity = "fatal"): void {
    this.assertions.push({ id, predicate, entities: [...entities], expected, severity });
  }

  labelled(...ids: string[]): void {
    for (const id of ids) this.assert(`label_${id}`, "label_attached", [id], true);
  }

  group(id: string, entityIds: readonly string[], cue: string, dependsOn: readonly string[] = []): void {
    this.groups.push({ id, entityIds: [...entityIds], dependsOn: [...dependsOn], narrationCue: cue });
  }

  build(): SceneDocument {
    const requiredEntityIds = this.entities.map((entity) => entity.id).filter((id) => !this.helperIds.has(id));
    this.groups.forEach((group) => { group.entityIds = group.entityIds.filter((id) => !this.helperIds.has(id)); });
    const grouped = new Set(this.groups.flatMap((group) => group.entityIds));
    const remaining = requiredEntityIds.filter((id) => !grouped.has(id));
    const revealGroups: SceneRevealGroup[] = this.groups.length > 0
      ? [...this.groups, ...(remaining.length ? [{ id: "detail", entityIds: remaining, dependsOn: [this.groups.at(-1)!.id], narrationCue: "remaining detail" }] : [])]
      : [{ id: "setup", entityIds: requiredEntityIds, dependsOn: [], narrationCue: this.reason }];
    return {
      schemaVersion: SCENE_DOCUMENT_VERSION,
      visualDecision: { mode: "scene", reason: this.reason },
      source: { question: this.question, synthesizedFamily: true, archetype: this.archetype },
      quantities: this.quantities,
      entities: this.entities,
      constructions: this.constructions,
      relations: [],
      assertions: this.assertions,
      annotations: this.annotations,
      requiredEntityIds,
      revealGroups,
      teachingTimeline: revealGroups.map((group, index) => ({
        id: `reveal_${group.id}`,
        action: "reveal" as const,
        targetId: group.id,
        dependsOn: index === 0 ? [] : [`reveal_${revealGroups[index - 1]!.id}`],
        narrationIntent: group.narrationCue,
      })),
    };
  }
}
