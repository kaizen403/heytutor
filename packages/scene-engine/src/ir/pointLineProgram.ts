/** A source program for one stated coordinate point projected onto one stated linear equation. */
import { readPointLineSourceLiterals, validatePointLineSourceInputs } from "./pointLineSource";
import { expressionToSafeSource, validateProblemIR, type ExpressionNodeIR, type ProblemIR } from "./problemIR";
import { parseMathExpression } from "../math/expression";
import { SCENE_DOCUMENT_VERSION, type SceneDocument } from "../types";

export type PointLineProgramReading =
  | { status: "none" }
  | { status: "declined"; reason: string }
  | { status: "ok"; point: { x: number; y: number; name?: string; origin?: true }; line: { a: number; b: number; c: number }; foot: { x: number; y: number }; distance: number; footName?: string };

export function readPointLineProgram(question: string): PointLineProgramReading {
  // Parse a mathematical request, not a chapter or question identifier. The
  // literal reader must consume its whole geometry before any construction.
  if (!/\b(?:distance|perpendicular\s+foot|foot\s+of\s+(?:the\s+)?perpendicular)\b/i.test(question)) return { status: "none" };
  const source = readPointLineSourceLiterals(question);
  if (source?.unreadPoint) return { status: "declined", reason: "a stated point is outside supported literal precision" };
  if (!source || source.lines.length === 0 || source.points.length === 0) return { status: "none" };
  if (source.unreadEquation || source.lines.length !== 1 || source.points.length !== 1
    || /\b(?:space|three.dimensions|3D|planes?)\b/i.test(question)) return { status: "declined", reason: "one complete two-dimensional point and linear equation are required" };
  let residue = question.replace(/[−–—]/g, "-").replace(/[·×]/g, "*").replace(/\s+/g, " ");
  for (const span of [...source.spans].sort((a, b) => b.start - a.start)) residue = residue.slice(0, span.start) + (span.kind === "point" ? "@P" : "@L") + residue.slice(span.end);
  const footRequest = String.raw`(?:perpendicular\s+foot|foot\s+of\s+(?:the\s+)?perpendicular)(?:\s+[A-Z][A-Za-z]?\d?'?)?`;
  const request = new RegExp(String.raw`^(?:In Cartesian coordinate units,\s*)?(?:Find|Calculate|Determine)\s+(?:the\s+)?(?:(?:perpendicular\s+)?distance(?:\s+and\s+(?:the\s+)?${footRequest})?|${footRequest}(?:\s+and\s+(?:the\s+)?distance)?)\s+(?:of|from)\s+(?:the\s+)?(?:point\s+)?@P\s+(?:from|to)\s+(?:the\s+)?(?:line\s+)?@L[.?!]?$`, "i");
  if (!request.test(residue.trim())) return { status: "declined", reason: "the complete requested projection is not consumed by the source grammar" };
  const point = source.points[0]!;
  const line = source.lines[0]!;
  const scale = Math.hypot(line.a, line.b);
  const signed = (line.a * point.x + line.b * point.y + line.c) / scale;
  const foot = { x: point.x - signed * line.a / scale, y: point.y - signed * line.b / scale };
  const distance = Math.abs(signed);
  if (![foot.x, foot.y, distance].every(Number.isFinite)) return { status: "declined", reason: "nonfinite projection" };
  const footName = /\b(?:perpendicular\s+foot|foot(?:\s+of\s+(?:the\s+)?perpendicular)?)\s+(?:named\s+)?([A-Z][A-Za-z]?\d?'?)\b/.exec(question)?.[1];
  if (footName && footName === point.name) return { status: "declined", reason: "source point and requested foot names conflict" };
  return { status: "ok", point, line, foot, distance, ...(footName ? { footName } : {}) };
}

/** Full facts and obligations are retained; an unbound IR role declines. */
export function pointLineSourceDocument(question: string, raw?: ProblemIR | null): SceneDocument | null {
  const reading = readPointLineProgram(question);
  if (reading.status !== "ok") return null;
  const { point, line, foot, distance } = reading;
  let pointId = "source_point", pointName = point.name ?? "P", lineId = "source_line", lineName = "L", footId = "foot", footName = reading.footName ?? (point.name === "H" ? "F" : "H");
  const quantities: SceneDocument["quantities"] = [];
  if (raw) {
    const checked = validateProblemIR(raw, question);
    if (!checked.problem || !checked.valid) return null;
    const problem = checked.problem;
    if (!pointLineProblemAgreement(problem, reading)) return null;
    const facts = new Map(problem.facts.map(fact => [fact.id, fact]));
    const givenPoint = (ids: string[]): boolean => ids.some(id => {
      const fact = facts.get(id);
      const literal = fact?.kind === "given" ? readPointLineSourceLiterals(fact.evidence.quote) : null;
      return literal?.points.some(candidate => candidate.x === point.x && candidate.y === point.y
        && (!point.name || point.origin || candidate.name === point.name)) ?? false;
    });
    const givenLine = (ids: string[]): boolean => ids.some(id => {
      const fact = facts.get(id);
      const literal = fact?.kind === "given" ? readPointLineSourceLiterals(fact.evidence.quote) : null;
      return literal?.lines.some(candidate => candidate.a === line.a && candidate.b === line.b && candidate.c === line.c) ?? false;
    });
    const points = problem.entities.filter(entity => entity.kind === "point" && givenPoint(entity.evidenceFactIds));
    const lines = problem.entities.filter(entity => entity.kind === "line" && givenLine(entity.evidenceFactIds));
    if (points.length !== 1 || lines.length !== 1) return null;
    const sourcePoint = points[0]!, sourceLine = lines[0]!;
    if (point.name && !point.origin && (sourcePoint.label ?? sourcePoint.id) !== point.name) return null;
    pointId = sourcePoint.id; pointName = sourcePoint.label ?? point.name ?? sourcePoint.id;
    lineId = sourceLine.id; lineName = sourceLine.label ?? "L";
    const additional = problem.entities.filter(entity => entity !== sourcePoint && entity !== sourceLine);
    if (additional.length > 1) return null;
    if (additional.length) {
      const result = additional[0]!;
      if (result.kind !== "point" || !result.evidenceFactIds.some(id => {
        const fact = facts.get(id);
        return fact?.kind === "requested" && /\b(?:perpendicular\s+foot|foot\s+of\s+(?:the\s+)?perpendicular)\b/i.test(fact.evidence.quote);
      })) return null;
      footId = result.id; footName = result.label ?? "H";
      if (reading.footName && footName !== reading.footName) return null;
    }
    // Do not convert an arbitrary number into a carried source dimension.
    // Every literal given must independently bind a coordinate/coefficient
    // role, its exact value, and the fact quoting that mathematical datum.
    for (const expression of problem.expressions) {
      if (!expression.evidenceFactIds.some(id => facts.get(id)?.kind === "given")
        || expression.evidenceFactIds.some(id => facts.get(id)?.kind === "requested")) continue;
      if (expression.root.kind !== "number" || expression.valueType !== "scalar") return null;
      const role = pointLineDimension(expression.id, pointName, reading);
      if (!role || role.value !== expression.root.value
        || !(role.symbol === "x" || role.symbol === "y" ? givenPoint(expression.evidenceFactIds) : givenLine(expression.evidenceFactIds))) return null;
      quantities.push({ id: expression.id, symbol: role.symbol, value: role.value, provenance: "given",
        evidenceFactIds: [...expression.evidenceFactIds], sourceText: expression.evidenceFactIds.map(id => facts.get(id)!.evidence.quote).join("\n") });
    }
  }
  if ([pointId, lineId, footId].some((id, index, ids) => ids.indexOf(id) !== index)
    || [pointName, lineName, footName].some((name, index, names) => name.length > 16 || names.indexOf(name) !== index)) return null;
  const xs = [0, point.x, foot.x], ys = [0, point.y, foot.y];
  const span = Math.max(1, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const margin = Math.max(1, span * .25);
  const dId = "projection_distance";
  if ([pointId, lineId, footId].includes(dId) || [pointId, lineId, footId].includes("projection_axes")) return null;
  const document: SceneDocument = {
    schemaVersion: SCENE_DOCUMENT_VERSION, source: { question },
    visualDecision: { mode: "scene", reason: "The complete stated point, infinite line, and certified perpendicular projection." }, quantities,
    entities: [
      { id: "projection_axes", kind: "axes", role: "coordinate frame" },
      { id: pointId, kind: "point", role: "source point", label: pointName },
      { id: lineId, kind: "line", role: "source infinite line", label: lineName },
      { id: footId, kind: "point", role: "perpendicular foot", label: footName },
      { id: dId, kind: distance === 0 ? "point" : "segment", role: "perpendicular distance", label: "d" },
    ],
    constructions: [
      { id: "projection_frame", operator: "axes", inputs: { xMin: Math.min(...xs) - margin, xMax: Math.max(...xs) + margin, yMin: Math.min(...ys) - margin, yMax: Math.max(...ys) + margin }, outputs: ["projection_axes"] },
      { id: "place_source_point", operator: "point", inputs: { x: point.x, y: point.y, coordinateSpace: "world" }, outputs: [pointId] },
      { id: "construct_source_line", operator: "line_equation", inputs: { form: "general", ...line }, outputs: [lineId] },
      { id: "project_source_point", operator: "project", inputs: { point: pointId, line: lineId }, outputs: [footId] },
      { id: "measure_projection", operator: "point_line_distance", inputs: { point: pointId, ...line }, outputs: [dId] },
    ], relations: [],
    assertions: [
      { id: "foot_on_line", predicate: "on", entities: [footId, lineId], severity: "fatal" },
      ...(distance ? [{ id: "normal_distance", predicate: "perpendicular", entities: [dId, lineId], severity: "fatal" as const }] : []),
    ], annotations: [], requiredEntityIds: [pointId, lineId, footId, dId],
    revealGroups: [
      { id: "source_geometry", entityIds: ["projection_axes", pointId, lineId], dependsOn: [], narrationCue: "Plot the stated point and line." },
      { id: "projection", entityIds: [footId, dId], dependsOn: ["source_geometry"], narrationCue: distance === 0 ? "The point is already on the line." : "Show the perpendicular foot and shortest distance." },
    ], teachingTimeline: [
      { id: "show_source_geometry", action: "reveal", targetId: "source_geometry", dependsOn: [], narrationIntent: "Show the source geometry." },
      { id: "show_projection", action: "reveal", targetId: "projection", dependsOn: ["show_source_geometry"], narrationIntent: "Show the verified perpendicular projection." },
    ],
  };
  if (raw) {
    const mapping = new Map([[pointId, pointId], [lineId, lineId], [footId, footId]]);
    for (const constraint of raw.constraints) {
      if (constraint.kind === "equation" || constraint.kind === "inequality") continue;
      if (!constraint.entityIds.every(id => mapping.has(id))) return null;
      if (constraint.kind === "incident" && constraint.entityIds.includes(footId) && constraint.entityIds.includes(lineId)) continue;
      // No fabricated spatial assertion covers an unsupported relation.
      return null;
    }
  }
  return validatePointLineSourceInputs(document, question).some(issue => issue.severity === "fatal") ? null : document;
}

function hasVariable(node: ExpressionNodeIR): boolean {
  if (node.kind === "variable") return true;
  if (node.kind === "binary") return hasVariable(node.left) || hasVariable(node.right);
  if (node.kind === "unary") return hasVariable(node.operand);
  if (node.kind === "call") return hasVariable(node.argument);
  return false;
}

/** Source recomputation audits each bound numeric answer, not its request id. */
export function pointLineProblemAgreement(problem: ProblemIR, reading = readPointLineProgram(problem.question)): boolean {
  if (reading.status !== "ok") return false;
  const expressions = new Map(problem.expressions.map(expression => [expression.id, expression]));
  const facts = new Map(problem.facts.map(fact => [fact.id, fact]));
  for (const request of problem.solveRequests) {
    if (request.kind !== "evaluate" || !request.resultBinding) return false;
    const expression = expressions.get(request.expressionId);
    const binding = request.resultBinding;
    const symbol = binding.symbol.replace(/_/g, "").toLowerCase();
    const requested = binding.evidenceFactIds.map(id => facts.get(id));
    if (!expression || hasVariable(expression.root) || requested.some(fact => !fact || fact.kind !== "requested")) return false;
    const asksDistance = requested.some(fact => /\bdistance\b/i.test(fact!.evidence.quote));
    const asksFoot = requested.some(fact => /\b(?:perpendicular\s+foot|foot\s+of\s+(?:the\s+)?perpendicular)\b/i.test(fact!.evidence.quote));
    const foot = (reading.footName ?? "H").toLowerCase();
    const expected = asksDistance && ["d", "distance"].includes(symbol) ? reading.distance
      : asksFoot && [`x${foot}`, `${foot}x`, "xfoot", "footx"].includes(symbol) ? reading.foot.x
        : asksFoot && [`y${foot}`, `${foot}y`, "yfoot", "footy"].includes(symbol) ? reading.foot.y : null;
    if (expected === null || binding.unit && !["1", "unit", "units"].includes(binding.unit)) return false;
    try {
      const result = parseMathExpression(expressionToSafeSource(expression.root)).evaluate(0);
      if (Math.abs(result - expected) > 64 * Number.EPSILON * Math.max(1, Math.abs(expected))) return false;
    } catch { return false; }
  }
  return true;
}

function pointLineDimension(id: string, name: string, reading: Extract<PointLineProgramReading, { status: "ok" }>): { symbol: string; value: number } | null {
  const normalized = id.replace(/^e(?=[A-Z_])/, "").replace(/_/g, "").toLowerCase();
  const point = name.toLowerCase();
  if ([`${point}x`, `x${point}`, "x0"].includes(normalized)) return { symbol: "x", value: reading.point.x };
  if ([`${point}y`, `y${point}`, "y0"].includes(normalized)) return { symbol: "y", value: reading.point.y };
  for (const coefficient of ["a", "b", "c"] as const) if (normalized === coefficient) return { symbol: coefficient, value: reading.line[coefficient] };
  return null;
}
