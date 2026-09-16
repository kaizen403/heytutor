import { NextResponse } from "next/server";
import { isAuthFailure, requireSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { parseSubjects } from "@/lib/account/types";
import { loadProgressV1 } from "@/lib/account/progress";

export async function GET() {
  const userId = await requireSessionUserId();
  if (isAuthFailure(userId)) return userId;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subjects: true },
  });
  const progress = await loadProgressV1(userId, parseSubjects(user?.subjects));
  return NextResponse.json({ progress });
}
