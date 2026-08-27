import type { LessonNotesSnapshot } from "../lib/lessonNotes";
import type { NotesChatMessage } from "@/lib/boards/notesChatClient";
import { NotesPanel } from "./NotesPanel";
import { NotesChatThread } from "./NotesChatThread";
import { NotesChatComposer } from "./NotesChatComposer";

interface NotesChatSidebarProps {
  notes: LessonNotesSnapshot;
  messages: NotesChatMessage[];
  sending: boolean;
  error: string | null;
  live: boolean;
  onClose?: () => void;
  onSend: (message: string) => void;
}

export function NotesChatSidebar({
  notes,
  messages,
  sending,
  error,
  live,
  onClose,
  onSend,
}: NotesChatSidebarProps) {
  const hasWork = notes.turns.some((turn) => turn.workLines.length > 0);

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-[#151517]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#2E2E33] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[#F2F2F4]">Notes</h2>
            {live ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(201,201,210,0.12)] px-2 py-0.5 text-[11px] font-medium text-[#C9C9D2]">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#7ee787]" />
                live
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[11px] text-[#A6A6AE]">Chat with the board text</p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notes"
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#2E2E33] bg-[#1E1E21] text-[#A6A6AE] hover:text-[#F2F2F4]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        ) : null}
      </div>

      <div className="min-h-0 shrink-0 overflow-y-auto border-b border-[#2E2E33]" style={{ maxHeight: "42%" }}>
        <NotesPanel notes={notes} />
      </div>

      <NotesChatThread
        messages={messages}
        sending={sending}
        emptyHint="Ask about a line on the board."
      />

      {error ? (
        <p className="shrink-0 px-4 pb-1 text-[12px] text-[#E06858]">{error}</p>
      ) : null}

      <NotesChatComposer
        disabled={sending}
        showSuggestions={hasWork && messages.length === 0}
        onSend={onSend}
      />
    </aside>
  );
}
