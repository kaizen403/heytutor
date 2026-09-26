import type { LessonNotesSnapshot } from "@/features/tutor-session/lib/notes/lessonNotes";
import { formatLessonNotesForPrompt } from "@/features/tutor-session/lib/notes/lessonNotes";
import { selectNotesForPrompt } from "@/features/tutor-session/lib/notes/notesContext";
import type { NotesChatTag } from "@/features/tutor-session/lib/notes/notesChatTag";
import { resolveProblemIRFireworksModel, resolveTeachingFireworksModel } from "./fireworksModels";
import { assessTutorState } from "./evaluation/gateway";
import { NOTES_DATA_NOTICE } from "./evaluation/rubrics";
import type { TutorAssessment } from "./evaluation/types";

export type NotesEvaluationMode = "off" | "cheap" | "shadow" | "jev";

export interface NotesChatPreparation {
  mode: NotesEvaluationMode;
  model: string;
  notesText: string;
  context: "full" | "bounded";
  truncated: boolean;
  evaluation: TutorAssessment | null;
}

/**
 * `off` is the live default: Kimi Fast and the whole board.
 * `cheap` always uses the notes model and bounded context.
 * `shadow` still answers with Kimi and records a Jev recommendation.
 * `jev` uses the cheap model only when Jev explicitly chooses it.
 */
function resolveNotesEvaluationMode(
  env: Record<string, string | undefined> = process.env,
): NotesEvaluationMode {
  const raw = env.TUTOR_NOTES_EVALUATION_MODE?.trim().toLowerCase();
  if (raw === "cheap" || raw === "shadow" || raw === "jev") return raw;
  return "off";
}

function evaluationUsesZeroDataRetention(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.TUTOR_EVALUATION_ZDR?.trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

function strongNotesModel(env: Record<string, string | undefined>): string {
  return resolveTeachingFireworksModel({ fastMode: true, env });
}

function cheapNotesModel(env: Record<string, string | undefined>): string {
  const override = env.FIREWORKS_NOTES_MODEL?.trim();
  return override || resolveProblemIRFireworksModel({ env });
}

export async function prepareNotesChat(input: {
  env?: Record<string, string | undefined>;
  notes: LessonNotesSnapshot;
  tag: NotesChatTag | null;
  userMessage: string;
  signal?: AbortSignal;
  /** Shadow and jev call the evaluator. Cheap and off never do. */
  network: boolean;
  fetchImpl?: typeof fetch;
  apiKey?: string | null;
}): Promise<NotesChatPreparation> {
  const env = input.env ?? process.env;
  const mode = resolveNotesEvaluationMode(env);
  const selected = mode === "off"
    ? null
    : selectNotesForPrompt(input.notes, input.tag);
  const notesText = selected?.text ?? formatLessonNotesForPrompt(input.notes);
  const context = selected?.context ?? "full";
  const truncated = selected?.truncated ?? false;
  const strong = strongNotesModel(env);

  if (mode === "cheap") {
    return {
      mode,
      model: cheapNotesModel(env),
      notesText,
      context,
      truncated,
      evaluation: null,
    };
  }

  if (!input.network || (mode !== "shadow" && mode !== "jev")) {
    return {
      mode,
      model: strong,
      notesText,
      context,
      truncated,
      evaluation: null,
    };
  }

  const evaluation = await assessTutorState(
    {
      job: "notes_routing",
      state: {
        notice: NOTES_DATA_NOTICE,
        studentMessage: input.userMessage,
        taggedLine: input.tag ? `${input.tag.kind}: ${input.tag.text}` : null,
        lessonNotes: notesText,
      },
    },
    {
      fetchImpl: input.fetchImpl,
      apiKey: input.apiKey,
      signal: input.signal,
      deadlineMs: 300,
      circuit: true,
      zeroDataRetention: evaluationUsesZeroDataRetention(env),
    },
  );

  const useCheap = mode === "jev" && evaluation.status === "assessed" && evaluation.useCheapGenerator;
  return {
    mode,
    model: useCheap ? cheapNotesModel(env) : strong,
    notesText,
    context,
    truncated,
    evaluation,
  };
}
