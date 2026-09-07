import { useCallback, useRef, type RefObject } from "react";
import {
  fitBoardText,
  snapToBoardTypeScale,
  BOARD_TYPE_SCALE,
  workRowFontSize,
  MIN_BOARD_FONT_SIZE,
  WORK_CONTINUATION_INDENT,
  type DrawCommand,
} from "@heytutor/drawing";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import { tutorDebug } from "@heytutor/tutor-core";
import type { NotesEpoch } from "@/lib/client/exportNotesPdf";
import { useBoardViewport, type BoardViewportMode } from "./useBoardViewport";
import { TEXT_LAYOUT, DIAGRAM_ZONE, WORK_ROW_FONT_SIZE, BOARD_WIDTH } from "../constants";
import type { BoardTextRect, BoardLayoutState } from "../types";
import {
  isInDiagramZone,
  estimateBoardTextWidthAtSize,
  textRectsOverlap,
  registerBoardAnchor,
  withWorkRowIdentity,
  getWorkAreaFlowStartY,
  findWorkTextSlot,
  overlapsWorkArea,
  workColumnMaxWidth,
} from "../lib/board/boardLayout";

export interface UseBoardLayoutParams {
  whiteboardRef: RefObject<WhiteboardHandle | null>;
  cancelRef: RefObject<boolean>;
  fbdPhaseStartedRef: RefObject<boolean>;
  /** Question whose ink is on the board — tags each captured notes page. */
  liveQuestionRef: RefObject<string>;
  viewportMode?: BoardViewportMode;
}

/**
 * The floor for a work row, from the board's type scale.
 *
 * A row only ever reaches it when a single unbreakable token — a long chemical
 * formula, one enormous symbol — is wider than the column at every step above.
 * Anything that *can* be broken is wrapped at the column's own size instead, so
 * this is the rare case rather than the normal one it used to be.
 */
export const MIN_WORK_ROW_FONT_SIZE = MIN_BOARD_FONT_SIZE;

/**
 * Base size for a row, decided by the column it lands in. Constant for a whole
 * turn — a figure is committed before narration starts and holds the right of
 * the board for the rest of the lesson — so the size never changes under the
 * student mid-lesson.
 */
export function workRowBaseFontSize(maxWidth: number): number {
  return workRowFontSize(maxWidth);
}

/**
 * The size this row is drawn at.
 *
 * Wrapping is the answer to a long line; this only reports the size the wrap
 * settled on, which is the column's own base unless a single token could not be
 * broken. Use `wrapWorkRow` when you need the rows themselves.
 */
export function fitWorkRowFontSize(text: string, maxWidth: number): number {
  return fitBoardText(text, { role: "work", maxWidth }).fontSize;
}

/** The rows this line becomes in a column of this width, and their shared size. */
export function wrapWorkRow(
  text: string,
  maxWidth: number,
): { fontSize: number; lines: string[] } {
  return fitBoardText(text, { role: "work", maxWidth });
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

  /**
   * The size a text command is actually drawn at.
   *
   * A work row arrives with the size its wrap settled on, stamped into
   * params[2] by the reservation; a row without one takes its column's base. A
   * diagram LABEL may ask for its own — the scene engine compiles those to fit
   * real geometry — but it is snapped onto the board's scale, so a figure can
   * never carry a size the rest of the board does not use.
   *
   * Registered rects are measured at this size rather than at a fixed 32, so
   * the box `[EMPHASIZE:last]` draws hugs the ink instead of a guess at it.
   */
  const textCommandFontSize = useCallback((command: DrawCommand): number => {
    const requested = command.params[2];
    if (Number.isFinite(requested) && requested > 0) return snapToBoardTypeScale(requested);
    return command.type === "WRITE" ? WORK_ROW_FONT_SIZE : BOARD_TYPE_SCALE.label;
  }, []);

  const resolveTextPlacement = useCallback(
    async (
      command: DrawCommand,
      x: number,
      y: number,
      applyLayout: boolean,
      /** `maxWidth` is the work column at this row — callers must fit ink to it. */
    ): Promise<{ x: number; y: number; maxWidth: number }> => {
      if (!applyLayout || !command.text) {
        if (command.text && Number.isFinite(x) && Number.isFinite(y)) {
          const rect = {
            x,
            y,
            width: estimateBoardTextWidthAtSize(command.text, textCommandFontSize(command)),
            height: TEXT_LAYOUT.textHeight,
            text: command.text,
          };
          registerBoardAnchor(
            boardLayoutRef.current,
            command.type === "WRITE" ? withWorkRowIdentity(boardLayoutRef.current, rect) : rect,
          );
        }
        // Coordinates were supplied verbatim (replay, or a reserved row): the
        // column constraint has already been applied, so impose none here.
        return { x, y, maxWidth: BOARD_WIDTH };
      }

      if (command.type !== "WRITE" && isInDiagramZone(x, y)) {
        const width = estimateBoardTextWidthAtSize(command.text, textCommandFontSize(command));
        const height = TEXT_LAYOUT.textHeight;
        const rect = { x, y, width, height, text: command.text };
        registerBoardAnchor(boardLayoutRef.current, rect);
        // A diagram label is compiled to fit real geometry; it is not a work row.
        return { x, y, maxWidth: BOARD_WIDTH };
      }

      const fontSize = textCommandFontSize(command);
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

      return { x: rect.x, y: rect.y, maxWidth: slot.maxWidth };
    },
    [captureNotesEpoch, resetBoardLayout, textCommandFontSize, cancelRef, fbdPhaseStartedRef, whiteboardRef],
  );

  /**
   * Fit a work row to the column it is about to land in, and reserve a slot for
   * every line it becomes.
   *
   * This is the only place that knows the real column width — whether a figure
   * is holding the right of the board, and where its left edge actually is — so
   * it is the only place that can honestly decide the size. It picks one size
   * for the whole row and *wraps* to it. Shrinking a long line instead of
   * wrapping it is what used to put a 17px sentence under a 32px one.
   *
   * The teaching model's third parameter is discarded on the way through: it
   * says what to write, never how large.
   */
  const reserveTextCommandPlacements = useCallback(
    async (command: DrawCommand): Promise<DrawCommand[]> => {
      if (command.type !== "WRITE" || !command.text) return [command];
      const [x, y] = command.params;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return [command];

      const columnWidth = workColumnMaxWidth(
        boardLayoutRef.current,
        fbdPhaseStartedRef.current,
      );
      const { fontSize, lines } = wrapWorkRow(command.text, columnWidth);
      if (lines.length === 0) return [];

      const placed: DrawCommand[] = [];
      for (const [index, line] of lines.entries()) {
        const indent = index === 0 ? 0 : WORK_CONTINUATION_INDENT;
        const row: DrawCommand = {
          ...command,
          text: line,
          params: [TEXT_LAYOUT.marginX + indent, y, fontSize],
        };
        const placement = await resolveTextPlacement(row, row.params[0]!, y, true);
        placed.push({
          ...row,
          params: [placement.x, placement.y, fontSize],
        });
      }
      return placed;
    },
    [boardLayoutRef, fbdPhaseStartedRef, resolveTextPlacement],
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
    reserveTextCommandPlacements,
  };
}
