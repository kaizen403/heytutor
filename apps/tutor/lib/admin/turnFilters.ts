import { Prisma } from "@prisma/client";
import { CONFIRMED_TURN_FAILURE_CODES, PICTURE_ANSWERED_FAILURE_CODES, UNCOMMITTED_VISUAL_STATUSES } from "../obs/turnFailureClassification";

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
  // AnyNull, not NOT: a row with no picture has no such path, and NOT over a
  // missing JSON path is NULL, which would drop that row from the feed.
  const noShownPicture: Prisma.TurnWhereInput = { sceneArtifacts: { path: ["referencePicture", "id"], equals: Prisma.AnyNull } };
  const failed: Prisma.TurnWhereInput = {
    OR: [
      { sceneArtifacts: { path: ["failureTelemetry", "failed"], equals: true } },
      { AND: [{ visualStatus: "retry_required" }, noShownPicture] },
      { AND: [noVerifiedFigure, { OR: codeEvidence(CONFIRMED_TURN_FAILURE_CODES.filter(code => !answered.includes(code))) }] },
      { AND: [noVerifiedFigure, noShownPicture, { OR: codeEvidence(answered) }] },
      { status: "complete", segments: { none: {} } },
    ],
  };
  return since ? { AND: [failed, { createdAt: { gte: since } }] } : failed;
}
