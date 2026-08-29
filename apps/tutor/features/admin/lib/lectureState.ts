import type { BoardEntry } from "@/lib/boards/types";
import type { LectureJob } from "./lectureJobs";
import { recordingKey } from "./playgroundBoards";
import type { ProbeDifficulty } from "./probes";

/**
 * What a single topic+difficulty cell shows.
 * `missing` = no probe fixture authored, `idle` = fixture exists but nothing recorded.
 */
export type DifficultyState = "missing" | "idle" | "queued" | "running" | "recorded";

export interface DifficultyCellState {
  state: DifficultyState;
  /** Board the cell's primary action targets: the live board while running, else the recording. */
  boardId?: string;
}

type StateJob = Pick<LectureJob, "status" | "boardId" | "topicId" | "difficulty">;

/**
 * Collapses recordings and in-flight jobs into one state per topic+difficulty.
 *
 * A live recording outranks an older recording of the same cell, because that
 * is the thing the reviewer most likely wants to open right now.
 */
export function buildLectureStates(
  jobs: readonly StateJob[],
  recordings: ReadonlyMap<string, BoardEntry>,
  recordingBoardIds: ReadonlySet<string>,
): Map<string, DifficultyCellState> {
  const states = new Map<string, DifficultyCellState>();

  for (const [key, board] of recordings) {
    states.set(key, { state: "recorded", boardId: board.id });
  }

  for (const job of jobs) {
    const key = recordingKey(job.topicId, job.difficulty);
    if (job.status === "queued") {
      if (!states.has(key)) {
        states.set(key, { state: "queued" });
      }
      continue;
    }
    if (job.status !== "running" || !job.boardId) {
      continue;
    }
    if (!recordingBoardIds.has(job.boardId)) {
      // The headless shell has not attached yet, so there is nothing to watch.
      if (!states.has(key)) {
        states.set(key, { state: "queued" });
      }
      continue;
    }
    states.set(key, { state: "running", boardId: job.boardId });
  }

  return states;
}

export function cellStateFor(
  states: ReadonlyMap<string, DifficultyCellState>,
  topicId: string,
  difficulty: ProbeDifficulty,
  hasFixture: boolean,
): DifficultyCellState {
  const found = states.get(recordingKey(topicId, difficulty));
  if (found) {
    return found;
  }
  return { state: hasFixture ? "idle" : "missing" };
}
