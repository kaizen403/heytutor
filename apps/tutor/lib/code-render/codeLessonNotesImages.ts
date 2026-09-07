import { codeLessonSectionCode, type CodeLessonPlan } from "@heytutor/tutor-core";
import { DSA_CODE_PANEL_RECT } from "@/features/tutor-session/constants";
import { storedCodeLessonPlan } from "@/lib/code-lesson/persistedCodeLesson";
import type { NotesPdfSection } from "@/features/tutor-session/lib/notes/notesPdf";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import {
  codePanelContentHeight,
  renderCodePanelFrame,
} from "./renderCodeToCanvas";

/**
 * One fully-revealed code page per lesson section for the notes PDF. The
 * board snapshot of a DSA turn shows only the diagram — the code lives in a
 * DOM panel invisible to Konva capture — so notes composite these renders.
 */
export function codeLessonNotesImages(plan: CodeLessonPlan, scale = 2): string[] {
  const images: string[] = [];
  for (const [sectionIndex, section] of plan.sections.entries()) {
    const code = codeLessonSectionCode(section);
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
          sectionTitle: section.title,
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

/**
 * Append rendered code pages to the notes section of each DSA turn. Sections
 * are matched by question in turn order, mirroring how the section builder
 * paired board pages with turns.
 */
export function appendCodeLessonNotesImages(
  sections: NotesPdfSection[],
  storedTurns: readonly StoredTurn[],
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
    sections[index]!.images.push(...codeLessonNotesImages(plan));
    nextSection = index + 1;
  }
}
