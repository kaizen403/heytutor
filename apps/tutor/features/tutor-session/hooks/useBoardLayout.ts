import { useCallback, useRef, type RefObject } from "react";
import type { DrawCommand } from "@heytutor/drawing";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import { tutorDebug } from "@heytutor/tutor-core";
import type { NotesEpoch } from "@/lib/exportNotesPdf";
import { useBoardViewport } from "./useBoardViewport";
import { BOARD_WIDTH, TEXT_LAYOUT, DIAGRAM_ZONE } from "../constants";
import type { BoardTextRect, BoardLayoutState } from "../types";
import {
  isInDiagramZone,
  clampNumber,
  estimateBoardTextWidth,
  textRectsOverlap,
  registerBoardAnchor,
  getWorkAreaFlowStartY,
  overlapsWorkArea,
} from "../lib/boardLayout";

export interface UseBoardLayoutParams {
  whiteboardRef: RefObject<WhiteboardHandle | null>;
  cancelRef: RefObject<boolean>;
  fbdPhaseStartedRef: RefObject<boolean>;
}

export function useBoardLayout({
  whiteboardRef,
  cancelRef,
  fbdPhaseStartedRef,
}: UseBoardLayoutParams) {
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const boardViewport = useBoardViewport(boardContainerRef);
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
          registerBoardAnchor(boardLayoutRef.current, {
            x,
            y,
            width: estimateBoardTextWidth(command.text),
            height: TEXT_LAYOUT.textHeight,
            text: command.text,
          });
        }
        return { x, y };
      }

      if (isInDiagramZone(x, y)) {
        const width = estimateBoardTextWidth(command.text);
        const height = TEXT_LAYOUT.textHeight;
        registerBoardAnchor(boardLayoutRef.current, { x, y, width, height, text: command.text });
        return { x, y };
      }

      const width = estimateBoardTextWidth(command.text);
      const height = TEXT_LAYOUT.textHeight;
      let layout = boardLayoutRef.current;

      // A diagram claims the right half of the board. Keep the solution in a clean
      // left column that stops short of the figure, so lines flow straight down
      // the left instead of hopping around the diagram (which used to leave big
      // vertical gaps). When there is no diagram, the solution uses the full width.
      const isDiagramRect = (rect: BoardTextRect) => rect.x >= DIAGRAM_ZONE.x;
      const diagramActive = fbdPhaseStartedRef.current;
      const diagramRects = diagramActive ? layout.rects.filter(isDiagramRect) : [];
      const diagramLeftEdge =
        diagramRects.length > 0
          ? Math.min(...diagramRects.map((rect) => rect.x))
          : DIAGRAM_ZONE.x;
      const columnRight = diagramActive
        ? Math.max(TEXT_LAYOUT.marginX + 160, diagramLeftEdge - 28)
        : BOARD_WIDTH - TEXT_LAYOUT.marginX;
      const maxX = Math.min(BOARD_WIDTH - TEXT_LAYOUT.marginX, columnRight) - width;
      const candidateX = clampNumber(x, TEXT_LAYOUT.marginX, Math.max(TEXT_LAYOUT.marginX, maxX));

      const findOpenY = (startY: number): number | null => {
        for (
          let tryY = clampNumber(startY, TEXT_LAYOUT.topY, TEXT_LAYOUT.bottomY - height);
          tryY <= TEXT_LAYOUT.bottomY - height;
          tryY += TEXT_LAYOUT.lineHeight
        ) {
          const rect = { x: candidateX, y: tryY, width, height };
          // Solution lines only stack around each other. The diagram lives in its
          // own right-hand column, so skip diagram rects when finding a free row —
          // otherwise a wide equation would jump below the whole figure.
          if (
            !layout.rects.some(
              (occupied) =>
                !(diagramActive && isDiagramRect(occupied)) &&
                textRectsOverlap(rect, occupied),
            )
          ) {
            return tryY;
          }
        }
        return null;
      };

      const placementStartY = (() => {
        if (forceSequentialWorkLayoutRef.current) {
          return getWorkAreaFlowStartY(layout);
        }
        let candidateY = clampNumber(y, TEXT_LAYOUT.topY, TEXT_LAYOUT.bottomY - height);
        if (layout.rects.length === 0 && candidateY > TEXT_LAYOUT.workTopY) {
          candidateY = TEXT_LAYOUT.topY;
        }
        return candidateY;
      })();

      let openY = findOpenY(placementStartY);

      if (openY === null) {
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
          const preEraseSnapshot = wb.captureSnapshot(2);
          if (preEraseSnapshot) {
            notesEpochsRef.current.push({
              index: notesEpochsRef.current.length,
              snapshotDataUrl: preEraseSnapshot,
              narrationText: narrationSinceEpochRef.current,
              timestampMs: Date.now(),
            });
            narrationSinceEpochRef.current = "";
          }
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
        openY = findOpenY(getWorkAreaFlowStartY(layout)) ?? TEXT_LAYOUT.workTopY;
      }

      const rect = { x: candidateX, y: openY, width, height, text: command.text };
      registerBoardAnchor(boardLayoutRef.current, rect);
      boardLayoutRef.current.nextY = Math.max(
        boardLayoutRef.current.nextY,
        openY + TEXT_LAYOUT.lineHeight,
      );

      return { x: rect.x, y: rect.y };
    },
    [resetBoardLayout, cancelRef, fbdPhaseStartedRef, whiteboardRef],
  );

  return {
    boardContainerRef,
    boardViewport,
    boardLayoutRef,
    notesEpochsRef,
    narrationSinceEpochRef,
    forceSequentialWorkLayoutRef,
    resetBoardLayout,
    forgetErasedTextRects,
    resolveTextPlacement,
  };
}
