"use client";

/**
 * What the board understood.
 *
 * The single most important thing about marking is that the student can see it
 * landed. A ring drawn round a line that resolved to nothing looks identical to
 * one that resolved perfectly — until the board says the line back. Each chip
 * is the exact text the doubt prompt will quote, so what the student reads here
 * is what the tutor will be asked about.
 */
import { Highlighter, X } from "lucide-react";
import {
  MARK_MODE_EMPTY_HINT,
  MARK_MODE_HINT,
  markGestureVerb,
  markTargets,
  type BoardMark,
  type MarkTarget,
} from "../lib/board/boardMarking";

export interface MarkedDoubtBarProps {
  armed: boolean;
  marks: BoardMark[];
  atMarkLimit: boolean;
  onRemove: (id: string, targetIndex?: number) => void;
  onClear: () => void;
  onDone: () => void;
}

function chipLabel(
  mark: BoardMark,
  target: MarkTarget,
): { verb: string; body: string; grounded: boolean } {
  const verb = markGestureVerb(mark.gesture);
  if (target.kind === "region") {
    return { verb, body: target.text, grounded: false };
  }
  const meaning = target.meaning ? ` — ${target.meaning}` : "";
  return { verb, body: `${target.text}${meaning}`, grounded: true };
}

export function MarkedDoubtBar({
  armed,
  marks,
  atMarkLimit,
  onRemove,
  onClear,
  onDone,
}: MarkedDoubtBarProps) {
  if (!armed) {
    return null;
  }

  return (
    <div
      className="flex w-full flex-col gap-2 rounded-2xl px-3 py-2.5"
      style={{
        backgroundColor: "var(--ink-850)",
        border: "1px solid rgba(89, 175, 212, 0.28)",
        boxShadow: "0 10px 30px -12px rgba(3, 11, 18, 0.6)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className="flex min-w-0 items-center gap-2 text-[0.8125rem] font-medium"
          style={{ color: "var(--sky-300)" }}
        >
          <Highlighter className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
          <span className="truncate">
            {marks.length === 0
              ? MARK_MODE_HINT
              : atMarkLimit
                ? "That is plenty to go on — ask away."
                : MARK_MODE_EMPTY_HINT}
          </span>
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {marks.length > 0 ? (
            <button
              type="button"
              onClick={onClear}
              className="rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
              style={{ color: "var(--text-soft)" }}
              onMouseEnter={(event) => {
                event.currentTarget.style.color = "var(--frost)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.color = "var(--text-soft)";
              }}
            >
              Clear marks
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDone}
            aria-label="Put the marker away"
            title="Put the marker away (Esc)"
            className="flex h-7 w-7 items-center justify-center rounded-full transition-colors"
            style={{ backgroundColor: "var(--stroke)", color: "var(--text-soft)" }}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>

      {marks.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Marked on the board">
          {marks.flatMap((mark) => {
            const targets = markTargets(mark);
            return targets.map((target, targetIndex) => {
              const { verb, body, grounded } = chipLabel(mark, target);
              return (
                <li key={`${mark.id}:${targetIndex}`}>
                  <span
                    className="flex max-w-[22rem] items-center gap-1.5 rounded-full py-1 pl-2.5 pr-1"
                    style={{
                      backgroundColor: grounded
                        ? "rgba(89, 175, 212, 0.14)"
                        : "rgba(232, 145, 58, 0.13)",
                      border: `1px solid ${
                        grounded ? "rgba(89, 175, 212, 0.32)" : "rgba(232, 145, 58, 0.3)"
                      }`,
                    }}
                  >
                    <span
                      className="shrink-0 text-[0.75rem] tracking-normal"
                      style={{ color: grounded ? "var(--sky-300)" : "var(--warning)" }}
                    >
                      {verb}
                    </span>
                    <span
                      className="truncate text-[0.8125rem]"
                      style={{ color: "var(--frost)" }}
                      title={body}
                    >
                      {grounded ? body : `${body} — nothing there`}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemove(mark.id, targetIndex)}
                      aria-label={`Remove mark: ${verb} ${body}`}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors"
                      style={{ color: "var(--text-faint)" }}
                      onMouseEnter={(event) => {
                        event.currentTarget.style.color = "var(--frost)";
                      }}
                      onMouseLeave={(event) => {
                        event.currentTarget.style.color = "var(--text-faint)";
                      }}
                    >
                      <X className="h-3 w-3" strokeWidth={2.25} aria-hidden />
                    </button>
                  </span>
                </li>
              );
            });
          })}
        </ul>
      ) : null}
    </div>
  );
}
