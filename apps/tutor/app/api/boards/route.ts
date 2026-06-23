import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ensureUser, getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await ensureUser(userId);

  const rows = await prisma.board.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({
    boards: rows.map((row) => ({
      id: row.id,
      title: row.title,
      preview: row.preview,
      createdAt: row.createdAt.getTime(),
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
    body = (await request.json()) as { id?: string; title?: string };
  } catch {
    // empty body is fine
  }

  const id = body.id ?? crypto.randomUUID();
  const title = body.title?.trim() || "new board";

  const row = await prisma.board
    .create({
      data: {
        id,
        userId,
        title,
        preview: "",
      },
    })
    .catch((error: unknown) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return null;
      }
      throw error;
    });

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
      },
    });
  }

  return NextResponse.json({
    board: {
      id: row.id,
      title: row.title,
      preview: row.preview,
      createdAt: row.createdAt.getTime(),
    },
  });
}
