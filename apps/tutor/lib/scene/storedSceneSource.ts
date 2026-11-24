import { ATOMIC_OPERATORS, MECHANICS_OPERATORS, validateTurnPlanV3, validatePlanOwnedSceneTruth, validatePublicAtomicSceneAdmission, validateSourceObservableUnitObligations, withMechanicsSceneSource } from "@heytutor/scene-engine";
import { withComputedQuantityRoster } from "@heytutor/tutor-core";
import { withNativeSceneStaging } from "./nativeSceneStaging";
import { deepEqual } from "@/features/tutor-session/lib/scene/diagramGeneration";
import { validateCoordinateDistanceSourceInputs, validateMatrixSourceBinding, validatePointLineSourceInputs, validateSectionPointSourceInputs, validateRelativeMotionSourceInputs, validateUniformCircularSourceInputs, validateSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import { isBlockedVerifiedDiagramCommand, isStoredCommandTrustedGeometry, parseStoredSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { storedTurnSceneQuestion } from "@/lib/boards/doubtFigure";

export function storedTurnSourceIssues(document: SceneDocument, turn: Partial<Pick<StoredTurn, "question" | "sceneArtifacts">>) {
  const artifacts = turn.sceneArtifacts;
  const plan = artifacts && typeof artifacts === "object"
    ? Object.getOwnPropertyDescriptor(artifacts, "turnPlan")?.value
    : undefined;
  // A doubt figure's scene was checked on the composed question, not its title.
  const retainedQuestion = storedTurnSceneQuestion(turn);
  const sourceQuestion = typeof document.source.question === "string" ? document.source.question : undefined;
  const question = retainedQuestion?.trim() ? retainedQuestion : sourceQuestion;
  const rawIR = artifacts && typeof artifacts === "object"
    ? Object.getOwnPropertyDescriptor(artifacts, "problemIR")?.value : undefined;
  const atomic = document.constructions.some(construction =>
    (ATOMIC_OPERATORS as readonly string[]).includes(construction.operator));
  const native = atomic || document.constructions.some(construction =>
    (MECHANICS_OPERATORS as readonly string[]).includes(construction.operator));
  const sourcePlan = validateTurnPlanV3(plan, question).plan;
  const issues = [
    ...(native ? validatePlanOwnedSceneTruth(document, sourcePlan, rawIR, question) : [
      ...validatePublicAtomicSceneAdmission(document, question),
      ...validateSourceObservableUnitObligations(document, sourcePlan, rawIR, question),
    ]),
    ...(atomic && (!sourcePlan || !retainedQuestion?.trim())
      ? [{ code: "atomic_source_authority_missing", severity: "fatal" as const, path: "sceneArtifacts.turnPlan",
        message: "A stored atomic relation requires its original question and accepted plan" }] : []),
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

/** Restore source-bound staging from the retained plan, never submitted answer ids. */
export function sourceCheckedStoredDocument(sceneDocument: unknown,
  turn: Partial<Pick<StoredTurn, "question" | "sceneArtifacts">>): SceneDocument | null {
  const structural = validateSceneDocument(sceneDocument);
  if (!structural.document || storedTurnSourceIssues(structural.document, turn).some(issue => issue.severity === "fatal")) return null;
  const rawPlan = turn.sceneArtifacts && typeof turn.sceneArtifacts === "object"
    ? Object.getOwnPropertyDescriptor(turn.sceneArtifacts, "turnPlan")?.value : undefined;
  const problemIR = turn.sceneArtifacts && typeof turn.sceneArtifacts === "object"
    ? Object.getOwnPropertyDescriptor(turn.sceneArtifacts, "problemIR")?.value : undefined;
  const document = problemIR != null && structural.document.constructions.some(construction =>
    (MECHANICS_OPERATORS as readonly string[]).includes(construction.operator))
    ? withMechanicsSceneSource(structural.document, problemIR) : structural.document;
  const retainedQuestion = storedTurnSceneQuestion(turn);
  const question = retainedQuestion?.trim() ? retainedQuestion : document.source.question;
  if (typeof question !== "string") return document;
  const plan = validateTurnPlanV3(rawPlan, question).plan;
  return withNativeSceneStaging(document, question, plan ? withComputedQuantityRoster(plan) : null, problemIR);
}

/** Optional undefined fields introduced by normalization do not survive stored
 * JSON and carry no scene meaning. Actual source/staging values still compare. */
function storedDocumentMeaning(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(storedDocumentMeaning);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, child]) => child !== undefined).map(([key, child]) => [key, storedDocumentMeaning(child)]));
  return value;
}

export function sourceCheckedStoredTurn(turn: StoredTurn): StoredTurn {
  if (turn.sceneDocument == null) return turn;
  const document = sourceCheckedStoredDocument(turn.sceneDocument, turn);
  if (document) return deepEqual(storedDocumentMeaning(document), storedDocumentMeaning(turn.sceneDocument))
    ? turn : { ...turn, sceneDocument: document };
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
