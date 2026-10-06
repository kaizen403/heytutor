/** Complete, bounded source joins. No caller IR is rewritten or discarded. */
import { parseStemNumber, STEM_NUMBER } from "../archetypes/slots";
import { fmt } from "../archetypes/document";
import { evaluateMathExpression } from "../math/expression";
import { expressionToSafeSource, type ExpressionNodeIR as Node, type ProblemIR } from "./problemIR";
import type { LadderSourceResolution, RightTriangleRole } from "./rightTriangleSource";
import type { SceneDocument } from "../types";

type Source = Extract<LadderSourceResolution, { ok: true }>;
type Role = RightTriangleRole | "theta" | "cosTheta";
const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
const unpunctuated = (text: string) => normalize(text).replace(/[.!?]+$/, "");
const near = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && (a === b || Math.abs(a - b) <= 1e-10 * Math.max(Math.abs(a), Math.abs(b)));
const number = (value: number): Node => ({ kind: "number", value });
const binary = (operator: "+" | "-" | "*" | "/" | "^", left: Node, right: Node): Node => ({ kind: "binary", operator, left, right });
const call = (fn: "sqrt" | "atan", argument: Node): Node => ({ kind: "call", function: fn, argument });
const parts: Record<string, string> = { ladder: "ladder", wall: "wall", floor: "floor", foot: "A", top: "B", corner: "corner", A: "A", B: "B", O: "corner" };
const concepts: Record<string, string> = { ladder: "ladder", wall: "wall", floor: "floor", A: "foot", B: "top", corner: "wall" };
const targets: Record<Role, string> = { length: "ladder", distance: "foot_distance", height: "top_height", theta: "angle", cosTheta: "angle" };

export interface StaticContactTriangleProblemBinding {
  problem: ProblemIR;
  labels: Map<string, string>;
  entityBindings: Map<string, string>;
  quantities: SceneDocument["quantities"];
  annotations: SceneDocument["annotations"];
  dimensionLabels: Array<{ id: string; targetId: string; text: string }>;
}

export function staticContactRequestRole(text: string): Role | null {
  const match = /^(?:find|calculate|determine) (?:the |its )?(height(?: reached)?|foot distance|length|angle (?:with|to) the (?:floor|horizontal)|cos(?:ine)? (?:of )?(?:the )?angle (?:with|to) the (?:floor|horizontal))$/.exec(unpunctuated(text));
  return !match ? null : match[1]!.startsWith("height") ? "height" : match[1]!.startsWith("foot") ? "distance"
    : match[1]!.startsWith("length") ? "length" : match[1]!.startsWith("cos") ? "cosTheta" : "theta";
}

function quantityRole(name: string): Role | null {
  const clean = name.replace(/^e(?=[A-Z_])/, "").toLowerCase().replace(/[\s_{}\\]/g, "");
  const aliases: Record<Role, string[]> = { length: ["l", "length", "ladderlength"], distance: ["d", "x", "distance", "footdistance", "base"],
    height: ["h", "y", "height", "topheight"], theta: ["theta", "angle", "θ"], cosTheta: ["costheta", "cosθ", "cosine"] };
  return (Object.keys(aliases) as Role[]).find(role => aliases[role].includes(clean)) ?? null;
}

function unitFactor(role: Role, unit: unknown): number | null {
  if (typeof unit !== "string") return null;
  const text = normalize(unit);
  if (role === "cosTheta") return text === "1" ? 1 : null;
  if (role === "theta") return /^(?:degree|degrees|deg|°)$/.test(text) ? Math.PI / 180 : /^(?:rad|radian|radians)$/.test(text) ? 1 : null;
  return /^(?:m|metres?|meters?)$/.test(text) ? 1 : /^(?:cm|centimetres?|centimeters?)$/.test(text) ? .01
    : /^(?:km|kilometres?|kilometers?)$/.test(text) ? 1000 : null;
}

function literal(quote: string) {
  const match = new RegExp(`^${STEM_NUMBER}\\s*(\\S+)$`, "i").exec(quote);
  const value = match && parseStemNumber(match[1]!);
  const unit = match?.[2];
  const factor = unitFactor("length", unit);
  return value == null || !unit || factor == null ? null : { value, unit, factor };
}

/** Structural normal form: addition/multiplication commute; - and / keep order. */
function astKey(node: Node): string {
  if (node.kind === "number") return `number(${node.value})`;
  if (node.kind === "constant") return `constant(${node.name})`;
  if (node.kind === "variable") return `variable(${node.name})`;
  if (node.kind === "unary") return `unary(${node.operator},${astKey(node.operand)})`;
  if (node.kind === "call") return `${node.function}(${astKey(node.argument)})`;
  const op = node.operator;
  const flatten = (child: Node): Node[] => (op === "+" || op === "*") && child.kind === "binary" && child.operator === op
    ? [...flatten(child.left), ...flatten(child.right)] : [child];
  const keys = [...flatten(node.left), ...flatten(node.right)].map(astKey);
  return `${op}(${(op === "+" || op === "*" ? keys.sort() : keys).join(",")})`;
}

