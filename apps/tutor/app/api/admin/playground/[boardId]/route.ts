import { requireAdminRequest } from "@/lib/auth/requireAdmin";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { readBoundedJson, RequestBodyError } from "@/lib/http/requestBody";
import { inspectPlaygroundLecture, parsePlaygroundLecture, parsePlaygroundReview } from "@/lib/admin/playgroundLecture";

export async function PATCH(request: Request, context: { params: Promise<{ boardId: string }> }) {
  const denied = await requireAdminRequest();
  if (denied) return denied;
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { boardId } = await context.params;
  let body: { action?: string; meta?: unknown; review?: unknown };
  try {
    body = await readBoundedJson(request, 8 * 1024);
  } catch (error) {
    return Response.json({ error: "invalid request" }, { status: error instanceof RequestBodyError ? error.status : 400 });
  }
  if (!body || !["inspect", "complete", "discard", "review"].includes(body.action ?? "")) {
    return Response.json({ error: "invalid action" }, { status: 400 });
  }
  // Serialize every metadata mutation on this board. Inspect must not overwrite a
  // review saved while it reads turns, and review must not revive a discarded run.
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM boards WHERE id = ${boardId} AND user_id = ${userId} FOR UPDATE`;
    const board = await tx.board.findFirst({ where: { id: boardId, userId } });
    if (!board) return Response.json({ error: "not found" }, { status: 404 });
    const stored = parsePlaygroundLecture(board.playground);
    // Older playground identities lived only in this browser. Adopt those once.
    const meta = stored ?? (body.action === "inspect" ? parsePlaygroundLecture(body.meta) : null);
    if (!meta) return Response.json({ error: "not a playground lecture" }, { status: 400 });
    let reason: string | undefined;
    let next = { ...meta };
    if (body.action === "review") {
      const review = parsePlaygroundReview(body.review);
      if (!review || meta.state !== "complete") return Response.json({ error: "a review needs a complete lecture" }, { status: 400 });
      next.review = review;
    } else if (body.action === "discard") {
      next = { ...meta, state: "discarded", figure: undefined, review: undefined };
    } else if (meta.state !== "discarded") {
      const turns = await tx.turn.findMany({
        where: { boardId },
        select: {
          status: true, kind: true, rawResponse: true, visualStatus: true, updatedAt: true,
          segments: { select: { narration: true, spokenText: true, audioUrl: true, durationMs: true, command: true } },
        },
      });
      const inspection = inspectPlaygroundLecture(turns);
      // Inspection after a reload must not discard a run still owned by another tab.
      const recent = Date.now() - board.createdAt.getTime() < 10 * 60_000
        || turns.some(turn => turn.status === "live" && Date.now() - turn.updatedAt.getTime() < 120_000);
      if (body.action === "inspect" && recent && (!turns.length || turns.some(turn => turn.status === "live"))) {
        next = { ...meta, state: "running" };
      } else if (inspection.complete) {
        next = { ...meta, state: "complete", figure: inspection.figure, checkedUpdatedAt: board.updatedAt.getTime() };
      } else {
        reason = inspection.reason;
        next = { ...meta, state: "discarded", figure: undefined, review: undefined };
      }
    }
    // JSON roundtrip strips absent optional fields before writing Prisma JSON.
    await tx.board.update({ where: { id: boardId }, data: { playground: JSON.parse(JSON.stringify(next)) } });
    return Response.json({ playground: next, reason });
  });
}
