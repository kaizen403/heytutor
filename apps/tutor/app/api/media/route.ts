import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { parseStoredObjectKey } from "@/lib/object-store/keys";
import { publicMediaRateLimit, serveUserObject } from "@/lib/object-store/serveMedia";
import { requireAdminRequest } from "@/lib/auth/requireAdmin";

export async function GET(request: Request) {
  // Signed out is allowed: Community clips are public. The object check decides.
  const userId = await getUserId();
  if (!userId) {
    const limited = publicMediaRateLimit(request);
    if (limited) return limited;
  }

  const key = new URL(request.url).searchParams.get("key")?.trim() ?? "";
  if (!parseStoredObjectKey(key)) {
    return NextResponse.json({ error: "invalid key" }, { status: 400 });
  }

  return serveUserObject(userId, key, { isAdmin: async () => (await requireAdminRequest()) === null });
}
