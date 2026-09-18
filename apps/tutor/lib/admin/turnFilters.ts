import type { Prisma } from "@prisma/client";
import { FAILED_VISUAL_STATUSES } from "./outcome";

/** Turns that taught without a verified diagram, optionally within a window. */
export function failedTurnWhere(since?: Date): Prisma.TurnWhereInput {
  const failed: Prisma.TurnWhereInput = {
    OR: [{ visualStatus: { in: [...FAILED_VISUAL_STATUSES] } }, { visualStatus: null }],
  };
  return since ? { AND: [failed, { createdAt: { gte: since } }] } : failed;
}
