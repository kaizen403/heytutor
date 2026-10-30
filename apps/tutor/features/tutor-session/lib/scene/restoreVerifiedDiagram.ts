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
  validateTurnPlanV3,
  type SceneDocument,
} from "@heytutor/scene-engine";
import {
  verifiedDiagramHasDrawableInk,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import type { NarrationLanguage } from "@heytutor/tutor-core";
import { storedTurnSourceIssues } from "@/lib/scene/storedSceneSource";
import { storedTurnSceneQuestion } from "@/lib/boards/doubtFigure";
import { DSA_DIAGRAM_ZONE } from "../../constants";
import { buildVerifiedDiagramPresentation } from "./verifiedScenePresentation";

function isDsaSceneDocument(document: SceneDocument): boolean {
  return (document.source as Record<string, unknown>).synthesizedDsa === true;
}

export function restoreVerifiedPresentationFromTurn(
  turn: (Pick<StoredTurn, "sceneDocument"> & Partial<Pick<StoredTurn, "question" | "sceneArtifacts">>) | null | undefined,
  narrationLanguage?: NarrationLanguage,
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
  const rawPlan = turn.sceneArtifacts && typeof turn.sceneArtifacts === "object"
    ? Object.getOwnPropertyDescriptor(turn.sceneArtifacts, "turnPlan")?.value
    : undefined;
  // A doubt figure was planned on the composed question, not its title.
  const question = storedTurnSceneQuestion(turn);
  const plan = validateTurnPlanV3(rawPlan, question ?? String(document.source.question ?? "")).plan;
  const presentation = buildVerifiedDiagramPresentation(
    document,
    compiled.renderScene,
    { originalQuestion: question, narrationLanguage, ...(plan ? { turnPlan: plan } : {}), ...(dsa ? { layout: "code_lesson" as const } : {}) },
  );
  if (!verifiedDiagramHasDrawableInk(presentation.diagram)) return null;
  return presentation;
}

export function restoreVerifiedDiagramFromTurn(
  turn: (Pick<StoredTurn, "sceneDocument"> & Partial<Pick<StoredTurn, "question" | "sceneArtifacts">>) | null | undefined,
): VerifiedDiagram | null {
  return restoreVerifiedPresentationFromTurn(turn)?.diagram ?? null;
}
