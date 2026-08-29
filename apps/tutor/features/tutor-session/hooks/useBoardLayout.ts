import { useCallback, useRef, type RefObject } from "react";
import type { DrawCommand } from "@heytutor/drawing";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import { tutorDebug } from "@heytutor/tutor-core";
import type { NotesEpoch } from "@/lib/client/exportNotesPdf";
import { useBoardViewport, type BoardViewportMode } from "./useBoardViewport";
import { TEXT_LAYOUT, DIAGRAM_ZONE } from "../constants";
import type { BoardTextRect, BoardLayoutState } from "../types";
import {
  isInDiagramZone,
  estimateBoardTextWidth,
  estimateBoardTextWidthAtSize,
  textRectsOverlap,
  registerBoardAnchor,
  withWorkRowIdentity,
  getWorkAreaFlowStartY,
  findWorkTextSlot,
  overlapsWorkArea,
} from "../lib/boardLayout";

export interface UseBoardLayoutParams {
  whiteboardRef: RefObject<WhiteboardHandle | null>;
  cancelRef: RefObject<boolean>;
  fbdPhaseStartedRef: RefObject<boolean>;
  /** Question whose ink is on the board — tags each captured notes page. */
  liveQuestionRef: RefObject<string>;
  viewportMode?: BoardViewportMode;
}

