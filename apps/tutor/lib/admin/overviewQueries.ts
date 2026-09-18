import { prisma } from "@/lib/db/prisma";
import { fetchOverviewDistributions } from "./overviewDistributions";
import { fetchOverviewLists } from "./overviewLists";
import { bucketCountsByDay, recentDayRange } from "./timeBuckets";
import { failedTurnWhere } from "./turnFilters";
import type { OverviewPayload } from "./types";

const DAY_MS = 86_400_000;
const SERIES_DAYS = 14;

export async function fetchOverview(): Promise<OverviewPayload> {
  const now = Date.now();
  const dayAgo = new Date(now - DAY_MS);
  const weekAgo = new Date(now - 7 * DAY_MS);
  const monthAgo = new Date(now - 30 * DAY_MS);
  // The series starts at the beginning of the oldest UTC day in the range so
  // nothing in that day's early hours is dropped by the bucket filter.
  const seriesStart = new Date(`${recentDayRange(SERIES_DAYS, now)[0]}T00:00:00.000Z`);

  const [
    usersTotal,
    usersNew7d,
    boardsTotal,
    chatMessagesTotal,
    turnsTotal,
    turns24h,
    turns7d,
    turns30d,
    failedTurns7d,
    activeUsers24hRows,
    activeUsers7dRows,
    newUsersProjection,
    turnsProjection,
    distributions,
    lists,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.board.count(),
    prisma.boardChatMessage.count(),
    prisma.turn.count(),
    prisma.turn.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.turn.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.turn.count({ where: { createdAt: { gte: monthAgo } } }),
    prisma.turn.count({ where: failedTurnWhere(weekAgo) }),
    prisma.turn.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: dayAgo } },
      _count: { _all: true },
    }),
    prisma.turn.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: weekAgo } },
      _count: { _all: true },
    }),
    prisma.user.findMany({
      where: { createdAt: { gte: seriesStart } },
      select: { createdAt: true },
    }),
    prisma.turn.findMany({
      where: { createdAt: { gte: seriesStart } },
      select: { createdAt: true },
    }),
    fetchOverviewDistributions({ weekAgo, monthAgo }),
    fetchOverviewLists({ weekAgo }),
  ]);

  return {
    generatedAt: new Date(now).toISOString(),
    kpis: {
      usersTotal,
      usersNew7d,
      usersActive24h: activeUsers24hRows.length,
      usersActive7d: activeUsers7dRows.length,
      boardsTotal,
      chatMessagesTotal,
      turnsTotal,
      turns24h,
      turns7d,
      turns30d,
      failRate7d: turns7d > 0 ? failedTurns7d / turns7d : null,
    },
    turnsPerDay: bucketCountsByDay(
      turnsProjection.map((turn) => turn.createdAt),
      SERIES_DAYS,
      now,
    ),
    newUsersPerDay: bucketCountsByDay(
      newUsersProjection.map((user) => user.createdAt),
      SERIES_DAYS,
      now,
    ),
    outcomesAllTime: distributions.outcomesAllTime,
    outcomes7d: distributions.outcomes7d,
    tiers7d: distributions.tiers7d,
    degradation7d: distributions.degradation7d,
    sceneEngineVersions30d: distributions.sceneEngineVersions30d,
    topUsers7d: lists.topUsers7d,
    topBoards7d: lists.topBoards7d,
    latestTurns: lists.latestTurns,
  };
}
