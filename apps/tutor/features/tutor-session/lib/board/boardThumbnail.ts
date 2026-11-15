import type { WhiteboardHandle } from "@heytutor/whiteboard";
import { renderCodePanelFrame } from "@/lib/code-render/renderCodeToCanvas";
import { BOARD_WIDTH, BOARD_HEIGHT, DSA_CODE_PANEL_RECT } from "../../constants";
import { revealedSectionText, type CodeLessonState } from "../code-lesson/codeLessonController";

/** Photograph the finished page, including DOM code, without a pen or caret. */
export async function captureBoardThumbnail(board: Pick<WhiteboardHandle, "captureFrame"> | null, codeState?: CodeLessonState): Promise<Blob | null> {
  const frame = board?.captureFrame({ pixelRatio: 1, hideCursor: true });
  if (!frame) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 600;
  canvas.height = 350;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
  const plan = codeState?.plan;
  if (plan && codeState.mode !== "hidden") {
    const sectionIndex = codeState.activeSectionIndex;
    const code = revealedSectionText(codeState, sectionIndex);
    ctx.scale(canvas.width / BOARD_WIDTH, canvas.height / BOARD_HEIGHT);
    renderCodePanelFrame(ctx, {
      chrome: { title: plan.title, language: plan.language, sectionTitle: plan.sections[sectionIndex]!.title, sectionIndex, sectionCount: plan.sections.length },
      code, revealedChars: code.length, showCaret: false,
    }, DSA_CODE_PANEL_RECT);
  }
  return new Promise((resolve) => canvas.toBlob(
    (blob) => resolve(blob?.type === "image/webp" ? blob : null), "image/webp", 0.82,
  ));
}
