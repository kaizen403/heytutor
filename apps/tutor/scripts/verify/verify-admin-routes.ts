/**
 * Admin panel route shapes: every admin API stays behind the admin gate and
 * stays dynamic, the panel pages stay staff-gated, the playground stays
 * reachable and full-bleed, and the admin payloads never select the blobs
 * (raw responses, scene documents, audio URLs) that must not leave the server.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

const ADMIN_API_ROUTES = [
  "app/api/admin/run-cost/route.ts",
  "app/api/admin/overview/route.ts",
  "app/api/admin/users/route.ts",
  "app/api/admin/users/[userId]/route.ts",
  "app/api/admin/turns/route.ts",
];

for (const route of ADMIN_API_ROUTES) {
  const source = read(route);
  assert(
    source.includes("requireAdminRequest"),
    `${route} must gate on requireAdminRequest — the admin APIs are staff-only even when the page gate is bypassed`,
  );
  assert(
    source.includes('export const dynamic = "force-dynamic"'),
    `${route} must stay force-dynamic — a prerendered admin payload would bake whatever the build-time gate decided`,
  );
}

const panelLayout = read("app/admin/(panel)/layout.tsx");
assert(
  panelLayout.includes("isAdminEmail"),
  "the admin panel layout must gate on the admins table",
);
assert(
  panelLayout.includes('export const dynamic = "force-dynamic"'),
  "the panel layout must stay force-dynamic so a missing env cannot bake an open admin page",
);
assert(
  panelLayout.includes("AdminNav"),
  "the panel layout must mount the shared admin nav",
);

const playgroundPage = read("app/admin/playground/page.tsx");
assert(
  playgroundPage.includes("isAdminEmail"),
  "the playground page must keep its own gate — it lives outside the panel layout",
);
assert(
  playgroundPage.includes("AdminPlayground"),
  "the playground page must render the syllabus playground",
);
assert(
  playgroundPage.includes('href="/admin"'),
  "the playground must link back to the admin panel",
);

const nav = read("features/admin/nav/AdminNav.tsx");
for (const href of ["/admin", "/admin/playground", "/admin/users", "/admin/logs", "/admin/fails"]) {
  assert(nav.includes(`href: "${href}"`), `the admin nav must keep its ${href} section`);
}

const playground = read("features/admin/AdminPlayground.tsx");
assert(
  playground.includes('variant="headless"'),
  "AdminPlayground must keep running lectures headlessly — the panel restructure must not touch it",
);

const adminQuerySources = [
  ...ADMIN_API_ROUTES,
  "lib/admin/overviewQueries.ts",
  "lib/admin/overviewDistributions.ts",
  "lib/admin/overviewLists.ts",
  "lib/admin/usersQueries.ts",
  "lib/admin/userDetailQueries.ts",
  "lib/admin/turnsQueries.ts",
  "lib/admin/costQueries.ts",
];
for (const source of adminQuerySources) {
  const text = read(source);
  assert(
    !text.includes("rawResponse"),
    `${source} must never read rawResponse — teaching-stream drafts are not admin payload material`,
  );
  assert(
    !text.includes("audioUrl"),
    `${source} must never read segment audio URLs — lecture audio lives in private S3`,
  );
}

assert(
  read("features/admin/analytics/OverviewView.tsx").includes("OverviewCost"),
  "overview must show cost analytics",
);
assert(
  read("lib/admin/overviewQueries.ts").includes("fetchOverviewCost"),
  "overview query must load ledger + Langfuse cost",
);
assert(
  read("features/admin/turns/TurnsTable.tsx").includes("CostChip"),
  "the turn log must show estimated AI + voice cost",
);

console.log("✓ admin routes: gated, dynamic, blob-free, playground intact");
