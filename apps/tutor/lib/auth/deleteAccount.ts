import { prisma } from "../db/prisma";
import { releaseTurnGrant } from "../billing/grant";
import { revokeWsTickets } from "../tts/wsTicket";
import { retainIdentityUsage } from "./abuseIdentity";
import { enqueueObjectDeletion } from "../object-store/deletionJobs";
import { boardAudioPrefix, userImagePrefix } from "../object-store/keys";

/** All account-deletion paths retain the allowance floor and revoke live access. */
export async function deleteAuthenticatedAccount(userId: string): Promise<void> {
  await prisma.$transaction(async tx => {
    // Same row lock as paid usage admission: no reservation can be created
    // between reading the consumed floor and deleting its ledger.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const ownedBoards = await tx.board.findMany({ where: { userId }, select: { id: true } });
    await retainIdentityUsage(tx, user);
    // Receipts survive the user cascade. If enqueue fails the account remains,
    // so private objects cannot silently lose their only cleanup path.
    await enqueueObjectDeletion({ prefix: userImagePrefix(userId), userId }, tx);
    for (const board of ownedBoards) {
      await enqueueObjectDeletion({ prefix: boardAudioPrefix(board.id), userId }, tx);
    }
    await tx.user.delete({ where: { id: userId } });
  });
  releaseTurnGrant(userId);
  revokeWsTickets(userId);
}