function sourceFormula(source: Source, role: Role, unit: string): Node | null {
  const sides = new Map<RightTriangleRole, Node>();
  for (const evidence of source.evidence) {
    const raw = literal(evidence.quote);
    if (!raw || !near(raw.value * raw.factor, evidence.value)) return null;
    sides.set(evidence.role, raw.factor === 1 ? number(raw.value) : binary("*", number(raw.value), number(raw.factor)));
  }
  // Literal-only ASTs cannot distinguish coincident physical role leaves.
  // Decline that ambiguous contract instead of pretending a scalar is a join.
  const sideKeys = [...sides.values()].map(astKey);
  if (new Set(sideKeys).size !== sideKeys.length) return null;
  const square = (side: Node) => binary("^", side, number(2));
  const l = sides.get("length"), d = sides.get("distance"), h = sides.get("height");
  if (!l && d && h) sides.set("length", call("sqrt", binary("+", square(d), square(h))));
  if (!d && l && h) sides.set("distance", call("sqrt", binary("-", square(l), square(h))));
  if (!h && l && d) sides.set("height", call("sqrt", binary("-", square(l), square(d))));
  if (sides.size !== 3) return null;
  let root = role === "theta" ? call("atan", binary("/", sides.get("height")!, sides.get("distance")!))
    : role === "cosTheta" ? binary("/", sides.get("distance")!, sides.get("length")!) : sides.get(role)!;
  const factor = unitFactor(role, unit);
  if (factor == null) return null;
  if (role === "theta") {
    if (factor !== 1) root = binary("/", binary("*", root, number(180)), { kind: "constant", name: "pi" });
  } else if (factor !== 1) root = binary("/", root, number(factor));
  return root;
}

