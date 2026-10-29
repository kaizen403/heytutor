import { NextResponse } from "next/server";
import { listCommunityBoards } from "@/lib/community/queries";
import { parseCommunitySort } from "@/lib/community/publicBoard";
import { parseSubjects } from "@/lib/account/types";

/** The Community gallery. Public: no sign in needed to browse. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const page = Number(params.get("page") ?? "0");
  if (!Number.isSafeInteger(page) || page < 0 || page > 1_000) {
    return NextResponse.json({ error: "invalid page" }, { status: 400 });
  }
  const result = await listCommunityBoards({
    sort: parseCommunitySort(params.get("sort")),
    page,
    query: params.get("q") ?? "",
    subject: parseSubjects([params.get("subject")])[0] ?? null,
  });
  return NextResponse.json(result, { headers: { "cache-control": "public, max-age=30" } });
}
