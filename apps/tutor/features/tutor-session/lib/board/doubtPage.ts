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

export type PageBoard = Partial<Pick<WhiteboardHandle, "holdPage" | "returnHeldPage" | "hasHeldPage" | "captureHeldPageSnapshot">>;

/** Download notes: the doubt page is a notes page of its own, and the lesson's narration resumes. */
export interface DoubtPageNotes {
  /** Snapshot the board as one notes page (`captureNotesEpoch`). */
  capture: () => unknown;
  /** Narration spoken since the page's last notes snapshot. */
  narration: { current: string };
  /**
   * Live only: the narration as it stood when the doubt turn began. What the
   * doubt spoke before its page turned (its holding line) belongs to the
   * doubt page, not the lesson's (review round 3 N5).
   */
  turnStart?: string;
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
  const spoken = notes?.narration.current ?? "";
  const turnStart = notes?.turnStart;
  const split = typeof turnStart === "string" && spoken.startsWith(turnStart);
  const held: HeldLessonPage = {
    layout: layout ? { rects: layout.rects.map((rect) => ({ ...rect })), nextY: layout.nextY } : null,
    narration: notes ? (split ? turnStart.trim() : spoken) : null,
  };
  wb.holdPage(held);
  if (layout) {
    layout.rects = [];
    layout.nextY = TEXT_LAYOUT.topY;
  }
  if (notes) notes.narration.current = split ? spoken.slice(turnStart.length).trim() : "";
  return true;
}

/**
 * Leave the doubt page for a new page (a new question, or a stored page that
 * opens on a CLEAR): with a page held, the doubt page is captured, the
 * lesson's page comes back and is captured too, so Download notes keeps both,
 * the doubt's first, as live. False when nothing is held: the caller captures
 * the board as before.
 */
export function closeDoubtPageForNotes(wb: PageBoard | null, notes: DoubtPageNotes): boolean {
  if (!returnLessonPage(wb, null, notes)) return false;
  notes.capture();
  return true;
}

/**
 * The held lesson page as a notes page while the doubt page is up (Download
 * notes before Continue): its snapshot and the narration it was held with.
 * Null when no page is held. Board and hold are left as they were.
 */
export function heldLessonNotesPage(wb: PageBoard | null, pixelRatio = 2): { snapshotDataUrl: string; narration: string } | null {
  if (!wb || wb.hasHeldPage?.() !== true || typeof wb.captureHeldPageSnapshot !== "function") return null;
  const shot = wb.captureHeldPageSnapshot(pixelRatio);
  if (!shot || !shot.snapshotDataUrl) return null;
  const held = shot.meta as HeldLessonPage | null | undefined;
  return { snapshotDataUrl: shot.snapshotDataUrl, narration: typeof held?.narration === "string" ? held.narration : "" };
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