export function useBoardLayout({
  whiteboardRef,
  cancelRef,
  fbdPhaseStartedRef,
  liveQuestionRef,
  viewportMode = "fit",
}: UseBoardLayoutParams) {
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const boardViewport = useBoardViewport(boardContainerRef, viewportMode);
  const notesEpochsRef = useRef<NotesEpoch[]>([]);
  const narrationSinceEpochRef = useRef("");
  const boardLayoutRef = useRef<BoardLayoutState>({
    rects: [],
    nextY: TEXT_LAYOUT.topY,
  });
  /** After a work-area erase, ignore LLM y coords and fill rows top-down. */
  const forceSequentialWorkLayoutRef = useRef(false);

  const resetBoardLayout = useCallback((keepHeading = false, forceSequentialWorkLayout?: boolean): void => {
    const headingRects = keepHeading
      ? boardLayoutRef.current.rects.filter((rect) => rect.y < TEXT_LAYOUT.headingBottomY)
      : [];

    boardLayoutRef.current = {
      rects: headingRects,
      nextY: keepHeading && headingRects.length > 0 ? TEXT_LAYOUT.workTopY : TEXT_LAYOUT.topY,
    };

    if (forceSequentialWorkLayout !== undefined) {
      forceSequentialWorkLayoutRef.current = forceSequentialWorkLayout;
    }
  }, []);

  /**
   * Snapshot the board as one notes page before it is cleared or erased. The
   * page carries the question it belongs to and the narration spoken while it
   * was on screen, so Download notes can pair it with the right lesson text.
   */
  const captureNotesEpoch = useCallback((): boolean => {
    const wb = whiteboardRef.current;
    const snapshotDataUrl = wb?.captureSnapshot(2);
    if (!snapshotDataUrl) {
      return false;
    }
    notesEpochsRef.current.push({
      index: notesEpochsRef.current.length,
      question: liveQuestionRef.current,
      snapshotDataUrl,
      narrationText: narrationSinceEpochRef.current,
      timestampMs: Date.now(),
    });
    narrationSinceEpochRef.current = "";
    return true;
  }, [liveQuestionRef, whiteboardRef]);

  const beginBoardEpoch = useCallback(async (): Promise<void> => {
    const wb = whiteboardRef.current;
    if (wb && boardLayoutRef.current.rects.length > 0) {
      captureNotesEpoch();
    }
    narrationSinceEpochRef.current = "";
    if (wb) await wb.clearBoard();
    resetBoardLayout(false, true);
  }, [captureNotesEpoch, resetBoardLayout, whiteboardRef]);

  const forgetErasedTextRects = useCallback((eraseRect: BoardTextRect): void => {
    boardLayoutRef.current.rects = boardLayoutRef.current.rects.filter(
      (rect) => !textRectsOverlap(rect, eraseRect, 0),
    );
    const hasHeading = boardLayoutRef.current.rects.some(
      (rect) => rect.y < TEXT_LAYOUT.headingBottomY,
    );
    const remainingBottom = boardLayoutRef.current.rects.reduce(
      (bottom, rect) => Math.max(bottom, rect.y + TEXT_LAYOUT.lineHeight),
      TEXT_LAYOUT.topY,
    );
    let nextY = Math.max(remainingBottom, TEXT_LAYOUT.topY);
    if (hasHeading && nextY <= TEXT_LAYOUT.headingBottomY) {
      nextY = TEXT_LAYOUT.workTopY;
    }
    boardLayoutRef.current.nextY = nextY;
    if (overlapsWorkArea(eraseRect)) {
      forceSequentialWorkLayoutRef.current = true;
    }
  }, []);

  const resolveTextPlacement = useCallback(
    async (
      command: DrawCommand,
      x: number,
      y: number,
      applyLayout: boolean,
    ): Promise<{ x: number; y: number }> => {
      if (!applyLayout || !command.text) {
        if (command.text && Number.isFinite(x) && Number.isFinite(y)) {
          const rect = {
            x,
            y,
            width: estimateBoardTextWidth(command.text),
            height: TEXT_LAYOUT.textHeight,
            text: command.text,
          };
          registerBoardAnchor(
            boardLayoutRef.current,
            command.type === "WRITE" ? withWorkRowIdentity(boardLayoutRef.current, rect) : rect,
          );
        }
        return { x, y };
      }

      if (command.type !== "WRITE" && isInDiagramZone(x, y)) {
        const width = estimateBoardTextWidth(command.text);
        const height = TEXT_LAYOUT.textHeight;
        const rect = { x, y, width, height, text: command.text };
        registerBoardAnchor(boardLayoutRef.current, rect);
        return { x, y };
      }

      const requestedFontSize = command.params[2];
      const fontSize =
        Number.isFinite(requestedFontSize) && requestedFontSize >= 12 && requestedFontSize <= 40
          ? requestedFontSize
          : 32;
      const width = estimateBoardTextWidthAtSize(command.text, fontSize);
      const height = TEXT_LAYOUT.textHeight;
      let layout = boardLayoutRef.current;

      // A diagram claims the right half of the board. Keep the solution in a clean
      // left column that stops short of the figure, so lines flow straight down
      // the left instead of hopping around the diagram (which used to leave big
      // vertical gaps). When there is no diagram, the solution uses the full width.
      const diagramActive = fbdPhaseStartedRef.current;
      const sequential = command.type === "WRITE" || forceSequentialWorkLayoutRef.current;
      const findSlot = () => findWorkTextSlot({
        layout,
        requestedX: x,
        requestedY: y,
        width,
        height,
        diagramActive,
        sequential,
        runtimeOwnsX: command.type === "WRITE",
      });

      let slot = findSlot();

      if (slot === null) {
        const wb = whiteboardRef.current;
        if (wb && !cancelRef.current) {
          // Keep an in-progress diagram: when one exists, only clear the left
          // work column instead of the full board width.
          const eraseWidth = fbdPhaseStartedRef.current
            ? Math.max(DIAGRAM_ZONE.x - TEXT_LAYOUT.eraseX - 10, 40)
            : TEXT_LAYOUT.eraseWidth;
          tutorDebug("draw", "layout erasing work area", {
            text: command.text.slice(0, 60),
            rect_count: layout.rects.length,
            erase_width: eraseWidth,
          });
          captureNotesEpoch();
          await wb.eraseRegion(
            TEXT_LAYOUT.eraseX,
            TEXT_LAYOUT.eraseY,
            eraseWidth,
            TEXT_LAYOUT.eraseHeight,
            700,
          );
        }
        // Diagram-zone labels survive a work-column erase, so keep their
        // rects registered for later annotation snapping.
        const survivingDiagramRects = fbdPhaseStartedRef.current
          ? boardLayoutRef.current.rects.filter(
              (r) => r.x >= DIAGRAM_ZONE.x && r.y >= TEXT_LAYOUT.headingBottomY,
            )
          : [];
        resetBoardLayout(true, true);
        boardLayoutRef.current.rects.push(...survivingDiagramRects);
        layout = boardLayoutRef.current;
        slot = findSlot() ?? {
          x: TEXT_LAYOUT.marginX,
          y: getWorkAreaFlowStartY(layout),
          maxWidth: Math.max(DIAGRAM_ZONE.x - 28 - TEXT_LAYOUT.marginX, 40),
        };
      }

      const rect = {
        x: slot.x,
        y: slot.y,
        width: Math.min(width, slot.maxWidth),
        height,
        text: command.text,
      };
      registerBoardAnchor(
        boardLayoutRef.current,
        command.type === "WRITE" ? withWorkRowIdentity(boardLayoutRef.current, rect) : rect,
      );
      boardLayoutRef.current.nextY = Math.max(
        boardLayoutRef.current.nextY,
        slot.y + TEXT_LAYOUT.lineHeight,
      );

      return { x: rect.x, y: rect.y };
    },
    [captureNotesEpoch, resetBoardLayout, cancelRef, fbdPhaseStartedRef, whiteboardRef],
  );

  const reserveTextCommandPlacement = useCallback(
    async (command: DrawCommand): Promise<DrawCommand> => {
      if (command.type !== "WRITE" || !command.text) return command;
      const [x, y, ...rest] = command.params;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return command;
      const placement = await resolveTextPlacement(command, x, y, true);
      return { ...command, params: [placement.x, placement.y, ...rest] };
    },
    [resolveTextPlacement],
  );

  return {
    boardContainerRef,
    boardViewport,
    boardLayoutRef,
    notesEpochsRef,
    narrationSinceEpochRef,
    forceSequentialWorkLayoutRef,
    resetBoardLayout,
    beginBoardEpoch,
    captureNotesEpoch,
    forgetErasedTextRects,
    resolveTextPlacement,
    reserveTextCommandPlacement,
  };
}
