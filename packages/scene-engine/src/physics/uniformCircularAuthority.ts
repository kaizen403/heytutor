import { evaluateMathExpression } from "../math/expression";
import { sameSceneValue } from "../document/valueEquality";
import type { ExpressionNodeIR, ProblemIR, ProblemFact } from "../ir/problemIR";
import type { SceneIssue } from "../types";
import { readUniformCircularSource, type UniformCircularNumeric } from "./uniformCircularSource";
import { uniformCircularSourceNames } from "./uniformCircularSourceNames";

function sourceLiteralMatches(text: string, literal: string): Array<{ index: number; length: number }> {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...text.matchAll(new RegExp(`(?<![\\w.])${escaped}(?![\\w/\\^²])`, "g"))].map(match => ({ index: match.index!, length: match[0].length }));
}
const containsLiteral = (text: string, literal: string) => sourceLiteralMatches(text, literal).length > 0;

type Role = "radius" | "speed" | "period" | "angular_speed" | "acceleration";
export interface UniformCircularRuntimeContract {
  source: UniformCircularNumeric;
  actor: string;
  path: string;
  requestStart: number;
  setup: string;
  requested: Role[];
}
type Reading = { status: "bound"; contract: UniformCircularRuntimeContract } | { status: "declined" };
const requestedRole = (text: string): Role | null => {
  const phrase = text.toLowerCase().replace(/^(?:find|calculate|determine)\s+/i, "").replace(/^(?:its|the)\s+/i, "").replace(/[.]$/, "").trim();
  if (phrase === "speed") return "speed";
  if (phrase === "angular speed") return "angular_speed";
  if (["centripetal acceleration", "acceleration"].includes(phrase)) return "acceleration";
  if (["period", "time period", "time for one revolution", "time for one complete revolution"].includes(phrase)) return "period";
  return null;
};

/**
 * Source admission for one named body with a radius and speed/period. Every
 * setup clause and request must be consumed. This is a bounded language for
 * physical inputs, not a topic router or a substitute ProblemIR. Extended
 * positional/interval states retain their existing separate source contract.
 */
export function readUniformCircularRuntimeContract(question: string): Reading | null {
  const names = uniformCircularSourceNames(question);
  const source = readUniformCircularSource(question);
  if (!names) return null;
  if (source?.status === "symbolic" && source.radiusText !== null
    && /\b(?:speed|period)\s+(?:of\s+)?\d/.test(question.slice(0, question.search(/\b(?:Find|Calculate|Determine)\b/i)))) return { status: "declined" };
  if (source?.status !== "numeric") return null;
  if (source.mass !== null) return { status: "declined" };
  if (source.phase !== null || source.elapsedTime !== null
    || source.radiusSource !== "radius" || !["speed", "period"].includes(source.rateSource)) return null;
  if (source.givens.length !== 2) return { status: "declined" };
  const split = /\s+(Find|Calculate|Determine)\b/i.exec(question);
  if (!split) return { status: "declined" };
  const requestStart = split.index + split[0].length - split[1]!.length;
  const setup = question.slice(0, requestStart).trim();
  const actor = /^A\s+(?:car|stone|particle|body|bead)\s+moves\b/i.exec(setup)!;
  let residue = setup.slice(actor[0].length).replace(/[.]$/, "").trim();
  for (const given of source.givens) {
    if (sourceLiteralMatches(setup, given.text).length !== 1) return { status: "declined" };
    const occurrence = sourceLiteralMatches(residue, given.text)[0];
    if (!occurrence) return { status: "declined" };
    residue = residue.slice(0, occurrence.index) + `@${given.role}` + residue.slice(occurrence.index + occurrence.length);
  }
  const clause = /^(?:clockwise|anticlockwise|uniformly|with\s+(?:a\s+)?(?:constant|uniform)\s+speed(?:\s+of\s+@speed)?|at\s+(?:(?:a\s+)?(?:constant|uniform)\s+speed\s+(?:of\s+)?)?@speed|with\s+speed\s+(?:of\s+)?@speed|(?:in|on|around|along)\s+(?:a|the)\s+(?:horizontal\s+)?circle|(?:around|along|on)\s+(?:a|the)\s+circular\s+(?:track|path)|(?:of|with)\s+radius\s+@radius|with\s+(?:a\s+)?(?:time\s+)?period\s+(?:of\s+)?@period)(?=\s|$)/i;
  while (residue) {
    const match = clause.exec(residue);
    if (!match) return { status: "declined" };
    residue = residue.slice(match[0].length).trim();
  }
  const phrases = question.slice(requestStart).replace(/^(?:Find|Calculate|Determine)\s+/i, "").replace(/[.]$/, "").split(/\s+and\s+|\s*,\s*/i);
  const requested: Role[] = [];
  for (const phrase of phrases) {
    const role = requestedRole(phrase.trim());
    if (!role || requested.includes(role)) return { status: "declined" };
    requested.push(role);
  }
  return { status: "bound", contract: { source, ...names, requestStart, setup, requested } };
}

