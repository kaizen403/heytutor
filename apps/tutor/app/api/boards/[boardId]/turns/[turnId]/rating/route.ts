import { NextResponse } from "next/server";
import { ensureUser, getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { readBoundedJson, RequestBodyError } from "@/lib/http/requestBody";
import { parseLectureRatingInput } from "@/lib/lecture-rating/ratingInput";

interface RouteContext {
  params: Promise<{ boardId: string; turnId: string }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Save the student's stars for one lecture turn at one moment; a repeat rewrites it. */
export async function PUT(request: Request, context: RouteContext) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureUser(userId);

  const { boardId, turnId } = await context.params;
  if (!UUID.test(turnId)) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await readBoundedJson(request, 16 * 1024);
  } catch (error) {
    return NextResponse.json({ error: "invalid json" }, { status: error instanceof RequestBodyError ? error.status : 400 });
  }
  const parsed = parseLectureRatingInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { moment, stars, feedback, stepsTaught } = parsed.input;

  const turn = await prisma.turn.findFirst({
    where: { id: turnId, boardId, userId, board: { userId } },
    select: { kind: true },
  });
  if (!turn) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (turn.kind === "doubt") return NextResponse.json({ error: "doubt answers are not rated" }, { status: 400 });

  const rating = await prisma.lectureRating.upsert({
    where: { turnId_moment: { turnId, moment } },
    create: { userId, boardId, turnId, moment, stars, feedback, stepsTaught },
    update: { stars, feedback, stepsTaught },
    select: { id: true, moment: true, stars: true, feedback: true, updatedAt: true },
  });
  return NextResponse.json({
    rating: { ...rating, updatedAt: rating.updatedAt.getTime() },
  });
}
