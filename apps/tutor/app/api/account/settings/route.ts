import { NextResponse } from "next/server";
import { ensureUser, isAuthFailure, requireSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { mapAccountSettings } from "@/lib/account/mapUser";
import { accountSettingsPatch } from "@/lib/account/userSettings";

export async function GET() {
  const userId = await requireSessionUserId();
  if (isAuthFailure(userId)) return userId;
  await ensureUser(userId);
  const row = await prisma.userSettings.findUnique({ where: { userId } });
  return NextResponse.json({ settings: mapAccountSettings(row) });
}

export async function PATCH(request: Request) {
  const userId = await requireSessionUserId();
  if (isAuthFailure(userId)) return userId;
  const expectedAccountId = request.headers.get("x-heytutor-account-id");
  if (expectedAccountId && expectedAccountId !== userId) {
    return NextResponse.json({ error: "account changed; settings not saved" }, { status: 409 });
  }
  await ensureUser(userId);

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const patch = accountSettingsPatch(body);
  const row = await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, ...patch },
    update: patch,
  });
  return NextResponse.json({ settings: mapAccountSettings(row) });
}
