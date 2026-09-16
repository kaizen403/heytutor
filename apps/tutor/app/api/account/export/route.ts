import { NextResponse } from "next/server";
import { isAuthFailure, requireSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { mapAccountProfile, mapAccountSettings } from "@/lib/account/mapUser";

export async function GET() {
  const userId = await requireSessionUserId();
  if (isAuthFailure(userId)) return userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      settings: true,
      boards: {
        orderBy: { updatedAt: "desc" },
        include: {
          turns: {
            orderBy: { orderIndex: "asc" },
            select: {
              id: true,
              orderIndex: true,
              question: true,
              createdAt: true,
              visualStatus: true,
            },
          },
          chatMessages: {
            orderBy: { createdAt: "asc" },
            select: { id: true, role: true, content: true, createdAt: true },
          },
        },
      },
    },
  });
  if (!user) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    profile: mapAccountProfile(user),
    settings: mapAccountSettings(user.settings),
    boards: user.boards.map((board) => ({
      id: board.id,
      title: board.title,
      preview: board.preview,
      createdAt: board.createdAt.toISOString(),
      updatedAt: board.updatedAt.toISOString(),
      archivedAt: board.archivedAt?.toISOString() ?? null,
      turns: board.turns,
      notes: board.chatMessages,
    })),
    exportFiles: [],
    note: "Lecture MP4s and notes PDFs stay on the device that downloaded them.",
  });
}
