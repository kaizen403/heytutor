/**
 * Bind a complete numeric circuit ProblemIR to the existing source-built circuit.
 * This is a bounded ideal external DC contract, not an obligation exemption.
 * The submitted IR is retained; every entity, fact, expression and request must
 * bind. Scene candidates are regenerated and compared without trusting markers.
 */
import { STEM_NUMBER } from "../archetypes/slots";
import { type ResistorTree } from "../archetypes/resistorTree";
import { evaluateMathExpression } from "../math/expression";
import { expressionToSafeSource, validateProblemIR, type ProblemIR, type ExpressionNodeIR, type ProblemFact } from "./problemIR";
import {
  readCircuitLiterals, readCircuitUnit, readStatedCircuitProblemSource, statedCircuitSymbolBinding,
  type CircuitValue, type StatedCircuitSolution, type StatedCircuitProblemSource,
} from "./statedCircuitAuthority";
import { bindCircuitFact, readCircuitAsks } from "./statedCircuitSemantics";
import type { SceneDocument, SceneIssue } from "../types";
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";

type Role = "resistor" | "battery" | "ammeter" | "voltmeter";
type Literal = ReturnType<typeof readCircuitLiterals>[number];
export interface CircuitProblemBinding {
  /** Original full IR, never reduced to a hand-written surrogate. */
  problem: ProblemIR;
  document: SceneDocument;
  solution: StatedCircuitSolution;
  entityBindings: Array<{ problemEntityId: string; sceneEntityId: string; memberIds: string[] }>;
  expressionBindings: Array<{ expressionId: string; sceneQuantityId: string; ownerId: string; unit: string; value: number }>;
  factBindings: Array<{ factId: string; ownerIds: string[] }>;
  requestBindings: Array<{ factId: string; unit: string; value: CircuitValue }>;
}

const normalized = (text: string): string => text.trim().replace(/\s+/g, " ");
const equal = (a: number, b: number): boolean => a === b || Math.abs(a - b) <= 1e-10 * Math.max(Math.abs(a), Math.abs(b));
const roles = (text: string): Role[] => {
  const found = new Set<Role>();
  for (const match of text.matchAll(/\b(resistors?|cells?|batter(?:y|ies)|ammeters?|voltmeters?)\b/gi)) {
    const word = match[1]!.toLowerCase();
    found.add(word.startsWith("resistor") ? "resistor" : word.startsWith("ammeter") ? "ammeter" : word.startsWith("voltmeter") ? "voltmeter" : "battery");
  }
  return [...found];
};
// Outside the source graph's component vocabulary. This bounds a circuit
// grammar; it does not select a chapter or a picture.
const extraComponent = /\b(capacitors?|inductors?|diodes?|transistors?|switch(?:es)?|motors?|bulbs?|galvanometers?|rheostats?)\b/i;
type CircuitFormula = string | { operator: "+" | "*" | "/"; parts: CircuitFormula[] };
function formulaKey(formula: CircuitFormula): string {
  if (typeof formula === "string") return formula;
  const parts = formula.parts.flatMap((part) => typeof part !== "string" && part.operator === formula.operator && formula.operator !== "/" ? part.parts : [part]);
  const keys = parts.map(formulaKey);
  return `${formula.operator}(${(formula.operator === "/" ? keys : keys.sort()).join(",")})`;
}
function treeFormula(tree: ResistorTree): CircuitFormula {
  if (tree.kind === "leaf") return `R${tree.index + 1}`;
  const parts = tree.children.map(treeFormula);
  if (tree.kind === "series") return { operator: "+", parts };
  // Product-over-sum of reciprocal branch products; reusable for 2–4 lanes.
  const product: CircuitFormula = { operator: "*", parts };
  const sum: CircuitFormula = { operator: "+", parts: parts.map((_, omitted) => {
    const included = parts.filter((__, index) => index !== omitted);
    return included.length === 1 ? included[0]! : { operator: "*", parts: included };
  }) };
  return { operator: "/", parts: [product, sum] };
}
const literalKey = (literal: Literal): string => `literal:${literal.dimension}:${readCircuitUnit(literal.unit)![1]}:${literal.value}`;
function expressionFormula(root: ExpressionNodeIR, source: StatedCircuitProblemSource, voltage: Literal): CircuitFormula | null {
  if (root.kind === "number") {
    const candidates = new Set([...source.resistorLiterals, voltage].filter(row => equal(row.value, root.value)).map(literalKey));
    if (source.identicalCount === root.value) candidates.add(`count:${source.identicalCount}`);
    // Repeated equal resistances share an operand class. Equal scalars of
    // different dimensions/prefixes/counts remain ambiguous and decline.
    return candidates.size === 1 ? [...candidates][0]! : null;
  }
  if (root.kind !== "binary" || !["+", "*", "/"].includes(root.operator)) return null;
  const left = expressionFormula(root.left, source, voltage), right = expressionFormula(root.right, source, voltage);
  return left && right ? { operator: root.operator as "+" | "*" | "/", parts: [left, right] } : null;
}

