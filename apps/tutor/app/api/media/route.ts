import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { parseStoredObjectKey } from "@/lib/object-store/keys";
import { serveUserObject } from "@/lib/object-store/serveMedia";

export async function GET(request: Request) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const key = new URL(request.url).searchParams.get("key")?.trim() ?? "";
  if (!parseStoredObjectKey(key)) {
    return NextResponse.json({ error: "invalid key" }, { status: 400 });
  }

  return serveUserObject(userId, key);
}
