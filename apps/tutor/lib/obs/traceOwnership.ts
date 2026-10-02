import { readTraceIdHeader } from "@heytutor/tutor-core";
import { createHash } from "node:crypto";
import { prisma } from "../db/prisma";

const TRACE_OWNERSHIP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function scopedTraceId(userId: string, traceId: string): string {
  return createHash("sha256").update(`heytutor:trace:v1\0${userId}\0${traceId}`).digest("hex");
}

export function scopedSessionId(userId: string, sessionId: string): string {
  return createHash("sha256").update(`heytutor:session:v1\0${userId}\0${sessionId}`).digest("hex");
}

/** Only lesson admission calls this; telemetry never establishes ownership. */
export async function registerOwnedTrace(userId: string, traceId: string): Promise<boolean> {
  if (readTraceIdHeader(traceId) !== traceId) return false;
  const now = new Date();
  await prisma.ownedTrace.createMany({
    data: [{ userId, traceId, expiresAt: new Date(now.getTime() + TRACE_OWNERSHIP_TTL_MS) }],
    skipDuplicates: true,
  });
  await prisma.ownedTrace.deleteMany({ where: { expiresAt: { lte: now } } });
  return assertOwnedTrace(userId, traceId);
}

export async function assertOwnedTrace(userId: string, traceId: string, sessionId?: string): Promise<boolean> {
  if (readTraceIdHeader(traceId) !== traceId) return false;
  const owned = await prisma.ownedTrace.findUnique({ where: { traceId }, select: { userId: true, expiresAt: true } });
  if (!owned || owned.userId !== userId || owned.expiresAt <= new Date()) return false;
  if (sessionId !== undefined) {
    if (readTraceIdHeader(sessionId) !== sessionId) return false;
    const board = await prisma.board.findUnique({ where: { id: sessionId }, select: { userId: true } });
    if (board && board.userId !== userId) return false;
  }
  return true;
}