const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phraseText = (text: string) => text.trim().replace(/[.]$/, "").toLowerCase();

function requestMeanings(contract: UniformCircularRuntimeContract, text: string): Role[] | null {
  const actor = escapePattern(contract.actor);
  const roles = phraseText(text).replace(/^(?:find|calculate|determine)\s+/, "")
    .split(/\s+and\s+|\s*,\s*/).map(phrase => requestedRole(phrase.replace(new RegExp(`^(?:the )?${actor}'s\\s+`), "")));
  return roles.some(role => !role) || new Set(roles).size !== roles.length ? null : roles as Role[];
}

/** Whole bounded assertion, with the single source actor implicit or explicit.
 * Each scalar literal remains owned by its role and unit. Unread remainders
 * decline; source quotations are not a bag of numbers or statement authority.
 */
function givenStatementRoles(contract: UniformCircularRuntimeContract, text: string): Role[] | null {
  const phrase = phraseText(text);
  const actor = escapePattern(contract.actor);
  const owner = `(?:(?:a |the )?${actor}(?:'s)?(?: moves)?(?: at| with)? |the )?`;
  for (const given of contract.source.givens) {
    const literal = escapePattern(given.text.toLowerCase());
    const role = given.role as Role;
    const subject = role === "radius" ? `(?:(?:horizontal )?(?:circle|circular path|circular track)(?: of)? )?radius(?: of the (?:horizontal )?(?:circle|circular path|circular track))?`
      : role === "period" ? `(?:time )?period(?: of (?:the )?motion)?` : `(?:(?:constant|uniform) )?speed`;
    if (new RegExp(`^${owner}${subject}(?: is| of)? ${literal}$`).test(phrase)) {
      if (phrase.includes("horizontal") && !/\bhorizontal\b/i.test(contract.setup)) return null;
      if (phrase.includes("circular track") && contract.path !== "circular track") return null;
      return [role];
    }
  }
  const sense = contract.source.sense;
  if (sense && new RegExp(`^(?:(?:a |the )?${actor} )?(?:moves |motion is |the motion is )?${sense}$`).test(phrase)) return [];
  return null;
}

function supportedUniformAssumption(contract: UniformCircularRuntimeContract, fact: ProblemFact): boolean {
  return fact.kind === "assumption" && fact.evidence.quote.trim() === contract.setup
    && new RegExp(`^(?:the )?${contract.actor} (?:undergoes|moves in) uniform circular motion(?: with constant speed)?[.]?$`, "i").test(fact.statement);
}

export function uniformCircularRuntimeEntityId(contract: UniformCircularRuntimeContract, problem: ProblemIR, entityId: string): string | null {
  const entity = problem.entities.find(row => row.id === entityId);
  if (!entity) return null;
  const facts = entity.evidenceFactIds.map(id => problem.facts.find(row => row.id === id));
  const setup = facts.filter((fact): fact is ProblemFact => !!fact && (fact.kind === "given" || supportedUniformAssumption(contract, fact)) && fact.evidence.end <= contract.requestStart);
  const label = entity.label?.toLowerCase().trim();
  const ownsGiven = setup.some(fact => contract.source.givens.some(given => containsLiteral(fact.evidence.quote, given.text)));
  // The source's single actor owns the radius/rate clauses even when a quote
  // omits its noun. Its name, kind and complete setup are proved separately.
  if (["body", "point"].includes(entity.kind) && [contract.actor, `moving ${contract.actor}`, `the ${contract.actor}`].includes(label ?? "")
    && (ownsGiven || setup.some(fact => fact.evidence.quote.includes(`${contract.actor} moves`)))) return "body";
  const path = label?.replace(/circular path$/, "circle");
  const expectedPath = contract.path.replace(/circular path$/, "circle");
  const radiusFact = setup.some(fact => /\bradius\b/i.test(fact.evidence.quote) && containsLiteral(fact.evidence.quote, contract.source.givens.find(given => given.role === "radius")!.text));
  if (entity.kind === "curve" && path === expectedPath && radiusFact) return "path";
  if (entity.kind === "point" && ["centre", "center", `centre of ${contract.path}`, `center of ${contract.path}`].includes(label ?? "") && radiusFact) return "O";
  return null;
}

