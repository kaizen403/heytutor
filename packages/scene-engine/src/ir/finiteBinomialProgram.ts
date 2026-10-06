import { expandFinitePolynomial, exactPolynomialNumber, exactPolynomialText, finitePolynomialASTKey, finitePolynomialCoefficient, parseFinitePolynomialExpression, type ExactPolynomialRational, type FinitePolynomialExpansion } from "../math/finitePolynomialExpansion";
import { validateProblemIR, type ExpressionNodeIR, type ProblemIR, type SolveResultBinding } from "./problemIR";
import { SOLVER_RESULT_VERSION, validateSolverResult, type SolverResult } from "./solver";
import { SCENE_DOCUMENT_VERSION, type SceneDocument, type SceneIssue } from "../types";

export type FiniteBinomialRequest = { kind: "expansion" } | { kind: "coefficient"; exponent: number };
export interface FiniteBinomialSource {
  question: string;
  expressionSource: string;
  requestSource: string;
  normalizedExpression: string;
  normalizations: string[];
  root: ExpressionNodeIR;
  astKey: string;
  expansion: FinitePolynomialExpansion;
  request: FiniteBinomialRequest;
}
export type FiniteBinomialReading = { status: "ok"; source: FiniteBinomialSource } | { status: "declined"; reason: string };
export interface FiniteBinomialOutput {
  requestId: string;
  expressionId: string;
  binding: SolveResultBinding;
  exact: ExactPolynomialRational;
  value: number;
}
export type FiniteBinomialAdmission = { status: "ok"; source: FiniteBinomialSource; problem: ProblemIR; polynomialEntityId: string; outputs: FiniteBinomialOutput[] } | { status: "declined"; reason: string };
export const FINITE_BINOMIAL_TABLE_LIMIT = 15;

