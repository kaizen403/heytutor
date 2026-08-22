"use client";

import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import { InputBar } from "@/features/tutor-session/components/InputBar";

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
  return (
    <section className="ac-landing animate-wb-fade-in">
      <header className="ac-landing__hero">
        <h1 className="ac-landing__brand">
          <span>{SITE_NAME}</span>
          <span className="ac-landing__brand-mark" aria-hidden />
        </h1>
        <p className="ac-landing__tagline">{SITE_TAGLINE}</p>
      </header>

      <div className="ac-landing__ask">
        <InputBar
          onSubmit={onSubmit}
          autoFocus
          placeholder="Ask a question or paste a photo"
        />
      </div>

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
  --ink: #F2F2F4;
  --ink-soft: #A6A6AE;
  --ink-faint: #717177;
  --line: rgba(240, 246, 252, 0.1);
  --paper: #151517;
  --accent: #C9C9D2;
  --cta: #6E6E76;

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
  letter-spacing: -0.01em;
  color: var(--ink-soft);
}

.ac-landing__suggestions-label {
  margin: 0 0 0.5rem;
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
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
  background: #151517;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.ac-landing__question:hover,
.ac-landing__question:focus-visible {
  background: #1E1E21;
  border-color: rgba(201, 201, 210, 0.35);
  outline: none;
}

.ac-landing__question-text {
  font-size: 0.92rem;
  font-weight: 500;
  line-height: 1.4;
  letter-spacing: -0.01em;
  color: var(--ink);
}

.ac-landing__question-topic {
  font-size: 0.75rem;
  line-height: 1.4;
  letter-spacing: -0.005em;
  color: var(--ink-faint);
}
`;
