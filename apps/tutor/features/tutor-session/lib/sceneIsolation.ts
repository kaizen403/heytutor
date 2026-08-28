/**
 * Verified-scene isolation. Concurrent boards (admin lecture lab, or two
 * shells in one tab) must not adopt each other's documents or primitives.
 *
 * Compile / recovery caches key by question + plan + families — never by unit
 * and never by "last successful scene".
 */

export type SceneCompileIsolationInput = {
  question: string;
  planFingerprint?: string;
  families?: readonly string[];
};

function normalizeQuestion(question: string): string {
  return question.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/**
 * Scene compile / recovery cache key. Two questions in the same unit must not
 * collide. Unit ids and "last scene" are intentionally absent.
 */
export function sceneCompileIsolationKey(input: SceneCompileIsolationInput): string {
  const question = normalizeQuestion(input.question);
  const plan = input.planFingerprint?.trim() ?? "";
  const families = [...(input.families ?? [])].filter(Boolean).sort().join(",");
  return `q:${question}|plan:${plan}|families:${families}`;
}

export function fingerprintTurnPlan(plan: {
  givens?: readonly { id?: string; symbol?: string; value?: unknown }[];
  unknowns?: readonly { id?: string; symbol?: string }[];
  qualitativeClaims?: readonly { id?: string; claim?: string; statement?: string }[];
  lawIds?: readonly string[];
}): string {
  const givens = (plan.givens ?? [])
    .map((given) => `${given.id ?? ""}:${given.symbol ?? ""}:${String(given.value ?? "")}`)
    .join(",");
  const unknowns = (plan.unknowns ?? [])
    .map((unknown) => `${unknown.id ?? ""}:${unknown.symbol ?? ""}`)
    .join(",");
  const claims = (plan.qualitativeClaims ?? [])
    .map((claim) => `${claim.id ?? ""}:${claim.claim ?? claim.statement ?? ""}`)
    .join(",");
  const laws = [...(plan.lawIds ?? [])].join(",");
  return `g:${givens}|u:${unknowns}|c:${claims}|laws:${laws}`;
}

/**
 * A board may paint a scene only when it owns the board id and the question
 * (and compile key, when present) match. Same unit is never enough.
 */
export function canAdoptVerifiedScene(input: {
  ownerBoardId: string;
  ownerQuestion: string;
  candidateBoardId: string;
  candidateQuestion: string;
  ownerCompileKey?: string;
  candidateCompileKey?: string;
}): boolean {
  const ownerBoardId = input.ownerBoardId.trim();
  const candidateBoardId = input.candidateBoardId.trim();
  if (!ownerBoardId || ownerBoardId !== candidateBoardId) {
    return false;
  }
  const ownerQuestion = normalizeQuestion(input.ownerQuestion);
  const candidateQuestion = normalizeQuestion(input.candidateQuestion);
  if (!ownerQuestion || ownerQuestion !== candidateQuestion) {
    return false;
  }
  if (
    input.ownerCompileKey &&
    input.candidateCompileKey &&
    input.ownerCompileKey !== input.candidateCompileKey
  ) {
    return false;
  }
  return true;
}
