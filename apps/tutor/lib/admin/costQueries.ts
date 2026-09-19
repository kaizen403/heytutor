import { prisma } from "@/lib/db/prisma";
import { billingPeriodKey } from "@/lib/billing/ledgerMath";
import { fetchRunCostForSessions, fetchRunCostForWindow } from "@/lib/obs/langfuseQuery";
import { previousPeriodKey, recentPeriodKeys } from "./costPeriods";
import { userLabel } from "./labels";
import type {
  OverviewCost,
  OverviewCostPeriod,
  OverviewInference,
  OverviewTopSpender,
} from "./types";

const TOP_SPENDERS = 5;
const SERIES_MONTHS = 6;
const INFERENCE_WINDOW_DAYS = 7;
const USER_BOARD_COST_LIMIT = 20;

function periodStartUtc(period: string): Date {
  return new Date(`${period}-01T00:00:00.000Z`);
}

function emptyInference(configured: boolean, error?: string): OverviewInference {
  return {
    configured,
    windowDays: INFERENCE_WINDOW_DAYS,
    llmUsd: 0,
    ttsUsd: 0,
    totalUsd: 0,
    observations: 0,
    truncated: false,
    error,
  };
}

export async function fetchLedgerCostOverview(nowMs: number = Date.now()): Promise<
  Omit<OverviewCost, "inference7d">
> {
  const period = billingPeriodKey(nowMs);
  const previousPeriod = previousPeriodKey(nowMs);
  const seriesKeys = recentPeriodKeys(SERIES_MONTHS, nowMs);

  const [currentRows, previousRows, seriesRows, topRows, turnsThisPeriod] = await Promise.all([
    prisma.billingPeriodSpend.findMany({
      where: { period },
      select: { userId: true, spentMillicents: true, bonusMillicents: true },
    }),
    prisma.billingPeriodSpend.findMany({
      where: { period: previousPeriod },
      select: { spentMillicents: true },
    }),
    prisma.billingPeriodSpend.groupBy({
      by: ["period"],
      where: { period: { in: seriesKeys } },
      _sum: { spentMillicents: true, bonusMillicents: true },
      _count: { _all: true },
    }),
    prisma.billingPeriodSpend.findMany({
      where: { period, spentMillicents: { gt: 0 } },
      orderBy: { spentMillicents: "desc" },
      take: TOP_SPENDERS,
      select: { userId: true, spentMillicents: true },
    }),
    prisma.turn.count({
      where: { createdAt: { gte: periodStartUtc(period) } },
    }),
  ]);

  const spentMillicents = currentRows.reduce((sum, row) => sum + row.spentMillicents, 0);
  const bonusMillicents = currentRows.reduce((sum, row) => sum + row.bonusMillicents, 0);
  const spendUsers = currentRows.filter((row) => row.spentMillicents > 0).length;
  const previousSpentMillicents = previousRows.reduce((sum, row) => sum + row.spentMillicents, 0);

  const seriesByPeriod = new Map(
    seriesRows.map((row) => [
      row.period,
      {
        spentMillicents: row._sum.spentMillicents ?? 0,
        bonusMillicents: row._sum.bonusMillicents ?? 0,
        users: row._count._all,
      },
    ]),
  );
  const series: OverviewCostPeriod[] = seriesKeys.map((key) => {
    const found = seriesByPeriod.get(key);
    return {
      period: key,
      spentMillicents: found?.spentMillicents ?? 0,
      bonusMillicents: found?.bonusMillicents ?? 0,
      users: found?.users ?? 0,
    };
  });

  const labelRows =
    topRows.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: topRows.map((row) => row.userId) } },
          select: { id: true, name: true, email: true },
        })
      : [];
  const labels = new Map(
    labelRows.map((user) => [
      user.id,
      userLabel({ userId: user.id, name: user.name, email: user.email }),
    ]),
  );
  const topSpenders: OverviewTopSpender[] = topRows.map((row) => ({
    userId: row.userId,
    label: labels.get(row.userId) ?? row.userId.slice(0, 8),
    spentMillicents: row.spentMillicents,
  }));

  return {
    period,
    spentMillicents,
    bonusMillicents,
    spendUsers,
    previousPeriod,
    previousSpentMillicents,
    turnsThisPeriod,
    series,
    topSpenders,
  };
}

export async function fetchInferenceWindow(
  nowMs: number = Date.now(),
): Promise<OverviewInference> {
  const to = new Date(nowMs);
  const from = new Date(nowMs - INFERENCE_WINDOW_DAYS * 86_400_000);
  const result = await fetchRunCostForWindow({ from, to });
  if (!result.configured) return emptyInference(false);
  if (result.error) return emptyInference(true, result.error);
  return {
    configured: true,
    windowDays: INFERENCE_WINDOW_DAYS,
    llmUsd: result.report.totals.llmUsd,
    ttsUsd: result.report.totals.ttsUsd,
    totalUsd: result.report.totals.totalUsd,
    observations: result.report.totals.observations,
    truncated: result.truncated,
    error: undefined,
  };
}

export async function fetchOverviewCost(nowMs: number = Date.now()): Promise<OverviewCost> {
  const [ledger, inference7d] = await Promise.all([
    fetchLedgerCostOverview(nowMs),
    fetchInferenceWindow(nowMs),
  ]);
  return { ...ledger, inference7d };
}

export async function fetchUserInferenceCost(boardIds: readonly string[]): Promise<OverviewInference> {
  const ids = boardIds.filter(Boolean).slice(0, USER_BOARD_COST_LIMIT);
  const result = await fetchRunCostForSessions(ids);
  if (!result.configured) return emptyInference(false);
  if (result.error) return emptyInference(true, result.error);
  return {
    configured: true,
    windowDays: 0,
    llmUsd: result.report.totals.llmUsd,
    ttsUsd: result.report.totals.ttsUsd,
    totalUsd: result.report.totals.totalUsd,
    observations: result.report.totals.observations,
    truncated: boardIds.length > USER_BOARD_COST_LIMIT,
    error: undefined,
  };
}
