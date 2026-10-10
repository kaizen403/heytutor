/** Opt-in bench profile for the exact production subject policy and picker client. */
import type { DiagramSubject } from '@heytutor/tutor-core';
import type { TurnPlanV3 } from '@heytutor/scene-engine';
import { evaluationDiagramStrategyDecision, liveDiagramStrategyDecision, type DiagramStrategyContext } from '../../features/tutor-session/lib/scene/diagramStrategy';
import { pickLiveDiagramExampleIds } from '../../features/tutor-session/lib/scene/diagramExamplePickerClient';
import { resolveCheapFireworksModel } from '../../lib/llm/fireworksModels';
import type { DiagramEvalArm } from './diagramEval';
import type { DiagramExemplar } from './diagramExamples';
import type { DiagramExamplePickerResult } from './diagramExamplePicker';

export function labStrategyDecision(arm: DiagramEvalArm, context: DiagramStrategyContext,
  strictSubjects: readonly DiagramSubject[] | null | undefined, classifiedSubject: DiagramSubject) {
  return strictSubjects ? liveDiagramStrategyDecision({ ...context, assignedStrategy: 'current',
    subject: classifiedSubject, strictSubjects }) : evaluationDiagramStrategyDecision(arm, context);
}

export async function pickProductionLabExamples(examples: readonly DiagramExemplar[], input: {
  origin: string; question: string; plan: TurnPlanV3; traceId?: string; fetchImpl?: typeof fetch;
}): Promise<DiagramExamplePickerResult> {
  const picked = await pickLiveDiagramExampleIds({ ...input,
    fetchImpl: (url, init) => (input.fetchImpl ?? fetch)(new URL(String(url), input.origin), init) });
  const admitted = picked.ids.flatMap(id => examples.filter(example => example.id === id)).slice(0, 3);
  return { examples: admitted, record: { method: 'model', status: picked.status, model: resolveCheapFireworksModel(),
    elapsedMs: picked.elapsedMs, catalogueEntries: examples.length, catalogueEstimatedTokens: 0,
    ids: admitted.map(example => example.id), attempts: input.plan.visualRequirement === 'none' ? 0 : 1,
    usageKnown: false, usageKnownCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0,
    fallbackReason: picked.status === 'timeout' || picked.status === 'failed' ? `live_picker_${picked.status}` : null } };
}
