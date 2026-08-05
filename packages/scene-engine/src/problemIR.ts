import { parseMathExpression } from "./expression";

export const PROBLEM_IR_VERSION = "problem-ir/v1" as const;

const MAX_ITEMS = 256;
const MAX_EXPRESSION_NODES = 128;
const MAX_EXPRESSION_DEPTH = 24;
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export interface QuestionSourceEvidence {
  source: "question";
  start: number;
  end: number;
  quote: string;
}

export interface ProblemFact {
  id: string;
  kind: "given" | "requested" | "assumption";
  statement: string;
  evidence: QuestionSourceEvidence;
}

export interface ProblemEntity {
  id: string;
  kind: "point" | "line" | "curve" | "region" | "body" | "solid" | "component" | "field" | "state" | "other";
  label?: string;
  evidenceFactIds: string[];
}

export type ExpressionNodeIR =
  | { kind: "number"; value: number }
  | { kind: "constant"; name: "pi" | "e" }
  | { kind: "variable"; name: string }
  | { kind: "unary"; operator: "+" | "-"; operand: ExpressionNodeIR }
  | {
      kind: "binary";
      operator: "+" | "-" | "*" | "/" | "^";
      left: ExpressionNodeIR;
      right: ExpressionNodeIR;
    }
  | {
      kind: "call";
      function: "sin" | "cos" | "tan" | "asin" | "acos" | "atan" | "sqrt" | "abs" | "exp" | "log" | "ln";
      argument: ExpressionNodeIR;
    };

export interface ProblemExpression {
  id: string;
  valueType: "scalar" | "function";
  root: ExpressionNodeIR;
  evidenceFactIds: string[];
}

export type ProblemConstraint =
  | { id: string; kind: "equation"; leftExpressionId: string; rightExpressionId: string; evidenceFactIds: string[] }
  | { id: string; kind: "inequality"; leftExpressionId: string; relation: "<" | "<=" | ">" | ">="; rightExpressionId: string; evidenceFactIds: string[] }
  | { id: string; kind: "incident" | "parallel" | "perpendicular" | "tangent" | "inside" | "connected" | "symmetric"; entityIds: string[]; evidenceFactIds: string[] };

export type RepresentationIntent =
  | { id: string; kind: "graph"; entityIds: string[]; evidenceFactIds: string[] }
  | { id: string; kind: "bounded_region"; entityIds: string[]; evidenceFactIds: string[] }
  | { id: string; kind: "section" | "solid" | "network" | "apparatus" | "free_body" | "field" | "conceptual"; entityIds: string[]; evidenceFactIds: string[] };

export interface SolveDomain {
  min: number;
  max: number;
}

export interface SolveResultBinding {
  /** Exact TurnPlanV3 unknown/derived quantity id; never inferred from request names. */
  turnPlanQuantityId: string;
  symbol: string;
  unit?: string;
  /** Requested fact(s) that ground this result in the submitted question. */
  evidenceFactIds: string[];
}

export type SolveRequest =
  | { id: string; kind: "evaluate"; expressionId: string; resultBinding?: SolveResultBinding }
  | { id: string; kind: "roots"; expressionId: string; variable: string; domain: SolveDomain; resultBinding?: SolveResultBinding }
  | { id: string; kind: "intersections"; leftExpressionId: string; rightExpressionId: string; variable: string; domain: SolveDomain; resultBinding?: SolveResultBinding }
  | { id: string; kind: "definite_integral"; expressionId: string; variable: string; lower: number; upper: number; resultBinding?: SolveResultBinding };

export interface ProblemIR {
  schemaVersion: typeof PROBLEM_IR_VERSION;
  id: string;
  question: string;
  facts: ProblemFact[];
  entities: ProblemEntity[];
  expressions: ProblemExpression[];
  constraints: ProblemConstraint[];
  representationIntents: RepresentationIntent[];
  solveRequests: SolveRequest[];
}

export interface ProblemIRIssue {
  code: string;
  path: string;
  message: string;
}

