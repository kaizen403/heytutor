export const NOTES_CHAT_SYSTEM_PROMPT = `you are clicky, answering a student's sidebar question about the lesson notes on the board. the lecture may still be speaking and writing. you answer in text only.

rules:
- use the supplied board notes, spoken narration, and plan facts as the source of truth.
- treat listed quantities, signs, and units as facts. do not invent a conflicting number.
- if the lecture is still in progress, say so briefly when the notes are incomplete, then answer from what is already written.
- never emit board protocol tags, drawing commands, or focus gestures.
- never claim that you drew, marked, circled, erased, or wrote on the board.
- never mention a planner, compiler, runtime, schema, or internal note.
- write short lowercase conversational paragraphs. unicode math is fine. no markdown headings, bullets, or emojis.
- keep the answer tight: a few sentences, or one short derivation in words plus the key equation as unicode.
- if the board is empty, answer the question simply and invite them to start a lecture.`;

const PROTOCOL_TAG =
  /\[(?:\/?STEP|WRITE:[^\]]*|LABEL:[^\]]*|FOCUS:[^\]]*|EMPHASIZE:[^\]]*|SUPERSEDE:[^\]]*|ANNOTATE:[^\]]*|PAUSE:[^\]]*|DRAW_[A-Z_]+:[^\]]*|UNDERLINE[^\]]*|CIRCLE_AROUND[^\]]*|ARROW[^\]]*|HIGHLIGHT[^\]]*|SCRIBBLE[^\]]*|DIMENSION[^\]]*|ERASE[^\]]*|CLEAR[^\]]*)\]/gi;

export function stripNotesChatProtocol(text: string): string {
  return text
    .replace(PROTOCOL_TAG, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
}

/** Hide a trailing incomplete protocol tag while a reply is still streaming. */
export function visibleNotesChatText(raw: string): string {
  const stripped = stripNotesChatProtocol(raw);
  const open = stripped.lastIndexOf("[");
  if (open >= 0 && stripped.indexOf("]", open) === -1) {
    return stripped.slice(0, open).trimEnd();
  }
  return stripped;
}

export function getMockNotesChatResponse(question: string): string {
  const trimmed = question.trim();
  if (!trimmed) {
    return "ask me about a line on the board and i will explain it in text.";
  }
  return `here is a short answer from the notes so far. you asked: ${trimmed}. the lecture keeps going on the board; this sidebar only explains in text.`;
}
