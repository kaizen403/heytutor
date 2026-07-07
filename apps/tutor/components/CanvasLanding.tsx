"use client";

import { useCallback, useState } from "react";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export interface CanvasLandingSuggestion {
  label: string;
  question: string;
  hint: string;
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
    <section className="ac-canvas-landing animate-wb-fade-in">
      <div className="ac-canvas-landing__mark">
        <span className="ac-canvas-landing__word">{SITE_NAME}</span>
        <span className="ac-canvas-landing__dot" aria-hidden />
      </div>

      <p className="ac-canvas-landing__tagline">{SITE_TAGLINE}</p>

      <form className="ac-canvas-landing__form wb-input-wrap" onSubmit={handleSubmit}>
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="ask a math or physics question…"
          className="ac-canvas-landing__input wb-paper-input"
          autoComplete="off"
          spellCheck={false}
          aria-label="Ask a question"
          autoFocus
        />
        <button
          type="submit"
          className="ac-canvas-landing__ask"
          disabled={draft.trim().length === 0}
        >
          Ask
        </button>
      </form>

      <div className="ac-canvas-landing__suggestions">
        <p className="ac-canvas-landing__suggestions-label">try one of these</p>
        <ul className="ac-canvas-landing__chips">
          {suggestions.map((s) => (
            <li key={s.question}>
              <button
                type="button"
                className="ac-canvas-landing__chip"
                onClick={() => onSubmit(s.question)}
              >
                <span className="ac-canvas-landing__chip-label">{s.label}</span>
                <span className="ac-canvas-landing__chip-hint">{s.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <style>{STYLES}</style>
    </section>
  );
}

const STYLES = `
.ac-canvas-landing {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 40rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 1rem 1.25rem;
}

.ac-canvas-landing__mark {
  display: inline-flex;
  align-items: flex-end;
  gap: 0.18em;
  font-family: inherit;
  font-weight: 700;
  font-size: clamp(2.75rem, 7vw, 4.75rem);
  letter-spacing: -0.045em;
  line-height: 1;
  color: #2f4a42;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.4);
}

.ac-canvas-landing__word {
  background: linear-gradient(170deg, #4f7468 0%, #659287 55%, #88bda4 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.ac-canvas-landing__dot {
  width: 0.14em;
  height: 0.14em;
  margin-bottom: 0.18em;
  border-radius: 50%;
  background: #88BDA4;
  box-shadow: 0 0 0 4px rgba(136, 189, 164, 0.18);
  animation: wb-pulse-amber 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite;
}

.ac-canvas-landing__tagline {
  margin: 0.85rem 0 0;
  font-size: clamp(0.9rem, 2vw, 1.05rem);
  font-weight: 400;
  letter-spacing: 0.02em;
  color: #5A6B62;
}

.ac-canvas-landing__form {
  margin-top: 1.75rem;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.4rem 0.4rem 1.1rem;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(101, 146, 135, 0.22);
  border-radius: 9999px;
  box-shadow: 0 10px 40px -12px rgba(79, 116, 104, 0.28);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.ac-canvas-landing__input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  padding: 0.75rem 0.25rem;
  font-size: 0.98rem;
  color: #333333;
}

.ac-canvas-landing__input::placeholder {
  color: rgba(51, 51, 51, 0.42);
  font-style: italic;
}

.ac-canvas-landing__ask {
  flex-shrink: 0;
  padding: 0.65rem 1.4rem;
  border: none;
  border-radius: 9999px;
  background: #659287;
  color: #FFFFFF;
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              background 0.2s ease;
  box-shadow: 0 4px 14px -4px rgba(101, 146, 135, 0.55);
}

.ac-canvas-landing__ask:hover:not(:disabled) {
  background: #4F7468;
  transform: translateY(-1px);
  box-shadow: 0 8px 22px -6px rgba(79, 116, 104, 0.6);
}

.ac-canvas-landing__ask:active:not(:disabled) {
  transform: translateY(0);
}

.ac-canvas-landing__ask:disabled {
  background: rgba(101, 146, 135, 0.12);
  color: rgba(51, 51, 51, 0.4);
  cursor: not-allowed;
  box-shadow: none;
}

.ac-canvas-landing__suggestions {
  margin-top: 2rem;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.ac-canvas-landing__suggestions-label {
  margin: 0 0 0.85rem;
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgba(90, 107, 98, 0.7);
}

.ac-canvas-landing__chips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
  width: 100%;
  max-width: 34rem;
}

.ac-canvas-landing__chip {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  padding: 0.8rem 1rem;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(101, 146, 135, 0.18);
  border-radius: 14px;
  text-align: left;
  cursor: pointer;
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1),
              border-color 0.25s ease,
              box-shadow 0.25s ease,
              background 0.25s ease;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.ac-canvas-landing__chip:hover {
  transform: translateY(-2px);
  border-color: rgba(101, 146, 135, 0.5);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 12px 30px -14px rgba(79, 116, 104, 0.45);
}

.ac-canvas-landing__chip:active {
  transform: translateY(0);
}

.ac-canvas-landing__chip-label {
  font-size: 0.95rem;
  font-weight: 600;
  color: #2f4a42;
  letter-spacing: -0.005em;
}

.ac-canvas-landing__chip-hint {
  font-size: 0.72rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: rgba(90, 107, 98, 0.85);
}

@media (max-width: 640px) {
  .ac-canvas-landing__chips {
    grid-template-columns: 1fr;
    max-width: 22rem;
  }
  .ac-canvas-landing__form {
    padding-left: 0.9rem;
  }
  .ac-canvas-landing__ask {
    padding: 0.6rem 1.1rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ac-canvas-landing__dot {
    animation: none !important;
  }
}
`;