export interface ProblemIRValidationResult {
  valid: boolean;
  problem: ProblemIR | null;
  issues: ProblemIRIssue[];
}

export function validateProblemIR(raw: unknown, expectedQuestion?: string): ProblemIRValidationResult {
  const issues: ProblemIRIssue[] = [];
  if (!isRecord(raw)) return invalidRoot("ProblemIR must be an object");
  if (raw.schemaVersion !== PROBLEM_IR_VERSION) add(issues, "schema_version", "schemaVersion", `Expected ${PROBLEM_IR_VERSION}`);
  validateId(raw.id, "id", issues);
  if (typeof raw.question !== "string" || raw.question.trim() === "") {
    add(issues, "invalid_question", "question", "question must be non-empty");
  } else if (
    expectedQuestion !== undefined &&
    normalizeQuestion(raw.question) !== normalizeQuestion(expectedQuestion)
  ) {
    add(issues, "question_mismatch", "question", "problem question does not match the submitted question");
  }

  const arrays = ["facts", "entities", "expressions", "constraints", "representationIntents", "solveRequests"] as const;
  for (const field of arrays) {
    if (!Array.isArray(raw[field])) add(issues, "missing_array", field, `${field} must be an array`);
    else if (raw[field].length > MAX_ITEMS) add(issues, "too_many_items", field, `${field} exceeds ${MAX_ITEMS} items`);
  }
  if (issues.some((issue) => issue.code === "missing_array")) return { valid: false, problem: null, issues };

  const question = typeof raw.question === "string" ? raw.question : "";
  const facts = raw.facts as unknown[];
  const entities = raw.entities as unknown[];
  const expressions = raw.expressions as unknown[];
  const constraints = raw.constraints as unknown[];
  const intents = raw.representationIntents as unknown[];
  const requests = raw.solveRequests as unknown[];
  const factIds = collectIds(facts, "facts", issues);
  const entityIds = collectIds(entities, "entities", issues);
  const expressionIds = collectIds(expressions, "expressions", issues);
  collectIds(constraints, "constraints", issues);
  collectIds(intents, "representationIntents", issues);
  collectIds(requests, "solveRequests", issues);

  facts.forEach((value, index) => validateFact(value, question, `facts[${index}]`, issues));
  entities.forEach((value, index) => validateEntity(value, factIds, `entities[${index}]`, issues));
  expressions.forEach((value, index) => validateExpression(value, factIds, `expressions[${index}]`, issues));
  constraints.forEach((value, index) => validateConstraint(value, factIds, entityIds, expressionIds, `constraints[${index}]`, issues));
  intents.forEach((value, index) => validateIntent(value, factIds, entityIds, `representationIntents[${index}]`, issues));
  requests.forEach((value, index) => validateSolveRequest(value, expressionIds, factIds, `solveRequests[${index}]`, issues));

  return issues.length === 0
    ? { valid: true, problem: raw as unknown as ProblemIR, issues: [] }
    : { valid: false, problem: null, issues };
}

/** Convert the typed AST to the existing audited expression language. */
export function expressionToSafeSource(root: ExpressionNodeIR, variable?: string): string {
  let nodes = 0;
  const visit = (node: ExpressionNodeIR, depth: number): string => {
    nodes += 1;
    if (nodes > MAX_EXPRESSION_NODES || depth > MAX_EXPRESSION_DEPTH) throw new Error("expression exceeds structural limits");
    switch (node.kind) {
      case "number":
        if (!Number.isFinite(node.value) || Math.abs(node.value) > 1e12) throw new Error("number is outside the supported range");
        return Object.is(node.value, -0) ? "0" : String(node.value);
      case "constant": return node.name;
      case "variable":
        if (!IDENTIFIER_PATTERN.test(node.name)) throw new Error("invalid variable name");
        if (variable === undefined || node.name !== variable) throw new Error(`unsupported free variable ${node.name}`);
        return "x";
      case "unary": return `(${node.operator}${visit(node.operand, depth + 1)})`;
      case "binary": return `(${visit(node.left, depth + 1)}${node.operator}${visit(node.right, depth + 1)})`;
      case "call": return `${node.function}(${visit(node.argument, depth + 1)})`;
    }
  };
  const source = visit(root, 0);
  parseMathExpression(source);
  return source;
}

