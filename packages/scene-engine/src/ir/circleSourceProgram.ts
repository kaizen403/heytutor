/** Whole closed source -> immutable full IR correspondence -> uncommitted scene.
 * No familyScene/compiler calls: public admission can independently regenerate.
 */
import { extractCircleSource } from "../synthesize/statedEquations";
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import { validateProblemIR, type ProblemIR, type ExpressionNodeIR, type QuestionSourceEvidence } from "./problemIR";
import { SCENE_DOCUMENT_VERSION, type SceneDocument, type SceneIssue } from "../types";
import {
  exact, plus, times, divide, negate, sameExact, numeric, decimalExact, exactText,
  polynomialOfSource, polynomialOfIR, coefficient, addPolynomial, equivalentPolynomial,
  type CircleRational, type CirclePolynomial,
} from "./circleSourceMath";

export type CircleValueRole = "A" | "B" | "C" | "D" | "E" | "F" | "center_x" | "center_y" | "radius" | "radius_squared";
export interface CircleSourcePoint {
  name?: string; x: number; y: number; evidence: QuestionSourceEvidence;
  exactX: CircleRational; exactY: CircleRational; position: "on" | "inside" | "outside";
}
export interface CircleWholeSource {
  question: string; name: string; centerName?: string;
  polynomial: CirclePolynomial; equations: Array<{ polynomial: CirclePolynomial; left: CirclePolynomial; right: CirclePolynomial; evidence: QuestionSourceEvidence }>;
  center: { x: number; y: number }; radius: number; radiusSquared: number; singleton: boolean;
  values: Record<CircleValueRole, CircleRational>;
  points: CircleSourcePoint[]; asks: CircleValueRole[];
  declarations: QuestionSourceEvidence[];
}
export type CircleProgramReading = { status: "none" } | { status: "declined"; reason: string } | { status: "ok"; source: CircleWholeSource };
const NUMBER = String.raw`[+\-−]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*\/\s*\d+)?`;
const PAIR = String.raw`\(\s*(${NUMBER})\s*,\s*(${NUMBER})\s*\)`;
const norm = (text: string): string => text.trim().replace(/[−–—]/g, "-").replace(/²/g, "^2").replace(/\s+/g, " ");
const literal = (text: string): CircleRational => {
  const parts = text.replace(/−/g, "-").replace(/\s/g, "").split("/");
  const numerator = decimalExact(parts[0]!);
  if (!sameExact(numerator, decimalExact(String(numeric(numerator))))) throw new Error("coordinate literal loses written precision");
  return parts.length === 1 ? numerator : divide(numerator, decimalExact(parts[1]!));
};
const evidence = (question: string, start: number, end: number): QuestionSourceEvidence => ({ source: "question", start, end, quote: question.slice(start, end) });

