import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ensureUser, getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { readBoundedJson, RequestBodyError } from "@/lib/http/requestBody";
import { BOARD_PAGE_SIZE, MAX_ACCOUNT_BOARDS, MAX_BOARD_TITLE_CHARS, StorageQuotaError, withUserStorageLock } from "@/lib/boards/storageQuota";

export async function GET(request: Request) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await ensureUser(userId);

  // Pinned first, newest pin on top, then the rest by recency. Archived rows
  // are returned too and filtered client-side, so the archive view costs no
  // extra round trip.
  const page = Number(new URL(request.url).searchParams.get("page") ?? "0");
  if (!Number.isSafeInteger(page) || page < 0 || page > 10_000) {
    return NextResponse.json({ error: "invalid page" }, { status: 400 });
  }
  const rows = await prisma.board.findMany({
    where: { userId },
    orderBy: [{ pinnedAt: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
    skip: page * BOARD_PAGE_SIZE,
    take: BOARD_PAGE_SIZE + 1,
  });

  return NextResponse.json({
    nextPage: rows.length > BOARD_PAGE_SIZE ? page + 1 : null,
    boards: rows.slice(0, BOARD_PAGE_SIZE).map((row) => ({
      id: row.id,
      title: row.title,
      preview: row.preview,
      createdAt: row.createdAt.getTime(),
      pinnedAt: row.pinnedAt?.getTime() ?? null,
      archivedAt: row.archivedAt?.getTime() ?? null,
    })),
  });
}

export async function POST(request: Request) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await ensureUser(userId);

  let body: { id?: string; title?: string } = {};
  try {
    body = await readBoundedJson(request, 16 * 1024);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid json" },
      { status: error instanceof RequestBodyError ? error.status : 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    (body.id !== undefined && (typeof body.id !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(body.id))) ||
    (body.title !== undefined && (typeof body.title !== "string" || body.title.length > MAX_BOARD_TITLE_CHARS))) {
    return NextResponse.json({ error: "invalid board id or title" }, { status: 400 });
  }

  const id = body.id ?? crypto.randomUUID();
  const title = body.title?.trim() || "new board";

  let quotaError: StorageQuotaError | null = null;
  const row = await withUserStorageLock(userId, async (tx) => {
    const existing = await tx.board.findFirst({ where: { id, userId } });
    if (existing) return existing;
    const deletion = await tx.objectDeletionJob.findUnique({ where: { prefix: `lectures/${id}/` } });
    if (deletion) throw new StorageQuotaError("board deletion cleanup is still pending", 409);
    if (await tx.board.count({ where: { userId } }) >= MAX_ACCOUNT_BOARDS) {
      throw new StorageQuotaError("board storage quota exceeded", 429);
    }
    return tx.board.create({ data: { id, userId, title, preview: "" } });
  })
    .catch((error: unknown) => {
      if (error instanceof StorageQuotaError) { quotaError = error; return null; }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return null;
      }
      throw error;
    });

  if (quotaError) {
    return NextResponse.json({ error: (quotaError as StorageQuotaError).message }, { status: (quotaError as StorageQuotaError).status });
  }

  if (!row) {
    const existing = await prisma.board.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return NextResponse.json({ error: "board id taken" }, { status: 409 });
    }

    return NextResponse.json({
      board: {
        id: existing.id,
        title: existing.title,
        preview: existing.preview,
        createdAt: existing.createdAt.getTime(),
        pinnedAt: existing.pinnedAt?.getTime() ?? null,
        archivedAt: existing.archivedAt?.getTime() ?? null,
      },
    });
  }

  return NextResponse.json({
    board: {
      id: row.id,
      title: row.title,
      preview: row.preview,
      createdAt: row.createdAt.getTime(),
      pinnedAt: row.pinnedAt?.getTime() ?? null,
      archivedAt: row.archivedAt?.getTime() ?? null,
    },
  });
}