const n = (value: number): ExpressionNodeIR => ({ kind: "number", value });
const b = (operator: "*" | "/" | "^", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
const tau = (): ExpressionNodeIR => b("*", n(2), { kind: "constant", name: "pi" });
const factors: Record<string, number> = { m: 1, cm: .01, mm: .001, km: 1000, "m/s": 1, "cm/s": .01, "km/s": 1000, "km/h": 1000 / 3600, s: 1, ms: .001, min: 60, h: 3600 };

/** Closed source operands and reusable circular-law ASTs. No evaluated-value join. */
function sourceTrees(contract: UniformCircularRuntimeContract): Record<Role, ExpressionNodeIR[]> {
  const given = (role: string) => contract.source.givens.find(row => row.role === role)!;
  const operands = (role: string): ExpressionNodeIR[] => {
    const row = given(role); const factor = factors[row.unit]!;
    if (factor === 1) return [n(row.value)];
    return [b("*", n(row.value), n(factor)), n(row.value * factor)];
  };
  const trees: Record<Role, ExpressionNodeIR[]> = { radius: operands("radius"), speed: [], period: [], angular_speed: [], acceleration: [] };
  for (const r of trees.radius) for (const rate of operands(contract.source.rateSource)) {
    const v = contract.source.rateSource === "speed" ? rate : b("/", b("*", tau(), r), rate);
    const omega = contract.source.rateSource === "speed" ? b("/", rate, r) : b("/", tau(), rate);
    const period = contract.source.rateSource === "period" ? rate : b("/", b("*", tau(), r), rate);
    trees.speed.push(v); trees.angular_speed.push(omega); trees.period.push(period);
    trees.acceleration.push(b("/", b("^", v, n(2)), r), b("*", b("^", omega, n(2)), r));
  }
  return trees;
}

/** Units and symbols jointly name a role; a same-dimensional number is insufficient. */
export function uniformCircularRuntimeQuantityRole(row: { symbol: string; unit?: string }): Role | null {
  const unit = row.unit?.normalize("NFKC").replace(/\s/g, "").replace(/²/g, "^2").replace(/m\/s2$/, "m/s^2");
  const symbol = row.symbol.replace(/[{}\\]/g, "");
  if (/^(?:r|R)$/.test(symbol) && ["m", "cm", "mm", "km"].includes(unit ?? "")) return "radius";
  if (/^(?:v|v_t)$/.test(symbol) && ["m/s", "cm/s", "km/s", "km/h"].includes(unit ?? "")) return "speed";
  if (/^(?:T|T_p)$/.test(symbol) && ["s", "ms", "min", "h"].includes(unit ?? "")) return "period";
  if (/^(?:ω|omega)$/.test(symbol) && unit === "rad/s") return "angular_speed";
  if (/^(?:a|a_c|ac|a_cp|a_r)$/.test(symbol) && ["m/s^2", "cm/s^2"].includes(unit ?? "")) return "acceleration";
  return null;
}

export function uniformCircularRuntimeProblemIssues(contract: UniformCircularRuntimeContract, problem: ProblemIR): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const fail = (path: string) => issues.push({ code: "ucm_problem_obligation", severity: "fatal", path: `problemIR.${path}`, message: "Every circular source fact, expression, constraint, intent and request must bind its complete physical role and source operands." });
  const trees = sourceTrees(contract);
  const factRoles = new Map<string, Role[]>();
  for (const fact of problem.facts) {
    const evidence = fact.evidence;
    const quoteIsSource = problem.question.slice(evidence.start, evidence.end) === evidence.quote;
    if (!quoteIsSource) { fail(`facts.${fact.id}`); continue; }
    if (fact.kind === "requested") {
      const roles = requestMeanings(contract, evidence.quote);
      const stated = requestMeanings(contract, fact.statement);
      if (evidence.start < contract.requestStart || !roles || !stated
        || roles.some(role => !contract.requested.includes(role)) || !sameSceneValue([...roles].sort(), [...stated].sort())) fail(`facts.${fact.id}`);
      else factRoles.set(fact.id, roles);
    } else {
      if (supportedUniformAssumption(contract, fact)) {
        factRoles.set(fact.id, []);
        continue;
      }
      if (fact.kind !== "given" || evidence.end > contract.requestStart) { fail(`facts.${fact.id}`); continue; }
      const roles = contract.source.givens.filter(given => containsLiteral(evidence.quote, given.text)).map(given => given.role as Role);
      const stated = fact.statement === evidence.quote ? roles : givenStatementRoles(contract, fact.statement);
      if (!stated || !sameSceneValue([...roles].sort(), [...stated].sort())
        || !roles.length && !/\bmoves\b|\bclockwise\b|\banticlockwise\b|\bcircl|\bradius\b/i.test(evidence.quote)
        || !roles.length && fact.statement !== evidence.quote && !contract.source.sense) fail(`facts.${fact.id}`);
      else factRoles.set(fact.id, roles);
    }
  }

  const entityIdentities = problem.entities.map(entity => uniformCircularRuntimeEntityId(contract, problem, entity.id));
  if (!entityIdentities.includes("body") || !entityIdentities.includes("path")) fail("entities");
  if (!problem.representationIntents.some(intent => {
    const identities = intent.entityIds.map(id => uniformCircularRuntimeEntityId(contract, problem, id));
    return identities.includes("body") && identities.includes("path");
  })) fail("representationIntents");
  const expressionRoles = new Map<string, Role[]>();
  for (const expression of problem.expressions) {
    const evidenceFacts = expression.evidenceFactIds.map(id => problem.facts.find(fact => fact.id === id));
    const evidenceRoles = new Set(expression.evidenceFactIds.flatMap(id => problem.facts.find(fact => fact.id === id)?.kind === "given" ? factRoles.get(id) ?? [] : []));
    const roles = (Object.keys(trees) as Role[]).filter(role => trees[role].some(root => sameSceneValue(expression.root, root)));
    const requiresRate = roles.some(role => role !== "radius" && role !== contract.source.rateSource);
    const needed = new Set<Role>([
      ...(requiresRate || roles.includes("radius") ? ["radius" as const] : []),
      ...(roles.some(role => role !== "radius") ? [contract.source.rateSource as Role] : []),
    ]);
    // Every listed fact supplies an operand or participates in a complete
    // request/formula binding. An appended request is not a numeric operand.
    const consumedRequest = (fact: ProblemFact) => fact.kind === "requested" && !!factRoles.get(fact.id)?.length
      && factRoles.get(fact.id)!.every(role => roles.includes(role)) && problem.solveRequests.some(request => {
        const binding = request.resultBinding;
        return request.kind === "evaluate" && request.expressionId === expression.id && !!binding
          && factRoles.get(fact.id)!.includes(uniformCircularRuntimeQuantityRole(binding)!)
          && expression.evidenceFactIds.every(id => binding.evidenceFactIds.includes(id));
      });
    const unused = evidenceFacts.some(fact => !fact || !consumedRequest(fact) && (fact.kind !== "given"
      || !factRoles.get(fact.id)?.length || factRoles.get(fact.id)!.some(role => !needed.has(role))));
    if (expression.valueType !== "scalar" || !roles.length || unused || [...needed].some(role => !evidenceRoles.has(role))) fail(`expressions.${expression.id}`);
    expressionRoles.set(expression.id, roles);
  }
  const usedRequests = new Set<Role>();
  for (const request of problem.solveRequests) {
    if (request.kind !== "evaluate" || !request.resultBinding) { fail(`solveRequests.${request.id}`); continue; }
    const binding = request.resultBinding;
    const role = uniformCircularRuntimeQuantityRole(binding);
    const requestEvidence = binding.evidenceFactIds.flatMap(id => {
      const fact = problem.facts.find(row => row.id === id);
      return fact?.kind === "requested" ? factRoles.get(id) ?? [] : [];
    });
    // Bind output units too. These ASTs are SI; a converted output needs its
    // own explicit operator, rather than changing a unit on a correct value.
    const siUnit: Partial<Record<Role, string>> = { speed: "m/s", period: "s", angular_speed: "rad/s", acceleration: "m/s^2" };
    const unit = binding.unit?.normalize("NFKC").replace(/\s/g, "").replace(/m\/s2$/, "m/s^2");
    if (!role || !contract.requested.includes(role) || usedRequests.has(role) || !expressionRoles.get(request.expressionId)?.includes(role)
      || !requestEvidence.includes(role) || unit !== siUnit[role]) fail(`solveRequests.${request.id}`);
    else usedRequests.add(role);
  }
  if (contract.requested.some(role => !usedRequests.has(role))) fail("solveRequests");
  const setupEvidence = (ids: string[]) => ids.length > 0 && ids.every(id => {
    const fact = problem.facts.find(row => row.id === id);
    return !!fact && (fact.kind === "given" || supportedUniformAssumption(contract, fact))
      && factRoles.has(id) && fact.evidence.end <= contract.requestStart;
  }) && ids.some(id => factRoles.get(id)?.includes("radius"));
  for (const constraint of problem.constraints) {
    // The supported setup contains only point-on-circle incidence. Every
    // other relation/equation is an additional unsupported obligation.
    const ids = "entityIds" in constraint ? constraint.entityIds.map(id => uniformCircularRuntimeEntityId(contract, problem, id)) : [];
    if (!setupEvidence(constraint.evidenceFactIds) || constraint.kind !== "incident" || ids.length !== 2 || !ids.includes("body") || !ids.includes("path")) fail(`constraints.${constraint.id}`);
  }
  for (const intent of problem.representationIntents) {
    if (!setupEvidence(intent.evidenceFactIds) || !["conceptual", "graph"].includes(intent.kind) || intent.entityIds.some(id => !uniformCircularRuntimeEntityId(contract, problem, id))) fail(`representationIntents.${intent.id}`);
  }
  return issues;
}

