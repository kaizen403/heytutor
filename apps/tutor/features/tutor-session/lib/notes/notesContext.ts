import { formatLessonNotesForPrompt, type LessonNotesSnapshot } from "./lessonNotes";
import type { NotesChatTag } from "./notesChatTag";

/** Rough character budget for notes sent to the chat model. */
export const NOTES_CONTEXT_CHAR_BUDGET = 12_000;

export interface NotesContextSelection {
  text: string;
  context: "full" | "bounded";
  truncated: boolean;
  turnIndexes: number[];
}

/**
 * Keeps the whole board when it already fits. Over the budget, keeps the
 * tagged turn and the newest turns, and drops narration before equations
 * and plan facts.
 */
export function selectNotesForPrompt(
  snapshot: LessonNotesSnapshot,
  tag: NotesChatTag | null,
  charBudget = NOTES_CONTEXT_CHAR_BUDGET,
): NotesContextSelection {
  const full = formatLessonNotesForPrompt(snapshot);
  const everyTurn = snapshot.turns.map((_, index) => index);
  if (full.length <= charBudget) {
    return { text: full, context: "full", truncated: false, turnIndexes: everyTurn };
  }

  const taggedIndex =
    tag && tag.turnIndex >= 0 && tag.turnIndex < snapshot.turns.length ? tag.turnIndex : null;
  const narrationIndexes = new Set<number>();
  if (taggedIndex !== null) narrationIndexes.add(taggedIndex);
  else if (snapshot.turns.length > 0) narrationIndexes.add(snapshot.turns.length - 1);

  const preference: number[] = [];
  if (taggedIndex !== null) preference.push(taggedIndex);
  for (let index = snapshot.turns.length - 1; index >= 0; index -= 1) {
    if (index !== taggedIndex) preference.push(index);
  }

  const chosen: number[] = [];
  for (const index of preference) {
    const text = formatProjected(snapshot, [...chosen, index], narrationIndexes);
    const required = taggedIndex !== null && index === taggedIndex;
    if (!required && chosen.length > 0 && text.length > charBudget) break;
    chosen.push(index);
  }

  let text = formatProjected(snapshot, chosen, narrationIndexes);
  if (text.length > charBudget) {
    const factsOnly = formatProjected(snapshot, chosen, new Set());
    const marker = "\n[older notes omitted]";
    text = factsOnly.length + marker.length <= charBudget
      ? factsOnly
      : `${factsOnly.slice(0, Math.max(0, charBudget - marker.length))}${marker}`;
  }

  return {
    text,
    context: text === full ? "full" : "bounded",
    truncated: text !== full,
    turnIndexes: [...chosen].sort((left, right) => left - right),
  };
}

function formatProjected(
  snapshot: LessonNotesSnapshot,
  indexes: number[],
  narrationIndexes: Set<number>,
): string {
  const turns = [...indexes]
    .sort((left, right) => left - right)
    .map((index) => {
      const turn = snapshot.turns[index];
      if (!turn || narrationIndexes.has(index)) return turn;
      return { ...turn, narration: "" };
    })
    .filter((turn): turn is LessonNotesSnapshot["turns"][number] => Boolean(turn));
  return formatLessonNotesForPrompt({
    turns,
    lectureInProgress: snapshot.lectureInProgress,
  });
}
