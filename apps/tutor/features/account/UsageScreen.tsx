"use client";

import { useEffect, useState } from "react";
import { AccountCard, AccountPageFrame } from "./AccountPageFrame";
import type { ProgressV1 } from "@/lib/account/progress";

export function UsageScreen() {
  const [progress, setProgress] = useState<ProgressV1 | null>(null);

  useEffect(() => {
    void fetch("/api/account/progress")
      .then((response) => response.json())
      .then((data: { progress?: ProgressV1 }) => {
        if (data.progress) setProgress(data.progress);
      });
  }, []);

  const thisWeek = progress?.weeks[0];
  const monthLessons = progress?.weeks.slice(0, 5).reduce((sum, week) => sum + week.lessons, 0) ?? 0;

  return (
    <AccountPageFrame
      title="Usage"
      subtitle="Activity on this account. Credits stay empty until billing exists."
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Stat label="Lessons this week" value={thisWeek?.lessons ?? 0} />
        <Stat label="Lessons this month" value={monthLessons} />
        <Stat label="Narration minutes" value={progress?.narrationMinutes ?? 0} />
      </div>
      <AccountCard title="Exports" className="mt-4">
        <p className="text-sm text-[rgba(237,237,235,0.62)]">
          Notes PDFs and lecture MP4s are produced on this device. Accelute does not store a usage count for them yet.
        </p>
      </AccountCard>
      <AccountCard title="Credits" className="mt-4">
        <p className="text-sm text-[rgba(237,237,235,0.62)]">
          Credits and plans will live here. There is nothing to buy in this version.
        </p>
      </AccountCard>
    </AccountPageFrame>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <AccountCard>
      <p className="text-xs text-[rgba(237,237,235,0.5)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-frost">{value}</p>
    </AccountCard>
  );
}
