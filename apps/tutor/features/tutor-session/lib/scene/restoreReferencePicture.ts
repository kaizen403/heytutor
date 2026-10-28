/**
 * Rebuild the reference picture a stored turn showed, so replay, restore and
 * export resolve `[FOCUS:reference_picture]` and keep the right of the board
 * reserved, the way `restoreVerifiedDiagramFromTurn` does for a scene.
 *
 * The picture's placement is read from the turn's own trusted `DRAW_PICTURE`
 * rows, which the server rebuilt from its stored record before saving; the
 * labels and description come from the artifact the server wrote beside them,
 * and so do the located parts and key of a turn saved with part focus on, so
 * replay, seek and export point at the same part targets the live turn had.
 * A turn with the artifact but no matching ink restores nothing. Call sites
 * try `restoreVerifiedDiagramFromTurn` first; a turn never carries both.
 */
import {
  isStoredCommandTrustedGeometry,
  parseStoredSegmentCommands,
  type VerifiedDiagram,
  type VerifiedDiagramCommand,
} from "@heytutor/drawing";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { readStoredReferencePicture, referencePictureDiagram } from "./referencePicturePresentation";

type RestorableTurn = Partial<Pick<StoredTurn, "sceneArtifacts" | "segments">>;

/** The trusted picture commands a turn stored for its picture id, in order. */
export function storedReferencePictureCommands(turn: RestorableTurn, id: string): VerifiedDiagramCommand[] {
  const commands: VerifiedDiagramCommand[] = [];
  for (const segment of turn.segments ?? []) {
    if (!isStoredCommandTrustedGeometry(segment.command)) continue;
    for (const command of parseStoredSegmentCommands(segment.command)) {
      if (command?.type !== "DRAW_PICTURE" || command.text !== id || !Array.isArray(command.params)) continue;
      commands.push({
        type: "DRAW_PICTURE",
        params: [...command.params],
        text: command.text,
        ...(command.semanticRef ? { semanticRef: { ...command.semanticRef } } : {}),
      });
    }
  }
  return commands;
}

export function restoreReferencePictureFromTurn(turn: RestorableTurn | null | undefined): VerifiedDiagram | null {
  if (!turn) return null;
  const picture = readStoredReferencePicture(turn.sceneArtifacts);
  if (!picture) return null;
  return referencePictureDiagram(picture, storedReferencePictureCommands(turn, picture.id));
}

/** Every picture id a set of stored turns will draw, once each, in order. */
export function referencePictureIdsOfTurns(turns: readonly (RestorableTurn | null | undefined)[]): string[] {
  const ids: string[] = [];
  for (const turn of turns) {
    const picture = turn ? readStoredReferencePicture(turn.sceneArtifacts) : null;
    if (picture && !ids.includes(picture.id) && storedReferencePictureCommands(turn!, picture.id).length > 0) ids.push(picture.id);
  }
  return ids;
}
