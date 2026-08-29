"use client";

import { useCallback, useMemo, useState } from "react";
import { X } from "lucide-react";

import type { LessonNotesSnapshot } from "../lib/lessonNotes";
import type { NotesChatMessage } from "@/lib/boards/notesChatClient";
import { NotesChatThread } from "./NotesChatThread";
import { NotesChatComposer } from "./NotesChatComposer";

interface NotesChatSidebarProps {
  notes: LessonNotesSnapshot;
  messages: NotesChatMessage[];
  sending: boolean;
  error: string | null;
  onClose?: () => void;
  onSend: (message: string) => void;
  onStop?: () => void;
}

/**
 * Prompt starters a student actually reaches for, ordered by how often they
 * apply. Board-dependent asks come first so the row stays useful mid-lecture.
 */
function buildPromptStarters(notes: LessonNotesSnapshot): string[] {
  const last = notes.turns[notes.turns.length - 1];
  const starters: string[] = [];

  if (last && last.workLines.length > 0) {
    starters.push("Explain the last line");
    starters.push("Why this formula?");
  }
  starters.push("Break this into simpler steps");
  starters.push("Where do students slip up here?");
  if (last?.question) {
    starters.push("Give me a similar practice problem");
  }
  starters.push("Summarise this in three points");

  return starters.slice(0, 6);
}

export function NotesChatSidebar({
  notes,
  messages,
  sending,
  error,
  onClose,
  onSend,
  onStop,
}: NotesChatSidebarProps) {
  const [draft, setDraft] = useState("");

  const starters = useMemo(() => buildPromptStarters(notes), [notes]);

  const submit = useCallback(
    (message: string) => {
      const text = message.trim();
      if (!text) return;
      onSend(text);
      setDraft("");
    },
    [onSend],
  );

  return (
    <aside className="ncs">
      <header className="ncs__header">
        <div className="ncs__heading">
          <div className="ncs__title-row">
            <h2 className="ncs__title">Ask me anything</h2>
          </div>
          <p className="ncs__subtitle">About this lesson, or anything near it.</p>
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="Close chat" className="ncs__close">
            <X size={15} strokeWidth={1.8} />
          </button>
        ) : null}
      </header>

      <div className="ncs__body">
        <NotesChatThread
          messages={messages}
          sending={sending}
          starters={starters}
          onStarter={submit}
        />
      </div>

      {error ? (
        <p className="ncs__error" role="status">
          {error}
        </p>
      ) : null}

      <NotesChatComposer
        value={draft}
        onValueChange={setDraft}
        sending={sending}
        starters={starters}
        onSend={submit}
        onStop={onStop}
      />

      <style>{STYLES}</style>
    </aside>
  );
}

