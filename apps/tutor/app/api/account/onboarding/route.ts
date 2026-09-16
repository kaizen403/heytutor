import { NextResponse } from "next/server";
import { isAuthFailure, requireSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { decideAgeGate } from "@/lib/auth/ageGate";
import {
  AVAILABLE_SUBJECTS,
  isClassYear,
  isExamGoal,
  parseSubjects,
} from "@/lib/account/types";
import { mapAccountProfile, mapAccountSettings } from "@/lib/account/mapUser";
import { accountSettingsPatch } from "@/lib/account/userSettings";
import { signOut } from "@/auth";

async function notifyGuardian(email: string, studentName: string): Promise<boolean> {
  const key = process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY;
  if (!key) return false;
  const from = process.env.AUTH_EMAIL_FROM ?? "Accelute <hi@accelute.co>";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: email,
        subject: "An Accelute student account was created",
        text: `${studentName} created an Accelute student account. Accelute is an AI whiteboard tutor. If you did not expect this, write to hi@accelute.co.`,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const userId = await requireSessionUserId();
  if (isAuthFailure(userId)) return userId;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const age = decideAgeGate({
    ageBand: body.ageBand,
    guardianEmail: body.guardianEmail,
  });
  if (!age.ok && age.reason === "under_13") {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await signOut({ redirect: false });
    return NextResponse.json({ error: "under_13", refused: true }, { status: 403 });
  }
  if (!age.ok) {
    return NextResponse.json({ error: age.reason }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }
  if (!isExamGoal(body.examGoal) || !isClassYear(body.classYear)) {
    return NextResponse.json({ error: "goal_required" }, { status: 400 });
  }
  const subjects = parseSubjects(body.subjects).filter((subject) =>
    AVAILABLE_SUBJECTS.includes(subject),
  );
  if (subjects.length === 0) {
    return NextResponse.json({ error: "subjects_required" }, { status: 400 });
  }

  const settingsPatch = accountSettingsPatch({
    audioLanguage: body.audioLanguage,
    accent: body.accent,
    familiarity: body.familiarity,
  });

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      name,
      examGoal: body.examGoal,
      classYear: body.classYear,
      subjects,
      ageBand: age.band,
      guardianEmail: age.band === "13_17" ? age.guardianEmail : null,
      onboardingCompletedAt: new Date(),
    },
    include: { settings: true },
  });

  await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, ...settingsPatch },
    update: settingsPatch,
  });

  if (age.band === "13_17" && !user.guardianNotifiedAt) {
    const sent = await notifyGuardian(age.guardianEmail, name);
    if (sent) {
      await prisma.user.update({
        where: { id: userId },
        data: { guardianNotifiedAt: new Date() },
      });
    }
  }

  const refreshed = await prisma.user.findUnique({
    where: { id: userId },
    include: { settings: true },
  });
  return NextResponse.json({
    profile: mapAccountProfile(refreshed ?? user),
    settings: mapAccountSettings(refreshed?.settings ?? null),
  });
}