/** Each supported sentence is a complete physical assertion, not a keyword
 * allowlist. Unsupported prose declines. These are laws of the admitted source
 * state, not question/fixture templates; no IDs or authored metadata confer truth.
 */
function supportedPlanAssertion(contract: UniformCircularRuntimeContract, text: string): boolean {
  const phrase = phraseText(text).replace(/²/g, "^2").replace(/ω/g, "omega");
  const inward = "(?:toward|towards) the (?:center|centre)(?: of the (?:circle|circular track))?";
  const acceleration = new RegExp(`^(?:the )?(?:centripetal )?acceleration (?:points|is directed|directed) (?:radially inward(?: ${inward})?|${inward})(?:, perpendicular to (?:the )?velocity)?$`);
  if (acceleration.test(phrase)) return true;
  if (/^(?:the )?speed is constant(?: in uniform circular motion| because the period and radius are fixed)?$/.test(phrase)) return true;
  if (phrase === "constant speed") return true;
  if (new RegExp(`^(?:the )?${escapePattern(contract.actor)} (?:undergoes|moves in) uniform circular motion(?: with constant speed)?$`).test(phrase)) return true;
  if (/\bhorizontal\b/.test(contract.setup) && phrase === "horizontal circle implies no vertical acceleration component considered") return true;
  if (/^uniform circular motion(?: \(constant speed\)| at constant speed)?$/.test(phrase)) return true;
  if (/^(?:the )?velocity is (?:tangent|tangential) to the (?:circle|circular path|circular track)$/.test(phrase)) return true;
  if (/^(?:centripetal )?acceleration is perpendicular to (?:the )?velocity$/.test(phrase)) return true;
  if (/^speed is constant in uniform circular motion and equals circumference divided by period$/.test(phrase)) return true;
  if (/^speed is constant, so the period is circumference divided by speed$/.test(phrase)) return true;
  if (new RegExp(`^centripetal acceleration points ${inward} and has magnitude v\\^2/r$`).test(phrase)) return true;
  if (/^angular speed is omega = v\/r$/.test(phrase)) return true;
  if (new RegExp(`^centripetal acceleration magnitude is a_c = v\\^2/r = omega\\^2r, directed radially inward ${inward}$`).test(phrase)) return true;
  if (contract.source.sense === "clockwise" && phrase === "clockwise motion sets the sign of angular velocity (negative by the usual counterclockwise-positive convention) but does not change the magnitudes") return true;
  if (phrase === "a verified illustration is required by the question's spatial or explicit visual request") return true;
  const piDisplay = /^pi approx (3\.\d+)$/.exec(phrase);
  if (piDisplay) return Math.abs(Number(piDisplay[1]) - Math.PI) <= .5 * 10 ** -(piDisplay[1]!.length - 2);
  if (new RegExp(`^${escapePattern(contract.actor)} treated as a point particle$`).test(phrase)) return true;
  const radius = contract.source.givens.find(given => given.role === "radius")!;
  if (contract.path === "circular track" && phrase === `track is a perfect circle of radius ${radius.text.toLowerCase()}`) return true;
  const speed = contract.source.givens.find(given => given.role === "speed");
  if (speed && phrase === `speed is constant at ${speed.text.toLowerCase()} (uniform circular motion)`) return true;
  return !!contract.source.sense && new RegExp(`^(?:(?:the )?(?:${escapePattern(contract.actor)}|body) )?moves ${contract.source.sense}$`).test(phrase);
}

