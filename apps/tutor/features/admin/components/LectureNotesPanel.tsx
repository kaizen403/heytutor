"use client";

import { useEffect, useState } from "react";
import { fetchBoardDetail } from "@/lib/boards/boardsClient";

interface LectureNotesPanelProps {
  boardId: string;
}

export function LectureNotesPanel({ boardId }: LectureNotesPanelProps) {
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void fetchBoardDetail(boardId)
      .then((detail) => {
        if (cancelled) {
          return;
        }
        if (!detail) {
          setError("Could not load lecture notes.");
          return;
        }
        setQuestions(
          detail.turns
            .map((turn) => turn.question.trim())
            .filter((question) => question.length > 0),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load lecture notes.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [boardId]);

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-ink-850">
      <div className="shrink-0 border-b border-stroke px-4 py-3">
        <h2 className="text-sm font-semibold text-frost">Questions</h2>
        <p className="mt-0.5 text-[11px] text-soft">
          Prompts from this lecture. Narration is not saved.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {questions === null && !error ? (
          <p className="text-sm text-soft">Loading notes…</p>
        ) : null}
        {questions && questions.length === 0 ? (
          <p className="text-sm text-soft">No questions on this lecture yet.</p>
        ) : null}
        {questions && questions.length > 0 ? (
          <ol className="flex flex-col gap-3">
            {questions.map((question, index) => (
              <li key={`${question}-${index}`} className="text-sm leading-relaxed text-frost">
                <span className="mr-2 text-[11px] font-medium text-soft">{index + 1}.</span>
                {question}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </aside>
  );
}