const STYLES = `
.ncs {
  --ink: #F2F2F4;
  --ink-dim: #DEDEE4;
  --ink-soft: #A6A6AE;
  --ink-faint: #7A7A82;
  --accent: #C9C9D2;
  --accent-soft: rgba(201, 201, 210, 0.12);
  --line: rgba(242, 242, 244, 0.08);
  --line-strong: #2E2E33;
  --paper: #151517;
  --raised: #1E1E21;
  --danger: #E06858;

  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  width: 100%;
  /* Glass: a translucent pane over the board rather than an opaque slab. */
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.055) 0%, rgba(255, 255, 255, 0.018) 100%),
    rgba(11, 11, 12, 0.72);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.06);
  color: var(--ink);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* Panels inside the glass float on it, so they stay translucent too. */
.ncs__bubble--assistant,
.ncs__chip,
.ncs__composer-wrap {
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

/* ── Header ─────────────────────────────────────────────── */

.ncs__header {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1.125rem 1rem 0.875rem;
}

.ncs__heading {
  min-width: 0;
}

.ncs__title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.ncs__title {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.2;
  color: var(--ink);
}

.ncs__subtitle {
  margin: 0.2rem 0 0;
  max-width: 15rem;
  font-size: 0.8125rem;
  letter-spacing: -0.005em;
  line-height: 1.4;
  color: var(--ink-faint);
}

.ncs__close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: 0;
  border-radius: 0.55rem;
  background: transparent;
  color: var(--ink-faint);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.ncs__close:hover {
  background: var(--raised);
  color: var(--ink);
}

/* ── Body ───────────────────────────────────────────────── */

.ncs__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--line);
}

.ncs__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.ncs__scroll::-webkit-scrollbar {
  width: 8px;
}

.ncs__scroll::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: content-box;
  background-color: rgba(242, 242, 244, 0.1);
}

.ncs__scroll::-webkit-scrollbar-thumb:hover {
  background-color: rgba(242, 242, 244, 0.18);
}

.ncs__error {
  flex-shrink: 0;
  margin: 0;
  padding: 0.5rem 1rem 0;
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--danger);
}

/* ── Empty state ────────────────────────────────────────── */

.ncs__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 100%;
  padding: 2rem 1.25rem;
  text-align: center;
}

.ncs__empty-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: -0.005em;
  color: var(--ink);
}

.ncs__empty-body {
  margin: 0;
  max-width: 17rem;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--ink-faint);
}

.ncs__empty-chips {
  justify-content: center;
  margin-top: 0.85rem;
}

/* ── Icon buttons ───────────────────────────────────────── */

.ncs__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border: 0;
  border-radius: 0.4rem;
  background: transparent;
  color: var(--ink-faint);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.ncs__icon-btn:hover {
  background: var(--raised);
  color: var(--ink);
}

/* ── Chat thread ────────────────────────────────────────── */

.ncs__thread-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ncs__thread {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem 1rem 1.25rem;
}

.ncs__msg {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.ncs__msg--user {
  align-items: flex-end;
}

.ncs__bubble {
  max-width: 92%;
  font-size: 0.8125rem;
  line-height: 1.65;
  letter-spacing: -0.005em;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.ncs__bubble--user {
  border: 1px solid var(--line);
  border-radius: 0.9rem 0.9rem 0.3rem 0.9rem;
  background: var(--raised);
  padding: 0.5rem 0.7rem;
  color: var(--ink);
}

.ncs__bubble--assistant {
  max-width: 100%;
  color: var(--ink-dim);
}

.ncs__msg-label {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.ncs__msg-foot {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.ncs__msg:hover .ncs__msg-foot,
.ncs__msg-foot:focus-within {
  opacity: 1;
}

.ncs__caret {
  display: inline-block;
  width: 2px;
  height: 0.85em;
  margin-left: 0.1rem;
  background: var(--accent);
  vertical-align: text-bottom;
  animation: ncs-blink 1s steps(2, start) infinite;
}

@keyframes ncs-blink {
  50% { opacity: 0; }
}

/* The tutor is working: the same pencil the board twirls, at text size. */
.ncs__pending {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--ink-faint);
  font-size: 0.75rem;
  letter-spacing: -0.005em;
}

.ncs__jump {
  position: absolute;
  bottom: 0.75rem;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--raised);
  padding: 0.3rem 0.65rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--ink);
  cursor: pointer;
  box-shadow: 0 6px 18px -6px rgba(0, 0, 0, 0.6);
}

.ncs__jump:hover {
  border-color: rgba(201, 201, 210, 0.35);
}

/* ── Prompt chips ───────────────────────────────────────── */

.ncs__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.ncs__chip {
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--paper);
  padding: 0.3rem 0.65rem;
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: -0.005em;
  color: var(--ink-soft);
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.ncs__chip:hover:not(:disabled) {
  border-color: rgba(201, 201, 210, 0.35);
  background: var(--raised);
  color: var(--ink);
}

.ncs__chip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ── Composer ───────────────────────────────────────────── */

.ncs__composer {
  flex-shrink: 0;
  border-top: 1px solid var(--line);
  padding: 0.75rem;
}

.ncs__composer-chips {
  margin-bottom: 0.6rem;
}

.ncs__field {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  border: 1px solid var(--line-strong);
  border-radius: 1rem;
  background: var(--paper);
  padding: 0.4rem 0.4rem 0.4rem 0.75rem;
  transition: border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.ncs__field:focus-within {
  border-color: rgba(201, 201, 210, 0.35);
}

.ncs__input {
  flex: 1;
  min-width: 0;
  max-height: 8.5rem;
  border: 0;
  background: transparent;
  padding: 0.4rem 0;
  font: inherit;
  font-size: 0.8125rem;
  line-height: 1.5;
  letter-spacing: -0.005em;
  color: var(--ink);
  resize: none;
  outline: none;
}

.ncs__input::placeholder {
  color: var(--ink-faint);
}

.ncs__input:disabled {
  opacity: 0.6;
}

.ncs__action {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.9rem;
  height: 1.9rem;
  border: 0;
  border-radius: 0.7rem;
  background: transparent;
  color: var(--ink-faint);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.ncs__action:hover:not(:disabled) {
  background: var(--raised);
  color: var(--ink);
}

.ncs__action--primary {
  background: var(--accent);
  color: #0B0B0C;
}

.ncs__action--primary:hover:not(:disabled) {
  background: #DEDEE4;
  color: #0B0B0C;
}

.ncs__action:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.ncs__action--on {
  background: var(--accent-soft);
  color: var(--accent);
}

.ncs__hint {
  margin: 0.45rem 0 0;
  font-size: 0.6875rem;
  letter-spacing: -0.005em;
  color: var(--ink-faint);
}

/* Touch has no hover, so the copy affordance needs a resting state. */
@media (hover: none) {
  .ncs__msg-foot {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ncs__caret {
    animation: none !important;
  }
}
`;
