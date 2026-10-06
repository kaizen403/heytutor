/** Parent-callable admission/proof seam. No registration, planner hints, or trust flags. */
import { validateTurnPlanV3, type TurnPlanV3 } from "../contracts/contractsV3";
import { snapshotMathSourceData } from "../compile/mathSourceData";
import { evaluateIndexedProgressionConstruction, indexedProgressionPrimitives } from "../compile/indexedProgressionGeometry";
import { parseMathExpression } from "../math/expression";
import { readFiniteProgressionSource, type FiniteProgressionSource, type ProgressionSourceAsk, type ProgressionSourceRole } from "../math/finiteProgressionSource";
import { expressionToSafeSource, validateProblemIR, type ExpressionNodeIR, type ProblemFact, type ProblemIR, type QuestionSourceEvidence } from "./problemIR";
import { SCENE_DOCUMENT_VERSION, type RenderPrimitive, type SceneDocument, type SceneIssue } from "../types";

export const NORMAL_PROGRESSION_PLACEMENT: ProgressionTablePlacement = Object.freeze({ origin: Object.freeze([0, 0] as const), displayScale: 1 });

export interface ProgressionTablePlacement { origin: readonly [number, number]; displayScale: number }
export interface ProgressionSourceBinding {
  ask: ProgressionSourceAsk;
  requestId: string;
  expressionId: string;
  quantityId: string;
  symbol: string;
  unit: string;
}
export type ProgressionSourceProgramResult =
  | { status: "declined"; reason: string }
  | { status: "ok"; source: FiniteProgressionSource; problem: ProblemIR; plan: TurnPlanV3; bindings: ProgressionSourceBinding[]; document: SceneDocument };

/** Structural equality deliberately does not collapse arithmetic to its answer. */
function astKey(root: ExpressionNodeIR): string {
  switch (root.kind) {
    case "number": return `number:${Object.is(root.value, -0) ? 0 : root.value}`;
    case "constant": return `constant:${root.name}`;
    case "variable": return `variable:${root.name}`;
    case "unary":
      if (root.operand.kind === "number") return astKey({ kind: "number", value: root.operator === "-" ? -root.operand.value : root.operand.value });
      return `unary:${root.operator}(${astKey(root.operand)})`;
    case "binary": return `binary:${root.operator}(${astKey(root.left)},${astKey(root.right)})`;
    case "call": return `call:${root.function}(${astKey(root.argument)})`;
  }
}
function fail(message: string): never { throw new Error(message); }
function dimensionless(unit: unknown): unit is string { return unit === "1" || unit === "dimensionless" || unit === "unitless" || unit === "scalar"; }
function covers(outer: QuestionSourceEvidence, inner: QuestionSourceEvidence): boolean { return outer.start <= inner.start && outer.end >= inner.end; }
function grounded(question: string, span: QuestionSourceEvidence): boolean { return question.slice(span.start, span.end) === span.quote && span.quote.length > 0; }
function valueOf(root: ExpressionNodeIR): number { return parseMathExpression(expressionToSafeSource(root)).evaluate(0); }
function close(a: number, b: number): boolean {
  return Number.isFinite(a) && (a === b || a !== 0 && b !== 0 && Math.sign(a) === Math.sign(b) && Math.abs(a - b) <= 32 * Number.EPSILON * Math.abs(b));
}
function exactText(ask: ProgressionSourceAsk): string { return ask.exact.denominator === "1" ? ask.exact.numerator : `${ask.exact.numerator}/${ask.exact.denominator}`; }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
/** Board notation only; the audited AST remains the authority. */
function expressionLabel(root: ExpressionNodeIR): string {
  switch (root.kind) {
    case "number": return String(root.value);
    case "constant": return root.name;
    case "variable": return root.name;
    case "unary": return `${root.operator}(${expressionLabel(root.operand)})`;
    case "binary": return `(${expressionLabel(root.left)}${root.operator}${expressionLabel(root.right)})`;
    case "call": return `${root.function}(${expressionLabel(root.argument)})`;
  }
}
function target(source: FiniteProgressionSource, role: ProgressionSourceRole): ExpressionNodeIR | null {
  if (role.role === "first") return { kind: "variable", name: `${source.sequence}_1` };
  if (role.role === "last") return {kind: "variable", name: `${source.sequence}_${Number(source.inputs.insertions) + 2}`};
  if (role.role === "insertions") return {kind: "variable", name: "m"};
  if (role.role === "parameter") return { kind: "variable", name: source.kind === "arithmetic" ? "d" : "r" };
  if (role.role === "model" && source.operation === "indexed_progression") return { kind: "variable", name: `${source.sequence}_n` };
  if (role.role === "cumulative_first") return { kind: "variable", name: `${source.cumulative!.sequence}_1` };
  if (role.role === "cumulative_relation") return { kind: "variable", name: `${source.sequence}_n` };
  if (role.role === "domain") return { kind: "variable", name: "n" };
  if (role.role.startsWith("observation_")) {
    const observation = (source.inputs.observations as Array<{ index: number }>)[Number(role.role.slice(12))]!;
    return { kind: "variable", name: `${source.sequence}_${observation.index}` };
  }
  return null;
}

