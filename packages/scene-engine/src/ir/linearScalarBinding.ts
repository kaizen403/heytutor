import { buildLinearSourceDocument, readLinearSystemSource, readLinearSourceReferencePoints } from "../compile/linearRegionSource";
import { readLinearSourceIntersectionNames } from "../compile/linearSourcePoints";
import { linearConstraintSignature, parseLinearAffine, parseLinearConstraint, solveLinearFigure, type IntervalExpression } from "../math/linearRegion";
import {
  deserializeRational,
  divideRational,
  negateRational,
  subtractRational,
  compareRational,
  exactRationalText,
  exactRationalToNumber,
  serializeRational,
} from "../math/exactRational";
import { expressionToSafeSource, type ProblemIR, type SolveRequest } from "./problemIR";
import type { SolverValue } from "./solver";
import type { ProblemFact } from "./problemIR";

/** Bounded direct-coordinate requests, never a keyword/point-name similarity join. */
function hasSourceCoordinateQuery(
  question: string,
  variable: "x" | "y",
  intersectionNames: Set<string>,
  pointNames: Set<string>,
  facts: ProblemFact[],
  requireRequestedVariable = true,
  allowRequestedTupleComponent = false,
): boolean {
  const covered = (start: number, end: number) => facts.some((fact) => fact.evidence.start <= start && fact.evidence.end >= end);
  const exactIntersection = [...question.matchAll(/(?:^|[.;?!])\s*(?:keep|show|label|mark|state|give|report)\s+(?:the|their)\s+intersection\s+exact\s*(?=[.;?!]|$)/gi)]
    .some(query => covered(query.index! + query[0].search(/\b(?:keep|show|label|mark|state|give|report)\b/i), query.index! + query[0].trimEnd().length));
  const coordinates = [...question.matchAll(/\b(?:([xy])[- ]coordinates?|coordinates)\b/g)];
  if (!coordinates.length) {
    // Solving the complete pair requests its source variables. A separate
    // numeric request cannot hide behind a tiny quote of the word intersection.
    const solve = /\b[Ss]olve\s+(?:(?:the\s+)?(?:pair|system|equations)\b|(?:the\s+)?simultaneous\s+equations\b)/.exec(question);
    const requests = [...question.matchAll(/\b(?:find|determine|calculate|compute|give|state|report)\b([^.;?!]*)/gi)];
    if (requests.length) {
      // A tuple variable request is source semantics for native agreement,
      // not permission to cast a set result into one requested scalar.
      return !requireRequestedVariable && requests.every(request => covered(request.index!, request.index! + request[0].length)
        && (Boolean(solve) && /^(?:(?:the\s+)?values?\s+of\s+)?(?:x\s*(?:,\s*(?:and\s*)?|and\s+)y|y\s*(?:,\s*(?:and\s*)?|and\s+)x)\s*$/i.test(request[1]!.trim())
          || /^(?:the\s+)?number\s+of\s+solutions\s+of\s+the\s+(?:system|pair)(?:\s+and\s+describe\s+them)?\s*$/i.test(request[1]!.trim())));
    }
    if (allowRequestedTupleComponent && exactIntersection) return true;
    const intersection = /\b(?:label|mark|show)\s+(?:(?:the|their)\s+)?(?:point\s+of\s+)?intersection\b/i.exec(question);
    return !requireRequestedVariable || Boolean(solve && (covered(solve.index, solve.index + solve[0].length)
      || intersection && covered(intersection.index, intersection.index + intersection[0].length)));
  }
  let requested = false;
  const unambiguous = [...pointNames].every((name) => intersectionNames.has(name));
  for (const coordinate of coordinates) {
    if (!coordinate[1] && coordinate[0] !== "coordinates") return false;
    const before = question.slice(0, coordinate.index!);
    const verbs = [...before.matchAll(/\b(?:find|determine|calculate|give|state|report)\b/gi)];
    const verb = verbs.at(-1);
    // Incidental prose such as "a crossing has fractional coordinates" is
    // not a transformed numeric request. Native agreement still proves the
    // coordinate from the complete system; scalar selection needs a request.
    if (!verb || /[.;?!]/.test(before.slice(verb.index! + verb[0].length))) {
      if (!coordinate[1] && /\b(?:fractional|rational|integer)\s*$/i.test(before)) continue;
      return false;
    }
    const prefix = before.slice(verb.index! + verb[0].length).trim().replace(/’/g, "'");
    const after = question.slice(coordinate.index! + coordinate[0].length);
    const sentenceEnd = after.search(/[.;?!]/);
    const rawSuffix = sentenceEnd < 0 ? after : after.slice(0, sentenceEnd);
    const suffix = rawSuffix.trim().replace(/’/g, "'");
    const end = coordinate.index! + coordinate[0].length + rawSuffix.length;
    if (!covered(verb.index!, end)) return false;
    let target: "intersection" | string | null = null;
    if (!suffix) {
      if (/^(?:(?:its|their|the)\s*)?(?:exact)?$/i.test(prefix)) target = unambiguous ? "intersection" : null;
      else if (/^the\s+intersection's$/i.test(prefix)) target = "intersection";
      else target = /^([A-Za-z][A-Za-z0-9_]*)'s$/.exec(prefix)?.[1] ?? null;
    } else if (/^(?:(?:the)\s*)?(?:exact)?$/i.test(prefix)) {
      if (/^of\s+(?:the|their)\s+intersection$/i.test(suffix)) target = "intersection";
      else target = /^of\s+([A-Za-z][A-Za-z0-9_]*)$/.exec(suffix)?.[1] ?? null;
    }
    // Modifiers (square/twice/negative), source units and unrelated point
    // targets are unsupported scalar requests, even when the root is correct.
    if (!target || (target !== "intersection" && !intersectionNames.has(target))) return false;
    if (coordinate[1] === variable || allowRequestedTupleComponent && !coordinate[1]) requested = true;
  }
  return !requireRequestedVariable || requested || allowRequestedTupleComponent && exactIntersection;
}

export interface SourceLinearCoordinate {
  variable: "x" | "y";
  equations: [string, string];
  coordinate: import("../math/exactRational").ExactRational;
}

/** Source-only semantic coordinate role, shared by scalar and native figure authority. */
export function readSourceLinearCoordinate(
  question: string,
  rawSymbol: string,
  options: { requireRequestedVariable?: boolean; requestedFacts?: ProblemFact[]; allowFixedCoordinate?: boolean; allowRequestedTupleComponent?: boolean } = {},
): SourceLinearCoordinate | null {
  const normalized = rawSymbol.normalize("NFKC").replace(/\\(?:mathrm|text)\s*/g, "").replace(/[{}]/g, "").trim();
  const prose = /^intersection\s+([xy])[- ]coordinate$/i.exec(normalized);
  const intersection = /^([xy])_intersection$/i.exec(normalized.replace(/\s/g, ""));
  const reverse = /^([A-Za-z][A-Za-z0-9_]*)_([xy])$/.exec(normalized);
  const symbol = prose?.[1] ?? intersection?.[1] ?? (reverse ? `${reverse[2]}_${reverse[1]}` : normalized.replace(/\s/g, ""));
  const match = /^([xy])(?:_([A-Za-z][A-Za-z0-9_]*))?$/.exec(symbol);
  if (!match) return null;
  try {
    const names = readLinearSourceIntersectionNames(question);
    if (names.size > 1 || (match[2] && !names.has(match[2]))) return null;
    const references = readLinearSourceReferencePoints(question, ["x", "y"]).points;
    const pointNames = new Set([...references.map((point) => point.label), ...[...question.matchAll(/\b[A-Z]\b/g)].map((point) => point[0])]);
    const facts = options.requestedFacts ?? [{ id: "originalSourceQuery", kind: "requested", statement: question, evidence: { source: "question", start: 0, end: question.length, quote: question } }];
    const variable = match[1] as "x" | "y";
    if (!hasSourceCoordinateQuery(question, variable, names, pointNames, facts, options.requireRequestedVariable ?? true, options.allowRequestedTupleComponent ?? false)) return null;
    const source = readLinearSystemSource(question);
    if (!source) return null;
    const solution = solveLinearFigure(source);
    if (solution.kind !== "linear_system") return null;
    if (options.allowFixedCoordinate && solution.relation === "coincident") {
      const row = solution.equations[0]!;
      const coefficient = deserializeRational(variable === "x" ? row.a : row.b);
      const other = deserializeRational(variable === "x" ? row.b : row.a);
      if (coefficient.n === 0n || other.n !== 0n || match[2]) return null;
      return { variable, equations: source.equations, coordinate: serializeRational(divideRational(deserializeRational(row.rhs), coefficient)) };
    }
    if (solution.relation !== "unique" || !solution.intersection) return null;
    if (references.some((reference) => (names.has(reference.label) || intersection && reference.label.toLowerCase() === "intersection")
      && (["x", "y"] as const).some((axis) => compareRational(deserializeRational(reference[axis]), deserializeRational(solution.intersection![axis])) !== 0))) return null;
    return { variable, equations: source.equations, coordinate: solution.intersection[variable] };
  } catch { return null; }
}

export type SourceLinearScalarSelection = {
  kind: "unique_source_linear_coordinate";
  variable: "x" | "y";
  equations: [string, string];
  exact: string;
} | { kind: "unique_source_linear_boundary"; variable: "x"; inequality: string; exact: string };

function sourceBoundary(problem: ProblemIR, request: SolveRequest, symbol: string, question: string) {
  if (request.kind !== "roots" || request.variable !== "x" || !/^(?:boundary|leftboundary|rightboundary)$/.test(symbol.toLowerCase())) return null;
  const bindingFacts = request.resultBinding!.evidenceFactIds.map(id => problem.facts.find(fact => fact.id === id));
  if (!bindingFacts.length || bindingFacts.some(fact => !fact || fact.evidence.source !== "question"
    || question.slice(fact.evidence.start, fact.evidence.end) !== fact.evidence.quote)
    || !bindingFacts.some(fact => fact?.kind === "requested" && /\b(?:solve|boundar(?:y|ies))\b/i.test(fact.evidence.quote))) return null;
  const construction = buildLinearSourceDocument(question)?.constructions[0];
  if (construction?.operator !== "number_line_set") return null;
  const expression = construction.inputs.expression as IntervalExpression;
  const solution = solveLinearFigure({ kind: "number_line_set", variable: "x", expression });
  if (solution.kind !== "number_line_set") return null;
  const boundaries = solution.intervals.flatMap(interval => [interval.lower?.value, interval.upper?.value].filter(value => value !== undefined));
  const unique = boundaries.filter((value, index) => boundaries.findIndex(other => compareRational(deserializeRational(other), deserializeRational(value)) === 0) === index)
    .sort((a, b) => compareRational(deserializeRational(a), deserializeRational(b)));
  const expected = symbol.toLowerCase() === "leftboundary" ? unique[0] : symbol.toLowerCase() === "rightboundary" ? unique.at(-1) : unique.length === 1 ? unique[0] : undefined;
  if (!expected) return null;
  const atoms = (program: IntervalExpression): string[] => "inequality" in program ? [program.inequality]
    : "complement" in program ? atoms(program.complement) : ("union" in program ? program.union : program.intersection).flatMap(atoms);
  const sourceAtoms = atoms(expression);
  const expressions = new Map(problem.expressions.map(item => [item.id, item]));
  const rows: Array<{ expressionId: string; inequality: string }> = [];
  // Require an orientation/strictness-equivalent IR inequality whose actual
  // original given quote is a complete source atom. A matching root alone
  // cannot authorize a flipped inequality, forged quote, or redundant bound.
  for (const constraint of problem.constraints) {
    if (constraint.kind !== "inequality") return null;
    const left = expressions.get(constraint.leftExpressionId), right = expressions.get(constraint.rightExpressionId);
    if (!left || !right) return null;
    const inequality = `(${expressionToSafeSource(left.root, "x")})${constraint.relation}(${expressionToSafeSource(right.root, "x")})`;
    const row = parseLinearConstraint(inequality, ["x"])[0]!;
    const sameSource = sourceAtoms.some(atom => linearConstraintSignature(parseLinearConstraint(atom, ["x"])[0]!) === linearConstraintSignature(row));
    const grounded = constraint.evidenceFactIds.some(id => {
      const fact = problem.facts.find(item => item.id === id);
      if (!fact || fact.kind !== "given" || fact.evidence.source !== "question" || question.slice(fact.evidence.start, fact.evidence.end) !== fact.evidence.quote) return false;
      try { return linearConstraintSignature(parseLinearConstraint(fact.evidence.quote, ["x"])[0]!) === linearConstraintSignature(row); } catch { return false; }
    });
    if (!sameSource || !grounded) return null;
    rows.push({ expressionId: constraint.leftExpressionId, inequality });
  }
  const requestedExpression = expressions.get(request.expressionId);
  const requestedAffine = requestedExpression ? parseLinearAffine(expressionToSafeSource(requestedExpression.root, "x"), ["x"]) : null;
  const row = rows.find(item => {
    if (item.expressionId === request.expressionId) return true;
    if (!requestedAffine) return false;
    const sourceRow = parseLinearConstraint(item.inequality, ["x"])[0]!;
    const coefficient = deserializeRational(requestedAffine.a), sourceCoefficient = deserializeRational(sourceRow.a);
    // A separately named rearranged difference must have the same exact
    // global root as a fully grounded source inequality. Domain clipping,
    // nonlinear roots and unquoted/reoriented source constraints stay refused.
    return coefficient.n !== 0n && sourceCoefficient.n !== 0n && deserializeRational(requestedAffine.b).n === 0n
      && compareRational(divideRational(negateRational(deserializeRational(requestedAffine.constant)), coefficient), divideRational(deserializeRational(sourceRow.rhs), sourceCoefficient)) === 0;
  });
  return row ? { coordinate: expected, inequality: row.inequality } : null;
}

/** A whole intersection tuple needs two explicit, independently proved scalar components. */
function completeTupleCoordinate(problem: ProblemIR, request: SolveRequest, question: string, requestFacts: ProblemFact[]): SourceLinearCoordinate | null {
  if (!request.resultBinding || (request.kind !== "roots" && request.kind !== "intersections") || (request.variable !== "x" && request.variable !== "y")) return null;
  const role = readSourceLinearCoordinate(question, request.resultBinding.symbol, { requestedFacts: requestFacts, allowRequestedTupleComponent: true });
  if (!role || role.variable !== request.variable) return null;
  const other = request.variable === "x" ? "y" : "x";
  const companions = problem.solveRequests.filter(candidate => {
    if (candidate.id === request.id || candidate.kind !== "evaluate" || !candidate.resultBinding
      || candidate.resultBinding.turnPlanQuantityId === request.resultBinding!.turnPlanQuantityId
      || candidate.resultBinding.unit !== undefined && candidate.resultBinding.unit.trim() !== "1") return false;
    const facts = candidate.resultBinding.evidenceFactIds.map(id => problem.facts.find(fact => fact.id === id));
    if (!facts.length || facts.some(fact => !fact || fact.kind !== "requested" || fact.evidence.source !== "question"
      || question.slice(fact.evidence.start, fact.evidence.end) !== fact.evidence.quote)) return false;
    const companionRole = readSourceLinearCoordinate(question, candidate.resultBinding.symbol, { requestedFacts: facts as ProblemFact[], allowRequestedTupleComponent: true });
    const expression = problem.expressions.find(item => item.id === candidate.expressionId);
    if (!companionRole || companionRole.variable !== other || !expression || expression.valueType !== "scalar") return false;
    const closed = parseLinearAffine(expressionToSafeSource(expression.root, other), ["x", "y"]);
    return deserializeRational(closed.a).n === 0n && deserializeRational(closed.b).n === 0n
      && compareRational(deserializeRational(closed.constant), deserializeRational(companionRole.coordinate)) === 0;
  });
  return companions.length === 1 ? role : null;
}

/**
 * A roots/intersections request returns a set. A scalar TurnPlan binding may
 * select its sole member only when the complete original source proves the
 * same global coordinate or finite set boundary. Boundary constraints must
 * preserve their source orientation, strictness and actual quoted evidence.
 * Domain-limited singleton sets never establish source authority here.
 */
export function selectSourceLinearScalar(
  problem: ProblemIR,
  request: SolveRequest,
  value: SolverValue,
  originalQuestion: string | undefined,
): { value: SolverValue; selection: SourceLinearScalarSelection } | null {
  if (!originalQuestion || problem.question !== originalQuestion
    || !request.resultBinding || (request.kind !== "roots" && request.kind !== "intersections")
    || (request.variable !== "x" && request.variable !== "y")
    || value.requestId !== request.id || value.valueType !== "set"
    || !Array.isArray(value.approximate) || value.approximate.length !== 1
    || !Array.isArray(value.exact) || value.exact.length !== 1) return null;
  const binding = request.resultBinding;
  if (binding.unit !== undefined && binding.unit.trim() !== "1") return null;
  const symbol = binding.symbol.normalize("NFKC").replace(/\\(?:mathrm|text)\s*/g, "").replace(/[{}\s]/g, "");
  const symbolMatch = /^([xy])(?:_([A-Za-z][A-Za-z0-9_]*))?$/.exec(symbol);
  const requestFacts = binding.evidenceFactIds.map((id) => problem.facts.find((fact) => fact.id === id));
  if (!requestFacts.length || requestFacts.some((fact) => !fact)) return null;
  if (requestFacts.some((fact) => fact!.evidence.source !== "question"
    || originalQuestion.slice(fact!.evidence.start, fact!.evidence.end) !== fact!.evidence.quote)) return null;
  try {
    // This join uses the explicit binding id. The complete original request,
    // including its target and transformations, proves the scalar's meaning.
    const boundary = sourceBoundary(problem, request, symbol, originalQuestion);
    const role = symbolMatch?.[1] === request.variable && requestFacts.every(fact => fact!.kind === "requested")
      ? readSourceLinearCoordinate(originalQuestion, binding.symbol, { requestedFacts: requestFacts as ProblemFact[] })
        ?? completeTupleCoordinate(problem, request, originalQuestion, requestFacts as ProblemFact[]) : null;
    if (!boundary && (!role || role.variable !== request.variable)) return null;
    const coordinate = boundary?.coordinate ?? role!.coordinate;
    const expected = deserializeRational(coordinate);
    const expressions = new Map(problem.expressions.map((expression) => [expression.id, expression]));
    const leftId = request.kind === "roots" ? request.expressionId : request.leftExpressionId;
    const leftExpression = expressions.get(leftId);
    const rightExpression = request.kind === "intersections" ? expressions.get(request.rightExpressionId) : undefined;
    if (!leftExpression || (request.kind === "intersections" && !rightExpression)) return null;
    // The audited infix adapter maps precisely the declared request variable
    // to its evaluator's x. It rejects any other free variable. The source
    // coordinate selected above still uses the original x/y variable name.
    const left = parseLinearAffine(expressionToSafeSource(leftExpression.root, request.variable));
    const right = parseLinearAffine(rightExpression ? expressionToSafeSource(rightExpression.root, request.variable) : "0");
    const coefficient = subtractRational(deserializeRational(left.a), deserializeRational(right.a));
    const otherCoefficient = subtractRational(deserializeRational(left.b), deserializeRational(right.b));
    if (coefficient.n === 0n || otherCoefficient.n !== 0n) return null;
    const constant = subtractRational(deserializeRational(left.constant), deserializeRational(right.constant));
    const requestCoordinate = divideRational(negateRational(constant), coefficient);
    if (compareRational(expected, requestCoordinate) !== 0) return null;
    const exact = exactRationalText(serializeRational(expected));
    const approximate = exactRationalToNumber(coordinate);
    const returnedExact = value.exact[0]!;
    if (returnedExact.kind !== (expected.d === 1n ? "integer" : "rational")
      || returnedExact.value !== exact || value.approximate[0] !== approximate
      || approximate < request.domain.min || approximate > request.domain.max) return null;
    return {
      value: { ...value, valueType: "scalar", approximate, exact: { kind: returnedExact.kind, value: exact }, errorBound: 0 },
      selection: boundary ? { kind: "unique_source_linear_boundary", variable: "x", inequality: boundary.inequality, exact }
        : { kind: "unique_source_linear_coordinate", variable: request.variable, equations: role!.equations, exact },
    };
  } catch {
    return null;
  }
}
