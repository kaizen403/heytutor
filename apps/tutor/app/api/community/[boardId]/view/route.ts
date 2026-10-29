import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { communityBoardWhere, recordCommunityView } from "@/lib/community/queries";
import { communityViews, visitorKey } from "@/lib/community/abuseGuards";
import { clientIpFromForwarded } from "@/lib/http/ipRateLimit";

interface RouteContext {
  params: Promise<{ boardId: string }>;
}

/**
 * One view per visit. The page sends this once per browser tab session, so
 * a reload, a crawler, or the player's own page reads do not count, and the
 * owner watching their own board never does.
 */
export async function POST(request: Request, context: RouteContext) {
  const { boardId } = await context.params;
  const board = await prisma.board.findFirst({ where: communityBoardWhere({ id: boardId }), select: { userId: true } });
  if (!board) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const viewerId = await getUserId();
  // The tab's own once-per-visit check is a courtesy; this one is the rule.
  if (viewerId !== board.userId && communityViews.claim(`${visitorKey(viewerId, request, clientIpFromForwarded)}:${boardId}`)) {
    recordCommunityView(boardId);
  }
  return NextResponse.json({ ok: true });
}
