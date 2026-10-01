import type { BoardLayoutState, BoardTextRect } from "../../types";
import { registerBoardAnchor } from "./boardLayout";

/**
 * Scene intros append anchors only: no work placement, erasure or page turns.
 * Keep the actual layout and prior anchor identities, not a replacement snapshot
 * of a shared ref. Each command explicitly registers its mutations with its beat
 * and root owners, so unrelated/successor anchors on the same layout survive.
 */
export interface IntroLayoutCheckpoint {
  readonly layout: BoardLayoutState;
  registerAnchor: (rect: BoardTextRect) => void;
  /** Call after the cancelled command execution has joined. */
  rollback: () => void;
}

export function createIntroLayoutCheckpoint(
  layout: BoardLayoutState,
  parent?: IntroLayoutCheckpoint,
): IntroLayoutCheckpoint {
  const anchorsBefore = new Set(layout.rects);
  const ownedAnchors = new Set<BoardTextRect>();
  return {
    layout,
    registerAnchor(rect) {
      ownedAnchors.add(rect);
      if (parent) parent.registerAnchor(rect);
      else registerBoardAnchor(layout, rect);
    },
    rollback() {
      // Mutate only the original object's owned entries. Do not replace its
      // array, resurrect erased anchors or reset a successor's work cursor.
      for (let index = layout.rects.length - 1; index >= 0; index--) {
        const rect = layout.rects[index]!;
        if (ownedAnchors.has(rect) && !anchorsBefore.has(rect)) layout.rects.splice(index, 1);
      }
      ownedAnchors.clear();
    },
  };
}
