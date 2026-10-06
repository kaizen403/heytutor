/** Complete, bounded source formulation for planner unavailability. No topic routing. */
import { validateTurnPlanV3, type TurnPlanV3 } from "../contracts/contractsV3";
import { validateProblemIR, type ExpressionNodeIR, type ProblemIR } from "../ir/problemIR";
import { LocalDeterministicSolverProvider, validateSolverResult, type SolverResult } from "../ir/solver";
import { verifyTurnPlanAgainstSolver } from "../ir/solverAuthority";
import { readUniformCircularSource } from "./uniformCircularSource";

export interface UniformCircularSourceFallback {
  problemIR: ProblemIR;
  turnPlan: TurnPlanV3;
  solverResult: SolverResult;
}
const number = (value: number): ExpressionNodeIR => ({ kind: "number", value });
const binary = (operator: "+" | "-" | "*" | "/" | "^", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
const tau = (): ExpressionNodeIR => binary("*", number(2), { kind: "constant", name: "pi" });
const LENGTH = { m: 1, cm: 0.01, mm: 0.001, km: 1000 };
const RATE: Record<string, number> = { "m/s": 1, "cm/s": 0.01, "km/s": 1000, "km/h": 1000 / 3600, s: 1, ms: 0.001, min: 60, h: 3600 };

/**
 * Whole-source grammar: one body, explicit radius, speed OR period, all
 * requested scalars. Other facts/actors/positions/masses/conditions decline.
 * Intended only when the parent has no usable formulation; never replace an
 * existing full IR with this narrower contract. No submitted marker is read.
 */
export async function buildUniformCircularSourceFallback(question: string): Promise<UniformCircularSourceFallback | null> {
  const source = readUniformCircularSource(question);
  if (source?.status !== "numeric" || source.radiusSource !== "radius" || source.phase !== null
    || source.mass !== null || source.elapsedTime !== null || source.givens.length !== 2
    || !["speed", "period"].includes(source.rateSource)) return null;
  const split = /\s+(Find|Calculate|Determine)\b/.exec(question);
  if (!split) return null;
  const requestStart = split.index + split[0].length - split[1]!.length;
  const setup = question.slice(0, requestStart).trim();
  const request = question.slice(requestStart);
  const actor = /^A\s+(car|stone|particle|body|bead)\s+moves\b/i.exec(setup);
  if (!actor) return null;
  let residue = setup.slice(actor[0].length).replace(/[.]$/, "").trim();
  for (const given of source.givens) {
    // Exact single occurrence: source numbers cannot disappear or bind twice.
    if (setup.split(given.text).length !== 2) return null;
    residue = residue.replace(given.text, `@${given.role}`);
  }
  const clauses = /^(?:clockwise|anticlockwise|with\s+uniform\s+speed|at\s+(?:a\s+)?(?:constant|uniform)\s+speed\s+(?:of\s+)?@speed|(?:in|on|around|along)\s+(?:a|the)\s+(?:horizontal\s+)?circle|(?:around|along|on)\s+(?:a|the)\s+circular\s+(?:track|path)|(?:of|with)\s+radius\s+@radius|with\s+(?:a\s+)?(?:time\s+)?period\s+(?:of\s+)?@period)(?=\s|$)/i;
  while (residue) {
    const clause = clauses.exec(residue);
    if (!clause) return null;
    residue = residue.slice(clause[0].length).trim();
  }
  const requests = request.replace(/^(?:Find|Calculate|Determine)\s+(?:its\s+|the\s+)?/i, "").replace(/[.]$/, "").split(/\s+and\s+|\s*,\s*/i);
  const names: Record<string, string> = {
    speed: "v", "angular speed": "omega", "centripetal acceleration": "ac",
    period: "T", "time period": "T", "time for one revolution": "T", "time for one complete revolution": "T",
  };
  const requested: string[] = [];
  for (const phrase of requests) {
    const id = names[phrase.replace(/^(?:its|the)\s+/i, "").trim().toLowerCase()];
    if (!id || requested.includes(id)) return null;
    requested.push(id);
  }
  if (!requested.length) return null;
  const radius = source.givens.find((g) => g.role === "radius")!;
  const rate = source.givens.find((g) => g.role === source.rateSource)!;
  if (!radius || !rate || RATE[rate.unit] === undefined) return null;
  const convert = (value: number, factor: number) => factor === 1 ? number(value) : binary("*", number(value), number(factor));
  const r = convert(radius.value, LENGTH[source.radiusUnit]);
  const input = convert(rate.value, RATE[rate.unit]!);
  const speed = source.rateSource === "speed" ? input : binary("/", binary("*", tau(), r), input);
  const omega = source.rateSource === "speed" ? binary("/", input, r) : binary("/", tau(), input);
  const acceleration = binary("/", binary("^", speed, number(2)), r);
  const period = source.rateSource === "period" ? input : binary("/", binary("*", tau(), r), speed);
  const outputs = [
    { id: "v", symbol: "v", unit: "m/s", value: source.speed, root: speed },
    { id: "omega", symbol: "omega", unit: "rad/s", value: source.angularSpeed, root: omega },
    { id: "ac", symbol: "a_c", unit: "m/s^2", value: source.centripetalAcceleration, root: acceleration },
    { id: "T", symbol: "T", unit: "s", value: source.period, root: period },
  ];
  const fact = (id: string, kind: "given" | "requested", quote: string, start: number) => ({
    id, kind, statement: quote, evidence: { source: "question" as const, start, end: start + quote.length, quote },
  });
  const facts = [fact("setup", "given", setup, 0),
    fact("radius", "given", radius.text, question.indexOf(radius.text)),
    fact("rate", "given", rate.text, question.indexOf(rate.text)),
    fact("request", "requested", request, requestStart)];
  const evidence = ["setup", "radius", "rate", "request"];
  const problemIR: ProblemIR = {
    schemaVersion: "problem-ir/v1", id: "sourceUniformCircular", question, facts,
    entities: [
      { id: "body", kind: "body", label: actor[1]!.toLowerCase(), evidenceFactIds: ["setup"] },
      { id: "path", kind: "curve", label: /track/i.test(setup) ? "circular track" : /horizontal/i.test(setup) ? "horizontal circle" : "circle", evidenceFactIds: ["setup", "radius"] },
      { id: "centre", kind: "point", label: "centre", evidenceFactIds: ["setup", "radius"] },
    ],
    expressions: outputs.map(({ id, root }) => ({ id: `expr_${id}`, valueType: "scalar", root, evidenceFactIds: evidence })),
    constraints: [],
    representationIntents: [{ id: "motion", kind: "conceptual", entityIds: ["body", "path", "centre"], evidenceFactIds: evidence }],
    solveRequests: outputs.map(({ id, symbol, unit }) => ({ id: `solve_${id}`, kind: "evaluate", expressionId: `expr_${id}`, resultBinding: { turnPlanQuantityId: id, symbol, unit, evidenceFactIds: evidence } })),
  };
  const turnPlan: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3", question,
    givens: [radius, rate].map((g) => ({ id: `given_${g.role}`, symbol: g.role === "radius" ? "r" : g.role === "speed" ? "v" : "T", value: g.value, unit: g.unit, provenance: "given", sourceText: g.text })),
    unknowns: outputs.filter(({ id }) => requested.includes(id)).map(({ id, symbol, unit }) => ({ id, symbol, unit })),
    derived: outputs.map(({ id, symbol, unit, value }) => ({ id, symbol, unit, value, provenance: "derived", dependsOn: ["given_radius", `given_${rate.role}`] })),
    qualitativeClaims: [], lawIds: ["uniform_circular_motion_speed", "centripetal_acceleration"],
    assumptions: [], visualRequirement: "required",
  };
  if (!validateProblemIR(problemIR, question).valid || !validateTurnPlanV3(turnPlan, question).valid) return null;
  const solverResult = await new LocalDeterministicSolverProvider().solve(problemIR);
  if (!validateSolverResult(solverResult, problemIR).valid || verifyTurnPlanAgainstSolver(problemIR, solverResult, turnPlan, question).status !== "verified") return null;
  // Both authorities used the same canonical expression trees. Demand exact
  // numeric agreement here; the restore allowance is not a formulation rule.
  if (outputs.some((o) => solverResult.values.find((v) => v.requestId === `solve_${o.id}`)?.approximate !== o.value)) return null;
  return { problemIR, turnPlan, solverResult };
}
