import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
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
  return board != null;
}

export async function serveUserObject(userId: string, key: string): Promise<Response> {
  if (!(await userCanReadObject(userId, key))) {
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
