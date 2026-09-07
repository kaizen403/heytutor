import {
  SCENE_ENGINE_VERSION,
  validateTurnPlanV3,
  type SceneDocument,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { canAdoptVerifiedScene, fingerprintTurnPlan, sceneCompileIsolationKey } from "./sceneIsolation";

const MAX_MEMORY_ENTRIES = 32;

export type VerifiedSceneScope = {
  /** Isolation boundary. Concurrent lecture jobs must pass their own boardId. */
  boardId: string;
};

export interface VerifiedSceneRecovery {
  question: string;
  document: SceneDocument;
  turnPlan: TurnPlanV3;
  source: "memory" | "stored_turn";
}

interface MemoryEntry {
  boardId: string;
  question: string;
  document: SceneDocument;
  turnPlan: TurnPlanV3;
}

const memory = new Map<string, MemoryEntry>();

/**
 * Recovery is deliberately limited to exact, self-contained questions. The
 * caller still has to run the current semantic validator and compiler.
 */
export function findVerifiedSceneRecovery(
  question: string,
  storedTurns: readonly StoredTurn[],
  scope: VerifiedSceneScope,
): VerifiedSceneRecovery | null {
  const boardId = scope.boardId.trim();
  const questionKey = recoveryKey(question);
  if (!boardId || !questionKey) return null;

  const memoryKey = verifiedSceneMemoryKey(boardId, questionKey);
  const cached = memory.get(memoryKey);
  if (cached && sceneMatchesScope(cached, question, boardId)) {
    memory.delete(memoryKey);
    memory.set(memoryKey, cached);
    return cloneRecovery({ ...cached, source: "memory" });
  }

  for (let index = storedTurns.length - 1; index >= 0; index -= 1) {
    const turn = storedTurns[index]!;
    if (
      turn.visualStatus !== "validated" ||
      turn.sceneEngineVersion !== SCENE_ENGINE_VERSION ||
      recoveryKey(turn.question) !== questionKey ||
      !isRecord(turn.sceneDocument) ||
      !isRecord(turn.sceneArtifacts) ||
      turn.sceneArtifacts.schemaVersion !== "scene-artifacts/v3" ||
      turn.sceneArtifacts.diagramResultStatus !== "ready" ||
      (turn.sceneArtifacts.representationTier !== undefined &&
        turn.sceneArtifacts.representationTier !== "exact_verified") ||
      turn.sceneArtifacts.nonMetric === true ||
      (isRecord(turn.sceneDocument.source) && turn.sceneDocument.source.nonMetric === true)
    ) {
      continue;
    }

    const planValidation = validateTurnPlanV3(turn.sceneArtifacts.turnPlan, question);
    if (!planValidation.plan) continue;

    const document = turn.sceneDocument as unknown as SceneDocument;
    const entry: MemoryEntry = {
      boardId,
      question,
      document,
      turnPlan: planValidation.plan,
    };
    if (!sceneMatchesScope(entry, question, boardId)) {
      continue;
    }
    rememberEntry(memoryKey, entry);
    return cloneRecovery({ ...entry, source: "stored_turn" });
  }

  return null;
}

export function rememberVerifiedScene(
  question: string,
  document: SceneDocument,
  turnPlan: TurnPlanV3,
  scope: VerifiedSceneScope,
): void {
  if (
    document.source.nonMetric === true ||
    (document.source.representationTier !== undefined &&
      document.source.representationTier !== "exact_verified")
  ) {
    return;
  }
  const boardId = scope.boardId.trim();
  const questionKey = recoveryKey(question);
  if (!boardId || !questionKey) return;
  const entry: MemoryEntry = {
    boardId,
    question,
    document: clone(document),
    turnPlan: clone(turnPlan),
  };
  if (!sceneMatchesScope(entry, question, boardId)) {
    return;
  }
  rememberEntry(verifiedSceneMemoryKey(boardId, questionKey), entry);
}

export function forgetVerifiedScene(question: string, scope: VerifiedSceneScope): void {
  const boardId = scope.boardId.trim();
  const questionKey = recoveryKey(question);
  if (!boardId || !questionKey) return;
  memory.delete(verifiedSceneMemoryKey(boardId, questionKey));
}

export function verifiedSceneMemoryKey(boardId: string, questionKey: string): string {
  return `${boardId.trim()}::${questionKey}`;
}

export function isRecoveryEligibleQuestion(question: string): boolean {
  const normalized = question.trim();
  if (normalized.length < 8) return false;
  return !(
    /^(?:it|this|that|these|those|same|again|and|also)\b/i.test(normalized) ||
    /\b(?:what\s+(?:about|if)|instead|previous\s+(?:one|question|diagram)|above\s+(?:one|question|diagram))\b/i.test(normalized)
  );
}

function recoveryKey(question: string): string | null {
  if (!isRecoveryEligibleQuestion(question)) return null;
  return question.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function sceneMatchesScope(
  entry: Pick<MemoryEntry, "boardId" | "question" | "document" | "turnPlan">,
  question: string,
  boardId: string,
): boolean {
  const sourceQuestion =
    typeof entry.document.source.question === "string" ? entry.document.source.question : entry.question;
  const planFingerprint = fingerprintTurnPlan(entry.turnPlan);
  return canAdoptVerifiedScene({
    ownerBoardId: boardId,
    ownerQuestion: question,
    candidateBoardId: entry.boardId,
    candidateQuestion: sourceQuestion,
    ownerCompileKey: sceneCompileIsolationKey({ question, planFingerprint }),
    candidateCompileKey: sceneCompileIsolationKey({ question: sourceQuestion, planFingerprint }),
  });
}

function rememberEntry(key: string, entry: MemoryEntry): void {
  memory.delete(key);
  memory.set(key, entry);
  while (memory.size > MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (typeof oldest !== "string") break;
    memory.delete(oldest);
  }
}

function cloneRecovery(recovery: VerifiedSceneRecovery): VerifiedSceneRecovery {
  return {
    ...recovery,
    document: clone(recovery.document),
    turnPlan: clone(recovery.turnPlan),
  };
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
