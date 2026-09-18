import { prisma } from "@/lib/db/prisma";
import { billingPeriodKey } from "@/lib/billing/ledgerMath";
import { classifyOutcome, extractArtifactSummary } from "./outcome";
import type {
  AdminUserRow,
  AdminUserSettings,
  UserDetailPayload,
} from "./types";

const BOARDS_TAKE = 50;
const TURNS_TAKE = 50;
const MESSAGES_TAKE = 20;
const MESSAGE_PREVIEW_CHARS = 280;
const ACTIVE_NOW_MS = 5 * 60_000;

export async function userDetail(userId: string): Promise<UserDetailPayload | null> {
  const now = Date.now();
  const [user, turnStats, boardCount, chatCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: {
        settings: true,
        periodSpend: { orderBy: { period: "desc" } },
      },
    }),
    prisma.turn.groupBy({
      by: ["userId"],
      where: { userId },
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    }),
    prisma.board.count({ where: { userId } }),
    prisma.boardChatMessage.count({ where: { userId } }),
  ]);
  if (!user) return null;

  const [boards, turnRows, messageRows] = await Promise.all([
    prisma.board.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: BOARDS_TAKE,
      select: {
        id: true,
        title: true,
        preview: true,
        pinnedAt: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { turns: true } },
      },
    }),
    prisma.turn.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: TURNS_TAKE,
      select: {
        id: true,
        question: true,
        visualStatus: true,
        sceneArtifacts: true,
        createdAt: true,
        boardId: true,
        board: { select: { title: true } },
      },
    }),
    prisma.boardChatMessage.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: MESSAGES_TAKE,
      select: {
        id: true,
        boardId: true,
        role: true,
        content: true,
        createdAt: true,
        board: { select: { title: true } },
      },
    }),
  ]);

  const segmentRows =
    turnRows.length > 0
      ? await prisma.segment.groupBy({
          by: ["turnId"],
          where: { turnId: { in: turnRows.map((turn) => turn.id) } },
          _count: { _all: true },
          _sum: { durationMs: true },
        })
      : [];
  const segmentsByTurn = new Map(
    segmentRows.map((row) => [row.turnId, { count: row._count._all, durationMs: row._sum.durationMs }]),
  );

  const stats = turnStats[0];
  const period = billingPeriodKey(now);
  const currentSpend = user.periodSpend.find((entry) => entry.period === period);
  const lastTurnAt = stats?._max.createdAt ?? null;

  const row: AdminUserRow = {
    userId: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    createdAt: user.createdAt.toISOString(),
    onboardingCompletedAt: user.onboardingCompletedAt?.toISOString() ?? null,
    examGoal: user.examGoal,
    classYear: user.classYear,
    learnerRole: user.learnerRole,
    subjects: user.subjects,
    turns: stats?._count._all ?? 0,
    boards: boardCount,
    chatMessages: chatCount,
    firstTurnAt: stats?._min.createdAt?.toISOString() ?? null,
    lastTurnAt: lastTurnAt?.toISOString() ?? null,
    activeNow: lastTurnAt != null && now - lastTurnAt.getTime() <= ACTIVE_NOW_MS,
    spendMillicents: currentSpend?.spentMillicents ?? null,
  };

  const settings: AdminUserSettings | null = user.settings
    ? {
        fastMode: user.settings.fastMode,
        narrationEnabled: user.settings.narrationEnabled,
        audioLanguage: user.settings.audioLanguage,
        accent: user.settings.accent,
        uiLanguage: user.settings.uiLanguage,
        speedMultiplier: user.settings.speedMultiplier,
        teachingNote: user.settings.teachingNote,
      }
    : null;

  return {
    user: row,
    settings,
    boards: boards.map((board) => ({
      boardId: board.id,
      title: board.title,
      preview: board.preview,
      pinned: board.pinnedAt != null,
      archived: board.archivedAt != null,
      createdAt: board.createdAt.toISOString(),
      updatedAt: board.updatedAt.toISOString(),
      turns: board._count.turns,
    })),
    turns: turnRows.map((turn) => {
      const summary = extractArtifactSummary(turn.sceneArtifacts);
      const segments = segmentsByTurn.get(turn.id);
      return {
        turnId: turn.id,
        question: turn.question,
        outcome: classifyOutcome(turn.visualStatus),
        tier: summary?.representationTier ?? null,
        degradationReason: summary?.degradationReason ?? null,
        issueCodes: summary?.issueCodes ?? [],
        boardId: turn.boardId,
        boardTitle: turn.board?.title ?? "—",
        createdAt: turn.createdAt.toISOString(),
        segmentCount: segments?.count ?? 0,
        narratedMs: segments?.durationMs ?? null,
      };
    }),
    chatMessages: messageRows.map((message) => ({
      id: message.id,
      boardId: message.boardId,
      boardTitle: message.board?.title ?? "—",
      role: message.role,
      content: message.content.slice(0, MESSAGE_PREVIEW_CHARS),
      createdAt: message.createdAt.toISOString(),
    })),
    spend: user.periodSpend.map((entry) => ({
      period: entry.period,
      spentMillicents: entry.spentMillicents,
      bonusMillicents: entry.bonusMillicents,
    })),
  };
}
