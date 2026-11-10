"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Star, X } from "lucide-react";
import { MAX_LECTURE_FEEDBACK_CHARS, MAX_LECTURE_STARS } from "@/lib/lecture-rating/ratingInput";
import { cn } from "@/lib/utils";
import type { LectureRatingPrompt, LectureRatingSendResult } from "../hooks/useLectureRating";
import { RATING_THANKS_MS } from "../lib/turn/lectureRatingPrompt";

const STAR_WORDS = ["Poor", "Fair", "Okay", "Good", "Great"] as const;
const SAVE_FAILED = "That did not save. Try again.";

export interface LectureRatingProps {
  prompt: LectureRatingPrompt;
  /** `toast` floats on the board mid-lecture; `card` sits above the composer at the end. */
  variant: "toast" | "card";
  onRate: (stars: number, feedback?: string | null) => Promise<LectureRatingSendResult>;
  onHold: () => void;
  onClose: () => void;
}

type Stage = "pick" | "note" | "thanks";

/**
 * Stars, then an optional note. A star saves at once, so a student who walks
 * away still counts; Send rewrites the same rating with the note.
 */
export function LectureRating({ prompt, variant, onRate, onHold, onClose }: LectureRatingProps) {
  const [stars, setStars] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [stage, setStage] = useState<Stage>("pick");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const toast = variant === "toast";

  useEffect(() => {
    if (stage !== "thanks") return undefined;
    const timer = window.setTimeout(onClose, RATING_THANKS_MS);
    return () => window.clearTimeout(timer);
  }, [stage, onClose]);

  useEffect(() => {
    if (stage === "note" && !toast) noteRef.current?.focus({ preventScroll: true });
  }, [stage, toast]);

  const pick = (value: number) => {
    onHold();
    setStars(value);
    setError(null);
    if (stage === "pick") setStage("note");
    void onRate(value, note.trim() || null).then((result) => {
      if (result === "failed") setError(SAVE_FAILED);
    });
  };

  const send = async () => {
    if (stars === null || sending) return;
    const feedback = note.trim();
    if (!feedback && !error) {
      setStage("thanks");
      return;
    }
    setSending(true);
    const result = await onRate(stars, feedback || null);
    setSending(false);
    if (result === "failed") {
      setError(SAVE_FAILED);
      return;
    }
    setError(null);
    setStage("thanks");
  };

  const onNoteKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const shown = hover ?? stars;
  const title = toast ? "How is this lecture so far?" : "Rate this lecture";
  const subtitle = toast
    ? null
    : prompt.duringStars !== null
      ? `Midway you gave it ${prompt.duringStars} ${prompt.duringStars === 1 ? "star" : "stars"}. How did it end?`
      : "How well did it teach you? Your rating shapes the next lecture.";
  const placeholder = stars !== null && stars <= 3
    ? "What went wrong? (optional)"
    : "What worked for you? (optional)";

  return (
    <div
      className={cn(
        "pointer-events-auto flex flex-col rounded-2xl",
        toast ? "glass-deep animate-fade-up w-[min(20rem,calc(100vw-2rem))] gap-2 px-3 py-2.5" : "w-full gap-2.5 px-3 py-2.5",
      )}
      style={
        toast
          ? undefined
          : {
              backgroundColor: "var(--ink-850)",
              border: "1px solid rgba(74, 158, 255, 0.28)",
              boxShadow: "0 10px 30px -12px rgba(0, 0, 0, 0.6)",
            }
      }
      role="group"
      aria-label={title}
      onFocusCapture={onHold}
      onPointerDown={onHold}
    >
      {stage === "thanks" ? (
        <p className="text-[0.8125rem] font-medium" style={{ color: "var(--sky-300)" }} role="status">
          Thanks for rating this lecture.
        </p>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[0.8125rem] font-medium" style={{ color: "var(--sky-300)" }}>
                {title}
              </p>
              {subtitle ? (
                <p className="text-[0.8125rem] leading-snug" style={{ color: "var(--text-soft)" }}>
                  {subtitle}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={stage === "pick" ? "Not now" : "Close"}
              className="inline-flex shrink-0 items-center justify-center text-soft transition-colors hover:text-frost [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div
              role="radiogroup"
              aria-label="Stars, 1 to 5"
              className="flex items-center"
              onMouseLeave={() => setHover(null)}
            >
              {Array.from({ length: MAX_LECTURE_STARS }, (_, index) => {
                const value = index + 1;
                const lit = shown !== null && value <= shown;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={stars === value}
                    aria-label={`${value} ${value === 1 ? "star" : "stars"}, ${STAR_WORDS[index]}`}
                    onMouseEnter={() => setHover(value)}
                    onFocus={() => setHover(value)}
                    onBlur={() => setHover(null)}
                    onClick={() => pick(value)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                  >
                    <Star
                      className="h-5 w-5"
                      strokeWidth={1.6}
                      style={{ color: lit ? "var(--sky-300)" : "var(--text-faint)" }}
                      fill={lit ? "currentColor" : "none"}
                      aria-hidden
                    />
                  </button>
                );
              })}
            </div>
            {shown !== null ? (
              <span className="text-[0.8125rem]" style={{ color: "var(--text-soft)" }} aria-hidden>
                {STAR_WORDS[shown - 1]}
              </span>
            ) : null}
          </div>

          {stage === "note" ? (
            <div className={cn("flex gap-2", toast ? "items-end" : "flex-col sm:flex-row sm:items-end")}>
              <textarea
                ref={noteRef}
                rows={toast ? 1 : 2}
                value={note}
                maxLength={MAX_LECTURE_FEEDBACK_CHARS}
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={onNoteKeyDown}
                placeholder={placeholder}
                aria-label="Feedback on this lecture (optional)"
                className="min-w-0 flex-1 resize-none rounded-xl border border-stroke bg-[rgba(0,0,0,0.22)] px-3 py-2 text-[0.8125rem] text-frost outline-none placeholder:text-faint focus:border-sky-500"
              />
              <div className="flex shrink-0 items-center justify-end gap-1.5">
                <button type="button" onClick={() => void send()} disabled={sending} className="btn btn-sky btn-sm">
                  {note.trim() ? (sending ? "Sending…" : "Send") : "Done"}
                </button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="text-xs text-warning" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
