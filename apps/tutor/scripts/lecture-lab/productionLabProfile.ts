/** Opt-in bench profile for the exact production subject policy and picker client. */
import type { DiagramSubject } from '@heytutor/tutor-core';
import type { TurnPlanV3 } from '@heytutor/scene-engine';
import { DIAGRAM_STRATEGY_POLICY_VERSION, PHYSICS_HYBRID_POLICY_VERSION,
  evaluationDiagramStrategyDecision, liveDiagramStrategyDecision, type DiagramStrategyContext } from '../../features/tutor-session/lib/scene/diagramStrategy';
import { pickLiveDiagramExampleIds } from '../../features/tutor-session/lib/scene/diagramExamplePickerClient';
import { resolveCheapFireworksModel } from '../../lib/llm/fireworksModels';
