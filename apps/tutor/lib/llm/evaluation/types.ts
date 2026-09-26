/** Application contract for Jev. This is not a vendor SDK type. */

export const JEV_GATEWAY_MODEL = "typesafe-ai/jev";
export const JEV_EVALUATE_URL = "https://ai-gateway.vercel.sh/v1/evaluate";
export const EVALUATION_POLICY_VERSION = "advisory/v1";
export const LESSON_REVIEW_RUBRIC_VERSION = "lesson-review/v1";
export const NOTES_ROUTING_RUBRIC_VERSION = "notes-routing/v1";
export const VISUAL_NEED_RUBRIC_VERSION = "visual-need/v1";

export type TutorEvaluationJob = "lesson_review" | "notes_routing" | "visual_need";

export type EvaluationQuestion =
  | {
      type: "boolean";
      instructions: string;
      criteria?: { true: string; false: string };
    }
  | {
      type: "choice";
      instructions: string;
      criteria: Record<string, string>;
    }
  | {
      type: "score";
      instructions: string;
      criteria: string[];
    };

export type NormalizedAnswer =
  | { type: "boolean"; probability: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number> | null }
  | { type: "score"; score: number; probabilities: Record<string, number> | null };

export interface EvaluationUsage {
  inputTokens: number;
  outputTokens: number;
  reportedCostUsd: number | null;
  estimatedUsd: number;
}

export interface EvaluationProvenance {
  model: string;
  rubricVersion: string;
  policyVersion: string;
  inputHash: string;
  latencyMs: number;
  gatewayModel: string | null;
  generationId: string | null;
}

export interface LessonReviewFigure {
  committed: boolean;
  family: string | null;
  tier: string | null;
  labels: string[];
  reason: string | null;
}

export interface LessonReviewState {
  notice: string;
  question: string;
  requestedParts: string[];
  authoritativeFacts: string[];
  spokenExplanation: string;
  boardRows: string[];
  figure: LessonReviewFigure | null;
  truncated: boolean;
}

export interface NotesRoutingState {
  notice: string;
  studentMessage: string;
  taggedLine: string | null;
  lessonNotes: string;
}

export interface VisualNeedState {
  notice: string;
  question: string;
  conversationContext?: string;
}

export type TutorEvaluationRequest =
  | { job: "lesson_review"; state: LessonReviewState }
  | { job: "notes_routing"; state: NotesRoutingState }
  | { job: "visual_need"; state: VisualNeedState };

export type TutorAssessment =
  | {
      status: "assessed";
      job: TutorEvaluationJob;
      answers: Record<string, NormalizedAnswer>;
      /** Lesson-review problems. Empty when the job is notes routing. */
      flags: string[];
      /**
       * Notes-routing choice. Null for lesson review. `uncertain` and
       * `strong_narrator` both keep the current generator.
       */
      decision: "cheap_explanation" | "strong_narrator" | "uncertain" | null;
      /** True only for an explicit cheap_explanation choice. */
      useCheapGenerator: boolean;
      provenance: EvaluationProvenance;
      usage: EvaluationUsage;
    }
  | {
      status: "unavailable";
      job: TutorEvaluationJob;
      reason: string;
    };

export interface AssessOptions {
  fetchImpl?: typeof fetch;
  apiKey?: string | null;
  endpoint?: string;
  model?: string;
  deadlineMs?: number;
  signal?: AbortSignal;
  /** Default true. Student-linked calls should leave this on. */
  zeroDataRetention?: boolean;
  /** Notes routing uses this so a dead evaluator stops adding wait. */
  circuit?: boolean;
}
