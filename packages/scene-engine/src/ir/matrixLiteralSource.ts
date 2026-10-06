/** Source-derived authority for literal matrix display/order/cell requests. */
import { buildMatrixSourceDocument, readMatrixLiteralSourceProgram, recoverMatrixLiteralPlanEvidence, validateMatrixSourceBinding } from "../compile/matrixSourceBinding";
import { evaluateMatrixArrayConstruction, matrixEntryDouble } from "../compile/matrixArrayGeometry";
import { snapshotMathSourceData } from "../compile/mathSourceData";
import type { TurnPlanV3 } from "../contracts/contractsV3";
import { validateProblemIR, type ExpressionNodeIR, type ProblemIR, type ProblemEntity } from "./problemIR";
import type { SceneDocument } from "../types";

type Program = NonNullable<ReturnType<typeof readMatrixLiteralSourceProgram>>;
type Matrix = Program["matrices"][number];
type Role = { name: string; kind: "matrix" | "row" | "column" | "cell"; row?: number; column?: number };

function entityRole(entity: ProblemEntity, matrix: Matrix): Role | null {
  if (entity.kind !== "other") return null;
  const label = entity.label;
  if (label === matrix.name) return { name: matrix.name, kind: "matrix" };
  const row = /^row ([1-6])$/.exec(label ?? "");
  const column = /^column ([1-6])$/.exec(label ?? "");
  if (row && Number(row[1]) <= matrix.entries.length) return { name: matrix.name, kind: "row", row: Number(row[1]) };
  if (column && Number(column[1]) <= matrix.entries[0]!.length) return { name: matrix.name, kind: "column", column: Number(column[1]) };
  const cell = new RegExp(`^${matrix.name.toLowerCase()}([1-6])([1-6])$`).exec(label ?? "");
  return cell && matrix.entries[Number(cell[1]) - 1]?.[Number(cell[2]) - 1] !== undefined
    ? { name: matrix.name, kind: "cell", row: Number(cell[1]), column: Number(cell[2]) } : null;
}

function expressionRole(id: string, matrix: Matrix): Role | null {
  if (id === "eOrderRows" || id === `rows${matrix.name}`) return { name: matrix.name, kind: "row" };
  if (id === "eOrderCols" || id === `cols${matrix.name}`) return { name: matrix.name, kind: "column" };
  const cell = /^(?:e|cell_)([1-6])([1-6])$/.exec(id);
  return cell && matrix.entries[Number(cell[1]) - 1]?.[Number(cell[2]) - 1] !== undefined
    ? { name: matrix.name, kind: "cell", row: Number(cell[1]), column: Number(cell[2]) } : null;
}

function roleValue(role: Role, matrix: Matrix): string | null {
  return role.kind === "cell" ? matrix.entries[role.row! - 1]![role.column! - 1]!
    : role.kind === "row" && role.row === undefined ? String(matrix.entries.length)
      : role.kind === "column" && role.column === undefined ? String(matrix.entries[0]!.length) : null;
}

function literal(root: ExpressionNodeIR): string | null {
  if (root.kind === "number") return String(root.value);
  if (root.kind === "unary" && root.operand.kind === "number") return String(root.operator === "-" ? -root.operand.value : root.operand.value);
  if (root.kind === "binary" && root.operator === "/" && root.left.kind === "number" && root.right.kind === "number"
    && Number.isInteger(root.left.value) && Number.isInteger(root.right.value)) return `${root.left.value}/${root.right.value}`;
  return null;
}

function exact(value: string): string {
  return JSON.stringify(evaluateMatrixArrayConstruction("matrix_array", { entries: [[value]], origin: [0, 0], displayScale: 1 }, {
    scalar() { throw new Error("Unbound scalar"); }, geometry() { return undefined; },
  })[0]!.matrixArray.exactEntries[0]![0]);
}

function ownsLiteral(problem: ProblemIR, factIds: readonly string[], matrix: Matrix): boolean {
  return factIds.some((id) => problem.facts.some((fact) => fact.id === id && fact.kind === "given" && fact.evidence.quote.includes(matrix.quote)));
}

