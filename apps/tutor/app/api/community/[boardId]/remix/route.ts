import { NextResponse } from "next/server";
import { ensureUser, getUserId } from "@/lib/auth";
import { remixCommunityBoard, RemixError } from "@/lib/community/remix";
import { claimRemixSlot, releaseRemixSlot } from "@/lib/community/abuseGuards";

interface RouteContext {
  params: Promise<{ boardId: string }>;
}

/** Copy a Community board into the signed in viewer's account. */
export async function POST(_request: Request, context: RouteContext) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await ensureUser(userId);
  const { boardId } = await context.params;
  // One remix per account at a time: parallel requests would each copy a
  // whole board before the quota transaction could refuse any of them.
  if (!claimRemixSlot(userId)) {
    return NextResponse.json({ error: "a remix is already running" }, { status: 429 });
  }
  try {
    return NextResponse.json(await remixCommunityBoard(boardId, userId));
  } catch (error) {
    if (error instanceof RemixError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[community] remix failed:", error);
    return NextResponse.json({ error: "remix failed" }, { status: 500 });
  } finally {
    releaseRemixSlot(userId);
  }
}
