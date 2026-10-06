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
  canonicalizeUniformCircularSourceDocument,
  validateSceneDocument,
  type SceneDocument,
} from "@heytutor/scene-engine";
import {
  verifiedDiagramHasDrawableInk,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { rawStoredTurnSourceIssues, storedTurnSourceIssues } from "@/lib/scene/storedSceneSource";
import { DSA_DIAGRAM_ZONE } from "../../constants";
import { buildVerifiedDiagramPresentation } from "./verifiedScenePresentation";

function isDsaSceneDocument(document: SceneDocument): boolean {
  return (document.source as Record<string, unknown>).synthesizedDsa === true;
}

export function restoreVerifiedPresentationFromTurn(
  turn: (Pick<StoredTurn, "sceneDocument"> & Partial<Pick<StoredTurn, "question" | "sceneArtifacts">>) | null | undefined,
): ReturnType<typeof buildVerifiedDiagramPresentation> | null {
  if (!turn?.sceneDocument) return null;
  if (rawStoredTurnSourceIssues(turn.sceneDocument, turn).some((issue) => issue.severity === "fatal")) return null;
  const rawQuestion=turn.question ?? (turn.sceneDocument as SceneDocument).source?.question;
  if(typeof rawQuestion!=="string")return null;
  const structural = validateSceneDocument(turn.sceneDocument,{sourceAuthority:{question:rawQuestion,problemIR:(turn.sceneArtifacts && typeof turn.sceneArtifacts==="object"?Object.getOwnPropertyDescriptor(turn.sceneArtifacts,"problemIR")?.value:undefined),turnPlan:(turn.sceneArtifacts && typeof turn.sceneArtifacts==="object"?Object.getOwnPropertyDescriptor(turn.sceneArtifacts,"turnPlan")?.value:undefined)}});
  if (!structural.document) return null;
  let document = structural.document;
  if (document.visualDecision.mode !== "scene") return null;
  if (storedTurnSourceIssues(document, turn).some((issue) => issue.severity === "fatal")) return null;
  const question = turn.question ?? document.source.question;
  if (typeof question !== "string") return null;
  document = canonicalizeUniformCircularSourceDocument(document, question) ?? document;
  const dsa = isDsaSceneDocument(document);
  const compiled = compileSceneDocument(
    document,
    { ...(dsa ? { viewport: DSA_DIAGRAM_ZONE } : {}), sourceAuthority: { question, problemIR: turn.sceneArtifacts && typeof turn.sceneArtifacts === "object"
      ? Object.getOwnPropertyDescriptor(turn.sceneArtifacts, "problemIR")?.value : undefined,turnPlan:turn.sceneArtifacts && typeof turn.sceneArtifacts === "object" ? Object.getOwnPropertyDescriptor(turn.sceneArtifacts,"turnPlan")?.value : undefined } },
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
  turn: (Pick<StoredTurn, "sceneDocument"> & Partial<Pick<StoredTurn, "question" | "sceneArtifacts">>) | null | undefined,
): VerifiedDiagram | null {
  return restoreVerifiedPresentationFromTurn(turn)?.diagram ?? null;
}