/** Preserve a captured full IR only when every entity/expression/request has a source role. */
function bindProblem(problem: ProblemIR, matrix: Matrix, program: Program): boolean {
  if (problem.constraints.length) return false; // No exemption for unsupported equations/topology.
  const roles = problem.entities.map((entity) => entityRole(entity, matrix));
  if (roles.some((role) => !role) || new Set(roles.map((role) => JSON.stringify(role))).size !== roles.length
    || !problem.entities.every((entity) => ownsLiteral(problem, entity.evidenceFactIds, matrix))) return false;
  if (problem.representationIntents.some((intent) => !["graph", "conceptual"].includes(intent.kind))) return false;
  for (const expression of problem.expressions) {
    const role = expressionRole(expression.id, matrix);
    const expected = role && roleValue(role, matrix);
    const value = literal(expression.root);
    if (expression.valueType !== "scalar" || !expected || value === null || exact(value) !== exact(expected)
      || !ownsLiteral(problem, expression.evidenceFactIds, matrix)) return false;
  }
  for (const request of problem.solveRequests) {
    if (request.kind !== "evaluate") return false;
    const role = expressionRole(request.expressionId, matrix);
    if (!role) return false;
    const binding = request.resultBinding;
    if (role.kind === "cell") {
      const symbol = `${matrix.name.toLowerCase()}${role.row}${role.column}`;
      if (!program.requestedCells.some((cell) => cell.row === role.row && cell.column === role.column && cell.name === role.name)
        || binding && (binding.symbol !== symbol || binding.unit !== undefined && binding.unit !== "")) return false;
    } else if (!/\border\b/i.test(problem.question)
      || binding && binding.symbol !== "order" && binding.symbol !== `rows${matrix.name}` && binding.symbol !== `cols${matrix.name}`) return false;
  }
  for (const cell of program.requestedCells) {
    if (problem.solveRequests.filter((request) => request.kind === "evaluate"
      && JSON.stringify(expressionRole(request.expressionId, matrix)) === JSON.stringify({ name: cell.name, kind: "cell", row: cell.row, column: cell.column })).length !== 1) return false;
  }
  return true;
}

function sourceProblem(question: string, matrix: Matrix, program: Program): ProblemIR {
  const start = question.indexOf(matrix.quote);
  const problem: ProblemIR = {
    schemaVersion: "problem-ir/v1", id: "matrix_literal_source", question,
    facts: [
      { id: "matrix_given", kind: "given", statement: matrix.quote, evidence: { source: "question", start, end: start + matrix.quote.length, quote: matrix.quote } },
      { id: "source_requests", kind: "requested", statement: question, evidence: { source: "question", start: 0, end: question.length, quote: question } },
    ],
    entities: [{ id: "matrix", kind: "other", label: matrix.name, evidenceFactIds: ["matrix_given"] }],
    expressions: [], constraints: [], representationIntents: [], solveRequests: [],
  };
  for (let i = 1; i <= matrix.entries.length; i++) problem.entities.push({ id: `row${i}`, kind: "other", label: `row ${i}`, evidenceFactIds: ["matrix_given"] });
  for (let j = 1; j <= matrix.entries[0]!.length; j++) problem.entities.push({ id: `col${j}`, kind: "other", label: `column ${j}`, evidenceFactIds: ["matrix_given"] });
  for (let i = 1; i <= matrix.entries.length; i++) for (let j = 1; j <= matrix.entries[0]!.length; j++) {
    const cell = matrix.geometry.matrixArray.exactEntries[i - 1]![j - 1]!;
    problem.entities.push({ id: `entry${i}${j}`, kind: "other", label: `${matrix.name.toLowerCase()}${i}${j}`, evidenceFactIds: ["matrix_given"] });
    problem.expressions.push({ id: `e${i}${j}`, valueType: "scalar", root: cell.denominator === "1" ? { kind: "number", value: Number(cell.numerator) }
      : { kind: "binary", operator: "/", left: { kind: "number", value: Number(cell.numerator) }, right: { kind: "number", value: Number(cell.denominator) } }, evidenceFactIds: ["matrix_given"] });
  }
  problem.expressions.push(...[["eOrderRows", matrix.entries.length], ["eOrderCols", matrix.entries[0]!.length]].map(([id, value]) => ({
    id: String(id), valueType: "scalar" as const, root: { kind: "number" as const, value: Number(value) }, evidenceFactIds: ["matrix_given"],
  })));
  problem.representationIntents.push({ id: "literal_grid", kind: "graph", entityIds: problem.entities.map((entity) => entity.id), evidenceFactIds: ["matrix_given", "source_requests"] });
  for (const cell of program.requestedCells) problem.solveRequests.push({ id: `requested_${cell.row}${cell.column}`, kind: "evaluate", expressionId: `e${cell.row}${cell.column}` });
  if (/\border\b/i.test(question)) for (const expressionId of ["eOrderRows", "eOrderCols"]) problem.solveRequests.push({ id: `requested_${expressionId}`, kind: "evaluate", expressionId });
  return problem;
}

