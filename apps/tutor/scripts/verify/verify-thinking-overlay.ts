/**
 * The wait before the first mark is the clicker on paper — not the Konva
 * marker's shadows, not a "planning the diagram…" sentence.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const tutorRoot = resolve(import.meta.dirname, "../..");
const overlay = readFileSync(
  resolve(tutorRoot, "features/tutor-session/components/ThinkingOverlay.tsx"),
  "utf8",
);
const shell = readFileSync(
  resolve(tutorRoot, "features/tutor-session/TutorSessionShell.tsx"),
  "utf8",
);

assert(overlay.includes("PenSpinner"), "the pending overlay must be the clicker pen");
assert(overlay.includes("trail={false}"), "the pending clicker must not trail ink");
assert(overlay.includes("smear={false}"), "the pending clicker must not smear a second shadow");
assert(!overlay.includes("<p"), "the pending overlay must not paint a status sentence");
assert(!/\bmessage\s*[:=]/.test(overlay), "the pending overlay has no status-copy prop");
assert(
  overlay.includes('aria-label="Preparing the lesson"'),
  "the pending overlay must name the wait for assistive tech",
);
assert(
  overlay.includes("size={48}"),
  "the centered lesson spinner must be size 48, not 88",
);
assert(
  !overlay.includes("size={88}"),
  "the centered lesson spinner must not stay at size 88",
);
assert(
  overlay.includes("size={32}"),
  "the doubt spinner must be size 32",
);
assert(
  /className="wb-pending\b/.test(overlay),
  "the centered overlay must keep the wb-pending class for the frosted board",
);
assert(
  /waitingToTeach\s*=\s*phase === "planning" \|\| phase === "thinking"/.test(shell),
  "planning and the pre-lesson think share one pending overlay",
);
assert(
  /waitingToTeach\s*\?\s*"idle"/.test(shell),
  "the Konva marker must stay down while the pending overlay is up",
);
assert(
  !shell.includes("planning the diagram"),
  "the shell must not put 'planning the diagram' on the board",
);

console.log("verify-thinking-overlay: pending overlay is the clicker, with no copy and no Konva marker");
