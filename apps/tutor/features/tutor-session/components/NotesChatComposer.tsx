"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { ArrowUp, Lightbulb, Square } from "lucide-react";

const MAX_FIELD_HEIGHT = 136;

interface NotesChatComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  sending: boolean;
  starters: string[];
  onSend: (message: string) => void;
  onStop?: () => void;
}

export function NotesChatComposer({
  value,
  onValueChange,
  sending,
  starters,
  onSend,
  onStop,
}: NotesChatComposerProps) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [showStarters, setShowStarters] = useState(false);
  const [focused, setFocused] = useState(false);

  const canSend = !sending && value.trim().length > 0;

  // Grow with the draft instead of scrolling a one-line input, so a long
  // question stays readable while it is being written.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, MAX_FIELD_HEIGHT)}px`;
  }, [value]);

  const submit = () => {
    if (!canSend) return;
    onSend(value);
    setShowStarters(false);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="ncs__composer">
      {showStarters && starters.length > 0 ? (
        <div className="ncs__chips ncs__composer-chips">
          {starters.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="ncs__chip"
              disabled={sending}
              onClick={() => {
                onSend(prompt);
                setShowStarters(false);
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      <form onSubmit={handleSubmit}>
        <div className="ncs__field">
          <textarea
            ref={fieldRef}
            rows={1}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Ask me anything about this lesson"
            aria-label="Ask me anything about this lesson"
            className="ncs__input"
          />

          <button
            type="button"
            aria-label="Prompt ideas"
            aria-pressed={showStarters}
            title="Prompt ideas"
            onClick={() => setShowStarters((current) => !current)}
            className={showStarters ? "ncs__action ncs__action--on" : "ncs__action"}
          >
            <Lightbulb size={15} strokeWidth={1.8} />
          </button>

          {sending && onStop ? (
            <button
              type="button"
              aria-label="Stop answering"
              title="Stop answering"
              onClick={onStop}
              className="ncs__action ncs__action--primary"
            >
              <Square size={11} strokeWidth={2} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send"
              className="ncs__action ncs__action--primary"
            >
              <ArrowUp size={15} strokeWidth={2.2} />
            </button>
          )}
        </div>
      </form>

      {focused || value ? (
        <p className="ncs__hint">Enter to send · Shift + Enter for a new line</p>
      ) : null}
    </div>
  );
}