function validateFact(raw: unknown, question: string, path: string, issues: ProblemIRIssue[]): void {
  if (!isRecord(raw)) return add(issues, "invalid_fact", path, "fact must be an object");
  if (!["given", "requested", "assumption"].includes(String(raw.kind))) add(issues, "invalid_fact_kind", `${path}.kind`, "invalid fact kind");
  if (typeof raw.statement !== "string" || raw.statement.trim() === "") add(issues, "invalid_statement", `${path}.statement`, "statement must be non-empty");
  if (!isRecord(raw.evidence)) return add(issues, "missing_evidence", `${path}.evidence`, "fact requires question evidence");
  const evidence = raw.evidence;
  if (evidence.source !== "question" || !Number.isInteger(evidence.start) || !Number.isInteger(evidence.end) || typeof evidence.quote !== "string") {
    return add(issues, "invalid_evidence", `${path}.evidence`, "evidence must contain a question span and quote");
  }
  const start = evidence.start as number;
  const end = evidence.end as number;
  if (start < 0 || end <= start || end > question.length || question.slice(start, end) !== evidence.quote) {
    add(issues, "ungrounded_fact", `${path}.evidence`, "evidence quote must exactly match the submitted question span");
  }
}

function validateEntity(raw: unknown, facts: Set<string>, path: string, issues: ProblemIRIssue[]): void {
  if (!isRecord(raw)) return add(issues, "invalid_entity", path, "entity must be an object");
  const kinds = ["point", "line", "curve", "region", "body", "solid", "component", "field", "state", "other"];
  if (!kinds.includes(String(raw.kind))) add(issues, "invalid_entity_kind", `${path}.kind`, "invalid entity kind");
  validateEvidenceRefs(raw.evidenceFactIds, facts, `${path}.evidenceFactIds`, issues);
}

function validateExpression(raw: unknown, facts: Set<string>, path: string, issues: ProblemIRIssue[]): void {
  if (!isRecord(raw)) return add(issues, "invalid_expression", path, "expression must be an object");
  if (raw.valueType !== "scalar" && raw.valueType !== "function") add(issues, "invalid_expression_type", `${path}.valueType`, "valueType must be scalar or function");
  validateEvidenceRefs(raw.evidenceFactIds, facts, `${path}.evidenceFactIds`, issues);
  if (!isRecord(raw.root)) return add(issues, "invalid_expression_tree", `${path}.root`, "root must be an expression node");
  try {
    validateExpressionNode(raw.root, undefined, 0, { count: 0 });
  } catch (error) {
    add(issues, "invalid_expression_tree", `${path}.root`, error instanceof Error ? error.message : String(error));
  }
}

function validateExpressionNode(raw: unknown, variable: string | undefined, depth: number, budget: { count: number }): void {
  if (!isRecord(raw)) throw new Error("expression node must be an object");
  budget.count += 1;
  if (budget.count > MAX_EXPRESSION_NODES || depth > MAX_EXPRESSION_DEPTH) throw new Error("expression exceeds structural limits");
  switch (raw.kind) {
    case "number":
      if (typeof raw.value !== "number" || !Number.isFinite(raw.value) || Math.abs(raw.value) > 1e12) throw new Error("invalid numeric literal");
      return;
    case "constant":
      if (raw.name !== "pi" && raw.name !== "e") throw new Error("invalid constant");
      return;
    case "variable":
      if (typeof raw.name !== "string" || !IDENTIFIER_PATTERN.test(raw.name)) throw new Error("invalid variable");
      return;
    case "unary":
      if (raw.operator !== "+" && raw.operator !== "-") throw new Error("invalid unary operator");
      return validateExpressionNode(raw.operand, variable, depth + 1, budget);
    case "binary":
      if (!["+", "-", "*", "/", "^"].includes(String(raw.operator))) throw new Error("invalid binary operator");
      validateExpressionNode(raw.left, variable, depth + 1, budget);
      return validateExpressionNode(raw.right, variable, depth + 1, budget);
    case "call":
      if (!["sin", "cos", "tan", "asin", "acos", "atan", "sqrt", "abs", "exp", "log", "ln"].includes(String(raw.function))) throw new Error("invalid function");
      return validateExpressionNode(raw.argument, variable, depth + 1, budget);
    default: throw new Error("invalid expression node kind");
  }
}

