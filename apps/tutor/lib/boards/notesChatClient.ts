import { resolveApiUrl } from "@heytutor/tutor-core";
import type { LessonPlanFact, LessonTurnNotes } from "@/features/tutor-session/lib/lessonNotes";

export interface NotesChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface NotesChatLivePayload {
  question: string;
  workLines: string[];
  narration: string;
  planFacts: LessonPlanFact[];
}

export function liveNotesPayload(turn: LessonTurnNotes | null | undefined): NotesChatLivePayload | null {
  if (!turn) return null;
  if (!turn.question && turn.workLines.length === 0 && !turn.narration) return null;
  return {
    question: turn.question,
    workLines: turn.workLines,
    narration: turn.narration,
    planFacts: turn.planFacts,
  };
}

export async function fetchNotesChatMessages(boardId: string): Promise<NotesChatMessage[]> {
  const res = await fetch(resolveApiUrl(`/api/boards/${boardId}/notes-chat`));
  if (!res.ok) return [];
  const data = (await res.json()) as { messages?: NotesChatMessage[] };
  return (data.messages ?? []).filter(
    (message) => message.role === "user" || message.role === "assistant",
  );
}

export async function streamNotesChatMessage(input: {
  boardId: string;
  message: string;
  liveNotes: NotesChatLivePayload | null;
  lectureInProgress: boolean;
  signal?: AbortSignal;
  onDelta: (chunk: string) => void;
}): Promise<string> {
  const res = await fetch(resolveApiUrl(`/api/boards/${input.boardId}/notes-chat`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: input.signal,
    body: JSON.stringify({
      message: input.message,
      liveNotes: input.liveNotes,
      lectureInProgress: input.lectureInProgress,
    }),
  });

  if (!res.ok || !res.body) {
    const errorBody = await res.text().catch(() => "");
    throw new Error(errorBody || `notes chat failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let accumulated = "";

  const consumeLine = (line: string): boolean => {
    if (!line.startsWith("data: ")) return false;
    const jsonString = line.slice(6).trim();
    if (!jsonString) return false;
    try {
      const parsed: unknown = JSON.parse(jsonString);
      if (typeof parsed !== "object" || parsed === null) return false;
      const payload = parsed as { delta?: unknown; done?: unknown };
      if (payload.done === true) return true;
      if (typeof payload.delta === "string" && payload.delta) {
        accumulated += payload.delta;
        input.onDelta(payload.delta);
      }
    } catch {
      /* ignore malformed SSE */
    }
    return false;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (consumeLine(line)) {
        await reader.cancel().catch(() => undefined);
        return accumulated;
      }
    }
  }

  buffered += decoder.decode();
  for (const line of buffered.split(/\r?\n/)) {
    consumeLine(line);
  }
  return accumulated;
}