/** Called after validateProblemIR and the whole-source static premise guard. */
export function bindStaticContactTriangleProblem(problem: ProblemIR, source: Source, plan?: unknown): StaticContactTriangleProblemBinding | null {
  const result: StaticContactTriangleProblemBinding = { problem, labels: new Map(), entityBindings: new Map(), quantities: [], annotations: [], dimensionLabels: [] };
  const facts = new Map(problem.facts.map(fact => [fact.id, fact]));
  const quotes = (ids: string[]) => ids.map(id => facts.get(id)!.evidence.quote).join(" ");
  const usedFacts = new Set<string>();
  const use = (ids: string[]) => ids.forEach(id => usedFacts.add(id));
  const requested = new Map<string, Role>();
  const requestClause = problem.question.match(/(?:find|calculate|determine)\b[^.!?]*[.!?]?\s*$/i)?.[0];
  const askedRole = requestClause && staticContactRequestRole(requestClause);
  if (!askedRole) return null;
  const premises = unpunctuated(problem.question.slice(0, problem.question.length - requestClause!.length));
  const dimensionRoles = (text: string): RightTriangleRole[] => {
    const normalized = normalize(text);
    return source.evidence.filter(evidence => normalized.includes(normalize(evidence.quote))).map(evidence => evidence.role);
  };
  for (const fact of problem.facts) {
    const statement = unpunctuated(fact.statement), quote = unpunctuated(fact.evidence.quote);
    if (fact.kind === "requested") {
      const role = staticContactRequestRole(statement);
      if (role !== askedRole || staticContactRequestRole(quote) !== role) return null;
      requested.set(fact.id, role);
      continue;
    }
    const identity = /^(?:ladder|(?:vertical )?wall|(?:horizontal )?floor|(?:its )?(?:foot|top)|corner)$/;
    const sourceClause = statement === quote && (identity.test(quote) || premises.split(/\.\s+/).includes(quote) || quote === premises);
    if (sourceClause) continue;
    // A numeric paraphrase must name its physical side and quote that source
    // datum; an arbitrary true-looking statement does not bind a fact.
    let residue = statement;
    const grounded = dimensionRoles(fact.evidence.quote);
    for (const evidence of source.evidence.filter(row => grounded.includes(row.role))) residue = residue.split(normalize(evidence.quote)).join(`@${evidence.role}`);
    if (fact.kind !== "given" || !(
      /^(?:the )?ladder (?:has (?:a )?length(?: of)?|length is|is) @length(?: long)?$/.test(residue)
      || /^(?:the )?(?:ladder )?foot is @distance (?:away )?from the wall$/.test(residue)
      || /^(?:the )?(?:ladder )?top is @height above the (?:horizontal )?floor$/.test(residue))) return null;
  }
  for (const entity of problem.entities) {
    const label = entity.label ?? entity.id, part = parts[label];
    if (!part || result.labels.has(part)) return null;
    const evidence = normalize(quotes(entity.evidenceFactIds));
    const direct = new RegExp(`\\b${concepts[part]}\\b`, "i").test(evidence);
    const sourceContactPoint = ["A", "B", "corner"].includes(part) && /vertical wall/.test(evidence) && /horizontal floor/.test(evidence);
    if (!direct && !sourceContactPoint) return null;
    if (entity.evidenceFactIds.some(id => facts.get(id)!.kind === "requested")
      && !(part === "A" && askedRole === "distance" || part === "B" && askedRole === "height")) return null;
    if (["A", "B", "corner"].includes(part) ? entity.kind !== "point" : !["body", "line"].includes(entity.kind)) return null;
    result.labels.set(part, label);
    result.entityBindings.set(entity.id, part);
    use(entity.evidenceFactIds);
  }
  for (const intent of problem.representationIntents) {
    if (intent.kind !== "conceptual" || intent.entityIds.some(id => !result.entityBindings.has(id))
      || intent.evidenceFactIds.some(id => facts.get(id)!.kind === "requested")) return null;
    use(intent.evidenceFactIds);
  }
  for (const constraint of problem.constraints) {
    if (constraint.kind === "equation" || constraint.kind === "inequality" || constraint.entityIds.length !== 2) return null;
    const ids = constraint.entityIds.map(id => result.entityBindings.get(id));
    const pair = [...ids].sort().join(",");
    const evidence = normalize(quotes(constraint.evidenceFactIds));
    if (constraint.evidenceFactIds.some(id => facts.get(id)!.kind === "requested")) return null;
    if (constraint.kind === "perpendicular" && pair === "floor,wall" && /vertical wall/.test(evidence) && /horizontal floor/.test(evidence)) { use(constraint.evidenceFactIds); continue; }
    if (constraint.kind === "incident" && pair === "A,floor" && /horizontal floor/.test(evidence) && (/foot/.test(evidence) || /vertical wall/.test(evidence))) { use(constraint.evidenceFactIds); continue; }
    if (constraint.kind === "incident" && pair === "B,wall" && /wall/.test(evidence) && (/top/.test(evidence) || /horizontal floor/.test(evidence))) { use(constraint.evidenceFactIds); continue; }
    return null;
  }
  const numeric = problem.expressions.length > 0 || problem.solveRequests.length > 0;
  if (!numeric) return result; // Preserve the initial bodies/prose contract.
  if (["ladder", "wall", "floor"].some(part => !result.labels.has(part)) || !requested.size) return null;
  const usedExpressions = new Set<string>(), givenRoles = new Set<RightTriangleRole>(), solvedFacts = new Set<string>();
  const addQuantity = (id: string, symbol: string, role: Role, value: number, unit: string, evidenceFactIds: string[], provenance: "given" | "derived") => {
    if (result.quantities.some(row => row.id === id)) return false;
    result.quantities.push({ id, symbol, value, unit, evidenceFactIds: [...evidenceFactIds], provenance, sourceText: quotes(evidenceFactIds) });
    result.annotations.push({ id: `contact_dimension_${id}`, kind: "label", targetIds: [targets[role]], quantityId: id });
    const factor = unitFactor(role, unit)!;
    const displayUnit = role === "cosTheta" ? "" : role === "theta" ? factor === 1 ? " rad" : "°"
      : factor === 1 ? " m" : factor === .01 ? " cm" : " km";
    const displaySymbol = { length: "L", distance: "d", height: "h", theta: "θ", cosTheta: "cosθ" }[role];
    const text = `${displaySymbol}${Number(fmt(value)) === value ? "=" : "≈"}${fmt(value)}${displayUnit}`;
    result.dimensionLabels.push({ id: `contact_value_${id}`, targetId: targets[role], text });
    return true;
  };
  for (const expression of problem.expressions) {
    const requests = problem.solveRequests.filter(request => request.kind === "evaluate" && request.expressionId === expression.id);
    if (requests.length) continue;
    const role = quantityRole(expression.id);
    if (!role || role === "theta" || role === "cosTheta" || givenRoles.has(role) || expression.valueType !== "scalar" || expression.root.kind !== "number"
      || expression.evidenceFactIds.some(id => facts.get(id)!.kind !== "given")) return null;
    const evidence = source.evidence.find(row => row.role === role);
    const raw = evidence && literal(evidence.quote);
    if (!evidence || !raw || !dimensionRoles(quotes(expression.evidenceFactIds)).includes(role) || expression.root.value !== raw.value) return null;
    if (!addQuantity(expression.id, role, role, raw.value, raw.unit, expression.evidenceFactIds, "given")) return null;
    givenRoles.add(role); usedExpressions.add(expression.id); use(expression.evidenceFactIds);
  }
  if (source.evidence.some(evidence => !givenRoles.has(evidence.role))) return null;
  for (const request of problem.solveRequests) {
    if (request.kind !== "evaluate" || !request.resultBinding || usedExpressions.has(request.expressionId)) return null;
    const binding = request.resultBinding, expression = problem.expressions.find(row => row.id === request.expressionId)!;
    const role = quantityRole(binding.symbol), idRole = quantityRole(binding.turnPlanQuantityId);
    if (!role || role !== askedRole || idRole && idRole !== role || result.entityBindings.has(binding.turnPlanQuantityId)
      || !binding.unit || binding.evidenceFactIds.some(id => requested.get(id) !== role)
      || !binding.evidenceFactIds.length || expression.valueType !== "scalar") return null;
    const factor = unitFactor(role, binding.unit), expected = sourceFormula(source, role, binding.unit);
    if (factor == null || !expected || astKey(expression.root) !== astKey(expected)) return null;
    // The formula must carry all source side evidence and the actual request.
    if (source.evidence.some(evidence => !dimensionRoles(quotes(expression.evidenceFactIds)).includes(evidence.role))
      || !expression.evidenceFactIds.some(id => requested.get(id) === role)) return null;
    const value = role === "theta" ? source.state.theta * Math.PI / 180 / factor : source.state[role] / factor;
    try { if (!near(evaluateMathExpression(expressionToSafeSource(expression.root), 0), value)) return null; } catch { return null; }
    if (!addQuantity(binding.turnPlanQuantityId, binding.symbol, role, value, binding.unit, expression.evidenceFactIds, "derived")) return null;
    usedExpressions.add(expression.id); use(expression.evidenceFactIds); use(binding.evidenceFactIds);
    binding.evidenceFactIds.forEach(id => solvedFacts.add(id));
  }
  if (problem.expressions.some(expression => !usedExpressions.has(expression.id)) || [...requested.keys()].some(id => !solvedFacts.has(id))
    || problem.facts.some(fact => !usedFacts.has(fact.id))) return null;
  if (plan !== undefined && !planAgreement(plan, problem, source)) return null;
  return result;
}