function normalizeMath(source: string, layoutOCR: boolean): string {
  if (!layoutOCR) return source;
  // pdftotext emits duplicated italic x glyphs and baseline exponent runs.
  // This dialect is enabled by the glyph pair, never an ID/answer/transcription.
  return source.replaceAll("𝑥𝑥", "x").replace(/x\s+(\d+)/g, "x^$1").replace(/\)\s*(\d+)/g, ")^$1");
}
/** Bounded request grammar plus complete arithmetic parsing, not topic routing. */
export function readFiniteBinomialProgram(question: string): FiniteBinomialReading {
  try {
    if (typeof question !== "string" || question.length > 4096) throw new Error("source question exceeds bounded grammar");
    const body = question.trim().replace(/^\d+\.\s+/, "");
    const layoutOCR = body.includes("𝑥𝑥");
    let expressionSource: string, requestSource: string, request: FiniteBinomialRequest;
    const expansion = /^Expand\s+([\s\S]+?)\.?$/id.exec(body);
    if (expansion) {
      expressionSource = expansion[1]!.trim(); requestSource = body.slice(0, expansion.indices![1]![0]).trim(); request = { kind: "expansion" };
    } else {
      const coefficient = /^(?:Find\s+the\s+)?Coefficient\s+of\s+(.+?)\s+in\s+(?:the\s+)?expansion\s+of\s+([\s\S]+)$/id.exec(body);
      if (!coefficient) throw new Error("unsupported finite polynomial request grammar");
      const tail = coefficient[2]!;
      const ended = /^([\s\S]+?)\s+is(?:\s*\.?\s*)?([\s\S]*)$/i.exec(tail);
      expressionSource = (ended ? ended[1]! : tail.replace(/\.$/, "")).trim();
      if (ended?.[2]?.trim()) {
        // Consume all options and optional answer marker; none are an oracle.
        const options = ended[2].trim();
        if (!/^(?:\([A-D]\)\s+[+-]?\d+(?:\.\d+)?\s*){4}(?:Answer\s+\([A-D]\))?$/i.test(options)
          || [...options.matchAll(/\(([A-D])\)\s+[+-]?\d/gi)].map(m => m[1]!.toUpperCase()).join("") !== "ABCD") throw new Error("unconsumed source options or obligations");
      }
      // The requested monomial may also be the entire polynomial payload.
      requestSource = body.slice(0, coefficient.indices![2]![0]).trim();
      const target = expandFinitePolynomial(parseFinitePolynomialExpression(normalizeMath(coefficient[1]!, layoutOCR)));
      const nonzero = target.terms.filter(term => term.coefficient.numerator !== "0");
      if (nonzero.length !== 1 || exactPolynomialText(nonzero[0]!.coefficient) !== "1") throw new Error("coefficient request needs one unit monomial");
      request = { kind: "coefficient", exponent: nonzero[0]!.exponent };
    }
    const normalizedExpression = normalizeMath(expressionSource, layoutOCR), root = parseFinitePolynomialExpression(normalizedExpression);
    const expanded = expandFinitePolynomial(root);
    if ((request.kind === "coefficient" ? request.exponent : expanded.degree) > FINITE_BINOMIAL_TABLE_LIMIT) throw new Error("required table exceeds 16 exponent rows");
    // Prove display capacity for every shown row before emitting any candidate.
    for (const term of displayedFiniteBinomialTerms(expanded, request)) {
      exactPolynomialNumber(term.coefficient);
      if (exactPolynomialText(term.coefficient).length > 32) throw new Error("exact coefficient label exceeds table capacity");
    }
    if (normalizedExpression.length > 100) throw new Error("source expression exceeds table header capacity");
    return { status: "ok", source: { question, expressionSource, requestSource, normalizedExpression, normalizations: layoutOCR ? ["duplicated italic x glyph pair collapsed", "baseline digit runs after x or closed groups interpreted as exponents"] : [], root, astKey: finitePolynomialASTKey(root), expansion: expanded, request } };
  } catch (error) { return { status: "declined", reason: error instanceof Error ? error.message : "malformed finite polynomial source" }; }
}
export function displayedFiniteBinomialTerms(expansion: FinitePolynomialExpansion, request: FiniteBinomialRequest): FinitePolynomialExpansion["terms"] {
  const last = request.kind === "coefficient" ? request.exponent : expansion.degree;
  if (!Number.isInteger(last) || last < 0 || last > FINITE_BINOMIAL_TABLE_LIMIT) throw new Error("finite table exponent out of bounds");
  return Array.from({ length: last + 1 }, (_, exponent) => ({ exponent, coefficient: finitePolynomialCoefficient(expansion, exponent) }));
}
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
function stable(value: unknown): string {
  let nodes = 0;
  const visit = (item: unknown, depth: number): string => {
    if (++nodes > 10000 || depth > 64) throw new Error("source document exceeds comparison capacity");
    if (Array.isArray(item)) return `[${item.map(child => visit(child, depth + 1)).join(",")}]`;
    if (item && typeof item === "object") return "{" + Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${visit(child, depth + 1)}`).join(",") + "}";
    if (item === undefined || ["function", "symbol", "bigint"].includes(typeof item) || typeof item === "number" && !Number.isFinite(item)) throw new Error("source proof requires complete finite JSON data");
    return JSON.stringify(item);
  };
  return visit(value, 0);
}
function variableIn(root: ExpressionNodeIR): boolean {
  switch (root.kind) {
    case "variable": return true;
    case "unary": return variableIn(root.operand);
    case "binary": return variableIn(root.left) || variableIn(root.right);
    case "call": return variableIn(root.argument);
    default: return false;
  }
}

/** Retains and audits the entire actual graph. Unknown roles never disappear. */
export function admitFiniteBinomialProblem(question: string, raw: unknown): FiniteBinomialAdmission {
  try {
    const reading = readFiniteBinomialProgram(question);
    if (reading.status !== "ok") return reading;
    const checked = validateProblemIR(raw, question);
    if (!checked.valid || !checked.problem || checked.problem.question !== question) throw new Error("invalid or nonidentical full ProblemIR source");
    const problem = checked.problem, source = reading.source;
    stable(problem); // No cycles, dropped fields or non-JSON authority across restore.
    if (Object.keys(problem).sort().join(",") !== "constraints,entities,expressions,facts,id,question,representationIntents,schemaVersion,solveRequests") throw new Error("unknown full-IR top-level obligations");
    const given = new Set<string>(), requested = new Set<string>();
    for (const fact of problem.facts) {
      // Advisory source offsets in base IR are strengthened here to exact spans.
      if (question.slice(fact.evidence.start, fact.evidence.end) !== fact.evidence.quote) throw new Error("fact span is not exact raw source");
      const quote = fact.evidence.quote.trim();
      if (fact.kind === "given") {
        const root = parseFinitePolynomialExpression(normalizeMath(quote, source.normalizations.length > 0));
        if (finitePolynomialASTKey(root) !== source.astKey) throw new Error("given fact does not bind the complete source AST");
        given.add(fact.id);
      } else if (fact.kind === "requested" && quote === source.requestSource) requested.add(fact.id);
      else throw new Error("unbound fact or unsupported assumption");
    }
    const refs = (ids: string[], roles: Set<string>) => ids.length > 0 && ids.every(id => roles.has(id));
    if (!given.size || !requested.size) throw new Error("missing given/requested source roles");
    if (problem.entities.length !== 1) throw new Error("unbound additional or missing polynomial entities");
    const entity = problem.entities[0]!;
    if (entity.kind !== "other" || !refs(entity.evidenceFactIds, given) || entity.label !== undefined && entity.label !== "P(x)") throw new Error("unsupported polynomial entity role/label");
    if (problem.constraints.length) throw new Error("equations, inequalities and spatial constraint obligations are an explicit gap");
    if (!problem.representationIntents.length || problem.representationIntents.some(intent => intent.kind !== "conceptual" || !same(intent.entityIds, [entity.id]) || !refs(intent.evidenceFactIds, new Set([...given, ...requested])))) throw new Error("unbound representation intent");
    const outputs: FiniteBinomialOutput[] = [], consumedExpressions = new Set<string>(), consumedFacts = new Set<string>(entity.evidenceFactIds);
    for (const expression of problem.expressions) {
      if (!refs(expression.evidenceFactIds, given)) continue;
      if (expression.valueType !== "function" || finitePolynomialASTKey(expression.root) !== source.astKey) throw new Error("full source expression AST disagrees");
      consumedExpressions.add(expression.id); expression.evidenceFactIds.forEach(id => consumedFacts.add(id));
    }
    if (consumedExpressions.size !== 1) throw new Error("requires exactly one full polynomial expression role");
    if (source.request.kind === "expansion" && problem.solveRequests.length) throw new Error("unbound numeric ask in full expansion request");
    if (source.request.kind === "coefficient") {
      if (problem.solveRequests.length !== 1) throw new Error("coefficient requires one actual bound solve request");
      const request = problem.solveRequests[0]!;
      if (request.kind !== "evaluate" || !request.resultBinding) throw new Error("unsupported or missing requested result binding");
      const binding = request.resultBinding, expression = problem.expressions.find(e => e.id === request.expressionId);
      if (binding.unit !== "1" || !/^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(binding.symbol) || !refs(binding.evidenceFactIds, requested) || !expression || expression.valueType !== "scalar" || !refs(expression.evidenceFactIds, requested) || variableIn(expression.root)) throw new Error("missing scalar coefficient role, safe symbolic binding or dimensionless unit");
      const exact = finitePolynomialCoefficient(source.expansion, source.request.exponent);
      if (!same(expandFinitePolynomial(expression.root).terms[0]!.coefficient, exact)) throw new Error("requested expression conflicts with independently computed source coefficient");
      outputs.push({ requestId: request.id, expressionId: expression.id, binding, exact, value: exactPolynomialNumber(exact) });
      consumedExpressions.add(expression.id); [...binding.evidenceFactIds, ...expression.evidenceFactIds].forEach(id => consumedFacts.add(id));
    } else requested.forEach(id => consumedFacts.add(id));
    if (consumedExpressions.size !== problem.expressions.length || consumedFacts.size !== problem.facts.length) throw new Error("unconsumed full-IR expression/fact obligations");
    return { status: "ok", source, problem, polynomialEntityId: entity.id, outputs };
  } catch (error) { return { status: "declined", reason: error instanceof Error ? error.message : "unbound finite polynomial IR" }; }
}

/** Original SolverResult API, with source-derived exact values and actual IDs. */
export function solveFiniteBinomialProblem(question: string, raw: unknown): SolverResult | null {
  const admission = admitFiniteBinomialProblem(question, raw);
  if (admission.status !== "ok") return null;
  const result: SolverResult = {
    schemaVersion: SOLVER_RESULT_VERSION, problemId: admission.problem.id, providerId: "finite-polynomial-source/v1", status: "solved", issues: [],
    values: admission.outputs.map(output => ({ id: `${output.requestId}_value`, requestId: output.requestId, valueType: "scalar", exact: { kind: output.exact.denominator === "1" ? "integer" : "rational", value: exactPolynomialText(output.exact) }, approximate: output.value, errorBound: output.exact.denominator === "1" ? 0 : Math.abs(output.value) * Number.EPSILON })),
    proofs: admission.outputs.map(output => ({ id: `${output.requestId}_proof`, requestId: output.requestId, method: "exact_arithmetic", expressionIds: [output.expressionId, ...admission.problem.expressions.filter(e => e.valueType === "function").map(e => e.id)], verified: true, residual: 0, tolerance: 0, detail: "Complete raw source AST joined to full IR; exact finite rational convolution independently recomputed the requested coefficient." })),
  };
  return validateSolverResult(result, admission.problem).valid ? result : null;
}

/** Parent must call at compile/live/save/read/restore with caller-owned source. */
export function validateFiniteBinomialQuantities(question: string, raw: unknown, quantities: readonly unknown[]): SceneIssue[] {
  const admission = admitFiniteBinomialProblem(question, raw);
  const fail = (message: string): SceneIssue[] => [{ code: "finite_binomial_source_authority", severity: "fatal", message }];
  if (admission.status !== "ok") return fail(admission.reason);
  if (!Array.isArray(quantities) || quantities.length !== admission.outputs.length) return fail("quantity set must cover every and only bound requested coefficient");
  try { for (const output of admission.outputs) {
    const matches = quantities.filter(q => q && typeof q === "object" && "id" in q && q.id === output.binding.turnPlanQuantityId);
    if (matches.length !== 1) return fail("missing or duplicate actual quantityID");
    const q = matches[0] as Record<string, unknown>;
    if (q.symbol !== output.binding.symbol || q.unit !== "1" || q.value !== output.value || q.provenance !== "derived" || !same(q.exact, output.exact) || !same(q.evidenceFactIds, output.binding.evidenceFactIds) || q.sourceText !== question) return fail("coefficient quantity disagrees with recomputed source authority");
  } } catch { return fail("malformed non-JSON coefficient quantity"); }
  return [];
}

export function finiteBinomialSourceDocument(question: string, raw: unknown): SceneDocument | null {
  const admission = admitFiniteBinomialProblem(question, raw);
  if (admission.status !== "ok") return null;
  const { source, problem, outputs, polynomialEntityId } = admission;
  const rows = displayedFiniteBinomialTerms(source.expansion, source.request);
  const rowIds = rows.map(row => `${polynomialEntityId}_power_${row.exponent}`);
  const ids = [polynomialEntityId, ...rowIds];
  if (new Set(ids).size !== ids.length) return null;
  const document: SceneDocument = {
    schemaVersion: SCENE_DOCUMENT_VERSION,
    source: { question, problemIR: structuredClone(problem) },
    visualDecision: { mode: "scene", reason: "Exact finite polynomial coefficients in a nonmetric table; spacing is not algebraic magnitude." },
    quantities: outputs.map(output => ({ id: output.binding.turnPlanQuantityId, symbol: output.binding.symbol, unit: "1", value: output.value, exact: output.exact, provenance: "derived", evidenceFactIds: [...output.binding.evidenceFactIds], sourceText: question })),
    entities: ids.map((id, i) => ({ id, kind: i === 0 ? "finite_polynomial_source" : "finite_polynomial_term", role: i === 0 ? "complete source expression and scope" : "exact exponent/coefficient pair" })),
    constructions: [{ id: `${polynomialEntityId}_expand`, operator: "finite_polynomial_expansion", inputs: { question, problemIR: structuredClone(problem) }, outputs: ids }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [
      { id: "polynomial_source", entityIds: [polynomialEntityId], dependsOn: [], narrationCue: "Read the complete finite source polynomial." },
      { id: "polynomial_coefficients", entityIds: rowIds, dependsOn: ["polynomial_source"], narrationCue: source.request.kind === "coefficient" ? "Convolve exact coefficients through the requested exponent; higher powers cannot contribute." : "Read every exact coefficient and exponent." },
    ],
    teachingTimeline: [
      { id: "show_polynomial_source", action: "reveal", targetId: "polynomial_source", dependsOn: [], narrationIntent: "Show the source expression and nonmetric table scope." },
      { id: "show_polynomial_coefficients", action: "reveal", targetId: "polynomial_coefficients", dependsOn: ["show_polynomial_source"], narrationIntent: "Reveal the exact finite coefficients." },
    ],
  };
  return document;
}

/** Rebuild and compare the complete candidate, including all labels/reveal/outputs. */
export function validateFiniteBinomialSourceDocument(document: SceneDocument, question: string, raw: unknown): SceneIssue[] {
  try {
    const expected = finiteBinomialSourceDocument(question, raw);
    if (!expected || !same(document, expected)) throw new Error("Candidate is not the complete independently regenerated source document.");
    return validateFiniteBinomialQuantities(question, raw, document.quantities);
  } catch (error) {
    return [{ code: "finite_binomial_document_source", severity: "fatal", message: error instanceof Error ? error.message : "Malformed source document." }];
  }
}
