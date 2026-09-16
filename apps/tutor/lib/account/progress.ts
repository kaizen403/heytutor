import { prisma } from "@/lib/db/prisma";
import type { SubjectId } from "./types";

export type ProgressWeek = {
  weekStart: string;
  lessons: number;
  minutes: number;
};

export type ProgressSubjectSplit = {
  subject: SubjectId | "other";
  boards: number;
  lessons: number;
};

export type ProgressV1 = {
  boardCount: number;
  lessonCount: number;
  narrationMinutes: number;
  notesDoubtCount: number;
  daysOpened: number;
  weeks: ProgressWeek[];
  subjects: ProgressSubjectSplit[];
  lastBoard: { id: string; title: string; updatedAt: string } | null;
};

const SUBJECT_HINTS: Array<{ subject: SubjectId; pattern: RegExp }> = [
  { subject: "physics", pattern: /\b(physics|kinematic|projectile|force|resistor|optics|charge|incline|newton|circuit)\b/i },
  { subject: "maths", pattern: /\b(math|algebra|calculus|integral|triangle|equation|geometry|probability)\b/i },
  { subject: "dsa", pattern: /\b(dsa|leetcode|array|binary|graph|dp\b|linked list|two pointer)\b/i },
  { subject: "chemistry", pattern: /\b(chemistry|mole|molar|reaction|compound|hybridi[sz]ation|orbital|ligand|electrode|electrolysis|acid|base|pH|isomer|alkene|benzene|titration|enthalpy)\b/i },
];

export function inferBoardSubject(
  title: string,
  preview: string,
  onboarded: SubjectId[],
): SubjectId | "other" {
  const text = `${title} ${preview}`;
  for (const hint of SUBJECT_HINTS) {
    if (hint.pattern.test(text)) return hint.subject;
  }
  if (onboarded.length === 1) return onboarded[0] ?? "other";
  return "other";
}

function weekStartIso(date: Date): string {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  copy.setUTCDate(copy.getUTCDate() - offset);
  return copy.toISOString().slice(0, 10);
}

export async function loadProgressV1(userId: string, onboardedSubjects: SubjectId[]): Promise<ProgressV1> {
  const [boards, turns, doubts] = await Promise.all([
    prisma.board.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, preview: true, updatedAt: true },
    }),
    prisma.turn.findMany({
      where: { userId },
      select: {
        id: true,
        createdAt: true,
        boardId: true,
        segments: { select: { durationMs: true } },
      },
    }),
    prisma.boardChatMessage.count({
      where: { userId, role: "user" },
    }),
  ]);

  const narrationMs = turns.reduce(
    (sum, turn) => sum + turn.segments.reduce((inner, segment) => inner + (segment.durationMs ?? 0), 0),
    0,
  );
  const weekMap = new Map<string, ProgressWeek>();
  const daySet = new Set<string>();
  for (const turn of turns) {
    const week = weekStartIso(turn.createdAt);
    const minutes = turn.segments.reduce((sum, segment) => sum + (segment.durationMs ?? 0), 0) / 60000;
    const current = weekMap.get(week) ?? { weekStart: week, lessons: 0, minutes: 0 };
    current.lessons += 1;
    current.minutes += minutes;
    weekMap.set(week, current);
    daySet.add(turn.createdAt.toISOString().slice(0, 10));
  }

  const subjectMap = new Map<SubjectId | "other", ProgressSubjectSplit>();
  const lessonsByBoard = new Map<string, number>();
  for (const turn of turns) {
    lessonsByBoard.set(turn.boardId, (lessonsByBoard.get(turn.boardId) ?? 0) + 1);
  }
  for (const board of boards) {
    const subject = inferBoardSubject(board.title, board.preview, onboardedSubjects);
    const current = subjectMap.get(subject) ?? { subject, boards: 0, lessons: 0 };
    current.boards += 1;
    current.lessons += lessonsByBoard.get(board.id) ?? 0;
    subjectMap.set(subject, current);
  }

  const last = boards[0] ?? null;
  return {
    boardCount: boards.length,
    lessonCount: turns.length,
    narrationMinutes: Math.round((narrationMs / 60000) * 10) / 10,
    notesDoubtCount: doubts,
    daysOpened: daySet.size,
    weeks: [...weekMap.values()].sort((a, b) => b.weekStart.localeCompare(a.weekStart)).slice(0, 12),
    subjects: [...subjectMap.values()],
    lastBoard: last
      ? { id: last.id, title: last.title, updatedAt: last.updatedAt.toISOString() }
      : null,
  };
}
