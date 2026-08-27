import type { LessonNotesSnapshot } from "../lib/lessonNotes";

interface NotesPanelProps {
  notes: LessonNotesSnapshot;
}

export function NotesPanel({ notes }: NotesPanelProps) {
  const turns = notes.turns;
  if (turns.length === 0) {
    return (
      <p className="px-4 py-3 text-sm leading-relaxed text-[#A6A6AE]">
        {notes.lectureInProgress
          ? "the lecture is starting. notes will appear as they are written."
          : "notes from the board will show up here."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-3">
      {turns.map((turn, index) => (
        <section key={`${turn.question}-${index}`} className="flex flex-col gap-2">
          {turn.question ? (
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#A6A6AE]">
              {turns.length > 1 ? `Question ${index + 1}` : "Question"}
            </p>
          ) : null}
          {turn.question ? (
            <p className="text-sm leading-relaxed text-[#F2F2F4]">{turn.question}</p>
          ) : null}
          {turn.workLines.length > 0 ? (
            <ol className="flex flex-col gap-1.5 border-l border-[#2E2E33] pl-3">
              {turn.workLines.map((line, lineIndex) => (
                <li
                  key={`${line}-${lineIndex}`}
                  className="font-mono text-[13px] leading-snug text-[#DEDEE4]"
                >
                  {line}
                </li>
              ))}
            </ol>
          ) : null}
          {turn.narration ? (
            <p className="text-[12px] leading-relaxed text-[#A6A6AE]">{turn.narration}</p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
