import { readLinearSystemSource, readLinearSourceReferencePoints } from "../compile/linearRegionSource";
import { readLinearSourceIntersectionNames } from "../compile/linearSourcePoints";
import { parseLinearAffine, solveLinearFigure } from "../math/linearRegion";
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
): boolean {
  const covered = (start: number, end: number) => facts.some((fact) => fact.evidence.start <= start && fact.evidence.end >= end);
  const coordinates = [...question.matchAll(/\b(?:([xy])[- ]coordinates?|coordinates)\b/g)];
  if (!coordinates.length) {
    // Solving the complete pair requests its source variables. A separate
    // numeric request cannot hide behind a tiny quote of the word intersection.
    const solve = /\b[Ss]olve\s+(?:(?:the\s+)?(?:pair|system|equations)\b|(?:the\s+)?simultaneous\s+equations\b)/.exec(question);
    const requests = [...question.matchAll(/\b(?:find|determine|calculate|compute|give|state|report)\b([^.;?!]*)/gi)];
    if (requests.length) {
      // A tuple variable request is source semantics for native agreement,
      // not permission to cast a set result into one requested scalar.
      return !requireRequestedVariable && Boolean(solve) && requests.every(request => covered(request.index!, request.index! + request[0].length)
        && /^(?:(?:the\s+)?values?\s+of\s+)?(?:x\s*(?:,\s*(?:and\s*)?|and\s+)y|y\s*(?:,\s*(?:and\s*)?|and\s+)x)\s*$/i.test(request[1]!.trim()));
    }
    return !requireRequestedVariable || Boolean(solve && covered(solve.index, solve.index + solve[0].length));
  }
  let requested = false;
  const unambiguous = [...pointNames].every((name) => intersectionNames.has(name));
  for (const coordinate of coordinates) {
    if (!coordinate[1] && coordinate[0] !== "coordinates") return false;
    const before = question.slice(0, coordinate.index!);
    const verbs = [...before.matchAll(/\b(?:find|determine|calculate|give|state|report)\b/gi)];
    const verb = verbs.at(-1);
    if (!verb) return false;
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
    if (coordinate[1] === variable) requested = true;
  }
  return !requireRequestedVariable || requested;
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
  options: { requireRequestedVariable?: boolean; requestedFacts?: ProblemFact[] } = {},
): SourceLinearCoordinate | null {
  const symbol = rawSymbol.normalize("NFKC").replace(/\\(?:mathrm|text)\s*/g, "").replace(/[{}\s]/g, "");
  const match = /^([xy])(?:_([A-Za-z][A-Za-z0-9_]*))?$/.exec(symbol);
  if (!match) return null;
  try {
    const names = readLinearSourceIntersectionNames(question);
    if (names.size > 1 || (match[2] && !names.has(match[2]))) return null;
    const references = readLinearSourceReferencePoints(question, ["x", "y"]).points;
    const pointNames = new Set([...references.map((point) => point.label), ...[...question.matchAll(/\b[A-Z]\b/g)].map((point) => point[0])]);
    const facts = options.requestedFacts ?? [{ id: "originalSourceQuery", kind: "requested", statement: question, evidence: { source: "question", start: 0, end: question.length, quote: question } }];
    const variable = match[1] as "x" | "y";
    if (!hasSourceCoordinateQuery(question, variable, names, pointNames, facts, options.requireRequestedVariable ?? true)) return null;
    const source = readLinearSystemSource(question);
    if (!source) return null;
    const solution = solveLinearFigure(source);
    if (solution.kind !== "linear_system" || solution.relation !== "unique" || !solution.intersection) return null;
    if (references.some((reference) => names.has(reference.label)
      && (["x", "y"] as const).some((axis) => compareRational(deserializeRational(reference[axis]), deserializeRational(solution.intersection![axis])) !== 0))) return null;
    return { variable, equations: source.equations, coordinate: solution.intersection[variable] };
  } catch { return null; }
}

export interface SourceLinearScalarSelection {
  kind: "unique_source_linear_coordinate";
  variable: "x" | "y";
  equations: [string, string];
  exact: string;
}

/**
 * A roots/intersections request returns a set. A scalar TurnPlan binding may
 * select its sole member only when the original source independently proves a
 * unique affine two-line intersection and the request proves that same global
 * coordinate. Domain-limited singleton sets and planner-authored coordinates
 * never establish uniqueness or source authority here.
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
  if (!symbolMatch || symbolMatch[1] !== request.variable) return null;
  const requestFacts = binding.evidenceFactIds.map((id) => problem.facts.find((fact) => fact.id === id));
  if (!requestFacts.length || requestFacts.some((fact) => !fact || fact.kind !== "requested")) return null;
  if (requestFacts.some((fact) => fact!.evidence.source !== "question"
    || originalQuestion.slice(fact!.evidence.start, fact!.evidence.end) !== fact!.evidence.quote)) return null;
  try {
    // This join uses the explicit binding id. The complete original request,
    // including its target and transformations, proves the scalar's meaning.
    const role = readSourceLinearCoordinate(originalQuestion, binding.symbol, { requestedFacts: requestFacts as ProblemFact[] });
    if (!role || role.variable !== request.variable) return null;
    const coordinate = role.coordinate;
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
      selection: { kind: "unique_source_linear_coordinate", variable: request.variable, equations: role.equations, exact },
    };
  } catch {
    return null;
  }
}
