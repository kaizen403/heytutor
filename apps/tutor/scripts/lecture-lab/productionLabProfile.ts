/** Opt-in bench profile for the exact production subject policy and picker client. */
import type { DiagramSubject } from '@heytutor/tutor-core';
import type { TurnPlanV3 } from '@heytutor/scene-engine';
import { DIAGRAM_STRATEGY_POLICY_VERSION, PHYSICS_HYBRID_POLICY_VERSION,
  evaluationDiagramStrategyDecision, liveDiagramStrategyDecision, type DiagramStrategyContext } from '../../features/tutor-session/lib/scene/diagramStrategy';
import { pickLiveDiagramExampleIds } from '../../features/tutor-session/lib/scene/diagramExamplePickerClient';
import { resolveCheapFireworksModel } from '../../lib/llm/fireworksModels';
import { evaluationUsesExamples, type DiagramEvalArm } from './diagramEval';
import type { DiagramExemplar } from './diagramExamples';
import type { DiagramExamplePickerResult } from './diagramExamplePicker';

export function hasProductionLabProfile(strictSubjects: readonly DiagramSubject[] | null | undefined,
  physicsMode?: 'hybrid' | null): boolean {
  return strictSubjects != null || physicsMode === 'hybrid';
}

/** The corpus label cannot tell whether the actual planner will opt into strict maths. */
export function productionLabUsesExamples(arm: DiagramEvalArm,
  strictSubjects: readonly DiagramSubject[] | null | undefined): boolean {
  return hasProductionLabProfile(strictSubjects) || evaluationUsesExamples(arm);
}

/** Approximate usage preflight, not the per-call hard-cap billing reservation. */
export function productionLabPreflightArm(arm: DiagramEvalArm,
  strictSubjects: readonly DiagramSubject[] | null | undefined): DiagramEvalArm {
  return hasProductionLabProfile(strictSubjects) ? 'planner_examples_strict' : arm;
}

/** Shared by row, checkpoint and summary identity; mode/policy changes forbid resume. */
export function productionLabExecutionIdentity(strictSubjects: readonly DiagramSubject[] | null | undefined,
  physicsMode: 'hybrid' | null) {
  return hasProductionLabProfile(strictSubjects, physicsMode) ? {
    productionStrictSubjects: strictSubjects ?? [], productionPhysicsMode: physicsMode,
    diagramStrategyPolicyVersion: DIAGRAM_STRATEGY_POLICY_VERSION,
    physicsHybridPolicyVersion: PHYSICS_HYBRID_POLICY_VERSION,
    examplePickerProfile: 'live-client-4000ms/v1', subjectClassification: 'existing-turn-plan',
  } : {};
}

export function labStrategyDecision(arm: DiagramEvalArm, context: DiagramStrategyContext,
  strictSubjects: readonly DiagramSubject[] | null | undefined, classifiedSubject: DiagramSubject) {
  return hasProductionLabProfile(strictSubjects, context.physicsMode) ? liveDiagramStrategyDecision({ ...context, assignedStrategy: 'current',
    subject: classifiedSubject, strictSubjects: strictSubjects ?? [] }) : evaluationDiagramStrategyDecision(arm, context);
}

export async function pickProductionLabExamples(examples: readonly DiagramExemplar[], input: {
  origin: string; question: string; plan: TurnPlanV3; traceId?: string; fetchImpl?: typeof fetch;
}): Promise<DiagramExamplePickerResult> {
  // The live client can resolve an absolute public API origin. Lab requests
  // must use its configured server so auth, provider checks and cap accounting
  // all cross run.ts's same-origin /api/chat boundary.
  const labChatUrl = new URL('/api/chat', input.origin);
  const picked = await pickLiveDiagramExampleIds({ ...input,
    fetchImpl: (_requestUrl, init) => (input.fetchImpl ?? fetch)(labChatUrl, init) });
  const admitted = picked.ids.flatMap(id => examples.filter(example => example.id === id)).slice(0, 3);
  const status = picked.status === 'picked' && admitted.length === 0 ? 'none' : picked.status;
  return { examples: admitted, record: { method: 'model', status, model: resolveCheapFireworksModel(),
    elapsedMs: picked.elapsedMs, catalogueEntries: examples.length, catalogueEstimatedTokens: 0,
    ids: admitted.map(example => example.id), attempts: input.plan.visualRequirement === 'none' ? 0 : 1,
    usageKnown: false, usageKnownCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0,
    fallbackReason: picked.status === 'timeout' || picked.status === 'failed' ? `live_picker_${picked.status}` : null } };
}
