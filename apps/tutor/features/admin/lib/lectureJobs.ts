import type { TutorPhase } from "@/features/tutor-session/types";
import type { ProbeQuestion } from "./probes";

export const EXPECTED_LECTURE_MS = 4 * 60 * 1000;
export const JOB_TIMEOUT_MS = 10 * 60 * 1000;
/** Browser + TTS + LLM budget for one tab. Select many; this many actually run together. */
export const MAX_CONCURRENT_LECTURES = 3;
export const CONCURRENCY_OPTIONS = [1, 2, 3] as const;

export type LectureJobStatus = "queued" | "running" | "complete" | "failed";

export type LectureJob = {
  id: string;
  probeId: string;
  topicId: string;
  difficulty: ProbeQuestion["difficulty"];
  question: string;
  status: LectureJobStatus;
  boardId?: string;
  phase?: TutorPhase;
  startedAt?: number;
  endedAt?: number;
  error?: string;
};

export function makeLectureJobs(questions: ProbeQuestion[], now: number): LectureJob[] {
  return questions.map((probe, index) => ({
    id: `${probe.id}:${now}:${index}`,
    probeId: probe.id,
    topicId: probe.topicId,
    difficulty: probe.difficulty,
    question: probe.question,
    status: "queued",
  }));
}

export function nextQueuedJobs(jobs: LectureJob[], limit: number): LectureJob[] {
  const running = jobs.filter((job) => job.status === "running").length;
  const slots = Math.max(0, limit - running);
  if (slots === 0) {
    return [];
  }
  return jobs.filter((job) => job.status === "queued").slice(0, slots);
}

export function drainLectureJobs(jobs: LectureJob[], now: number): LectureJob[] {
  return jobs
    .filter((job) => job.status !== "queued")
    .map((job) =>
      job.status === "running"
        ? { ...job, status: "failed" as const, error: "stopped", endedAt: now }
        : job,
    );
}

export function jobProgressPercent(
  job: Pick<LectureJob, "status" | "startedAt">,
  now: number,
  expectedMs = EXPECTED_LECTURE_MS,
): number {
  if (job.status === "complete") {
    return 100;
  }
  if (job.status === "queued" || job.startedAt === undefined) {
    return 0;
  }
  const elapsed = Math.max(0, now - job.startedAt);
  return Math.min(95, Math.round((elapsed / expectedMs) * 100));
}

export function countJobsByStatus(jobs: LectureJob[]): Record<LectureJobStatus, number> {
  const counts: Record<LectureJobStatus, number> = {
    queued: 0,
    running: 0,
    complete: 0,
    failed: 0,
  };
  for (const job of jobs) {
    counts[job.status] += 1;
  }
  return counts;
}

/**
 * Finished lectures are watchable from the jobs list via `boardId`.
 * Complete jobs stay watchable even if the board preview has not caught up.
 * Failed jobs are watchable only when a turn actually persisted.
 */
export function isLectureWatchable(
  job: Pick<LectureJob, "status" | "boardId">,
  options: { isRecording?: boolean; boardPreview?: string } = {},
): boolean {
  if (!job.boardId) {
    return false;
  }
  if (options.isRecording) {
    return false;
  }
  if (job.status === "complete") {
    return true;
  }
  if (job.status === "failed") {
    return Boolean(options.boardPreview?.trim());
  }
  return false;
}

/** Finished leftover boards can be deleted; never a currently recording headless shell. */
export function isLectureDeletable(
  job: Pick<LectureJob, "status" | "boardId">,
  options: { isRecording?: boolean } = {},
): boolean {
  if (!job.boardId) {
    return false;
  }
  if (options.isRecording) {
    return false;
  }
  return job.status === "complete" || job.status === "failed";
}

export const DELETE_LECTURE_CONFIRM =
  "Delete this lecture recording? The whiteboard, transcript, and saved audio will be removed. This cannot be undone.";
