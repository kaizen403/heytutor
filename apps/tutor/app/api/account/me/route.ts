import { NextResponse } from "next/server";
import { isAuthFailure, requireSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { emptySnapshot, mapAccountProfile, mapAccountSettings } from "@/lib/account/mapUser";
import { AVAILABLE_SUBJECTS, parseSubjects, type SubjectId } from "@/lib/account/types";
import { loadProgressV1 } from "@/lib/account/progress";
import { sanitizeTeachingNote } from "@/lib/account/userSettings";

export async function GET() {
  const userId = await requireSessionUserId();
  if (isAuthFailure(userId)) return userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { settings: true },
  });
  if (!user) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const progress = await loadProgressV1(userId, parseSubjects(user.subjects));
  return NextResponse.json({
    profile: mapAccountProfile(user),
    settings: mapAccountSettings(user.settings),
    snapshot: {
      boardCount: progress.boardCount,
      lessonCount: progress.lessonCount,
      narrationMinutes: progress.narrationMinutes,
      exportCount: 0,
      lastBoard: progress.lastBoard,
    } satisfies ReturnType<typeof emptySnapshot> & { lastBoard: typeof progress.lastBoard },
  });
}

export async function PATCH(request: Request) {
  const userId = await requireSessionUserId();
  if (isAuthFailure(userId)) return userId;

  let body: {
    name?: unknown;
    learningNote?: unknown;
    examGoal?: unknown;
    classYear?: unknown;
    subjects?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const data: {
    name?: string;
    learningNote?: string;
    examGoal?: string;
    classYear?: string;
    subjects?: SubjectId[];
  } = {};
  if (typeof body.name === "string") data.name = body.name.trim().slice(0, 80);
  if ("learningNote" in body) data.learningNote = sanitizeTeachingNote(body.learningNote);
  if (typeof body.examGoal === "string") data.examGoal = body.examGoal;
  if (typeof body.classYear === "string") data.classYear = body.classYear;
  if (Array.isArray(body.subjects)) {
    data.subjects = parseSubjects(body.subjects).filter((subject) =>
      AVAILABLE_SUBJECTS.includes(subject),
    );
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    include: { settings: true },
  });
  return NextResponse.json({
    profile: mapAccountProfile(user),
    settings: mapAccountSettings(user.settings),
  });
}
