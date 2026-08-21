import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { mintWsTicket } from "@/lib/tts/wsTicket";

export async function GET(): Promise<Response> {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ ticket: mintWsTicket(userId) });
}
