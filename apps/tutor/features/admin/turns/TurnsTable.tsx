import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { AdminTurnRow } from "@/lib/admin/types";
import { cn } from "@/lib/utils";
import { OutcomePill } from "../shared/components/OutcomePill";
import { formatRelativeTime, truncateText } from "../shared/lib/format";

const CELL = "px-3 py-2 align-middle";
const HEAD = "type-accent-xs px-3 py-2 text-left text-faint";

function tierLabel(tier: AdminTurnRow["tier"]): string {
  if (tier === "exact_verified") return "exact";
  if (tier === "qualitative_verified") return "qualitative";
  if (tier === "question_representation") return "question";
  return "—";
}

export function TurnsTable({ turns }: { turns: AdminTurnRow[] }) {
  return (
    <div className="glass overflow-x-auto rounded-xl">
      <table className="w-full min-w-[52rem] border-collapse">
        <thead>
          <tr className="border-b border-stroke">
            <th className={HEAD}>Question</th>
            <th className={HEAD}>Outcome</th>
            <th className={HEAD}>User</th>
            <th className={HEAD}>When</th>
            <th className={cn(HEAD, "text-right")}>Trace</th>
          </tr>
        </thead>
        <tbody>
          {turns.map((turn) => (
            <tr
              key={turn.turnId}
              className="border-b border-stroke/60 transition-colors last:border-b-0 hover:bg-white/[0.03]"
            >
              <td className={CELL}>
                <p className="max-w-[24rem] truncate text-xs text-frost" title={turn.question}>
                  {truncateText(turn.question, 90)}
                </p>
                {turn.degradationReason ? (
                  <p className="type-accent-xs mt-0.5 text-danger">
                    {turn.degradationReason.replaceAll("_", " ")}
                    {turn.issueCodes.length > 0 ? ` · ${turn.issueCodes.join(", ")}` : ""}
                    {turn.candidateCount != null ? ` · ${turn.candidateCount} candidates` : ""}
                  </p>
                ) : null}
              </td>
              <td className={CELL}>
                <OutcomePill outcome={turn.outcome} />
                <p className="type-accent-xs mt-0.5 text-faint">{tierLabel(turn.tier)}</p>
              </td>
              <td className={CELL}>
                <Link
                  href={`/admin/users/${turn.userId}`}
                  className="type-accent-xs block max-w-[10rem] truncate text-soft transition-colors hover:text-frost"
                >
                  {turn.userLabel}
                </Link>
                <p className="type-accent-xs mt-0.5 max-w-[10rem] truncate text-faint" title={turn.boardTitle}>
                  {truncateText(turn.boardTitle, 18)}
                </p>
              </td>
              <td className={CELL}>
                <p className="type-accent-xs text-soft">{formatRelativeTime(turn.createdAt)}</p>
                <p className="type-accent-xs mt-0.5 text-faint">
                  {turn.sceneEngineVersion ?? "no engine version"}
                </p>
              </td>
              <td className={cn(CELL, "text-right")}>
                {turn.traceUrl ? (
                  <a
                    href={turn.traceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 type-accent-xs text-sky-300 transition-colors hover:text-sky-200"
                    title="Open the Langfuse trace"
                  >
                    Langfuse
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                ) : (
                  <span className="type-accent-xs text-faint">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
