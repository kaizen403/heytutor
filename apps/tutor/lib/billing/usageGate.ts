export interface UsageGateGrant {
  lessonTraceId: string;
  allowedTraceIds: Set<string>;
}

export type BeginTurnKind = "lesson" | "doubt" | "resume";

/**
 * Reusing an existing lesson identity does not authorize new provider spend.
 * Each paid call separately reserves its cost against the persisted balance.
 */
export function beginTurnAccess(input: {
  remainingMillicents: number;
  grant: UsageGateGrant | null;
  kind: BeginTurnKind;
  traceId: string;
}): "allow" | "out_of_credits" {
  if (input.remainingMillicents > 0) return "allow";
  const grant = input.grant;
  if (!grant) return "out_of_credits";
  if (grant.allowedTraceIds.has(input.traceId) || grant.lessonTraceId === input.traceId) {
    return "allow";
  }
  if (input.kind !== "lesson") return "allow";
  return "out_of_credits";
}

/**
 * /api/chat and TTS look up the in-memory grant. Next.js can compile a
 * route after begin-turn and drop that Map. Remint while USD remains
 * instead of mapping a missing grant to Out of usage.
 */
export function paidCallAccess(input: {
  remainingMillicents: number;
  grant: unknown | null;
}): "allow" | "out_of_credits" {
  if (input.remainingMillicents > 0) return "allow";
  return "out_of_credits";
}
