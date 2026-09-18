import type { OverviewKpis as OverviewKpisPayload } from "@/lib/admin/types";
import { KpiCard } from "../shared/components/KpiCard";
import { formatCount, formatPercent } from "../shared/lib/format";

const FAIL_RATE_ATTENTION = 0.2;

interface OverviewKpisProps {
  kpis: OverviewKpisPayload;
  validatedTurns7d: number;
}

export function OverviewKpis({ kpis, validatedTurns7d }: OverviewKpisProps) {
  const failTone =
    kpis.failRate7d != null && kpis.failRate7d >= FAIL_RATE_ATTENTION ? "danger" : "default";

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <KpiCard
        label="Users"
        value={formatCount(kpis.usersTotal)}
        hint={`${kpis.usersNew7d} new in 7d`}
      />
      <KpiCard
        label="Active users"
        value={formatCount(kpis.usersActive24h)}
        hint={`${kpis.usersActive7d} in 7d`}
        tone="sky"
      />
      <KpiCard label="Boards" value={formatCount(kpis.boardsTotal)} />
      <KpiCard label="Chat messages" value={formatCount(kpis.chatMessagesTotal)} />
      <KpiCard label="Turns total" value={formatCount(kpis.turnsTotal)} />
      <KpiCard
        label="Turns 24h"
        value={formatCount(kpis.turns24h)}
        hint={`${formatCount(kpis.turns7d)} in 7d · ${formatCount(kpis.turns30d)} in 30d`}
      />
      <KpiCard
        label="Fail rate 7d"
        value={kpis.failRate7d == null ? "—" : formatPercent(kpis.failRate7d)}
        hint="taught without a verified diagram"
        tone={failTone}
      />
      <KpiCard
        label="Verified 7d"
        value={formatCount(validatedTurns7d)}
        hint="turns that committed a diagram"
      />
    </div>
  );
}
