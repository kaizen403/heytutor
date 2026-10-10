import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import { circleOfExpression, circleOfStatedText, extractCircleSource, isConicExpression } from "../synthesize/statedEquations";

export function validateCircleSourceBinding(document: SceneDocument): SceneIssue[] {
  if (document.visualDecision.mode === "text_only") return [];
  const source = typeof document.source.question === "string" ? extractCircleSource(document.source.question) : null;
  const binding = document.source.circleSourceBinding;
  if (!source) return binding ? [{ code: "circle_source_mismatch", message: "A claimed source circle requires an unambiguous supported source", severity: "fatal" }] : [];
  const issues: SceneIssue[] = [];
  const fail = (message: string): void => { issues.push({ code: "circle_source_mismatch", message, severity: "fatal" }); };
  if (source.kind === "invalid") { fail(source.reason); return issues; }
  const producers = new Map(document.constructions.flatMap((construction) => construction.outputs.map((id) => [id, construction] as const)));
  const sourceNumber = (value: unknown): number | null => {
    const units = scalarUnits(value, document);
    if (units.length > 0) { fail(`Plain Cartesian circle inputs cannot infer a source-unit mapping for ${units.join(", ")}`); return null; }
    return validationNumber(value, document);
  };
  const point = (value: unknown): RenderPoint | null => {
    if (typeof value === "string") {
      const producer = producers.get(value);
      if (producer?.operator !== "point" || producer.inputs.coordinateSpace !== undefined && producer.inputs.coordinateSpace !== "world") return null;
      const x = sourceNumber(producer.inputs.x);
      const y = sourceNumber(producer.inputs.y);
      return x === null || y === null ? null : { x, y };
    }
    try { return checkedPoint(inlinePoint(value), "source"); } catch { return null; }
  };
  const samePoint = (actual: RenderPoint | null, expected: RenderPoint): boolean => actual !== null && (source.kind === "point" ? actual.x === expected.x && actual.y === expected.y : Math.hypot(actual.x - expected.x, actual.y - expected.y) <= 1e-8 * Math.max(1, source.radius));
  const circles = document.constructions.filter((construction) => construction.operator === "circle");
  if (binding === undefined) {
    // An unclaimed document (a planner scene, a region, a stated-curve sketch)
    // is held to the source only where it draws the locus as a primitive: a
    // circle must be the source circle, and a zero-radius source draws none.
    // A locus traced by implicit_curve or bounding a constraint_region is
    // compiled from its own expression; when that expression is itself a
    // circle it must be the source circle, so a correct equation label cannot
    // sit on a different traced circle. Lines, parabolas and half-planes are
    // other curves and are not compared.
    const sameCircle = (traced: { center: RenderPoint; radiusSquared: number }): boolean =>
      Math.hypot(traced.center.x - source.center.x, traced.center.y - source.center.y) <= 1e-8 * Math.max(1, source.radius)
      && Math.abs(traced.radiusSquared - source.radiusSquared) <= 1e-8 * Math.max(1, source.radiusSquared);
    // An object labelled with the source circle's equation must be that
    // circle: a circle primitive (checked below) or a circle-form trace. An
    // ellipse, a line or a polyline under the equation is a false label.
    for (const entity of document.entities) {
      const claimed = typeof entity.label === "string" ? circleOfStatedText(entity.label) : null;
      if (!claimed || !sameCircle(claimed)) continue;
      const producer = producers.get(entity.id);
      if (producer?.operator === "circle") continue;
      const expression = producer?.operator === "implicit_curve" && typeof producer.inputs.expression === "string" ? producer.inputs.expression : null;
      // A trace that is not a polynomial of degree two (x^4+y^4-16,
      // y-0.5sin(x)) cannot be the source circle. It is judged after the
      // constructions run (validateCircleLabelTraces), so a contour the
      // compiler cannot resolve keeps its own construction_failed refusal.
      if (expression !== null && !isConicExpression(expression)) continue;
      const traced = expression !== null ? circleOfExpression(expression) : null;
      // An empty trace (r² < 0) is refused by the contour compiler on its own.
      if (traced && traced.radiusSquared < 0) continue;
      if (!traced || !sameCircle(traced)) fail(`${entity.id} carries the source circle's equation but is not that circle`);
    }
    for (const construction of document.constructions) {
      const expressions = construction.operator === "implicit_curve" ? [construction.inputs.expression]
        : construction.operator === "constraint_region" && Array.isArray(construction.inputs.constraints)
          ? construction.inputs.constraints.map((constraint: unknown) => isRecord(constraint) ? constraint.expression : undefined)
          : [];
      for (const expression of expressions) {
        const traced = typeof expression === "string" ? circleOfExpression(expression) : null;
        // r² < 0 traces nothing; the contour compiler refuses that on its own.
        if (!traced || traced.radiusSquared < 0) continue;
        const sameCentre = Math.hypot(traced.center.x - source.center.x, traced.center.y - source.center.y) <= 1e-8 * Math.max(1, source.radius);
        const sameRadius = Math.abs(traced.radiusSquared - source.radiusSquared) <= 1e-8 * Math.max(1, source.radiusSquared);
        if (!sameCentre || !sameRadius) fail(`${construction.operator} traces a circle other than the source circle`);
      }
    }
    if (source.kind === "point") {
      if (circles.length > 0) fail("A declared zero-radius singleton cannot render a nondegenerate circle");
      return issues;
    }
    if (circles.length === 0) return issues;
  }
  const candidates = source.kind === "circle" ? circles : document.constructions.filter((construction) => construction.operator === "point");
  const locusId = isRecord(binding) && typeof binding.locusId === "string" ? binding.locusId : undefined;
  if (binding !== undefined && binding !== true && !locusId) { fail("Circle source ownership requires one explicit locus output"); return issues; }
  const owner = locusId ? producers.get(locusId) : candidates.length === 1 ? candidates[0] : undefined;
  if (!owner || owner.operator !== (source.kind === "circle" ? "circle" : "point") || owner.outputs.length !== 1) { fail("The source locus has missing or ambiguous ownership"); return issues; }
  const roots = new Set(owner.outputs);
  if (source.kind === "point") {
    if (circles.length > 0) fail("A declared zero-radius singleton cannot render a nondegenerate circle");
    if (!samePoint(point(owner.outputs[0]), source.center)) fail("The declared singleton point does not match the source");
  } else {
    const radius = sourceNumber(owner.inputs.radius ?? owner.inputs.r);
    if (!samePoint(point(owner.inputs.center), source.center) || radius === null || Math.abs(radius - source.radius) > 1e-8 * Math.max(1, source.radius)) fail("Circle center/radius do not match the explicit source in world coordinates");
    if (typeof owner.inputs.center === "string") roots.add(owner.inputs.center);
    if (circles.some((circle) => circle !== owner)) fail("Additional primitive circles have no deterministic source-locus derivation witness");
  }
  if (source.member && !(source.kind === "point" && samePoint(source.member, source.center))) {
    // Roles and labels describe presentation, not source identity. A unique
    // point in world coordinates is the witness; wrong coordinates, canvas
    // coordinates and duplicate witnesses still fail closed.
    const members = document.constructions.filter((construction) => construction.operator === "point" && construction.outputs.length === 1 && samePoint(point(construction.outputs[0]), source.member!));
    if (members.length !== 1) fail("The explicit membership point has missing or ambiguous ownership");
    else for (const id of members[0]!.outputs) roots.add(id);
  }
  const witnessed = (id: unknown, seen = new Set<string>()): boolean => {
    if (typeof id !== "string") return false;
    if (roots.has(id)) return true;
    if (seen.has(id) || seen.size >= 32) return false;
    const producer = producers.get(id);
    const keys = producer?.operator === "circle_from_three_points" ? ["a", "b", "c"] : producer?.operator === "circle_tangency_points" ? ["circle", "externalPoint"] : producer?.operator === "circle_intersections" ? ["circleA", "circleB"] : [];
    if (!producer || keys.length === 0) return false;
    return keys.every((key) => witnessed(producer.inputs[key], new Set([...seen, id])));
  };
  for (const construction of document.constructions) {
    if (construction.operator === "circle_from_three_points" && !construction.outputs.every((id) => witnessed(id))) fail("A derived circle requires deterministic geometric dependencies rooted in the verified source locus");
  }
  return issues;
}

