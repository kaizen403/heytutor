import type { PrismaClient } from "@prisma/client";

export type MergeAnonymousResult =
  | { status: "skipped"; reason: "same_user" | "missing_anonymous" | "signed_in_missing" }
  | { status: "merged"; anonymousUserId: string; signedInUserId: string; boards: number; turns: number; messages: number };

/**
 * First login on a browser that already has `htutor_uid` boards: move those
 * rows onto the signed-in student, then drop the anonymous user.
 */
export async function mergeAnonymousUser(
  prisma: PrismaClient,
  input: { anonymousUserId: string | null | undefined; signedInUserId: string },
): Promise<MergeAnonymousResult> {
  const anonymousUserId = input.anonymousUserId?.trim() || null;
  const signedInUserId = input.signedInUserId.trim();
  if (!anonymousUserId) {
    return { status: "skipped", reason: "missing_anonymous" };
  }
  if (!signedInUserId) {
    return { status: "skipped", reason: "signed_in_missing" };
  }
  if (anonymousUserId === signedInUserId) {
    return { status: "skipped", reason: "same_user" };
  }

  const [anonymous, signedIn] = await Promise.all([
    prisma.user.findUnique({
      where: { id: anonymousUserId },
      select: { id: true, email: true },
    }),
    prisma.user.findUnique({
      where: { id: signedInUserId },
      select: { id: true },
    }),
  ]);

  if (!anonymous || anonymous.email) {
    return { status: "skipped", reason: "missing_anonymous" };
  }
  if (!signedIn) {
    return { status: "skipped", reason: "signed_in_missing" };
  }

  const [boards, turns, messages] = await prisma.$transaction(async (tx) => {
    const movedBoards = await tx.board.updateMany({
      where: { userId: anonymousUserId },
      data: { userId: signedInUserId },
    });
    const movedTurns = await tx.turn.updateMany({
      where: { userId: anonymousUserId },
      data: { userId: signedInUserId },
    });
    const movedMessages = await tx.boardChatMessage.updateMany({
      where: { userId: anonymousUserId },
      data: { userId: signedInUserId },
    });
    await tx.user.delete({ where: { id: anonymousUserId } });
    return [movedBoards.count, movedTurns.count, movedMessages.count] as const;
  });

  return {
    status: "merged",
    anonymousUserId,
    signedInUserId,
    boards,
    turns,
    messages,
  };
}

export function shouldAttemptCookieMerge(
  anonymousUserId: string | null | undefined,
  signedInUserId: string | null | undefined,
): boolean {
  return Boolean(
    anonymousUserId &&
      signedInUserId &&
      anonymousUserId !== signedInUserId,
  );
}
