import type { LessonNotesSnapshot } from "./lessonNotes";

export type NotesChatTagKind = "work" | "question" | "narration";

/**
 * A board line the student pointed at before asking. Stored on the user
 * message so a reload still knows which line the question was about.
 */
export interface NotesChatTag {
  kind: NotesChatTagKind;
  text: string;
  turnIndex: number;
}

const MAX_TAG_TEXT = 400;
const KINDS = new Set<NotesChatTagKind>(["work", "question", "narration"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseNotesChatTag(raw: unknown): NotesChatTag | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.kind !== "string" || !KINDS.has(raw.kind as NotesChatTagKind)) {
    return null;
  }
  if (typeof raw.text !== "string") return null;
  const text = raw.text.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_TAG_TEXT) return null;
  const turnIndex =
    typeof raw.turnIndex === "number" && Number.isInteger(raw.turnIndex) && raw.turnIndex >= 0
      ? raw.turnIndex
      : 0;
  return { kind: raw.kind as NotesChatTagKind, text, turnIndex };
}

/** Work lines and questions a student can tag. Narration stays out — it is prose, not a line. */
export function collectSelectableNotes(notes: LessonNotesSnapshot): NotesChatTag[] {
  const tags: NotesChatTag[] = [];
  const seen = new Set<string>();
  notes.turns.forEach((turn, turnIndex) => {
    const question = turn.question.trim();
    if (question) {
      const key = `question:${turnIndex}:${question}`;
      if (!seen.has(key)) {
        seen.add(key);
        tags.push({ kind: "question", text: question, turnIndex });
      }
    }
    for (const line of turn.workLines) {
      const text = line.trim();
      if (!text) continue;
      const key = `work:${turnIndex}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push({ kind: "work", text, turnIndex });
    }
  });
  return tags;
}

export function formatNotesChatTagPrompt(tag: NotesChatTag): string {
  const label = tag.kind === "work" ? "board work line" : tag.kind === "question" ? "question" : "spoken line";
  return `the student tagged this ${label} from the board:\n${tag.text}\nanswer about that line.`;
}

/** History / LLM user content: keep the typed question, and name the tagged line. */
export function formatTaggedUserMessage(message: string, tag: NotesChatTag | null): string {
  const body = message.trim();
  if (!tag) return body;
  const prefix = formatNotesChatTagPrompt(tag);
  return body ? `${prefix}\n\n${body}` : prefix;
}

export function defaultTaggedQuestion(tag: NotesChatTag): string {
  return tag.kind === "question" ? "explain this question" : "explain this line";
}
