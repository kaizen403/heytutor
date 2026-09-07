import {
  codeFormatGateIssues,
  validateCodeLessonPlan,
  type CodeLessonPlan,
} from "@heytutor/tutor-core";

/**
 * A persisted turn carries its CodeLessonPlan inside the sceneArtifacts JSON
 * (`sceneArtifacts.codeLesson`). Both sides of the trust boundary re-validate
 * it: the server before persisting, the client before committing a restored
 * plan to the code panel. Code that fails schema or format-gate checks is
 * never re-rendered.
 */
export type StoredCodeLessonParse =
  | { status: "absent" }
  | { status: "invalid"; reason: string }
  | { status: "valid"; plan: CodeLessonPlan };

export function parseStoredCodeLesson(
  sceneArtifacts: unknown,
  question?: string,
): StoredCodeLessonParse {
  if (
    typeof sceneArtifacts !== "object" ||
    sceneArtifacts === null ||
    Array.isArray(sceneArtifacts)
  ) {
    return { status: "absent" };
  }
  const raw = (sceneArtifacts as Record<string, unknown>).codeLesson;
  if (raw == null) return { status: "absent" };

  const { plan, issues } = validateCodeLessonPlan(raw);
  if (!plan) {
    return {
      status: "invalid",
      reason: issues[0]?.message ?? "plan failed schema validation",
    };
  }
  if (question !== undefined && normalize(plan.question) !== normalize(question)) {
    return { status: "invalid", reason: "plan question does not match the turn question" };
  }
  const gateIssues = codeFormatGateIssues(plan);
  if (gateIssues.length > 0) {
    return {
      status: "invalid",
      reason: gateIssues[0]?.message ?? "plan failed the code format gate",
    };
  }
  return { status: "valid", plan };
}

/** Lenient read for replay/restore surfaces: a plan or nothing. */
export function storedCodeLessonPlan(sceneArtifacts: unknown): CodeLessonPlan | null {
  const parsed = parseStoredCodeLesson(sceneArtifacts);
  return parsed.status === "valid" ? parsed.plan : null;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}
