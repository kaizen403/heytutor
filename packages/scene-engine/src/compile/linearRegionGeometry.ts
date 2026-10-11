import type {
  RenderPrimitive,
  SceneConstruction,
  SceneDocument,
  SceneIssue,
} from "../types";
import { snapshotMathSourceData } from "./mathSourceData";
import {
  solveLinearFigure,
  verifyLinearFigureSolution,
  linearPointSatisfies,
  type ExactPoint,
  type LinearConstraint,
  type LinearFigureInput,
  type LinearFigureSolution,
  type LinearView,
} from "../math/linearRegion";
import {
  Q_ZERO as Z,
  Q_ONE as O,
  parseRational,
  serializeRational as out,
  deserializeRational as read,
  addRational as add,
  subtractRational as sub,
  multiplyRational as mul,
  divideRational as div,
  compareRational as cmp,
  exactRationalText as text,
  exactRationalToNumber as number,
  type Rational as Q,
} from "../math/exactRational";

export const LINEAR_REGION_OPERATORS = [
  "number_line_set",
  "linear_half_plane",
  "linear_feasible_region",
  "linear_system",
] as const;
export interface LinearRegionGeometry {
  kind: "linear_region";
  input: LinearFigureInput;
  solution: LinearFigureSolution;
  view: LinearView;
}
type Point = { x: Q; y: Q };
const point = (x: Q, y: Q): ExactPoint => ({ x: out(x), y: out(y) });
const pointKey = (p: ExactPoint): string => `${text(p.x)},${text(p.y)}`;
const equal = (a: Q, b: Q): boolean => cmp(a, b) === 0;
const mid = (a: Q, b: Q): Q => div(add(a, b), parseRational(2));
function readView(raw: unknown, solution: LinearFigureSolution): LinearView {
  if (raw !== undefined) {
    if (
      typeof raw !== "object" ||
      raw === null ||
      Array.isArray(raw) ||
      Object.keys(raw).sort().join(",") !== "xMax,xMin,yMax,yMin"
    )
      throw new Error("Linear view requires exactly xMin,xMax,yMin,yMax");
    const values = raw as Record<string, unknown>;
    const scalar = (key: string): Q => {
      const value = values[key];
      if (typeof value !== "number" && typeof value !== "string")
        throw new Error("Linear view requires exact finite scalar bounds");
      return parseRational(value);
    };
    const xMin = scalar("xMin"),
      xMax = scalar("xMax"),
      yMin = scalar("yMin"),
      yMax = scalar("yMax");
    if (
      cmp(xMin, xMax) >= 0 ||
      cmp(yMin, yMax) >= 0 ||
      cmp(xMin, Z) > 0 ||
      cmp(xMax, Z) < 0 ||
      cmp(yMin, Z) > 0 ||
      cmp(yMax, Z) < 0
    )
      throw new Error("Linear view must be increasing and contain the origin");
    const view = {
      xMin: out(xMin),
      xMax: out(xMax),
      yMin: out(yMin),
      yMax: out(yMax),
    };
    const required: ExactPoint[] =
      solution.kind === "linear_feasible_region"
        ? solution.closureVertices.map((corner) => corner.point)
        : solution.kind === "linear_system" && solution.intersection
          ? [solution.intersection]
          : [];
    if (solution.kind === "linear_feasible_region" && solution.objective) {
      const extremum = solution.objective.extremum;
      if (extremum.status === "attained") required.push(extremum.point);
      if (extremum.status === "finite_limit")
        required.push(extremum.closurePoint);
    }
    if (solution.kind === "number_line_set")
      for (const interval of solution.intervals)
        for (const endpoint of [interval.lower, interval.upper])
          if (endpoint) required.push(point(read(endpoint.value), Z));
    if (
      required.some(
        (p) =>
          cmp(read(p.x), xMin) < 0 ||
          cmp(read(p.x), xMax) > 0 ||
          cmp(read(p.y), yMin) < 0 ||
          cmp(read(p.y), yMax) > 0,
      )
    )
      throw new Error(
        "Linear display window excludes a required exact endpoint, corner or intersection",
      );
    if (
      solution.kind === "linear_half_plane" &&
      solution.state === "proper_half_plane"
    ) {
      if (boundarySegment(solution.constraints[0]!, view).length !== 2)
        throw new Error("Linear display window must show the source boundary");
      const clipped = clipLinearRegion(solution.constraints, view);
      const centroid = clipped.length
        ? point(
            div(
              clipped.reduce((sum, p) => add(sum, read(p.x)), Z),
              parseRational(clipped.length),
            ),
            div(
              clipped.reduce((sum, p) => add(sum, read(p.y)), Z),
              parseRational(clipped.length),
            ),
          )
        : null;
      if (
        !centroid ||
        !linearPointSatisfies(solution.constraints, centroid) ||
        !hasPlanarArea(clipped)
      )
        throw new Error(
          "Linear display window must contain actual shaded half-plane area",
        );
    }
    if (
      solution.kind === "linear_system" &&
      solution.equations.some((row) => boundarySegment(row, view).length !== 2)
    )
      throw new Error("Linear display window must show both system boundaries");
    if (
      solution.kind === "linear_feasible_region" &&
      solution.feasibility.feasible
    ) {
      const clipped = clipLinearRegion(solution.constraints, view);
      const centroid = clipped.length
        ? point(
            div(
              clipped.reduce((sum, p) => add(sum, read(p.x)), Z),
              parseRational(clipped.length),
            ),
            div(
              clipped.reduce((sum, p) => add(sum, read(p.y)), Z),
              parseRational(clipped.length),
            ),
          )
        : null;
      if (!centroid || !linearPointSatisfies(solution.constraints, centroid))
        throw new Error("Linear display window has no actual feasible points");
      if (solution.dimension === 2 && !hasPlanarArea(clipped))
        throw new Error(
          "Linear display window collapses the actual region dimension",
        );
    }
    return view;
  }
  const xs: Q[] = [Z],
    ys: Q[] = [Z];
  const include = (p: ExactPoint): void => {
    xs.push(read(p.x));
    ys.push(read(p.y));
  };
  if (solution.kind === "number_line_set")
    for (const interval of solution.intervals) {
      if (interval.lower) xs.push(read(interval.lower.value));
      if (interval.upper) xs.push(read(interval.upper.value));
    }
  else {
    const rows =
      solution.kind === "linear_system"
        ? solution.equations
        : solution.constraints;
    for (const row of rows) {
      const a = read(row.a),
        b = read(row.b),
        rhs = read(row.rhs);
      if (a.n) xs.push(div(rhs, a));
      if (b.n) ys.push(div(rhs, b));
    }
    if (solution.kind === "linear_feasible_region") {
      solution.closureVertices.forEach((corner) => include(corner.point));
      if (solution.feasibility.feasible) include(solution.feasibility.witness);
    }
    if (solution.kind === "linear_system" && solution.intersection)
      include(solution.intersection);
  }
  const extent = (values: Q[]): [Q, Q] => {
    const sorted = values.sort(cmp);
    let lo = sorted[0]!,
      hi = sorted.at(-1)!;
    const width = sub(hi, lo);
    const pad =
      cmp(width, O) < 0 ? parseRational(2) : div(width, parseRational(4));
    lo = sub(lo, pad);
    hi = add(hi, pad);
    return [lo, hi];
  };
  const [xMin, xMax] = extent(xs),
    [yMin, yMax] =
      solution.kind === "number_line_set" ? [parseRational(-1), O] : extent(ys);
  return { xMin: out(xMin), xMax: out(xMax), yMin: out(yMin), yMax: out(yMax) };
}
function hasPlanarArea(points: readonly ExactPoint[]): boolean {
  return (
    points.length >= 3 &&
    points.reduce(
      (area, p, i) =>
        add(
          area,
          sub(
            mul(read(p.x), read(points[(i + 1) % points.length]!.y)),
            mul(read(p.y), read(points[(i + 1) % points.length]!.x)),
          ),
        ),
      Z,
    ).n !== 0n
  );
}
export function evaluateLinearRegionConstruction(
  operator: string,
  raw: Record<string, unknown>,
): LinearRegionGeometry[] {
  if (!(LINEAR_REGION_OPERATORS as readonly string[]).includes(operator))
    throw new Error("Unsupported linear figure operator");
  const { view, ...source } = snapshotMathSourceData(raw);
  if ("kind" in source) throw new Error("Operator supplies linear figure kind");
  const input = { kind: operator, ...source } as LinearFigureInput;
  const solution = solveLinearFigure(input);
  const proof = verifyLinearFigureSolution(input, solution);
  if (proof.length)
    throw new Error(proof.map((issue) => issue.message).join("; "));
  const geometry: LinearRegionGeometry = {
    kind: "linear_region",
    input,
    solution,
    view: readView(view, solution),
  };
  linearRegionPrimitives(geometry, "display_check", "display_check");
  return [geometry];
}
export function validateLinearRegionConstruction(
  construction: SceneConstruction,
  index: number,
  document: SceneDocument,
  issues: SceneIssue[],
): void {
  const fail = (message: string): void => {
    issues.push({
      code: "invalid_linear_region",
      message,
      severity: "fatal",
      path: `constructions[${index}]`,
      entityIds: construction.outputs,
    });
  };
  if (
    construction.outputs.length !== 1 ||
    document.entities.find((entity) => entity.id === construction.outputs[0])
      ?.kind !== "linear_region"
  )
    return fail("Linear operators require one linear_region output");
  const entity = document.entities.find(
    (candidate) => candidate.id === construction.outputs[0],
  )!;
  if (
    entity.provenance &&
    Object.keys(entity.provenance).some(
      (key) =>
        /^linear/i.test(key) ||
        [
          "worldPoints",
          "fillOnly",
          "fillRole",
          "pointStyle",
          "dashed",
        ].includes(key),
    )
  )
    return fail("Linear certificates and semantic styles are compiler-owned");
  try {
    evaluateLinearRegionConstruction(
      construction.operator,
      construction.inputs,
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : "Invalid linear region");
  }
}
/** Exact display clipping. Viewport corners are not mathematical vertices. */
export function clipLinearRegion(
  constraints: readonly LinearConstraint[],
  view: LinearView,
): ExactPoint[] {
  let polygon: Point[] = [
    { x: read(view.xMin), y: read(view.yMin) },
    { x: read(view.xMax), y: read(view.yMin) },
    { x: read(view.xMax), y: read(view.yMax) },
    { x: read(view.xMin), y: read(view.yMax) },
  ];
  for (const row of constraints) {
    const a = read(row.a),
      b = read(row.b),
      rhs = read(row.rhs);
    const residual = (p: Point): Q => sub(rhs, add(mul(a, p.x), mul(b, p.y)));
    const next: Point[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i]!,
        q = polygon[(i + 1) % polygon.length]!,
        s = residual(p),
        t = residual(q),
        inside = s.n >= 0n,
        nextInside = t.n >= 0n;
      if (inside) next.push(p);
      if (inside !== nextInside) {
        const ratio = div(s, sub(s, t));
        next.push({
          x: add(p.x, mul(ratio, sub(q.x, p.x))),
          y: add(p.y, mul(ratio, sub(q.y, p.y))),
        });
      }
    }
    polygon = next.filter(
      (p, i, all) =>
        i === 0 || !equal(p.x, all[i - 1]!.x) || !equal(p.y, all[i - 1]!.y),
    );
    if (
      polygon.length > 1 &&
      equal(polygon[0]!.x, polygon.at(-1)!.x) &&
      equal(polygon[0]!.y, polygon.at(-1)!.y)
    )
      polygon.pop();
  }
  return polygon.map((p) => point(p.x, p.y));
}
function boundarySegment(
  row: LinearConstraint,
  view: LinearView,
): ExactPoint[] {
  const a = read(row.a),
    b = read(row.b),
    rhs = read(row.rhs),
    x0 = read(view.xMin),
    x1 = read(view.xMax),
    y0 = read(view.yMin),
    y1 = read(view.yMax);
  const candidates: ExactPoint[] = [];
  if (b.n)
    for (const x of [x0, x1]) {
      const y = div(sub(rhs, mul(a, x)), b);
      if (cmp(y, y0) >= 0 && cmp(y, y1) <= 0) candidates.push(point(x, y));
    }
  if (a.n)
    for (const y of [y0, y1]) {
      const x = div(sub(rhs, mul(b, y)), a);
      if (cmp(x, x0) >= 0 && cmp(x, x1) <= 0) candidates.push(point(x, y));
    }
  return [...new Map(candidates.map((p) => [pointKey(p), p])).values()].slice(
    0,
    2,
  );
}
export function linearRegionPrimitives(
  geometry: LinearRegionGeometry,
  entityId: string,
  groupId: string,
): RenderPrimitive[] {
  const { solution, view } = geometry;
  const primitives: RenderPrimitive[] = [];
  const x0 = read(view.xMin),
    x1 = read(view.xMax),
    y0 = read(view.yMin),
    y1 = read(view.yMax),
    w = sub(x1, x0),
    h = sub(y1, y0);
  const dx = div(w, parseRational(40)),
    dy = div(h, parseRational(30));
  const emit = (
    kind: RenderPrimitive["kind"],
    points: ExactPoint[],
    role: string,
    extra: Record<string, unknown> = {},
    label?: string,
  ): void => {
    primitives.push({
      id: `primitive_${entityId}_${primitives.length}`,
      entityId,
      groupId,
      kind,
      points: points.map((p) => ({ x: number(p.x), y: number(p.y) })),
      ...(kind === "point" ? { radius: 4 } : {}),
      ...(label ? { text: label } : {}),
      provenance: {
        linearSolution: geometry,
        linearRole: role,
        worldPoints: points,
        ...extra,
      },
    });
  };
  const label = (p: ExactPoint, value: string, role = "caption"): void =>
    emit("label", [p], role, {}, value);
  const axes = (): void => {
    const rows =
      solution.kind === "linear_system"
        ? solution.equations
        : solution.kind === "number_line_set"
          ? []
          : solution.constraints;
    const strictXAxis = rows.some(
      (row) => row.strict && read(row.a).n === 0n && read(row.rhs).n === 0n,
    );
    const strictYAxis = rows.some(
      (row) => row.strict && read(row.b).n === 0n && read(row.rhs).n === 0n,
    );
    if (!strictXAxis && !strictYAxis)
      emit(
        "axes",
        [point(x0, Z), point(x1, Z), point(Z, y0), point(Z, y1)],
        "axis",
      );
    else {
      if (!strictXAxis) emit("ray", [point(x0, Z), point(x1, Z)], "axis");
      if (!strictYAxis) emit("ray", [point(Z, y0), point(Z, y1)], "axis");
    }
    const names =
      solution.kind === "number_line_set"
        ? [solution.variable, ""]
        : solution.variables;
    label(point(sub(x1, dx), sub(Z, dy)), names[0], "axis_label");
    label(point(dx, sub(y1, dy)), names[1], "axis_label");
    const originNamed =
      solution.kind === "linear_feasible_region" &&
      solution.closureVertices.some(
        (corner) =>
          read(corner.point.x).n === 0n && read(corner.point.y).n === 0n,
      );
    if (!originNamed) label(point(dx, sub(Z, dy)), "0", "tick");
  };
  const summary: string[] = [];
  if (solution.kind === "number_line_set") {
    emit("ray", [point(x0, Z), point(x1, Z)], "axis");
    label(point(x1, sub(Z, dy)), solution.variable, "axis_label");
    for (const interval of solution.intervals) {
      const left = interval.lower ? read(interval.lower.value) : x0,
        right = interval.upper ? read(interval.upper.value) : x1;
      if (cmp(left, right) !== 0) {
        if (!interval.lower)
          emit("ray", [point(right, Z), point(x0, Z)], "solution_interval", {
            strokeWidth: 3,
          });
        if (!interval.upper)
          emit("ray", [point(left, Z), point(x1, Z)], "solution_interval", {
            strokeWidth: 3,
          });
        if (interval.lower && interval.upper)
          emit("line", [point(left, Z), point(right, Z)], "solution_interval", {
            strokeWidth: 3,
          });
      }
      const endpoints = [interval.lower, interval.upper].filter(
        (endpoint, index, all) =>
          endpoint &&
          (index === 0 ||
            !all[0] ||
            text(endpoint.value) !== text(all[0].value)),
      );
      for (const endpoint of endpoints)
        if (endpoint) {
          const x = read(endpoint.value);
          emit("point", [point(x, Z)], "solution_endpoint", {
            pointStyle: endpoint.included ? "filled" : "open",
          });
          label(point(x, Z), text(endpoint.value), "endpoint_label");
        }
    }
    const intervals = solution.intervals.map(
      (i) =>
        `${i.lower?.included ? "[" : "("}${i.lower ? text(i.lower.value) : "-infinity"}, ${i.upper ? text(i.upper.value) : "infinity"}${i.upper?.included ? "]" : ")"}`,
    );
    summary.push(
      intervals.length
        ? `Solution: ${intervals.join(" union ")}`
        : "Solution: empty set",
    );
  } else {
    const rows =
      solution.kind === "linear_system"
        ? solution.equations
        : solution.constraints;
    const feasible =
      solution.kind === "linear_system" ? false : solution.feasibility.feasible;
    if (feasible) {
      const polygon = clipLinearRegion(rows, view);
      if (polygon.length >= 3)
        emit("polygon", polygon, "feasible_fill", {
          fillRole: "region",
          fillOnly: true,
        });
      else if (polygon.length === 2)
        emit("line", polygon, "feasible_segment", { strokeWidth: 3 });
      else if (polygon.length === 1) emit("point", polygon, "feasible_point");
    }
    axes();
    const boundaryLines = new Map<string, RenderPrimitive>();
    const boundaryLabels = new Map<
      string,
      { points: ExactPoint[]; texts: string[] }
    >();
    rows.forEach((row, i) => {
      const segment = boundarySegment(row, view);
      if (segment.length === 2) {
        const key = segment.map(pointKey).sort().join(";");
        const previous = boundaryLines.get(key);
        if (!previous) {
          emit("line", segment, "source_boundary", {
            dashed: row.strict,
            linearConstraint: row,
          });
          boundaryLines.set(key, primitives.at(-1)!);
        } else if (row.strict)
          previous.provenance = {
            ...previous.provenance,
            dashed: true,
            linearConstraint: row,
          };
      }
      const source =
        solution.kind === "linear_half_plane"
          ? geometry.input.kind === "linear_half_plane"
            ? geometry.input.inequality
            : ""
          : solution.kind === "linear_system"
            ? geometry.input.kind === "linear_system"
              ? geometry.input.equations[i]
              : ""
            : geometry.input.kind === "linear_feasible_region"
              ? geometry.input.constraints[
                  Number(row.sourceId.replace(/\D/g, "")) - 1
                ]
              : "";
      if (source) {
        const axisBoundary =
          read(row.rhs).n === 0n &&
          (read(row.a).n === 0n || read(row.b).n === 0n);
        if (
          segment.length === 2 &&
          (!axisBoundary ||
            solution.kind === "linear_system" ||
            solution.kind === "linear_half_plane")
        ) {
          const key = segment.map(pointKey).sort().join(";");
          const equation = source.replace(
            /<=|>=|<|>|≤|≥|\\(?:leq|le|geq|ge)\b/,
            "=",
          );
          const owner = boundaryLabels.get(key);
          if (owner) {
            if (!owner.texts.includes(equation)) owner.texts.push(equation);
          } else
            boundaryLabels.set(key, { points: segment, texts: [equation] });
        }
        if (
          (solution.kind === "linear_half_plane" ||
            axisBoundary ||
            segment.length !== 2) &&
          !summary.includes(source)
        )
          summary.push(source);
      }
    });
    for (const boundary of boundaryLabels.values())
      label(
        point(
          mid(read(boundary.points[0]!.x), read(boundary.points[1]!.x)),
          mid(read(boundary.points[0]!.y), read(boundary.points[1]!.y)),
        ),
        boundary.texts.join("; "),
        "boundary_label",
      );
    if (solution.kind === "linear_half_plane")
      summary.push(
        solution.state === "empty"
          ? "Solution: empty set"
          : solution.state === "all_plane"
            ? "Solution: all points"
            : "Shaded side satisfies the inequality",
      );
    if (solution.kind === "linear_feasible_region") {
      if (!solution.feasibility.feasible) summary.push("No feasible points");
      else {
        summary.push(
          solution.bounded
            ? "Feasible region: bounded"
            : "Feasible region: unbounded",
        );
        solution.closureVertices.forEach((corner) => {
          emit("point", [corner.point], "closure_corner", {
            pointStyle: corner.included ? "filled" : "open",
            linearCorner: corner,
          });
          label(
            corner.point,
            `(${text(corner.point.x)}, ${text(corner.point.y)})${corner.included ? "" : " excluded"}`,
            "corner_label",
          );
        });
      }
      if (solution.objective) {
        const objective = solution.objective;
        summary.push(
          `${objective.sense === "max" ? "Maximize" : "Minimize"} ${objective.expression}`,
        );
        objective.cornerValues.forEach((corner) =>
          summary.push(
            `(${text(corner.point.x)}, ${text(corner.point.y)}): ${text(corner.value)}${corner.included ? "" : " (excluded)"}`,
          ),
        );
        const optimum = objective.extremum;
        summary.push(
          optimum.status === "attained"
            ? `${objective.sense === "max" ? "Maximum" : "Minimum"} = ${text(optimum.value)}`
            : optimum.status === "finite_limit"
              ? `${objective.sense === "max" ? "Supremum" : "Infimum"} = ${text(optimum.value)} (not attained)`
              : optimum.status === "unbounded"
                ? `${objective.sense === "max" ? "Maximum" : "Minimum"}: unbounded`
                : "Objective: infeasible",
        );
        if (optimum.status === "attained") {
          const cost = objective.coefficients;
          const rhs = out(sub(read(optimum.value), read(cost.constant)));
          const equality: LinearConstraint = {
            a: cost.a,
            b: cost.b,
            rhs,
            strict: false,
            sourceId: "objective_face",
          };
          const negative: LinearConstraint = {
            ...equality,
            a: out(mul(read(cost.a), parseRational(-1))),
            b: out(mul(read(cost.b), parseRational(-1))),
            rhs: out(mul(read(rhs), parseRational(-1))),
          };
          const face = clipLinearRegion(
            [...solution.constraints, equality, negative],
            view,
          );
          if (face.length === 2)
            emit("line", face, "optimal_face", {
              strokeWidth: 3,
              linearObjective: objective,
            });
          if (face.length === 2)
            for (const corner of solution.closureVertices)
              if (
                !corner.included &&
                face.some(
                  (endpoint) => pointKey(endpoint) === pointKey(corner.point),
                )
              )
                emit("point", [corner.point], "optimal_excluded_endpoint", {
                  pointStyle: "open",
                });
          if (read(cost.a).n === 0n && read(cost.b).n === 0n)
            summary.push("Every feasible point is optimal");
          emit("point", [optimum.point], "optimal_point", {
            pointStyle: "filled",
          });
        }
      }
    }
    if (solution.kind === "linear_system") {
      summary.push(
        solution.relation === "unique"
          ? "One solution"
          : solution.relation === "parallel"
            ? "Parallel lines: no solution"
            : "Coincident lines: infinitely many solutions",
      );
      if (solution.intersection) {
        emit("point", [solution.intersection], "intersection");
        label(
          solution.intersection,
          `(${text(solution.intersection.x)}, ${text(solution.intersection.y)})`,
          "intersection_label",
        );
      }
    }
  }
  // Verified labels live in their own rows above the plot. They do not change its metric.
  summary.forEach((value, i) =>
    label(
      point(mid(x0, x1), add(y1, mul(dy, parseRational(2 + i * 2)))),
      value,
    ),
  );
  return primitives;
}
