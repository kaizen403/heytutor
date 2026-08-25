import type { BoardEntry } from "@/lib/boards/types";
import { isLectureWatchable, type LectureJob } from "./lectureJobs";
import { isProbeDifficulty, type ProbeDifficulty } from "./probes";

const PLAYGROUND_TITLE = /^\[Playground\] (.+) · (easy|medium|hard)$/;

export type PlaygroundRecording = {
  topicId: string;
  difficulty: ProbeDifficulty;
  board: BoardEntry;
};

export function playgroundBoardTitle(topicId: string, difficulty: ProbeDifficulty): string {
  return `[Playground] ${topicId} · ${difficulty}`;
}

export function parsePlaygroundBoardTitle(
  title: string,
): { topicId: string; difficulty: ProbeDifficulty } | null {
  const match = PLAYGROUND_TITLE.exec(title);
  if (!match?.[1] || !match[2] || !isProbeDifficulty(match[2])) {
    return null;
  }
  return { topicId: match[1], difficulty: match[2] };
}

export function recordingKey(topicId: string, difficulty: ProbeDifficulty): string {
  return `${topicId}::${difficulty}`;
}

/**
 * Index playground lecture boards. Watch uses the newest board per
 * topic+difficulty (by `createdAt`). Boards with an empty preview have not
 * persisted a turn yet.
 */
export function indexPlaygroundRecordings(boards: BoardEntry[]): Map<string, BoardEntry> {
  const index = new Map<string, BoardEntry>();
  const newestFirst = [...boards].sort((left, right) => right.createdAt - left.createdAt);
  for (const board of newestFirst) {
    const parsed = parsePlaygroundBoardTitle(board.title);
    if (!parsed || !board.preview.trim()) {
      continue;
    }
    const key = recordingKey(parsed.topicId, parsed.difficulty);
    if (!index.has(key)) {
      index.set(key, board);
    }
  }
  return index;
}

type RecordingJob = Pick<LectureJob, "status" | "boardId" | "topicId" | "difficulty" | "question">;

/**
 * Topic-row Watch chips use persisted previews. Completed jobs in this session
 * also surface Watch immediately via `job.boardId`, even if preview is still empty.
 */
export function mergePlaygroundRecordings(
  boards: BoardEntry[],
  jobs: RecordingJob[],
  recordingBoardIds: ReadonlySet<string>,
): Map<string, BoardEntry> {
  const index = indexPlaygroundRecordings(boards);
  const previewById = new Map(boards.map((board) => [board.id, board.preview]));

  for (const job of jobs) {
    if (!job.boardId) {
      continue;
    }
    const preview = previewById.get(job.boardId);
    if (
      !isLectureWatchable(job, {
        isRecording: recordingBoardIds.has(job.boardId),
        boardPreview: preview,
      })
    ) {
      continue;
    }

    const key = recordingKey(job.topicId, job.difficulty);
    const entry: BoardEntry = {
      id: job.boardId,
      title: playgroundBoardTitle(job.topicId, job.difficulty),
      createdAt: Date.now(),
      preview: preview?.trim() || job.question,
    };
    if (job.status === "complete" || !index.has(key)) {
      index.set(key, entry);
    }
  }

  return index;
}
