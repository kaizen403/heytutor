/**
 * SOLVER_DISAGREEMENT_STOPS: a plan value that disagrees with the solver beyond rounding is kept, not overwritten.
 *
 * ProblemIR is written by a model that saw the plan, so its arithmetic is no independent authority. Overwriting wrote a
 * false value over a right plan, and the audit then called it verified. With the switch on, only a rounding of the
 * solver's value is overwritten. A real disagreement stays, the audit reports a contradiction, and the existing path
 * stops the lesson before narration. With the switch off, which is the default, nothing changes. The save path reads no
 * switch. Every stem and number here is authored.
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
    assert.equal(valueOf(on.turnPlan, "y"), 2);
    assert.equal((on.authority as { audit: { status: string } }).audit.status, "contradiction");
    assert.equal((on.authority as { projection: unknown }).projection, null);
  });

  // What counts as rounding.
  const within: [string, number, number][] = [
    ["a rounded decimal", 3.2, 3.2026],
    ["two places", 3.2, 3.204],
    ["three figures on a large value", 399, 398.63],
    ["a round number within 1 percent", 400, 398.63],
    ["a whole number within half its place and 5 percent", 2, 2.05],
    ["a negative value", -3.2, -3.2026],
    ["an exponent form", 0.0012, 0.00121],
    ["a small fraction", 0.67, 0.6667],
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

  // A contradiction draws nothing, which the existing path already holds.
  await check("on: the selection draws nothing under the contradiction", () => {
    const selected = selectProductionScene({ question: STEM, turnPlan: kept, problemIR: falseProblem, candidate: null, requiredRetryEnabled: true, solverAuthorityBlocked: true, policy: { preferPlanner: true, allowedFigureSources: ["planner", "verified_recovery", "linear_source", "text_only"] } } as Parameters<typeof selectProductionScene>[0]);
    assert.equal(selected.representation, null);
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
  await check("the switch is named in the example env, commented out", () => {
    assert.ok(source(".env.example").includes("# SOLVER_DISAGREEMENT_STOPS=on"));
  });

  // Rule 3: the save path never overwrites and reads no switch, so a saved board behaves the same either way.
  await check("the save path does not call the overwrite", () => {
    assert.ok(!source("lib/scene/turnScenePersistence.ts").includes("reconcileTurnPlanWithSolver"));
    assert.ok(!source("lib/scene/sceneSaveAdmission.ts").includes("reconcileTurnPlanWithSolver"));
    assert.ok(!source("lib/scene/turnScenePersistence.ts").includes("SOLVER_DISAGREEMENT_STOPS"));
  });
  const figure = {
    schemaVersion: "scene-document/v2", source: { question: STEM, nonMetric: true, representationTier: "qualitative_verified" },
    visualDecision: { mode: "scene", reason: "a segment" }, quantities: [],
    entities: [{ id: "a", kind: "point", role: "endpoint", label: "A" }, { id: "b", kind: "point", role: "endpoint", label: "B" }, { id: "ab", kind: "segment", role: "segment", label: "AB" }],
    constructions: [{ id: "pa", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] }, { id: "pb", operator: "point", inputs: { x: 3, y: 0 }, outputs: ["b"] }, { id: "sab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] }],
    relations: [], assertions: [{ id: "exists", predicate: "exists", entities: ["ab"], expected: true, severity: "fatal" }],
    annotations: [], requiredEntityIds: ["a", "b", "ab"],
    revealGroups: [{ id: "setup", entityIds: ["a", "b", "ab"], dependsOn: [], narrationCue: "Draw AB." }],
    teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Draw AB." }],
  };
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
    await check(`${name}: the text of a lesson under a disagreeing plan still saves`, async () => {
      setSwitch();
      const result = await save(rightPlan, false);
      assert.ok(result.ok, result.ok ? "" : `${result.code}: ${result.error}`);
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
