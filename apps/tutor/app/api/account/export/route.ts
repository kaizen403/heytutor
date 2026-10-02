import { NextResponse } from "next/server";
import { isAuthFailure, requireSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { mapAccountProfile, mapAccountSettings } from "@/lib/account/mapUser";

const PAGE_SIZE = 25;

export async function GET(request: Request) {
  const userId = await requireSessionUserId();
  if (isAuthFailure(userId)) return userId;

  const query = new URL(request.url).searchParams;
  const section = query.get("section") ?? "profile";
  const page = Number(query.get("page") ?? "0");
  if (!["profile", "boards", "turns", "notes"].includes(section) || !Number.isSafeInteger(page) || page < 0 || page > 10_000) {
    return NextResponse.json({ error: "invalid export page" }, { status: 400 });
  }
  if (section !== "profile") {
    const pagination = { skip: page * PAGE_SIZE, take: PAGE_SIZE + 1 };
    const rows = section === "boards" ? await prisma.board.findMany({
      where: { userId }, orderBy: { id: "asc" }, ...pagination,
      select: { id: true, title: true, preview: true, createdAt: true, updatedAt: true, archivedAt: true },
    }) : section === "turns" ? await prisma.turn.findMany({
      where: { userId }, orderBy: { id: "asc" }, ...pagination,
      select: { id: true, boardId: true, orderIndex: true, question: true, createdAt: true, visualStatus: true },
    }) : await prisma.boardChatMessage.findMany({
      where: { userId }, orderBy: { id: "asc" }, ...pagination,
      select: { id: true, boardId: true, role: true, content: true, createdAt: true },
    });
    return NextResponse.json({ section, items: rows.slice(0, PAGE_SIZE), nextPage: rows.length > PAGE_SIZE ? page + 1 : null });
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { settings: true },
  });
  if (!user) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    profile: mapAccountProfile(user),
    settings: mapAccountSettings(user.settings),
    boards: [],
    sections: ["boards", "turns", "notes"],
    exportFiles: [],
    note: "Lecture MP4s and notes PDFs stay on the device that downloaded them.",
  });
}
