import { NextResponse } from "next/server";
import { isAuthFailure, requireSessionUserId } from "@/lib/auth";
import { signOut } from "@/auth";
import { deleteAuthenticatedAccount } from "@/lib/auth/deleteAccount";

export async function DELETE() {
  const userId = await requireSessionUserId();
  if (isAuthFailure(userId)) return userId;

  await deleteAuthenticatedAccount(userId);
  await signOut({ redirect: false });

  return NextResponse.json({ ok: true });
}
