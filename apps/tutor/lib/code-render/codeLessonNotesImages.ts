import { codeLessonBlockById, type CodeLessonPlan } from "@heytutor/tutor-core";
import { parseStoredSegmentCommands } from "@heytutor/drawing";
import { revealedSectionText } from "@/features/tutor-session/lib/code-lesson/codeLessonController";
import { DSA_CODE_PANEL_RECT } from "@/features/tutor-session/constants";
import { storedCodeLessonPlan } from "@/lib/code-lesson/persistedCodeLesson";
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
 * Append rendered code pages to the notes section of each DSA turn. Sections
 * are matched by question in turn order, mirroring how the section builder
 * paired board pages with turns.
 */
export function appendCodeLessonNotesImages(
  sections: NotesPdfSection[],
  storedTurns: readonly StoredTurn[],
  capturedReveal?: CodeLessonNotesReveal | null,
): void {
  let nextSection = 0;
  for (const turn of storedTurns) {
    const plan = storedCodeLessonPlan(turn.sceneArtifacts);
    if (!plan) continue;
    const index = sections.findIndex(
      (section, sectionIndex) =>
        sectionIndex >= nextSection && section.question === turn.question,
    );
    if (index === -1) continue;
    const revealed = capturedReveal?.turnId === turn.id && JSON.stringify(capturedReveal.plan) === JSON.stringify(plan)
      ? capturedReveal.revealedChars
      : recordedCodeReveal(turn, plan);
    sections[index]!.images.push(...codeLessonNotesImages(plan, revealed));
    nextSection = index + 1;
  }
}
