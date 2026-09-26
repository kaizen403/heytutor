/**
 * Rebuild the verified diagram a stored turn taught, so replay FOCUS / ANNOTATE
 * can resolve the same anchors the live lesson used.
 *
 * Replay used to draw the intro ink from persisted commands and then run
 * teaching FOCUS against a null diagram. The intro still appeared; the pen
 * never traced, labelled, or spotlighted anything after it.
 */
import {
  compileSceneDocument,
  validateSceneDocument,
  type SceneDocument,
} from "@heytutor/scene-engine";
import {
  verifiedDiagramHasDrawableInk,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { DSA_DIAGRAM_ZONE } from "../../constants";
import { buildVerifiedDiagramPresentation } from "./verifiedScenePresentation";

function isDsaSceneDocument(document: SceneDocument): boolean {
  return (document.source as Record<string, unknown>).synthesizedDsa === true;
}

export function restoreVerifiedPresentationFromTurn(
  turn: Pick<StoredTurn, "sceneDocument"> | null | undefined,
): ReturnType<typeof buildVerifiedDiagramPresentation> | null {
  if (!turn?.sceneDocument) return null;
  const structural = validateSceneDocument(turn.sceneDocument);
  if (!structural.document) return null;
  const document = structural.document;
  if (document.visualDecision.mode !== "scene") return null;
  const dsa = isDsaSceneDocument(document);
  const compiled = compileSceneDocument(
    document,
    dsa ? { viewport: DSA_DIAGRAM_ZONE } : {},
  );
  if (!compiled.ok || !compiled.renderScene) return null;
  const presentation = buildVerifiedDiagramPresentation(
    document,
    compiled.renderScene,
    dsa ? { layout: "code_lesson" } : {},
  );
  if (!verifiedDiagramHasDrawableInk(presentation.diagram)) return null;
  return presentation;
}

export function restoreVerifiedDiagramFromTurn(
  turn: Pick<StoredTurn, "sceneDocument"> | null | undefined,
): VerifiedDiagram | null {
  return restoreVerifiedPresentationFromTurn(turn)?.diagram ?? null;
}
