/**
 * DIAGRAM_DOUBT_FIGURES, live: a doubt that needs a new figure plans,
 * verifies and draws one; every miss teaches on the old figure.
 *
 * Behaviour (planDoubtFigure with stub planners, no paid call):
 *   planTurnV3 and ProblemIR both start on the composed question; the fast
 *   tier is the only figure source; a figure equal to the zone's is refused;
 *   the 20 s budget falls back; a plan with unchecked numbers draws nothing.
 * Source (useQuestionHandler, both slice anchors guarded):
 *   flag off and "point" run no planner; the stash is set before swapFigureIn;
 *   the swapped figure's intro is the one the lesson enqueues; a resume calls
 *   returnPageFigure before it reads the zone's figure.
 * figureSwap.ts is never executed here (lane D fills its bodies).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProblemAuthorityV1Response, TurnPlanV3Response } from "@heytutor/tutor-core";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { composeDoubtFigureQuestion, doubtFigureOf } from "../../lib/boards/doubtFigure";
import {
  DOUBT_FIGURE_BUDGET_MS,
  doubtFigurePlannedScene,
  planDoubtFigure,
  sameFigureAsZone,
  type DoubtFigurePlanners,
} from "../../features/tutor-session/lib/turn/doubtFigurePlan";
import { consumedDeferredIds } from "../../features/tutor-session/lib/scene/figureSwap";
import { doubtFigureTurnScene } from "../../features/tutor-session/lib/turn/doubtTurn";

const root = resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");
function between(source: string, file: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert(from >= 0, `${file}: start anchor "${start}" is gone. Repoint this gate; do not relax it.`);
  const to = source.indexOf(end, from + start.length);
  assert(to > from, `${file}: end anchor "${end}" is gone after "${start}". Repoint this gate; do not relax it.`);
  return source.slice(from, to + end.length);
}

const lessonQuestion = "Derive the formula for the range of a projectile on level ground.";
const doubtTitle = "Doubt: show me the path when it is launched higher";
const composed = composeDoubtFigureQuestion(lessonQuestion, doubtTitle);
const planFor = (question: string, overrides: Partial<TurnPlanV3> = {}): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3",
  question,
  givens: [],
  unknowns: [{ id: "range", symbol: "R" }],
  derived: [],
  qualitativeClaims: [
    { id: "range", claim: "R = u^2 sin(2 theta) / g", expected: "u^2 sin(2 theta) / g", relatedQuantityIds: ["range"] },
  ],
  lawIds: ["constant-acceleration"],
  assumptions: ["Air resistance is negligible"],
  visualRequirement: "required",
  ...overrides,
});

interface Calls { turn: string[]; authority: string[]; authorityStartedBeforeTurnSettled: boolean }
function planners(options: {
  plan?: (question: string) => TurnPlanV3 | null;
  turnDelayMs?: number;
  authority?: ProblemAuthorityV1Response | null;
}, calls: Calls): DoubtFigurePlanners {
  let turnSettled = false;
  return {
    planTurn: async (question, run) => {
      calls.turn.push(question);
      assert(run.timeoutMs > 0 && run.timeoutMs <= DOUBT_FIGURE_BUDGET_MS, "the turn plan is bounded by the doubt budget");
      if (options.turnDelayMs) await new Promise((done) => setTimeout(done, options.turnDelayMs));
      turnSettled = true;
      const plan = (options.plan ?? planFor)(question);
      return plan ? { turnPlan: plan, rawContent: "", elapsedMs: 0 } satisfies TurnPlanV3Response : null;
    },
    planAuthority: async (question) => {
      calls.authority.push(question);
      calls.authorityStartedBeforeTurnSettled = !turnSettled;
      return options.authority ?? null;
    },
  };
}
const freshCalls = (): Calls => ({ turn: [], authority: [], authorityStartedBeforeTurnSettled: false });
const run = (planner: DoubtFigurePlanners, extra: Partial<Parameters<typeof planDoubtFigure>[0]> = {}) => planDoubtFigure({
  lessonQuestion, doubtTitle, zoneFigure: null,
  deadlineAt: Date.now() + DOUBT_FIGURE_BUDGET_MS,
  signal: new AbortController().signal,
  planners: planner,
  ...extra,
});

async function main(): Promise<void> {
  // 1. "new_figure": both planners run on the composed question, in parallel,
  // and the fast verified tier draws the figure.
  const calls = freshCalls();
  const drawn = await run(planners({}, calls));
  assert.deepEqual(calls.turn, [composed], "planTurnV3 runs on the composed question, never the doubt title");
  assert.deepEqual(calls.authority, [composed], "ProblemIR runs on the same composed question");
  assert(calls.authorityStartedBeforeTurnSettled, "ProblemIR starts beside the turn plan, not after it");
  assert.equal(drawn.status, "drawn", `the fixture doubt draws a fast figure (${drawn.status === "miss" ? drawn.reason : ""})`);
  if (drawn.status !== "drawn") throw new Error("unreachable");
  assert.equal(drawn.representation.figureSource, "fast_family", "v1 doubts draw from the fast tier only");
  assert.equal(drawn.question, composed, "the drawn figure carries the composed question the server recomputes");
  assert(drawn.presentation.introSegments.length > 0, "the figure has intro segments for enqueueVerifiedIntro");

  // 2. The doubt's saved scene: validated, the marker, the continuation, the plan.
  {
    const scene = doubtFigureTurnScene(doubtFigurePlannedScene(drawn), lessonQuestion, "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b");
    assert.equal(scene.visualStatus, "validated", "the doubt row is a validated scene");
    const artifacts = scene.sceneArtifacts as Record<string, unknown>;
    assert.deepEqual(doubtFigureOf(artifacts)?.replacedTurnId, "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", "the marker names the figure it replaced");
    assert(artifacts.boardContinuation, "the doubt stays on the lesson's page");
    assert.equal(artifacts.turnPlan, drawn.turnPlan, "the reconciled plan the figure came from is saved with it");
  }

  // 3. A figure equal to the one already in the zone is a redraw: refused.
  {
    const again = await run(planners({}, freshCalls()), { zoneFigure: drawn.presentation.diagram });
    assert(sameFigureAsZone(drawn.presentation.diagram, drawn.presentation.diagram), "a figure equals itself");
    assert.equal(again.status, "miss", "a figure equal to the zone's figure is never swapped in");
    assert.equal(again.status === "miss" ? again.reason : null, "same_figure", "the redraw is refused as same_figure");
  }

  // 4. The budget: a turn plan that lands after the deadline falls back.
  {
    const late = await run(planners({ turnDelayMs: 120 }, freshCalls()), { deadlineAt: Date.now() + 30 });
    assert.equal(late.status === "miss" ? late.reason : late.status, "budget_exhausted", "past the budget the doubt teaches on the old figure");
    const spent = await run(planners({}, freshCalls()), { deadlineAt: Date.now() - 1 });
    assert.equal(spent.status === "miss" ? spent.reason : spent.status, "budget_exhausted", "a budget already spent draws nothing");
  }

  // 5. Rule 4: a plan whose numbers need the solver draws nothing without it.
  {
    const numericQuestion = "A projectile is launched at 20 m/s and an angle of 30 degrees on level ground. Find its range.";
    const numeric = await planDoubtFigure({
      lessonQuestion: numericQuestion, doubtTitle, zoneFigure: null,
      deadlineAt: Date.now() + DOUBT_FIGURE_BUDGET_MS, signal: new AbortController().signal,
      planners: planners({ plan: (question) => planFor(question, {
        givens: [
          { id: "u", symbol: "u", value: 20, unit: "m/s", provenance: "given" },
          { id: "theta", symbol: "theta", value: 30, unit: "deg", provenance: "given" },
          { id: "g", symbol: "g", value: 9.8, unit: "m/s^2", provenance: "given" },
        ],
        unknowns: [{ id: "range", symbol: "R", unit: "m" }],
        derived: [{ id: "range", symbol: "R", value: 99, unit: "m", provenance: "derived", sourceText: "R = 99" }],
        qualitativeClaims: [],
      }) }, freshCalls()),
    });
    assert.equal(numeric.status, "miss", "a planner scalar the solver never checked cannot reach a figure");
  }

  // 6. No turn plan, no figure.
  {
    const none = await run(planners({ plan: () => null }, freshCalls()));
    assert.equal(none.status === "miss" ? none.reason : none.status, "turn_plan_unavailable", "a failed turn plan teaches on the old figure");
  }

  // 7. The live deferred state the stash hands returnPageFigure.
  {
    const fresh = { ...drawn.presentation.diagram, deferredAnnotations: [
      { entityId: "a", commands: [] }, { entityId: "b", commands: [] }, { entityId: "c", commands: [], revealAfterLesson: true },
    ] };
    const live = { ...fresh, deferredAnnotations: [{ entityId: "b", commands: [] }, { entityId: "c", commands: [], revealAfterLesson: true }] };
    assert.deepEqual(consumedDeferredIds(fresh, live), ["a"], "only the marks the student already saw come back drawn");
  }

  // 8. The live turn, from source.
  {
    const file = "features/tutor-session/hooks/turn/useQuestionHandler.ts";
    const handler = read(file);
    const plan = between(handler, file, "if (doubt && doubtFiguresGranted) {\n        // doubt-figure-plan:begin", "// doubt-figure-plan:end");
    assert(handler.includes("const doubtFiguresGranted = billed.doubtFigures === true;"), "flag off is the begin-turn grant");
    const askIndex = plan.indexOf("requestDoubtFigureNeed(");
    const skipIndex = plan.indexOf("const need = skip\n          ? { decision: \"point\" as const, reason: skip }");
    assert(skipIndex >= 0 && askIndex > skipIndex, "a skipped need check answers point without asking");
    const onNeed = plan.indexOf("if (need.decision === \"new_figure\") {");
    assert(onNeed > askIndex && plan.indexOf("planDoubtFigure(") > onNeed, "only new_figure plans; point runs no planner");
    assert(plan.indexOf("doubtFigureHoldingSegment(") > onNeed && plan.indexOf("doubtFigureHoldingSegment(") < plan.indexOf("planDoubtFigure("),
      "the holding line is spoken once, before the figure plans");
    assert(/deadlineAt: doubtStartedAt \+ DOUBT_FIGURE_BUDGET_MS/.test(plan), "the budget runs from the doubt's start");
    assert(!/planScene|requestReferencePicture|selectProductionScene\(\{[^}]*candidateValidation/.test(plan),
      "no LLM scene planner and no reference picture in a doubt");

    const swap = between(handler, file, "// doubt-figure-swap:begin", "// doubt-figure-swap:end");
    const stashSet = swap.indexOf("page.zoneStash = stash;");
    const swapCall = swap.indexOf("await swapFigureIn(");
    assert(stashSet >= 0 && swapCall > stashSet, "the zone's figure is stashed on the page before the zone is cleared");
    assert(swap.indexOf("sceneV2IntroSegments = drawn.presentation.introSegments;") > swapCall,
      "the swapped figure's intro is the one the lesson's enqueueVerifiedIntro draws");
    assert(swap.indexOf("page.zoneStash = previousStash;") > swapCall, "a refused swap leaves the stash as it was");

    const resume = between(handler, file, "} else if (resume) {", "diagramSource = activeDiagram ? (isReferencePictureDiagram(activeDiagram)");
    const returnCall = resume.indexOf("await returnPageFigure(");
    const refRead = resume.indexOf("activeDiagram = figureReturned || resume.figureDrawn || resume.codeLesson ? activeVerifiedDiagramRef.current : null;");
    assert(returnCall >= 0, "a resume with a zone stash returns the lesson's figure");
    assert(refRead > returnCall, "the resume returns the lesson's figure before it reads the zone's ref");
    assert(/pageRecord!\.zoneStash = null;\s*page\.zoneStash = null;/.test(resume), "the stash is cleared once returned");
    assert(/consumedDeferredIds\(zoneStash\.presentation\.diagram, zoneStash\.diagram\),\s*\{ shouldCancel: \(\) => !isCurrentTurn\(\), executeCommand: executeCommandWithCancel \}/.test(resume),
      "the return gets the pristine presentation, the live consumed ids and the board's executor");
    const reload = resume.indexOf("returnFigureToZone(");
    assert(reload > returnCall && refRead > reload, "after a reload, returnsFigure redraws the stored figure before the ref is read");
    assert(resume.includes("source ? storedFigurePresentation(source) : { diagram: null, introSegments: [] }"), "the stored turn's own figure ink comes back");
    assert(swap.includes("page.figureDrawn = false;"), "the swap clears figureDrawn; enqueueVerifiedIntro sets it on commit");
    assert(swap.includes("page.turn.scene = doubtFigureTurnScene(doubtFigurePlannedScene(drawn), page.lessonQuestion, page.zoneStash?.turnId ?? null);"),
      "the doubt row is its own scene, planned on the composed question, marked with the stashed figure");
    assert(!/page\.turnPlan = |page\.solverProjection = /.test(swap), "the record keeps the lesson's plan and projection");
    assert(resume.includes("activeDiagram && !figureReturned && !resume.codeLesson && resume.remainingIntro?.length"),
      "a returned figure comes back whole: the stopped intro remainder is dropped");
  }
}

main().then(() => console.log("doubt figure live verification passed"), (error: unknown) => {
  console.error(error);
  process.exit(1);
});
