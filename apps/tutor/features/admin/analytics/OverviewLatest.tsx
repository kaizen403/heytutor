import Link from "next/link";
import type { OverviewPayload } from "@/lib/admin/types";
import { OutcomePill } from "../shared/components/OutcomePill";
import { formatRelativeTime, truncateText } from "../shared/lib/format";

export function OverviewLatest({ payload }: { payload: OverviewPayload }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <div className="glass rounded-xl px-3 py-2.5">
        <p className="type-accent-xs text-faint">Latest turns</p>
        <ul className="mt-2 divide-y divide-stroke">
          {payload.latestTurns.map((turn) => (
            <li key={turn.turnId} className="flex items-start justify-between gap-3 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-xs text-frost" title={turn.question}>
                  {truncateText(turn.question, 64)}
                </p>
                <p className="type-accent-xs mt-0.5 truncate text-faint">
                  {turn.userLabel} · {truncateText(turn.boardTitle, 24)} ·{" "}
                  {formatRelativeTime(turn.createdAt)}
                </p>
              </div>
              <OutcomePill outcome={turn.outcome} />
            </li>
          ))}
          {payload.latestTurns.length === 0 ? (
            <li className="type-accent-xs py-2 text-faint">No turns yet</li>
          ) : null}
        </ul>
      </div>

      <div className="glass rounded-xl px-3 py-2.5">
        <p className="type-accent-xs text-faint">Most active users · 7 days</p>
        <ul className="mt-2 divide-y divide-stroke">
          {payload.topUsers7d.map((user) => (
            <li key={user.userId} className="flex items-baseline justify-between gap-3 py-1.5">
              <Link
                href={`/admin/users/${user.userId}`}
                className="type-accent-xs min-w-0 truncate text-soft transition-colors hover:text-frost"
              >
                {user.label}
              </Link>
              <p className="type-accent-xs shrink-0 tabular-nums text-frost">
                {user.turns} turn{user.turns === 1 ? "" : "s"}
              </p>
            </li>
          ))}
          {payload.topUsers7d.length === 0 ? (
            <li className="type-accent-xs py-2 text-faint">No turns this week</li>
          ) : null}
        </ul>
      </div>

      <div className="glass rounded-xl px-3 py-2.5">
        <p className="type-accent-xs text-faint">Busiest boards · 7 days</p>
        <ul className="mt-2 divide-y divide-stroke">
          {payload.topBoards7d.map((board) => (
            <li key={board.boardId} className="flex items-baseline justify-between gap-3 py-1.5">
              <div className="min-w-0">
                <p className="type-accent-xs truncate text-soft" title={board.title}>
                  {board.title}
                </p>
                <p className="type-accent-xs mt-0.5 truncate text-faint">{board.userLabel}</p>
              </div>
              <p className="type-accent-xs shrink-0 tabular-nums text-frost">
                {board.turns} turn{board.turns === 1 ? "" : "s"}
              </p>
            </li>
          ))}
          {payload.topBoards7d.length === 0 ? (
            <li className="type-accent-xs py-2 text-faint">No turns this week</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
