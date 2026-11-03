import { NextResponse } from "next/server";
import { ensureUser, getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { readBoundedBody, RequestBodyError } from "@/lib/http/requestBody";
import { putBoardThumbnail } from "@/lib/object-store/s3";

interface RouteContext {
  params: Promise<{ boardId: string }>;
}

const MAX_THUMBNAIL_BYTES = 256 * 1024;

function isWebp(bytes: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  return bytes.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
}

/** The owner's tab uploads the finished board as the Community card picture. */
export async function PUT(request: Request, context: RouteContext) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await ensureUser(userId);
  const { boardId } = await context.params;
  const board = await prisma.board.findFirst({ where: { id: boardId, userId }, select: { id: true } });
  if (!board) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(request, MAX_THUMBNAIL_BYTES);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid body" },
      { status: error instanceof RequestBodyError ? error.status : 400 });
  }
  if (!isWebp(bytes)) {
    return NextResponse.json({ error: "thumbnail must be webp" }, { status: 415 });
  }
  if (!(await putBoardThumbnail(boardId, bytes))) {
    return NextResponse.json({ error: "thumbnail storage unavailable" }, { status: 503 });
  }
  const updated = await prisma.board.updateMany({ where: { id: boardId, userId }, data: { thumbnailAt: new Date() } });
  return NextResponse.json({ ok: updated.count > 0 });
}
