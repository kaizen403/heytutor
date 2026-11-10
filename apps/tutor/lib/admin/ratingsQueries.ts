/** Admin reads behind lecture ratings. Admin only: shows real account emails and student notes. */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isLectureRatingMoment, MAX_LECTURE_STARS, type LectureRatingMoment } from "@/lib/lecture-rating/ratingInput";

export type AdminRatingsWindow = "7d" | "30d" | "90d" | "all";

export interface AdminRatingsFilter {
  window: AdminRatingsWindow;
  /** Only this many stars, or every rating. */
  stars: number | null;
  moment: LectureRatingMoment | null;
  withFeedback: boolean;
}

export interface AdminRatingRow {
  id: string;
  stars: number;
  moment: LectureRatingMoment;
  feedback: string | null;
  stepsTaught: number;
  updatedAt: string;
  question: string;
  turnKind: string;
  boardId: string;
  boardTitle: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
}

export interface AdminRatingsSummary {
  count: number;
  average: number | null;
  duringAverage: number | null;
  afterAverage: number | null;
  /** Index 0 is one star. */
  distribution: number[];
  withFeedback: number;
  /** Lesson and Continue turns rated at least once, over those taught in the window. */
  ratedLectures: number;
  lecturesTaught: number;
}

export interface AdminRatingsPage {
  summary: AdminRatingsSummary;
  rows: AdminRatingRow[];
  total: number;
  page: number;
  pageSize: number;
}

const WINDOW_DAYS: Record<Exclude<AdminRatingsWindow, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };

export function parseAdminRatingsFilter(params: URLSearchParams): AdminRatingsFilter {
  const window = params.get("window");
  const stars = Number.parseInt(params.get("stars") ?? "", 10);
  const moment = params.get("moment");
  return {
    window: window === "7d" || window === "90d" || window === "all" ? window : "30d",
    stars: Number.isInteger(stars) && stars >= 1 && stars <= MAX_LECTURE_STARS ? stars : null,
    moment: isLectureRatingMoment(moment) ? moment : null,
    withFeedback: params.get("feedback") === "with",
  };
}

function windowStart(window: AdminRatingsWindow, now: number): Date | null {
  return window === "all" ? null : new Date(now - WINDOW_DAYS[window] * 86_400_000);
}

function roundAverage(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

export async function listAdminRatings(input: {
  filter: AdminRatingsFilter;
  page: number;
  pageSize: number;
  now?: number;
}): Promise<AdminRatingsPage> {
  const since = windowStart(input.filter.window, input.now ?? Date.now());
  const inWindow: Prisma.LectureRatingWhereInput = since ? { updatedAt: { gte: since } } : {};
  const rowsWhere: Prisma.LectureRatingWhereInput = {
    ...inWindow,
    ...(input.filter.stars !== null ? { stars: input.filter.stars } : {}),
    ...(input.filter.moment ? { moment: input.filter.moment } : {}),
    ...(input.filter.withFeedback ? { feedback: { not: null } } : {}),
  };

  const [overall, byMoment, byStars, withFeedback, ratedLectures, lecturesTaught, total, rows] = await Promise.all([
    prisma.lectureRating.aggregate({ where: inWindow, _avg: { stars: true }, _count: { _all: true } }),
    prisma.lectureRating.groupBy({ by: ["moment"], where: inWindow, _avg: { stars: true } }),
    prisma.lectureRating.groupBy({ by: ["stars"], where: inWindow, _count: { _all: true } }),
    prisma.lectureRating.count({ where: { ...inWindow, feedback: { not: null } } }),
    prisma.$queryRaw<Array<{ count: bigint }>>(
      since
        ? Prisma.sql`SELECT COUNT(DISTINCT "turn_id") AS "count" FROM "lecture_ratings" WHERE "updated_at" >= ${since}`
        : Prisma.sql`SELECT COUNT(DISTINCT "turn_id") AS "count" FROM "lecture_ratings"`,
    ),
    prisma.turn.count({
      where: {
        kind: { in: ["lesson", "resume"] },
        lessonMs: { gt: 0 },
        ...(since ? { createdAt: { gte: since } } : {}),
      },
    }),
    prisma.lectureRating.count({ where: rowsWhere }),
    prisma.lectureRating.findMany({
      where: rowsWhere,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        stars: true,
        moment: true,
        feedback: true,
        stepsTaught: true,
        updatedAt: true,
        boardId: true,
        userId: true,
        turn: { select: { question: true, kind: true } },
        board: { select: { title: true } },
        user: { select: { email: true, name: true } },
      },
    }),
  ]);

  const distribution = Array.from({ length: MAX_LECTURE_STARS }, () => 0);
  for (const group of byStars) {
    if (group.stars >= 1 && group.stars <= MAX_LECTURE_STARS) distribution[group.stars - 1] = group._count._all;
  }
  const momentAverage = (moment: LectureRatingMoment) =>
    roundAverage(byMoment.find((group) => group.moment === moment)?._avg.stars);

  return {
    summary: {
      count: overall._count._all,
      average: roundAverage(overall._avg.stars),
      duringAverage: momentAverage("during"),
      afterAverage: momentAverage("after"),
      distribution,
      withFeedback,
      ratedLectures: Number(ratedLectures[0]?.count ?? 0),
      lecturesTaught,
    },
    total,
    page: input.page,
    pageSize: input.pageSize,
    rows: rows.map((row) => ({
      id: row.id,
      stars: row.stars,
      moment: isLectureRatingMoment(row.moment) ? row.moment : "after",
      feedback: row.feedback,
      stepsTaught: row.stepsTaught,
      updatedAt: row.updatedAt.toISOString(),
      question: row.turn.question,
      turnKind: row.turn.kind,
      boardId: row.boardId,
      boardTitle: row.board.title,
      userId: row.userId,
      userEmail: row.user.email,
      userName: row.user.name,
    })),
  };
}
