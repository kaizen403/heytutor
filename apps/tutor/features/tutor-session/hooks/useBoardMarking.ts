"use client";

/**
 * The student's marker: arm it, draw on the board, ask about what you drew on.
 *
 * The strokes live here and in the overlay canvas only. They are never handed
 * to the whiteboard handle, so they cannot reach a Konva layer, a snapshot, the
 * notes PDF, the MP4 export, or a persisted turn. Student ink and board content
 * are different substances and the type system should never have to be asked to
 * keep them apart.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { VerifiedDiagram } from "@heytutor/drawing";
import { BOARD_HEIGHT, BOARD_WIDTH } from "../constants";
import type { BoardLayoutState } from "../types";
import {
  MAX_MARKS,
  collectMarkCandidates,
  createBoardMark,
  type BoardMark,
  type MarkPoint,
} from "../lib/board/boardMarking";

export interface UseBoardMarkingParams {
  /** Live board text rows, kept up to date by the drawing runtime. */
  boardLayoutRef: RefObject<BoardLayoutState>;
  /** The committed figure, for anchor + glossary grounding. */
  verifiedDiagram: VerifiedDiagram | null;
  /** Marking is offered only where there is something to mark. */
  enabled: boolean;
  /** Quiet the tutor the moment the student picks up the marker. */
  onArm?: () => void;
}

export interface BoardMarkingApi {
  armed: boolean;
  marks: BoardMark[];
  /** The stroke under the pointer right now, for live rendering. */
  draftPoints: MarkPoint[];
  atMarkLimit: boolean;
  arm: () => void;
  disarm: () => void;
  toggle: () => void;
  undo: () => void;
  remove: (id: string, targetIndex?: number) => void;
  clear: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
}

const NO_MARKS: BoardMark[] = [];
const NO_POINTS: MarkPoint[] = [];

function boardPointFromPointer(
  event: ReactPointerEvent<HTMLElement>,
): MarkPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);
  return {
    x: ((event.clientX - rect.left) / width) * BOARD_WIDTH,
    y: ((event.clientY - rect.top) / height) * BOARD_HEIGHT,
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function useBoardMarking({
  boardLayoutRef,
  verifiedDiagram,
  enabled,
  onArm,
}: UseBoardMarkingParams): BoardMarkingApi {
  const [markerOut, setMarkerOut] = useState(false);
  const [heldMarks, setHeldMarks] = useState<BoardMark[]>([]);
  const [heldDraft, setHeldDraft] = useState<MarkPoint[]>([]);
  const drawingRef = useRef(false);
  const draftRef = useRef<MarkPoint[]>([]);
  const markSeqRef = useRef(0);

  /**
   * Armed is derived, not synchronised. A board with nothing left to mark — a
   * new question has cleared it — puts the marker away on the same render it
   * becomes empty, with no effect to fire late and no window where a stroke
   * could land on a board that no longer holds what it was about.
   */
  const armed = markerOut && enabled;
  const marks = armed ? heldMarks : NO_MARKS;
  const draftPoints = armed ? heldDraft : NO_POINTS;

  const atMarkLimit = marks.length >= MAX_MARKS;

  const endStroke = useCallback(() => {
    drawingRef.current = false;
    const points = draftRef.current;
    draftRef.current = [];
    setHeldDraft(NO_POINTS);
    if (points.length === 0) {
      return;
    }
    // Read the board as it stands at the moment the stroke lifts: a lesson
    // that wrote another row mid-stroke must be markable straight away.
    const candidates = collectMarkCandidates(
      boardLayoutRef.current?.rects ?? [],
      verifiedDiagram,
    );
    markSeqRef.current += 1;
    const mark = createBoardMark(`mark_${markSeqRef.current}`, points, candidates);
    if (!mark) {
      return;
    }
    setHeldMarks((previous) =>
      previous.length >= MAX_MARKS ? previous : [...previous, mark],
    );
  }, [boardLayoutRef, verifiedDiagram]);

  const arm = useCallback(() => {
    if (!enabled || armed) return;
    // A marker picked up again starts clean — the marks it held were about a
    // board state the student has since left.
    drawingRef.current = false;
    draftRef.current = [];
    setHeldDraft(NO_POINTS);
    setHeldMarks(NO_MARKS);
    setMarkerOut(true);
    onArm?.();
  }, [armed, enabled, onArm]);

  const disarm = useCallback(() => {
    drawingRef.current = false;
    draftRef.current = [];
    setHeldDraft(NO_POINTS);
    setHeldMarks(NO_MARKS);
    setMarkerOut(false);
  }, []);

  const toggle = useCallback(() => {
    if (armed) {
      disarm();
      return;
    }
    arm();
  }, [arm, armed, disarm]);

  const undo = useCallback(() => {
    setHeldMarks((previous) => previous.slice(0, -1));
  }, []);

  const remove = useCallback((id: string, targetIndex?: number) => {
    setHeldMarks((previous) =>
      previous.flatMap((mark) => {
        if (mark.id !== id) return [mark];
        if (targetIndex === undefined || mark.targets.length <= 1) return [];
        const targets = mark.targets.filter((_, index) => index !== targetIndex);
        if (targets.length === 0) return [];
        return [{ ...mark, targets, target: targets[0]! }];
      }),
    );
  }, []);

  const clear = useCallback(() => {
    setHeldMarks(NO_MARKS);
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!armed || atMarkLimit) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      drawingRef.current = true;
      const point = boardPointFromPointer(event);
      draftRef.current = [point];
      setHeldDraft(draftRef.current);
    },
    [armed, atMarkLimit],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!drawingRef.current) return;
      event.preventDefault();
      const point = boardPointFromPointer(event);
      draftRef.current = [...draftRef.current, point];
      setHeldDraft(draftRef.current);
    },
    [],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!drawingRef.current) return;
      event.preventDefault();
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      endStroke();
    },
    [endStroke],
  );

  // Escape drops the marker before the session's Escape stops the lesson, so a
  // student backing out of marking does not lose the lecture as well.
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        if (event.key === "Escape" && armed) {
          event.stopPropagation();
          disarm();
        }
        return;
      }
      if (event.key === "Escape" && armed) {
        event.stopPropagation();
        event.preventDefault();
        disarm();
        return;
      }
      if ((event.key === "m" || event.key === "M") && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        toggle();
        return;
      }
      if (armed && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [armed, disarm, enabled, toggle, undo]);

  return useMemo(
    () => ({
      armed,
      marks,
      draftPoints,
      atMarkLimit,
      arm,
      disarm,
      toggle,
      undo,
      remove,
      clear,
      onPointerDown,
      onPointerMove,
      onPointerUp,
    }),
    [
      arm,
      armed,
      atMarkLimit,
      clear,
      disarm,
      draftPoints,
      marks,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      remove,
      toggle,
      undo,
    ],
  );
}
