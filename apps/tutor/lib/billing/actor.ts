import { auth } from "@/auth";
import { ensureUser, isAuthFailure, requireSessionUserId } from "@/lib/auth";
import { isEmbedDemoRequest } from "@/lib/auth/publicPaths";
import { isAdminEmail } from "@/lib/auth/admins";
import { prisma } from "@/lib/db/prisma";
import { billingResponse } from "./errors";
import { isAutumnEnabled, isLectureLabRequest } from "./flags";

export interface SpendActor {
  userId: string;
  email: string | null;
  staff: boolean;
  lectureLab: boolean;
  /** Skip Autumn check/track. */
  skipAutumn: boolean;
  /** Skip Autumn, fuses, and grant (staff or lecture-lab). */
  skipGates: boolean;
}

function isEmbedReferer(request: Request): boolean {
  const referer = request.headers.get("referer") ?? "";
  if (!referer) return false;
  try {
    const url = new URL(referer);
    return isEmbedDemoRequest(url.pathname, url.search);
  } catch {
    return referer.includes("embed=1");
  }
}

export async function requireSpendActor(
  request: Request,
): Promise<SpendActor | Response> {
  if (isEmbedReferer(request)) {
    return billingResponse("unauthorized", null, "embed is read-only");
  }

  const userId = await requireSessionUserId();
  if (isAuthFailure(userId)) {
    return billingResponse("unauthorized", null, "unauthorized");
  }
  await ensureUser(userId);

  const session = await auth();
  const sessionEmail = session?.user?.email?.trim().toLowerCase() || null;
  let email = sessionEmail;
  if (!email) {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    email = row?.email?.trim().toLowerCase() || null;
  }

  const staff = await isAdminEmail(email);
  const lectureLab = isLectureLabRequest(request);
  return {
    userId,
    email,
    staff,
    lectureLab,
    skipAutumn: staff || lectureLab || !isAutumnEnabled(),
    skipGates: staff || lectureLab,
  };
}

export function isSpendActor(value: SpendActor | Response): value is SpendActor {
  return typeof value === "object" && value !== null && "userId" in value && !("headers" in value);
}
