"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AccountCard, AccountPageFrame } from "./AccountPageFrame";
import { SiteButton } from "@/components/ui/site-button";
import type { ProgressV1 } from "@/lib/account/progress";
import { SUBJECT_LABELS } from "@/lib/account/types";
import { boardPath } from "@/features/tutor-session/lib/board/boardRoute";

export function ProgressScreen() {
  const router = useRouter();
  const [progress, setProgress] = useState<ProgressV1 | null>(null);

  useEffect(() => {
    void fetch("/api/account/progress")
      .then((response) => response.json())
      .then((data: { progress?: ProgressV1 }) => {
        if (data.progress) setProgress(data.progress);
      });
  }, []);

  return (
    <AccountPageFrame
      title="Progress"
      subtitle="Honest activity from boards and turns you already have. No syllabus completion percentage until topics are tagged."
    >
      {!progress ? (
        <p className="text-sm text-[rgba(237,237,235,0.55)]">Loading activity…</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Stat label="Boards" value={String(progress.boardCount)} />
          <Stat label="Lessons taught" value={String(progress.lessonCount)} />
          <Stat label="Narration minutes" value={String(progress.narrationMinutes)} />
          <Stat label="Notes-chat doubts" value={String(progress.notesDoubtCount)} />
        </div>
      )}

      {progress?.lastBoard ? (
        <AccountCard title="Continue" className="mt-4">
          <p className="text-sm text-frost">{progress.lastBoard.title}</p>
          <div className="mt-3 flex gap-2">
            <SiteButton variant="ice" size="sm" onClick={() => router.push(boardPath(progress.lastBoard!.id))}>
              Continue last board
            </SiteButton>
            <SiteButton
              size="sm"
              onClick={() => router.push(`/?q=${encodeURIComponent(`I have a doubt about ${progress.lastBoard!.title}`)}`)}
            >
              Ask a doubt on this topic
            </SiteButton>
          </div>
        </AccountCard>
      ) : null}

      <AccountCard title="Activity by week" className="mt-4">
        {!progress || progress.weeks.length === 0 ? (
          <p className="text-sm text-[rgba(237,237,235,0.55)]">No taught weeks yet.</p>
        ) : (
          <ul className="space-y-2 text-sm text-[rgba(237,237,235,0.75)]">
            {progress.weeks.map((week) => (
              <li key={week.weekStart} className="flex justify-between gap-3">
                <span>Week of {week.weekStart}</span>
                <span>
                  {week.lessons} lessons · {Math.round(week.minutes * 10) / 10} min
                </span>
              </li>
            ))}
          </ul>
        )}
        {progress ? (
          <p className="mt-3 text-xs text-[rgba(237,237,235,0.4)]">
            Days you opened a lesson: {progress.daysOpened}
          </p>
        ) : null}
      </AccountCard>

      <AccountCard title="Subject split" className="mt-4">
        {!progress || progress.subjects.length === 0 ? (
          <p className="text-sm text-[rgba(237,237,235,0.55)]">
            Subject mix is inferred from onboarding plus board titles and first questions. Untagged boards stay in Other.
          </p>
        ) : (
          <ul className="space-y-2 text-sm text-[rgba(237,237,235,0.75)]">
            {progress.subjects.map((row) => (
              <li key={row.subject} className="flex justify-between gap-3">
                <span>{row.subject === "other" ? "Other" : SUBJECT_LABELS[row.subject]}</span>
                <span>
                  {row.boards} boards · {row.lessons} lessons
                </span>
              </li>
            ))}
          </ul>
        )}
      </AccountCard>
    </AccountPageFrame>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <AccountCard>
      <p className="text-xs text-[rgba(237,237,235,0.5)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-frost">{value}</p>
    </AccountCard>
  );
}
