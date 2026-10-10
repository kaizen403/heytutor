import { NextResponse } from "next/server";
import { isLectureLabRequest } from "@/lib/billing/flags";
import { labProviderConfig } from "@/lib/llm/labProviderConfig";

export async function GET(request: Request) {
  if (!isLectureLabRequest(request)) return new Response(null, { status: 404 });
  return NextResponse.json(labProviderConfig(), { headers: { "cache-control": "no-store" } });
}
