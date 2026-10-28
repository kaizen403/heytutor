/**
 * Swapping the figure in the diagram zone during a lesson.
 *
 * A doubt that drew its own figure swaps it in; the lesson's figure is
 * returned when the lesson resumes, with the labels and marks the student
 * already saw drawn at once, never revealed a second time. Live (lane C),
 * replay, restore and export all go through these two functions.
 */
import {
  getSegmentCommands,
  parseFocusSpec,
  resolveVerifiedDiagramFocusTargets,
  takeDeferredAnnotations,
  verifiedDiagramCommandToDrawCommand,
  type DrawCommand,
  type TutorSegment,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { BoardLayoutState } from "../../types";
import { dropDiagramRects } from "../board/boardLayout";

/**
 * The command executor (useCommandExecution) that stamps the returned figure.
 * Only engine-owned figure marks pass through it, at duration 0.
 */
export type FigureSwapExecuteCommand = (
  command: DrawCommand,
  options?: {
    durationScale?: number;
    trustedDiagramGeometry?: boolean;
    applyLayout?: boolean;
    inkPace?: "scene";
    isCancelled?: () => boolean;
  },
) => Promise<void>;

type ZoneBoard = Pick<WhiteboardHandle, "eraseSceneInk"> & Partial<Pick<WhiteboardHandle, "erasePinnedInk">>;

/** Scene ink, kept rings and the figure's rects leave; the work column stays. */
async function clearZone(
  wb: ZoneBoard,
  layout: BoardLayoutState,
  shouldCancel: () => boolean,
): Promise<boolean> {
  if (shouldCancel()) return false;
  // eraseSceneInk takes the rings too; erasePinnedInk also covers a board
  // whose rings sit on the animation layer mid gesture.
  if (typeof wb.erasePinnedInk === "function") wb.erasePinnedInk();
  await wb.eraseSceneInk(0, shouldCancel);
  if (shouldCancel()) return false;
  dropDiagramRects(layout);
  return true;
}

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
  void next;
  return clearZone(wb, layout, () => Boolean(opts.shouldCancel?.()));
}

/**
 * The entity ids `consumedIds` release on `diagram`: each id as named, plus
 * the anchors and group members it resolves to, as the live FOCUS and ANNOTATE
 * handlers release them.
 */
export function releasedEntityIds(diagram: VerifiedDiagram, consumedIds: readonly string[]): string[] {
  const ids: string[] = [];
  const add = (id: string) => {
    const trimmed = id.trim();
    if (trimmed && !ids.includes(trimmed)) ids.push(trimmed);
  };
  for (const raw of consumedIds) {
    const focus: DrawCommand = { type: "FOCUS", params: [], text: raw, charPosition: 0, narrationBefore: "" };
    for (const id of parseFocusSpec(raw).targetIds) add(id);
    for (const target of resolveVerifiedDiagramFocusTargets(focus, diagram)) add(target.id);
  }
  return ids;
}

/**
 * The ids a live figure has released since it was built: the entity ids of
 * the withheld entries `pristine` holds and `live` no longer does. Lane C
 * passes these as `consumedIds` when the live object is all it kept.
 */
export function consumedDeferredIds(pristine: VerifiedDiagram, live: VerifiedDiagram): string[] {
  const remaining = new Set((live.deferredAnnotations ?? []).map((entry) => entry.entityId));
  const ids: string[] = [];
  for (const entry of pristine.deferredAnnotations ?? []) {
    if (!remaining.has(entry.entityId) && !ids.includes(entry.entityId)) ids.push(entry.entityId);
  }
  return ids;
}

/**
 * Erase the zone and redraw the lesson's figure at once: its intro commands
 * plus the withheld marks `consumedIds` already released. Resolves the
 * diagram with that deferred state, or null when cancelled.
 *
 * `presentation.diagram` is read as built (its whole withheld list) and never
 * mutated: the result is a copy with the released marks taken out, so a later
 * FOCUS on one of them draws nothing a second time. `opts.executeCommand` is
 * the board's command executor; without it nothing is erased or drawn and
 * the call resolves null.
 */
export async function returnPageFigure(
  wb: WhiteboardHandle,
  layout: BoardLayoutState,
  presentation: { diagram: VerifiedDiagram; introSegments: TutorSegment[] },
  consumedIds: readonly string[],
  opts: { shouldCancel?: () => boolean; executeCommand?: FigureSwapExecuteCommand } = {},
): Promise<VerifiedDiagram | null> {
  const shouldCancel = () => Boolean(opts.shouldCancel?.());
  const executeCommand = opts.executeCommand;
  if (!executeCommand || shouldCancel()) return null;
  const diagram = structuredClone(presentation.diagram);
  const released = takeDeferredAnnotations(diagram, { entityIds: releasedEntityIds(diagram, consumedIds) });
  if (!await clearZone(wb, layout, shouldCancel)) return null;
  const stamp = { durationScale: 0, trustedDiagramGeometry: true, applyLayout: false, isCancelled: shouldCancel };
  for (const segment of presentation.introSegments) {
    for (const command of getSegmentCommands(segment)) {
      if (shouldCancel()) return null;
      await executeCommand(command, stamp);
    }
  }
  for (const command of released) {
    if (shouldCancel()) return null;
    await executeCommand(verifiedDiagramCommandToDrawCommand(command), { ...stamp, inkPace: "scene" });
  }
  return shouldCancel() ? null : diagram;
}
