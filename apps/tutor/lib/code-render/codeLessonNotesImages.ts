import { codeLessonBlockById, type CodeLessonPlan } from "@heytutor/tutor-core";
import { parseStoredSegmentCommands } from "@heytutor/drawing";
import { revealedSectionText } from "@/features/tutor-session/lib/code-lesson/codeLessonController";
import { DSA_CODE_PANEL_RECT } from "@/features/tutor-session/constants";
import { parseStoredCodeLesson } from "@/lib/code-lesson/persistedCodeLesson";
import { storedTurnContinuesBoard, storedTurnPageQuestion } from "@/lib/boards/boardContinuation";
import type { NotesPdfSection } from "@/features/tutor-session/lib/notes/notesPdf";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { storedTurnStatus } from "@/lib/boards/boardsClient";
import {
  codePanelContentHeight,
  renderCodePanelFrame,
} from "./renderCodeToCanvas";

/**
 * One code page per revealed lesson section for the notes PDF. The
 * board snapshot of a DSA turn shows only the diagram — the code lives in a
 * DOM panel invisible to Konva capture — so notes composite these renders.
 */
function codeLessonNotesImages(plan: CodeLessonPlan, revealedChars: Record<string, number>, scale = 2): string[] {
  const images: string[] = [];
  for (const sectionIndex of plan.sections.keys()) {
    const code = revealedSectionText({ plan, revealedChars }, sectionIndex);
    if (!code) continue;
    const width = DSA_CODE_PANEL_RECT.width;
    const height = codePanelContentHeight(code);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.scale(scale, scale);
    renderCodePanelFrame(
      ctx,
      {
        chrome: {
          title: plan.title,
          language: plan.language,
          sectionTitle: plan.sections[sectionIndex]!.title,
          sectionIndex,
          sectionCount: plan.sections.length,
        },
        code,
        revealedChars: code.length,
        showCaret: false,
      },
      { x: 0, y: 0, width, height },
    );
    images.push(canvas.toDataURL("image/png"));
  }
  return images;
}

export type CodeLessonNotesReveal = {
  turnId: string;
  plan: CodeLessonPlan;
  revealedChars: Record<string, number>;
};

/** A completed turn proves its recorded TYPE rows, even without media timing.
 * In an unfinished turn, an untimed row can be either complete or a shown cut;
 * only the live reveal receipt can safely supply that ambiguous block's prefix.
 */
function recordedCodeReveal(turn: StoredTurn, plan: CodeLessonPlan): Record<string, number> {
  const revealed: Record<string, number> = {};
  const completed = storedTurnStatus({ status: turn.persistedStatus ?? turn.status, updatedAt: turn.updatedAt }) === "complete";
  for (const segment of turn.segments) {
    if (!completed && (segment.durationMs == null || segment.durationMs <= 0)) continue;
    for (const command of parseStoredSegmentCommands(segment.command)) {
      if (command.type !== "TYPE") continue;
      const id = command.semanticRef?.entityId ?? "";
      const located = codeLessonBlockById(plan, id);
      if (located) revealed[id] = located.block.code.length;
    }
  }
  return revealed;
}

/**
 * Append each DSA turn's cumulative shown code to its notes section. Receipts
 * only accumulate across same-question continuations of the same plan; a new
 * page or plan resets them. Sections match questions in stored turn order.
 */
export function appendCodeLessonNotesImages(
  sections: NotesPdfSection[],
  storedTurns: readonly StoredTurn[],
  capturedReveal?: CodeLessonNotesReveal | null,
): void {
  let nextSection = 0;
  let pageQuestion: string | null = null;
  let planKey: string | null = null;
  let revealed: Record<string, number> = {};
  for (const turn of storedTurns) {
    const question = storedTurnPageQuestion(turn).trim();
    if (!storedTurnContinuesBoard(turn) || question !== pageQuestion) {
      pageQuestion = question;
      planKey = null;
      revealed = {};
    }
    const index = sections.findIndex(
      (section, sectionIndex) =>
        sectionIndex >= nextSection && section.question === turn.question,
    );
    if (index !== -1) nextSection = index + 1;
    const parsed = parseStoredCodeLesson(turn.sceneArtifacts);
    if (parsed.status === "invalid") {
      planKey = null;
      revealed = {};
    }
    if (parsed.status !== "valid") continue;
    const plan = parsed.plan;
    const key = JSON.stringify(plan);
    if (key !== planKey || plan.question.trim() !== pageQuestion) {
      revealed = {};
      planKey = key;
    }
    if (plan.question.trim() !== pageQuestion) continue;
    const currentReveal = capturedReveal?.turnId === turn.id && JSON.stringify(capturedReveal.plan) === key
      ? capturedReveal.revealedChars
      : recordedCodeReveal(turn, plan);
    // A resume starts after the blocks earlier turns already typed. Retain only
    // same-page, same-plan receipts, never future turns or unrecorded plan code.
    for (const [id, count] of Object.entries(currentReveal)) {
      const block = codeLessonBlockById(plan, id)?.block;
      if (block && Number.isFinite(count)) {
        revealed[id] = Math.max(revealed[id] ?? 0, Math.min(block.code.length, Math.max(0, count)));
      }
    }
    if (index !== -1) sections[index]!.images.push(...codeLessonNotesImages(plan, revealed));
  }
}
