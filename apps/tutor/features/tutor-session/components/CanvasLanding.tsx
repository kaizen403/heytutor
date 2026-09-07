"use client";

import { Brand } from "@/components/brand/Brand";
import { LANDING_PROMPT } from "@/lib/site";
import type { SubjectFamiliarity } from "@heytutor/tutor-core";
import { InputBar } from "@/features/tutor-session/components/InputBar";
import { LandingDoodles } from "@/features/tutor-session/components/LandingDoodles";

export interface CanvasLandingSuggestion {
  question: string;
  topic: string;
}

export interface CanvasLandingProps {
  suggestions: CanvasLandingSuggestion[];
  onSubmit: (question: string) => void;
  onOpenSettings?: () => void;
  /** How well the student knows this topic; chosen per question in the bar. */
  familiarity?: SubjectFamiliarity;
  onFamiliarityChange?: (level: SubjectFamiliarity) => void;
}

export function CanvasLanding({
  suggestions,
  onSubmit,
  onOpenSettings,
  familiarity,
  onFamiliarityChange,
}: CanvasLandingProps) {
  return (
    <section className="ac-landing animate-wb-fade-in">
      <header className="ac-landing__hero">
        <h1 className="ac-landing__brand">
          <Brand size="lg" />
        </h1>
        <p className="ac-landing__prompt">{LANDING_PROMPT}</p>
      </header>

      <div className="ac-landing__ask">
        <InputBar
          onSubmit={onSubmit}
          autoFocus
          prominent
          placeholder="Ask a question or paste a photo"
          onOpenSettings={onOpenSettings}
          familiarity={familiarity}
          onFamiliarityChange={onFamiliarityChange}
        />
      </div>

      {suggestions.length > 0 && (
        <div className="ac-landing__suggestions">
          <p className="ac-landing__suggestions-label">or try one of these</p>
          <ul className="ac-landing__question-list">
            {suggestions.map((suggestion) => (
              <li key={suggestion.question} className="ac-landing__question-item">
                <button
                  type="button"
                  className="ac-landing__question"
                  onClick={() => onSubmit(suggestion.question)}
                >
                  <span className="ac-landing__question-topic">{suggestion.topic}</span>
                  <span className="ac-landing__question-text">{suggestion.question}</span>
                  <span className="ac-landing__question-go" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h13" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  </span>
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
      <LandingDoodles />
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
  /* Night Blueprint, by way of the global tokens in app/globals.css. */
  --ink: var(--frost);
  --ink-soft: var(--text-soft);
  --ink-faint: var(--text-faint);
  --line: var(--stroke);
  --paper: var(--ink-850);
  --accent: var(--sky-500);
  --cta: var(--sky-600);

  width: 100%;
  max-width: 40rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

/*
  The composer reaches past the column when it is being used, so a long
  question has somewhere to go. Negative inline margins rather than a width
  change: the element stays in normal flow, so nothing below it reflows and
  only this row moves.

  Off below the md breakpoint, where the column is already the full width of
  the screen and there is no margin to grow into.
*/
.ac-landing__ask {
  margin-top: 0.15rem;
  margin-inline: 0;
  transition: margin-inline 320ms cubic-bezier(0.16, 1, 0.3, 1);
}

@media (min-width: 768px) {
  .ac-landing__ask:hover,
  .ac-landing__ask:focus-within {
    margin-inline: -3rem;
  }

  /* A stacked paste grows the box downward. Keep the column width. */
  .ac-landing__ask:has(.wb-input-wrap--multiline):hover,
  .ac-landing__ask:has(.wb-input-wrap--multiline):focus-within {
    margin-inline: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ac-landing__ask {
    transition: none;
  }
}

.ac-landing__hero {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.ac-landing__brand {
  margin: 0 0 0.45rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ac-landing__prompt {
  margin: 0.4rem 0 0;
  font-family: "Stack Sans Notch", ui-sans-serif, system-ui, sans-serif;
  font-size: clamp(1.5rem, 3.8vw, 2.125rem);
  font-weight: 500;
  letter-spacing: -0.015em;
  line-height: 1.15;
  /* The landing's ice gradient: frost falling into the sky accent. */
  background: linear-gradient(102deg, #f0f5f7 0%, #cce6f1 38%, #7fc4e2 68%, #59afd4 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

/*
  The tutor talking, not a system label — so it is set in the same hand as the
  formulas doodled beside the column, rather than the mono label face the rest
  of the chrome uses. Caveat runs small for its point size, hence the step up.
*/
.ac-landing__suggestions-label {
  margin: 0 0 0.65rem;
  font-family: var(--font-hand);
  font-size: 1.3125rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  line-height: 1.1;
  color: var(--ink-soft);
  text-align: center;
}

.ac-landing__question-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  /*
    One stacked column. A second column clips on the empty-board panel — the
    cards share one left edge and stay fully readable.
  */
  gap: 0.55rem;
}

.ac-landing__question-item {
  display: flex;
}

/*
  A card is the pedestal button at document scale: a cap resting on a slightly
  taller base. The strip of base still showing under the cap is the shadow, so
  pressing simply drops the cap by that strip — the outer box never moves and
  the stack never reflows.
*/
.ac-landing__question {
  --card-lift: 5px;
  --card-press: 0px;
  --card-radius: 1rem;
  --card-cap: linear-gradient(180deg, var(--ink-800) 0%, var(--ink-850) 100%);
  --card-cap-hi: linear-gradient(180deg, var(--ink-700) 0%, var(--ink-800) 100%);
  --card-base: var(--ink-950);
  --card-line: var(--stroke);

  position: relative;
  isolation: isolate;
  z-index: 0;
  width: 100%;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem 0.875rem;
  align-items: center;

  padding-left: 1.2rem;
  padding-right: 1.1rem;
  padding-top: calc(0.7rem + var(--card-press));
  padding-bottom: calc(0.7rem + var(--card-lift) - var(--card-press));

  border: 1px solid var(--card-line);
  border-radius: var(--card-radius);
  background: var(--card-base);
  text-align: left;
  cursor: pointer;
  transition:
    padding-top 260ms cubic-bezier(0.2, 0.9, 0.25, 1),
    padding-bottom 260ms cubic-bezier(0.2, 0.9, 0.25, 1);
}

/* The cap. It carries the face; the element behind it is the base. */
.ac-landing__question::before {
  content: "";
  position: absolute;
  z-index: -1;
  inset: -1px -1px auto;
  /* Padding box + both borders, less the lift, so exactly one --card-lift of
     base stays showing under the cap: the same 6px as the gap between cards. */
  height: calc(100% + 2px - var(--card-lift));
  border: 1px solid var(--card-line);
  border-radius: var(--card-radius);
  background: var(--card-cap);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.07),
    0 1px 2px rgba(3, 11, 18, 0.4);
  transform: translateY(var(--card-press));
  transition:
    transform 260ms cubic-bezier(0.2, 0.9, 0.25, 1),
    background 260ms ease,
    border-color 260ms ease,
    box-shadow 260ms ease;
}

.ac-landing__question:hover,
.ac-landing__question:focus-visible {
  --card-press: -2px;
  outline: none;
}

.ac-landing__question:hover::before,
.ac-landing__question:focus-visible::before {
  background: var(--card-cap-hi);
  border-color: var(--stroke-strong);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    0 8px 18px -8px rgba(3, 11, 18, 0.75);
}

/* Pressing lands the cap flat on its base. */
.ac-landing__question:active {
  --card-press: var(--card-lift);
}

.ac-landing__question:active,
.ac-landing__question:active::before {
  transition-duration: 80ms;
  transition-timing-function: cubic-bezier(0.3, 0, 0.2, 1);
}

.ac-landing__question-topic {
  grid-column: 1 / -1;
  justify-self: start;
  display: inline-flex;
  align-items: center;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0;
  color: var(--ink-faint);
  transition: color 260ms ease;
}

.ac-landing__question-text {
  font-size: 0.875rem;
  font-weight: 450;
  line-height: 1.4;
  letter-spacing: -0.01em;
  color: var(--ink);
}

/* The arrow leans out of the card as the cap rises. */
.ac-landing__question-go {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  flex-shrink: 0;
  border-radius: 999px;
  color: var(--ink-faint);
  opacity: 0;
  transform: translateX(-5px);
  transition:
    opacity 260ms cubic-bezier(0.2, 0.9, 0.25, 1),
    transform 260ms cubic-bezier(0.2, 0.9, 0.25, 1),
    color 260ms ease;
}

.ac-landing__question-go svg {
  width: 0.95rem;
  height: 0.95rem;
}

.ac-landing__question:hover .ac-landing__question-go,
.ac-landing__question:focus-visible .ac-landing__question-go {
  opacity: 1;
  transform: translateX(0);
  color: var(--accent);
}

.ac-landing__question:hover .ac-landing__question-topic,
.ac-landing__question:focus-visible .ac-landing__question-topic {
  color: var(--accent);
}

@media (prefers-reduced-motion: reduce) {
  .ac-landing__question,
  .ac-landing__question::before,
  .ac-landing__question-go {
    transition: none;
  }
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
