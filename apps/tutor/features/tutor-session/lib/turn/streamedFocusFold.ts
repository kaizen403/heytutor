import { createWritelessFocusFolder, type TutorSegment, type VerifiedDiagram } from "@heytutor/drawing";

/**
 * The write-less FOCUS fold for a streamed lesson.
 *
 * The batch path (`prepareVerifiedLessonSegments` on a whole response) speaks
 * a run of pointing steps as one segment. A live turn prepares one segment at
 * a time, so each pointing step used to reach the queue on its own, with its
 * own voice start, while the board stood still (v3 p3e2-t1, p2e1-t1).
 *
 * Prepared segments go in, in order; what comes out is queued. A write-less
 * FOCUS segment is held until the next segment shows whether a run follows.
 * A writing segment is never held: it releases the run before it and goes
 * out on the same call. Before the lesson has started nothing is held, so a
 * lesson that opens by pointing at its figure starts as soon as it did. A
 * code lesson's FOCUS advances its worked example and is never folded.
 */
export interface StreamedFocusFold {
  take(segments: readonly TutorSegment[], options: { lessonStarted: boolean }): TutorSegment[];
  /** Everything still held, once the response has ended. */
  finish(): TutorSegment[];
  foldedFocusSegmentCount(): number;
}

export function createStreamedFocusFold(
  diagram: VerifiedDiagram | null,
  options: { codeLesson: boolean },
): StreamedFocusFold {
  const folder = options.codeLesson ? null : createWritelessFocusFolder(diagram);
  return {
    take: (segments, { lessonStarted }) => {
      if (!folder) return [...segments];
      if (!lessonStarted) return [...folder.flush(), ...segments];
      return segments.flatMap((segment) => folder.push(segment));
    },
    finish: () => folder?.flush() ?? [],
    foldedFocusSegmentCount: () => folder?.foldedFocusSegmentCount() ?? 0,
  };
}
