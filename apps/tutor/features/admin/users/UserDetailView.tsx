"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { UserDetailPayload } from "@/lib/admin/types";
import { AdminPageHeader } from "../shared/components/AdminPageHeader";
import { EmptyState } from "../shared/components/EmptyState";
import { KpiCard } from "../shared/components/KpiCard";
import { useAdminQuery } from "../shared/hooks/useAdminQuery";
import { formatUsd } from "@/lib/obs/runCost";
import { formatCount, formatMillicentsUsd, formatRelativeTime } from "../shared/lib/format";
import { UserBoards } from "./UserBoards";
import { UserMessages } from "./UserMessages";
import { UserProfileCard } from "./UserProfileCard";
import { UserTurns } from "./UserTurns";

function backLink() {
  return (
    <Link
      href="/admin/users"
      className="type-accent-xs inline-flex items-center gap-1 text-faint transition-colors hover:text-frost"
    >
      <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
      Manage Users
    </Link>
  );
}

export function UserDetailView({ userId }: { userId: string }) {
  const { data, loading, error, refresh } = useAdminQuery<UserDetailPayload>(
    `/api/admin/users/${encodeURIComponent(userId)}`,
  );

  if (data) {
    const { user, settings, spend } = data;
    const label = user.name ?? user.email ?? user.userId.slice(0, 8);
    return (
      <div className="space-y-4">
        {backLink()}
        <AdminPageHeader
          title={label}
          description={
            user.email
              ? `${user.email} · joined ${user.createdAt.slice(0, 10)}${user.activeNow ? " · active now" : ""}`
              : `anonymous ${user.userId.slice(0, 8)} · joined ${user.createdAt.slice(0, 10)}`
          }
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Turns" value={formatCount(user.turns)} />
          <KpiCard label="Boards" value={formatCount(user.boards)} />
          <KpiCard label="Messages" value={formatCount(user.chatMessages)} />
          <KpiCard
            label="Spend this period"
            value={user.spendMillicents == null ? "—" : formatMillicentsUsd(user.spendMillicents)}
            hint="billed AI + voice"
            tone="sky"
          />
          <KpiCard
            label="AI / voice"
            value={data.inference.totalUsd > 0 ? formatUsd(data.inference.totalUsd) : "—"}
            hint={
              data.inference.totalUsd > 0
                ? `${formatUsd(data.inference.llmUsd)} AI · ${formatUsd(data.inference.ttsUsd)} voice${
                    data.inference.truncated ? " · newest 200 boards" : ""
                  }`
                : data.inference.configured
                  ? "no traced usage on this user's boards"
                  : "Langfuse not configured"
            }
          />
          <KpiCard
            label="Last turn"
            value={user.lastTurnAt ? formatRelativeTime(user.lastTurnAt) : "never"}
            tone={user.activeNow ? "sky" : "default"}
          />
        </div>
        <UserProfileCard user={user} settings={settings} spend={spend} />
        <UserTurns turns={data.turns} />
        <UserBoards boards={data.boards} />
        <UserMessages messages={data.chatMessages} />
      </div>
    );
  }

  if (error === "not_found") {
    return (
      <div className="space-y-4">
        {backLink()}
        <EmptyState
          title="User not found"
          description={`No user with id ${userId.slice(0, 18)} exists (or it was deleted).`}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        {backLink()}
        <EmptyState
          title={error === "unauthorized" ? "Admins only" : "Could not load this user"}
          description="The user detail API did not answer. Try refreshing."
          action={
            <button type="button" onClick={refresh} className="text-xs text-sky-300">
              Try again
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {backLink()}
      <EmptyState title={loading ? "Loading user…" : "—"} />
    </div>
  );
}
