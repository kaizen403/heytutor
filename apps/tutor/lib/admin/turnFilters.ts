import type { Prisma } from "@prisma/client";
import { CONFIRMED_TURN_FAILURE_CODES, UNCOMMITTED_VISUAL_STATUSES } from "../obs/turnFailureClassification";

/** Same positive evidence as classifyTurnFailure; missing JSON is never negated. */
export function failedTurnWhere(since?: Date): Prisma.TurnWhereInput {
  const noVerifiedFigure: Prisma.TurnWhereInput = {
    OR: [{ visualStatus: { in: [...UNCOMMITTED_VISUAL_STATUSES] } }, { visualStatus: null }],
  };
  const approvedCodes: Prisma.TurnWhereInput[] = CONFIRMED_TURN_FAILURE_CODES.flatMap(code => [
    { sceneArtifacts: { path: ["failureTelemetry", "code"], equals: code } },
    { sceneArtifacts: { path: ["degradation", "reason"], equals: code } },
  ]);
  const failed: Prisma.TurnWhereInput = {
    OR: [
      { sceneArtifacts: { path: ["failureTelemetry", "failed"], equals: true } },
      { visualStatus: "retry_required" },
      { AND: [noVerifiedFigure, { OR: approvedCodes }] },
      { status: "complete", segments: { none: {} } },
    ],
  };
  return since ? { AND: [failed, { createdAt: { gte: since } }] } : failed;
}
