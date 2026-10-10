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