function validateConstraint(raw: unknown, facts: Set<string>, entities: Set<string>, expressions: Set<string>, path: string, issues: ProblemIRIssue[]): void {
  if (!isRecord(raw)) return add(issues, "invalid_constraint", path, "constraint must be an object");
  validateEvidenceRefs(raw.evidenceFactIds, facts, `${path}.evidenceFactIds`, issues);
  if (raw.kind === "equation" || raw.kind === "inequality") {
    validateRef(raw.leftExpressionId, expressions, `${path}.leftExpressionId`, "expression", issues);
    validateRef(raw.rightExpressionId, expressions, `${path}.rightExpressionId`, "expression", issues);
    if (raw.kind === "inequality" && !["<", "<=", ">", ">="].includes(String(raw.relation))) add(issues, "invalid_relation", `${path}.relation`, "invalid inequality relation");
    return;
  }
  if (!["incident", "parallel", "perpendicular", "tangent", "inside", "connected", "symmetric"].includes(String(raw.kind))) {
    return add(issues, "invalid_constraint_kind", `${path}.kind`, "invalid constraint kind");
  }
  validateRefs(raw.entityIds, entities, `${path}.entityIds`, "entity", issues, 2);
}

function validateIntent(raw: unknown, facts: Set<string>, entities: Set<string>, path: string, issues: ProblemIRIssue[]): void {
  if (!isRecord(raw)) return add(issues, "invalid_intent", path, "representation intent must be an object");
  if (!["graph", "bounded_region", "section", "solid", "network", "apparatus", "free_body", "field", "conceptual"].includes(String(raw.kind))) {
    add(issues, "invalid_intent_kind", `${path}.kind`, "invalid representation kind");
  }
  validateEvidenceRefs(raw.evidenceFactIds, facts, `${path}.evidenceFactIds`, issues);
  validateRefs(raw.entityIds, entities, `${path}.entityIds`, "entity", issues, 1);
}

function validateSolveRequest(raw: unknown, expressions: Set<string>, facts: Set<string>, path: string, issues: ProblemIRIssue[]): void {
  if (!isRecord(raw)) return add(issues, "invalid_solve_request", path, "solve request must be an object");
  validateResultBinding(raw.resultBinding, facts, `${path}.resultBinding`, issues);
  if (raw.kind === "evaluate") return validateRef(raw.expressionId, expressions, `${path}.expressionId`, "expression", issues);
  if (raw.kind === "roots") {
    validateRef(raw.expressionId, expressions, `${path}.expressionId`, "expression", issues);
    validateVariableAndDomain(raw.variable, raw.domain, path, issues);
    return;
  }
  if (raw.kind === "intersections") {
    validateRef(raw.leftExpressionId, expressions, `${path}.leftExpressionId`, "expression", issues);
    validateRef(raw.rightExpressionId, expressions, `${path}.rightExpressionId`, "expression", issues);
    validateVariableAndDomain(raw.variable, raw.domain, path, issues);
    return;
  }
  if (raw.kind === "definite_integral") {
    validateRef(raw.expressionId, expressions, `${path}.expressionId`, "expression", issues);
    if (typeof raw.variable !== "string" || !IDENTIFIER_PATTERN.test(raw.variable)) add(issues, "invalid_variable", `${path}.variable`, "invalid variable");
    if (typeof raw.lower !== "number" || typeof raw.upper !== "number" || !Number.isFinite(raw.lower) || !Number.isFinite(raw.upper) || raw.lower === raw.upper) {
      add(issues, "invalid_bounds", path, "integral bounds must be distinct finite numbers");
    }
    return;
  }
  add(issues, "invalid_solve_request_kind", `${path}.kind`, "unsupported solve request kind");
}

