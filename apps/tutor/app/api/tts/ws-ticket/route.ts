import { NextResponse } from "next/server";
import { isSpendActor, requireSpendActor } from "@/lib/billing/gate";
import { mintWsTicket } from "@/lib/tts/wsTicket";

export async function GET(request: Request): Promise<Response> {
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;

  return NextResponse.json({ ticket: mintWsTicket(actor.userId) });
}
