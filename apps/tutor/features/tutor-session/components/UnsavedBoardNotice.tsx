"use client";

import { useId } from "react";
import { CloudOff, RotateCcw } from "lucide-react";
import { unsavedNoticeAction } from "@/features/tutor-session/lib/board/unsavedBoard";
import { cn } from "@/lib/utils";

export const UNSAVED_BOARD_COPY = {
  eyebrow: "This board",
  statusExact: "This lesson was not saved, so there is nothing to replay.",
  statusTopic: "This lesson was not saved, and we only kept its topic.",
  teachAgain: "Teach it again",
  askElse: "Ask something else",
} as const;

export interface UnsavedBoardNoticeProps {
  /** The student's exact question, when it was kept (`unsavedLessonBoard().question`). */
  question: string | null;
  /**
   * With a question: the board title shown above it ("" for none). Without
   * one: the topic that heads the notice (`unsavedLessonBoard().title`).
   */
  title: string;
  /**
   * Teach it again. `exact` is true when `text` is the student's own
   * question, so it can be sent; false means only a topic survived, so the
   * shell prefills the composer with it instead of sending.
   */
  onTeachAgain: (text: string, options: { exact: boolean }) => void;
  /** Open the composer for a different question. */
  onAskSomethingElse: () => void;
  /** Teaching cannot start now (out of credits, offline). The buttons say so by being disabled. */
  disabled?: boolean;
  /** Why the buttons are disabled, if they are. */
  disabledReason?: string;
  className?: string;
}

/**
 * What an unsaved board shows instead of the home landing: the question it
 * was asked, a plain line that the lesson was not saved, and two ways on.
 * No greeting, suggestions or doodles: those say "home".
 */
export function UnsavedBoardNotice({
  question,
  title,
  onTeachAgain,
  onAskSomethingElse,
  disabled = false,
  disabledReason,
  className,
}: UnsavedBoardNoticeProps) {
  const headingId = useId();
  const { text: heading, exact } = unsavedNoticeAction({ question, title });
  const above = exact && title.trim() ? title : null;
  return (
    <section
      role="region"
      aria-labelledby={headingId}
      data-unsaved-board={exact ? "question" : "topic"}
      className={cn(
        "animate-wb-fade-in mx-auto flex w-full max-w-[34rem] flex-col items-center gap-4 px-6 text-center",
        className,
      )}
    >
      <p className="type-accent-xs text-faint">{UNSAVED_BOARD_COPY.eyebrow}</p>
      {above ? <p className="type-accent-s -mb-2 text-soft">{above}</p> : null}
      <h2
        id={headingId}
        className="font-heading line-clamp-4 whitespace-pre-line break-words text-[clamp(1.375rem,3vw,1.75rem)] font-medium leading-tight tracking-[-0.015em] text-frost"
      >
        {heading}
      </h2>
      <p className="type-accent-s inline-flex items-center gap-1.5 text-soft">
        <CloudOff className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
        {exact ? UNSAVED_BOARD_COPY.statusExact : UNSAVED_BOARD_COPY.statusTopic}
      </p>
      <div className="flex flex-wrap justify-center gap-2" title={disabled ? disabledReason : undefined}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onTeachAgain(heading, { exact })}
          className="btn btn-sky btn-md [@media(pointer:coarse)]:min-h-11"
        >
          <RotateCcw className="h-[15px] w-[15px]" aria-hidden />
          {UNSAVED_BOARD_COPY.teachAgain}
        </button>
        <button
          type="button"
          onClick={onAskSomethingElse}
          className="btn btn-ghost btn-md [@media(pointer:coarse)]:min-h-11"
        >
          {UNSAVED_BOARD_COPY.askElse}
        </button>
      </div>
    </section>
  );
}
