/**
 * Later figures inside one lesson (DIAGRAM_LESSON_FIGURES, phase 3), planned
 * offline: pure, no network, no extra LLM call.
 *
 * Each view the planner picked (`plan.figures`, a closed figure kind id) is
 * drawn only by the engine's own fast selector (hand coded families,
 * chemistry families, archetypes), exactly as a doubt figure is:
 *
 * 1. the lesson's reconciled plan is restamped to the question composed from
 *    the lesson question and the engine's own name for the view
 *    (`composeLessonFigureQuestion`); no planner word is in it;
 * 2. `selectFastFigure` then the lesson's own admission (`selectProductionScene`,
 *    fast_family only) choose and check the figure, which must be of the
 *    picked kind.
 *
 * A figure equal to the first or an earlier one is a redraw and is refused; a
 * figure with a part named like an advance cue is refused; a figure whose
 * family the engine did not already read from the lesson question itself is
 * refused (the view picks a kind of the same situation, it never brings in a
 * body the lesson does not have); a miss drops that figure only.
 */
import type { SceneDocument, TurnPlanV3 } from "@heytutor/scene-engine";
import type { NarrationLanguage, ProblemAuthorityV1Response } from "@heytutor/tutor-core";
import { verifiedDiagramHasDrawableInk, type TutorSegment, type VerifiedDiagram } from "@heytutor/drawing";
import {
  LESSON_FIGURES_VERSION,
  composeLessonFigureQuestion,
  figureCollidesWithAdvanceIds,
  lessonFigureAsksOf,
  type LessonFigureAsk,
  type LessonFigureId,
  type LessonFiguresArtifact,
} from "@/lib/boards/lessonFigures";
import { isReferencePictureDiagram } from "../scene/referencePicturePresentation";
import type { SelectedRepresentation } from "../scene/representationFallback";
import { deriveSceneGate, selectProductionScene } from "../scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../scene/verifiedScenePresentation";
import { applyDeterministicSourceAuthority, figureFingerprint, selectFastFigure } from "./doubtFigurePlan";

export interface PlannedLessonFigure {
  ask: LessonFigureAsk;
  /** The composed question the scene was planned on and the server recomputes. */
  question: string;
  turnPlan: TurnPlanV3;
  representation: SelectedRepresentation;
  presentation: { diagram: VerifiedDiagram; introSegments: TutorSegment[] };
}

export type LessonFigureMissReason =
  | "no_fast_figure" | "same_figure" | "id_collision" | "budget" | "no_first_figure" | "not_lesson_family"
  /** The selector drew another kind than the one picked. */
  | "not_picked_view";

export interface LessonFigurePlanResult {
  figures: PlannedLessonFigure[];
  misses: Array<{ id: LessonFigureId; reason: LessonFigureMissReason }>;
}

/** A part named like an advance cue would make `[FOCUS:figure_2]` ambiguous (shared with the server). */
const collidesWithAdvanceIds = figureCollidesWithAdvanceIds;

export function planLessonFigures(input: {
  lessonQuestion: string;
  /** The lesson's reconciled plan (after reconcilePlanWithAuthority), validated on the lesson question. */
  turnPlan: TurnPlanV3;
  authority: ProblemAuthorityV1Response | null;
  /**
   * The lesson's scene families (its gate's sceneCapabilities.families). The
   * composed question's own reading orders the selector; an extra figure's
   * family must be one of these.
   */
  families: readonly string[];
  /** Figure 1, as drawn. Extra figures are attempted only when it drew and is not a picture. */
  first: VerifiedDiagram;
  narrationLanguage: NarrationLanguage;
  /** Absolute ms on `now`'s clock; a figure not started by then is a budget miss. */
  deadlineAt: number;
  /** The picked views; absent, read from `turnPlan.figures`. */
  asks?: readonly LessonFigureAsk[];
  now?: () => number;
}): LessonFigurePlanResult {
  const now = input.now ?? Date.now;
  const asks = input.asks ?? lessonFigureAsksOf(input.turnPlan);
  const result: LessonFigurePlanResult = { figures: [], misses: [] };
  if (asks.length === 0) return result;
  if (!verifiedDiagramHasDrawableInk(input.first) || isReferencePictureDiagram(input.first)) {
    result.misses.push(...asks.map((ask) => ({ id: ask.id, reason: "no_first_figure" as const })));
    return result;
  }
  if (collidesWithAdvanceIds(input.first)) {
    result.misses.push(...asks.map((ask) => ({ id: ask.id, reason: "id_collision" as const })));
    return result;
  }
  const seen = [figureFingerprint(input.first)];
  for (const ask of asks) {
    if (now() > input.deadlineAt) {
      result.misses.push({ id: ask.id, reason: "budget" });
      continue;
    }
    const planned = planOne(input, ask);
    if ("reason" in planned) {
      result.misses.push({ id: ask.id, reason: planned.reason });
      continue;
    }
    if (collidesWithAdvanceIds(planned.presentation.diagram)) {
      result.misses.push({ id: ask.id, reason: "id_collision" });
      continue;
    }
    const fingerprint = figureFingerprint(planned.presentation.diagram);
    if (seen.includes(fingerprint)) {
      result.misses.push({ id: ask.id, reason: "same_figure" });
      continue;
    }
    seen.push(fingerprint);
    result.figures.push(planned);
  }
  return result;
}

