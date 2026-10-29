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

/**
 * Scene ink, kept rings and the figure's rects leave; the work column stays.
 * Replay surfaces that place nothing by layout pass a null layout.
 */
export async function clearFigureZone(
  wb: ZoneBoard,
  layout: BoardLayoutState | null,
  shouldCancel: () => boolean,
): Promise<boolean> {
  if (shouldCancel()) return false;
  // eraseSceneInk takes the rings too; erasePinnedInk also covers a board
  // whose rings sit on the animation layer mid gesture.
  if (typeof wb.erasePinnedInk === "function") wb.erasePinnedInk();
  await wb.eraseSceneInk(0, shouldCancel);
  if (shouldCancel()) return false;
  if (layout) dropDiagramRects(layout);
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
  return clearFigureZone(wb, layout, () => Boolean(opts.shouldCancel?.()));
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
  if (!opts.executeCommand) return null;
  const result = await returnFigureToZone(wb, layout, presentation, consumedIds, {
    shouldCancel: opts.shouldCancel, executeCommand: opts.executeCommand,
  });
  return result.cancelled ? null : result.diagram;
}

/**
 * returnPageFigure for the replay, restore and export boards: no layout to
 * keep, and a figure whose diagram could not be rebuilt still gets its stored
 * intro ink back (with nothing for FOCUS to resolve).
 */
export async function returnFigureToZone(
  wb: ZoneBoard,
  layout: BoardLayoutState | null,
  presentation: { diagram: VerifiedDiagram | null; introSegments: readonly TutorSegment[] },
  consumedIds: readonly string[],
  opts: { shouldCancel?: () => boolean; executeCommand: FigureSwapExecuteCommand },
): Promise<{ cancelled: boolean; diagram: VerifiedDiagram | null }> {
  const shouldCancel = () => Boolean(opts.shouldCancel?.());
  const { executeCommand } = opts;
  const cancelled = { cancelled: true, diagram: null };
  if (shouldCancel()) return cancelled;
  const diagram = presentation.diagram ? structuredClone(presentation.diagram) : null;
  const released = diagram
    ? takeDeferredAnnotations(diagram, { entityIds: releasedEntityIds(diagram, consumedIds) })
    : [];
  if (!await clearFigureZone(wb, layout, shouldCancel)) return cancelled;
  const stamp = { durationScale: 0, trustedDiagramGeometry: true, applyLayout: false, isCancelled: shouldCancel };
  for (const segment of presentation.introSegments) {
    for (const command of getSegmentCommands(segment)) {
      if (shouldCancel()) return cancelled;
      await executeCommand(command, stamp);
    }
  }
  for (const command of released) {
    if (shouldCancel()) return cancelled;
    await executeCommand(verifiedDiagramCommandToDrawCommand(command), { ...stamp, inkPace: "scene" });
  }
  return shouldCancel() ? cancelled : { cancelled: false, diagram };
}

/**
 * What a doubt's own figure replaced in the zone (`BoardPageRecord.zoneStash`):
 * the lesson figure it stashed, or nothing when the zone stood empty. An
 * empty stash still returns: the lesson's resume clears the doubt's figure,
 * as replay does at that resume (`pageFigureAt`, no source).
 */
export type ZoneStash =
  | {
    diagram: VerifiedDiagram;
    presentation: { diagram: VerifiedDiagram; introSegments: TutorSegment[] };
    turnId: string | null;
  }
  | { diagram: null; presentation: null; turnId: null };

/** The zone stood empty. Frozen: copy it (`{ ...EMPTY_ZONE_STASH }`) before storing. */
export const EMPTY_ZONE_STASH: Readonly<ZoneStash> = Object.freeze({ diagram: null, presentation: null, turnId: null });

/**
 * The live resume's return of a stashed lesson figure. Every record in
 * `holders` keeps the stash until the figure is back whole, and only then is
 * it cleared: a Stop or a doubt while the return stamps leaves the stash
 * where the next turn reads it, so the next Continue returns the lesson's
 * figure again instead of pointing at the doubt's.
 *
 * The whole stashed intro comes back. A Stop that cut the lesson's intro
 * short still saved the whole figure (the server inserts the intro rows the
 * stopped lesson did not draw), so replay and restore stamp the whole figure
 * at this resume too.
 *
 * An empty stash only clears the zone: `{ cancelled: false, diagram: null }`
 * once the doubt's figure is gone. No board, no executor or a cancel resolve
 * `cancelled: true` and keep the stash.
 */
export async function returnZoneStash(
  wb: WhiteboardHandle | null,
  layout: BoardLayoutState,
  stash: ZoneStash,
  holders: ReadonlyArray<{ zoneStash?: ZoneStash | null } | null | undefined>,
  opts: { shouldCancel?: () => boolean; executeCommand?: FigureSwapExecuteCommand },
): Promise<{ cancelled: boolean; diagram: VerifiedDiagram | null }> {
  for (const holder of holders) if (holder) holder.zoneStash = stash;
  const shouldCancel = () => Boolean(opts.shouldCancel?.());
  let result: { cancelled: boolean; diagram: VerifiedDiagram | null } = { cancelled: true, diagram: null };
  if (wb && stash.diagram === null) {
    result = await clearFigureZone(wb, layout, shouldCancel) ? { cancelled: false, diagram: null } : result;
  } else if (wb && stash.diagram && opts.executeCommand) {
    result = await returnFigureToZone(wb, layout, stash.presentation,
      consumedDeferredIds(stash.presentation.diagram, stash.diagram), { shouldCancel, executeCommand: opts.executeCommand });
  }
  if (!result.cancelled) {
    for (const holder of holders) if (holder && holder.zoneStash === stash) holder.zoneStash = null;
  }
  return result;
}
