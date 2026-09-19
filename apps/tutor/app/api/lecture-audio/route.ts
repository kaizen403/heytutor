import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { isAllowedLectureAudioSource } from "@/lib/lecture-export/lectureAudioUrl";
import { getObjectStoreConfig } from "@/lib/object-store/config";
import { parseStoredObjectKey } from "@/lib/object-store/keys";
import { mediaKeyFromUrl } from "@/lib/object-store/mediaUrl";
import { serveUserObject } from "@/lib/object-store/serveMedia";

const UPSTREAM_MS = 8_000;

export async function GET(request: Request) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const keyParam = params.get("key")?.trim() ?? "";
  const src = params.get("src")?.trim() ?? "";
  const key = parseStoredObjectKey(keyParam) ? keyParam : mediaKeyFromUrl(src);

  if (key) {
    return serveUserObject(userId, key);
  }

  const publicBaseUrl = getObjectStoreConfig()?.publicBaseUrl ?? null;
  if (!isAllowedLectureAudioSource(src, publicBaseUrl)) {
    return NextResponse.json({ error: "invalid audio source" }, { status: 400 });
  }

  try {
    const upstream = await fetch(src, {
      headers: { accept: "audio/mpeg" },
      signal: AbortSignal.timeout(UPSTREAM_MS),
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: "audio not found" }, { status: 404 });
    }
    return new NextResponse(upstream.body, {
      headers: {
        "content-type": "audio/mpeg",
        "content-disposition": 'inline; filename="lecture.mp3"',
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "audio unavailable" }, { status: 502 });
  }
}