/** Numeric leaves carry their raw source units; structure supplies the law.
 * Equal literals do not pick an owner by value. All source facts/owners are
 * joined independently before this structural comparison is attempted.
 */
function sourceFormula(formula: CircuitFormula, source: StatedCircuitProblemSource, voltage: Literal): CircuitFormula {
  if (typeof formula === "string") return literalKey(formula === "V_source" ? voltage : source.resistorLiterals[Number(formula.slice(1)) - 1]!);
  return { ...formula, parts: formula.parts.map(part => sourceFormula(part, source, voltage)) };
}

function leafConnection(source: StatedCircuitProblemSource, kind: string, member: string): boolean {
  const visit = (tree: ResistorTree): boolean => tree.kind !== "leaf" &&
    ((tree.kind === kind && tree.children.some(node => node.kind === "leaf" && source.solution.resistors[node.index]!.id === member)) || tree.children.some(visit));
  return visit(source.semantics.tree);
}

function sourceFactOwners(fact: ProblemFact, question: string, source: StatedCircuitProblemSource): string[] | null {
  const { solution, semantics } = source;
  const statementAlias = fact.kind === "requested" ? fact.statement.replace(/\b(from|by) (cell|battery)\b/gi, "$1 the $2") : fact.statement;
  const legacy = bindCircuitFact({ ...fact, statement: statementAlias }, semantics, solution, readCircuitLiterals);
  if (legacy) return legacy;
  if (fact.kind !== "given") return null;
  const statement = normalized(fact.statement).replace(/[.?!]$/, "");
  const quantities = readCircuitLiterals(statement);
  let marked = statement;
  for (const row of [...quantities].reverse()) marked = marked.slice(0, row.start) + "@Q" + marked.slice(row.end);
  const evidence = fact.evidence;
  const members = source.resistorLiterals.flatMap((row, index) =>
    row.start >= evidence.start && row.end <= evidence.end ? [solution.resistors[index]!.id] : []);
  // A compact planner may call a positioned literal "series resistor" or
  // "parallel resistor"; its exact quote span, never scalar equality, joins it.
  const resistor = /^(?:(series|parallel) )?resistor (?:resistance is|is) @Q$/i.exec(marked);
  if (resistor && quantities.length === 1 && quantities[0]!.dimension === "resistance" && members.length === 1) {
    const member = members[0]!;
    const part = solution.resistors.find(row => row.id === member)!;
    if (!equal(quantities[0]!.si, part.resistance.value)) return null;
    if (resistor[1] && !leafConnection(source, resistor[1].toLowerCase(), member)) return null;
    return [member];
  }
  if (source.identicalCount) {
    const repeated = /^(two|three|four) (?:identical|equal) resistors each of @Q$/i.exec(marked);
    if (repeated && quantities.length === 1 && quantities[0]!.dimension === "resistance" &&
      { two: 2, three: 3, four: 4 }[repeated[1]!.toLowerCase() as "two" | "three" | "four"] === source.identicalCount &&
      members.length === source.identicalCount && members.every(id => equal(solution.resistors.find(row => row.id === id)!.resistance.value, quantities[0]!.si)) &&
      normalized(evidence.quote).replace(/[.?!]$/, "").toLowerCase() === statement.toLowerCase()) return members;
    const connected = /^resistors (?:are )?connected in (series|parallel) across (?:a|an|the)?\s*(?:battery|cell)$/i.exec(statement);
    const quote = normalized(evidence.quote).replace(/[.?!]$/, "");
    if (connected && semantics.tree.kind === connected[1]!.toLowerCase() &&
      new RegExp(`^connected in ${connected[1]} across (?:a|an|the) `, "i").test(quote)) {
      const vs = readCircuitLiterals(quote);
      const sourceText = question.slice(0, question.search(/\b(?:find|calculate|compute|determine)\b/i)).trim().replace(/[.?!]$/, "");
      if (sourceText.endsWith(quote) && vs.length === 1 && vs[0]!.dimension === "voltage" && equal(vs[0]!.si, solution.sourceVoltage!.value)) return [...solution.resistors.map(row => row.id), "battery"];
    }
  }
  return null;
}