/**
 * Parent integration point, before solver authority: recover source evidence,
 * preserve the captured IR (or construct a complete source IR), replace a tuple
 * order unknown with its two scalar components, and supply explicit bindings.
 * Solver results must be recomputed; this function never accepts old results.
 */
export function prepareMatrixLiteralSourceAuthority(question: string, rawPlan: TurnPlanV3, rawProblem?: ProblemIR | null): {
  plan: TurnPlanV3; problemIR: ProblemIR; document: SceneDocument;
} | null {
  try {
    const program = readMatrixLiteralSourceProgram(question);
    if (!program || program.matrices.length !== 1) return null;
    const matrix = program.matrices[0]!;
    const plan = recoverMatrixLiteralPlanEvidence(question, rawPlan);
    if (!plan) return null;
    for (const claim of plan.qualitativeClaims) {
      if (claim.relatedQuantityIds?.includes("order")) {
        if (typeof claim.expected !== "string" || claim.expected.replace(/[\s×]/g, (text) => text === "×" ? "x" : "") !== `${matrix.entries.length}x${matrix.entries[0]!.length}`) return null;
      } else if (claim.relatedQuantityIds?.length && (typeof claim.expected === "number" || typeof claim.expected === "string" && /^[-+\d.]+$/.test(claim.expected))) {
        const owners = claim.relatedQuantityIds.map((id) => [...plan.givens, ...plan.derived].find((quantity) => quantity.id === id));
        if (owners.some((quantity) => !quantity) || owners.some((quantity) => quantity!.value !== Number(claim.expected))) return null;
      }
    }
    const problem = rawProblem ? structuredClone(snapshotMathSourceData(rawProblem)) : sourceProblem(question, matrix, program);
    if (!validateProblemIR(problem, question).valid || !bindProblem(problem, matrix, program)) return null;
    // Every source-requested cell stays a solver obligation even if the plan
    // forgot its unknown; incomplete plans decline instead of hiding that work.
    if (program.requestedCells.some((cell) => !plan.unknowns.some((unknown) => unknown.symbol === `${cell.name.toLowerCase()}${cell.row}${cell.column}`))) return null;
    const order = plan.unknowns.filter((unknown) => unknown.id === "order" && unknown.symbol === "order");
    if (order.length) {
      if (order.length !== 1 || order[0]!.unit || !/\border\b/i.test(question) || plan.derived.some((quantity) => quantity.id === "order")) return null;
      plan.unknowns = plan.unknowns.filter((unknown) => unknown !== order[0]);
      for (const [symbol, value, expressionId] of [[`rows${matrix.name}`, matrix.entries.length, "eOrderRows"], [`cols${matrix.name}`, matrix.entries[0]!.length, "eOrderCols"]] as const) {
        if ([...plan.givens, ...plan.derived, ...plan.unknowns].some((item) => item.id === symbol)) return null;
        plan.unknowns.push({ id: symbol, symbol });
        plan.derived.push({ id: symbol, symbol, value, provenance: "derived", dependsOn: plan.givens.map((quantity) => quantity.id) });
        if (!problem.expressions.some((expression) => expression.id === expressionId)) return null;
        let request = problem.solveRequests.find((request) => request.kind === "evaluate" && request.expressionId === expressionId);
        if (!request) { request = { id: `solve_${symbol}`, kind: "evaluate", expressionId }; problem.solveRequests.push(request); }
        request.resultBinding = { turnPlanQuantityId: symbol, symbol, evidenceFactIds: problem.facts.filter((fact) => fact.kind === "requested" && /\border\b/i.test(fact.evidence.quote)).map((fact) => fact.id) };
        if (!request.resultBinding.evidenceFactIds.length) return null;
      }
      for (const claim of plan.qualitativeClaims) if (claim.relatedQuantityIds?.includes("order")) claim.relatedQuantityIds = claim.relatedQuantityIds.flatMap((id) => id === "order" ? [`rows${matrix.name}`, `cols${matrix.name}`] : [id]);
    }
    for (const unknown of plan.unknowns) {
      const requested = program.requestedCells.filter((cell) => unknown.symbol === `${cell.name.toLowerCase()}${cell.row}${cell.column}`);
      if (unknown.id === `rows${matrix.name}` || unknown.id === `cols${matrix.name}`) continue;
      if (requested.length !== 1 || unknown.unit) return null;
      const cell = requested[0]!;
      const expressionId = `e${cell.row}${cell.column}`;
      const expression = problem.expressions.find((expression) => expression.id === expressionId);
      if (!expression) return null;
      let request = problem.solveRequests.find((request) => request.kind === "evaluate" && request.expressionId === expressionId);
      if (!request) { request = { id: `solve_${unknown.id}`, kind: "evaluate", expressionId }; problem.solveRequests.push(request); }
      if (request.resultBinding && request.resultBinding.turnPlanQuantityId !== unknown.id) return null;
      const factIds = problem.facts.filter((fact) => fact.kind === "requested" && fact.evidence.quote.includes(`${matrix.name.toLowerCase()}${cell.row}${cell.column}`)).map((fact) => fact.id);
      if (!factIds.length) return null;
      request.resultBinding = { turnPlanQuantityId: unknown.id, symbol: unknown.symbol, evidenceFactIds: factIds };
      if (!plan.derived.some((quantity) => quantity.id === unknown.id)) {
        plan.derived.push({ id: unknown.id, symbol: unknown.symbol, value: matrixEntryDouble(matrix.geometry.matrixArray.exactEntries[cell.row - 1]![cell.column - 1]!), provenance: "derived" });
      }
    }
    const document = buildMatrixSourceDocument(question, plan);
    return document && validateProblemIR(problem, question).valid ? { plan, problemIR: problem, document } : null;
  } catch { return null; }
}

