/**
 * Swapping the figure in the diagram zone during a lesson.
 *
 * PHASE 2 CONTRACT, LANE D FILLS THE BODIES. Lane C codes against these
 * signatures. A doubt that drew its own figure swaps it in; the lesson's
 * figure is returned when the lesson resumes, with the labels and marks the
 * student already saw drawn at once, never revealed a second time.
 */
import type { TutorSegment, VerifiedDiagram } from "@heytutor/drawing";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { BoardLayoutState } from "../../types";

/**
 * Erase the zone's scene and pinned ink, drop its diagram rects, and leave the
 * zone empty for `next`, whose intro the caller enqueues (enqueueVerifiedIntro).
 * Resolves false when cancelled before the zone was cleared.
 */
export async function swapFigureIn(
  wb: WhiteboardHandle,
  layout: BoardLayoutState,
  next: VerifiedDiagram,
  opts: { shouldCancel?: () => boolean } = {},
): Promise<boolean> {
  void wb; void layout; void next; void opts;
  throw new Error("figureSwap.swapFigureIn: lane D implements this");
}

/**
 * Erase the zone and redraw the lesson's figure at once: its intro commands
 * plus the withheld marks `consumedIds` already released. Resolves the
 * diagram with that deferred state, or null when cancelled.
 */
export async function returnPageFigure(
  wb: WhiteboardHandle,
  layout: BoardLayoutState,
  presentation: { diagram: VerifiedDiagram; introSegments: TutorSegment[] },
  consumedIds: readonly string[],
  opts: { shouldCancel?: () => boolean } = {},
): Promise<VerifiedDiagram | null> {
  void wb; void layout; void presentation; void consumedIds; void opts;
  throw new Error("figureSwap.returnPageFigure: lane D implements this");
}
