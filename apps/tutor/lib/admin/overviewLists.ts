import { prisma } from "@/lib/db/prisma";
import { classifyOutcome, extractArtifactSummary } from "./outcome";
import { userLabel } from "./labels";
import type {
  OverviewLatestTurn,
  OverviewTopBoard,
  OverviewTopUser,
} from "./types";

const LATEST_TURNS = 8;
const TOP_COUNT = 5;

export interface OverviewLists {
  latestTurns: OverviewLatestTurn[];
  topUsers7d: OverviewTopUser[];
  topBoards7d: OverviewTopBoard[];
}

export async function fetchOverviewLists(windows: {
  weekAgo: Date;
}): Promise<OverviewLists> {
  const [latestRows, userRows, boardRows] = await Promise.all([
    prisma.turn.findMany({
      orderBy: { createdAt: "desc" },
      take: LATEST_TURNS,
      select: {
        id: true,
        question: true,
        visualStatus: true,
        sceneArtifacts: true,
        createdAt: true,
        userId: true,
        user: { select: { name: true, email: true } },
        board: { select: { title: true } },
      },
    }),
    prisma.turn.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: windows.weekAgo } },
      _count: { _all: true },
      orderBy: { _count: { userId: "desc" } },
      take: TOP_COUNT,
    }),
    prisma.turn.groupBy({
      by: ["boardId"],
      where: { createdAt: { gte: windows.weekAgo } },
      _count: { _all: true },
      orderBy: { _count: { boardId: "desc" } },
      take: TOP_COUNT,
    }),
  ]);

  const topUserIds = userRows.map((row) => row.userId);
  const topBoardIds = boardRows.map((row) => row.boardId);
  const [labelRows, boardDetailRows] = await Promise.all([
    topUserIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: topUserIds } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
    topBoardIds.length > 0
      ? prisma.board.findMany({
          where: { id: { in: topBoardIds } },
          select: {
            id: true,
            title: true,
            userId: true,
            user: { select: { name: true, email: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const labelsById = new Map(
    labelRows.map((user) => [
      user.id,
      userLabel({ userId: user.id, name: user.name, email: user.email }),
    ]),
  );
  const boardsById = new Map(boardDetailRows.map((board) => [board.id, board]));

  const latestTurns: OverviewLatestTurn[] = latestRows.map((turn) => ({
    turnId: turn.id,
    question: turn.question,
    outcome: classifyOutcome(turn.visualStatus),
    tier: extractArtifactSummary(turn.sceneArtifacts)?.representationTier ?? null,
    userLabel: userLabel({
      userId: turn.userId,
      name: turn.user?.name ?? null,
      email: turn.user?.email ?? null,
    }),
    boardTitle: turn.board?.title ?? "—",
    createdAt: turn.createdAt.toISOString(),
  }));

  const topUsers7d: OverviewTopUser[] = userRows.map((row) => ({
    userId: row.userId,
    label: labelsById.get(row.userId) ?? row.userId.slice(0, 8),
    turns: row._count._all,
  }));

  const topBoards7d: OverviewTopBoard[] = boardRows.flatMap((row) => {
    const board = boardsById.get(row.boardId);
    if (!board) return [];
    return [
      {
        boardId: row.boardId,
        title: board.title,
        userId: board.userId,
        userLabel: userLabel({
          userId: board.userId,
          name: board.user?.name ?? null,
          email: board.user?.email ?? null,
        }),
        turns: row._count._all,
      },
    ];
  });

  return { latestTurns, topUsers7d, topBoards7d };
}
