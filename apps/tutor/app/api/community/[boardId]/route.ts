import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getCommunityBoardCard, readCommunityTurns } from "@/lib/community/queries";
import { requireAdminRequest } from "@/lib/auth/requireAdmin";

interface RouteContext {
  params: Promise<{ boardId: string }>;
}

/**
 * A Community board for the read only player: the card, then its turns a
 * page at a time in the same shape as the owner's board GET. Public.
 */
export async function GET(request: Request, context: RouteContext) {
  const { boardId } = await context.params;
  const page = Number(new URL(request.url).searchParams.get("page") ?? "0");
  if (!Number.isSafeInteger(page) || page < 0 || page > 10_000) {
    return NextResponse.json({ error: "invalid page" }, { status: 400 });
  }
  let card = await getCommunityBoardCard(boardId);
  let adminPreview = false;
  // A board an admin hid stays readable to admins, so it can be reviewed
  // before it is unhidden. Everyone else gets the same 404 as a private board.
  if (!card && (await requireAdminRequest()) === null) {
    card = await getCommunityBoardCard(boardId, { adminPreview: true });
    adminPreview = card != null;
  }
  if (!card) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const { ownerId, ...board } = card;
  const viewerId = await getUserId();
  const { turns, nextPage } = await readCommunityTurns(boardId, page);
  return NextResponse.json({
    nextPage,
    board: { ...board, preview: board.question, isOwner: viewerId === ownerId, adminPreview },
    turns,
  });
}