/** Independently regenerate the entire grid and bind a single row/column/cell role. */
export function matrixLiteralSourceEntityIsCarried(document: SceneDocument, problem: ProblemIR, entityId: string): boolean | null {
  try {
    const source = readMatrixLiteralSourceProgram(problem.question);
    if (!source || source.matrices.length !== 1) return null;
    if (!validateProblemIR(problem, problem.question).valid || !bindProblem(problem, source.matrices[0]!, source)
      || validateMatrixSourceBinding(document, problem.question).some((issue) => issue.severity === "fatal")) return false;
    const entity = problem.entities.find((entity) => entity.id === entityId);
    const role = entity && entityRole(entity, source.matrices[0]!);
    const table = role && document.entities.find((entity) => entity.kind === "matrix_array" && entity.label === role.name);
    return Boolean(table && document.entities.length === 1 && document.constructions.length === 1
      && document.constructions[0]!.operator === "matrix_array" && document.annotations.length === 0
      && document.requiredEntityIds.includes(table.id) && document.revealGroups.some((group) => group.entityIds.includes(table.id)));
  } catch { return false; }
}

/** A dimension is carried by its exact cell position or order component, never value membership. */
export function matrixLiteralSourceDimensionIsCarried(document: SceneDocument, problem: ProblemIR, expressionId: string, value: number, factIds: readonly string[]): boolean | null {
  try {
    const source = readMatrixLiteralSourceProgram(problem.question);
    if (!source || source.matrices.length !== 1) return null;
    const matrix = source.matrices[0]!;
    const expression = problem.expressions.find((expression) => expression.id === expressionId);
    const role = expression && expressionRole(expressionId, matrix);
    if (!expression || !role || expression.evidenceFactIds.length !== factIds.length || !factIds.every((id) => expression.evidenceFactIds.includes(id))) return false;
    const expected = roleValue(role, matrix);
    if (!expected || value !== (role.kind === "cell" ? matrixEntryDouble(matrix.geometry.matrixArray.exactEntries[role.row! - 1]![role.column! - 1]!) : Number(expected))) return false;
    return matrixLiteralSourceEntityIsCarried(document, problem, problem.entities.find((entity) => entity.label === matrix.name)?.id ?? "") === true;
  } catch { return false; }
}
