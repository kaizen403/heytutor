/**
 * A stored lesson's later figures (DIAGRAM_LESSON_FIGURES, phase 3c), the
 * `restoreDsaFrames` analogue.
 *
 * Figure k has no trusted rows: like a worked example's frames it is rebuilt
 * from what was saved on every surface. The lesson turn stores each later
 * figure's document (the server's own admitted copy) and its view id;
 * the figure is checked and compiled again on the lesson question composed
 * with that view, with the lesson's plan restamped to it, exactly as the
 * server admitted it (`admitLessonFigures`; both derive question and plan
 * with `lessonFigureSceneInput`, as the live plan does). A figure whose document was not
 * planned on that composed question is dropped, never drawn.
 *
 * Replay, restore, export and the lecture player commit the sequence at the
 * page's lesson source, so a stored `[FOCUS:figure_k]` runs through the same
 * executor branch it ran through live.
 */
import { compileSceneDocument, validateSceneDocument } from "@heytutor/scene-engine";
import { isStoredCommandTrustedGeometry, verifiedDiagramHasDrawableInk } from "@heytutor/drawing";
import type { NarrationLanguage } from "@heytutor/tutor-core";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { storedTurnSceneQuestion } from "@/lib/boards/doubtFigure";
import { figureCollidesWithAdvanceIds, isLessonFigureAdvanceId, lessonFigureSceneInput, lessonFiguresOf } from "@/lib/boards/lessonFigures";
import type { PageFigureId } from "@/lib/boards/pageFigure";
import { storedTurnSourceIssues } from "@/lib/scene/storedSceneSource";
import type { LessonFigureSequence, PlannedLessonFigureView } from "./lessonFigureSequence";
import { restoreVerifiedPresentationFromTurn } from "./restoreVerifiedDiagram";
import { buildVerifiedDiagramPresentation } from "./verifiedScenePresentation";

export type LessonFigureTurn = Pick<StoredTurn, "question" | "sceneArtifacts" | "sceneDocument" | "segments"> &
  Partial<Pick<StoredTurn, "visualStatus">>;

function normalizeQuestion(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/** The voice the lesson's intro was recorded in, read as the server reads it. */
export function storedTurnNarrationLanguage(turn: Pick<StoredTurn, "segments">): NarrationLanguage | undefined {
  return turn.segments.some((segment) =>
    isStoredCommandTrustedGeometry(segment.command) && /\p{Script=Devanagari}/u.test(segment.narration),
  ) ? "hinglish" : undefined;
}

/**
 * Each later figure a stored lesson turn carries, rebuilt on its composed
 * question. A figure that does not rebuild is left out (its advance draws
 * nothing, as live when a figure was dropped).
 */
export function restoreLessonFigureViews(
  turn: LessonFigureTurn | null | undefined,
  narrationLanguage?: NarrationLanguage,
): PlannedLessonFigureView[] {
  const artifact = turn ? lessonFiguresOf(turn.sceneArtifacts) : null;
  if (!turn || !artifact) return [];
  const lessonQuestion = storedTurnSceneQuestion(turn);
  if (typeof lessonQuestion !== "string" || !lessonQuestion.trim()) return [];
  const rawPlan = turn.sceneArtifacts && typeof turn.sceneArtifacts === "object"
    ? Object.getOwnPropertyDescriptor(turn.sceneArtifacts, "turnPlan")?.value
    : undefined;
  const language = narrationLanguage ?? storedTurnNarrationLanguage(turn);
  const views: PlannedLessonFigureView[] = [];
  for (const figure of artifact.figures) {
    try {
      const { question, turnPlan: plan } = lessonFigureSceneInput(lessonQuestion, rawPlan, figure.view);
      const structural = validateSceneDocument(figure.sceneDocument);
      const document = structural.document;
      if (!document || document.visualDecision.mode !== "scene") continue;
      // Planned and admitted on the composed question, never the lesson's own.
      if (typeof document.source.question !== "string" ||
        normalizeQuestion(document.source.question) !== normalizeQuestion(question)) continue;
      if (storedTurnSourceIssues(document, { question }).some((issue) => issue.severity === "fatal")) continue;
      const compiled = compileSceneDocument(document, {});
      if (!compiled.ok || !compiled.renderScene) continue;
      const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene, {
        originalQuestion: question,
        ...(language ? { narrationLanguage: language } : {}),
        ...(plan ? { turnPlan: plan } : {}),
        ...(figure.family ? { figureFamily: figure.family } : {}),
      });
      // As the server drops it (`admitLessonFigures`): a part named like a cue.
      if (!verifiedDiagramHasDrawableInk(presentation.diagram) || figureCollidesWithAdvanceIds(presentation.diagram)) continue;
      views.push({ id: figure.id, diagram: presentation.diagram, introSegments: presentation.introSegments, family: figure.family });
    } catch {
      continue;
    }
  }
  return views;
}

/**
 * Commit a stored lesson's later figures on `sequence`, or reset it. `turn` is
 * the page's lesson source (the opener, or the resume that drew the figure).
 * A turn with no stored later figure, or whose own figure does not rebuild,
 * leaves no sequence: flag off, nothing changes. `at`: the figure already in
 * the zone (a resume returning figure k), so only later cues advance.
 */
export function restoreLessonFigures(
  sequence: LessonFigureSequence | null | undefined,
  turn: LessonFigureTurn | null | undefined,
  narrationLanguage?: NarrationLanguage,
  at: PageFigureId = "figure_1",
): void {
  if (!sequence) return;
  sequence.reset();
  if (!turn || !lessonFiguresOf(turn.sceneArtifacts)) return;
  if (turn.visualStatus !== undefined && turn.visualStatus !== "validated") return;
  const first = restoreVerifiedPresentationFromTurn(turn, narrationLanguage);
  if (!first || first.diagram.layout === "code_lesson" || figureCollidesWithAdvanceIds(first.diagram)) return;
  const views = restoreLessonFigureViews(turn, narrationLanguage);
  if (views.length === 0) return;
  sequence.commit({ diagram: first.diagram, introSegments: first.introSegments }, views);
  // The surface draws figure `at` whole itself: a seek, never a pending advance (round 3 M1).
  if (isLessonFigureAdvanceId(at)) sequence.seekTo(at);
}
