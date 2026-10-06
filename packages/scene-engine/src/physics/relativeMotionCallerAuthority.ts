import { relativeMotionDocument } from "../synthesize/relativeMotionScene";
import { snapshotMathSourceData } from "../compile/mathSourceData";
import { validateTurnPlanV3, type TurnPlanV3 } from "../contracts/contractsV3";
import { validateProblemIR, type ProblemFact, type ProblemIR } from "../ir/problemIR";
import type { SceneDocument, SceneIssue } from "../types";
import { motionSymbolKey, motionUnitFactor, relativeMotionBindings, type MotionDimension } from "./motionPlanAgreement";
import { motionRationalNumber, relativeMotionSource, relativeMotionCue, relativeMotionSourceEntityBindings, type RelativeMotionSource } from "./relativeMotionSource";
import { evaluateMotionArithmetic, motionFormulations, motionRoleFormula, sameDimensionalMotionFormula, validateMotionArithmeticShape, motionConstant, motionOperation, motionVariable, sameMotionFormula, type MotionFormula } from "./relativeMotionAlgebra";
import { proveMotionProse, proveMotionQuantityText } from "./relativeMotionProse";
export interface MotionRole {
  key: string;
  dimension: MotionDimension;
  si: number;
  formula: MotionFormula;
  /** Primitive premises needed by this role's source formulation. */
  bases: string[];
  sourceText?: string;
  signed?: boolean;
}
export interface MotionCallerProgramme {
  source: RelativeMotionSource;
  roles: Map<string, MotionRole>;
  bases: MotionRole[];
}
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const actors = (s: RelativeMotionSource) => [s.subject, s.reference, ...(s.observer ? [s.observer] : [])];
/** The owning source programme supplies roles and equations, independently of
 * the caller. No caller node or assertion is removed or replaced. */
