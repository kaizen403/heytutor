/**
 * What a doubt may point at, built once per doubt turn in useQuestionHandler.
 *
 * `DIAGRAM_DOUBT_POINTING` (granted per turn by begin-turn) decides whether a
 * doubt may walk, ring and letter the figure in the zone. This module turns
 * that grant and the figure on the board into the `DoubtPointingPolicy` the
 * live doubt filter applies, the cell list the code board prompt quotes, and
 * the figure a code board doubt hands the executor.
 *
 * On a code lesson board the figure is the worked-example frame on the board.
 * Its frame ids are never pointing targets: a FOCUS naming a frame would ask
 * the conductor to step the walk, and a doubt never steps it. So frame ids
 * are removed from the ids a doubt may name, `keep` is never allowed, and
 * every FOCUS is a spotlight.
 */
import {
  getSegmentCommands,
  withoutFocusKeep,
  type TutorSegment,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import type { DoubtPointingPolicy } from "@/lib/boards/doubtFigureRef";
import type { DoubtCodeFrameCell } from "./turnTeachingPrompt";

/** Lowercased anchor ids, anchor labels and group ids of a figure, minus `excludeIds`. */
export function doubtFigureIds(
  diagram: VerifiedDiagram | null,
  excludeIds: readonly string[] = [],
): Set<string> {
  const ids = new Set<string>();
  if (!diagram) return ids;
  const add = (raw: string | undefined) => {
    const id = raw?.trim().toLowerCase();
    if (id) ids.add(id);
  };
  for (const anchor of diagram.anchors) {
    add(anchor.id);
    for (const label of anchor.labels) add(label);
  }
  for (const group of diagram.groups ?? []) add(group.id);
  for (const raw of excludeIds) ids.delete(raw.trim().toLowerCase());
  return ids;
}

/**
 * The live doubt filter policy. `granted` is the turn's begin-turn grant and
 * is the only way `enabled` becomes true. `figure` is the figure in the zone
 * (on a code board, the frame on the board), or null when there is none.
 */
export function buildDoubtPointingPolicy(input: {
  granted: boolean;
  figure: VerifiedDiagram | null;
  codeBoard: boolean;
  /** Code board: the walk-through's frame ids, never pointing targets. */
  frameIds?: readonly string[];
}): DoubtPointingPolicy {
  const enabled = input.granted === true;
  return {
    enabled,
    figureIds: enabled ? doubtFigureIds(input.figure, input.codeBoard ? input.frameIds ?? [] : []) : new Set<string>(),
    codeBoard: input.codeBoard,
  };
}

/**
 * The figure a doubt's FOCUS resolves against. A figure board keeps the
 * lesson's figure, as before the flag. A code board points at nothing unless
 * the flag is on and a frame is visibly drawn, and then at that frame only.
 */
export function doubtActiveFigure(input: {
  granted: boolean;
  codeBoard: boolean;
  codeFigureVisible: boolean;
  zoneFigure: VerifiedDiagram | null;
}): VerifiedDiagram | null {
  if (!input.codeBoard) return input.zoneFigure;
  return input.granted === true && input.codeFigureVisible ? input.zoneFigure : null;
}

/** The frame's cells for the code board prompt: ids and labels only, no frame ids. */
export function doubtCodeFrameCells(
  frame: VerifiedDiagram | null,
  frameIds: readonly string[] = [],
): DoubtCodeFrameCell[] {
  if (!frame) return [];
  const frames = new Set(frameIds.map((id) => id.trim().toLowerCase()));
  return frame.anchors
    .filter((anchor) => anchor.id.trim() && !frames.has(anchor.id.trim().toLowerCase()))
    .map((anchor) => ({ id: anchor.id, labels: [...anchor.labels] }));
}

/**
 * The segment with every `|keep` removed from its FOCUS commands. Applied to
 * every turn the flag does not grant kept rings to, so a ring the model was
 * never offered is never drawn live and never saved.
 */
export function segmentWithoutFocusKeep(segment: TutorSegment): TutorSegment {
  const commands = getSegmentCommands(segment);
  if (commands.length === 0) return segment;
  const stripped = commands.map(withoutFocusKeep);
  if (stripped.every((command, index) => command === commands[index])) return segment;
  const next: TutorSegment = { ...segment, command: stripped[0] ?? null };
  if (stripped.length > 1) next.commands = stripped;
  else delete next.commands;
  return next;
}
