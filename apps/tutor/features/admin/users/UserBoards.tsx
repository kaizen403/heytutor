import type { AdminUserBoard } from "@/lib/admin/types";
import { cn } from "@/lib/utils";
import { formatRelativeTime, truncateText } from "../shared/lib/format";

function StatePill({ board }: { board: AdminUserBoard }) {
  if (board.archived) {
    return (
      <span className="type-accent-xs ml-1.5 rounded-full border border-stroke bg-ink-800 px-2 py-0.5 text-soft">
        archived
      </span>
    );
  }
  if (board.pinned) {
    return (
      <span className="type-accent-xs ml-1.5 rounded-full border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-sky-300">
        pinned
      </span>
    );
  }
  return null;
}

export function UserBoards({ boards }: { boards: AdminUserBoard[] }) {
  return (
    <section className="space-y-2">
      <h2 className="type-accent-xs text-faint">
        Boards · newest {boards.length} of this user&rsquo;s boards
      </h2>
      <div className="glass rounded-xl px-3 py-2.5">
        <ul className="divide-y divide-stroke">
          {boards.map((board) => (
            <li key={board.boardId} className="flex items-baseline justify-between gap-3 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-xs text-frost">
                  {board.title}
                  <StatePill board={board} />
                </p>
                <p className="type-accent-xs mt-0.5 truncate text-faint">
                  {board.preview ? truncateText(board.preview, 72) : "no questions yet"}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className={cn("type-accent-xs tabular-nums text-frost")}>
                  {board.turns} turn{board.turns === 1 ? "" : "s"}
                </p>
                <p className="type-accent-xs mt-0.5 text-faint">
                  {formatRelativeTime(board.updatedAt)}
                </p>
              </div>
            </li>
          ))}
          {boards.length === 0 ? (
            <li className="type-accent-xs py-2 text-faint">No boards yet.</li>
          ) : null}
        </ul>
      </div>
    </section>
  );
}
