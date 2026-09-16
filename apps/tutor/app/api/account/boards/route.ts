import { NextResponse } from "next/server";
import { isAuthFailure, requireSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

export async function PATCH(request: Request) {
  const userId = await requireSessionUserId();
  if (isAuthFailure(userId)) return userId;
  let body: { action?: string } = {};
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.action === "archive_all") {
    const result = await prisma.board.updateMany({
      where: { userId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    return NextResponse.json({ ok: true, archived: result.count });
  }
  if (body.action === "delete_all") {
    const boards = await prisma.board.findMany({
      where: { userId },
      select: { id: true },
    });
    const result = await prisma.board.deleteMany({ where: { userId } });
    void (async () => {
      try {
        const { boardAudioPrefix, deletePrefix } = await import("@/lib/object-store/s3");
        await Promise.all(boards.map((board) => deletePrefix(boardAudioPrefix(board.id))));
      } catch {
        // best-effort — S3 may not be configured
      }
    })();
    return NextResponse.json({ ok: true, deleted: result.count });
  }
  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