/** Null is an honest decline: callers must retain all generic/full-IR gates. */
export function bindStatedCircuitProblem(question: string, rawProblem: unknown): CircuitProblemBinding | null {
  const validated = validateProblemIR(rawProblem, question);
  if (!validated.valid || !validated.problem || normalized(validated.problem.question) !== normalized(question)) return null;
  const problem = validated.problem;
  if (extraComponent.test(question)) return null;
  const source = readStatedCircuitProblemSource(question);
  if (!source) return null;
  const solution = source.solution;
  if (!solution.sourceVoltage || !solution.sourceCurrent) return null;
  const document = structuredClone(source.document);
  const symbols = document.constructions.filter((row) => row.operator === "symbol");
  const physical = symbols.map((row) => ({ id: row.outputs[0]!, role: row.inputs.symbol as Role }));
  if (physical.some((row) => !["resistor", "battery", "ammeter", "voltmeter"].includes(row.role))) return null;
  const hasMeter = physical.some((part) => part.role === "ammeter" || part.role === "voltmeter");
  // Multi-load meter placement needs an explicit branch-owner extension.
  if (hasMeter && solution.resistors.length !== 1) return null;
  if (physical.some((part) => part.role === "ammeter") &&
    !/\bammeter\s+(?:is\s+)?(?:connected\s+)?in series\b/i.test(question)) return null;
  if (physical.some((part) => part.role === "voltmeter") &&
    !/\bvoltmeter\s+(?:is\s+)?(?:connected\s+)?across\s+(?:the\s+)?resistor\b/i.test(question)) return null;
  if (/\bammeter\s+(?:is\s+)?(?:connected\s+)?in series with\s+(?:the\s+)?voltmeter\b/i.test(question)) return null;
  const literals = readCircuitLiterals(question);
  if ([...question.matchAll(new RegExp(STEM_NUMBER, "g"))].some((match) =>
    !literals.some((literal) => match.index! >= literal.start && match.index! < literal.end))) return null;
  const voltages = literals.filter((literal) => literal.dimension === "voltage");
  if (voltages.length !== 1 || !equal(voltages[0]!.si, solution.sourceVoltage.value)) return null;
  // Independent literal SI audit catches prefix/sign/extractor disagreement.
  const resistances = source.resistorLiterals;
  if (resistances.length !== solution.resistors.length || resistances.some((literal, index) => !equal(literal.si, solution.resistors[index]!.resistance.value))) return null;
  if (literals.some((literal) => !["resistance", "voltage"].includes(literal.dimension))) return null;
  const tree = source.semantics.tree;
  const resistanceFormula = treeFormula(tree);

  const result: CircuitProblemBinding = { problem, document, solution, entityBindings: [], expressionBindings: [], factBindings: [], requestBindings: [] };
  const facts = new Map(problem.facts.map((fact) => [fact.id, fact]));
  const used = new Set<string>();
  const quotes = (ids: string[]): string => ids.map((id) => facts.get(id)!.evidence.quote).join(" ");
  for (const fact of problem.facts) {
    const bound = sourceFactOwners(fact, question, source);
    if (!bound) return null;
    result.factBindings.push({ factId: fact.id, ownerIds: bound });
    if (fact.kind === "requested") {
      for (const target of readCircuitAsks(fact.evidence.quote, solution)!) result.requestBindings.push({ factId: fact.id, ...target });
    }
  }
  for (const entity of problem.entities) {
    const evidence = quotes(entity.evidenceFactIds);
    if (extraComponent.test(`${entity.label ?? ""} ${evidence}`)) return null;
    if (entity.kind === "other") {
      // A combination owns the actual source subtree, never a synthetic body.
      const kind = /^(series|parallel) combination\b/i.exec(entity.label ?? "")?.[1]?.toLowerCase();
      const groups = solution.groups.filter((group) => group.kind === kind && new RegExp(`\\b${kind}\\b`, "i").test(evidence));
      if (groups.length !== 1) return null;
      const group = groups[0]!;
      const namedMembers = [...(entity.label ?? "").matchAll(/\bR([1-4])\b/g)].map((match) => `R${match[1]}`);
      if (namedMembers.some((id) => !group.resistorIds.includes(id))) return null;
      const id = `circuit_group_${entity.id}`;
      if (document.entities.some((row) => row.id === id)) return null;
      document.entities.push({ id, kind: "group", role: entity.label ?? `${kind} circuit combination`, label: kind === "series" ? "Rs" : "Rp",
        semantic: { memberIds: [...group.resistorIds] } });
      document.annotations.push({ id: `${id}_label`, kind: "label", targetIds: [id],
        text: `${kind === "series" ? "Rs" : "Rp"}(${group.resistorIds.join(",")})=${group.resistance.value} Ω`,
        placementIntent: kind === "series" ? "north" : "south" });
      document.annotations.push({ id: `${id}_members`, kind: "enclose", targetIds: [...group.resistorIds] });
      result.entityBindings.push({ problemEntityId: entity.id, sceneEntityId: id, memberIds: [...group.resistorIds] });
      continue;
    }
    if (!["component", "body"].includes(entity.kind)) return null;
    const label = normalized(entity.label ?? "");
    const labelRoles = roles(label);
    if (labelRoles.length !== 1) return null;
    const role = labelRoles[0]!;
    // The symbol may use the battery glyph for a cell; its public body name
    // must nevertheless be the name actually supported by source evidence.
    const numbered = /^resistor ([1-4])$/i.exec(label);
    const alias = new RegExp(`^(?:(series|parallel) )?(?:${STEM_NUMBER}\\s+(?:Ω|ohms?)\\s+)?resistor$`, "i").exec(label);
    if (!normalized(evidence).toLowerCase().includes(label.toLowerCase()) &&
      !(role === "resistor" && (alias || (numbered && source.identicalCount)))) return null;
    const owners = new Set(result.factBindings.filter(row => entity.evidenceFactIds.includes(row.factId) && facts.get(row.factId)!.kind !== "requested").flatMap(row => row.ownerIds));
    const labelLiterals = readCircuitLiterals(label);
    const candidates = physical.filter(part => part.role === role && !used.has(part.id) && owners.has(part.id) &&
      (!numbered || part.id === `R${numbered[1]}`) &&
      (role !== "resistor" || labelLiterals.every(row => row.dimension === "resistance" && equal(row.si, solution.resistors.find(other => other.id === part.id)!.resistance.value))) &&
      (!alias?.[1] || leafConnection(source, alias[1]!.toLowerCase(), part.id)));
    if (candidates.length !== 1) return null;
    const part = candidates[0]!;
    used.add(part.id);
    const sceneEntity = document.entities.find((row) => row.id === part.id)!;
    sceneEntity.label = entity.label;
    sceneEntity.role = role;
    result.entityBindings.push({ problemEntityId: entity.id, sceneEntityId: part.id, memberIds: [part.id] });
  }
  // An incomplete IR cannot authorize silently omitted source components.
  if (physical.some((part) => !used.has(part.id))) return null;

  // Every typed source ask must be present in the full IR; identity is not
  // inferred from coincident scalar answers.
  for (const ask of source.semantics.asks) {
    if (!result.requestBindings.some(binding => binding.unit === ask.unit && binding.value === ask.value)) return null;
  }

  // Carry genuine physical quantities on their owners, including source voltage.
  for (const part of physical) {
    const resistor = solution.resistors.find((row) => row.id === part.id);
    const value = resistor?.resistance ?? (part.role === "battery" ? solution.sourceVoltage : undefined);
    if (!value) continue;
    const unit = resistor ? "ohm" : "V";
    const id = `circuit_source_${part.id}`;
    document.quantities.push({ id, symbol: resistor?.name ?? "V_source", value: value.value, unit });
    document.annotations.push({ id: `circuit_dimension_${part.id}`, kind: "label", targetIds: [part.id], quantityId: id,
      text: `${value.value} ${unit === "ohm" ? "Ω" : unit}` });
  }
  for (const expression of problem.expressions) {
    if (expression.valueType !== "scalar") return null;
    const evidence = quotes(expression.evidenceFactIds);
    const evidenceLiterals = readCircuitLiterals(evidence);
    const requests = problem.solveRequests.filter((request) => request.kind === "evaluate" && request.expressionId === expression.id);
    if (expression.root.kind === "number" && requests.length === 0) {
      if (evidenceLiterals.length !== 1 || !equal(expression.root.value, evidenceLiterals[0]!.value)) return null;
      const literal = evidenceLiterals[0]!;
      const evidenceOwners = new Set(result.factBindings.filter(row => expression.evidenceFactIds.includes(row.factId)).flatMap(row => row.ownerIds));
      const owners = literal.dimension === "resistance" ? solution.resistors.filter(part => evidenceOwners.has(part.id) && equal(part.resistance.value, literal.si)).map(part => part.id)
        : literal.dimension === "voltage" ? physical.filter(part => evidenceOwners.has(part.id) && part.role === "battery").map(part => part.id) : [];
      if (owners.length !== 1) return null;
      const id = `circuit_expression_${expression.id}`;
      // Raw literal units preserve the full IR's actual given-dimension obligation.
      document.quantities.push({ id, symbol: expression.id, value: literal.value, unit: literal.unit });
      result.expressionBindings.push({ expressionId: expression.id, sceneQuantityId: id, ownerId: owners[0]!, unit: literal.unit, value: literal.value });
    } else if (requests.length !== 1) return null;
  }
  for (const request of problem.solveRequests) {
    if (request.kind !== "evaluate" || !request.resultBinding) return null;
    const binding = request.resultBinding;
    const unit = readCircuitUnit(binding.unit);
    const requestFacts = binding.evidenceFactIds.map((id) => facts.get(id)!).filter((fact) => fact.kind === "requested");
    if (!unit || requestFacts.length !== 1) return null;
    const asks = readCircuitAsks(requestFacts[0]!.evidence.quote, solution);
    const asked = asks?.length === 1 ? asks[0] : undefined;
    const target = statedCircuitSymbolBinding(solution, unit[0], binding.symbol) ??
      (unit[0] === "current" && binding.symbol === "I" && asked?.owner === "battery" ? { owner: "battery", value: solution.sourceCurrent! } : undefined);
    if (!target) return null;
    if (!asked || readCircuitUnit(asked.unit)?.[0] !== unit[0] || asked.owner !== target.owner) return null;
    const expression = problem.expressions.find((row) => row.id === request.expressionId)!;
    const formula = expressionFormula(expression.root, source, voltages[0]!);
    const expectedFormula: CircuitFormula | null = unit[0] === "resistance" ? resistanceFormula
      : unit[0] === "current" ? { operator: "/", parts: ["V_source", resistanceFormula] } : null;
    if (!formula || !expectedFormula) return null;
    const expected = [sourceFormula(expectedFormula, source, voltages[0]!)];
    // R/n and n*R follow only from an explicit identical-load declaration.
    // The count is a source operand, never an invented resistance/current.
    if (source.identicalCount && tree.kind !== "leaf") {
      const reduced: CircuitFormula = { operator: tree.kind === "parallel" ? "/" : "*", parts: [
        literalKey(resistances[0]!), `count:${source.identicalCount}`,
      ] };
      expected.push(unit[0] === "resistance" ? reduced : { operator: "/", parts: [literalKey(voltages[0]!), reduced] });
    }
    if (!expected.some(row => formulaKey(formula) === formulaKey(row))) return null;
    const evidenceOwners = new Set(result.factBindings.filter(row => expression.evidenceFactIds.includes(row.factId) && facts.get(row.factId)!.kind === "given").flatMap(row => row.ownerIds));
    if (solution.resistors.some(row => !evidenceOwners.has(row.id)) || (unit[0] === "current" && !evidenceOwners.has("battery"))) return null;
    let value: number;
    try { value = evaluateMathExpression(expressionToSafeSource(expression.root), 0); } catch { return null; }
    if (!equal(value * unit[1], target.value.value)) return null;
    // Every literal leaf must come from the request's physical source evidence.
    const allowed = readCircuitLiterals(quotes(expression.evidenceFactIds)).map((literal) => literal.value);
    if (source.identicalCount && expression.evidenceFactIds.some(id => result.factBindings.find(row => row.factId === id)?.ownerIds.length === source.identicalCount)) allowed.push(source.identicalCount);
    const visit = (node: typeof expression.root): boolean => node.kind === "number" ? allowed.some((number) => equal(number, node.value))
      : node.kind === "binary" && ["+", "*", "/"].includes(node.operator) && visit(node.left) && visit(node.right);
    if (!visit(expression.root)) return null;
    const id = `circuit_expression_${expression.id}`;
    document.quantities.push({ id, symbol: binding.symbol, value, unit: binding.unit });
    result.expressionBindings.push({ expressionId: expression.id, sceneQuantityId: id, ownerId: target.owner, unit: binding.unit!, value });
  }
  // Unsupported constraints decline rather than disappearing behind a circuit exemption.
  for (const constraint of problem.constraints) {
    if (constraint.kind !== "connected") return null;
    if (constraint.entityIds.some((id) => !result.entityBindings.some((bound) => bound.problemEntityId === id))) return null;
    const owners = new Set(result.factBindings.filter(row => constraint.evidenceFactIds.includes(row.factId)).flatMap(row => row.ownerIds));
    if (constraint.entityIds.some(id => result.entityBindings.find(row => row.problemEntityId === id)!.memberIds.some(member => !owners.has(member)))) return null;
  }
  if (problem.representationIntents.some((intent) => intent.kind !== "network" && intent.kind !== "apparatus")) return null;
  for (const intent of problem.representationIntents) {
    const owners = new Set(result.factBindings.filter(row => intent.evidenceFactIds.includes(row.factId)).flatMap(row => row.ownerIds));
    if (intent.entityIds.some(id => result.entityBindings.find(row => row.problemEntityId === id)!.memberIds.some(member => !owners.has(member)))) return null;
  }
  for (const bound of result.entityBindings) {
    // A group is a semantic aggregate, not an independent drawable primitive.
    // Its exact source members, enclosure and attached value badge carry it.
    // Declare each physical member rather than an ownership entry the normal
    // structural compiler would remove from this virtual entity.
    for (const id of bound.memberIds.length ? bound.memberIds : [bound.sceneEntityId]) {
      if (!document.requiredEntityIds.includes(id)) document.requiredEntityIds.push(id);
    }
    if (!document.revealGroups.some((group) => group.entityIds.includes(bound.sceneEntityId))) document.revealGroups[0]!.entityIds.push(bound.sceneEntityId);
  }
  // Canonicalize only the independently rebuilt source program. Submitted
  // candidates still face exact comparison; they receive no repair authority.
  const canonical = validateSceneDocument(pruneDeadSceneEntities(structuredClone(document) as unknown as Record<string, unknown>)).document;
  if (!canonical) return null;
  result.document = canonical;
  return result;
}

