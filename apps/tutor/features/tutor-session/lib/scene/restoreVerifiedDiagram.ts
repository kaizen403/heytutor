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
  synthesizeFamilyScene,
  validateSceneDocument,
  type SceneDocument,
} from "@heytutor/scene-engine";
import {
  verifiedDiagramHasDrawableInk,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { storedTurnSourceIssues } from "@/lib/scene/storedSceneSource";
import { DSA_DIAGRAM_ZONE } from "../../constants";
import { buildVerifiedDiagramPresentation } from "./verifiedScenePresentation";
import { isVisualPresentationRefusal } from "./visualPresentationRefusal";

function isDsaSceneDocument(document: SceneDocument): boolean {
  return (document.source as Record<string, unknown>).synthesizedDsa === true;
}

/** JSONB may reorder object keys; canonical scene array order remains meaningful. */
function canonicalSceneJson(document: SceneDocument): string {
  return JSON.stringify(document, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([first], [second]) => first.localeCompare(second)))
      : value);
}

/**
 * Recover optional teaching context, never geometric or save permission.
 * Saved family strings, plans and ProblemIR are not general source authority.
 * Reconstruct from the external source alone and require the complete current
 * engine document to match the already-admitted canonical document. Historical
 * or custom layouts that cannot be reproduced keep their ordinary geometry but
 * receive no additional family-specific prompt guidance.
 */
function reconstructedSceneFamily(document: SceneDocument, question: string | undefined): string | undefined {
  if (typeof question !== "string" || !question.trim()) return undefined;
  try {
    const reconstructed = synthesizeFamilyScene({ question });
    if (!reconstructed || canonicalSceneJson(reconstructed.document) !== canonicalSceneJson(document)) return undefined;
    return reconstructed.family;
  } catch {
    // Optional context reconstruction must not mask real presentation failures.
    return undefined;
  }
}

export function restoreVerifiedPresentationFromTurn(
  turn: (Pick<StoredTurn, "sceneDocument"> & Partial<Pick<StoredTurn, "question" | "sceneArtifacts">>) | null | undefined,
): ReturnType<typeof buildVerifiedDiagramPresentation> | null {
  if (!turn?.sceneDocument) return null;
  const structural = validateSceneDocument(turn.sceneDocument);
  if (!structural.document) return null;
  const document = structural.document;
  if (document.visualDecision.mode !== "scene") return null;
  if (storedTurnSourceIssues(document, turn).some((issue) => issue.severity === "fatal")) return null;
  const dsa = isDsaSceneDocument(document);
  const compiled = compileSceneDocument(
    document,
    dsa ? { viewport: DSA_DIAGRAM_ZONE } : {},
  );
  if (!compiled.ok || !compiled.renderScene) return null;
  const figureFamily = dsa ? undefined : reconstructedSceneFamily(document, turn.question);
  let presentation: ReturnType<typeof buildVerifiedDiagramPresentation>;
  try {
    presentation = buildVerifiedDiagramPresentation(
      document, compiled.renderScene,
      { originalQuestion: turn.question, ...(figureFamily ? { figureFamily } : {}), ...(dsa ? { layout: "code_lesson" as const } : {}) },
    );
  } catch (error) {
    if (isVisualPresentationRefusal(error)) return null;
    throw error;
  }
  if (!verifiedDiagramHasDrawableInk(presentation.diagram)) return null;
  return presentation;
}

export function restoreVerifiedDiagramFromTurn(
  turn: (Pick<StoredTurn, "sceneDocument"> & Partial<Pick<StoredTurn, "question" | "sceneArtifacts">>) | null | undefined,
): VerifiedDiagram | null {
  return restoreVerifiedPresentationFromTurn(turn)?.diagram ?? null;
}