function planAgreement(raw: unknown, problem: ProblemIR, source: Source): boolean {
  if (!raw || typeof raw !== "object") return false;
  const plan = raw as Record<string, unknown>;
  if (plan.schemaVersion !== "turn-plan/v3" || normalize(String(plan.question)) !== normalize(problem.question)) return false;
  const rows: Array<{ id: string; symbol: string; unit: string; value?: number; list: string }> = [];
  for (const list of ["givens", "derived", "unknowns"]) {
    if (!Array.isArray(plan[list])) return false;
    const seen = new Set<string>();
    for (const rawRow of plan[list]) {
      if (!rawRow || typeof rawRow !== "object") return false;
      const row = rawRow as Record<string, unknown>;
      if (typeof row.id !== "string" || typeof row.symbol !== "string" || typeof row.unit !== "string" || seen.has(row.id)) return false;
      seen.add(row.id);
      const role = quantityRole(row.symbol), idRole = quantityRole(row.id);
      if (!role || idRole && idRole !== role) return false;
      const factor = unitFactor(role, row.unit);
      if (factor == null || list === "givens" && !source.evidence.some(evidence => evidence.role === role)) return false;
      const expected = role === "theta" ? source.state.theta * Math.PI / 180 / factor : source.state[role] / factor;
      if (list !== "unknowns" && (typeof row.value !== "number" || !near(row.value, expected))) return false;
      rows.push({ id: row.id, symbol: row.symbol, unit: row.unit, value: row.value as number | undefined, list });
    }
  }
  for (const request of problem.solveRequests) {
    const binding = request.resultBinding!;
    const matches = rows.filter(row => row.list !== "givens" && row.id === binding.turnPlanQuantityId);
    const role = quantityRole(binding.symbol)!;
    if (!matches.length || matches.some(row => quantityRole(row.symbol) !== role || unitFactor(role, row.unit) !== unitFactor(role, binding.unit))) return false;
  }
  return rows.filter(row => row.list === "unknowns").every(row => problem.solveRequests.some(request => request.resultBinding?.turnPlanQuantityId === row.id));
}
