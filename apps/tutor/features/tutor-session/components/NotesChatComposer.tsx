"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { ArrowUp, Lightbulb, Loader2, Mic, Square, X } from "lucide-react";
import { MathText } from "@/features/tutor-session/components/MathText";
import { useVoiceInput } from "@/features/tutor-session/hooks/useVoiceInput";
import { VoiceLevelBars } from "@/features/tutor-session/components/VoiceLevelBars";
import type { NotesChatTag } from "../lib/notes/notesChatTag";

const MAX_FIELD_HEIGHT = 136;

interface NotesChatComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  sending: boolean;
  starters: string[];
  tag?: NotesChatTag | null;
  onClearTag?: () => void;
  onSend: (message: string) => void;
  onStop?: () => void;
}

export function NotesChatComposer({
  value,
  onValueChange,
  sending,
  starters,
  tag = null,
  onClearTag,
  onSend,
  onStop,
}: NotesChatComposerProps) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [showStarters, setShowStarters] = useState(false);
  const [focused, setFocused] = useState(false);

  const canSend = !sending && (value.trim().length > 0 || tag !== null);

  // Spoken words land after whatever is already drafted, so a half-typed
  // question can be finished out loud.
  const voice = useVoiceInput({
    onTranscript: (text) => {
      const base = value.trim();
      onValueChange(base ? `${base} ${text}` : text);
      fieldRef.current?.focus();
    },
    disabled: sending,
  });
  const listening = voice.state === "listening";
  const transcribing = voice.state === "transcribing";

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
              <MathText handwritten={false}>{prompt}</MathText>
            </button>
          ))}
        </div>
      ) : null}

      {tag ? (
        <div className="ncs__tag" aria-label="Tagged board line">
          <span className="ncs__tag-kind">{tag.kind === "work" ? "line" : tag.kind}</span>
          <span className="ncs__tag-text">
            <MathText>{tag.text}</MathText>
          </span>
          {onClearTag ? (
            <button
              type="button"
              className="ncs__tag-x"
              aria-label="Remove tagged line"
              onClick={onClearTag}
            >
              <X size={11} strokeWidth={2} />
            </button>
          ) : null}
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

          {voice.supported ? (
            <button
              type="button"
              aria-label={listening ? "Stop recording and transcribe" : "Ask by voice"}
              aria-pressed={listening}
              title={
                listening
                  ? "Press again when you have finished speaking"
                  : "Ask by voice"
              }
              onClick={voice.toggle}
              disabled={sending || transcribing}
              // No fill and no ring while listening: the student's own voice
              // moving is a better "I am recording you" than a lit box.
              className={listening ? "ncs__action ncs__action--live" : "ncs__action"}
            >
              {listening ? (
                <VoiceLevelBars
                  analyserRef={voice.analyserRef}
                  bars={5}
                  barWidth={2}
                  height={13}
                />
              ) : transcribing ? (
                <Loader2 size={15} strokeWidth={1.8} className="animate-spin" />
              ) : (
                <Mic size={15} strokeWidth={1.8} />
              )}
            </button>
          ) : null}

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

      {voice.error ? (
        <p className="ncs__hint ncs__hint--warn" role="status">
          {voice.error}
        </p>
      ) : listening ? (
        <p className="ncs__hint" role="status">
          Listening… press the mic again when you are done
        </p>
      ) : transcribing ? (
        <p className="ncs__hint" role="status">
          Writing down what you said…
        </p>
      ) : focused || value ? (
        <p className="ncs__hint">Enter to send · Shift + Enter for a new line</p>
      ) : null}
    </div>
  );
}
