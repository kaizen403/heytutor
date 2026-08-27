import { useState, type FormEvent, type KeyboardEvent } from "react";

const SUGGESTIONS = [
  "Why this formula?",
  "Explain the last line",
  "What does this symbol mean?",
] as const;

interface NotesChatComposerProps {
  disabled?: boolean;
  showSuggestions?: boolean;
  onSend: (message: string) => void;
}

export function NotesChatComposer({
  disabled = false,
  showSuggestions = false,
  onSend,
}: NotesChatComposerProps) {
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  const canSend = !disabled && trimmed.length > 0;

  const submit = (message: string) => {
    const next = message.trim();
    if (!next || disabled) return;
    onSend(next);
    setValue("");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit(value);
    }
  };

  return (
    <div className="shrink-0 border-t border-[#2E2E33] px-3 py-3">
      {showSuggestions ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={disabled}
              onClick={() => submit(suggestion)}
              className="rounded-full border border-[#2E2E33] bg-[#1E1E21] px-2.5 py-1 text-[11px] text-[#C9C9D2] transition-colors hover:border-[rgba(201,201,210,0.35)] hover:text-[#F2F2F4] disabled:opacity-40"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder="Ask about a line on the board"
          className="h-10 min-w-0 flex-1 rounded-full border border-[#2E2E33] bg-[#1E1E21] px-3.5 text-sm text-[#F2F2F4] outline-none placeholder:text-[#6E6E76] focus:border-[rgba(201,201,210,0.45)] disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#6E6E76] text-white transition-colors hover:bg-[#7A7A82] disabled:opacity-40"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12 14-7-7 14-2-5-5-2z" />
          </svg>
        </button>
      </form>
    </div>
  );
}
