"use client";

import {
  focusQuestionField,
  earlyLessonRestartCopy,
  pausedLessonCopy,
  type PausedLessonCopyReason,
} from "../lib/turn/lessonFollowUp";

export type PausedLectureBarProps = {
  visible: boolean;
  /** "stop": the student stopped it (or reloaded); "doubt": a doubt was answered. */
  reason?: PausedLessonCopyReason;
} & (
  | { mode?: "continue"; onContinue: () => void }
  | { mode: "restart"; onRestart: () => void }
);

export function PausedLectureBar(props: PausedLectureBarProps) {
  const { visible, reason = "doubt" } = props;
  if (!visible) return null;
  const copy = props.mode === "restart" ? earlyLessonRestartCopy(reason) : pausedLessonCopy(reason);
  const onAction = props.mode === "restart" ? props.onRestart : props.onContinue;

  return (
    <div
      className="flex w-full flex-col gap-2.5 rounded-2xl px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
      style={{
        backgroundColor: "var(--ink-850)",
        border: "1px solid rgba(74, 158, 255, 0.28)",
        boxShadow: "0 10px 30px -12px rgba(0, 0, 0, 0.6)",
      }}
      role="status"
      aria-live="polite"
    >
      <div className="min-w-0">
        <p className="text-[0.8125rem] font-medium" style={{ color: "var(--sky-300)" }}>
          {copy.title}
        </p>
        <p className="text-[0.8125rem] leading-snug" style={{ color: "var(--text-soft)" }}>
          {copy.body}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            focusQuestionField();
          }}
          className="btn btn-ghost btn-sm"
        >
          {copy.askLabel}
        </button>
        <button
          type="button"
          onClick={onAction}
          className="btn btn-sky btn-sm"
        >
          {copy.continueLabel}
        </button>
      </div>
    </div>
  );
}
