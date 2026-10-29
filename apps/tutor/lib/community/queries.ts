/** Server reads behind Community. Every public read goes through `communityBoardWhere`. */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { inferBoardSubject } from "@/lib/account/progress";
import { parseStoredObjectKey } from "@/lib/object-store/keys";
import type { SubjectId } from "@/lib/account/types";
import {
  COMMUNITY_AGE_BANDS,
  communityAuthor,
  communitySubject,
  communityThumbnailUrl,
  isCommunityTurnShown,
  toCommunityTurn,
  type CommunityCard,
  type CommunitySort,
} from "./publicBoard";

export const COMMUNITY_PAGE_SIZE = 24;
const COMMUNITY_TURN_PAGE_SIZE = 10;

/**
 * A board a stranger may see: public, not hidden by an admin, its owner not a
 * child, and at least one finished lesson with steps on it.
 */
export function communityBoardWhere(extra: Prisma.BoardWhereInput = {}): Prisma.BoardWhereInput {
  return {
    ...extra,
    visibility: "public",
    communityHiddenAt: null,
    // An account that never told us its age band is treated like a child's.
    user: { ageBand: { in: COMMUNITY_AGE_BANDS } },
    turns: { some: { status: "complete", segments: { some: {} } } },
  };
}

const CARD_SELECT = {
  id: true,
  title: true,
  preview: true,
  createdAt: true,
  viewCount: true,
  remixCount: true,
  featuredAt: true,
  thumbnailAt: true,
  user: { select: { handle: true, name: true, ageBand: true } },
  // The first lesson a stranger can actually watch, not a failed or live one.
  turns: {
    where: { status: { in: ["complete", "stopped"] }, segments: { some: {} } },
    orderBy: { orderIndex: "asc" },
    take: 1,
    select: { question: true },
  },
} satisfies Prisma.BoardSelect;

type CardRow = Prisma.BoardGetPayload<{ select: typeof CARD_SELECT }>;

function toCard(row: CardRow): CommunityCard {
  const question = row.turns[0]?.question ?? row.preview;
  return {
    id: row.id,
    title: row.title,
    question: question.slice(0, 280),
    subject: communitySubject(row.title, question, (text) => inferBoardSubject(text, "", [])),
    author: communityAuthor(row.user),
    createdAt: row.createdAt.getTime(),
    viewCount: row.viewCount,
    remixCount: row.remixCount,
    featured: row.featuredAt != null,
    thumbnailUrl: communityThumbnailUrl(row.id, row.thumbnailAt),
  };
}

function searchWhere(query: string): Prisma.BoardWhereInput {
  const needle = query.trim().slice(0, 100);
  if (!needle) return {};
  return {
    // Titles only: the preview can hold the question of a turn Community hides.
    title: { contains: needle, mode: "insensitive" },
  };
}

/** The newest boards a ranking or filter looks at. Bounds every gallery request. */
const COMMUNITY_SCAN_LIMIT = 2_000;

