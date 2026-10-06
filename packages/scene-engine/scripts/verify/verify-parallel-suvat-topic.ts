import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileSceneDocument } from "../../src/compile/compiler";
import { evaluateKinematicsConstruction, type KinematicsEvaluationContext, type KinematicsGeometry } from "../../src/compile/kinematicsGeometry";
import type { SceneDocument } from "../../src/types";
import { renderSceneSvg } from "../lib/renderSceneSvg";
import { validateProblemIR, type ProblemIR } from "../../src/ir/problemIR";
import { LocalDeterministicSolverProvider, validateSolverResult } from "../../src/ir/solver";
import { verifyTurnPlanAgainstSolver, reconcileTurnPlanWithSolver } from "../../src/ir/solverAuthority";
import { validateTurnPlanV3, type TurnPlanV3 } from "../../src/contracts/contractsV3";
import { planAndSolveProblemV1 } from "../../../tutor-core/src/planners/problemPlannerV1";

interface Case {
  id: string;
  x0: number;
  u: number;
  a: number;
  start: number;
  end: number;
  time: number;
  x: number;
  v: number;
  s: number;
}

const out = resolve(process.argv[2] ?? `${process.env.HOME}/.capy/work/HEY83-parallel-topics/suvat-equations`);
const freeze = JSON.parse(readFileSync(resolve(out, "freeze.json"), "utf8")) as { topic: string; cases: Case[] };
assert.equal(freeze.topic, "physics|2|suvat-equations");
assert.equal(freeze.cases.length, 7);
mkdirSync(out, { recursive: true });
const geometries = new Map<string, KinematicsGeometry>();
const context: KinematicsEvaluationContext = {
  number(value) {
    if (typeof value === "object" && value !== null && "value" in value) return context.number(value.value);
    const result = Number(value);
    assert.ok(Number.isFinite(result));
    return result;
  },
  point() { throw new Error("No projected source points allowed"); },
  geometry(value) { return geometries.get(String(value)); },
};
let checks = 0;
const gaps: string[] = [];
function close(actual: number, expected: number, name: string): void {
  checks++;
  assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${name}: ${actual} != ${expected}`);
}
function inputs(c: Case): Record<string, unknown> {
  return { initialPosition: [c.x0, 0], initialVelocity: [c.u, 0], acceleration: [c.a, 0], tMin: c.start, tMax: c.end, samples: 65, units: { length: "m", time: "s" } };
}
function document(c: Case, timeScale = 0.25): SceneDocument {
  const ids = ["motion", "position", "velocity", "acceleration"];
  return {
    schemaVersion: "scene-document/v2",
    source: { question: `In an inertial Cartesian frame (+x right, y=0), at t=0 s a body has x=${c.x0} m and signed velocity ${c.u} m/s. Its constant signed acceleration is ${c.a} m/s^2. Display the motion for ${c.start} <= t <= ${c.end} s. Find signed position, displacement from t=0, and velocity at t=${c.time} s. Velocity/acceleration arrow lengths are separately scaled illustrations, not displacement. No multiple-choice options.` },
    visualDecision: { mode: "scene", reason: "Explicit constant-acceleration source with exact state" },
    quantities: [],
    entities: [
      { id: "motion", kind: "polyline", role: "physical trajectory, not a time graph" },
      { id: "position", kind: "point", role: "computed physical position", label: `x=${c.x} m` },
      { id: "velocity", kind: "vector", role: "scaled velocity illustration", label: `vx=${c.v} m/s` },
      { id: "acceleration", kind: "vector", role: "scaled acceleration illustration", label: `ax=${c.a} m/s^2` },
    ],
    constructions: [
      { id: "make_motion", operator: "constant_acceleration_trajectory", inputs: inputs(c), outputs: ["motion"] },
      { id: "make_state", operator: "trajectory_state", inputs: { trajectory: "motion", time: c.time, kind: "state", timeScale }, outputs: ["position", "velocity", "acceleration"] },
    ],
    relations: [],
    assertions: [{ id: "state_incidence", predicate: "incident", entities: ["position", "motion"], tolerance: 1e-8, severity: "fatal" }],
    annotations: [],
    requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "show computed motion and state" }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "reveal verified source-bound state" }],
  };
}
function reject(scene: SceneDocument, name: string): void {
  const result = compileSceneDocument(scene);
  checks++;
  assert.ok(!result.ok && result.renderScene === null, `${name} must reject atomically: ${JSON.stringify(result.report.issues)}`);
}
const results: unknown[] = [];
for (const c of freeze.cases) {
  const trajectory = evaluateKinematicsConstruction("constant_acceleration_trajectory", inputs(c), context)[0]!;
  geometries.set("motion", trajectory);
  assert.ok(trajectory.sampledCurve);
  const curve = trajectory.sampledCurve;
  for (const t of [c.start, c.start + (c.end - c.start) * 0.375, c.time, c.end]) {
    const point = curve.evaluate(t);
    const derivative = curve.derivative(t);
    const expectedX = c.x0 + c.u * t + c.a * t * t / 2;
    const expectedV = c.u + c.a * t;
    close(point.x, expectedX, `${c.id} analytic position`);
    close(point.y, 0, `${c.id} frame y`);
    close(derivative.x, expectedV, `${c.id} analytic derivative`);
    close(derivative.y, 0, `${c.id} derivative y`);
    const s = point.x - c.x0;
    close(s, c.u * t + c.a * t * t / 2, "s=ut+at²/2");
    close(s, derivative.x * t - c.a * t * t / 2, "s=vt-at²/2");
    close(s, (c.u + derivative.x) * t / 2, "s=(u+v)t/2");
    close(derivative.x * derivative.x, c.u * c.u + 2 * c.a * s, "v²=u²+2as");
  }
  close(curve.evaluate(c.time).x, c.x, `${c.id} literal independent position`);
  close(curve.derivative(c.time).x, c.v, `${c.id} literal independent velocity`);
  close(curve.evaluate(c.time).x - c.x0, c.s, `${c.id} literal signed displacement`);
  const reflected = evaluateKinematicsConstruction("constant_acceleration_trajectory", { ...inputs(c), initialPosition: [-c.x0, 0], initialVelocity: [-c.u, 0], acceleration: [-c.a, 0] }, context)[0]!;
  assert.ok(reflected.sampledCurve);
  close(reflected.sampledCurve.evaluate(c.time).x, -c.x, "reversed axis position");
  close(reflected.sampledCurve.derivative(c.time).x, -c.v, "reversed axis velocity");
  close(reflected.kinematicTrajectory!.acceleration.x, -c.a, "reversed axis acceleration");
  for (const timeScale of [0.25, 2]) {
    const states = evaluateKinematicsConstruction("trajectory_state", { trajectory: "motion", time: c.time, kind: "state", timeScale }, context);
    if (c.v === 0) assert.equal(states[1]!.kind, "point");
    if (c.a === 0) assert.equal(states[2]!.kind, "point");
    for (const state of states) {
      assert.ok(state.kinematicState);
      close(state.kinematicState.position.x, c.x, "display scale does not change position");
      close(state.kinematicState.velocity.x, c.v, "display scale does not change velocity");
      close(state.kinematicState.acceleration.x, c.a, "display scale does not change acceleration");
      assert.deepEqual(state.kinematicState.sourceUnits, { length: "m", time: "s" });
    }
  }
  const scene = document(c);
  const compiled = compileSceneDocument(scene);
  assert.ok(compiled.ok && compiled.renderScene, `${c.id}: ${JSON.stringify(compiled.report.issues)}`);
  assert.ok(compiled.renderScene.primitives.every(p => p.points.every(q => Number.isFinite(q.x) && Number.isFinite(q.y))));
  const zeroIds = [c.v === 0 ? "velocity" : "", c.a === 0 ? "acceleration" : ""].filter(Boolean);
  for (const id of zeroIds) assert.ok(!compiled.renderScene.primitives.some(p => p.entityId === id && p.kind === "vector"), "zero states cannot acquire fake arrows");
  writeFileSync(resolve(out, `${c.id}.scene.json`), JSON.stringify(scene, null, 2));
  writeFileSync(resolve(out, `${c.id}.render.json`), JSON.stringify(compiled.renderScene, null, 2));
  writeFileSync(resolve(out, `${c.id}.svg`), renderSceneSvg(compiled.renderScene, { title: `SUVAT ${c.id} — OFFLINE`, subtitle: `Inertial +x right; m,s; domain [${c.start},${c.end}]; s=${c.s} m; arrows nonmetric` }));
  const stale = document(c);
  stale.entities[1]!.label = `x=${c.x + 1} m`;
  reject(stale, `${c.id} stale position label`);
  const outside = document(c);
  outside.constructions[1]!.inputs.time = c.end + 1;
  reject(outside, `${c.id} outside time domain`);
  const before = document(c);
  before.constructions[1]!.inputs.time = c.start - 1;
  reject(before, `${c.id} before declared forward-time domain`);
  const wrongTimeUnit = document(c);
  wrongTimeUnit.constructions[1]!.inputs.time = { value: c.time, unit: "min" };
  reject(wrongTimeUnit, `${c.id} minutes cannot silently become seconds`);
  const mixed = document(c);
  mixed.constructions[0]!.inputs.initialVelocity = [{ value: c.u, unit: "cm/s" }, 0];
  reject(mixed, `${c.id} incompatible source units`);
  const extra = document(c);
  extra.constructions[1]!.inputs.velocity = [c.v + 1, 0];
  reject(extra, `${c.id} incompatible supplied state input`);
  results.push({ id: c.id, x: c.x, v: c.v, displacement: c.s, offlineCompiled: true });
}
const positive = freeze.cases[0]!;
for (const kind of ["contradictory-source-text", "contradictory-source-quantity"] as const) {
  const scene = document(positive);
  if (kind === "contradictory-source-text") scene.source.question += ` The supplied position at t=${positive.time} s is ${positive.x + 1} m.`;
  else scene.quantities.push({ id: "supplied_position", symbol: "x", value: positive.x + 1, unit: "m" });
  const result = compileSceneDocument(scene);
  writeFileSync(resolve(out, `${kind}.scene.json`), JSON.stringify(scene, null, 2));
  writeFileSync(resolve(out, `${kind}.result.json`), JSON.stringify(result, null, 2));
  if (result.ok || result.renderScene !== null) gaps.push(`${kind}: compiler accepted contradictory supplied position omitted by the construction`);
}
const authorityCases = [
  { id: "consistent", suppliedX: 27, derivedV: 14, expected: "incomplete" },
  { id: "false_given_equation", suppliedX: 28, derivedV: 14, expected: "incomplete" },
  { id: "false_derived", suppliedX: 27, derivedV: 15, expected: "contradiction" },
  { id: "unbound_requested", suppliedX: 27, derivedV: 14, expected: "incomplete" },
  { id: "omitted_given_equation", suppliedX: 28, derivedV: 14, expected: "verified" },
  { id: "free_scalar_given", suppliedX: 27, derivedV: 14, expected: "verified" },
  { id: "unsupported_scalar_given", suppliedX: 27, derivedV: 14, expected: "incomplete" },
  { id: "function_relation", suppliedX: 27, derivedV: 14, expected: "verified" },
  { id: "requested_equation", suppliedX: 28, derivedV: 14, expected: "verified" },
  { id: "false_given_no_requests", suppliedX: 28, derivedV: 14, expected: "incomplete" },
  { id: "true_given_no_requests", suppliedX: 27, derivedV: 14, expected: "incomplete" },
  { id: "false_given_swapped_sides", suppliedX: 28, derivedV: 14, expected: "incomplete" },
  { id: "free_x_equals_zero", suppliedX: 27, derivedV: 14, expected: "verified" },
  { id: "free_x_equals_one", suppliedX: 27, derivedV: 14, expected: "verified" },
  { id: "free_x_equals_zero_swapped", suppliedX: 27, derivedV: 14, expected: "verified" },
  { id: "free_x_equals_one_swapped", suppliedX: 27, derivedV: 14, expected: "verified" },
  { id: "bound_consistent", suppliedX: 27, derivedV: 14, expected: "verified" },
  { id: "bound_false_given", suppliedX: 28, derivedV: 14, expected: "contradiction" },
  { id: "bound_tiny_zero", suppliedX: 1e-10, derivedV: 14, expected: "contradiction" },
  { id: "bound_tiny_zero_swapped", suppliedX: 1e-10, derivedV: 14, expected: "contradiction" },
  { id: "bound_incompatible_dimensions", suppliedX: 1, derivedV: 14, expected: "incomplete" },
  { id: "bound_equivalent_mixed_units", suppliedX: 1, derivedV: 14, expected: "incomplete" },
  { id: "bound_cancellation_zero", suppliedX: 0, derivedV: 14, expected: "incomplete" },
] as const;
const authorityResults = [];
for (const c of authorityCases) {
  const bound = c.id.startsWith("bound_");
  const leftUnit = c.id === "bound_equivalent_mixed_units" ? "cm" : "m";
  const rightUnit = c.id === "bound_incompatible_dimensions" ? "s" : "m";
  const leftValue = c.id.includes("tiny_zero") || c.id === "bound_cancellation_zero" ? 0 : c.id === "bound_incompatible_dimensions" ? 1 : c.id === "bound_equivalent_mixed_units" ? 100 : 27;
  const initial = bound ? `Given A=${leftValue} ${leftUnit} and B=${c.suppliedX} ${rightUnit}, compare A and B.` : "In an inertial +x frame at t=0 s, x0=3 m, u=2 m/s, and constant acceleration a=4 m/s^2.";
  const supplied = bound ? `The supplied B is ${c.suppliedX} ${rightUnit}.` : `At t=3 s the supplied position is ${c.suppliedX} m.`;
  const requested = bound ? "Find A and B in their declared units. Also find the velocity given by 2+12 m/s." : "Find velocity at t=3 s.";
  const question = `${initial} ${supplied} ${requested}`;
  const fact = (id: string, kind: "given" | "requested", quote: string) => ({ id, kind, statement: quote, evidence: { source: "question" as const, start: question.indexOf(quote), end: question.indexOf(quote) + quote.length, quote } });
  const problem: ProblemIR = {
    schemaVersion: "problem-ir/v1", id: c.id, question,
    facts: [fact("initial", "given", initial), fact("supplied", "given", supplied), fact("requested", "requested", requested)],
    entities: [{ id: "body", kind: "body", evidenceFactIds: ["initial"] }],
    expressions: [
      { id: "computed_x", valueType: "scalar", root: { kind: "binary", operator: "+", left: { kind: "number", value: 3 }, right: { kind: "binary", operator: "+", left: { kind: "binary", operator: "*", left: { kind: "number", value: 2 }, right: { kind: "number", value: 3 } }, right: { kind: "binary", operator: "/", left: { kind: "binary", operator: "*", left: { kind: "number", value: 4 }, right: { kind: "binary", operator: "^", left: { kind: "number", value: 3 }, right: { kind: "number", value: 2 } } }, right: { kind: "number", value: 2 } } } }, evidenceFactIds: ["initial", "supplied"] },
      { id: "supplied_x", valueType: "scalar", root: { kind: "number", value: c.suppliedX }, evidenceFactIds: ["supplied"] },
      { id: "computed_v", valueType: "scalar", root: { kind: "binary", operator: "+", left: { kind: "number", value: 2 }, right: { kind: "binary", operator: "*", left: { kind: "number", value: 4 }, right: { kind: "number", value: 3 } } }, evidenceFactIds: ["initial", "requested"] },
    ],
    constraints: [{ id: "supplied_state_consistency", kind: "equation", leftExpressionId: "computed_x", rightExpressionId: "supplied_x", evidenceFactIds: ["initial", "supplied"] }],
    representationIntents: [],
    solveRequests: [{ id: "velocity_request", kind: "evaluate", expressionId: "computed_v", ...(c.id === "unbound_requested" ? {} : { resultBinding: { turnPlanQuantityId: "velocity", symbol: "v", unit: "m/s", evidenceFactIds: ["requested"] } }) }],
  };
  const plan: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3", question,
    givens: [{ id: "supplied_position", symbol: "x", value: c.suppliedX, unit: "m", provenance: "given", sourceText: supplied }],
    unknowns: [{ id: "velocity", symbol: "v", unit: "m/s" }],
    derived: [{ id: "velocity", symbol: "v", value: c.derivedV, unit: "m/s", provenance: "derived" }],
    qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
  };
  if (bound) {
    plan.givens = [];
    problem.expressions[0]!.root = { kind: "number", value: leftValue };
    for (const [id, expressionId, value, unit] of [["left_result", "computed_x", leftValue, leftUnit], ["right_result", "supplied_x", c.suppliedX, rightUnit]] as const) {
      problem.solveRequests.push({ id: `evaluate_${id}`, kind: "evaluate", expressionId, resultBinding: { turnPlanQuantityId: id, symbol: id, unit, evidenceFactIds: ["requested"] } });
      plan.unknowns.push({ id, symbol: id, unit });
      plan.derived.push({ id, symbol: id, value, unit, provenance: "derived" });
    }
    if (c.id === "bound_tiny_zero_swapped") {
      const equation = problem.constraints[0]!;
      if (equation.kind !== "equation") throw new Error("Expected equation control");
      [equation.leftExpressionId, equation.rightExpressionId] = [equation.rightExpressionId, equation.leftExpressionId];
    }
    if (c.id === "bound_cancellation_zero") problem.expressions[0]!.root = { kind: "binary", operator: "-", left: { kind: "binary", operator: "-", left: { kind: "number", value: 0.3 }, right: { kind: "number", value: 0.1 } }, right: { kind: "number", value: 0.2 } };
  }
  if (c.id === "omitted_given_equation") problem.constraints = [];
  if (c.id === "requested_equation") problem.constraints[0]!.evidenceFactIds = ["requested"];
  if (c.id === "free_scalar_given") problem.expressions[0]!.root = { kind: "variable", name: "unknown_position" };
  if (c.id.startsWith("free_x_equals_")) {
    problem.expressions[0]!.root = { kind: "variable", name: "x" };
    problem.expressions[1]!.root = { kind: "number", value: c.id.includes("zero") ? 0 : 1 };
    if (c.id.endsWith("swapped")) {
      const equation = problem.constraints[0]!;
      if (equation.kind !== "equation") throw new Error("Expected equation control");
      [equation.leftExpressionId, equation.rightExpressionId] = [equation.rightExpressionId, equation.leftExpressionId];
    }
  }
  if (c.id === "unsupported_scalar_given") problem.expressions[0]!.root = { kind: "call", function: "sqrt", argument: { kind: "number", value: -1 } };
  if (c.id === "function_relation") {
    problem.expressions[0]!.valueType = "function";
    problem.expressions[0]!.root = { kind: "variable", name: "x" };
  }
  if (c.id === "false_given_no_requests" || c.id === "true_given_no_requests") {
    problem.solveRequests = [];
    plan.unknowns = [];
    plan.derived = [];
  }
  if (c.id === "false_given_swapped_sides") {
    const equation = problem.constraints[0]!;
    if (equation.kind !== "equation") throw new Error("Expected equation control");
    [equation.leftExpressionId, equation.rightExpressionId] = [equation.rightExpressionId, equation.leftExpressionId];
  }
  const pv = validateProblemIR(problem, question);
  const tv = validateTurnPlanV3(plan, question);
  assert.ok(pv.valid, JSON.stringify(pv.issues));
  if (c.id.startsWith("free_x_equals_")) assert.equal(pv.problem?.expressions[0]?.root.kind, "variable", "Scalar x AST must be admitted intact before closedness audit");
  assert.ok(tv.plan, JSON.stringify(tv.issues));
  const solver = await new LocalDeterministicSolverProvider().solve(problem);
  assert.ok(validateSolverResult(solver, problem).valid);
  const audit = verifyTurnPlanAgainstSolver(problem, solver, plan, question);
  assert.equal(audit.status, c.expected, `${c.id}: ${JSON.stringify(audit.issues)}`);
  const reconciled = reconcileTurnPlanWithSolver(plan, problem, solver);
  assert.deepEqual(reconciled.givens, plan.givens, "Given roles cannot be rewritten as derived values");
  const publicResponse = await planAndSolveProblemV1(question, plan, {
    proxyUrl: "https://offline.invalid/not-called", timeoutMs: 1000,
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(problem) } }] }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.ok(publicResponse, "Existing public consumer must return typed authority");
  assert.equal(publicResponse.audit.status, c.expected, `Public consumer ${c.id}`);
  assert.equal(publicResponse.projection !== null, c.expected === "verified");
  assert.equal(publicResponse.problemIR.constraints.length, problem.constraints.length);
  checks += 8;
  authorityResults.push({ id: c.id, status: audit.status, publicStatus: publicResponse.audit.status, projectionCreated: publicResponse.projection !== null });
  writeFileSync(resolve(out, `fixed-public-${c.id}.json`), JSON.stringify({ problem, plan, problemValidation: { valid: pv.valid, issues: pv.issues }, planValidation: { valid: tv.plan !== null, issues: tv.issues }, solver, audit, publicResponse }, null, 2));
}
const report = { topic: freeze.topic, status: gaps.length ? "DECLARED_UNIT_EQUATIONS_CHECKED_S0_COMPLETENESS_PENDING" : "OFFLINE_QUALIFICATION_PENDING_INTEGRATION", checks, cases: results, authorityCases: authorityResults, gaps, live: "NOT_RUN", storage: "NOT_RUN", replay: "NOT_RUN", acceptedCountDelta: 0 };
writeFileSync(resolve(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (gaps.length) process.exitCode = 1;