function validateResultBinding(raw: unknown, facts: Set<string>, path: string, issues: ProblemIRIssue[]): void {
  if (raw === undefined) return;
  if (!isRecord(raw)) return add(issues, "invalid_result_binding", path, "resultBinding must be an object");
  if (typeof raw.turnPlanQuantityId !== "string" || !IDENTIFIER_PATTERN.test(raw.turnPlanQuantityId)) {
    add(issues, "invalid_result_binding", `${path}.turnPlanQuantityId`, "turnPlanQuantityId must be an explicit bounded identifier");
  }
  if (typeof raw.symbol !== "string" || raw.symbol.trim() === "" || raw.symbol.length > 64) {
    add(issues, "invalid_result_binding", `${path}.symbol`, "symbol must be a non-empty bounded string");
  }
  if (raw.unit !== undefined && (typeof raw.unit !== "string" || raw.unit.trim() === "" || raw.unit.length > 64)) {
    add(issues, "invalid_result_binding", `${path}.unit`, "unit must be a non-empty bounded string when present");
  }
  validateEvidenceRefs(raw.evidenceFactIds, facts, `${path}.evidenceFactIds`, issues);
}

function validateVariableAndDomain(variable: unknown, domain: unknown, path: string, issues: ProblemIRIssue[]): void {
  if (typeof variable !== "string" || !IDENTIFIER_PATTERN.test(variable)) add(issues, "invalid_variable", `${path}.variable`, "invalid variable");
  if (!isRecord(domain) || typeof domain.min !== "number" || typeof domain.max !== "number" || !Number.isFinite(domain.min) || !Number.isFinite(domain.max) || !(domain.min < domain.max) || domain.max - domain.min > 1e6) {
    add(issues, "invalid_domain", `${path}.domain`, "domain requires finite min < max with bounded width");
  }
}

function validateEvidenceRefs(raw: unknown, ids: Set<string>, path: string, issues: ProblemIRIssue[]): void {
  validateRefs(raw, ids, path, "fact", issues, 1);
}

function validateRefs(raw: unknown, ids: Set<string>, path: string, kind: string, issues: ProblemIRIssue[], minimum = 0): void {
  if (!Array.isArray(raw) || raw.length < minimum || raw.length > MAX_ITEMS || raw.some((value) => typeof value !== "string")) {
    return add(issues, "invalid_references", path, `${path} must contain at least ${minimum} ${kind} id(s)`);
  }
  for (const [index, value] of raw.entries()) validateRef(value, ids, `${path}[${index}]`, kind, issues);
}

function validateRef(raw: unknown, ids: Set<string>, path: string, kind: string, issues: ProblemIRIssue[]): void {
  if (typeof raw !== "string" || !ids.has(raw)) add(issues, "unknown_reference", path, `unknown ${kind} id ${String(raw)}`);
}

function collectIds(items: unknown[], path: string, issues: ProblemIRIssue[]): Set<string> {
  const ids = new Set<string>();
  items.forEach((item, index) => {
    if (!isRecord(item) || !validateId(item.id, `${path}[${index}].id`, issues)) return;
    if (ids.has(item.id as string)) add(issues, "duplicate_id", `${path}[${index}].id`, `duplicate id ${String(item.id)}`);
    ids.add(item.id as string);
  });
  return ids;
}

function validateId(raw: unknown, path: string, issues: ProblemIRIssue[]): boolean {
  if (typeof raw !== "string" || !IDENTIFIER_PATTERN.test(raw)) {
    add(issues, "invalid_id", path, "id must be a short alphanumeric identifier beginning with a letter");
    return false;
  }
  return true;
}

function invalidRoot(message: string): ProblemIRValidationResult {
  return { valid: false, problem: null, issues: [{ code: "invalid_problem", path: "$", message }] };
}

function add(issues: ProblemIRIssue[], code: string, path: string, message: string): void {
  issues.push({ code, path, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeQuestion(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
