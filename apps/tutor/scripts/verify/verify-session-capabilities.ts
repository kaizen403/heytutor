/**
 * Admin Watch teaches the same lesson the main page does.
 *
 * The shell is mounted on four surfaces. Watch used to share the public demo's
 * variant, so it inherited every restriction that variant was given for an
 * unauthenticated iframe: no composer, no Ask panel, no marking, no settings.
 * Nobody decided Watch should be a poorer lesson; it just was, one `!isEmbed`
 * at a time.
 *
 * These gates hold the two halves of that apart. A surface that teaches must be
 * able to do everything the main page can, differing only in whether it draws
 * the app frame; and the demo — reachable without signing in — must still be
 * able to do nothing but watch.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LESSON_VARIANTS,
  sessionCapabilities,
  type SessionCapabilities,
  type TutorSessionVariant,
} from "../../features/tutor-session/lib/sessionCapabilities";
import { isEmbedDemoRequest } from "../../lib/auth/publicPaths";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function read(...segments: string[]): string {
  return readFileSync(join(__dirname, "../..", ...segments), "utf8");
}

const CAPABILITY_KEYS = [
  "appChrome",
  "askQuestions",
  "notes",
  "marking",
  "settings",
  "persistSettings",
  "board",
] as const satisfies readonly (keyof SessionCapabilities)[];

// --- a teaching surface is a teaching surface -------------------------------
{
  const full = sessionCapabilities("full");
  for (const variant of LESSON_VARIANTS) {
    const capabilities = sessionCapabilities(variant);
    for (const key of CAPABILITY_KEYS) {
      if (key === "appChrome") continue;
      assert(
        capabilities[key] === full[key],
        `"${variant}" differs from the main page on ${key} — a lesson surface may differ only in its frame`,
      );
    }
  }
  assert(sessionCapabilities("panel").appChrome === false, "a panel brings its own frame");
  assert(sessionCapabilities("full").appChrome === true, "the main page draws the app frame");
  for (const key of CAPABILITY_KEYS) {
    assert(full[key] === true, `the main page must be able to ${key}`);
  }
}

// --- and the demo is still only a demo --------------------------------------
{
  assert(isEmbedDemoRequest("/c/abc", "?embed=1"), "the embed variant is the unauthenticated demo");
  const demo = sessionCapabilities("embed");
  for (const key of CAPABILITY_KEYS) {
    if (key === "board") continue;
    assert(
      demo[key] === false,
      `a signed-out demo must not be able to ${key} — it is reachable without an account`,
    );
  }
  assert(demo.board, "the demo still shows the board");

  const headless = sessionCapabilities("headless");
  for (const key of CAPABILITY_KEYS) {
    if (key === "board") continue;
    assert(headless[key] === false, `a recording runtime has no ${key}`);
  }
}

// --- the surfaces are wired to the table, not to their own conditions --------
{
  const shell = read("features/tutor-session/TutorSessionShell.tsx");
  assert(
    shell.includes("sessionCapabilities(variant)"),
    "the shell must read its capabilities from the table",
  );
  assert(
    !/\bisEmbed\b/.test(shell),
    "the shell must not gate features on being an embed: that is what conflated Watch with the demo",
  );
  for (const key of ["askQuestions", "notes", "marking", "settings", "persistSettings"] as const) {
    assert(shell.includes(`can.${key}`), `the shell must gate ${key} on the capability table`);
  }

  const watch = read("features/admin/components/WatchDrawer.tsx");
  assert(
    watch.includes('variant="panel"'),
    "admin Watch must mount the lesson as a panel, not as the read-only demo",
  );
  assert(
    !watch.includes('variant="embed"'),
    "admin Watch must not mount the unauthenticated demo variant",
  );
  assert(
    watch.includes("notesOpen=") && watch.includes("onNotesOpenChange="),
    "admin Watch drives the session's own Ask panel rather than a second notes surface",
  );

  const sessionPage = read("features/tutor-session/TutorSessionPage.tsx");
  assert(
    sessionPage.includes('embed ? "embed" : "full"'),
    "the public route must keep serving the read-only variant for ?embed=1",
  );
  assert(
    !sessionPage.includes('"panel"'),
    "the public route must never serve the full-capability panel",
  );

  // Admin is staff-only, which is what makes a full-capability panel safe there.
  const adminPage = read("app/admin/page.tsx");
  assert(
    adminPage.includes("isStaffEmail"),
    "the admin page must stay staff-gated while it mounts a full lesson",
  );
}

// --- every variant is accounted for -----------------------------------------
{
  const variants: TutorSessionVariant[] = ["full", "panel", "embed", "headless"];
  for (const variant of variants) {
    const capabilities = sessionCapabilities(variant);
    for (const key of CAPABILITY_KEYS) {
      assert(typeof capabilities[key] === "boolean", `${variant}.${key} is not declared`);
    }
  }
}

console.log(
  "verify-session-capabilities: admin Watch is the main page's lesson without the app frame — composer, Ask panel, marking and settings all present — while the signed-out demo can still only watch",
);