/** Known equation chains are joined to the source state as well as prose.
 * Symbolic members must be circular identities; numeric members carry their
 * own SI units. Rounding is allowed only following an explicit approx sign.
 */
function supportedClaimExpected(contract: UniformCircularRuntimeContract, expected: unknown): boolean {
  if (expected === true) return true;
  if (typeof expected !== "string") return false;
  if (supportedPlanAssertion(contract, expected)) return true;
  let text = expected.replace(/²/g, "^2").replace(/ω/g, "omega").replace(/−/g, "-").trim();
  const signed = / if signed; magnitude /.test(text);
  if (signed) {
    if (contract.source.sense !== "clockwise") return false;
    const match = /^omega = (-[\d.]+) rad\/s if signed; magnitude ([\d.]+) rad\/s$/.exec(text);
    return !!match && Number(match[1]) === -contract.source.angularSpeed && Number(match[2]) === contract.source.angularSpeed;
  }
  text = text.replace(/, directed radially inward$/, "");
  const parts = text.split(/\s*(=|≈)\s*/);
  const symbol = parts.shift()!.trim();
  const role: Role | null = symbol === "a_c" ? "acceleration" : symbol === "T" ? "period" : symbol === "v" ? "speed" : symbol === "omega" ? "angular_speed" : null;
  if (!role || parts.length < 2) return false;
  const identities: Record<Role, string[]> = {
    radius: ["r"], speed: ["2*pi*r/T"], period: ["2*pi*r/v"], angular_speed: ["v/r", "2*pi/T"],
    acceleration: ["v^2/r", "omega^2r", "omega^2*r", "4*pi^2*r/T^2"],
  };
  const unit: Record<Role, string> = {radius:"m",speed:"m/s",period:"s",angular_speed:"rad/s",acceleration:"m/s^2"};
  const value = uniformCircularRuntimeQuantityValue(contract.source, {symbol,unit:unit[role]})!;
  for (let i = 0; i < parts.length; i += 2) {
    const member = parts[i + 1]!.replace(/\s/g, "");
    if (identities[role].includes(member) && parts[i] === "=") continue;
    if (!member.endsWith(unit[role])) return false;
    const literal = member.slice(0, -unit[role].length);
    if (!/^-?(?:\d+(?:\.\d+)?)(?:\*pi)?$/.test(literal)) return false;
    const digits = /\.(\d+)/.exec(literal)?.[1]?.length ?? 0;
    const tolerance = parts[i] === "≈" ? .5 * 10 ** -digits : 8 * Number.EPSILON * Math.max(1, Math.abs(value));
    try { if (Math.abs(evaluateMathExpression(literal, 0) - value) > tolerance) return false; } catch { return false; }
  }
  return true;
}