export function motionCallerProgramme(source: RelativeMotionSource): MotionCallerProgramme {
  const roles = new Map<string, MotionRole>();
  const bases: MotionRole[] = [];
  const base = (key: string, dimension: MotionDimension, si: number, sourceText: string) => {
    const role = { key, dimension, si, formula: motionVariable(key), bases: [key], sourceText, signed: dimension !== "velocity" };
    roles.set(key, role);
    bases.push(role);
    return role;
  };
  for (const actor of actors(source)) {
    base(`v${actor.name.toLowerCase()}`, "velocity", motionRationalNumber(actor.v), actor.vSource);
    base(`x${actor.name.toLowerCase()}`, "length", motionRationalNumber(actor.x0), actor.x0Source);
  }
  const a = source.subject.name.toLowerCase(), b = source.reference.name.toLowerCase();
  const va = roles.get(`v${a}`)!, vb = roles.get(`v${b}`)!;
  const xa = roles.get(`x${a}`)!, xb = roles.get(`x${b}`)!;
  const gap = motionRationalNumber(source.reference.x0) - motionRationalNumber(source.subject.x0);
  // Conventional sources explicitly state a gap; stated positions derive it.
  const gapFormula = motionOperation("-", xb.formula, xa.formula);
  const gapRole: MotionRole = { key: "gap", dimension: "length", si: Math.abs(gap), formula: gap < 0 ? motionOperation("*", motionConstant(-1), gapFormula) : gapFormula, bases: [xa.key, xb.key], sourceText: source.reference.x0Source };
  if (source.frameEvidence === "conventional") {
    gapRole.formula = motionVariable("gap");
    gapRole.bases = ["gap"];
    bases.push(gapRole);
  }
  for (const key of ["gap", "d0", "separation", "initialgap"])
    roles.set(key, gapRole);
  const relative = motionOperation("-", va.formula, vb.formula);
  const time = source.encounter.kind === "future" || source.encounter.kind === "initial"
    ? motionOperation("/", source.frameEvidence === "conventional" ? (gap < 0 ? motionOperation("*", motionConstant(-1), gapRole.formula) : gapRole.formula) : gapFormula, relative) : null;
  for (const [key, value] of relativeMotionBindings(source)) {
    if (roles.has(key))
      continue;
    let formula: MotionFormula, dependencies: string[];
    const velocityPair = /^v([a-z])([a-z])$/.exec(key);
    if (velocityPair && roles.has(`v${velocityPair[1]}`) && roles.has(`v${velocityPair[2]}`)) {
      const first = roles.get(`v${velocityPair[1]}`)!, second = roles.get(`v${velocityPair[2]}`)!;
      formula = motionOperation("-", first.formula, second.formula);
      dependencies = [first.key, second.key];
    }
    else if (["vrel", "vrelative"].includes(key)) {
      formula = relative;
      dependencies = [va.key, vb.key];
    }
    else if (/^v[a-z]ms$/.test(key)) {
      const role = roles.get(key.slice(0, 2))!;
      formula = role.formula;
      dependencies = role.bases;
    }
    else if (time && value.dimension === "time") {
      formula = time;
      dependencies = [...gapRole.bases, va.key, vb.key];
    }
    else if (time && /^(?:d|s|distance)[a-z]$/.test(key)) {
      const name = key.at(-1)!;
      const velocity = roles.get(`v${name}`)!;
      formula = motionOperation("*", motionRationalNumber(actors(source).find(actor => actor.name.toLowerCase() === name)!.v) < 0 ? motionOperation("*", motionConstant(-1), velocity.formula) : velocity.formula, time);
      dependencies = [...gapRole.bases, va.key, vb.key];
    }
    else if (time && value.dimension === "length") {
      formula = motionOperation("+", xa.formula, motionOperation("*", va.formula, time));
      dependencies = [xa.key, ...gapRole.bases, va.key, vb.key];
    }
    else
      continue;
    roles.set(key, { key, dimension: value.dimension, si: value.si, formula, bases: [...new Set(dependencies)], signed: value.signed });
  }
  for (const actor of actors(source)) {
    const name = actor.name.toLowerCase();
    const role = roles.get(`x${name}`)!;
    for (const key of [`x${name}0`, `x0${name}`])
      roles.set(key, role);
  }
  return { source, roles, bases };
}
function contains(haystack: string, needle: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.;,]+$/g, "");
  return Boolean(norm(needle)) && norm(haystack).includes(norm(needle));
}
function factBases(fact: ProblemFact, programme: MotionCallerProgramme): string[] {
  if (fact.kind !== "given")
    return [];
  const quote = fact.evidence.quote;
  const measurements = [...quote.matchAll(/([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(km\/hr|km\/h|kmph|m\/s|km|m)(?![\w/])/gi)];
  const named = new Set([...fact.statement.matchAll(/\b(?:train |point |body |observer )?([A-Z])\b/g)].map(match => match[1]!.toLowerCase()));
  return programme.bases.filter(role => {
    if (!role.sourceText || !(contains(role.sourceText, quote) || contains(quote, role.sourceText)))
      return false;
    if (named.size === 1 && /^[vx][a-z]$/.test(role.key) && !named.has(role.key.slice(1)))
      return false;
    return measurements.some(match => {
      const unit = motionUnitFactor(match[2]);
      const value = Number(match[1]) * (unit?.factor ?? NaN);
      return unit?.dimension === role.dimension && (near(value, role.si) || role.dimension === "velocity" && near(value, Math.abs(role.si)));
    });
  }).map(role => role.key);
}
function queryRoles(fact: ProblemFact, programme: MotionCallerProgramme): MotionRole[] {
  if (fact.kind !== "requested")
    return [];
  const quote = fact.evidence.quote;
  const keys: string[] = [];
  if (/\b(?:time|how long|when|encounter|meet|catch|overtak)/i.test(quote) && programme.source.requests.encounter)
    keys.push("t");
  for (const actor of actors(programme.source))
    if (new RegExp(`(?:distance\\s+travelled\\s+by\\s+(?:train\\s+)?${actor.name}|${actor.name}\\s+travel(?:s|led))`, "i").test(quote) && programme.source.requests.travelActors?.includes(actor.name))
      keys.push(`d${actor.name.toLowerCase()}`);
  if (/relative\s+(?:velocity|speed)|with\s+respect\s+to/i.test(quote) && programme.source.requests.relativeVelocity)
    keys.push(`v${programme.source.subject.name.toLowerCase()}${programme.source.reference.name.toLowerCase()}`);
  return keys.flatMap(key => programme.roles.get(key) ? [programme.roles.get(key)!] : []);
}
function closedFields(value: object, fields: readonly string[]): void {
  if (Object.keys(value).some((key) => !fields.includes(key)))
    throw Error("unsupported original own fields");
}
/** Original fields are inspected before any semantic candidate shortcuts. */
function checkOriginalFields(plan: TurnPlanV3, problem: ProblemIR): void {
  closedFields(plan, [
    "schemaVersion",
    "question",
    "givens",
    "derived",
    "unknowns",
    "qualitativeClaims",
    "lawIds",
    "assumptions",
    "visualRequirement",
    "teachingSequenceHints",
  ]);
  for (const row of [...plan.givens, ...plan.derived])
    closedFields(row, [
      "id",
      "symbol",
      "value",
      "unit",
      "sign",
      "sourceText",
      "provenance",
      "dependsOn",
      "uncertainty",
    ]);
  for (const row of plan.unknowns) closedFields(row, ["id", "symbol", "unit"]);
  for (const claim of plan.qualitativeClaims)
    closedFields(claim, [
      "id",
      "claim",
      "expected",
      "relatedQuantityIds",
      "relatedEntityHints",
    ]);
  closedFields(problem, [
    "schemaVersion",
    "id",
    "question",
    "facts",
    "entities",
    "expressions",
    "constraints",
    "representationIntents",
    "solveRequests",
  ]);
  for (const fact of problem.facts) {
    closedFields(fact, ["id", "kind", "statement", "evidence"]);
    closedFields(fact.evidence, ["source", "start", "end", "quote"]);
  }
  for (const entity of problem.entities)
    closedFields(entity, ["id", "kind", "label", "evidenceFactIds"]);
  for (const intent of problem.representationIntents)
    closedFields(intent, ["id", "kind", "entityIds", "evidenceFactIds"]);
  for (const expression of problem.expressions) {
    closedFields(expression, ["id", "valueType", "root", "evidenceFactIds"]);
    validateMotionArithmeticShape(expression.root);
  }
  for (const request of problem.solveRequests) {
    closedFields(request, ["id", "kind", "expressionId", "resultBinding"]);
    if (request.resultBinding)
      closedFields(request.resultBinding, [
        "turnPlanQuantityId",
        "symbol",
        "unit",
        "evidenceFactIds",
      ]);
  }
}
function checkPlan(plan: TurnPlanV3, programme: MotionCallerProgramme): void {
  const rows = [...plan.givens, ...plan.derived];
  const byId = new Map(rows.map(row => [row.id, row]));
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id))
      throw Error("cyclic original Plan dependencies");
    if (visited.has(id))
      return;
    const row = byId.get(id);
    if (!row)
      throw Error("unproved original Plan dependency");
    visiting.add(id);
    for (const dependency of row.dependsOn ?? [])
      visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const row of rows) {
    visit(row.id);
    if (row.uncertainty !== undefined) throw Error("source does not support original uncertainty obligations");
    const role = programme.roles.get(motionSymbolKey(row.symbol)), unit = motionUnitFactor(row.unit);
    const expected = role && !role.signed && role.dimension === "velocity" && row.value > 0 ? Math.abs(role.si) : role?.si;
    if (!role || !unit || unit.dimension !== role.dimension || !near(row.value * unit.factor, expected!))
      throw Error(`unproved Plan quantity ${row.id}`);
    if (row.sign && row.sign !== "unsigned" && (row.sign === "positive" ? role.si <= 0 : row.sign === "negative" ? role.si >= 0 : !near(role.si, 0)))
      throw Error(`declared sign contradicts source role ${row.id}`);
    if (row.sourceText !== undefined && (typeof row.sourceText !== "string" || !proveMotionQuantityText(row.sourceText, role, programme)))
      throw Error(`unproved quantity sourceText ${row.id}`);
    if (row.dependsOn?.length) {
      const dependencies = row.dependsOn.map(id => programme.roles.get(motionSymbolKey(byId.get(id)!.symbol)));
      if (dependencies.some(dependency => !dependency || dependency.bases.some(base => !role.bases.includes(base))) || role.bases.some(base => !dependencies.some(dependency => dependency?.bases.includes(base))))
        throw Error(`unproved dependency roles ${row.id}`);
    }
  }
  for (const row of plan.unknowns) {
    const role = programme.roles.get(motionSymbolKey(row.symbol)), unit = motionUnitFactor(row.unit);
    if (!role || !unit || unit.dimension !== role.dimension)
      throw Error(`unsupported original unknown ${row.id}`);
    const value = byId.get(row.id);
    if (value && (motionSymbolKey(value.symbol) !== motionSymbolKey(row.symbol) || motionUnitFactor(value.unit)?.dimension !== unit.dimension))
      throw Error("unknown/result identity mismatch");
  }
  for (const claim of plan.qualitativeClaims) {
    if (!proveMotionProse(claim.claim, programme) || typeof claim.expected === "number" || claim.expected === false || typeof claim.expected === "string" && !proveMotionProse(claim.expected, programme) || claim.relatedEntityHints?.some(text => !proveMotionProse(text, programme)))
      throw Error(`unsupported original claim ${claim.id}`);
    if (claim.relatedQuantityIds?.some(id => !byId.has(id)))
      throw Error("unproved claim quantity identity");
  }
  for (const assumption of plan.assumptions)
    if (!proveMotionProse(assumption, programme))
      throw Error("unsupported original assumption");
  if (plan.teachingSequenceHints?.some(text => !proveMotionProse(text, programme)))
    throw Error("unsupported teaching hint");
  if (plan.lawIds.some(law => !["uniform_motion", "relative_velocity_same_direction", "relative_velocity", "relative_motion", "constant_velocity"].includes(law) || law === "relative_velocity_same_direction" && motionRationalNumber(programme.source.subject.v) * motionRationalNumber(programme.source.reference.v) <= 0))
    throw Error("unsupported original law");
}
/** Intermediate requests may evaluate an actual prerequisite of a source query.
 * Sharing the same base premises is insufficient: dA is not a time premise. */
