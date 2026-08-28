import { resolveApiUrl, type AudioTimings } from "@heytutor/tutor-core";
import type { DrawCommand, StoredCommandEnvelope } from "@heytutor/drawing";
import type { BoardEntry } from "@/lib/boards/types";
import { finalizeBoardTitle } from "@/lib/boards/boardTitle";

export interface StoredSegment {
  id: string;
  orderIndex: number;
  narration: string;
  spokenText: string;
  command: DrawCommand | StoredCommandEnvelope | null;
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
  traceId: string | null;
  sceneDocument: unknown | null;
  sceneEngineVersion: string | null;
  validationReport: unknown | null;
  visualStatus: SceneVisualStatus | null;
  sceneArtifacts: unknown | null;
  segments: StoredSegment[];
}

export type SceneVisualStatus = "validated" | "text_only" | "legacy" | "retry_required";

export interface BoardDetail {
  board: BoardEntry;
  turns: StoredTurn[];
}

export async function fetchBoards(): Promise<BoardEntry[]> {
  const res = await fetch(resolveApiUrl("/api/boards"));
  if (!res.ok) {
    return [];
  }

  const data = (await res.json()) as { boards?: BoardEntry[] };
  return data.boards ?? [];
}

export async function createBoard(id?: string): Promise<BoardEntry | null> {
  const res = await fetch(resolveApiUrl("/api/boards"), {
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

export async function createBoardWithTitle(title: string): Promise<BoardEntry | null> {
  const res = await fetch(resolveApiUrl("/api/boards"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as { board?: BoardEntry };
  return data.board ?? null;
}

/** Same naming path the dashboard uses when a student asks the first question. */
export async function requestBoardTitle(question: string): Promise<string> {
  const fallback = finalizeBoardTitle(question);
  try {
    const response = await fetch(resolveApiUrl("/api/board-name"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!response.ok) {
      return fallback;
    }
    const data = (await response.json()) as { title?: unknown };
    return typeof data.title === "string" && data.title.trim() ? data.title.trim() : fallback;
  } catch {
    return fallback;
  }
}

export async function fetchBoardDetail(boardId: string): Promise<BoardDetail | null> {
  const res = await fetch(resolveApiUrl(`/api/boards/${boardId}`));
  if (!res.ok) {
    return null;
  }

  return (await res.json()) as BoardDetail;
}

export async function updateBoard(
  boardId: string,
  patch: { title?: string; preview?: string },
): Promise<BoardEntry | null> {
  const res = await fetch(resolveApiUrl(`/api/boards/${boardId}`), {
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
  const res = await fetch(resolveApiUrl(`/api/boards/${boardId}`), { method: "DELETE" });
  return res.ok;
}

export interface RecordedSegmentPayload {
  orderIndex: number;
  narration: string;
  spokenText: string;
  command: DrawCommand | StoredCommandEnvelope | null;
  audioBytes: Uint8Array | null;
  durationMs: number | null;
  timings: AudioTimings | null;
}

/** Persist the runtime-owned page transition so restore and replay match live ink. */
export function withBoardEpochSegment(
  segments: RecordedSegmentPayload[],
): RecordedSegmentPayload[] {
  const clearCommand: DrawCommand = {
    type: "CLEAR",
    params: [],
    charPosition: 0,
    narrationBefore: "",
  };
  return [
    {
      orderIndex: 0,
      narration: "",
      spokenText: "",
      command: clearCommand,
      audioBytes: null,
      durationMs: 50,
      timings: null,
    },
    ...segments,
  ].map((segment, orderIndex) => ({ ...segment, orderIndex }));
}

export async function saveTurn(
  boardId: string,
  payload: {
    question: string;
    rawResponse: string;
    speedMultiplier: number;
    traceId?: string | null;
    sceneDocument?: unknown | null;
    sceneEngineVersion?: string | null;
    validationReport?: unknown | null;
    visualStatus?: SceneVisualStatus | null;
    sceneArtifacts?: unknown | null;
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
      sceneDocument: payload.sceneDocument ?? undefined,
      sceneEngineVersion: payload.sceneEngineVersion ?? undefined,
      validationReport: payload.validationReport ?? undefined,
      visualStatus: payload.visualStatus ?? undefined,
      sceneArtifacts: payload.sceneArtifacts ?? undefined,
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

  const url = resolveApiUrl(`/api/boards/${boardId}/turns`);
  const MAX_SAVE_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = (await res.json()) as { turn?: StoredTurn };
        return data.turn ?? null;
      }
      const errorText = await res.text().catch(() => "");
      console.error("saveTurn failed", {
        boardId,
        status: res.status,
        attempt,
        error: errorText.slice(0, 300),
      });
      if (res.status < 500 && res.status !== 429) {
        return null;
      }
    } catch (error) {
      console.error("saveTurn network error", {
        boardId,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (attempt < MAX_SAVE_ATTEMPTS) {
      await new Promise((resolve) => {
        setTimeout(resolve, 400 * attempt);
      });
    }
  }
  return null;
}
