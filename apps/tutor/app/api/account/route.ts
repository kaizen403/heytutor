import { NextResponse } from "next/server";
import { isAuthFailure, requireSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { signOut } from "@/auth";

export async function DELETE() {
  const userId = await requireSessionUserId();
  if (isAuthFailure(userId)) return userId;

  const boards = await prisma.board.findMany({
    where: { userId },
    select: { id: true },
  });

  await prisma.user.delete({ where: { id: userId } });
  await signOut({ redirect: false });

  void (async () => {
    try {
      const { boardAudioPrefix, deletePrefix, userImagePrefix } = await import(
        "@/lib/object-store/s3"
      );
      await deletePrefix(userImagePrefix(userId));
      await Promise.all(boards.map((board) => deletePrefix(boardAudioPrefix(board.id))));
    } catch {
      // best-effort — S3 may not be configured
    }
  })();

  return NextResponse.json({ ok: true });
}
