/**
 * The figure-in-the-zone step every replay, restore and export surface runs
 * when it reaches a turn that continues the page.
 *
 * A continuation used to return early and keep the page's figure. A doubt that
 * drew its own figure (DIAGRAM_DOUBT_FIGURES) swaps it in instead, and the
 * lesson's resume brings the lesson's figure back. `pageFigureAt` decides
 * which; this module does the board half through `figureSwap.ts`, so the
 * surfaces cannot drift apart.
 */
import {
  isStoredCommandTrustedGeometry,
  parseStoredSegmentCommands,
  type TutorSegment,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { storedTurnContinuesBoard } from "@/lib/boards/boardContinuation";
import { pageFigureAt, storedTurnSwapsFigureIn } from "@/lib/boards/pageFigure";
import type { BoardLayoutState } from "../../types";
import { clearFigureZone, returnFigureToZone, type FigureSwapExecuteCommand } from "../scene/figureSwap";
import { restoreReferencePictureFromTurn } from "../scene/restoreReferencePicture";
import { restoreVerifiedDiagramFromTurn } from "../scene/restoreVerifiedDiagram";

/**
 * What a continuation does to the zone: nothing, its own figure in, the
 * lesson's back, or (a resume whose own rows draw the lesson's figure) the
 * lesson's installed for the first time. `clearFirst`: a doubt's figure stands
 * in the zone and must leave before the resume's rows draw.
 */
export type StoredPageFigureChange =
  | { kind: "keep" }
  | { kind: "swap"; sourceIndex: number }
  | { kind: "return"; sourceIndex: number | null; consumedIds: string[] }
  | { kind: "install"; sourceIndex: number; clearFirst: boolean };

export function storedPageFigureChange(turns: readonly StoredTurn[], turnIndex: number): StoredPageFigureChange {
  const turn = turns[turnIndex];
  if (!turn || turnIndex === 0 || !storedTurnContinuesBoard(turn)) return { kind: "keep" };
  // Only a doubt figure swaps and only a resume returns: every other
  // crossing keeps the zone without reparsing the whole page (replay, seek).
  if (!storedTurnSwapsFigureIn(turn) && turn.kind !== "resume") return { kind: "keep" };
  const at = pageFigureAt(turns, turnIndex);
  if (at.swapIn) return { kind: "swap", sourceIndex: turnIndex };
  if (at.installsLesson) {
    return { kind: "install", sourceIndex: turnIndex, clearFirst: pageFigureAt(turns, turnIndex - 1).sourceIndex !== null };
  }
  if (at.returnsLesson) return { kind: "return", sourceIndex: at.sourceIndex, consumedIds: at.consumedIds };
  return { kind: "keep" };
}

/** The diagram a stored turn's figure resolves to, as replay installs it. */
export function storedTurnFigureDiagram(turn: StoredTurn | undefined): VerifiedDiagram | null {
  if (!turn) return null;
  return restoreVerifiedDiagramFromTurn(turn) ?? restoreReferencePictureFromTurn(turn);
}

/** The figure a stored turn drew: its diagram and its saved intro ink, in order. */
export function storedFigurePresentation(turn: StoredTurn): {
  diagram: VerifiedDiagram | null;
  introSegments: TutorSegment[];
} {
  const introSegments = [...turn.segments]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .filter((segment) => isStoredCommandTrustedGeometry(segment.command))
    .map((segment): TutorSegment => ({
      narration: segment.narration,
      command: null,
      commands: parseStoredSegmentCommands(segment.command),
      verifiedDiagramIntro: true,
    }));
  return { diagram: storedTurnFigureDiagram(turn), introSegments };
}

/**
 * Bring the zone to what turns[turnIndex] plays under. `changed: false` keeps
 * the page's figure and its live deferred state, as before. On a swap the zone
 * is cleared and the turn's own figure installed (its stored intro draws it).
 * On a return the lesson's figure is stamped back with the marks earlier turns
 * released, and resolves with that deferred state. On an install the turn's
 * own stored rows draw the lesson's figure, so nothing is stamped: the zone is
 * cleared only when a doubt's figure stands in it, and the diagram is resolved
 * before those rows play so FOCUS has a target.
 */
export async function syncStoredPageFigure(input: {
  turns: readonly StoredTurn[];
  turnIndex: number;
  whiteboard: Pick<WhiteboardHandle, "eraseSceneInk"> & Partial<Pick<WhiteboardHandle, "erasePinnedInk">> | null;
  layout?: BoardLayoutState | null;
  executeCommand: FigureSwapExecuteCommand;
  shouldCancel: () => boolean;
}): Promise<{ changed: false } | { changed: true; cancelled: boolean; diagram: VerifiedDiagram | null }> {
  const change = storedPageFigureChange(input.turns, input.turnIndex);
  if (change.kind === "keep") return { changed: false };
  const wb = input.whiteboard;
  if (!wb) return { changed: true, cancelled: true, diagram: null };
  const layout = input.layout ?? null;
  if (change.kind === "swap") {
    const cleared = await clearFigureZone(wb, layout, input.shouldCancel);
    return { changed: true, cancelled: !cleared, diagram: cleared ? storedTurnFigureDiagram(input.turns[change.sourceIndex]) : null };
  }
  if (change.kind === "install") {
    const cleared = change.clearFirst ? await clearFigureZone(wb, layout, input.shouldCancel) : !input.shouldCancel();
    return { changed: true, cancelled: !cleared, diagram: cleared ? storedTurnFigureDiagram(input.turns[change.sourceIndex]) : null };
  }
  const source = change.sourceIndex === null ? undefined : input.turns[change.sourceIndex];
  if (!source) {
    const cleared = await clearFigureZone(wb, layout, input.shouldCancel);
    return { changed: true, cancelled: !cleared, diagram: null };
  }
  const result = await returnFigureToZone(wb, layout, storedFigurePresentation(source), change.consumedIds, {
    shouldCancel: input.shouldCancel,
    executeCommand: input.executeCommand,
  });
  return { changed: true, ...result };
}
