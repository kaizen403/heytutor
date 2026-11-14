import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import Link from "next/link";
import type { AdminUserRow } from "@/lib/admin/types";
import { cn } from "@/lib/utils";
import { formatMillicentsUsd, formatRelativeTime } from "../shared/lib/format";

const CELL = "px-4 py-3 align-middle";
const HEAD = "px-4 text-left text-xs font-medium text-muted-foreground";

function ActivePill({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span className="type-accent-xs ml-1.5 inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-foreground">
      active now
    </span>
  );
}

export function UsersTable({ users }: { users: AdminUserRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table className="w-full min-w-[46rem] border-collapse">
        <TableHeader>
          <TableRow className="border-b border-stroke">
            <TableHead className={HEAD}>User</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>Turns</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>Boards</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>Messages</TableHead>
            <TableHead className={HEAD}>Last turn</TableHead>
            <TableHead
              className={cn(HEAD, "text-right")}
              title="Estimated AI + voice this calendar month"
            >
              Spend · month
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow
              key={user.userId}
              className="border-b border-stroke/60 transition-colors last:border-b-0 hover:bg-white/[0.03]"
            >
              <TableCell className={CELL}>
                <Link
                  href={`/admin/users/${user.userId}`}
                  className="block min-w-0 hover:text-foreground"
                >
                  <p className="truncate text-xs font-medium text-frost">
                    {user.name ?? user.email ?? user.userId.slice(0, 8)}
                    <ActivePill active={user.activeNow} />
                  </p>
                  <p className="type-accent-xs mt-0.5 truncate text-faint">
                    {user.email ?? `anonymous · ${user.userId.slice(0, 8)}`}
                    {user.classYear ? ` · class ${user.classYear}` : ""}
                    {user.subjects.length > 0
                      ? ` · ${user.subjects.join(", ")}`
                      : ""}
                  </p>
                </Link>
              </TableCell>
              <TableCell
                className={cn(
                  CELL,
                  "text-right tabular-nums text-xs text-frost",
                )}
              >
                {user.turns}
              </TableCell>
              <TableCell
                className={cn(
                  CELL,
                  "text-right tabular-nums text-xs text-frost",
                )}
              >
                {user.boards}
              </TableCell>
              <TableCell
                className={cn(
                  CELL,
                  "text-right tabular-nums text-xs text-frost",
                )}
              >
                {user.chatMessages}
              </TableCell>
              <TableCell className={CELL}>
                <p className="type-accent-xs text-soft">
                  {user.lastTurnAt
                    ? formatRelativeTime(user.lastTurnAt)
                    : "never"}
                </p>
                <p className="type-accent-xs mt-0.5 text-faint">
                  joined {formatRelativeTime(user.createdAt)}
                </p>
              </TableCell>
              <TableCell
                className={cn(
                  CELL,
                  "text-right tabular-nums type-accent-xs text-frost",
                )}
              >
                {user.spendMillicents == null
                  ? "—"
                  : formatMillicentsUsd(user.spendMillicents)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
