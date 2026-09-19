import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { billingPeriodKey } from "@/lib/billing/ledgerMath";
import type { AdminUserRow, UserSort, UsersPagePayload } from "./types";

const ACTIVE_NOW_MS = 5 * 60_000;

export interface ListUsersInput {
  query?: string;
  sort?: UserSort;
  page?: number;
  pageSize?: number;
}

interface UserAggregates {
  turns: number;
  boards: number;
  chatMessages: number;
  firstTurnAt: Date | null;
  lastTurnAt: Date | null;
}

function searchFilter(query: string | undefined): Prisma.UserWhereInput | undefined {
  const trimmed = query?.trim();
  if (!trimmed) return undefined;
  return {
    OR: [
      { name: { contains: trimmed, mode: "insensitive" } },
      { email: { contains: trimmed, mode: "insensitive" } },
      { id: { contains: trimmed } },
    ],
  };
}

const SORTERS: Record<UserSort, (a: UserRow, b: UserRow) => number> = {
  recentActivity: (a, b) =>
    (b.aggregates.lastTurnAt?.getTime() ?? 0) - (a.aggregates.lastTurnAt?.getTime() ?? 0) ||
    b.createdAt.getTime() - a.createdAt.getTime(),
  turns: (a, b) => b.aggregates.turns - a.aggregates.turns,
  boards: (a, b) => b.aggregates.boards - a.aggregates.boards,
  messages: (a, b) => b.aggregates.chatMessages - a.aggregates.chatMessages,
  newest: (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  oldest: (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  spend: (a, b) => (b.spendMillicents ?? -1) - (a.spendMillicents ?? -1),
};

interface UserRow {
  userId: string;
  email: string | null;
  name: string | null;
  image: string | null;
  createdAt: Date;
  onboardingCompletedAt: Date | null;
  examGoal: string | null;
  classYear: string | null;
  learnerRole: string | null;
  subjects: string[];
  aggregates: UserAggregates;
  spendMillicents: number | null;
}

function toAdminUserRow(row: UserRow, now: number): AdminUserRow {
  return {
    userId: row.userId,
    email: row.email,
    name: row.name,
    image: row.image,
    createdAt: row.createdAt.toISOString(),
    onboardingCompletedAt: row.onboardingCompletedAt?.toISOString() ?? null,
    examGoal: row.examGoal,
    classYear: row.classYear,
    learnerRole: row.learnerRole,
    subjects: row.subjects,
    turns: row.aggregates.turns,
    boards: row.aggregates.boards,
    chatMessages: row.aggregates.chatMessages,
    firstTurnAt: row.aggregates.firstTurnAt?.toISOString() ?? null,
    lastTurnAt: row.aggregates.lastTurnAt?.toISOString() ?? null,
    activeNow:
      row.aggregates.lastTurnAt != null && now - row.aggregates.lastTurnAt.getTime() <= ACTIVE_NOW_MS,
    spendMillicents: row.spendMillicents,
  };
}

/**
 * One page of users with their activity aggregates. Five fixed queries feed
 * one in-memory merge: user rows, turn stats, board stats, chat stats, and
 * the current period's spend. Sorting happens after the merge because three
 * of the sort keys are aggregate columns Prisma cannot order by.
 */
export async function listUsersWithStats(input: ListUsersInput): Promise<UsersPagePayload> {
  const now = Date.now();
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 25)));
  const sort: UserSort = input.sort ?? "recentActivity";
  const period = billingPeriodKey(now);

  const [userRows, turnRows, boardRows, chatRows, spendRows] = await Promise.all([
    prisma.user.findMany({
      where: searchFilter(input.query),
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        createdAt: true,
        onboardingCompletedAt: true,
        examGoal: true,
        classYear: true,
        learnerRole: true,
        subjects: true,
      },
    }),
    prisma.turn.groupBy({
      by: ["userId"],
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    }),
    prisma.board.groupBy({ by: ["userId"], _count: { _all: true } }),
    prisma.boardChatMessage.groupBy({ by: ["userId"], _count: { _all: true } }),
    prisma.billingPeriodSpend.findMany({
      where: { period },
      select: { userId: true, spentMillicents: true },
    }),
  ]);

  const turnStats = new Map<string, { count: number; first: Date | null; last: Date | null }>();
  for (const row of turnRows) {
    turnStats.set(row.userId, {
      count: row._count._all,
      first: row._min.createdAt ?? null,
      last: row._max.createdAt ?? null,
    });
  }
  const boardStats = new Map(boardRows.map((row) => [row.userId, row._count._all]));
  const chatStats = new Map(chatRows.map((row) => [row.userId, row._count._all]));
  const spendByUser = new Map(spendRows.map((row) => [row.userId, row.spentMillicents]));

  const merged: UserRow[] = userRows.map((user) => {
    const stats = turnStats.get(user.id);
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      createdAt: user.createdAt,
      onboardingCompletedAt: user.onboardingCompletedAt,
      examGoal: user.examGoal,
      classYear: user.classYear,
      learnerRole: user.learnerRole,
      subjects: user.subjects,
      aggregates: {
        turns: stats?.count ?? 0,
        boards: boardStats.get(user.id) ?? 0,
        chatMessages: chatStats.get(user.id) ?? 0,
        firstTurnAt: stats?.first ?? null,
        lastTurnAt: stats?.last ?? null,
      },
      spendMillicents: spendByUser.get(user.id) ?? null,
    };
  });

  merged.sort(SORTERS[sort] ?? SORTERS.recentActivity);
  const total = merged.length;
  const start = (page - 1) * pageSize;
  const pageRows = merged.slice(start, start + pageSize);

  return {
    users: pageRows.map((row) => toAdminUserRow(row, now)),
    total,
    page,
    pageSize,
    period,
  };
}
