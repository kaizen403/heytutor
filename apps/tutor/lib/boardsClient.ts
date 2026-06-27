import type { AudioTimings } from "@heytutor/tutor-core";
import type { DrawCommand } from "@heytutor/drawing";
import type { BoardEntry } from "@/components/BoardHistory";

export interface StoredSegment {
  id: string;
  orderIndex: number;
  narration: string;
  spokenText: string;
  command: DrawCommand | { commands: DrawCommand[] } | null;
  audioUrl: string | null;
  durationMs: number | null;
  timings: AudioTimings | null;
}

export interface StoredTurn {
  id: string;
  orderIndex: number;
  question: string;
  rawResponse: string;
  speedMultiplier: number;
  segments: StoredSegment[];
}

export interface BoardDetail {
  board: BoardEntry;
  turns: StoredTurn[];
}

export async function fetchBoards(): Promise<BoardEntry[]> {
  const res = await fetch("/api/boards");
  if (!res.ok) {
    return [];
  }

  const data = (await res.json()) as { boards?: BoardEntry[] };
  return data.boards ?? [];
}

export async function createBoard(id?: string): Promise<BoardEntry | null> {
  const res = await fetch("/api/boards", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(id ? { id } : {}),
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as { board?: BoardEntry };
  return data.board ?? null;
}

export async function fetchBoardDetail(boardId: string): Promise<BoardDetail | null> {
  const res = await fetch(`/api/boards/${boardId}`);
  if (!res.ok) {
    return null;
  }

  return (await res.json()) as BoardDetail;
}

export async function updateBoard(
  boardId: string,
  patch: { title?: string; preview?: string },
): Promise<BoardEntry | null> {
  const res = await fetch(`/api/boards/${boardId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as { board?: BoardEntry };
  return data.board ?? null;
}

export async function deleteBoardApi(boardId: string): Promise<boolean> {
  const res = await fetch(`/api/boards/${boardId}`, { method: "DELETE" });
  return res.ok;
}

export interface RecordedSegmentPayload {
  orderIndex: number;
  narration: string;
  spokenText: string;
  command: DrawCommand | { commands: DrawCommand[] } | null;
  audioBytes: Uint8Array | null;
  durationMs: number | null;
  timings: AudioTimings | null;
}

export async function saveTurn(
  boardId: string,
  payload: {
    question: string;
    rawResponse: string;
    speedMultiplier: number;
    traceId?: string | null;
    segments: RecordedSegmentPayload[];
  },
): Promise<StoredTurn | null> {
  const formData = new FormData();
  formData.append(
    "metadata",
    JSON.stringify({
      question: payload.question,
      rawResponse: payload.rawResponse,
      speedMultiplier: payload.speedMultiplier,
      traceId: payload.traceId ?? undefined,
      segments: payload.segments.map((segment) => ({
        orderIndex: segment.orderIndex,
        narration: segment.narration,
        spokenText: segment.spokenText,
        command: segment.command,
        durationMs: segment.durationMs ?? undefined,
        timings: segment.timings ?? undefined,
      })),
    }),
  );

  for (const segment of payload.segments) {
    if (segment.audioBytes && segment.audioBytes.length > 0) {
      formData.append(
        `audio-${segment.orderIndex}`,
        new Blob([new Uint8Array(segment.audioBytes)], { type: "audio/mpeg" }),
      );
    }
  }

  const res = await fetch(`/api/boards/${boardId}/turns`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as { turn?: StoredTurn };
  return data.turn ?? null;
}
