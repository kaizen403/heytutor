import {
  codeFormatGateIssues,
  validateCodeLessonPlan,
  type CodeLessonPlan,
} from "@heytutor/tutor-core";
import { parseStoredSegmentCommands, type DrawCommand } from "@heytutor/drawing";
import { storedTurnStatus, type StoredSegment, type StoredTurn } from "@/lib/boards/boardsClient";

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

/** Legacy unfinished untimed TYPE rows cannot prove the full queued source. */
export function storedCodeLessonSegmentCommands(
  turn: Pick<StoredTurn, "status" | "persistedStatus" | "updatedAt">,
  segment: Pick<StoredSegment, "command" | "durationMs">,
): DrawCommand[] {
  const completed = storedTurnStatus({ status: turn.persistedStatus ?? turn.status, updatedAt: turn.updatedAt }) === "complete" ||
    (segment.durationMs != null && segment.durationMs > 0);
  return parseStoredSegmentCommands(segment.command).map((command) => {
    if (command.type !== "TYPE") return command;
    if (command.shownChars === undefined) return completed ? command : { ...command, shownChars: 0 };
    return { ...command, shownChars: Number.isSafeInteger(command.shownChars) ? Math.max(0, command.shownChars) : 0 };
  });
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}