/**
 * Compile/admission/restore seam: regenerate from whole source + full IR on
 * every call. Exact structural comparison deliberately declines foreign
 * layouts until the parent adds a separately proved topology correspondence.
 * Source and provenance fields confer no permission and are ignored.
 */
export function checkStatedCircuitProblemBinding(question: string, problem: unknown, candidate: SceneDocument): SceneIssue[] {
  const binding = bindStatedCircuitProblem(question, problem);
  const issue = (message: string): SceneIssue[] => [{ code: "circuit_problem_binding", severity: "fatal", message, path: "statedCircuitProblemBinding" }];
  if (!binding) return issue("Whole source circuit / full ProblemIR cannot be bound");
  const audit = (document: SceneDocument) => ({
    schemaVersion: document.schemaVersion,
    mode: document.visualDecision.mode,
    entities: document.entities.map(({ provenance: _provenance, ...entity }) => entity),
    constructions: document.constructions, quantities: document.quantities,
    assertions: document.assertions, relations: document.relations, annotations: document.annotations,
    requiredEntityIds: document.requiredEntityIds, revealGroups: document.revealGroups, teachingTimeline: document.teachingTimeline,
  });
  // JSONB changes object key order; array order remains part of the contract.
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return JSON.stringify(canonical(audit(binding.document))) === JSON.stringify(canonical(audit(candidate))) ? []
    : issue("Candidate identities, values, dimensions, topology or reveal differ from the independently source-bound circuit");
}
