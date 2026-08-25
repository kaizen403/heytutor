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
          prominent
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

/**
 * Decorative flanking doodles. Rendered by the shell as a sibling of the
 * landing column: the section's fade-in animation applies a transform, which
 * would make it the containing block for these absolutely positioned doodles
 * and pin them to the column instead of the panel edges.
 */
export function CanvasLandingDoodles() {
  return (
    <>
      <div className="ac-landing__doodle ac-landing__doodle--books" aria-hidden>
        <BooksDoodle />
      </div>
      <div className="ac-landing__doodle ac-landing__doodle--formulas" aria-hidden>
        <span className="ac-landing__formula ac-landing__formula--1">E = mc²</span>
        <span className="ac-landing__formula ac-landing__formula--2">∫(x²) dx</span>
        <span className="ac-landing__formula ac-landing__formula--3">a² + b² = c²</span>
      </div>
    </>
  );
}

function BooksDoodle() {
  return (
    <svg viewBox="0 0 140 140" fill="none" aria-hidden>
      <g stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 107c1-2.5 3.5-4 6-4h92c3 0 5.5 1.5 6.5 4l-1.5 9c-1 2.5-3.5 4-6 4H22c-3 0-5.5-1.5-6.5-4z" />
        <path d="M22 103.5h88" strokeWidth="1.25" />
        <path d="M27 111v-5.5M35 111.5v-5.5M43 112v-5.5" strokeWidth="1.25" />
      </g>
      <g stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M32 94c1-2.5 3.5-4 6-4h78c3 0 5.5 1.5 6.5 4l-1.5 9c-1 2.5-3.5 4-6 4H38c-3 0-5.5-1.5-6.5-4z" />
        <path d="M38 90.5h74" strokeWidth="1.25" />
        <path d="M43 98v-5.5M51 98.5v-5.5" strokeWidth="1.25" />
      </g>
      <g stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M48 81c1-2.5 3.5-4 6-4h56c3 0 5.5 1.5 6.5 4l-1.5 8c-1 2.5-3.5 4-6 4H54c-3 0-5.5-1.5-6.5-4z" />
        <path d="M54 77.5h50" strokeWidth="1.25" />
        <path d="M96 77.5v10l-3-2-3 2v-10" strokeWidth="1.25" />
      </g>
      <path
        d="M12 118c6 1.5 14 1.5 20 0M118 72c4-1 8-1 11 0"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
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
  gap: 0.02em;
  font-size: clamp(2.75rem, 7vw, 4.25rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1;
  color: var(--ink);
}

.ac-landing__brand-mark {
  width: 0.09em;
  height: 0.09em;
  margin-bottom: 0.13em;
  border-radius: 50%;
  background: var(--ink);
}

.ac-landing__tagline {
  margin: 0.75rem 0 0;
  font-size: 0.9375rem;
  line-height: 1.5;
  letter-spacing: -0.01em;
  color: var(--ink-soft);
}

.ac-landing__suggestions-label {
  margin: 0 0 0.75rem;
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ink-faint);
  text-align: center;
}

.ac-landing__question-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.ac-landing__question {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.625rem;
  padding: 1.125rem 1.5rem;
  border: 1px solid var(--line);
  border-radius: 1.125rem;
  background: var(--paper);
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
  font-size: 0.9375rem;
  font-weight: 500;
  line-height: 1.45;
  letter-spacing: -0.01em;
  color: var(--ink);
}

.ac-landing__question-topic {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.625rem;
  border: 1px solid rgba(242, 242, 244, 0.16);
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 500;
  line-height: 1.4;
  letter-spacing: 0.02em;
  color: var(--ink-faint);
}

.ac-landing__doodle {
  position: absolute;
  top: 56%;
  transform: translateY(-50%);
  pointer-events: none;
  user-select: none;
  display: none;
  color: var(--ink);
}

@media (min-width: 1024px) {
  .ac-landing__doodle--books {
    display: block;
    left: 1.5rem;
    width: clamp(4.5rem, 8vw, 8rem);
    opacity: 0.55;
  }

  .ac-landing__doodle--formulas {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1.5rem;
    right: 1.5rem;
    opacity: 0.5;
  }
}

.ac-landing__formula {
  font-family: var(--font-caveat), "Apple Chancery", "Segoe Script", cursive;
  font-size: clamp(1.375rem, 2.4vw, 1.875rem);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  color: var(--ink);
}

.ac-landing__formula--1 {
  transform: rotate(-3deg);
}

.ac-landing__formula--2 {
  transform: rotate(2deg);
}

.ac-landing__formula--3 {
  transform: rotate(-1.5deg);
}
`;
