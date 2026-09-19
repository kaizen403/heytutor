import Link from "next/link";
import type { AdminUserRow } from "@/lib/admin/types";
import { cn } from "@/lib/utils";
import { formatMillicentsUsd, formatRelativeTime } from "../shared/lib/format";

const CELL = "px-3 py-2 align-middle";
const HEAD = "type-accent-xs px-3 py-2 text-left text-faint";

function ActivePill({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span className="type-accent-xs ml-1.5 inline-flex items-center rounded-full border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-sky-300">
      active now
    </span>
  );
}

export function UsersTable({ users }: { users: AdminUserRow[] }) {
  return (
    <div className="glass overflow-x-auto rounded-xl">
      <table className="w-full min-w-[46rem] border-collapse">
        <thead>
          <tr className="border-b border-stroke">
            <th className={HEAD}>User</th>
            <th className={cn(HEAD, "text-right")}>Turns</th>
            <th className={cn(HEAD, "text-right")}>Boards</th>
            <th className={cn(HEAD, "text-right")}>Messages</th>
            <th className={HEAD}>Last turn</th>
            <th className={cn(HEAD, "text-right")} title="Estimated Fireworks + ElevenLabs this calendar month">
              Spend · month
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr
              key={user.userId}
              className="border-b border-stroke/60 transition-colors last:border-b-0 hover:bg-white/[0.03]"
            >
              <td className={CELL}>
                <Link
                  href={`/admin/users/${user.userId}`}
                  className="block min-w-0 hover:text-sky-200"
                >
                  <p className="truncate text-xs font-medium text-frost">
                    {user.name ?? user.email ?? user.userId.slice(0, 8)}
                    <ActivePill active={user.activeNow} />
                  </p>
                  <p className="type-accent-xs mt-0.5 truncate text-faint">
                    {user.email ?? `anonymous · ${user.userId.slice(0, 8)}`}
                    {user.classYear ? ` · class ${user.classYear}` : ""}
                    {user.subjects.length > 0 ? ` · ${user.subjects.join(", ")}` : ""}
                  </p>
                </Link>
              </td>
              <td className={cn(CELL, "text-right tabular-nums text-xs text-frost")}>
                {user.turns}
              </td>
              <td className={cn(CELL, "text-right tabular-nums text-xs text-frost")}>
                {user.boards}
              </td>
              <td className={cn(CELL, "text-right tabular-nums text-xs text-frost")}>
                {user.chatMessages}
              </td>
              <td className={CELL}>
                <p className="type-accent-xs text-soft">
                  {user.lastTurnAt ? formatRelativeTime(user.lastTurnAt) : "never"}
                </p>
                <p className="type-accent-xs mt-0.5 text-faint">
                  joined {formatRelativeTime(user.createdAt)}
                </p>
              </td>
              <td
                className={cn(CELL, "text-right tabular-nums type-accent-xs text-frost")}
              >
                {user.spendMillicents == null ? "—" : formatMillicentsUsd(user.spendMillicents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