/**
 * Post-construction half of the label rule: an implicit_curve carrying the
 * source circle's equation whose expression is not a conic is a different
 * curve under the circle's name. Run after constructions so contour failures
 * report first.
 */
export function validateCircleLabelTraces(document: SceneDocument): SceneIssue[] {
  if (document.visualDecision.mode === "text_only" || document.source.circleSourceBinding !== undefined) return [];
  const source = typeof document.source.question === "string" ? extractCircleSource(document.source.question) : null;
  if (!source || source.kind === "invalid") return [];
  const producers = new Map(document.constructions.flatMap((construction) => construction.outputs.map((id) => [id, construction] as const)));
  const issues: SceneIssue[] = [];
  for (const entity of document.entities) {
    const claimed = typeof entity.label === "string" ? circleOfStatedText(entity.label) : null;
    if (!claimed) continue;
    const sameCircle = Math.hypot(claimed.center.x - source.center.x, claimed.center.y - source.center.y) <= 1e-8 * Math.max(1, source.radius)
      && Math.abs(claimed.radiusSquared - source.radiusSquared) <= 1e-8 * Math.max(1, source.radiusSquared);
    if (!sameCircle) continue;
    const producer = producers.get(entity.id);
    if (producer?.operator === "implicit_curve" && typeof producer.inputs.expression === "string" && !isConicExpression(producer.inputs.expression)) {
      issues.push({ code: "circle_source_mismatch", message: `${entity.id} carries the source circle's equation but traces a curve that is not a circle`, severity: "fatal" });
    }
  }
  return issues;
}

