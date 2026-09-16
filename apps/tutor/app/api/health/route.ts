import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isObjectStoreConfigured } from "@/lib/object-store/config";

export const dynamic = "force-dynamic";

export async function GET() {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }

  const ok = db;
  return NextResponse.json(
    {
      ok,
      db,
      objectStore: isObjectStoreConfigured(),
    },
    { status: ok ? 200 : 503 },
  );
}
