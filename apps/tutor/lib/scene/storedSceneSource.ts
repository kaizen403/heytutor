import { canonicalizeUniformCircularSourceDocument, validateSceneSourceAuthority, validateCoordinateDistanceSourceInputs, validateMatrixSourceBinding, validatePointLineSourceInputs, validateSectionPointSourceInputs, validateRelativeMotionSourceInputs, validateUniformCircularSourceInputs, validateSceneDocument, type SceneDocument, type SceneIssue } from "@heytutor/scene-engine";
import { isBlockedVerifiedDiagramCommand, isStoredCommandTrustedGeometry, parseStoredSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { sourceBoundPlanIssues } from "./sourcePlanAdmission";

export function storedTurnSourceIssues(document: SceneDocument, turn: Partial<Pick<StoredTurn, "question" | "sceneArtifacts">>) {
  const artifacts = turn.sceneArtifacts;
  const plan = artifacts && typeof artifacts === "object"
    ? Object.getOwnPropertyDescriptor(artifacts, "turnPlan")?.value
    : undefined;
  const question = turn.question ?? document.source.question;
  const problemIR = artifacts && typeof artifacts === "object"
    ? Object.getOwnPropertyDescriptor(artifacts, "problemIR")?.value : undefined;
  const issues = [
    ...(typeof question === "string" ? sourceBoundPlanIssues(document, question, plan, problemIR) : []),
    ...(typeof question === "string" ? validateSceneSourceAuthority(document, question, problemIR,plan) : []),
    ...validateCoordinateDistanceSourceInputs(document, question),
    ...validatePointLineSourceInputs(document, question),
    ...validateSectionPointSourceInputs(document, question),
    ...validateMatrixSourceBinding(document, question, plan),
    ...validateRelativeMotionSourceInputs(document, question),
    ...validateUniformCircularSourceInputs(document, question),
  ];
  const tier = artifacts && typeof artifacts === "object"
    ? Object.getOwnPropertyDescriptor(artifacts, "representationTier")?.value
    : undefined;
  if (issues.some((issue) => issue.code === "matrix_source_component_only") && tier !== undefined && tier !== "question_representation") {
    issues.push({ code: "matrix_source_partial_scope", severity: "fatal", path: "sceneArtifacts.representationTier", message: "Stored source-proved matrix components cannot claim a whole-question verification tier" });
  }
  return issues;
}

/**
 * Source proof must see the submitted structure before validateSceneDocument
 * can promote ownership or repair reveal entries. The engine's source guards
 * alone decide scalar roundoff and object-key equality; this adds no waiver.
 */
export function rawStoredTurnSourceIssues(
  document: unknown,
  turn: Partial<Pick<StoredTurn, "question" | "sceneArtifacts">>,
): SceneIssue[] {
  try {
    // This is an untrusted guard input, not a parsed/admitted SceneDocument.
    // Malformed shapes that typed engine guards cannot inspect fail closed;
    // normal structural validation still runs after source proof succeeds.
    return storedTurnSourceIssues(document as SceneDocument, turn);
  } catch {
    return [{ code: "raw_scene_source_structure", severity: "fatal", path: "sceneDocument",
      message: "Raw scene structure could not be checked against its source before normalization" }];
  }
}

export function sourceCheckedStoredTurn(turn: StoredTurn): StoredTurn {
  if (turn.sceneDocument == null) return turn;
  const rawIssues = rawStoredTurnSourceIssues(turn.sceneDocument, turn);
  const structural = rawIssues.some((issue) => issue.severity === "fatal")
    ? null : validateSceneDocument(turn.sceneDocument,{sourceAuthority:{question:turn.question,problemIR:(turn.sceneArtifacts && typeof turn.sceneArtifacts==="object"?Object.getOwnPropertyDescriptor(turn.sceneArtifacts,"problemIR")?.value:undefined),turnPlan:(turn.sceneArtifacts && typeof turn.sceneArtifacts==="object"?Object.getOwnPropertyDescriptor(turn.sceneArtifacts,"turnPlan")?.value:undefined)}});
  if (structural?.document && !storedTurnSourceIssues(structural.document, turn).some((issue) => issue.severity === "fatal")) {
    const canonical = canonicalizeUniformCircularSourceDocument(structural.document, turn.question);
    if (canonical && JSON.stringify(canonical.quantities) !== JSON.stringify(structural.document.quantities)) return { ...turn, sceneDocument: canonical };
    return turn;
  }
  return {
    ...turn,
    visualStatus: "retry_required",
    segments: turn.segments.map((segment) => ({
      ...segment,
      command: isStoredCommandTrustedGeometry(segment.command)
        ? null
        : serializeSegmentCommands(parseStoredSegmentCommands(segment.command).filter((command) =>
            command.type === "CLEAR" || !isBlockedVerifiedDiagramCommand(command, null),
          )),
    })),
  };
}
