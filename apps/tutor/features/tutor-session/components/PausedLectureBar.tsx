"use client";

import {
  PAUSED_LECTURE_ANOTHER_DOUBT_LABEL,
  PAUSED_LECTURE_BODY,
  PAUSED_LECTURE_CONTINUE_LABEL,
  PAUSED_LECTURE_TITLE,
  focusQuestionField,
} from "../lib/turn/lessonFollowUp";

export interface PausedLectureBarProps {
  visible: boolean;
  onContinue: () => void;
}

export function PausedLectureBar({ visible, onContinue }: PausedLectureBarProps) {
  if (!visible) return null;

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
          {PAUSED_LECTURE_TITLE}
        </p>
        <p className="text-[0.8125rem] leading-snug" style={{ color: "var(--text-soft)" }}>
          {PAUSED_LECTURE_BODY}
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
          {PAUSED_LECTURE_ANOTHER_DOUBT_LABEL}
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="btn btn-sky btn-sm"
        >
          {PAUSED_LECTURE_CONTINUE_LABEL}
        </button>
      </div>
    </div>
  );
}
