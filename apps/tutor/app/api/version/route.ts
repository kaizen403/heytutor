import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * The commit this server was built from, inlined at build time like the
 * browser bundle's copy, so an open tab can tell it is running an older
 * deploy. The commit is not a secret: it is the public repository's.
 */
export function GET() {
  return NextResponse.json(
    { build: process.env.NEXT_PUBLIC_HEYTUTOR_BUILD_ID ?? "" },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
