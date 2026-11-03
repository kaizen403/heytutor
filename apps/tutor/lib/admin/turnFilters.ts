import { Prisma } from "@prisma/client";
import {
  CONFIRMED_TURN_FAILURE_CODES,
  PICTURE_ANSWERED_FAILURE_CODES,
  PICTURE_ANSWERED_REQUEST_CODES,
  PICTURE_ANSWERED_REQUEST_STAGES,
  UNCOMMITTED_VISUAL_STATUSES,
} from "../obs/turnFailureClassification";
import { FAILED_TURN_STAGES } from "../obs/failedTurnTelemetry";

/** A stored reference picture, by positive evidence: only the server writes it. */
export function shownPictureWhere(): Prisma.TurnWhereInput {
  return { sceneArtifacts: { path: ["referencePicture", "id"], string_starts_with: "rp_" } };
}

/** Same positive evidence as classifyTurnFailure; missing JSON is never negated. */
export function failedTurnWhere(since?: Date): Prisma.TurnWhereInput {
  const noVerifiedFigure: Prisma.TurnWhereInput = {
    OR: [{ visualStatus: { in: [...UNCOMMITTED_VISUAL_STATUSES] } }, { visualStatus: null }],
  };
  const codeEvidence = (codes: readonly string[]): Prisma.TurnWhereInput[] => codes.flatMap(code => [
    { sceneArtifacts: { path: ["failureTelemetry", "code"], equals: code } },
    { sceneArtifacts: { path: ["degradation", "reason"], equals: code } },
  ]);
  const answered: readonly string[] = PICTURE_ANSWERED_FAILURE_CODES;
  const requestCodes: readonly string[] = PICTURE_ANSWERED_REQUEST_CODES;
  const requestStages: readonly string[] = PICTURE_ANSWERED_REQUEST_STAGES;
  // AnyNull, not NOT: a row with no picture has no such path, and NOT over a
  // missing JSON path is NULL, which would drop that row from the feed.
  const noShownPicture: Prisma.TurnWhereInput = { sceneArtifacts: { path: ["referencePicture", "id"], equals: Prisma.AnyNull } };
  const failed: Prisma.TurnWhereInput = {
    OR: [
      { sceneArtifacts: { path: ["failureTelemetry", "failed"], equals: true } },
      { AND: [{ visualStatus: "retry_required" }, noShownPicture] },
      { AND: [noVerifiedFigure, { OR: [
        ...codeEvidence(CONFIRMED_TURN_FAILURE_CODES.filter(code => !answered.includes(code) && !requestCodes.includes(code))),
        ...requestCodes.map(code => ({ sceneArtifacts: { path: ["degradation", "reason"], equals: code } })),
      ] }] },
      { AND: [noVerifiedFigure, noShownPicture, { OR: codeEvidence(answered) }] },
      { AND: [
        noVerifiedFigure,
        { OR: requestCodes.map(code => ({ sceneArtifacts: { path: ["failureTelemetry", "code"], equals: code } })) },
        { OR: [
          noShownPicture,
          { sceneArtifacts: { path: ["failureTelemetry", "stage"], equals: Prisma.AnyNull } },
          ...FAILED_TURN_STAGES.filter(stage => !requestStages.includes(stage))
            .map(stage => ({ sceneArtifacts: { path: ["failureTelemetry", "stage"], equals: stage } })),
        ] },
      ] },
      { status: "complete", segments: { none: {} } },
    ],
  };
  return since ? { AND: [failed, { createdAt: { gte: since } }] } : failed;
}
