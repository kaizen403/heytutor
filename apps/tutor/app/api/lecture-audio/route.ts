import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { isAllowedLectureAudioSource } from "@/lib/lecture-export/lectureAudioUrl";

const UPSTREAM_MS = 8_000;

export async function GET(request: Request) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const src = new URL(request.url).searchParams.get("src")?.trim() ?? "";
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim() ?? null;
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
        "content-type": upstream.headers.get("content-type") || "audio/mpeg",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "audio unavailable" }, { status: 502 });
  }
}
