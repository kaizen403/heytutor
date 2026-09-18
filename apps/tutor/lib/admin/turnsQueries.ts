import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { readLangfuseQueryCredentials } from "@/lib/obs/langfuseQuery";
import { classifyOutcome, extractArtifactSummary } from "./outcome";
import { userLabel } from "./labels";
import { failedTurnWhere } from "./turnFilters";
import type { AdminTurnRow, TurnsOutcomeFilter, TurnsPagePayload } from "./types";

const DAY_MS = 86_400_000;
const MAX_DAYS = 365;

export interface ListTurnsInput {
  outcome?: TurnsOutcomeFilter;
  userId?: string;
  boardId?: string;
  query?: string;
  days?: number;
  page?: number;
  pageSize?: number;
}

function langfuseTraceBase(): string | null {
  const credentials = readLangfuseQueryCredentials();
  return credentials ? `${credentials.host}/trace/` : null;
}

export async function listTurns(input: ListTurnsInput): Promise<TurnsPagePayload> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 25)));
  const outcome: TurnsOutcomeFilter = input.outcome ?? "all";
  const trimmedQuery = input.query?.trim() ?? "";

  const where: Prisma.TurnWhereInput = {};
  if (outcome === "validated") {
    where.visualStatus = "validated";
  } else if (outcome === "failed") {
    Object.assign(where, failedTurnWhere());
  }
  if (input.userId && input.userId.trim()) {
    where.userId = input.userId.trim();
  }
  if (input.boardId && input.boardId.trim()) {
    where.boardId = input.boardId.trim();
  }
  if (trimmedQuery) {
    where.question = { contains: trimmedQuery, mode: "insensitive" };
  }
  if (input.days != null && input.days > 0) {
    where.createdAt = { gte: new Date(Date.now() - Math.min(input.days, MAX_DAYS) * DAY_MS) };
  }

  const [total, rows] = await Promise.all([
    prisma.turn.count({ where }),
    prisma.turn.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        question: true,
        visualStatus: true,
        sceneArtifacts: true,
        sceneEngineVersion: true,
        traceId: true,
        createdAt: true,
        userId: true,
        user: { select: { name: true, email: true } },
        boardId: true,
        board: { select: { title: true } },
      },
    }),
  ]);

  const traceBase = langfuseTraceBase();
  const turns: AdminTurnRow[] = rows.map((row) => {
    const summary = extractArtifactSummary(row.sceneArtifacts);
    return {
      turnId: row.id,
      question: row.question,
      outcome: classifyOutcome(row.visualStatus),
      tier: summary?.representationTier ?? null,
      degradationReason: summary?.degradationReason ?? null,
      issueCodes: summary?.issueCodes ?? [],
      candidateCount: summary?.candidateCount ?? null,
      sceneEngineVersion: row.sceneEngineVersion,
      traceId: row.traceId,
      traceUrl: row.traceId && traceBase ? `${traceBase}${row.traceId}` : null,
      userId: row.userId,
      userLabel: userLabel({
        userId: row.userId,
        name: row.user?.name ?? null,
        email: row.user?.email ?? null,
      }),
      boardId: row.boardId,
      boardTitle: row.board?.title ?? "—",
      createdAt: row.createdAt.toISOString(),
    };
  });

  return {
    turns,
    total,
    page,
    pageSize,
    outcome,
    userId: input.userId?.trim() || null,
    query: trimmedQuery,
    days: input.days ?? null,
  };
}