/** This is a grammar for one numeric Cartesian locus, never a topic/template router. */
export function readCircleSourceProgram(question: string): CircleProgramReading {
  const xSquare = /(?:x\s*(?:\^2|²|\?)|\(x[^()]*\)\s*(?:\^2|²))/.test(question);
  const ySquare = /(?:y\s*(?:\^2|²|\?)|\(y[^()]*\)\s*(?:\^2|²))/.test(question);
  const circleDefinition = /\bcircle\b/i.test(question) && (/[xy][\s\S]*=/.test(question) || /\([^()]*,[^()]*\)/.test(question));
  if (!(xSquare && ySquare) && !circleDefinition && !/\bcent(?:er|re)\b[^.;]*\(/i.test(question)) return { status: "none" };
  const decline = (reason: string): CircleProgramReading => ({ status: "declined", reason });
  try {
    if (question.length > 1600 || Array.from(question).some(char => char.charCodeAt(0) < 32)) return decline("source length/control budget");
    const consumed = Array.from(question, () => false);
    const consume = (start: number, end: number): void => { for (let i = start; i < end; i++) consumed[i] = true; };
    const declarations: QuestionSourceEvidence[] = [];
    let centerDeclaration: { x: CircleRational; y: CircleRational } | undefined;
    let radiusDeclaration: CircleRational | undefined;
    let centerName: string | undefined;
    const centerPattern = new RegExp(String.raw`\bcent(?:er|re)\s*(?:([A-Z](?:_?\d)?'?)\s*)?(?:at\s*|=\s*)?${PAIR}`, "g");
    for (const match of question.matchAll(centerPattern)) {
      if (centerDeclaration) return decline("multiple declared centers");
      centerDeclaration = { x: literal(match[2]!), y: literal(match[3]!) };
      centerName = match[1];
      const span = evidence(question, match.index!, match.index! + match[0].length);
      declarations.push(span); consume(span.start, span.end);
    }
    for (const match of question.matchAll(new RegExp(String.raw`\bradius\s*(?:of\s*|=\s*)?(${NUMBER})(?![\d/a-z]|\.\d)`, "g"))) {
      if (radiusDeclaration) return decline("multiple declared radii");
      radiusDeclaration = literal(match[1]!);
      if (radiusDeclaration.n < 0n) return decline("negative declared radius");
      const span = evidence(question, match.index!, match.index! + match[0].length);
      declarations.push(span); consume(span.start, span.end);
    }
    const points: Array<Omit<CircleSourcePoint, "position">> = [];
    const pointPattern = new RegExp(String.raw`(?:\b(?:point\s+)?([A-Z](?:_?\d)?'?)\s*(?:=\s*)?)?${PAIR}`, "g");
    for (const match of question.matchAll(pointPattern)) {
      const start = match.index!, end = start + match[0].length;
      if (consumed.slice(start, end).some(Boolean)) continue;
      const exactX = literal(match[2]!), exactY = literal(match[3]!);
      const span = evidence(question, start + (match[1] ? match[0].indexOf(match[1]) : match[0].indexOf("(")), end);
      points.push({ ...(match[1] ? { name: match[1] } : {}), x: numeric(exactX), y: numeric(exactY), exactX, exactY, evidence: span });
      consume(start, end);
    }
    for (const match of question.matchAll(/\borigin\b/g)) {
      const span = evidence(question, match.index!, match.index! + match[0].length);
      points.push({ name: "O", x: 0, y: 0, exactX: exact(0n), exactY: exact(0n), evidence: span });
      consume(span.start, span.end);
    }
    if (points.length > 8 || new Set(points.filter(p => p.name).map(p => p.name)).size !== points.filter(p => p.name).length) return decline("ambiguous/oversized point identities");
    const equations: CircleWholeSource["equations"] = [];
    const expressionCharacter = /[0-9xy+\-*/^().\s²−–—]/;
    const canScan = (i: number): boolean => expressionCharacter.test(question[i]!) && !(/[xy]/.test(question[i]!) && /[a-wzA-Z]/.test((question[i - 1] ?? "") + (question[i + 1] ?? "")));
    for (let i = 0; i < question.length; i++) {
      if (question[i] !== "=" || consumed[i]) continue;
      let start = i - 1, end = i + 1;
      while (start >= 0 && !consumed[start] && canScan(start)) start--;
      while (end < question.length && !consumed[end] && canScan(end)) end++;
      start++;
      const left = question.slice(start, i).trim(), right = question.slice(i + 1, end).trim().replace(/\.$/, "");
      if (!/[xy]/.test(left + right)) return decline("unbound equality");
      const leftPolynomial = polynomialOfSource(left), rightPolynomial = polynomialOfSource(right);
      const polynomial = addPolynomial(leftPolynomial, rightPolynomial, -1);
      const span = evidence(question, start + question.slice(start, i).indexOf(left), i + 1 + question.slice(i + 1, end).indexOf(right) + right.length);
      equations.push({ polynomial, left: leftPolynomial, right: rightPolynomial, evidence: span }); consume(start, end);
    }
    if (!equations.length && (!centerDeclaration || !radiusDeclaration)) return decline("no complete numeric circle definition");
    let polynomial = equations[0]?.polynomial;
    if (!polynomial) {
      const x = centerDeclaration!.x, y = centerDeclaration!.y, r = radiusDeclaration!;
      polynomial = new Map([["2,0", exact(1n)], ["0,2", exact(1n)], ["1,0", times(exact(-2n), x)], ["0,1", times(exact(-2n), y)], ["0,0", plus(plus(times(x, x), times(y, y)), negate(times(r, r)))]].filter(([, v]) => (v as CircleRational).n !== 0n) as Array<[string, CircleRational]>);
    }
    if (equations.some(row => !equivalentPolynomial(row.polynomial, polynomial!, true))) return decline("second different locus");
    const A = coefficient(polynomial, 2, 0), B = coefficient(polynomial, 1, 1), C = coefficient(polynomial, 0, 2);
    const D = coefficient(polynomial, 1, 0), E = coefficient(polynomial, 0, 1), F = coefficient(polynomial, 0, 0);
    if (!A.n || B.n || !sameExact(A, C)) return decline("not an exact Cartesian circle polynomial");
    const x = divide(negate(D), times(exact(2n), A)), y = divide(negate(E), times(exact(2n), A));
    const squared = plus(plus(times(x, x), times(y, y)), negate(divide(F, A)));
    if (squared.n < 0n) return decline("no real locus");
    if (centerDeclaration && (!sameExact(centerDeclaration.x, x) || !sameExact(centerDeclaration.y, y))) return decline("center contradicts equation");
    if (radiusDeclaration && !sameExact(times(radiusDeclaration, radiusDeclaration), squared)) return decline("radius contradicts equation");
    const center = { x: numeric(x), y: numeric(y) }, radiusSquared = numeric(squared), radius = Math.sqrt(radiusSquared);
    if (squared.n === 0n && centerName) return decline("named singleton center needs an unsupported alias correspondence");
    if (points.some((p, i) => points.some((q, j) => j < i && sameExact(p.exactX, q.exactX) && sameExact(p.exactY, q.exactY)))) return decline("coincident residual identities cannot retain separate physical marks");
    if (points.some(p => sameExact(p.exactX, x) && sameExact(p.exactY, y)) && (squared.n === 0n || centerName)) return decline("coincident source locus/center identities require an unsupported alias correspondence");
    if (radius > 0 && (radius <= 1e-6 || radius > 1e8 || Math.max(Math.abs(center.x), Math.abs(center.y)) * Number.EPSILON > radius * 1e-8)) return decline("geometry precision cannot preserve locus");
    // Reuse the existing source reader as a second arithmetic guard where it
    // understands the spelling. Exact algebra above is the identity authority.
    const legacy = extractCircleSource(question);
    if (legacy && legacy.kind !== "invalid" && (Math.abs(legacy.center.x - center.x) > 1e-8 * Math.max(1, radius) || Math.abs(legacy.radiusSquared - radiusSquared) > 1e-8 * Math.max(1, radiusSquared))) return decline("source arithmetic disagreement");
    let name = "circle";
    const named = /\bcircle\s+([A-Z](?:_?\d)?'?)(?=\s|:)/.exec(question);
    if (named) { name = named[1]!; consume(named.index + named[0].lastIndexOf(name), named.index + named[0].length); }
    if (centerName === name || points.some(point => point.name && (point.name === centerName || point.name === name))) return decline("conflicting body identities");
    const residual = Array.from(question, (char, i) => consumed[i] ? " " : char).join("");
    const vocabulary = new Set("find determine calculate draw sketch plot graph show mark locate the a an circle equation equations of and with having centre center radius squared coordinates coordinate point points at on inside outside or does lie lies is its it to from origin represented by represents equivalent equivalently locus singleton zero real in cartesian form standard general given whether position relative respect".split(" "));
    for (const word of residual.match(/[A-Za-z]+|[^A-Za-z\s.,;:?!]/g) ?? []) if (!vocabulary.has(word.toLowerCase())) return decline(`unsupported source token: ${word}`);
    const asks: CircleValueRole[] = [];
    if (/\b(?:find|determine|calculate)\b/i.test(residual)) {
      if (/\bcent(?:er|re)\b/i.test(residual)) asks.push("center_x", "center_y");
      if (/\bradius\s+squared\b/i.test(residual)) asks.push("radius_squared");
      else if (/\bradius\b/i.test(residual)) asks.push("radius");
      if (!asks.length) return decline("unsupported numeric request");
    }
    if (/\b(?:on|inside|outside|whether|does)\b/i.test(residual) && points.length !== 1) return decline("ambiguous membership request");
    const classified = points.map(point => {
      const dx = plus(point.exactX, negate(x)), dy = plus(point.exactY, negate(y));
      const delta = plus(plus(times(dx, dx), times(dy, dy)), negate(squared));
      return { ...point, position: delta.n === 0n ? "on" as const : delta.n > 0n ? "outside" as const : "inside" as const };
    });
    const membershipWords = residual.match(/\b(?:on|inside|outside)\b/gi) ?? [];
    if (membershipWords.length) {
      const isQuestion = /\b(?:does|whether)\b/i.test(residual) && /\blie\b/i.test(residual);
      const assertion = classified.length === 1 ? /^\s*(?:which\s+)?(?:lies\s+|is\s+)?(on|inside|outside)\s+(?:the\s+)?circle\b/i.exec(question.slice(classified[0]!.evidence.end)) : null;
      if (!isQuestion && (!assertion || membershipWords.length !== 1 || assertion[1]!.toLowerCase() !== classified[0]!.position)) return decline("unsupported or contradictory membership statement");
    }
    return { status: "ok", source: { question, name, ...(centerName ? { centerName } : {}), polynomial, equations, declarations, center, radius, radiusSquared, singleton: squared.n === 0n,
      values: { A, B, C, D, E, F, center_x: x, center_y: y, radius_squared: squared, radius: radiusDeclaration ?? exact(0n) }, points: classified, asks } };
  } catch { return decline("unsupported or unreadable exact source"); }
}

/** Literal coefficient identities use the polynomial slot, never scalar equality. */
export function circleCoefficientRole(text: string): CircleValueRole | null {
  const role = norm(text).toLowerCase();
  if (/^(?:the )?(?:constant term|constant coefficient)(?:\b|$)/.test(role)) return "F";
  if (!/^coefficient of\b/.test(role)) return null;
  const tail = role.replace(/^coefficient of\s+/, "");
  if (/^x\^2(?: and y\^2)?$/.test(tail)) return "A";
  if (tail === "xy" || tail === "x*y") return "B";
  if (tail === "y^2") return "C";
  if (tail === "x") return "D";
  if (tail === "y") return "E";
  return null;
}
const coefficientPowers: Record<string, readonly [number, number]> = { A: [2, 0], B: [1, 1], C: [0, 2], D: [1, 0], E: [0, 1], F: [0, 0] };
export function circleCoefficientValues(source: CircleWholeSource, role: CircleValueRole): CircleRational[] {
  const powers = coefficientPowers[role];
  return powers ? source.equations.map(e => coefficient(e.polynomial, ...powers)) : [];
}
export function circleResultRole(symbol: string): CircleValueRole | null {
  return ({ h: "center_x", k: "center_y", center_x: "center_x", centre_x: "center_x", center_y: "center_y", centre_y: "center_y", r: "radius", radius: "radius", "r^2": "radius_squared", "r²": "radius_squared", r_squared: "radius_squared", radius_squared: "radius_squared" } as Record<string, CircleValueRole>)[symbol] ?? null;
}
function coordinateRole(text: string, source: CircleWholeSource): { role: string; value: CircleRational; owner: string; evidence: QuestionSourceEvidence } | null {
  const match = /^(x|y)[ -]coordinate of (?:the )?(?:point )?([A-Z](?:_?\d)?'?)$/.exec(norm(text));
  if (match) {
    const i = source.points.findIndex(p => p.name === match[2]);
    const p = source.points[i];
    if (p) return { role: `point_${match[1]}`, value: match[1] === "x" ? p.exactX : p.exactY, owner: `circle_point_${i}`, evidence: p.evidence };
  }
  const axis = /^(x|y)[ -]coordinate of (?:the )?cent(?:er|re)$/.exec(norm(text));
  const declaration = source.declarations.find(d => /\bcent(?:er|re)\b/.test(d.quote));
  if (axis && declaration) return { role: `center_${axis[1]}`, value: source.values[axis[1] === "x" ? "center_x" : "center_y"], owner: "circle_center", evidence: declaration };
  const radius = source.declarations.find(d => /\bradius\b/.test(d.quote));
  if (norm(text) === "radius" && radius) return { role: "radius", value: source.values.radius, owner: "circle_locus", evidence: radius };
  return null;
}
export function circleRoleUnit(role: CircleValueRole, unit?: string): boolean {
  return unit === undefined || (role === "radius" ? ["length", "unit", "units", "1"] : role === "radius_squared" ? ["area", "unit^2", "units^2", "1"] : role === "center_x" || role === "center_y" ? ["coordinate", "unit", "units", "1"] : ["1", "dimensionless"]).includes(unit);
}
export interface CircleProblemBinding {
  /** Original object retained verbatim; never projected/reduced or mutated. */
  problem: ProblemIR; source: CircleWholeSource; document: SceneDocument;
  entityBindings: Array<{ problemEntityId: string; sceneEntityId: string }>;
  expressionBindings: Array<{ expressionId: string; sceneQuantityId?: string; ownerId: string; role: string; value?: number; factIds: string[] }>;
  factBindings: Array<{ factId: string; role: string }>;
  requestBindings: Array<{ requestId: string; quantityId: string; role: CircleValueRole; symbol: string; unit?: string; value: number }>;
}
const contains = (outer: QuestionSourceEvidence, inner: QuestionSourceEvidence): boolean => outer.start <= inner.start && outer.end >= inner.end;
const overlap = (outer: QuestionSourceEvidence, inner: QuestionSourceEvidence): boolean => outer.start < inner.end && outer.end > inner.start;
function formulaKey(node: ExpressionNodeIR): string {
  if (node.kind === "number") return exactText(decimalExact(String(node.value)));
  if (node.kind === "unary") return node.operator === "+" ? formulaKey(node.operand) : `neg(${formulaKey(node.operand)})`;
  if (node.kind === "call" && node.function === "sqrt") return `sqrt(${formulaKey(node.argument)})`;
  if (node.kind !== "binary") throw new Error("unsupported result AST");
  const parts = [formulaKey(node.left), formulaKey(node.right)];
  return `${node.operator}(${["+", "*"].includes(node.operator) ? parts.sort().join(",") : parts.join(",")})`;
}
function resultFormula(source: CircleWholeSource, role: CircleValueRole): ExpressionNodeIR {
  const num = (r: CircleRational): ExpressionNodeIR => ({ kind: "number", value: numeric(r) });
  const bin = (operator: "+" | "-" | "*" | "/" | "^", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
  const center = (v: "D" | "E"): ExpressionNodeIR => bin("/", { kind: "unary", operator: "-", operand: num(source.values[v]) }, bin("*", num(exact(2n)), num(source.values.A)));
  if (role === "center_x" || role === "center_y") return center(role === "center_x" ? "D" : "E");
  const squared = bin("-", bin("+", bin("^", center("D"), num(exact(2n))), bin("^", center("E"), num(exact(2n)))), bin("/", num(source.values.F), num(source.values.A)));
  return role === "radius" ? { kind: "call", function: "sqrt", argument: squared } : squared;
}
export function circleRoleValue(source: CircleWholeSource, role: CircleValueRole): number { return role === "radius" ? source.radius : numeric(source.values[role]); }

/** All facts/entities/expressions/constraints/requests/intents must bind. */
export function bindCircleSourceProblem(question: string, raw: unknown): CircleProblemBinding | null {
  try {
    const checked = validateProblemIR(raw, question), reading = readCircleSourceProgram(question);
    if (!checked.valid || !checked.problem || checked.problem.question !== question || reading.status !== "ok") return null;
    const problem = checked.problem, source = reading.source;
    const facts = new Map(problem.facts.map(f => [f.id, f]));
    const spans = (ids: string[]): QuestionSourceEvidence[] => ids.map(id => facts.get(id)!.evidence);
    const sourceDefinition = (ids: string[]): boolean => spans(ids).some(span => source.equations.some(e => contains(span, e.evidence)) || source.declarations.some(d => contains(span, d)));
    const sourceEquation = (ids: string[]): boolean => spans(ids).some(span => source.equations.some(e => contains(span, e.evidence)));
    const evidenceEquations = (ids: string[]): CircleWholeSource["equations"] => source.equations.filter(e => spans(ids).some(span => contains(span, e.evidence)));
    const binding: CircleProblemBinding = { problem, source, document: makeCircleDocument(source), entityBindings: [], expressionBindings: [], factBindings: [], requestBindings: [] };
    const requestedRole = (role: CircleValueRole, ids: string[]): boolean => ids.some(id => {
      const fact = facts.get(id)!;
      return fact.kind === "requested" && /\b(?:find|determine|calculate)\b/i.test(fact.evidence.quote) &&
        (role === "center_x" || role === "center_y" ? /\bcent(?:er|re)\b/i.test(fact.evidence.quote) : role === "radius_squared" ? /\bradius\s+squared\b/i.test(fact.evidence.quote) : /\bradius\b/i.test(fact.evidence.quote));
    });
    for (const fact of problem.facts) {
      const coefficientRole = circleCoefficientRole(fact.statement);
      if (fact.kind === "assumption") return null;
      // Unsupported semantic statements cannot borrow a valid quote as a flag.
      const coordinate = coordinateRole(fact.statement, source);
      if (norm(fact.statement) !== norm(fact.evidence.quote) && !coefficientRole && !coordinate) return null;
      if (coordinate && !contains(fact.evidence, coordinate.evidence)) return null;
      let role = coefficientRole ?? (source.equations.some(e => overlap(fact.evidence, e.evidence)) ? "equation" : source.points.some(p => contains(fact.evidence, p.evidence)) ? "point" : source.declarations.some(d => contains(fact.evidence, d)) ? "declaration" : "request");
      if (coefficientRole && !sourceEquation([fact.id])) return null;
      if (role === "request" && (fact.kind !== "requested" || !/\b(?:find|determine|calculate|draw|show|sketch|plot|mark|does|lie|inside|outside)\b/i.test(fact.evidence.quote))) return null;
      if (fact.kind === "requested") role = "request";
      binding.factBindings.push({ factId: fact.id, role });
    }
    // Every definition and residual source point has actual full-IR evidence.
    if ([...source.equations.map(e => e.evidence), ...source.declarations, ...source.points.map(p => p.evidence)].some(span => !problem.facts.some(f => contains(f.evidence, span)))) return null;
    if (source.asks.some(role => !requestedRole(role, problem.facts.map(f => f.id)))) return null;
    const used = new Set<string>();
    for (const entity of problem.entities) {
      let sceneId: string | undefined;
      if (["curve", "body"].includes(entity.kind) && sourceDefinition(entity.evidenceFactIds)) {
        if (![source.name, `circle ${source.name}`].includes(entity.label ?? "")) return null;
        sceneId = "circle_locus";
      } else if (entity.kind === "point") {
        const candidates = source.points.filter(p => spans(entity.evidenceFactIds).some(s => contains(s, p.evidence)) &&
          (entity.label === p.name || entity.label === pointCaption(p)));
        if (candidates.length === 1) sceneId = `circle_point_${source.points.indexOf(candidates[0]!)}`;
        else if (source.centerName && entity.label === source.centerName && sourceDefinition(entity.evidenceFactIds)) sceneId = "circle_center";
      }
      if (!sceneId || used.has(sceneId)) return null;
      used.add(sceneId); binding.entityBindings.push({ problemEntityId: entity.id, sceneEntityId: sceneId });
    }
    if (!used.has("circle_locus") || source.points.some((_, i) => !used.has(`circle_point_${i}`)) || source.centerName && !used.has("circle_center")) return null;
    const equations = problem.constraints.filter(c => c.kind === "equation");
    for (const expression of problem.expressions) {
      const request = problem.solveRequests.find(r => r.kind === "evaluate" && r.expressionId === expression.id);
      if (request) {
        if (!request.resultBinding || request.kind !== "evaluate") return null;
        const target = request.resultBinding, role = circleResultRole(target.symbol);
        if (!role || !source.asks.includes(role) || !circleRoleUnit(role, target.unit) || !sourceDefinition(expression.evidenceFactIds) || !requestedRole(role, target.evidenceFactIds)) return null;
        const equationsForExpression = evidenceEquations(expression.evidenceFactIds);
        const formulaSource = { ...source, values: { ...source.values } };
        if (equationsForExpression.length === 1) for (const [r, powers] of Object.entries(coefficientPowers)) formulaSource.values[r as CircleValueRole] = coefficient(equationsForExpression[0]!.polynomial, ...powers);
        if (formulaKey(expression.root) !== formulaKey(resultFormula(formulaSource, role))) return null;
        binding.requestBindings.push({ requestId: request.id, quantityId: target.turnPlanQuantityId, role, symbol: target.symbol, unit: target.unit, value: circleRoleValue(source, role) });
        binding.expressionBindings.push({ expressionId: expression.id, ownerId: "circle_locus", role, factIds: [...expression.evidenceFactIds] });
        continue;
      }
      const polynomial = polynomialOfIR(expression.root);
      const equationParts = equations.filter(c => c.kind === "equation" && [c.leftExpressionId, c.rightExpressionId].includes(expression.id));
      if (equationParts.length) {
        if (!sourceDefinition(expression.evidenceFactIds)) return null;
        if (expression.valueType === "scalar") {
          if ([...polynomial.keys()].some(k => k !== "0,0") || !source.equations.some(e => equivalentPolynomial(polynomial, e.left) || equivalentPolynomial(polynomial, e.right))) return null;
          const value = numeric(coefficient(polynomial, 0, 0)), id = `circle_equation_${expression.id}`;
          binding.document.quantities.push({ id, value, unit: "1", sourceRole: "equation_side", ownerId: "circle_locus", expressionId: expression.id, evidenceFactIds: [...expression.evidenceFactIds] });
          binding.expressionBindings.push({ expressionId: expression.id, sceneQuantityId: id, ownerId: "circle_locus", role: "equation_side", value, factIds: [...expression.evidenceFactIds] });
        } else binding.expressionBindings.push({ expressionId: expression.id, ownerId: "circle_locus", role: "equation", factIds: [...expression.evidenceFactIds] });
        continue;
      }
      if (expression.valueType === "function") {
        if (!sourceDefinition(expression.evidenceFactIds) || !equivalentPolynomial(polynomial, source.polynomial, true)) return null;
        binding.expressionBindings.push({ expressionId: expression.id, ownerId: "circle_locus", role: "equation", factIds: [...expression.evidenceFactIds] });
        continue;
      }
      const roles = new Set(expression.evidenceFactIds.map(id => circleCoefficientRole(facts.get(id)!.statement)).filter(r => r !== null));
      const coordinates = expression.evidenceFactIds.map(id => coordinateRole(facts.get(id)!.statement, source)).filter(r => r !== null);
      if (coordinates.length) {
        const coordinate = coordinates[0]!;
        if (roles.size || coordinates.some(r => r.role !== coordinate.role || r.owner !== coordinate.owner) || [...polynomial.keys()].some(k => k !== "0,0") || !sameExact(coefficient(polynomial, 0, 0), coordinate.value)) return null;
        const id = `circle_coordinate_${expression.id}`, value = numeric(coordinate.value);
        binding.document.quantities.push({ id, value, unit: "coordinate", sourceRole: coordinate.role, ownerId: coordinate.owner, expressionId: expression.id, evidenceFactIds: [...expression.evidenceFactIds] });
        binding.expressionBindings.push({ expressionId: expression.id, sceneQuantityId: id, ownerId: coordinate.owner, role: coordinate.role, value, factIds: [...expression.evidenceFactIds] });
        continue;
      }
      if (roles.size !== 1 || !sourceEquation(expression.evidenceFactIds) || polynomial.size > 1 || [...polynomial.keys()].some(k => k !== "0,0")) return null;
      const role = [...roles][0]!;
      const value = coefficient(polynomial, 0, 0);
      const powers = coefficientPowers[role]!;
      const sourceValues = evidenceEquations(expression.evidenceFactIds).map(e => coefficient(e.polynomial, ...powers));
      if (!sourceValues.length || sourceValues.some(v => !sameExact(v, value))) return null;
      const id = `circle_coefficient_${expression.id}`;
      binding.document.quantities.push({ id, symbol: role, value: numeric(value), unit: "1", sourceRole: role, ownerId: "circle_locus", expressionId: expression.id, evidenceFactIds: [...expression.evidenceFactIds], exact: exactText(value) });
      binding.expressionBindings.push({ expressionId: expression.id, sceneQuantityId: id, ownerId: "circle_locus", role, value: numeric(value), factIds: [...expression.evidenceFactIds] });
    }
    if (binding.requestBindings.length !== problem.solveRequests.length || new Set(binding.requestBindings.map(r => r.quantityId)).size !== binding.requestBindings.length) return null;
    const sceneOf = (id: string): string | undefined => binding.entityBindings.find(row => row.problemEntityId === id)?.sceneEntityId;
    for (const constraint of problem.constraints) {
      if (constraint.kind === "equation") {
        const left = problem.expressions.find(e => e.id === constraint.leftExpressionId)!, right = problem.expressions.find(e => e.id === constraint.rightExpressionId)!;
        if (!sourceDefinition(constraint.evidenceFactIds) || !equivalentPolynomial(addPolynomial(polynomialOfIR(left.root), polynomialOfIR(right.root), -1), source.polynomial, true)) return null;
      } else {
        if (constraint.kind !== "incident" && constraint.kind !== "inside") return null;
        const ids = constraint.entityIds.map(sceneOf);
        if (ids.length !== 2 || !ids.includes("circle_locus")) return null;
        const pointId = ids.find(id => id !== "circle_locus");
        const index = source.points.findIndex((_, i) => pointId === `circle_point_${i}`);
        if (index < 0 || source.points[index]!.position !== (constraint.kind === "incident" ? "on" : "inside") || !spans(constraint.evidenceFactIds).some(span => contains(span, source.points[index]!.evidence))) return null;
      }
    }
    if (problem.representationIntents.some(intent => intent.kind !== "graph" || !intent.entityIds.length || intent.entityIds.some(id => !sceneOf(id)))) return null;
    // Canonicalize trusted regeneration only; never repair a submitted candidate.
    const canonical = validateSceneDocument(pruneDeadSceneEntities(structuredClone(binding.document) as unknown as Record<string, unknown>)).document;
    if (!canonical) return null;
    binding.document = canonical;
    return binding;
  } catch { return null; }
}

const pointCaption = (p: Pick<CircleSourcePoint, "name" | "x" | "y">): string => `${p.name ?? ""}(${p.x},${p.y})`;
function makeCircleDocument(source: CircleWholeSource): SceneDocument {
  const document: SceneDocument = { schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "whole source Cartesian circle and every stated point" }, source: { question: source.question }, quantities: [], entities: [], constructions: [], assertions: [], relations: [], annotations: [], requiredEntityIds: [], revealGroups: [], teachingTimeline: [] };
  const point = (id: string, x: number, y: number, name: string, caption: string, role: string): void => {
    // Identity lives on actual geometry. Longer coordinates have a caption;
    // short coordinates use the normal point label (same identity in both).
    document.entities.push({ id, kind: "point", role, label: caption.length <= 16 ? caption : name, semantic: { sourceName: name, x, y } });
    document.constructions.push({ id: `make_${id}`, operator: "point", inputs: { x, y }, outputs: [id] });
    if (caption.length > 16) {
      // Attached long callouts compact to the name alone; multiple attached
      // labels may be omitted by placement. The actual scene caption preserves
      // the whole coordinate pair, under the same physical point's source name.
      document.annotations.push({ id: `coordinates_${id}`, kind: "callout", targetIds: [], text: caption });
    }
  };
  source.points.forEach((p, i) => point(`circle_point_${i}`, p.x, p.y, p.name ?? "", pointCaption(p), "named point"));
  const centerPointIndex = source.points.findIndex(p => p.x === source.center.x && p.y === source.center.y);
  const centerId = centerPointIndex >= 0 ? `circle_point_${centerPointIndex}` : "circle_center";
  const centerLabel = source.centerName ?? (source.points.some(p => p.name === "C") || source.name === "C" ? "" : "C");
  const centerCaption = `${centerLabel}(${source.center.x},${source.center.y})`;
  if (!source.singleton && centerPointIndex < 0) point("circle_center", source.center.x, source.center.y, centerLabel, centerCaption, "circle centre");
  document.entities.push({ id: "circle_locus", kind: source.singleton ? "point" : "circle", role: "source circle locus", label: source.name });
  document.constructions.push({ id: "make_circle_locus", operator: source.singleton ? "point" : "circle", inputs: source.singleton ? { x: source.center.x, y: source.center.y } : { center: centerId, radius: source.radius }, outputs: ["circle_locus"] });
  // An annotation on a body suppresses its automatic entity label. Carry the
  // source name explicitly alongside the dimension, on the same real geometry.
  document.annotations.push({ id: "circle_source_name", kind: "label", targetIds: ["circle_locus"], text: source.name });
  if (source.singleton) {
    document.annotations.push({ id: "singleton_coordinates", kind: "callout", targetIds: [], text: `${source.name}:(${source.center.x},${source.center.y})` });
  }
  document.annotations.push({ id: "circle_radius_squared", kind: "label", targetIds: ["circle_locus"], text: `r²=${source.radiusSquared}` });
  source.points.forEach((p, i) => {
    const id = `circle_point_${i}`;
    if (!source.singleton && (p.position === "on" || p.position === "inside")) document.assertions.push({ id: `${id}_position`, predicate: p.position === "on" ? "on" : "inside", entities: [id, "circle_locus"], expected: true, severity: "fatal" });
  });
  document.requiredEntityIds = document.entities.map(e => e.id);
  document.assertions.push(...document.entities.map(e => ({ id: `exists_${e.id}`, predicate: "exists", entities: [e.id], expected: true, severity: "fatal" as const })));
  document.revealGroups = [{ id: "circle_source", entityIds: [...document.requiredEntityIds], dependsOn: [], narrationCue: "Show the complete source locus and points" }];
  return document;
}

export function circleSourceDocument(question: string, problem?: unknown): SceneDocument | null {
  if (problem!=null) return bindCircleSourceProblem(question,problem)?.document ?? null;
  const reading=readCircleSourceProgram(question);
  if (reading.status!=="ok") return null;
  return validateSceneDocument(pruneDeadSceneEntities(makeCircleDocument(reading.source) as unknown as Record<string,unknown>)).document;
}
function canonical(value: unknown): unknown {
  return Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
}
export function checkCircleSourceProblemBinding(question: string, problem: unknown, candidate: SceneDocument): SceneIssue[] {
  const binding = bindCircleSourceProblem(question, problem);
  const audit = (d: SceneDocument): unknown => ({ schemaVersion: d.schemaVersion, mode: d.visualDecision.mode, entities: d.entities.map(({ provenance: _ignored, ...e }) => e), quantities: d.quantities, constructions: d.constructions, assertions: d.assertions, relations: d.relations, annotations: d.annotations, requiredEntityIds: d.requiredEntityIds, revealGroups: d.revealGroups, teachingTimeline: d.teachingTimeline });
  const expected=problem==null?circleSourceDocument(question):binding?.document;
  if (expected && JSON.stringify(canonical(audit(expected))) === JSON.stringify(canonical(audit(candidate)))) return [];
  return [{ code: "circle_source_problem_binding", severity: "fatal", path: "circleSourceProgram", message: binding ? "Candidate differs from whole-source/full-IR regeneration" : "Whole source/full ProblemIR is unsupported or inconsistent" }];
}
/** Narrow obligation joins. Null means this expression/entity is outside this program. */
export function circleSourceProblemEntitySceneId(document: SceneDocument, problem: ProblemIR, id: string): string | null {
  const binding = bindCircleSourceProblem(problem.question, problem);
  if (!binding || checkCircleSourceProblemBinding(problem.question, problem, document).length) return null;
  return binding.entityBindings.find(row => row.problemEntityId === id)?.sceneEntityId ?? null;
}
export function circleSourceDimensionIsCarried(document: SceneDocument, problem: ProblemIR, expressionId: string, value: number, factIds: readonly string[]): boolean | null {
  const binding = bindCircleSourceProblem(problem.question, problem);
  const row = binding?.expressionBindings.find(e => e.expressionId === expressionId && e.sceneQuantityId);
  if (!row) return null;
  return !checkCircleSourceProblemBinding(problem.question, problem, document).length && row.value === value && row.factIds.length === factIds.length && row.factIds.every(id => factIds.includes(id));
}
