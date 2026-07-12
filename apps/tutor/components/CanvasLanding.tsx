"use client";

import { useCallback, useState } from "react";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export interface CanvasLandingSuggestion {
  question: string;
  topic: string;
}

export interface CanvasLandingProps {
  suggestions: CanvasLandingSuggestion[];
  onSubmit: (question: string) => void;
}

export function CanvasLanding({
  suggestions,
  onSubmit,
}: CanvasLandingProps) {
  const [draft, setDraft] = useState("");
  const canAsk = draft.trim().length > 0;

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = draft.trim();
      if (trimmed.length === 0) return;
      onSubmit(trimmed);
    },
    [draft, onSubmit],
  );

  return (
    <section className="ac-landing animate-wb-fade-in">
      <header className="ac-landing__hero">
        <h1 className="ac-landing__brand">
          <span>{SITE_NAME}</span>
          <span className="ac-landing__brand-mark" aria-hidden />
        </h1>
        <p className="ac-landing__tagline">{SITE_TAGLINE}</p>
      </header>

      <form className="ac-landing__ask" onSubmit={handleSubmit}>
        <label className="ac-landing__ask-label" htmlFor="ac-landing-question">
          Your question
        </label>
        <div className="ac-landing__ask-row">
          <input
            id="ac-landing-question"
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask your own question"
            className="ac-landing__input"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          <button
            type="submit"
            className="ac-landing__submit"
            disabled={!canAsk}
          >
            Ask
          </button>
        </div>
      </form>

      {suggestions.length > 0 && (
        <div className="ac-landing__suggestions">
          <p className="ac-landing__suggestions-label">Or pick one to start</p>
          <ul className="ac-landing__question-list">
            {suggestions.map((suggestion) => (
              <li key={suggestion.question}>
                <button
                  type="button"
                  className="ac-landing__question"
                  onClick={() => onSubmit(suggestion.question)}
                >
                  <span className="ac-landing__question-text">{suggestion.question}</span>
                  <span className="ac-landing__question-topic">{suggestion.topic}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <style>{STYLES}</style>
    </section>
  );
}

const STYLES = `
.ac-landing {
  --ink: #152033;
  --ink-soft: #4A5A72;
  --ink-faint: #7B8BA3;
  --line: rgba(37, 99, 235, 0.14);
  --paper: #fff;
  --accent: #2563EB;
  --cta: #1A1F2C;

  width: 100%;
  max-width: 40rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.ac-landing__hero {
  text-align: center;
}

.ac-landing__brand {
  margin: 0;
  display: inline-flex;
  align-items: flex-end;
  justify-content: center;
  gap: 0.1em;
  font-size: clamp(2rem, 5vw, 2.75rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1;
  color: var(--accent);
}

.ac-landing__brand-mark {
  width: 0.12em;
  height: 0.12em;
  margin-bottom: 0.16em;
  border-radius: 50%;
  background: var(--accent);
}

.ac-landing__tagline {
  margin: 0.55rem 0 0;
  font-size: 0.95rem;
  line-height: 1.45;
  color: var(--ink-soft);
}

.ac-landing__ask-label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.ac-landing__ask-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.35rem 0.35rem 1rem;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 9999px;
  box-shadow: 0 10px 28px -16px rgba(37, 99, 235, 0.25);
}

.ac-landing__ask-row:focus-within {
  border-color: rgba(37, 99, 235, 0.35);
}

.ac-landing__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  padding: 0.75rem 0.15rem;
  font-size: 16px;
  color: var(--ink);
}

.ac-landing__input::placeholder {
  color: var(--ink-faint);
}

.ac-landing__submit {
  flex-shrink: 0;
  min-height: 42px;
  padding: 0.65rem 1.15rem;
  border: 0;
  border-radius: 9999px;
  background: var(--cta);
  color: #f8fafc;
  font-size: 0.92rem;
  font-weight: 500;
  cursor: pointer;
}

.ac-landing__submit:disabled {
  background: rgba(26, 31, 44, 0.08);
  color: rgba(21, 32, 51, 0.35);
  cursor: not-allowed;
}

.ac-landing__suggestions-label {
  margin: 0 0 0.5rem;
  font-size: 0.875rem;
  color: var(--ink-soft);
  text-align: center;
}

.ac-landing__question-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.ac-landing__question {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--line);
  border-radius: 0.65rem;
  background: rgba(255, 255, 255, 0.85);
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.ac-landing__question:hover,
.ac-landing__question:focus-visible {
  background: #fff;
  border-color: rgba(37, 99, 235, 0.28);
  outline: none;
}

.ac-landing__question-text {
  font-size: 0.92rem;
  font-weight: 500;
  line-height: 1.4;
  color: var(--ink);
}

.ac-landing__question-topic {
  font-size: 0.8rem;
  color: var(--ink-faint);
}
`;