/** Unknown rows are obligations too; do not delete them to obtain admission. */
export function uniformCircularRuntimePlanConflicts(question: string, rawPlan: unknown): Array<{ id: string; symbol: string; planValue: number; sourceValue: number; unit: string }> {
  const reading = readUniformCircularRuntimeContract(question);
  if (reading?.status !== "bound" || !rawPlan || typeof rawPlan !== "object") return [];
  const plan = rawPlan as Record<string, unknown>;
  const rows = (key: string): Record<string, unknown>[] => Array.isArray(plan[key]) ? plan[key].filter((row): row is Record<string, unknown> => !!row && typeof row === "object") : [];
  const conflicts: Array<{ id: string; symbol: string; planValue: number; sourceValue: number; unit: string }> = [];
  // Unbound roles have no source value; never invent a zero scalar for them.
  const add = (row: Record<string, unknown>) => conflicts.push({ id: String(row.id ?? ""), symbol: String(row.symbol ?? ""), unit: String(row.unit ?? ""), planValue: typeof row.value === "number" ? row.value : Number.NaN, sourceValue: Number.NaN });
  for (const row of [...rows("givens"), ...rows("derived"), ...rows("unknowns")]) {
    const role = typeof row.symbol === "string" ? uniformCircularRuntimeQuantityRole({ symbol: row.symbol, unit: typeof row.unit === "string" ? row.unit : undefined }) : null;
    if (!role) { add(row); continue; }
    // Source text is evidence only on input rows, where the literal must be
    // owned by the same role; a same-value radius/rate substitution is false.
    if (rows("givens").includes(row)) {
      const given = reading.contract.source.givens.find(given => given.role === role);
      if (!given || typeof row.sourceText !== "string" || !containsLiteral(row.sourceText, given.text)
        || !reading.contract.setup.includes(row.sourceText) || !givenStatementRoles(reading.contract, row.sourceText)?.includes(role)) add(row);
    }
    if (rows("unknowns").includes(row) && !reading.contract.requested.includes(role)) add(row);
    if (row.uncertainty !== undefined && (row.uncertainty !== 0 || !rows("givens").includes(row)
      && (typeof row.value !== "number" || row.value !== uniformCircularRuntimeQuantityValue(reading.contract.source, {symbol:String(row.symbol),unit:String(row.unit)})))) add(row);
  }
  const inputRoles = rows("givens").map(row => uniformCircularRuntimeQuantityRole({symbol:String(row.symbol),unit:String(row.unit)}));
  if (inputRoles.length !== 2 || new Set(inputRoles).size !== 2 || reading.contract.source.givens.some(given => !inputRoles.includes(given.role as Role))) add({id:"givens"});
  const unknowns = rows("unknowns");
  const roles = unknowns.map(row => typeof row.symbol === "string" ? uniformCircularRuntimeQuantityRole({ symbol: row.symbol, unit: typeof row.unit === "string" ? row.unit : undefined }) : null);
  if (roles.length !== new Set(roles).size || reading.contract.requested.some(role => !roles.includes(role))) add({id:"unknowns"});
  for (const claim of rows("qualitativeClaims")) {
    if (typeof claim.claim !== "string" || !supportedPlanAssertion(reading.contract, claim.claim)
      || !supportedClaimExpected(reading.contract, claim.expected)) add(claim);
  }
  if (!Array.isArray(plan.assumptions) || plan.assumptions.some(text => typeof text !== "string" || !supportedPlanAssertion(reading.contract, text))) add({id:"assumptions"});
  return conflicts;
}

/** Exact canonical scalar in the row's own physical unit, or no binding. */
export function uniformCircularRuntimeQuantityValue(source: UniformCircularNumeric, row: { symbol: string; unit?: string }): number | null {
  const role = uniformCircularRuntimeQuantityRole(row);
  const unit = row.unit?.normalize("NFKC").replace(/\s/g, "").replace(/m\/s2$/, "m/s^2");
  const factor = unit === "cm/s^2" ? .01 : unit === "m/s^2" || unit === "rad/s" ? 1 : factors[unit ?? ""];
  if (!role || factor === undefined) return null;
  const state: Record<Role, number> = { radius: source.radiusM, speed: source.speed, period: source.period, angular_speed: source.angularSpeed, acceleration: source.centripetalAcceleration };
  return state[role] / factor;
}
