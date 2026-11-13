import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { AdminTurnRow } from "@/lib/admin/types";
import { formatUsd } from "@/lib/obs/runCost";
import { cn } from "@/lib/utils";
import { OutcomePill } from "../shared/components/OutcomePill";
import { formatRelativeTime, truncateText } from "../shared/lib/format";
import { RatingLog } from "./RatingLog";

const CELL = "px-4 py-3 align-middle";
const HEAD = "px-4 text-left text-xs font-medium text-muted-foreground";

function tierLabel(tier: AdminTurnRow["tier"]): string {
  if (tier === "exact_verified") return "exact";
  if (tier === "qualitative_verified") return "qualitative";
  if (tier === "question_representation") return "question";
  return "—";
}

export function TurnsTable({ turns }: { turns: AdminTurnRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table className="w-full min-w-[52rem] border-collapse">
        <TableHeader>
          <TableRow className="border-b border-stroke">
            <TableHead className={HEAD}>Question</TableHead>
            <TableHead className={HEAD}>Outcome</TableHead>
            <TableHead className={HEAD}>User</TableHead>
            <TableHead className={HEAD}>When</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>Cost (USD)</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>Trace</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {turns.map((turn) => (
            <TableRow
              key={turn.turnId}
              className="border-b border-stroke/60 transition-colors last:border-b-0 hover:bg-white/[0.03]"
            >
              <TableCell className={CELL}>
                <p
                  className="max-w-[24rem] truncate text-xs text-frost"
                  title={turn.question}
                >
                  {truncateText(turn.question, 90)}
                </p>
                <RatingLog ratings={turn.ratings} />
                {turn.degradationReason ? (
                  <p className="type-accent-xs mt-0.5 text-danger">
                    {turn.degradationReason.replaceAll("_", " ")}
                    {turn.issueCodes.length > 0
                      ? ` · ${turn.issueCodes.join(", ")}`
                      : ""}
                    {turn.candidateCount != null
                      ? ` · ${turn.candidateCount} candidates`
                      : ""}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className={CELL}>
                <OutcomePill outcome={turn.outcome} />
                <p className="type-accent-xs mt-0.5 text-faint">
                  {tierLabel(turn.tier)}
                </p>
              </TableCell>
              <TableCell className={CELL}>
                <Link
                  href={`/admin/users/${turn.userId}`}
                  className="type-accent-xs block max-w-[10rem] truncate text-soft transition-colors hover:text-frost"
                >
                  {turn.userLabel}
                </Link>
                <p
                  className="type-accent-xs mt-0.5 max-w-[10rem] truncate text-faint"
                  title={turn.boardTitle}
                >
                  {truncateText(turn.boardTitle, 18)}
                </p>
              </TableCell>
              <TableCell className={CELL}>
                <p className="type-accent-xs text-soft">
                  {formatRelativeTime(turn.createdAt)}
                </p>
                <p className="type-accent-xs mt-0.5 text-faint">
                  {turn.sceneEngineVersion ?? "no engine version"}
                </p>
              </TableCell>
              <TableCell className={cn(CELL, "text-right")}>
                {turn.totalUsd != null ? (
                  <div className="type-accent-xs flex flex-col items-end gap-0.5 whitespace-nowrap tabular-nums">
                    <span className="text-foreground">
                      {formatUsd(turn.totalUsd)}
                    </span>
                    <span className="text-soft">
                      AI {turn.llmUsd != null ? formatUsd(turn.llmUsd) : "—"}
                    </span>
                    <span className="text-soft">
                      Voice {turn.ttsUsd != null ? formatUsd(turn.ttsUsd) : "—"}
                    </span>
                  </div>
                ) : (
                  <span
                    className="type-accent-xs text-faint"
                    title="No cost data is available for this turn. Refresh to check again."
                  >
                    Unavailable
                  </span>
                )}
              </TableCell>
              <TableCell className={cn(CELL, "text-right")}>
                <div className="flex flex-col items-end gap-1">
                  {turn.sentryUrl ? (
                    <a
                      href={turn.sentryUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex flex-col items-end type-accent-xs text-foreground transition-colors hover:text-foreground"
                      title={`Sentry event ${turn.sentryEventId}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        View in Sentry
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </span>
                      <span className="font-mono text-faint">
                        {turn.sentryEventId}
                      </span>
                    </a>
                  ) : null}
                  {turn.traceUrl ? (
                    <a
                      href={turn.traceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 type-accent-xs text-foreground transition-colors hover:text-foreground"
                      title="Open the Langfuse trace"
                    >
                      Langfuse
                      <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  ) : !turn.sentryUrl ? (
                    <span className="type-accent-xs text-faint">—</span>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
