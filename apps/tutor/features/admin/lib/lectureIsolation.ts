/**
 * Lecture-lab runtime isolation: parallel recordings must never share a board
 * or TutorSessionShell. Scene-document adoption lives in sceneIsolation.ts.
 */

import {
  canAdoptVerifiedScene,
  sceneCompileIsolationKey,
  fingerprintTurnPlan,
} from "@/features/tutor-session/lib/sceneIsolation";

export { canAdoptVerifiedScene, sceneCompileIsolationKey, fingerprintTurnPlan };

export type HeadlessRuntime = {
  jobId: string;
  boardId: string;
  question: string;
};

/** Identity for one recording shell. Both ids are required; neither may be reused. */
export function lectureRuntimeKey(runtime: Pick<HeadlessRuntime, "jobId" | "boardId">): string {
  return `${runtime.jobId}::${runtime.boardId}`;
}

export function lectureRuntimesAreIsolated(runtimes: readonly HeadlessRuntime[]): boolean {
  const jobIds = new Set<string>();
  const boardIds = new Set<string>();
  for (const runtime of runtimes) {
    if (!runtime.jobId.trim() || !runtime.boardId.trim()) {
      return false;
    }
    if (jobIds.has(runtime.jobId) || boardIds.has(runtime.boardId)) {
      return false;
    }
    jobIds.add(runtime.jobId);
    boardIds.add(runtime.boardId);
  }
  return true;
}

/** Mount or replace this job's shell. Never steal another job's board. */
export function attachLectureRuntime(
  current: readonly HeadlessRuntime[],
  next: HeadlessRuntime,
): HeadlessRuntime[] {
  if (!next.jobId.trim() || !next.boardId.trim()) {
    return [...current];
  }
  if (current.some((entry) => entry.boardId === next.boardId && entry.jobId !== next.jobId)) {
    return [...current];
  }
  return [...current.filter((entry) => entry.jobId !== next.jobId), next];
}

export function detachLectureRuntime(
  current: readonly HeadlessRuntime[],
  match: { jobId?: string; boardId?: string },
): HeadlessRuntime[] {
  return current.filter((entry) => {
    if (match.jobId && entry.jobId === match.jobId) {
      return false;
    }
    if (match.boardId && entry.boardId === match.boardId) {
      return false;
    }
    return true;
  });
}

/** Watch Live may promote only the shell whose boardId matches the watched job. */
export function selectLiveWatchRuntime(
  runtimes: readonly HeadlessRuntime[],
  watchBoardId: string | null | undefined,
): HeadlessRuntime | undefined {
  const boardId = watchBoardId?.trim();
  if (!boardId) {
    return undefined;
  }
  const matches = runtimes.filter((runtime) => runtime.boardId === boardId);
  return matches.length === 1 ? matches[0] : undefined;
}