export const CIRCLE_OPERATORS = [
  "circle_from_three_points", "circle_tangent_at", "circle_tangency_points", "circle_intersections",
] as const;
export type CircleOperator = (typeof CIRCLE_OPERATORS)[number];
export type CircleGeometry =
  | { kind: "point"; point: RenderPoint }
  | { kind: "circle"; center: RenderPoint; radius: number }
  | { kind: "path"; points: RenderPoint[]; infinite: true };
export interface CircleEvaluationContext {
  number(value: unknown): number;
  point(value: unknown): RenderPoint;
  geometry(value: unknown): unknown;
}

const MIN_LENGTH = 1e-6;
const MAX_LENGTH = 1e9;
const MAX_COORDINATE = 1e12;
const MIN_RELATIVE_AREA = 1e-8;
const METRIC_TOLERANCE = 1e-8;
const INPUT_KEYS: Readonly<Record<CircleOperator, readonly string[]>> = {
  circle_from_three_points: ["a", "b", "c"],
  circle_tangent_at: ["circle", "point", "span"],
  circle_tangency_points: ["circle", "externalPoint"],
  circle_intersections: ["circleA", "circleB", "mode"],
};

class CircleInputError extends Error {
  constructor(readonly key: string, message: string) { super(message); }
}
function invalid(key: string, message: string): never { throw new CircleInputError(key, message); }
function isCircleOperator(operator: string): operator is CircleOperator {
  return (CIRCLE_OPERATORS as readonly string[]).includes(operator);
}

/** Metric constructions operate entirely in world coordinates, before board fitting.
 * A tangent's span is its full represented length. Both two-point operators order
 * outputs by positive then negative cross product against the source radial vector
 * (center→externalPoint for tangency, circleA.center→circleB.center for intersections).
 * Intersections require explicit two/tangent mode; no side or branch is guessed. */
