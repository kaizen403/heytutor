/**
 * SOLVER_DISAGREEMENT_STOPS: a plan value that disagrees with the solver beyond rounding is kept, not overwritten.
 *
 * ProblemIR is written by a model that saw the plan, so its arithmetic is no independent authority. Overwriting wrote a
 * false value over a right plan, and the audit then called it verified. With the switch on, only a rounding of the
 * solver's value is overwritten. A real disagreement stays, the audit reports a contradiction, and the existing path
 * stops the lesson before narration, and the turn carries that value no further, so a later doubt or Continue cannot
 * teach it. A value certified from the source still corrects the plan. With the switch off, which is the default, nothing
 * changes; the proof of that across commits is a replay against dev, since this gate runs on one tree. The save path reads
 * no switch. Every stem and number here is authored.
 *
 *   pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-solver-disagreement.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LocalDeterministicSolverProvider,
  reconcileTurnPlanWithSolver,
  validateProblemIR,
  validateSolverResult,
  validateTurnPlanV3,
  verifyTurnPlanAgainstSolver,
  type ProblemIR,
  type SolverResult,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { resolveDoubtFiguresEnabled } from "../../lib/boards/doubtFigure";
import { resolveSolverDisagreementStops } from "../../lib/scene/diagramStrategy.server";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { planDoubtFigure, reconcilePlanWithAuthority } from "../../features/tutor-session/lib/turn/doubtFigurePlan";

const STEM = "The lines x + y = 5 and x - y = 1 meet at P. Find P.";
const num = (value: number) => ({ kind: "number", value });

function problemFor(question: string, requests: { id: string; value: number; unit?: string }[]): ProblemIR {
  const fact = (id: string, kind: string) => ({ id, kind, statement: kind, evidence: { source: "question", start: 0, end: question.length, quote: question } });
  const raw = {
    schemaVersion: "problem-ir/v1", id: "problem", question,
    facts: [fact("fGiven", "given"), fact("fAsked", "requested")],
    entities: [{ id: "body", kind: "body", label: "body", evidenceFactIds: ["fGiven"] }],
    expressions: requests.map((r) => ({ id: `e_${r.id}`, valueType: "scalar", root: num(r.value), evidenceFactIds: ["fGiven"] })),
    constraints: [], representationIntents: [],
    solveRequests: requests.map((r) => ({ id: `s_${r.id}`, kind: "evaluate", expressionId: `e_${r.id}`, resultBinding: { turnPlanQuantityId: r.id, symbol: r.id, ...(r.unit ? { unit: r.unit } : {}), evidenceFactIds: ["fAsked"] } })),
  };
  const validated = validateProblemIR(raw, question);
  assert.ok(validated.problem, JSON.stringify(validated.issues).slice(0, 300));
  return validated.problem!;
}
function planFor(question: string, values: { id: string; value: number; unit?: string }[]): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [],
    unknowns: values.map(({ id, unit }) => ({ id, symbol: id, ...(unit ? { unit } : {}) })),
    derived: values.map(({ id, value, unit }) => ({ id, symbol: id, value, ...(unit ? { unit } : {}), provenance: "derived", dependsOn: [], sourceText: `${id} = ${value}` })),
    qualitativeClaims: [], lawIds: [], assumptions: [],
  } as unknown as TurnPlanV3;
}
async function solve(problem: ProblemIR): Promise<SolverResult> {
  const checked = validateSolverResult(await new LocalDeterministicSolverProvider().solve(problem), problem);
  assert.equal(checked.result?.status, "solved");
  return checked.result!;
}
const valueOf = (plan: TurnPlanV3, id: string) => plan.derived.find((quantity) => quantity.id === id)?.value;

let checks = 0;
const failures: string[] = [];
const check = async (name: string, run: () => void | Promise<void>) => {
  checks += 1;
  try { await run(); } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`); }
};
const source = (path: string) => readFileSync(join(__dirname, "../..", path), "utf8");

async function main() {
  const rightPlan = planFor(STEM, [{ id: "x", value: 3 }, { id: "y", value: 2 }]);
  const falseProblem = problemFor(STEM, [{ id: "x", value: 3 }, { id: "y", value: -7 }]);
  const falseResult = await solve(falseProblem);
  const authority = () => ({ problemIR: falseProblem, solverResult: falseResult, audit: verifyTurnPlanAgainstSolver(falseProblem, falseResult, rightPlan, STEM), projection: null, rawContent: "", elapsedMs: 0 }) as never;

  // Switch off: exactly what dev does, whichever way the option is left off.
  const dev = reconcileTurnPlanWithSolver(rightPlan, falseProblem, falseResult);
  await check("off: the disagreement is overwritten, as dev", () => {
    assert.equal(valueOf(dev, "y"), -7);
    assert.equal(verifyTurnPlanAgainstSolver(falseProblem, falseResult, dev, STEM).status, "verified");
    assert.match(String(dev.derived.find((quantity) => quantity.id === "y")?.sourceText), /^Solver-verified/);
  });
  await check("off: every way of leaving it off gives the same bytes", () => {
    for (const options of [undefined, {}, { keepDisagreement: false }, { keepDisagreement: undefined }]) {
      assert.equal(JSON.stringify(reconcileTurnPlanWithSolver(rightPlan, falseProblem, falseResult, options)), JSON.stringify(dev));
    }
  });
  await check("off: the shared call gives the same bytes with and without the argument", () => {
    const quiet = () => undefined;
    const bare = reconcilePlanWithAuthority(STEM, rightPlan, authority(), quiet as never);
    const off = reconcilePlanWithAuthority(STEM, rightPlan, authority(), quiet as never, { keepDisagreement: false });
    assert.equal(JSON.stringify(off), JSON.stringify(bare));
    assert.equal(valueOf(bare.turnPlan, "y"), -7);
    assert.equal((bare.authority as { audit: { status: string } }).audit.status, "verified");
  });

  // Switch on: a real disagreement stays, and the audit says so.
  const kept = reconcileTurnPlanWithSolver(rightPlan, falseProblem, falseResult, { keepDisagreement: true });
  await check("on: a disagreement is not overwritten", () => {
    assert.equal(valueOf(kept, "y"), 2);
    assert.equal(kept, rightPlan, "nothing changed, so the same plan comes back");
  });
  await check("on: the audit reports the disagreement", () => {
    const audit = verifyTurnPlanAgainstSolver(falseProblem, falseResult, kept, STEM);
    assert.equal(audit.status, "contradiction");
    assert.ok(audit.issues.some((issue) => issue.code === "solver_turnplan_contradiction"));
  });
  await check("on: the shared call ends in a contradiction with no projection", () => {
    const quiet = () => undefined;
    const on = reconcilePlanWithAuthority(STEM, rightPlan, authority(), quiet as never, { keepDisagreement: true });
    assert.equal((on.authority as { audit: { status: string } }).audit.status, "contradiction");
    assert.equal((on.authority as { projection: unknown }).projection, null);
  });
  await check("on: the turn carries the disagreed value no further, and keeps the rest", () => {
    const quiet = () => undefined;
    const on = reconcilePlanWithAuthority(STEM, rightPlan, authority(), quiet as never, { keepDisagreement: true });
    assert.equal(valueOf(on.turnPlan, "y"), undefined);
    assert.ok(!on.turnPlan.unknowns.some((quantity) => quantity.id === "y"));
    assert.equal(valueOf(on.turnPlan, "x"), 3);
    assert.ok(validateTurnPlanV3(on.turnPlan, STEM).plan, "the plan that is left is still valid");
  });
  await check("on: anything worked from the disagreed value goes with it, and its claims", () => {
    const quiet = () => undefined;
    const chained = {
      ...rightPlan,
      unknowns: [...rightPlan.unknowns, { id: "z", symbol: "z" }, { id: "w", symbol: "w" }],
      derived: [...rightPlan.derived,
        { id: "w", symbol: "w", value: 8, provenance: "derived", dependsOn: ["z"], sourceText: "w = 2z" },
        { id: "z", symbol: "z", value: 4, provenance: "derived", dependsOn: ["y"], sourceText: "z = 2y" }],
      qualitativeClaims: [{ id: "c1", claim: "y is positive", expected: "y is positive", relatedQuantityIds: ["y"] }, { id: "c2", claim: "x is positive", expected: "x is positive", relatedQuantityIds: ["x"] }],
    } as unknown as TurnPlanV3;
    const audit = verifyTurnPlanAgainstSolver(falseProblem, falseResult, chained, STEM);
    const on = reconcilePlanWithAuthority(STEM, chained, { problemIR: falseProblem, solverResult: falseResult, audit, projection: null, rawContent: "", elapsedMs: 0 } as never, quiet as never, { keepDisagreement: true });
    assert.deepEqual(on.turnPlan.derived.map((quantity) => quantity.id), ["x"]);
    assert.deepEqual(on.turnPlan.qualitativeClaims.map((claim) => claim.id), ["c2"]);
  });
  await check("off: a contradiction the overwrite cannot reach is carried as dev carries it", () => {
    const quiet = () => undefined;
    const unlisted = { ...rightPlan, unknowns: rightPlan.unknowns.filter((quantity) => quantity.id !== "y") } as TurnPlanV3;
    const audit = verifyTurnPlanAgainstSolver(falseProblem, falseResult, unlisted, STEM);
    const off = reconcilePlanWithAuthority(STEM, unlisted, { problemIR: falseProblem, solverResult: falseResult, audit, projection: null, rawContent: "", elapsedMs: 0 } as never, quiet as never);
    assert.equal((off.authority as { audit: { status: string } }).audit.status, "contradiction", "the fixture is a contradiction with the switch off");
    assert.equal(valueOf(off.turnPlan, "y"), 2, "dev carries it, and the switch off must too");
    const on = reconcilePlanWithAuthority(STEM, unlisted, { problemIR: falseProblem, solverResult: falseResult, audit, projection: null, rawContent: "", elapsedMs: 0 } as never, quiet as never, { keepDisagreement: true });
    assert.equal(valueOf(on.turnPlan, "y"), undefined, "the switch on withdraws it");
  });
  await check("on: only a disagreed value is withdrawn, not a quantity another issue names", async () => {
    const quiet = () => undefined;
    const problem = problemFor(STEM, [{ id: "x", value: 3, unit: "m" }, { id: "y", value: -7 }]);
    const result = await solve(problem);
    const mixed = planFor(STEM, [{ id: "x", value: 3, unit: "cm" }, { id: "y", value: 2 }]);
    const audit = verifyTurnPlanAgainstSolver(problem, result, mixed, STEM);
    assert.ok(audit.issues.some((issue) => issue.code === "unit_mismatch" && issue.quantityId === "x"), "the fixture names x in another issue");
    const on = reconcilePlanWithAuthority(STEM, mixed, { problemIR: problem, solverResult: result, audit, projection: null, rawContent: "", elapsedMs: 0 } as never, quiet as never, { keepDisagreement: true });
    assert.equal(valueOf(on.turnPlan, "y"), undefined);
    assert.equal(valueOf(on.turnPlan, "x"), 3, "a unit issue is not a disagreement about the value");
  });
  await check("on: where the audit names no disagreed value, the turn goes exactly as dev", async () => {
    // The circuit source authority replaces the resistance the kept charge was worked from. With no time given the
    // kept plan's audit is incomplete, so the kept charge would be taught. With the time given the kept charge breaks
    // the plan's own Q = I t, so the lesson stops on a contradiction that names no value, and the plan it carries
    // would still hold the kept charge. Neither may happen, so in both the switch changes nothing.
    const quiet = () => undefined;
    const question = "Two resistors of 4 ohm and 6 ohm are connected in series to a 10 V battery. Find the current and the charge that flows in 5 s.";
    const problem = problemFor(question, [{ id: "Q", value: 5, unit: "C" }]);
    const result = await solve(problem);
    const given = (id: string, symbol: string, value: number, unit: string) => ({ id, symbol, value, unit, provenance: "given", sourceText: `${value} ${unit}` });
    for (const timeGiven of [false, true]) {
      const circuit = {
        schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
        givens: [given("R1", "R_1", 4, "ohm"), given("R2", "R_2", 6, "ohm"), given("V", "V", 10, "V"), ...(timeGiven ? [given("t", "t", 5, "s")] : [])],
        unknowns: [{ id: "I", symbol: "I", unit: "A" }, { id: "Q", symbol: "Q", unit: "C" }],
        derived: [
          { id: "Rs", symbol: "R_s", value: 12, unit: "ohm", provenance: "derived", dependsOn: ["R1", "R2"], sourceText: "series sum" },
          { id: "I", symbol: "I", value: 0.83, unit: "A", provenance: "derived", dependsOn: ["V", "Rs"], sourceText: "Ohm law" },
          { id: "Q", symbol: "Q", value: 4.15, unit: "C", provenance: "derived", dependsOn: ["I"], sourceText: "Q = I t" },
        ], qualitativeClaims: [], lawIds: ["ohms_law"], assumptions: [],
      } as unknown as TurnPlanV3;
      const audit = verifyTurnPlanAgainstSolver(problem, result, circuit, question);
      const authorityFor = () => ({ problemIR: problem, solverResult: result, audit, projection: null, rawContent: "", elapsedMs: 0 }) as never;
      const off = reconcilePlanWithAuthority(question, circuit, authorityFor(), quiet as never);
      const on = reconcilePlanWithAuthority(question, circuit, authorityFor(), quiet as never, { keepDisagreement: true });
      const label = timeGiven ? "time given" : "no time given";
      assert.notEqual((off.authority as { audit: { status: string } }).audit.status, "contradiction", `${label}: the fixture does not stop as dev`);
      assert.equal(JSON.stringify(on), JSON.stringify(off), `${label}: the switch on changes nothing here`);
      assert.notEqual(valueOf(on.turnPlan, "Q"), 4.15, `${label}: the kept value is not taught or carried`);
    }
  });
  await check("on: a model written uncertainty does not let a disagreement pass", () => {
    const loose = planFor(STEM, [{ id: "x", value: 3 }, { id: "y", value: 2 }]);
    (loose.derived[1] as { uncertainty?: number }).uncertainty = 10;
    const next = reconcileTurnPlanWithSolver(loose, falseProblem, falseResult, { keepDisagreement: true });
    assert.equal(valueOf(next, "y"), 2);
    assert.equal(verifyTurnPlanAgainstSolver(falseProblem, falseResult, next, STEM).status, "contradiction");
  });

  // What counts as rounding.
  const within: [string, number, number][] = [
    ["a rounded decimal", 3.2, 3.2026],
    ["two places", 3.2, 3.204],
    ["three figures on a large value", 399, 398.63],
    ["a round number within 1 percent", 400, 398.63],
    ["a whole number within half its place and 5 percent", 2, 2.05],
    ["a negative value", -3.2, -3.2026],
    ["a small decimal", 0.0012, 0.00121],
    ["a small fraction", 0.67, 0.6667],
    ["a whole number within half its place, under 5 percent", 21, 20.6],
  ];
  for (const [name, planValue, solverValue] of within) {
    await check(`on: ${name} is corrected`, async () => {
      const problem = problemFor(STEM, [{ id: "a", value: solverValue }]);
      const result = await solve(problem);
      const next = reconcileTurnPlanWithSolver(planFor(STEM, [{ id: "a", value: planValue }]), problem, result, { keepDisagreement: true });
      assert.equal(valueOf(next, "a"), solverValue);
      assert.equal(verifyTurnPlanAgainstSolver(problem, result, next, STEM).status, "verified");
    });
  }
  const beyond: [string, number, number][] = [
    ["a whole number 10 percent off", 3, 3.3],
    ["a false coordinate", 2, -7],
    ["a sign flip", 3.2, -3.2026],
    ["a value against zero", 0.4, 0],
    ["a stated decimal 2 percent off", 3.27, 3.2026],
    ["a stated decimal under 2 percent off", 3.26, 3.2026],
    ["ten times too large", 32, 3.2026],
    ["a small value in exponent form 5 percent off", 1.2e-7, 1.26e-7],
  ];
  for (const [name, planValue, solverValue] of beyond) {
    await check(`on: ${name} is kept and reported`, async () => {
      const problem = problemFor(STEM, [{ id: "a", value: solverValue }]);
      const result = await solve(problem);
      const next = reconcileTurnPlanWithSolver(planFor(STEM, [{ id: "a", value: planValue }]), problem, result, { keepDisagreement: true });
      assert.equal(valueOf(next, "a"), planValue);
      assert.equal(verifyTurnPlanAgainstSolver(problem, result, next, STEM).status, "contradiction");
    });
    await check(`off: ${name} is overwritten, as dev`, async () => {
      const problem = problemFor(STEM, [{ id: "a", value: solverValue }]);
      const next = reconcileTurnPlanWithSolver(planFor(STEM, [{ id: "a", value: planValue }]), problem, await solve(problem));
      assert.equal(valueOf(next, "a"), solverValue);
    });
  }
  await check("on: a value the solver already agrees with returns the same plan", async () => {
    const problem = problemFor(STEM, [{ id: "a", value: 23.5 }]);
    const plan = planFor(STEM, [{ id: "a", value: 23.5 }]);
    assert.equal(reconcileTurnPlanWithSolver(plan, problem, await solve(problem), { keepDisagreement: true }), plan);
  });

  // A value certified from the source keeps its authority, switch on or off.
  await check("on: a source certified boundary still corrects a stale plan", async () => {
    const question = "On a number line, solve x > 2 and x < 5. Find the left boundary and right boundary.";
    const quote = (text: string) => ({ source: "question", start: question.indexOf(text), end: question.indexOf(text) + text.length, quote: text });
    const x = { kind: "variable", name: "x" };
    const raw = {
      schemaVersion: "problem-ir/v1", id: "interval", question,
      facts: [{ id: "lower", kind: "given", statement: "x > 2", evidence: quote("x > 2") }, { id: "upper", kind: "given", statement: "x < 5", evidence: quote("x < 5") }, { id: "boundaries", kind: "requested", statement: "boundaries", evidence: quote("Find the left boundary") }],
      entities: [], representationIntents: [],
      expressions: [
        { id: "x", valueType: "scalar", root: x, evidenceFactIds: ["lower", "upper"] }, { id: "two", valueType: "scalar", root: num(2), evidenceFactIds: ["lower"] }, { id: "five", valueType: "scalar", root: num(5), evidenceFactIds: ["upper"] },
        { id: "leftRoot", valueType: "function", root: { kind: "binary", operator: "-", left: x, right: num(2) }, evidenceFactIds: ["lower"] },
        { id: "rightRoot", valueType: "function", root: { kind: "binary", operator: "-", left: x, right: num(5) }, evidenceFactIds: ["upper"] },
      ],
      constraints: [
        { id: "lowerConstraint", kind: "inequality", leftExpressionId: "x", rightExpressionId: "two", relation: ">", evidenceFactIds: ["lower"] },
        { id: "upperConstraint", kind: "inequality", leftExpressionId: "x", rightExpressionId: "five", relation: "<", evidenceFactIds: ["upper"] },
      ],
      solveRequests: [
        { id: "findLeft", kind: "roots", expressionId: "leftRoot", variable: "x", domain: { min: -10, max: 10 }, resultBinding: { turnPlanQuantityId: "left", symbol: "left boundary", evidenceFactIds: ["boundaries"] } },
        { id: "findRight", kind: "roots", expressionId: "rightRoot", variable: "x", domain: { min: -10, max: 10 }, resultBinding: { turnPlanQuantityId: "right", symbol: "right boundary", evidenceFactIds: ["boundaries"] } },
      ],
    };
    const validated = validateProblemIR(raw, question);
    assert.ok(validated.problem, JSON.stringify(validated.issues).slice(0, 200));
    const result = await solve(validated.problem!);
    const stale = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], unknowns: [{ id: "left", symbol: "left boundary" }, { id: "right", symbol: "right boundary" }], derived: [{ id: "left", symbol: "left boundary", value: 9, provenance: "derived" }, { id: "right", symbol: "right boundary", value: 5, provenance: "derived" }], qualitativeClaims: [], lawIds: [], assumptions: [] } as unknown as TurnPlanV3;
    assert.equal(valueOf(reconcileTurnPlanWithSolver(stale, validated.problem!, result), "left"), 2, "as dev");
    assert.equal(valueOf(reconcileTurnPlanWithSolver(stale, validated.problem!, result, { keepDisagreement: true }), "left"), 2, "with the switch on");
  });

  // A contradiction draws nothing, which the existing path already holds. The twin shows the same candidate draws without it.
  const figureFor = (question: string) => ({
    schemaVersion: "scene-document/v2", source: { question, nonMetric: true, representationTier: "qualitative_verified" },
    visualDecision: { mode: "scene", reason: "a segment" }, quantities: [],
    entities: [{ id: "a", kind: "point", role: "endpoint", label: "A" }, { id: "b", kind: "point", role: "endpoint", label: "B" }, { id: "ab", kind: "segment", role: "segment", label: "AB" }],
    constructions: [{ id: "pa", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] }, { id: "pb", operator: "point", inputs: { x: 3, y: 0 }, outputs: ["b"] }, { id: "sab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] }],
    relations: [], assertions: [{ id: "exists", predicate: "exists", entities: ["ab"], expected: true, severity: "fatal" }],
    annotations: [], requiredEntityIds: ["a", "b", "ab"],
    revealGroups: [{ id: "setup", entityIds: ["a", "b", "ab"], dependsOn: [], narrationCue: "Draw AB." }],
    teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Draw AB." }],
  });
  const STRICT = { preferPlanner: true, allowedFigureSources: ["planner", "verified_recovery", "linear_source", "text_only"] };
  await check("the same candidate draws with no contradiction, and nothing under one", () => {
    const pick = (solverAuthorityBlocked: boolean) => selectProductionScene({ question: STEM, turnPlan: kept, problemIR: null, candidate: figureFor(STEM), requiredRetryEnabled: true, solverAuthorityBlocked, exactFigureSource: "planner", policy: STRICT } as never);
    assert.ok(pick(false).representation, "the twin draws, so the refusal below is the contradiction's");
    assert.equal(pick(true).representation, null);
  });

  // A doubt's figure, which production has off.
  const doubt = async (keepSolverDisagreement: boolean | undefined) => {
    const question = `${STEM}\n\nStudent's doubt: why does the second line slope up?`;
    const doubtPlan = { ...rightPlan, question };
    const problem = problemFor(question, [{ id: "x", value: 3 }, { id: "y", value: -7 }]);
    const result = await solve(problem);
    const outcome = await planDoubtFigure({
      lessonQuestion: STEM, doubtTitle: "why does the second line slope up?", zoneFigure: null,
      deadlineAt: Date.now() + 60_000, signal: new AbortController().signal, debug: (() => undefined) as never,
      ...(keepSolverDisagreement === undefined ? {} : { keepSolverDisagreement }),
      planners: {
        planTurn: async () => ({ turnPlan: doubtPlan }) as never,
        planAuthority: async () => ({ problemIR: problem, solverResult: result, audit: verifyTurnPlanAgainstSolver(problem, result, doubtPlan, question), projection: null, rawContent: "", elapsedMs: 0 }) as never,
      },
    });
    const { elapsedMs: _elapsed, ...rest } = outcome as { elapsedMs: number };
    return rest;
  };
  await check("the doubt figures switch is off unless exactly on", () => {
    assert.equal(resolveDoubtFiguresEnabled({}), false);
    assert.equal(resolveDoubtFiguresEnabled({ DIAGRAM_DOUBT_FIGURES: "1" }), false);
  });
  await check("off: planDoubtFigure gives the same outcome with and without the argument", async () => {
    assert.equal(JSON.stringify(await doubt(false)), JSON.stringify(await doubt(undefined)));
    assert.notDeepEqual(await doubt(undefined), { status: "miss", reason: "solver_contradiction" });
  });
  await check("on: planDoubtFigure misses on the contradiction", async () => {
    assert.deepEqual(await doubt(true), { status: "miss", reason: "solver_contradiction" });
  });

  // The switch and its wiring.
  await check("the switch is off unless on", () => {
    for (const raw of [undefined, "", "off", "1", "true", "yes"]) assert.equal(resolveSolverDisagreementStops(raw), false, String(raw));
    for (const raw of ["on", " ON "]) assert.equal(resolveSolverDisagreementStops(raw), true, raw);
    assert.equal(resolveSolverDisagreementStops(undefined), false);
  });
  await check("begin turn sends nothing new with the switch off", () => {
    assert.ok(source("app/api/billing/begin-turn/route.ts").includes("...(resolveSolverDisagreementStops() ? { solverDisagreementStops: true } : {}),"));
  });
  await check("the client grants it only on an exact true", () => {
    assert.ok(source("lib/billing/billingClient.ts").includes("solverDisagreementStops: payload.solverDisagreementStops === true,"));
  });
  await check("the lesson passes the grant to the shared call", () => {
    assert.ok(source("features/tutor-session/hooks/turn/useQuestionHandler.ts").includes("reconcilePlanWithAuthority(question, planToReconcile, authority, undefined, { keepDisagreement: billed.solverDisagreementStops === true });"));
  });
  await check("the doubt passes the grant to planDoubtFigure", () => {
    assert.ok(source("features/tutor-session/hooks/turn/useQuestionHandler.ts").includes("keepSolverDisagreement: billed.solverDisagreementStops === true,"));
  });
  await check("the lab keeps a disagreement only where the audit names it, as the lesson does", () => {
    const lab = source("scripts/lecture-lab/lecturePipeline.ts");
    assert.ok(lab.includes("keepDisagreement ? { keepDisagreement: true } : {},"), "the lab passes nothing new with the switch off");
    assert.ok(lab.includes("const keep = resolveSolverDisagreementStops();\n        let reconciled = reconcile(keep);\n        if (keep && !reconciled.audit.issues.some((issue) => issue.code === \"solver_turnplan_contradiction\")) reconciled = reconcile(false);"), "the lab falls back to dev where the audit names no value");
  });
  await check("the switch is named in the example env, commented out", () => {
    assert.ok(source(".env.example").includes("# SOLVER_DISAGREEMENT_STOPS=on"));
  });

  // Rule 3: the save path never overwrites and reads no switch, so a saved board behaves the same either way.
  await check("the save path does not call the overwrite", () => {
    assert.ok(!source("lib/scene/turnScenePersistence.ts").includes("reconcileTurnPlanWithSolver"));
    assert.ok(!source("lib/scene/sceneSaveAdmission.ts").includes("reconcileTurnPlanWithSolver"));
    assert.ok(!source("lib/scene/turnScenePersistence.ts").includes("SOLVER_DISAGREEMENT_STOPS"));
  });
  const figure = figureFor(STEM);
  const artifacts = (plan: TurnPlanV3, drawn: boolean) => ({
    schemaVersion: "scene-artifacts/v3", diagramResultStatus: drawn ? "ready" : "text_only", representationTier: drawn ? "qualitative_verified" : "text_only", nonMetric: true,
    figureSource: drawn ? "planner" : "text_only", turnPlan: plan, problemIR: falseProblem, solverResult: falseResult,
    boardContinuation: { schemaVersion: "board-continuation/v1", lessonQuestion: STEM },
  });
  const save = (plan: TurnPlanV3, drawn: boolean) => canonicalizeTurnSceneMetadata({
    question: STEM, sceneDocument: drawn ? figure : null, visualStatus: drawn ? "validated" : "text_only", sceneArtifacts: artifacts(plan, drawn),
    segments: [{ orderIndex: 0, narration: "Let us carry on.", command: null }],
  } as never, { kind: "resume" } as never);
  for (const flag of [undefined, "on"]) {
    const name = `save, switch ${flag ?? "unset"}`;
    const setSwitch = () => { if (flag) process.env.SOLVER_DISAGREEMENT_STOPS = flag; else delete process.env.SOLVER_DISAGREEMENT_STOPS; };
    await check(`${name}: a figure saved under an overwritten plan passes its resume save`, async () => {
      setSwitch();
      const result = await save(dev, true);
      assert.ok(result.ok, result.ok ? "" : `${result.code}: ${result.error}`);
    });
    await check(`${name}: a figure under a disagreeing plan is refused the same way`, async () => {
      setSwitch();
      const result = await save(rightPlan, true);
      assert.equal(result.ok, false);
      assert.equal((result as { code?: string }).code, "scene_solver_plan_contradiction");
    });
    await check(`${name}: the text of a stopped lesson saves, and carries no disagreed value`, async () => {
      setSwitch();
      const quiet = () => undefined;
      const carried = reconcilePlanWithAuthority(STEM, rightPlan, authority(), quiet as never, { keepDisagreement: true }).turnPlan;
      const result = await save(carried, false);
      assert.ok(result.ok, result.ok ? "" : `${result.code}: ${result.error}`);
      const stored = ((result as { value?: { sceneArtifacts?: { turnPlan?: TurnPlanV3 } } }).value?.sceneArtifacts?.turnPlan);
      assert.ok(stored, "the plan is stored");
      assert.equal(valueOf(stored!, "y"), undefined);
      assert.equal(valueOf(stored!, "x"), 3);
    });
  }
  delete process.env.SOLVER_DISAGREEMENT_STOPS;

  if (failures.length) {
    for (const failure of failures) console.log(`FAIL ${failure}`);
    console.log(`${failures.length} failed of ${checks}`);
    process.exit(1);
  }
  console.log(`pass: ${checks} checks, off is byte identical on both calls, on keeps a disagreement and reports it, rounding is still corrected, the save path reads no switch`);
}

void main();
