import type { BoardEntry } from "@/lib/boards/types";
import { isLectureWatchable, lectureJobTitle, type LectureJob } from "./lectureJobs";
import { isProbeDifficulty, type ProbeDifficulty } from "./probes";

const PLAYGROUND_TITLE = /^\[Playground\] (.+) · (easy|medium|hard)$/;
const LECTURE_BOARD_INDEX_KEY = "heytutor:admin:lecture-boards:v1";

export type LectureBoardMeta = {
  topicId: string;
  difficulty: ProbeDifficulty;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLectureBoardIndex(raw: unknown): Map<string, LectureBoardMeta> {
  const index = new Map<string, LectureBoardMeta>();
  if (!isRecord(raw)) {
    return index;
  }
  for (const [boardId, value] of Object.entries(raw)) {
    if (!boardId || !isRecord(value) || typeof value.topicId !== "string") {
      continue;
    }
    if (typeof value.difficulty !== "string" || !isProbeDifficulty(value.difficulty)) {
      continue;
    }
    index.set(boardId, { topicId: value.topicId, difficulty: value.difficulty });
  }
  return index;
}

export function readLectureBoardIndex(): Map<string, LectureBoardMeta> {
  if (typeof window === "undefined") {
    return new Map();
  }
  try {
    const raw = window.localStorage.getItem(LECTURE_BOARD_INDEX_KEY);
    if (!raw) {
      return new Map();
    }
    return parseLectureBoardIndex(JSON.parse(raw) as unknown);
  } catch {
    return new Map();
  }
}

function writeLectureBoardIndex(index: Map<string, LectureBoardMeta>): void {
  if (typeof window === "undefined") {
    return;
  }
  const record: Record<string, LectureBoardMeta> = {};
  for (const [boardId, meta] of index) {
    record[boardId] = meta;
  }
  try {
    window.localStorage.setItem(LECTURE_BOARD_INDEX_KEY, JSON.stringify(record));
  } catch {
    // New recordings keep their identity on the server, even with storage disabled.
  }
}

export function rememberLectureBoard(boardId: string, meta: LectureBoardMeta): void {
  const index = readLectureBoardIndex();
  index.set(boardId, meta);
  writeLectureBoardIndex(index);
}

export function forgetLectureBoard(boardId: string): void {
  const index = readLectureBoardIndex();
  if (!index.delete(boardId)) {
    return;
  }
  writeLectureBoardIndex(index);
}

/**
 * Index playground lecture boards. Watch uses the newest board per
 * topic+difficulty (by `createdAt`). Only server-checked complete recordings qualify.
 *
 * Human-titled lecture boards (dashboard-style names) are keyed via
 * `remembered`. Legacy `[Playground] topicId · difficulty` titles still parse.
 */
export function indexPlaygroundRecordings(
  boards: BoardEntry[],
  remembered: ReadonlyMap<string, LectureBoardMeta> = readLectureBoardIndex(),
): Map<string, BoardEntry> {
  const index = new Map<string, BoardEntry>();
  const newestFirst = [...boards].sort((left, right) => right.createdAt - left.createdAt);
  for (const board of newestFirst) {
    const parsed = parsePlaygroundBoardTitle(board.title);
    const meta = board.playground ?? parsed ?? remembered.get(board.id) ?? null;
    if (!meta || board.playground?.state !== "complete") {
      continue;
    }
    const key = recordingKey(meta.topicId, meta.difficulty);
    if (!index.has(key)) {
      index.set(key, board);
    }
  }
  return index;
}

type RecordingJob = Pick<LectureJob, "status" | "boardId" | "topicId" | "difficulty" | "question"> & {
  title?: string;
};

/**
 * Merge current jobs with server-checked recordings. A callback or question
 * preview alone never creates a completed recording.
 */
export function mergePlaygroundRecordings(
  boards: BoardEntry[],
  jobs: RecordingJob[],
  recordingBoardIds: ReadonlySet<string>,
  remembered: ReadonlyMap<string, LectureBoardMeta> = readLectureBoardIndex(),
): Map<string, BoardEntry> {
  const unavailable = new Set(jobs.filter(job => job.status === "running").map(job => job.boardId));
  const index = indexPlaygroundRecordings(boards.filter(board => !recordingBoardIds.has(board.id) && !unavailable.has(board.id)), remembered);
  const byId = new Map(boards.map(board => [board.id, board]));

  for (const job of jobs) {
    if (!job.boardId) {
      continue;
    }
    const board = byId.get(job.boardId);
    if (board?.playground?.state !== "complete") continue;
    const preview = board.preview;
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
      ...board,
      title: lectureJobTitle(job),
      preview: preview?.trim() || job.question,
    };
    if (!index.has(key) || board.createdAt >= index.get(key)!.createdAt) {
      index.set(key, entry);
    }
  }

  return index;
}

export function recordingBoardIdsForQuestions(
  questions: readonly { topicId: string; difficulty: ProbeDifficulty }[],
  recordings: ReadonlyMap<string, { id: string }>,
  skip: ReadonlySet<string> = new Set(),
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const question of questions) {
    const board = recordings.get(recordingKey(question.topicId, question.difficulty));
    if (!board || skip.has(board.id) || seen.has(board.id)) {
      continue;
    }
    seen.add(board.id);
    ids.push(board.id);
  }
  return ids;
}
