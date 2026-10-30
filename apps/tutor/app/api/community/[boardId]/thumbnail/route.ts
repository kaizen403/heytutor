import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { communityBoardWhere } from "@/lib/community/queries";
import { getBoardThumbnail } from "@/lib/object-store/s3";

interface RouteContext {
  params: Promise<{ boardId: string }>;
}

/** A Community card picture. Served only while the board itself is public. */
export async function GET(_request: Request, context: RouteContext) {
  const { boardId } = await context.params;
  const board = await prisma.board.findFirst({
    where: communityBoardWhere({ id: boardId, thumbnailAt: { not: null } }),
    select: { id: true },
  });
  if (!board) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const object = await getBoardThumbnail(boardId);
  if (!object) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return new NextResponse(object.body, {
    headers: {
      "content-type": "image/webp",
      "x-content-type-options": "nosniff",
      // The URL carries the upload time, so a new picture is a new URL.
      "cache-control": "public, max-age=300",
    },
  });
}
