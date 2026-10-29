/** Admin reads and actions behind Community moderation. Admin only: shows real account emails. */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { communityBoardWhere } from "@/lib/community/queries";

export type AdminCommunityFilter = "reported" | "live" | "featured" | "hidden";

export function parseAdminCommunityFilter(value: unknown): AdminCommunityFilter {
  return value === "live" || value === "featured" || value === "hidden" ? value : "reported";
}

export interface AdminCommunityRow {
  id: string;
  title: string;
  ownerEmail: string | null;
  ownerName: string | null;
  ownerHandle: string | null;
  visibility: string;
  /** Whether a stranger can see it right now. */
  onCommunity: boolean;
  hiddenAt: string | null;
  featuredAt: string | null;
  viewCount: number;
  remixCount: number;
  reportCount: number;
  reasons: Record<string, number>;
  lastReportAt: string | null;
  createdAt: string;
}

export interface AdminCommunityPage {
  rows: AdminCommunityRow[];
  total: number;
  page: number;
  pageSize: number;
}

function filterWhere(filter: AdminCommunityFilter, query: string): Prisma.BoardWhereInput {
  const needle = query.trim().slice(0, 100);
  const search: Prisma.BoardWhereInput = needle
    ? {
        OR: [
          { title: { contains: needle, mode: "insensitive" } },
          { user: { email: { contains: needle, mode: "insensitive" } } },
          { user: { handle: { contains: needle.replace(/^@/, ""), mode: "insensitive" } } },
        ],
      }
    : {};
  if (filter === "reported") return { ...search, reports: { some: {} } };
  if (filter === "featured") return { ...search, featuredAt: { not: null } };
  if (filter === "hidden") return { ...search, communityHiddenAt: { not: null } };
  return communityBoardWhere(search);
}

export async function listAdminCommunityBoards(input: {
  filter: AdminCommunityFilter;
  query: string;
  page: number;
  pageSize: number;
}): Promise<AdminCommunityPage> {
  const where = filterWhere(input.filter, input.query);
  const orderBy: Prisma.BoardOrderByWithRelationInput[] =
    input.filter === "featured" ? [{ featuredAt: "desc" }]
      : input.filter === "hidden" ? [{ communityHiddenAt: "desc" }]
        : input.filter === "reported" ? [{ reports: { _count: "desc" } }, { createdAt: "desc" }]
          : [{ createdAt: "desc" }];
  const [total, boards] = await Promise.all([
    prisma.board.count({ where }),
    prisma.board.findMany({
      where,
      orderBy: [...orderBy, { id: "asc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        title: true,
        visibility: true,
        communityHiddenAt: true,
        featuredAt: true,
        viewCount: true,
        remixCount: true,
        createdAt: true,
        user: { select: { email: true, name: true, handle: true } },
        reports: { orderBy: { createdAt: "desc" }, take: 200, select: { reason: true, createdAt: true } },
        _count: { select: { reports: true } },
      },
    }),
  ]);
  const visible = new Set(
    boards.length > 0
      ? (await prisma.board.findMany({ where: communityBoardWhere({ id: { in: boards.map((board) => board.id) } }), select: { id: true } })).map((board) => board.id)
      : [],
  );
  return {
    total,
    page: input.page,
    pageSize: input.pageSize,
    rows: boards.map((board) => {
      const reasons: Record<string, number> = {};
      for (const report of board.reports) reasons[report.reason] = (reasons[report.reason] ?? 0) + 1;
      return {
        id: board.id,
        title: board.title,
        ownerEmail: board.user.email,
        ownerName: board.user.name,
        ownerHandle: board.user.handle,
        visibility: board.visibility,
        onCommunity: visible.has(board.id),
        hiddenAt: board.communityHiddenAt?.toISOString() ?? null,
        featuredAt: board.featuredAt?.toISOString() ?? null,
        viewCount: board.viewCount,
        remixCount: board.remixCount,
        reportCount: board._count.reports,
        reasons,
        lastReportAt: board.reports[0]?.createdAt.toISOString() ?? null,
        createdAt: board.createdAt.toISOString(),
      };
    }),
  };
}

export interface AdminCommunityAction {
  hidden?: boolean;
  featured?: boolean;
  clearReports?: boolean;
}

/** Hide, feature, or clear reports. Returns false when the board does not exist. */
export async function applyAdminCommunityAction(boardId: string, action: AdminCommunityAction): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const board = await tx.board.findUnique({ where: { id: boardId }, select: { id: true, communityHiddenAt: true, featuredAt: true } });
    if (!board) return false;
    const data: Prisma.BoardUpdateInput = {};
    if (typeof action.hidden === "boolean") {
      data.communityHiddenAt = action.hidden ? (board.communityHiddenAt ?? new Date()) : null;
      // A hidden board is not featured; featuring it again is a separate choice.
      if (action.hidden) data.featuredAt = null;
    }
    if (typeof action.featured === "boolean" && !(action.hidden === true)) {
      data.featuredAt = action.featured ? (board.featuredAt ?? new Date()) : null;
    }
    if (Object.keys(data).length > 0) await tx.board.update({ where: { id: boardId }, data });
    if (action.clearReports) await tx.communityReport.deleteMany({ where: { boardId } });
    return true;
  });
}