/** Audits the FULL actual IR, retains it verbatim, and refuses uncovered obligations. */
export function finiteProgressionSourceProgram(question: string, rawProblem: unknown, rawPlan: unknown, placement: ProgressionTablePlacement = NORMAL_PROGRESSION_PLACEMENT): ProgressionSourceProgramResult {
  try {
    const captured = snapshotMathSourceData({ problem: rawProblem, plan: rawPlan, placement });
    const reading = readFiniteProgressionSource(question);
    if (reading.status !== "ok") return reading;
    const source = reading.source;
    const validation = validateProblemIR(captured.problem, question);
    if (!validation.valid || !validation.problem || validation.problem.question !== question) fail(`full ProblemIR invalid: ${validation.issues.map((issue) => issue.code).join(",")}`);
    const planValidation = validateTurnPlanV3(captured.plan, question);
    if (!planValidation.valid || !planValidation.plan) fail(`whole actual TurnPlan invalid: ${planValidation.issues.map(issue => issue.code).join(",")}`);
    const problem = validation.problem, plan = planValidation.plan;
    const fields = (value: object, allowed: string[]) => { if (Object.keys(value).some(key => !allowed.includes(key))) fail("uncovered actual IR/Plan field"); };
    // Preserve the caller's complete profile; reject unmodeled fields instead
    // of projecting it to the few arrays this bounded source understands.
    fields(problem, ["schemaVersion", "id", "question", "facts", "entities", "expressions", "constraints", "representationIntents", "solveRequests"]);
    problem.facts.forEach(fact => { fields(fact, ["id", "kind", "statement", "evidence"]); fields(fact.evidence, ["source", "start", "end", "quote"]); });
    problem.entities.forEach(entity => fields(entity, ["id", "kind", "label", "evidenceFactIds"]));
    const auditNodeFields = (node: ExpressionNodeIR): void => {
      switch (node.kind) {
        case "number": fields(node, ["kind", "value"]); break;
        case "constant": case "variable": fields(node, ["kind", "name"]); break;
        case "unary": fields(node, ["kind", "operator", "operand"]); auditNodeFields(node.operand); break;
        case "binary": fields(node, ["kind", "operator", "left", "right"]); auditNodeFields(node.left); auditNodeFields(node.right); break;
        case "call": fields(node, ["kind", "function", "argument"]); auditNodeFields(node.argument); break;
      }
    };
    problem.expressions.forEach(expression => { fields(expression, ["id", "valueType", "root", "evidenceFactIds"]); auditNodeFields(expression.root); });
    problem.constraints.forEach(constraint => fields(constraint, constraint.kind === "equation" || constraint.kind === "inequality"
      ? ["id", "kind", "leftExpressionId", "rightExpressionId", "evidenceFactIds", ...(constraint.kind === "inequality" ? ["relation"] : [])]
      : ["id", "kind", "entityIds", "evidenceFactIds"]));
    problem.representationIntents.forEach(intent => fields(intent, ["id", "kind", "entityIds", "evidenceFactIds"]));
    problem.solveRequests.forEach(request => {
      if (request.kind !== "evaluate" || !request.resultBinding) fail("every request must bind a bounded source evaluation");
      fields(request, ["id", "kind", "expressionId", "resultBinding"]);
      fields(request.resultBinding, ["turnPlanQuantityId", "symbol", "unit", "evidenceFactIds"]);
    });
    fields(plan, ["schemaVersion", "question", "givens", "unknowns", "derived", "qualitativeClaims", "lawIds", "assumptions", "visualRequirement", "teachingSequenceHints"]);
    if (plan.teachingSequenceHints !== undefined && (!Array.isArray(plan.teachingSequenceHints) || plan.teachingSequenceHints.some(hint => typeof hint !== "string" || !hint.trim()))) fail("invalid actual Plan teaching hints");
    for (const list of [plan.givens, plan.derived, plan.unknowns]) {
      if (new Set(list.map(quantity => quantity.id)).size !== list.length) fail("duplicate IDs within Plan role");
      list.forEach(quantity => fields(quantity, list === plan.unknowns ? ["id", "symbol", "unit"] : ["id", "symbol", "unit", "value", "provenance", "sign", "sourceText", "dependsOn", "uncertainty"]));
    }
    if (plan.givens.some(given => [...plan.unknowns, ...plan.derived].some(quantity => quantity.id === given.id))) fail("a given cannot also be a requested result");
    for (const unknown of plan.unknowns) {
      const derived = plan.derived.find(quantity => quantity.id === unknown.id);
      if (derived && (derived.symbol !== unknown.symbol || derived.unit !== unknown.unit)) fail("same-ID unknown/derived roles require identical symbol/unit");
    }
    if (plan.schemaVersion !== "turn-plan/v3" || plan.question !== question || plan.visualRequirement === "none") fail("actual source TurnPlan and visual requirement are required");
    if (plan.assumptions.length || plan.qualitativeClaims.length) fail("uncovered plan assumptions/qualitative claims");
    const allQuantities = [...plan.givens, ...plan.derived, ...plan.unknowns];
    if (allQuantities.some((quantity) => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(quantity.id) || !dimensionless(quantity.unit) || !quantity.symbol.trim())) fail("every actual plan quantity requires a unique ID, symbol and explicit dimensionless unit");
    const facts = new Map(problem.facts.map((fact) => [fact.id, fact]));
    const refs = (ids: string[]): ProblemFact[] => ids.map((id) => facts.get(id) ?? fail("missing source fact"));
    const factCovers = (ids: string[], role: ProgressionSourceRole, kind?: ProblemFact["kind"]): boolean => refs(ids).some((fact) => (!kind || fact.kind === kind) && covers(fact.evidence, role.evidence));
    const askStart = question.lastIndexOf("Find ");
    for (const fact of problem.facts) {
      if (!grounded(question, fact.evidence)) fail("IR fact span must address its actual source quote");
      if (fact.kind === "assumption") fail("IR assumptions outside explicit progression source are unsupported");
      if (fact.kind === "requested" ? fact.evidence.start < askStart || !source.asks.some((ask) => covers(fact.evidence, ask.evidence)) : fact.evidence.end > askStart || !source.roles.some((role) => covers(fact.evidence, role.evidence))) fail("uncovered full-IR fact role");
    }
    if (source.roles.some((role) => !problem.facts.some((fact) => fact.kind === "given" && covers(fact.evidence, role.evidence)))) fail("full IR omits a complete given/model/relation role");
    if (source.asks.some((ask) => !problem.facts.some((fact) => fact.kind === "requested" && covers(fact.evidence, ask.evidence)))) fail("full IR omits a requested source ask");
    const sequenceNames = [source.sequence, source.cumulative?.sequence].filter((name): name is string => Boolean(name));
    for (const entity of problem.entities) {
      const roleName = entity.label === `${source.sequence}_n` ? "model" : "cumulative_relation";
      if (entity.kind !== "other" && entity.kind !== "state" || !sequenceNames.some((name) => entity.label === `${name}_n`) || !refs(entity.evidenceFactIds).every((fact) => fact.kind === "given") || !source.roles.some((role) => role.role === roleName && factCovers(entity.evidenceFactIds, role, "given"))) fail("uncovered full-IR entity or source sequence identity");
    }
    if (sequenceNames.some((name) => problem.entities.filter((entity) => entity.label === `${name}_n`).length !== 1)) fail("each source sequence requires one actual IR entity");
    for (const intent of problem.representationIntents) {
      if (intent.kind !== "conceptual" || !intent.entityIds.length || !refs(intent.evidenceFactIds).every((fact) => fact.kind === "given" || fact.kind === "requested")) fail("only an honest discrete conceptual table intent is supported; no interpolating graph");
    }
    const expressionMap = new Map(problem.expressions.map((expression) => [expression.id, expression]));
    const constrained = new Set(problem.constraints.flatMap((constraint) => constraint.kind === "equation" || constraint.kind === "inequality" ? [constraint.leftExpressionId, constraint.rightExpressionId] : []));
    for (const constraint of problem.constraints) {
      if (constraint.kind === "inequality") {
        const domain = source.roles.find((role) => role.role === "domain");
        const left = expressionMap.get(constraint.leftExpressionId)!, right = expressionMap.get(constraint.rightExpressionId)!;
        if (!domain || !factCovers(constraint.evidenceFactIds, domain, "given") || !factCovers(left.evidenceFactIds, domain, "given") || !factCovers(right.evidenceFactIds, domain, "given") || !(constraint.relation === ">=" && astKey(left.root) === "variable:n" && astKey(right.root) === "number:1" || constraint.relation === "<=" && astKey(left.root) === "number:1" && astKey(right.root) === "variable:n")) fail("uncovered full-IR index domain inequality");
        continue;
      }
      if (constraint.kind !== "equation") fail("uncovered full-IR constraint");
      const left = expressionMap.get(constraint.leftExpressionId)!, right = expressionMap.get(constraint.rightExpressionId)!;
      const valid = source.roles.some((role) => {
        if (role.role === "domain") return false;
        const expected = target(source, role);
        return expected && factCovers(constraint.evidenceFactIds, role, "given") && factCovers(left.evidenceFactIds, role, "given") && factCovers(right.evidenceFactIds, role, "given") && (astKey(left.root) === astKey(expected) && astKey(right.root) === astKey(role.root) || astKey(right.root) === astKey(expected) && astKey(left.root) === astKey(role.root));
      });
      if (!valid) fail("constraint AST/roles disagree with source; same numeric answer is insufficient");
    }
    const bindings: ProgressionSourceBinding[] = [];
    for (const request of problem.solveRequests) {
      if (request.kind !== "evaluate" || !request.resultBinding) fail("every bounded source ask requires an actual evaluate request and binding");
      const expression = expressionMap.get(request.expressionId)!;
      const candidates = source.asks.filter((ask) => astKey(ask.root) === astKey(expression.root) && factCovers(expression.evidenceFactIds, ask, "requested") && factCovers(request.resultBinding!.evidenceFactIds, ask, "requested"));
      if (candidates.length !== 1) fail("solve AST must prove its exact source ask, not coincide with its answer");
      const ask = candidates[0]!, binding = request.resultBinding;
      const quantity = [...plan.derived, ...plan.unknowns].find((item) => item.id === binding.turnPlanQuantityId);
      if (!quantity || binding.symbol !== quantity.symbol || binding.unit !== quantity.unit) fail("result binding must address the actual requested plan quantity ID/symbol/unit");
      if ("value" in quantity && (typeof quantity.value !== "number" || !close(quantity.value, ask.value))) fail("stale requested plan scalar");
      if (!close(valueOf(expression.root), ask.value)) fail("independent audited AST and exact aggregation disagree");
      bindings.push({ ask, requestId: request.id, expressionId: expression.id, quantityId: quantity.id, symbol: quantity.symbol, unit: quantity.unit! });
    }
    if (source.asks.length !== bindings.length || source.asks.some((ask) => bindings.filter((binding) => binding.ask === ask).length !== 1) || new Set(bindings.map((binding) => binding.quantityId)).size !== bindings.length || [...plan.derived, ...plan.unknowns].some((quantity) => !bindings.some((binding) => binding.quantityId === quantity.id))) fail("complete one-to-one source asks, solve requests and plan quantities are required");
    for (const expression of problem.expressions) {
      const request = bindings.find((binding) => binding.expressionId === expression.id);
      if (request) {
        if (expression.valueType !== "scalar") fail("requested value must be scalar");
        continue;
      }
      if (!source.roles.some((role) => factCovers(expression.evidenceFactIds, role, "given") && (astKey(role.root) === astKey(expression.root) || constrained.has(expression.id) && target(source, role) !== null && astKey(target(source, role)!) === astKey(expression.root)))) fail("uncovered full-IR expression");
    }
    for (const given of plan.givens) {
      const roles = source.roles.filter((role) => role.root.kind !== "variable" && role.role !== "model" && given.sourceText === role.evidence.quote);
      if (roles.length !== 1 || !close(given.value, valueOf(roles[0]!.root)) || given.provenance !== "given" || given.symbol !== (target(source, roles[0]!) as {name?: string} | null)?.name) fail("plan given must retain its unique source role and value");
    }
    if ([...plan.givens, ...plan.derived].some(quantity => quantity.uncertainty !== undefined && quantity.uncertainty !== 0)) fail("exact finite progression cannot carry uncertain Plan scalars");
    const document = makeDocument(source, problem, plan, bindings, captured.placement);
    return { status: "ok", source, problem, plan, bindings, document };
  } catch (error) { return { status: "declined", reason: error instanceof Error ? error.message : "invalid source admission" }; }
}