async function orderedCommunityIds(where: Prisma.BoardWhereInput, sort: CommunitySort): Promise<string[]> {
  if (sort !== "trending") {
    const rows = await prisma.board.findMany({
      where,
      orderBy: sort === "featured" ? [{ featuredAt: "desc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "asc" }],
      take: COMMUNITY_SCAN_LIMIT,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
  // Views and remixes, decayed by age, so a week old hit gives way to new
  // work. The ranking needs arithmetic Prisma cannot order by, so the ids
  // come from SQL over the same visible set.
  const visible = await prisma.board.findMany({ where, orderBy: { createdAt: "desc" }, take: COMMUNITY_SCAN_LIMIT, select: { id: true } });
  if (visible.length === 0) return [];
  const ranked = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM boards
    WHERE id IN (${Prisma.join(visible.map((board) => board.id))})
    ORDER BY (view_count + 4 * remix_count + 1)
      / POWER(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 + 2, 1.5) DESC, id ASC
  `;
  return ranked.map((row) => row.id);
}

export async function listCommunityBoards(input: { sort: CommunitySort; page: number; query: string; subject: SubjectId | null }) {
  const where = communityBoardWhere({
    ...searchWhere(input.query),
    ...(input.sort === "featured" ? { featuredAt: { not: null } } : {}),
  });
  let ids = await orderedCommunityIds(where, input.sort);
  if (input.subject) {
    // The subject is read from the title and first question, not stored, so
    // the filter runs here over the whole scanned set, never one page of it.
    const rows = await prisma.board.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, preview: true, turns: CARD_SELECT.turns },
    });
    const matching = new Set(rows
      .filter((row) => communitySubject(row.title, row.turns[0]?.question ?? row.preview, (text) => inferBoardSubject(text, "", [])) === input.subject)
      .map((row) => row.id));
    ids = ids.filter((id) => matching.has(id));
  }
  const pageIds = ids.slice(input.page * COMMUNITY_PAGE_SIZE, (input.page + 1) * COMMUNITY_PAGE_SIZE);
  const order = new Map(pageIds.map((id, index) => [id, index]));
  const rows = pageIds.length > 0
    ? (await prisma.board.findMany({ where: { id: { in: pageIds } }, select: CARD_SELECT }))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    : [];
  return {
    boards: rows.map(toCard),
    nextPage: ids.length > (input.page + 1) * COMMUNITY_PAGE_SIZE ? input.page + 1 : null,
  };
}

export async function getCommunityBoardCard(boardId: string): Promise<(CommunityCard & { ownerId: string }) | null> {
  const row = await prisma.board.findFirst({
    where: communityBoardWhere({ id: boardId }),
    select: { ...CARD_SELECT, userId: true },
  });
  return row ? { ...toCard(row), ownerId: row.userId } : null;
}

/** The turns a stranger may watch, one page at a time, as the player reads them. */
export async function readCommunityTurns(boardId: string, page: number) {
  const rows = await prisma.turn.findMany({
    where: { boardId, segments: { some: {} } },
    orderBy: { orderIndex: "asc" },
    skip: page * COMMUNITY_TURN_PAGE_SIZE,
    take: COMMUNITY_TURN_PAGE_SIZE + 1,
    omit: {
      submittedSegments: true,
      resumeState: true,
      traceId: true,
      sentryEventId: true,
      sentryFailureEvent: true,
      sentryReportedAt: true,
      sentryNextAttemptAt: true,
      idempotencyKey: true,
    },
    include: { _count: { select: { segments: true } } },
  });
  const pageRows = rows.slice(0, COMMUNITY_TURN_PAGE_SIZE)
    .filter((turn) => isCommunityTurnShown({ status: turn.status, segmentCount: turn._count.segments }));
  const segments = pageRows.length > 0
    ? await prisma.segment.findMany({ where: { turnId: { in: pageRows.map((turn) => turn.id) } }, orderBy: { orderIndex: "asc" } })
    : [];
  const byTurn = new Map<string, typeof segments>();
  for (const segment of segments) {
    const list = byTurn.get(segment.turnId) ?? [];
    list.push(segment);
    byTurn.set(segment.turnId, list);
  }
  return {
    turns: pageRows.map((turn) => toCommunityTurn(turn, byTurn.get(turn.id) ?? [])),
    nextPage: rows.length > COMMUNITY_TURN_PAGE_SIZE ? page + 1 : null,
  };
}

/**
 * Whether anyone, signed in or not, may play this stored object: a lecture
 * clip of a turn Community shows. Question photos are never public.
 */
export async function canReadCommunityObject(key: string): Promise<boolean> {
  const parsed = parseStoredObjectKey(key);
  if (!parsed || parsed.kind !== "lecture") return false;
  const board = await prisma.board.findFirst({ where: communityBoardWhere({ id: parsed.boardId }), select: { id: true } });
  if (!board) return false;
  const turn = await prisma.turn.findFirst({
    where: { id: parsed.turnId, boardId: parsed.boardId },
    select: { status: true, _count: { select: { segments: true } } },
  });
  if (!turn) return false;
  return isCommunityTurnShown({ status: turn.status, segmentCount: turn._count.segments });
}

/** One view per page load. Counted without waiting, and never allowed to fail the read. */
export function recordCommunityView(boardId: string): void {
  void prisma.board.update({ where: { id: boardId }, data: { viewCount: { increment: 1 } } }).catch(() => {});
}
