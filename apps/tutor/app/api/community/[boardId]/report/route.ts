import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { readBoundedJson, RequestBodyError } from "@/lib/http/requestBody";
import { communityBoardWhere } from "@/lib/community/queries";

interface RouteContext {
  params: Promise<{ boardId: string }>;
}

const REASONS = new Set(["wrong", "inappropriate", "personal_info", "spam", "other"]);

/** Anyone may flag a Community board; admins read the reports. */
export async function POST(request: Request, context: RouteContext) {
  const { boardId } = await context.params;
  let body: { reason?: unknown } = {};
  try {
    body = await readBoundedJson(request, 4 * 1024);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid json" },
      { status: error instanceof RequestBodyError ? error.status : 400 });
  }
  const reason = typeof body?.reason === "string" && REASONS.has(body.reason) ? body.reason : null;
  if (!reason) {
    return NextResponse.json({ error: "invalid reason" }, { status: 400 });
  }
  const board = await prisma.board.findFirst({ where: communityBoardWhere({ id: boardId }), select: { id: true } });
  if (!board) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await prisma.communityReport.create({ data: { boardId, reporterId: await getUserId(), reason } });
  return NextResponse.json({ ok: true });
}
