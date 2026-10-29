/**
 * A doubt's fresh page (DIAGRAM_DOUBT_FIGURES, lane 9).
 *
 * A doubt figure draws in the diagram zone. On a text only lesson the work
 * column runs the full board width, so the lesson's own rows already stand
 * where the figure would go and the zone is refused (`zoneInkOccupied`). The
 * doubt then turns a fresh page instead: the lesson's page is held whole by
 * the whiteboard (`holdPage`), with its layout as the page's meta, and the
 * doubt draws and teaches on a blank page. The lesson's resume puts the held
 * page back exactly as it was (`returnHeldPage`).
 *
 * Live (useQuestionHandler) and every stored surface (`syncStoredPageFigure`,
 * driven by `storedPageTurnAt`) go through these two functions, so the board
 * shows the same pages in the same order everywhere.
 */
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import { TEXT_LAYOUT } from "../../constants";
import type { BoardLayoutState } from "../../types";

export type PageBoard = Partial<Pick<WhiteboardHandle, "holdPage" | "returnHeldPage" | "hasHeldPage">>;

/** Download notes: the doubt page is a notes page of its own, and the lesson's narration resumes. */
export interface DoubtPageNotes {
  /** Snapshot the board as one notes page (`captureNotesEpoch`). */
  capture: () => unknown;
  /** Narration spoken since the page's last notes snapshot. */
  narration: { current: string };
}

/** What rides with the held page: the lesson page's layout and narration. */
interface HeldLessonPage {
  layout: BoardLayoutState | null;
  narration: string | null;
}

/**
 * Hold the lesson's page and leave a blank one: the board, and the layout in
 * place (every caller reads the same object). False when the board cannot
 * hold a page; the caller then must not draw over the lesson's ink.
 */
export function turnDoubtPage(wb: PageBoard | null, layout: BoardLayoutState | null, notes?: DoubtPageNotes | null): boolean {
  if (!wb || typeof wb.holdPage !== "function") return false;
  const held: HeldLessonPage = {
    layout: layout ? { rects: layout.rects.map((rect) => ({ ...rect })), nextY: layout.nextY } : null,
    narration: notes ? notes.narration.current : null,
  };
  wb.holdPage(held);
  if (layout) {
    layout.rects = [];
    layout.nextY = TEXT_LAYOUT.topY;
  }
  if (notes) notes.narration.current = "";
  return true;
}

/**
 * Put the held lesson page back: the doubt page is snapshotted for the notes
 * first, then the board, the layout (in place) and the narration are the
 * lesson's again. False when no page is held.
 */
export function returnLessonPage(wb: PageBoard | null, layout: BoardLayoutState | null, notes?: DoubtPageNotes | null): boolean {
  if (!wb || typeof wb.returnHeldPage !== "function" || wb.hasHeldPage?.() !== true) return false;
  notes?.capture();
  const back = wb.returnHeldPage();
  if (!back) return false;
  const held = back.meta as HeldLessonPage | null | undefined;
  if (layout && held?.layout) {
    layout.rects = held.layout.rects.map((rect) => ({ ...rect }));
    layout.nextY = held.layout.nextY;
  }
  if (notes && typeof held?.narration === "string") notes.narration.current = held.narration;
  return true;
}
