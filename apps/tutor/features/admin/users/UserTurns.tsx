import type { AdminUserTurn } from "@/lib/admin/types";
import { OutcomePill } from "../shared/components/OutcomePill";
import { formatDurationMs, formatRelativeTime, truncateText } from "../shared/lib/format";

function tierLabel(tier: AdminUserTurn["tier"]): string {
  if (tier === "exact_verified") return "exact";
  if (tier === "qualitative_verified") return "qualitative";
  if (tier === "question_representation") return "question";
  return "";
}

export function UserTurns({ turns }: { turns: AdminUserTurn[] }) {
  return (
    <section className="space-y-2">
      <h2 className="type-accent-xs text-faint">
        Questions &amp; turns · newest {turns.length}
      </h2>
      <div className="glass rounded-xl px-3 py-2.5">
        <ul className="divide-y divide-stroke">
          {turns.map((turn) => (
            <li key={turn.turnId} className="py-1.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-frost" title={turn.question}>
                    {truncateText(turn.question, 90)}
                  </p>
                  <p className="type-accent-xs mt-0.5 truncate text-faint">
                    {truncateText(turn.boardTitle, 28)} · {formatRelativeTime(turn.createdAt)} ·{" "}
                    {turn.segmentCount} segment{turn.segmentCount === 1 ? "" : "s"}
                    {turn.narratedMs != null ? ` · ${formatDurationMs(turn.narratedMs)}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <OutcomePill outcome={turn.outcome} />
                  {turn.tier ? (
                    <span className="type-accent-xs text-faint">{tierLabel(turn.tier)}</span>
                  ) : null}
                </div>
              </div>
              {turn.degradationReason ? (
                <p className="type-accent-xs mt-1 text-danger">
                  {turn.degradationReason.replaceAll("_", " ")}
                  {turn.issueCodes.length > 0 ? ` · ${turn.issueCodes.join(", ")}` : ""}
                </p>
              ) : null}
            </li>
          ))}
          {turns.length === 0 ? (
            <li className="type-accent-xs py-2 text-faint">No turns yet.</li>
          ) : null}
        </ul>
      </div>
    </section>
  );
}
