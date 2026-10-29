/**
 * Kept FOCUS rings: `[FOCUS:id|keep]` leaves a ring on a verified scene part
 * while the page is up.
 *
 * Rule 3 still holds. The teaching stream only names the part; the ring's box
 * comes from `compactPulseBox`, which reads the verified anchor and the
 * anchor's own compiled commands, never model text or coordinates. A ring is
 * never drawn on a code lesson board, never on a reference picture part (its
 * geometry comes from the stored Commons record, not the scene engine), and
 * at most `MAX_PINNED_MARKS_PER_PAGE` stand on one page: a further `keep`
 * draws as a transient pulse instead.
 *
 * What clears a ring is the board's business: a work column page turn
 * (`eraseWorkInk`), `clearBoard`, a FRAME erase and `eraseSceneInk`.
 */
import {
  emphasisEllipsePath,
  focusKeepsMark,
  isReferencePicturePartFocusId,
  type DrawCommand,
  type VerifiedDiagram,
  type VerifiedDiagramAnchor,
  type VerifiedDiagramCommand,
} from "@heytutor/drawing";

export const MAX_PINNED_MARKS_PER_PAGE = 3;
/** A kept ring is drawn at about the pace of a pulse. A seek draws it at 0. */
export const PINNED_MARK_DRAW_MS = 320;

export interface PinnedMark {
  targetId: string;
  /** Ellipse round `box`. */
  path: string;
  box: { x: number; y: number; width: number; height: number };
}

export interface PinnedMarkPlan {
  /** Rings to draw with `pinned: true`. */
  pins: PinnedMark[];
  /** Over the page cap: drawn as a transient pulse instead. */
  overflow: PinnedMark[];
}

const NO_PINS: PinnedMarkPlan = { pins: [], overflow: [] };

/** The compact box round a verified anchor, from the anchor and its own commands only. */
export function compactPulseBox(
  target: { x: number; y: number; width: number; height: number },
  commands: readonly VerifiedDiagramCommand[],
): { x: number; y: number; width: number; height: number } {
  const point = commands.find((command) => command.type === "DRAW_POINT");
  if (point && [point.params[0], point.params[1]].every(Number.isFinite)) {
    return { x: point.params[0]! - 12, y: point.params[1]! - 12, width: 24, height: 24 };
  }
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  const width = Math.min(Math.max(target.width + 10, 22), 56);
  const height = Math.min(Math.max(target.height + 10, 22), 56);
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/**
 * The kept rings a FOCUS asks for. `targets` are the verified anchors the
 * FOCUS resolved to; `targetCommands` the compiled commands traced for them.
 * `pinsOnPage` is the number of rings already standing on the board.
 */
export function pinnedMarksFor(input: {
  command: DrawCommand;
  targets: readonly VerifiedDiagramAnchor[];
  diagram: VerifiedDiagram | null;
  targetCommands: readonly VerifiedDiagramCommand[];
  codeLessonActive: boolean;
  pinsOnPage: number;
  /** Targets that already hold a ring on this page: no second ring. */
  alreadyPinned?: ReadonlySet<string>;
}): PinnedMarkPlan {
  const { command, targets, diagram } = input;
  if (!diagram || !focusKeepsMark(command)) return NO_PINS;
  if (input.codeLessonActive || diagram.layout === "code_lesson") return NO_PINS;
  const plan: PinnedMarkPlan = { pins: [], overflow: [] };
  let standing = Math.max(0, input.pinsOnPage);
  for (const target of targets) {
    if (isReferencePicturePartFocusId(target.id)) continue;
    if (input.alreadyPinned?.has(target.id)) continue;
    const own = input.targetCommands.filter((candidate) => candidate.semanticRef?.entityId === target.id);
    const box = compactPulseBox(target, own);
    const mark: PinnedMark = {
      targetId: target.id,
      path: emphasisEllipsePath(box.x, box.y, box.width, box.height),
      box,
    };
    if (standing < MAX_PINNED_MARKS_PER_PAGE) {
      plan.pins.push(mark);
      standing += 1;
    } else {
      plan.overflow.push(mark);
    }
  }
  return plan;
}

/** The rings standing on a board. A board without the count (an old mock) reads 0. */
export function pinnedInkCountOf(board: { pinnedInkCount?: () => number }): number {
  const count = typeof board.pinnedInkCount === "function" ? board.pinnedInkCount() : 0;
  return Number.isFinite(count) && count > 0 ? count : 0;
}

/** A FRAME erase takes the kept rings with the frame. A board without the call is left as is. */
export function erasePinnedInkOf(board: { erasePinnedInk?: () => void }): void {
  if (typeof board.erasePinnedInk === "function") board.erasePinnedInk();
}