export function evaluateCircleConstruction(operator: string, inputs: Record<string, unknown>, context: CircleEvaluationContext): CircleGeometry[] {
  if (!isCircleOperator(operator)) invalid("operator", `unsupported circle operator ${operator}`);
  for (const key of Object.keys(inputs)) {
    if (!INPUT_KEYS[operator].includes(key)) invalid("input", `${operator} does not accept ${key}`);
  }
  if (operator === "circle_from_three_points") {
    const [a, b, c] = ["a", "b", "c"].map((key) => pointInput(inputs[key], key, context));
    return [circumcircle(a!, b!, c!)];
  }
  if (operator === "circle_tangent_at") {
    const circle = circleInput(inputs.circle, "circle", context);
    const point = pointInput(inputs.point, "point", context);
    assertIncidence(point, circle, "point");
    const span = lengthInput(inputs.span, "span", context);
    const radius = subtract(point, circle.center);
    const radialLength = Math.hypot(radius.x, radius.y);
    const direction = { x: -radius.y / radialLength, y: radius.x / radialLength };
    const points = [-1, 1].map((side) => checkedPoint({
      x: point.x + side * span / 2 * direction.x,
      y: point.y + side * span / 2 * direction.y,
    }, "geometry"));
    const representedSpan = distance(points[0]!, points[1]!);
    const tangent = subtract(points[1]!, points[0]!);
    if (Math.abs(representedSpan - span) > span * METRIC_TOLERANCE ||
      Math.abs(dot(radius, tangent)) > radialLength * representedSpan * METRIC_TOLERANCE) {
      invalid("geometry", "tangent placement cannot preserve its span and perpendicularity at numeric precision");
    }
    return [{ kind: "path", points, infinite: true }];
  }
  if (operator === "circle_tangency_points") {
    const circle = circleInput(inputs.circle, "circle", context);
    const externalPoint = pointInput(inputs.externalPoint, "externalPoint", context);
    const radial = subtract(externalPoint, circle.center);
    const d = checkedLength(Math.hypot(radial.x, radial.y), "externalPoint");
    if (d - circle.radius <= Math.max(MIN_LENGTH, d * METRIC_TOLERANCE)) invalid("externalPoint", "tangency contacts require a strictly external point distinguishable from the circle");
    const ux = radial.x / d;
    const uy = radial.y / d;
    const ratio = circle.radius / d;
    const along = circle.radius * ratio;
    const height = circle.radius * Math.sqrt((1 - ratio) * (1 + ratio));
    checkedLength(2 * height, "geometry");
    const points = [1, -1].map((side) => checkedPoint({
      x: circle.center.x + along * ux - side * height * uy,
      y: circle.center.y + along * uy + side * height * ux,
    }, "geometry"));
    const tangentLength = Math.sqrt((d - circle.radius) * (d + circle.radius));
    for (const point of points) {
      assertIncidence(point, circle, "geometry");
      const radius = subtract(point, circle.center);
      const tangent = subtract(externalPoint, point);
      if (Math.abs(distance(point, externalPoint) - tangentLength) > tangentLength * METRIC_TOLERANCE ||
        Math.abs(dot(radius, tangent)) > circle.radius * tangentLength * METRIC_TOLERANCE) {
        invalid("geometry", "tangency contacts cannot preserve their metric identity at numeric precision");
      }
    }
    return points.map((point) => ({ kind: "point", point }));
  }
  if (operator === "circle_intersections") {
    if (inputs.mode !== "two" && inputs.mode !== "tangent") invalid("mode", "circle_intersections requires explicit mode two or tangent");
    const a = circleInput(inputs.circleA, "circleA", context);
    const b = circleInput(inputs.circleB, "circleB", context);
    const radial = subtract(b.center, a.center);
    const d = checkedLength(Math.hypot(radial.x, radial.y), "geometry");
    const scale = Math.max(a.radius, b.radius, d);
    const r = a.radius / scale;
    const s = b.radius / scale;
    const t = d / scale;
    if (t <= METRIC_TOLERANCE) invalid("geometry", "circle centers are coincident or numerically indistinguishable");
    const sum = r + s;
    const difference = Math.abs(r - s);
    const along = scale * (t * t + (r - s) * (r + s)) / (2 * t);
    const ux = radial.x / d;
    const uy = radial.y / d;
    const base = checkedPoint({ x: a.center.x + along * ux, y: a.center.y + along * uy }, "geometry");
    let points: RenderPoint[];
    if (inputs.mode === "tangent") {
      // A tangent mode must describe actual tangency up to arithmetic roundoff;
      // a merely close pair is an ill-conditioned two-point problem, not one point.
      const coordinateMagnitude = Math.max(scale, Math.abs(a.center.x), Math.abs(a.center.y), Math.abs(b.center.x), Math.abs(b.center.y));
      const roundoff = 32 * Number.EPSILON * coordinateMagnitude / scale;
      if (roundoff > METRIC_TOLERANCE) invalid("geometry", "circle tangency is unresolved at this coordinate precision");
      if (Math.min(Math.abs(t - sum), Math.abs(t - difference)) > roundoff) invalid("geometry", "tangent mode requires externally or internally tangent circles");
      points = [base];
    } else {
      if (sum - t <= METRIC_TOLERANCE || t - difference <= METRIC_TOLERANCE) invalid("geometry", "two-point mode requires two distinct circle intersections away from numerical tangency");
      // The four-factor triangle-area identity avoids subtracting near-equal squares.
      const height = scale * Math.sqrt((sum + t) * (sum - t) * (t + r - s) * (t - r + s)) / (2 * t);
      checkedLength(2 * height, "geometry");
      points = [1, -1].map((side) => checkedPoint({ x: base.x - side * height * uy, y: base.y + side * height * ux }, "geometry"));
    }
    for (const point of points) { assertIncidence(point, a, "geometry"); assertIncidence(point, b, "geometry"); }
    return points.map((point) => ({ kind: "point", point }));
  }
  return invalid("operator", `unsupported circle operator ${operator}`);
}