function makeDocument(source: FiniteProgressionSource, problem: ProblemIR, plan: TurnPlanV3, bindings: ProgressionSourceBinding[], placement: ProgressionTablePlacement): SceneDocument {
  const geometry = evaluateIndexedProgressionConstruction(source.operation, { ...source.inputs, ...(source.operation !== "progression_insert" ? { indices: source.geometry.indexedProgression.solutions[0]!.terms.map((term) => term.index) } : {}), origin: placement.origin, displayScale: placement.displayScale }, { scalar() { fail("source program has no planner scalar dependency"); } })[0]!;
  indexedProgressionPrimitives(geometry, "progression", "terms");
  const document: SceneDocument = {
    schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "finite source-grounded index/value table; nonmetric" },
    source: { question: source.question, progressionSourceVersion: "finite-progression-source/v1", problemIR: problem, turnPlan: plan },
    quantities: [...plan.givens.map((given) => ({ ...given })), ...bindings.map((binding) => ({ id: binding.quantityId, symbol: binding.symbol, unit: binding.unit, value: binding.ask.value, exactValue: binding.ask.exact }))],
    entities: [{ id: "progression", kind: "indexed_progression", role: `source ${source.sequence}_n discrete index/value table`, label: `${source.sequence}_n`, semantic: { nonmetric: true, sequence: source.sequence } }],
    constructions: [{ id: "make_progression", operator: source.operation, inputs: { ...source.inputs, ...(source.operation !== "progression_insert" ? { indices: geometry.indexedProgression.solutions[0]!.terms.map((term) => term.index) } : {}), origin: placement.origin, displayScale: placement.displayScale }, outputs: ["progression"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["progression"],
    revealGroups: [{ id: "terms", entityIds: ["progression"], dependsOn: [], narrationCue: `show ${source.sequence}_n at its finite indices; table spacing is nonmetric` }],
    teachingTimeline: [{ id: "reveal_terms", action: "reveal", targetId: "terms", dependsOn: [], narrationIntent: "show the source progression table" }],
  };
  const tableBottom = Math.max(...indexedProgressionPrimitives(geometry, "progression", "terms").map(primitive => (placement.origin[1] - primitive.points[0]!.y) / placement.displayScale));
  const summaries: Array<{id: string; text: string; provenance: Record<string, unknown>}> = [];
  if (source.cumulative) summaries.push({id: "cumulative_sequence", text: `${source.cumulative.sequence}_n`, provenance: {problemEntityId: problem.entities.find(entity => entity.label === `${source.cumulative!.sequence}_n`)!.id}});
  source.roles.forEach((role, i) => {
    try {
      const value = valueOf(role.root);
      const given = plan.givens.find(quantity => quantity.sourceText === role.evidence.quote);
      const expressionIds = problem.expressions.filter(expression => astKey(expression.root) === astKey(role.root) && expression.evidenceFactIds.some(id => covers(problem.facts.find(fact => fact.id === id)!.evidence, role.evidence))).map(expression => expression.id);
      const name = target(source, role)?.kind === "variable" ? (target(source, role) as {name: string}).name : role.role;
      summaries.push({id: `source_role_${i}`, text: `${name}${role.role === "domain" ? ">=" : "="}${expressionLabel(role.root)}`, provenance: {sourceRole: role.role, sourceEvidence: role.evidence, expressionIds, value, ...(given ? {quantityId: given.id, unit: given.unit} : {}), nonmetric: true}});
    } catch {
      if (role.role === "cumulative_relation") summaries.push({id: `source_role_${i}`, text: `${source.cumulative!.sequence}_(n+1)-${source.cumulative!.sequence}_n=${source.sequence}_n`, provenance: {sourceRole: role.role, sourceEvidence: role.evidence, nonmetric: true}});

    }
  });
  summaries.forEach((summary, i) => {
    const anchor = `${summary.id}_anchor`;
    document.entities.push({id: summary.id, kind: "label", role: "source sequence/given role", label: summary.text, provenance: {...summary.provenance, pinLabel: true}});
    document.constructions.push({id: `make_${anchor}`, operator: "point", inputs: {x: placement.origin[0], y: placement.origin[1] - (tableBottom + 5 + i * 3) * placement.displayScale}, outputs: [anchor]}, {id: `make_${summary.id}`, operator: "label", inputs: {target: anchor, text: summary.text}, outputs: [summary.id]});
    document.requiredEntityIds.push(summary.id);
    document.revealGroups[0]!.entityIds.push(summary.id);
  });
  bindings.forEach((binding, i) => {
    const id = `result_${i}`, anchor = `result_anchor_${i}`;
    const sourceSymbol = binding.ask.kind === "sum" ? `S_${binding.ask.index}(${source.cumulative?.sequence ?? source.sequence})` : binding.ask.symbol;
    const text = `${sourceSymbol}=${exactText(binding.ask)}`;
    if (text.length > 80) fail("requested bound label exceeds display capacity");
    document.entities.push({ id, kind: "label", role: `requested ${binding.ask.symbol}`, label: text, provenance: { quantityId: binding.quantityId, symbol: binding.symbol, sourceSymbol: binding.ask.symbol, unit: binding.unit, requestId: binding.requestId, sourceEvidence: binding.ask.evidence, nonmetric: true, pinLabel: true } });
    document.constructions.push({ id: `make_${anchor}`, operator: "point", inputs: { x: placement.origin[0], y: placement.origin[1] - (tableBottom + 7 + (summaries.length + i) * 3) * placement.displayScale }, outputs: [anchor] }, { id: `make_${id}`, operator: "label", inputs: { target: anchor, text }, outputs: [id] });
    document.requiredEntityIds.push(id);
  });
  document.revealGroups.push({ id: "results", entityIds: bindings.map((_, i) => `result_${i}`), dependsOn: ["terms"], narrationCue: "show every requested term and finite sum with its source bound quantity" });
  document.teachingTimeline.push({ id: "reveal_results", action: "reveal", targetId: "results", dependsOn: ["reveal_terms"], narrationIntent: "reveal all source requested results" });
  // The normal validator materializes undeclared point outputs as solver-only
  // helper entities. Emit that same canonical order so repeated validation and
  // saved/read boundaries compare the complete document without a waiver.
  document.constructions.filter(construction => construction.operator === "point").forEach(construction =>
    document.entities.push({id: construction.outputs[0]!, kind: "point", role: "construction helper"}));
  return document;
}

/** Use identically at compiler/live/save/read/restore; caller supplies trusted source/IR/plan. */
export function validateFiniteProgressionSourceDocument(document: SceneDocument, question: string, problem: unknown, plan: unknown, placement: ProgressionTablePlacement = NORMAL_PROGRESSION_PLACEMENT): SceneIssue[] {
  try {
    const captured = snapshotMathSourceData(document);
    const admission = finiteProgressionSourceProgram(question, problem, plan, placement);
    if (admission.status !== "ok") fail(admission.reason);
    if (stable(captured) !== stable(admission.document)) fail("scene payload differs from source regeneration; all marks, labels, bindings, required entities and reveal obligations must survive");
    return [];
  } catch (error) { return [{ code: "invalid_finite_progression_source", severity: "fatal", path: "source", message: error instanceof Error ? error.message : "progression source proof failed" }]; }
}

/** Delegates table ink, retaining actual source sequence names and requested quantity IDs. */
export function finiteProgressionSourceTablePrimitives(document: SceneDocument, question: string, problem: unknown, plan: unknown, placement: ProgressionTablePlacement = NORMAL_PROGRESSION_PLACEMENT): RenderPrimitive[] {
  const issues = validateFiniteProgressionSourceDocument(document, question, problem, plan, placement);
  if (issues.length) fail(issues[0]!.message);
  const admission = finiteProgressionSourceProgram(question, problem, plan, placement);
  if (admission.status !== "ok") fail(admission.reason);
  const construction = admission.document.constructions[0]!;
  const geometry = evaluateIndexedProgressionConstruction(construction.operator, construction.inputs, { scalar() { fail("source table cannot depend on planner scalars"); } })[0]!;
  return indexedProgressionPrimitives(geometry, "progression", "terms").map((primitive) => {
    const binding = admission.source.cumulative ? undefined : admission.bindings.find(({ ask }) => (primitive.id.includes("_value_") || primitive.id.includes("_point_")) && ask.kind === "term" && primitive.provenance?.index === ask.index && primitive.id.startsWith(`progression_${ask.branch}_`));
    return { ...primitive, ...(primitive.text === "t_n" ? { text: `${admission.source.sequence}_n` } : primitive.id.endsWith("_parameters") ? {text: primitive.text!.replace(/^a=/, `${admission.source.sequence}_1=`)} : {}), provenance: { ...primitive.provenance, sourceSequence: admission.source.sequence, ...(binding ? { quantityId: binding.quantityId, unit: binding.unit, requestId: binding.requestId } : {}) } };
  });
}