function planOne(
  input: Parameters<typeof planLessonFigures>[0],
  ask: LessonFigureAsk,
): PlannedLessonFigure | { reason: LessonFigureMissReason } {
  const question = composeLessonFigureQuestion(input.lessonQuestion, ask.view);
  const restamped = withoutPlanFigures({ ...input.turnPlan, question });
  const turnPlan = applyDeterministicSourceAuthority(question, restamped, input.authority, () => {});
  const problemIR = input.authority?.problemIR ?? null;
  const gate = deriveSceneGate({ question, turnPlan, problemIR, conversationContext: "" });
  const families = [...new Set([ask.view, ...gate.sceneCapabilities.families, ...input.families])];
  const fast = selectFastFigure({ question, turnPlan, authority: input.authority, families });
  if (!fast) return { reason: "no_fast_figure" };
  // The lesson's own admission: law only leads, readable ink, save checks.
  const selection = selectProductionScene({
    question, turnPlan, problemIR, conversationContext: "",
    sceneCapabilities: gate.sceneCapabilities, fastRepresentation: fast,
    requiredRetryEnabled: false, completionEnabled: false,
    solverAuthority: input.authority ? { problemIR: input.authority.problemIR, solverResult: input.authority.solverResult } : null,
    policy: { allowedFigureSources: ["fast_family"] },
  });
  const representation = selection.representation;
  if (!representation || representation.figureSource !== "fast_family" ||
    (representation.sceneDocument as SceneDocument).visualDecision.mode !== "scene") {
    return { reason: "no_fast_figure" };
  }
  if (!representation.family || !input.families.includes(representation.family)) return { reason: "not_lesson_family" };
  if (representation.family !== ask.view) return { reason: "not_picked_view" };
  const presentation = buildVerifiedDiagramPresentation(representation.sceneDocument, representation.renderScene, {
    originalQuestion: question,
    narrationLanguage: input.narrationLanguage,
    turnPlan,
    ...(representation.family ? { figureFamily: representation.family } : {}),
  });
  if (!verifiedDiagramHasDrawableInk(presentation.diagram)) return { reason: "no_fast_figure" };
  return { ask, question, turnPlan, representation, presentation };
}

/** The plan's own `figures` entries never travel into a figure's plan. */
function withoutPlanFigures(plan: TurnPlanV3): TurnPlanV3 {
  if (!Object.hasOwn(plan, "figures")) return plan;
  const copy = { ...plan } as TurnPlanV3 & { figures?: unknown };
  delete copy.figures;
  return copy;
}

/** sceneArtifacts.lessonFigures for the lesson turn: the documents only; the server rebuilds the rest. */
export function lessonFiguresArtifact(figures: readonly PlannedLessonFigure[]): LessonFiguresArtifact {
  return {
    schemaVersion: LESSON_FIGURES_VERSION,
    figures: figures.map((figure) => ({
      id: figure.ask.id,
      view: figure.ask.view,
      sceneDocument: figure.representation.sceneDocument,
      tier: figure.representation.tier,
      family: figure.ask.view,
      figureSource: "fast_family" as const,
    })),
  };
}
