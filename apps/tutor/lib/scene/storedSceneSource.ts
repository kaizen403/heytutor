import { canonicalizeUniformCircularSourceDocument, validateSceneSourceAuthority, validateCoordinateDistanceSourceInputs, validateMatrixSourceBinding, validatePointLineSourceInputs, validateSectionPointSourceInputs, validateRelativeMotionSourceInputs, validateUniformCircularSourceInputs, validateSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import { isBlockedVerifiedDiagramCommand, isStoredCommandTrustedGeometry, parseStoredSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";
import type { StoredTurn } from "@/lib/boards/boardsClient";

export function storedTurnSourceIssues(document: SceneDocument, turn: Partial<Pick<StoredTurn, "question" | "sceneArtifacts">>) {
  const artifacts = turn.sceneArtifacts;
  const plan = artifacts && typeof artifacts === "object"
    ? Object.getOwnPropertyDescriptor(artifacts, "turnPlan")?.value
    : undefined;
  const question = turn.question ?? document.source.question;
  const problemIR = artifacts && typeof artifacts === "object"
    ? Object.getOwnPropertyDescriptor(artifacts, "problemIR")?.value : undefined;
  const issues = [
    ...(typeof question === "string" ? validateSceneSourceAuthority(document, question, problemIR) : []),
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

export function sourceCheckedStoredTurn(turn: StoredTurn): StoredTurn {
  if (turn.sceneDocument == null) return turn;
  const structural = validateSceneDocument(turn.sceneDocument);
  if (structural.document && !storedTurnSourceIssues(structural.document, turn).some((issue) => issue.severity === "fatal")) {
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
