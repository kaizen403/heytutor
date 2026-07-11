"use client";

import { useCallback, useState } from "react";
import { SITE_NAME } from "@/lib/site";

export interface CanvasLandingSuggestion {
  label: string;
  question: string;
  hint: string;
}

export interface CanvasLandingProps {
  suggestions: CanvasLandingSuggestion[];
  onSubmit: (question: string) => void;
}

function splitHint(hint: string): { subject: string; detail: string } {
  const [subject = "", detail = ""] = hint.split("·").map((part) => part.trim());
  return { subject, detail };
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
      <div className="ac-landing__atmosphere" aria-hidden />

      <header className="ac-landing__hero">
        <p className="ac-landing__eyebrow">Whiteboard session</p>
        <h1 className="ac-landing__brand">
          <span className="ac-landing__brand-word">{SITE_NAME}</span>
          <span className="ac-landing__brand-mark" aria-hidden />
        </h1>
        <p className="ac-landing__lede">
          Ask a question. Watch diagrams, notes, and explanations
          appear stroke by stroke.
        </p>
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
            placeholder="e.g. explain projectile motion with a diagram"
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

      <div className="ac-landing__topics">
        <div className="ac-landing__topics-head">
          <span className="ac-landing__topics-label">Start with a topic</span>
        </div>
        <ul className="ac-landing__topic-list">
          {suggestions.map((suggestion, index) => {
            const { subject, detail } = splitHint(suggestion.hint);
            return (
              <li
                key={suggestion.question}
                style={{ animationDelay: `${120 + index * 45}ms` }}
              >
                <button
                  type="button"
                  className="ac-landing__topic"
                  onClick={() => onSubmit(suggestion.question)}
                >
                  <span className="ac-landing__topic-meta">
                    <span className="ac-landing__topic-subject">
                      {detail ? `${subject} · ${detail}` : subject}
                    </span>
                  </span>
                  <span className="ac-landing__topic-title">{suggestion.label}</span>
                  <span className="ac-landing__topic-go" aria-hidden>
                    →
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

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
  --paper: #FBFCFE;
  --accent: #2563EB;
  --accent-deep: #1D4ED8;
  --cta: #1A1F2C;

  position: relative;
  z-index: 1;
  width: min(100%, 42rem);
  margin: 0 auto;
  padding: clamp(0.75rem, 2.5vh, 1.5rem) clamp(0.85rem, 3vw, 1.5rem);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  text-align: left;
  isolation: isolate;
}

.ac-landing__atmosphere {
  pointer-events: none;
  position: absolute;
  inset: -6% -2% auto;
  height: 48%;
  z-index: -1;
  background:
    radial-gradient(ellipse 65% 50% at 20% 18%, rgba(37, 99, 235, 0.05), transparent 72%),
    radial-gradient(ellipse 50% 40% at 90% 10%, rgba(95, 164, 249, 0.06), transparent 70%);
}

.ac-landing__hero {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.55rem;
  animation: ac-landing-rise 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.ac-landing__eyebrow {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 400;
  letter-spacing: normal;
  color: var(--ink-soft);
}

.ac-landing__brand {
  margin: 0;
  display: inline-flex;
  align-items: flex-end;
  gap: 0.12em;
  font-size: clamp(2.4rem, 7vw, 3.75rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 0.95;
  color: var(--accent);
}

.ac-landing__brand-word {
  color: var(--accent);
}

.ac-landing__brand-mark {
  width: 0.13em;
  height: 0.13em;
  margin-bottom: 0.18em;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 5px rgba(37, 99, 235, 0.12);
  animation: wb-pulse-amber 2.6s cubic-bezier(0.16, 1, 0.3, 1) infinite;
}

.ac-landing__lede {
  margin: 0.15rem 0 0;
  max-width: 28rem;
  font-size: clamp(0.95rem, 1.4vw + 0.65rem, 1.08rem);
  line-height: 1.5;
  color: var(--ink-soft);
  letter-spacing: normal;
}

.ac-landing__ask {
  margin-top: clamp(1.25rem, 3.5vh, 2rem);
  animation: ac-landing-rise 0.75s cubic-bezier(0.16, 1, 0.3, 1) 0.08s both;
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
  gap: 0.55rem;
  padding: 0.4rem 0.4rem 0.4rem 1.05rem;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 9999px;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.9) inset,
    0 14px 36px -18px rgba(37, 99, 235, 0.28);
  transition: border-color 0.25s ease, box-shadow 0.25s ease;
}

.ac-landing__ask-row:focus-within {
  border-color: rgba(37, 99, 235, 0.42);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.9) inset,
    0 16px 40px -16px rgba(37, 99, 235, 0.34);
}

.ac-landing__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  padding: 0.8rem 0.2rem;
  font-size: 16px;
  color: var(--ink);
  letter-spacing: normal;
}

.ac-landing__input::placeholder {
  color: color-mix(in srgb, var(--ink-faint) 88%, white);
  font-style: normal;
}

.ac-landing__submit {
  flex-shrink: 0;
  min-height: 44px;
  min-width: 4.5rem;
  padding: 0.7rem 1.25rem;
  border: 0;
  border-radius: 9999px;
  background: var(--cta);
  color: #F8FAFC;
  font-size: 0.95rem;
  font-weight: 500;
  letter-spacing: normal;
  cursor: pointer;
  transition:
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    background 0.2s ease,
    box-shadow 0.2s ease;
  box-shadow: 0 8px 18px -10px rgba(26, 31, 44, 0.55);
}

.ac-landing__submit:hover:not(:disabled) {
  background: #0F1420;
  transform: translateY(-1px);
}

.ac-landing__submit:active:not(:disabled) {
  transform: translateY(0);
}

.ac-landing__submit:disabled {
  background: rgba(26, 31, 44, 0.08);
  color: rgba(21, 32, 51, 0.35);
  cursor: not-allowed;
  box-shadow: none;
}

.ac-landing__topics {
  margin-top: clamp(1.35rem, 3.8vh, 2.25rem);
  animation: ac-landing-rise 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.14s both;
}

.ac-landing__topics-head {
  margin-bottom: 0.55rem;
}

.ac-landing__topics-label {
  font-size: 0.9rem;
  font-weight: 400;
  letter-spacing: normal;
  color: var(--ink-soft);
}

.ac-landing__topic-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.35rem;
}

.ac-landing__topic {
  width: 100%;
  min-height: 48px;
  display: grid;
  grid-template-columns: minmax(5.5rem, 7.5rem) minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem 1rem;
  padding: 0.7rem 0.85rem;
  border: 0;
  border-radius: 12px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.2s ease,
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  animation: ac-landing-rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.ac-landing__topic:hover,
.ac-landing__topic:focus-visible {
  background: rgba(37, 99, 235, 0.06);
  outline: none;
}

.ac-landing__topic:hover .ac-landing__topic-go,
.ac-landing__topic:focus-visible .ac-landing__topic-go {
  opacity: 1;
  transform: translateX(0);
}

.ac-landing__topic:active {
  transform: scale(0.995);
}

.ac-landing__topic-meta {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.ac-landing__topic-subject {
  font-size: 0.85rem;
  font-weight: 400;
  letter-spacing: normal;
  color: var(--ink-soft);
}

.ac-landing__topic-title {
  font-size: 0.98rem;
  font-weight: 500;
  letter-spacing: normal;
  color: var(--ink);
  line-height: 1.3;
}

.ac-landing__topic-go {
  font-size: 1rem;
  color: var(--accent);
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes ac-landing-rise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (min-width: 640px) {
  .ac-landing__topic-list {
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem 0.55rem;
  }

  .ac-landing__topic {
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    align-items: start;
    gap: 0.2rem 0.5rem;
    padding: 0.85rem 0.95rem;
    border: 1px solid transparent;
  }

  .ac-landing__topic:hover,
  .ac-landing__topic:focus-visible {
    border-color: rgba(37, 99, 235, 0.16);
    background: rgba(255, 255, 255, 0.72);
  }

  .ac-landing__topic-meta {
    grid-column: 1;
    grid-row: 1;
  }

  .ac-landing__topic-title {
    grid-column: 1;
    grid-row: 2;
  }

  .ac-landing__topic-go {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: center;
  }
}

@media (max-width: 420px) {
  .ac-landing__topic {
    grid-template-columns: 1fr auto;
    gap: 0.2rem 0.5rem;
  }

  .ac-landing__topic-meta {
    grid-column: 1;
  }

  .ac-landing__topic-title {
    grid-column: 1;
  }

  .ac-landing__topic-go {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: center;
    opacity: 0.45;
    transform: none;
  }
}

@media (max-height: 700px) {
  .ac-landing__lede {
    max-width: 24rem;
  }

  .ac-landing__topic {
    min-height: 44px;
    padding-block: 0.55rem;
  }
}

@media (max-height: 560px) {
  .ac-landing__eyebrow,
  .ac-landing__lede {
    display: none;
  }

  .ac-landing__brand {
    font-size: clamp(2rem, 7vw, 2.75rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ac-landing__brand-mark,
  .ac-landing__hero,
  .ac-landing__ask,
  .ac-landing__topics,
  .ac-landing__topic {
    animation: none !important;
  }

  .ac-landing__topic-go {
    transition: none;
  }
}
`;