class UnresolvedGeometry extends Error {}

/** Derived references retain their identity; unavailable coordinates are checked
 * by the compiler before its atomic render commit rather than guessed here. */
export function validateCircleConstruction(
  construction: SceneConstruction,
  index: number,
  document: SceneDocument,
  constructionByOutput: Map<string, SceneConstruction>,
  issues: SceneIssue[],
): void {
  const { operator, inputs } = construction;
  if (!isCircleOperator(operator)) return;
  const initialIssueCount = issues.length;
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  const add = (key: string, message: string, actual?: unknown): void => {
    issues.push({ code: `invalid_${operator}_${key}`, message, severity: "fatal",
      path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}`,
      entityIds: outputs, actual });
  };
  if (!isRecord(inputs)) { add("inputs", `${operator} inputs must be an object`, inputs); return; }
  const arity = operator === "circle_tangency_points" || operator === "circle_intersections" && inputs.mode !== "tangent" ? 2 : 1;
  if (outputs.length !== arity || outputs.some((id) => typeof id !== "string" || !id.trim()) || new Set(outputs).size !== outputs.length) {
    add("outputs", `${operator} requires exactly ${arity} distinct output ids`, construction.outputs);
  }
  const expectedKind = operator === "circle_from_three_points" ? "circle" : operator === "circle_tangent_at" ? "line" : "point";
  for (const id of outputs) {
    const actualKind = document.entities.find((entity) => entity.id === id)?.kind;
    if (actualKind !== expectedKind) add("output_kind", `${operator} outputs must be ${expectedKind} entities`, actualKind);
  }
  for (const key of Object.keys(inputs)) if (!INPUT_KEYS[operator].includes(key)) add("input", `${operator} does not accept ${key}`, key);
  const pointKeys = operator === "circle_from_three_points" ? ["a", "b", "c"] : operator === "circle_tangent_at" ? ["point"] : operator === "circle_tangency_points" ? ["externalPoint"] : [];
  const circleKeys = operator === "circle_intersections" ? ["circleA", "circleB"] : operator === "circle_from_three_points" ? [] : ["circle"];
  const reference = (value: unknown, kind: "point" | "circle", key: string): void => {
    if (typeof value === "string") {
      const entity = document.entities.find((candidate) => candidate.id === value);
      if (entity?.kind !== kind || !constructionByOutput.has(value)) add(key, `${key} must reference a constructed ${kind}`, value);
    } else if (kind === "circle") add(key, `${key} must reference a constructed circle`, value);
    else {
      try { checkedPoint(inlinePoint(value), key); }
      catch (error) { add(key, errorMessage(error), value); }
    }
  };
  for (const key of pointKeys) reference(inputs[key], "point", key);
  for (const key of circleKeys) reference(inputs[key], "circle", key);
  if (operator === "circle_intersections" && inputs.mode !== "two" && inputs.mode !== "tangent") add("mode", "circle_intersections requires explicit mode two or tangent", inputs.mode);
  const number = (value: unknown): number => {
    const resolved = validationNumber(value, document);
    if (resolved === null) throw new Error("requires a finite literal or resolved quantity value");
    return resolved;
  };
  if (operator === "circle_tangent_at") {
    try { checkedLength(number(inputs.span), "span"); }
    catch (error) { add("span", errorMessage(error), inputs.span); }
  }
  const sourceUnits: string[] = [];
  const seenUnits = new Set<string>();
  const unitsOfGeometry = (value: unknown, depth = 0): void => {
    if (depth > 32) { add("units", "circle unit provenance exceeds the dependency depth limit"); return; }
    if (typeof value !== "string") {
      if (isRecord(value)) for (const key of ["x", "y"]) sourceUnits.push(...scalarUnits(value[key], document));
      return;
    }
    if (seenUnits.has(value)) return;
    seenUnits.add(value);
    const producer = constructionByOutput.get(value);
    if (!producer) return;
    const lengthKeys = producer.operator === "point" ? ["x", "y"]
      : producer.operator === "circle" ? [producer.inputs.radius === undefined ? "r" : "radius"]
        : producer.operator === "triangle_from_sides" ? ["sideAB", "sideBC", "sideCA"]
          : producer.operator === "triangle_from_sas" ? ["sideAB", "sideCA"]
            : producer.operator === "triangle_from_asa" ? ["sideAB"]
              : producer.operator === "conic" ? producer.inputs.kind === "parabola" ? ["p"] : ["a", "b"] : [];
    for (const key of lengthKeys) sourceUnits.push(...scalarUnits(producer.inputs[key], document));
    const visitReferences = (input: unknown): void => {
      if (typeof input === "string" && constructionByOutput.has(input)) unitsOfGeometry(input, depth + 1);
      else if (Array.isArray(input)) input.forEach(visitReferences);
      else if (isRecord(input)) Object.values(input).forEach(visitReferences);
    };
    Object.values(producer.inputs).forEach(visitReferences);
  };
  for (const key of [...pointKeys, ...circleKeys]) unitsOfGeometry(inputs[key]);
  if (operator === "circle_tangent_at") sourceUnits.push(...scalarUnits(inputs.span, document));
  const canonicalUnits = new Set<string>();
  for (const unit of sourceUnits) {
    const canonical = LENGTH_UNITS.get(unit);
    if (!canonical) add("units", "circle geometry requires length units compatible with world coordinates", unit);
    else canonicalUnits.add(canonical);
  }
  if (canonicalUnits.size > 1) add("units", "circle geometry measurements must use one common length unit; normalize the source quantities before construction", [...canonicalUnits]);

  const resolving = new Set<string>();
  const resolvedGeometry = new Map<string, CircleGeometry>();
  const resolve = (value: unknown, expected: "point" | "circle"): CircleGeometry => {
    if (typeof value !== "string") {
      if (expected !== "point") invalid("circle", "requires a constructed circle reference");
      return { kind: "point", point: checkedPoint(inlinePoint(value), "point") };
    }
    const producer = constructionByOutput.get(value);
    const entity = document.entities.find((candidate) => candidate.id === value);
    if (!producer || entity?.kind !== expected) invalid(expected, `requires a constructed ${expected} reference`);
    const cached = resolvedGeometry.get(value);
    if (cached) return cached;
    if (resolving.has(value) || resolving.size > 32) invalid("geometry", "circle geometry dependency is cyclic or exceeds the depth limit");
    resolving.add(value);
    try {
      if (producer.operator === "point") {
        const geometry: CircleGeometry = { kind: "point", point: checkedPoint({ x: number(producer.inputs.x), y: number(producer.inputs.y) }, "point") };
        resolvedGeometry.set(value, geometry);
        return geometry;
      }
      if (producer.operator === "circle") {
        const geometry: CircleGeometry = { kind: "circle", center: structuralContext.point(producer.inputs.center), radius: checkedLength(number(producer.inputs.radius ?? producer.inputs.r), "circle") };
        resolvedGeometry.set(value, geometry);
        return geometry;
      }
      if (isCircleOperator(producer.operator)) {
        const geometries = evaluateCircleConstruction(producer.operator, producer.inputs, structuralContext);
        const geometry = geometries[producer.outputs.indexOf(value)];
        if (!geometry || geometry.kind !== expected) invalid(expected, `producer did not construct a ${expected}`);
        producer.outputs.forEach((id, outputIndex) => {
          const outputGeometry = geometries[outputIndex];
          if (outputGeometry) resolvedGeometry.set(id, outputGeometry);
        });
        return geometry;
      }
      throw new UnresolvedGeometry();
    } finally { resolving.delete(value); }
  };
  const structuralContext: CircleEvaluationContext = {
    number,
    point(value) {
      const geometry = resolve(value, "point");
      if (geometry.kind !== "point") invalid("point", "requires a point");
      return geometry.point;
    },
    geometry(value) { return resolve(value, "circle"); },
  };
  let unresolved = false;
  for (const key of [...pointKeys, ...circleKeys]) {
    try { resolve(inputs[key], pointKeys.includes(key) ? "point" : "circle"); }
    catch (error) {
      if (error instanceof UnresolvedGeometry) unresolved = true;
      else add(key, errorMessage(error), inputs[key]);
    }
  }
  if (unresolved || issues.length > initialIssueCount) return;
  try { evaluateCircleConstruction(operator, inputs, structuralContext); }
  catch (error) {
    if (error instanceof UnresolvedGeometry) return;
    const key = error instanceof CircleInputError ? error.key : "geometry";
    add(key, errorMessage(error), inputs[key]);
  }
}

function circumcircle(a: RenderPoint, b: RenderPoint, c: RenderPoint): Extract<CircleGeometry, { kind: "circle" }> {
  const lengths = [distance(a, b), distance(b, c), distance(c, a)];
  const scale = Math.max(...lengths);
  for (const length of lengths) checkedLength(length, "geometry");
  const ux = (b.x - a.x) / scale;
  const uy = (b.y - a.y) / scale;
  const vx = (c.x - a.x) / scale;
  const vy = (c.y - a.y) / scale;
  const cross = ux * vy - uy * vx;
  if (Math.abs(cross) <= MIN_RELATIVE_AREA) invalid("geometry", "circumcircle requires noncollinear points distinguishable at numeric precision");
  const u2 = ux * ux + uy * uy;
  const v2 = vx * vx + vy * vy;
  const center = checkedPoint({
    x: a.x + scale * (u2 * vy - v2 * uy) / (2 * cross),
    y: a.y + scale * (ux * v2 - vx * u2) / (2 * cross),
  }, "geometry");
  const radius = checkedLength(distance(center, a), "geometry");
  for (const point of [a, b, c]) {
    if (Math.abs(distance(center, point) - radius) > radius * METRIC_TOLERANCE) {
      invalid("geometry", "circumcircle cannot preserve source incidence at numeric precision");
    }
  }
  return { kind: "circle", center, radius };
}
function pointInput(value: unknown, key: string, context: CircleEvaluationContext): RenderPoint {
  try { return checkedPoint(context.point(value), key); }
  catch (error) {
    if (error instanceof CircleInputError || error instanceof UnresolvedGeometry) throw error;
    return invalid(key, `${key} must resolve to a constructed point or finite inline point`);
  }
}
function circleInput(value: unknown, key: string, context: CircleEvaluationContext): Extract<CircleGeometry, { kind: "circle" }> {
  if (typeof value !== "string" || !value.trim()) invalid(key, `${key} must reference a constructed circle`);
  let geometry: unknown;
  try { geometry = context.geometry(value); }
  catch (error) {
    if (error instanceof UnresolvedGeometry) throw error;
    return invalid(key, `${key} must reference a constructed circle`);
  }
  if (!isRecord(geometry) || geometry.kind !== "circle" || !isRecord(geometry.center) || typeof geometry.center.x !== "number" || typeof geometry.center.y !== "number" || typeof geometry.radius !== "number") {
    invalid(key, `${key} must reference a constructed circle`);
  }
  if (Object.keys(geometry).some((field) => !["kind", "center", "radius"].includes(field))) invalid(key, "circle derivations cannot discard nonmetric or protected metadata");
  return { kind: "circle", center: checkedPoint({ x: geometry.center.x, y: geometry.center.y }, key), radius: checkedLength(geometry.radius, key) };
}
function lengthInput(value: unknown, key: string, context: CircleEvaluationContext): number {
  try { return checkedLength(context.number(value), key); }
  catch (error) {
    if (error instanceof CircleInputError) throw error;
    return invalid(key, `${key} must resolve to a finite length`);
  }
}
function assertIncidence(point: RenderPoint, circle: Extract<CircleGeometry, { kind: "circle" }>, key: string): void {
  if (Math.abs(distance(point, circle.center) - circle.radius) > circle.radius * METRIC_TOLERANCE) invalid(key, `${key} must lie on the referenced circle`);
}
function checkedPoint(value: RenderPoint, key: string): RenderPoint {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || Math.abs(value.x) > MAX_COORDINATE || Math.abs(value.y) > MAX_COORDINATE) {
    invalid(key, `${key} point coordinates must be finite with magnitude no greater than ${MAX_COORDINATE}`);
  }
  return { x: value.x, y: value.y };
}
function checkedLength(value: number, key: string): number {
  if (!Number.isFinite(value) || value <= MIN_LENGTH || value > MAX_LENGTH) invalid(key, `${key} length must be greater than ${MIN_LENGTH} and no greater than ${MAX_LENGTH}`);
  return value;
}
function distance(a: RenderPoint, b: RenderPoint): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function subtract(a: RenderPoint, b: RenderPoint): RenderPoint { return { x: a.x - b.x, y: a.y - b.y }; }
function dot(a: RenderPoint, b: RenderPoint): number { return a.x * b.x + a.y * b.y; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function inlinePoint(value: unknown): RenderPoint {
  if (Array.isArray(value) && value.length === 2 && value.every((entry) => typeof entry === "number")) return { x: value[0] as number, y: value[1] as number };
  if (isRecord(value) && typeof value.x === "number" && typeof value.y === "number") return { x: value.x, y: value.y };
  throw new Error("requires a point reference or finite [x,y] / {x,y}");
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number | null {
  if (depth > 32 || seen.has(value)) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  seen.add(value);
  if (typeof value === "string") {
    const quantity = document.quantities.find((candidate) => candidate.id === value);
    if (quantity) return validationNumber(quantity.value, document, seen, depth + 1);
    return value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
  }
  if (isRecord(value) && "value" in value) return validationNumber(value.value, document, seen, depth + 1);
  return null;
}
function normalizedUnit(value: string): string { return value.trim().replace(/[A-Za-z]{4,}/g, (word) => word.toLowerCase()); }
function scalarUnits(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): string[] {
  if (depth > 32 || seen.has(value)) return [];
  seen.add(value);
  const record = typeof value === "string" ? document.quantities.find((candidate) => candidate.id === value) : isRecord(value) ? value : undefined;
  if (!record) return [];
  const units = typeof record.unit === "string" && record.unit.trim() ? [normalizedUnit(record.unit)] : [];
  return "value" in record ? [...units, ...scalarUnits(record.value, document, seen, depth + 1)] : units;
}
const LENGTH_UNITS = new Map([
  ["m", "m,meter,meters,metre,metres"], ["cm", "cm,centimeter,centimeters,centimetre,centimetres"],
  ["mm", "mm,millimeter,millimeters,millimetre,millimetres"], ["km", "km,kilometer,kilometers,kilometre,kilometres"],
  ["µm", "µm,μm,um,micrometer,micrometers,micrometre,micrometres"], ["nm", "nm,nanometer,nanometers,nanometre,nanometres"],
  ["in", "in,inch,inches"], ["ft", "ft,foot,feet"], ["yd", "yd,yard,yards"], ["mi", "mi,mile,miles"],
  ["unit", "unit,units,1,dimensionless"],
].flatMap(([canonical, aliases]) => aliases!.split(",").map((alias) => [alias, canonical!] as const)));
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
