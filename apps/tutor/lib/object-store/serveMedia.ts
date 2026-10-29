import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { canReadCommunityObject } from "@/lib/community/queries";
import { parseStoredObjectKey } from "./keys";
import { contentDispositionForKey, contentTypeForStoredKey } from "./safeContentType";
import { getObject } from "./s3";

async function userCanReadObject(userId: string, key: string): Promise<boolean> {
  const parsed = parseStoredObjectKey(key);
  if (!parsed) return false;
  if (parsed.kind === "image") {
    return parsed.userId === userId;
  }
  const board = await prisma.board.findFirst({
    where: { id: parsed.boardId, userId },
    select: { id: true },
  });
  if (!board) return false;
  // A caller can supply a draft board ID when creating a board. Ownership of
  // that ID alone must not expose an orphaned object left by a deleted board.
  const turn = await prisma.turn.findFirst({
    where: { id: parsed.turnId, boardId: parsed.boardId, userId },
    select: { id: true },
  });
  return turn != null;
}

/**
 * The owner reads their own objects. Anyone, signed in or not, may also play
 * the lecture clips of a board Community shows; nothing else is public.
 */
export async function serveUserObject(userId: string | null, key: string): Promise<Response> {
  const owned = userId != null && await userCanReadObject(userId, key);
  if (!owned && !(await canReadCommunityObject(key))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const object = await getObject(key);
  if (!object) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return new NextResponse(object.body, {
    headers: {
      "content-type": contentTypeForStoredKey(key),
      "content-disposition": contentDispositionForKey(key),
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=3600",
    },
  });
}
