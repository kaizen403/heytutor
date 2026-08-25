"use client";

import { useEffect, useState } from "react";
import { lessonNarrationText } from "@heytutor/drawing";
import { fetchBoardDetail } from "@/lib/boards/boardsClient";

interface LectureNotesPanelProps {
  boardId: string;
}

type TurnNote = {
  question: string;
  transcript: string;
};

export function LectureNotesPanel({ boardId }: LectureNotesPanelProps) {
  const [turns, setTurns] = useState<TurnNote[] | null>(null);
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
        setTurns(
          detail.turns.map((turn) => ({
            question: turn.question.trim(),
            transcript: lessonNarrationText(turn.rawResponse).trim(),
          })),
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
    <aside className="flex h-full min-h-0 w-full flex-col bg-[#151517]">
      <div className="shrink-0 border-b border-[#2E2E33] px-4 py-3">
        <h2 className="text-sm font-semibold text-[#F2F2F4]">Transcript</h2>
        <p className="mt-0.5 text-[11px] text-[#A6A6AE]">
          Same stored lecture as Replay and Download notes
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error ? <p className="text-sm text-[#E06858]">{error}</p> : null}
        {turns === null && !error ? (
          <p className="text-sm text-[#A6A6AE]">Loading notes…</p>
        ) : null}
        {turns && turns.length === 0 ? (
          <p className="text-sm text-[#A6A6AE]">No transcript saved for this lecture yet.</p>
        ) : null}
        {turns && turns.length > 0 ? (
          <div className="flex flex-col gap-4">
            {turns.map((turn, index) => (
              <section key={`${turn.question}-${index}`}>
                {turn.question ? (
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#A6A6AE]">
                    {turn.question}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#F2F2F4]">
                  {turn.transcript || "No narration stored for this turn."}
                </p>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
