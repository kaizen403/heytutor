/**
 * LANE D SHIM (phase 2, DIAGRAM_DOUBT_FIGURES). DELETE AT INTEGRATION.
 *
 * Lane C codes against lane D's names before the branches meet. Each export
 * here has the exact signature lane D landed on kaizen403/figures-any-time-lane-d:
 *
 *   returnPageFigure, consumedDeferredIds, returnFigureToZone,
 *   FigureSwapExecuteCommand      -> features/tutor-session/lib/scene/figureSwap.ts
 *   doubtFigureTurnScene          -> features/tutor-session/lib/turn/doubtTurn.ts
 *   storedFigurePresentation      -> features/tutor-session/lib/replay/pageFigureSync.ts
 *   PausedLessonRequest.returnsFigure -> features/tutor-session/lib/turn/doubtTurn.ts
 *
 * At integration, point the imports in useQuestionHandler.ts at those files
 * and delete this one. The bodies below that are pure copy lane D's logic;
 * the drawing ones delegate to the contract bodies, which throw until lane D.
 */
import {
  isStoredCommandTrustedGeometry,
  parseStoredSegmentCommands,
  type DrawCommand,
  type TutorSegment,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { boardContinuationArtifacts } from "@/lib/boards/boardContinuation";
import { doubtFigureArtifacts } from "@/lib/boards/doubtFigure";
import type { BoardLayoutState } from "../../types";
import { returnPageFigure as contractReturnPageFigure } from "../scene/figureSwap";
import { restoreVerifiedPresentationFromTurn } from "../scene/restoreVerifiedDiagram";
import type { PausedLessonRequest, PersistedTurnScene } from "./doubtTurn";

/** Lane D, figureSwap.ts. */
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

/** Lane D, figureSwap.ts: the withheld entries `pristine` holds and `live` no longer does. */
export function consumedDeferredIds(pristine: VerifiedDiagram, live: VerifiedDiagram): string[] {
  const remaining = new Set((live.deferredAnnotations ?? []).map((entry) => entry.entityId));
  const ids: string[] = [];
  for (const entry of pristine.deferredAnnotations ?? []) {
    if (!remaining.has(entry.entityId) && !ids.includes(entry.entityId)) ids.push(entry.entityId);
  }
  return ids;
}

/** Lane D, figureSwap.ts. Without `executeCommand` nothing is erased or drawn and it resolves null. */
export async function returnPageFigure(
  wb: WhiteboardHandle,
  layout: BoardLayoutState,
  presentation: { diagram: VerifiedDiagram; introSegments: TutorSegment[] },
  consumedIds: readonly string[],
  opts: { shouldCancel?: () => boolean; executeCommand?: FigureSwapExecuteCommand } = {},
): Promise<VerifiedDiagram | null> {
  if (!opts.executeCommand) return null;
  return contractReturnPageFigure(wb, layout, presentation, consumedIds, { shouldCancel: opts.shouldCancel });
}

type ZoneBoard = Pick<WhiteboardHandle, "eraseSceneInk"> & Partial<Pick<WhiteboardHandle, "erasePinnedInk">>;

/** Lane D, figureSwap.ts: the replay and restore return. Throws here until lane D lands. */
export async function returnFigureToZone(
  wb: ZoneBoard,
  layout: BoardLayoutState | null,
  presentation: { diagram: VerifiedDiagram | null; introSegments: readonly TutorSegment[] },
  consumedIds: readonly string[],
  opts: { shouldCancel?: () => boolean; executeCommand: FigureSwapExecuteCommand },
): Promise<{ cancelled: boolean; diagram: VerifiedDiagram | null }> {
  void wb; void layout; void presentation; void consumedIds; void opts;
  throw new Error("returnFigureToZone: lane D implements this");
}

/** Lane D, pageFigureSync.ts: the figure a stored turn drew, its diagram and its saved intro ink. */
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
  const restored = restoreVerifiedPresentationFromTurn(turn);
  return { diagram: restored?.diagram ?? null, introSegments };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lane D, doubtTurn.ts: the doubt's own validated scene with the continuation and the marker. */
export function doubtFigureTurnScene(
  scene: PersistedTurnScene,
  lessonQuestion: string,
  replacedTurnId: string | null,
): PersistedTurnScene {
  const artifacts = isRecord(scene.sceneArtifacts) ? { ...scene.sceneArtifacts } : {};
  delete artifacts.pointsAtFigure;
  return {
    ...scene,
    sceneArtifacts: {
      ...artifacts,
      ...boardContinuationArtifacts(lessonQuestion),
      ...doubtFigureArtifacts(replacedTurnId),
    },
  };
}

/** Lane D, doubtTurn.ts: a reloaded board whose zone holds a doubt's own figure. */
export type PausedLessonRequestWithReturn = PausedLessonRequest & {
  returnsFigure?: { turnId: string | null; consumedIds: string[] };
};
