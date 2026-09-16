import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "../..");
const sessionLayout = readFileSync(resolve(root, "app/(session)/layout.tsx"), "utf8");
const accountLayout = readFileSync(resolve(root, "app/(account)/layout.tsx"), "utf8");
const sessionPage = readFileSync(resolve(root, "features/tutor-session/TutorSessionPage.tsx"), "utf8");

assert(
  sessionLayout.includes("TutorSessionPage"),
  "(session) layout must keep mounting TutorSessionPage so / and /c/[id] share the live board",
);
assert(
  !accountLayout.includes("TutorSessionPage"),
  "account routes must not mount TutorSessionPage",
);
assert(
  !accountLayout.includes("Whiteboard") && !accountLayout.includes("TutorSessionShell"),
  "account chrome must not pull Konva or the session shell",
);
assert(
  accountLayout.includes("AccountAppShell"),
  "account routes share AppShell via AccountAppShell",
);
assert(
  sessionPage.includes('searchParams.get("embed") === "1"'),
  "the live board still has the embed/demo path",
);

const accountFiles = [
  "app/(account)/library/page.tsx",
  "app/(account)/progress/page.tsx",
  "app/(account)/profile/page.tsx",
  "app/(account)/settings/page.tsx",
  "app/(account)/usage/page.tsx",
];
for (const file of accountFiles) {
  const source = readFileSync(resolve(root, file), "utf8");
  assert(!source.includes("TutorSessionPage"), `${file} must stay off the session layout`);
}

console.log("✓ account routes stay off the live-board layout; session layout still mounts the board");
