import {
  SCENE_ENGINE_VERSION,
  validateTurnPlanV3,
  type SceneDocument,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import type { StoredTurn } from "@/lib/boardsClient";

const MAX_MEMORY_ENTRIES = 32;

export interface VerifiedSceneRecovery {
  question: string;
  document: SceneDocument;
  turnPlan: TurnPlanV3;
  source: "memory" | "stored_turn";
}

interface MemoryEntry {
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
): VerifiedSceneRecovery | null {
  const key = recoveryKey(question);
  if (!key) return null;

  const cached = memory.get(key);
  if (cached) {
    memory.delete(key);
    memory.set(key, cached);
    return cloneRecovery({ ...cached, source: "memory" });
  }

  for (let index = storedTurns.length - 1; index >= 0; index -= 1) {
    const turn = storedTurns[index]!;
    if (
      turn.visualStatus !== "validated" ||
      turn.sceneEngineVersion !== SCENE_ENGINE_VERSION ||
      recoveryKey(turn.question) !== key ||
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

    const entry: MemoryEntry = {
      question,
      document: turn.sceneDocument as unknown as SceneDocument,
      turnPlan: planValidation.plan,
    };
    rememberEntry(key, entry);
    return cloneRecovery({ ...entry, source: "stored_turn" });
  }

  return null;
}

export function rememberVerifiedScene(
  question: string,
  document: SceneDocument,
  turnPlan: TurnPlanV3,
): void {
  if (
    document.source.nonMetric === true ||
    (document.source.representationTier !== undefined &&
      document.source.representationTier !== "exact_verified")
  ) {
    return;
  }
  const key = recoveryKey(question);
  if (!key) return;
  rememberEntry(key, {
    question,
    document: clone(document),
    turnPlan: clone(turnPlan),
  });
}

export function forgetVerifiedScene(question: string): void {
  const key = recoveryKey(question);
  if (key) memory.delete(key);
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