function isQueryPrerequisite(role: MotionRole, target: MotionRole, programme: MotionCallerProgramme): boolean {
  if (sameMotionFormula(role.formula, target.formula))
    return true;
  if (role.bases.length === 1)
    return target.bases.includes(role.bases[0]!);
  const time = programme.roles.get("t");
  if (target.dimension === "length" && role.dimension === "time" && time && sameMotionFormula(role.formula, time.formula))
    return true;
  const relative = programme.roles.get("vrel");
  return role.dimension === "velocity" && Boolean(relative && sameMotionFormula(role.formula, relative.formula)) &&
    target.bases.includes(`v${programme.source.subject.name.toLowerCase()}`) &&
    target.bases.includes(`v${programme.source.reference.name.toLowerCase()}`);
}
function checkProblem(problem: ProblemIR, plan: TurnPlanV3, programme: MotionCallerProgramme): void {
  const factRoles = new Map<string, string[]>(), requested = new Map<string, MotionRole[]>();
  for (const fact of problem.facts) {
    if (!proveMotionProse(fact.statement, programme, problem.question))
      throw Error(`unproved original fact ${fact.id}`);
    if (fact.kind === "given") {
      const roles = factBases(fact, programme);
      if (!roles.length)
        throw Error(`unjoined original given ${fact.id}`);
      // A statement cannot borrow an exclusive fact belonging to another actor.
      const named = [...fact.statement.matchAll(/\b(?:train |point |body |observer )?([A-Z])\b/g)].map(match => match[1]!.toLowerCase());
      if (roles.length === 1 && /^v[a-z]$/.test(roles[0]!) && named.length && !named.includes(roles[0]!.slice(1)))
        throw Error("fact actor/source mismatch");
      factRoles.set(fact.id, roles);
    }
    else if (fact.kind === "requested") {
      const roles = queryRoles(fact, programme);
      const stated = queryRoles({ ...fact, evidence: { ...fact.evidence, quote: fact.statement } }, programme);
      if (!roles.length || !stated.length || stated.some(role => !roles.some(quoted => sameMotionFormula(role.formula, quoted.formula))))
        throw Error("requested statement/source role mismatch");
      requested.set(fact.id, roles);
    }
    else
      throw Error("unsupported original assumption fact");
  }
  const used = new Set<string>();
  for (const entity of problem.entities) {
    if (entity.kind !== "body" && entity.kind !== "point")
      throw Error("unsupported original entity");
    const label = /^(?:(?:train|body|point|particle|car|observer|bus|cyclist|runner)\s+)?([A-Z])$/i.exec(entity.label ?? "")?.[1]?.toLowerCase();
    if (!label || !actors(programme.source).some(actor => actor.name.toLowerCase() === label) || used.has(label))
      throw Error("unjoined original actor identity");
    const id = /^(?:(?:train|body|point|particle|car|observer|bus|cyclist|runner))?([A-Z])$/i.exec(entity.id)?.[1]?.toLowerCase();
    if (id && id !== label)
      throw Error("actor ID/label permutation");
    const evidence = entity.evidenceFactIds.flatMap(fact => factRoles.get(fact) ?? []);
    if (!evidence.includes(`v${label}`) || entity.evidenceFactIds.some(fact => { const keys = factRoles.get(fact); return keys?.length === 1 && /^v[a-z]$/.test(keys[0]!) && keys[0] !== `v${label}`; }))
      throw Error("actor/fact permutation");
    used.add(label);
  }
  if (used.size !== actors(programme.source).length)
    throw Error("missing source actor or observer");
  if (problem.constraints.length)
    throw Error("unsupported original constraint obligations");
  if (problem.representationIntents.some(intent => intent.kind !== "conceptual" || intent.evidenceFactIds.some(id => !factRoles.has(id))))
    throw Error("unsupported original visual obligation");
  const expressions = new Map(problem.expressions.map(expression => [expression.id, expression]));
  const boundExpressions = new Set<string>();
  const boundUnknowns = new Set<string>();
  const rows = new Map([...plan.givens, ...plan.derived].map(row => [row.id, row]));
  for (const request of problem.solveRequests) {
    if (request.kind !== "evaluate" || !request.resultBinding)
      throw Error("unsupported original solve request");
    if (Object.keys(request).some(key=>!["id","kind","expressionId","resultBinding"].includes(key)) || Object.keys(request.resultBinding).some(key=>!["turnPlanQuantityId","symbol","unit","evidenceFactIds"].includes(key))) throw Error("unsupported original request or binding fields");
    const binding = request.resultBinding, row = rows.get(binding.turnPlanQuantityId), role = programme.roles.get(motionSymbolKey(binding.symbol)), unit = motionUnitFactor(binding.unit);
    if (!row || !role || !unit || role.dimension !== unit.dimension || motionSymbolKey(row.symbol) !== motionSymbolKey(binding.symbol) || row.unit !== binding.unit)
      throw Error("unjoined original result binding");
    if (!binding.evidenceFactIds.length || binding.evidenceFactIds.some(id => !requested.has(id)))
      throw Error("result binding requires an original requested fact");
    const targets = binding.evidenceFactIds.flatMap(id => requested.get(id)!);
    if (plan.unknowns.some(unknown => unknown.id === binding.turnPlanQuantityId) && !targets.some(target => sameMotionFormula(target.formula, role.formula)))
      throw Error("original unknown/query role mismatch");
    if (!targets.some(target => isQueryPrerequisite(role, target, programme)))
      throw Error("result/query role mismatch");
    const expression = expressions.get(request.expressionId);
    if (!expression || expression.valueType !== "scalar" || Object.keys(expression).some(key=>!["id","valueType","root","evidenceFactIds"].includes(key)))
      throw Error("unsupported original expression");
    const evidence = new Set(expression.evidenceFactIds.flatMap(id => factRoles.get(id) ?? []));
    if (!role.bases.every(base => evidence.has(base)) || !binding.evidenceFactIds.every(id => expression.evidenceFactIds.includes(id)))
      throw Error("expression lacks its source/query premises");
    if (!motionFormulations(expression.root, programme.roles, [...programme.bases, programme.roles.get("gap")!], evidence).some(formula => sameDimensionalMotionFormula(formula, motionRoleFormula(role))))
      throw Error("unproved original formulation");
    const variables = new Map([...programme.roles].map(([key, value]) => [key, value.si]));
    for (const quantity of rows.values())
      variables.set(quantity.symbol, quantity.value);
    const evaluated = evaluateMotionArithmetic(expression.root, variables);
    if (!near(evaluated * unit.factor, role.si) || !near(evaluated, row.value))
      throw Error("original request result contradicts source or Plan");
    boundExpressions.add(expression.id);
    if (
      plan.unknowns.some((unknown) => unknown.id === binding.turnPlanQuantityId)
    ) {
      const derived = plan.derived.find(
        (quantity) => quantity.id === binding.turnPlanQuantityId,
      );
      if (
        !derived ||
        motionSymbolKey(derived.symbol) !== motionSymbolKey(binding.symbol) ||
        derived.unit !== binding.unit
      )
        throw Error("original unknown requires its original derived identity");
      boundUnknowns.add(binding.turnPlanQuantityId);
    }
  }
  if (plan.unknowns.some((unknown) => !boundUnknowns.has(unknown.id)))
    throw Error("unbound original numeric unknown");
  if (problem.expressions.some(expression => !boundExpressions.has(expression.id)))
    throw Error("unproved extra original expression");
}
/** A structured decline is the only unsupported outcome. Capture before any
 * property read: getters, missing contexts and cyclic/nonplain data cannot throw
 * through a public proof boundary or mutate the original caller. */
export function relativeMotionCallerIssues(question: string, rawProblem: unknown, rawPlan: unknown, document?: SceneDocument): SceneIssue[] {
  const admission = relativeMotionSource(question);
  if (admission?.status !== "admitted") {
    return admission?.status === "rejected" && relativeMotionCue(question)
      ? [{code:"relative_source_declined",severity:"fatal",path:"sourceAuthority.question",message:`source_declined: ${admission.reason}`}]
      : [];
  }
  try {
    const captured = snapshotMathSourceData({ question, problem: rawProblem, plan: rawPlan, ...(document ? { document } : {}) });
    const source = relativeMotionSource(captured.question);
    const checkedPlan = validateTurnPlanV3(captured.plan, captured.question), checkedProblem = validateProblemIR(captured.problem, captured.question);
    if (source?.status !== "admitted" || !checkedPlan.valid || !checkedPlan.plan || !checkedProblem.valid || !checkedProblem.problem)
      throw Error("whole original source, Plan and IR required");
    if (!relativeMotionSourceEntityBindings(captured.question, checkedProblem.problem))
      throw Error("unjoined original source actor aliases");
    const programme = motionCallerProgramme(source.source);
    checkOriginalFields(checkedPlan.plan, checkedProblem.problem);
    checkPlan(checkedPlan.plan, programme);
    checkProblem(checkedProblem.problem, checkedPlan.plan, programme);
    for (const actualDocument of [relativeMotionDocument(captured.question, source.source), ...(captured.document ? [captured.document] : [])]) {
      const byId = new Map([...checkedPlan.plan.givens, ...checkedPlan.plan.derived].map(row => [row.id, row]));
      for (const quantity of actualDocument.quantities) {
        const original = byId.get(quantity.id);
        if (original && (quantity.value !== original.value || quantity.unit !== original.unit))
          throw Error("same-ID original quantity contradicts scene quantity");
      }
    }
    return [];
  }
  catch (error) {
    return [{ code: "relative_source_declined", severity: "fatal", path: "sourceAuthority", message: `source_declined: ${error instanceof Error ? error.message : "unsupported original relative-motion caller"}` }];
  }
}
