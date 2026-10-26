/**
 * A tab left open across a deploy reloads into the current build before it
 * starts a new lesson (production 25 Oct 2026: a tab opened before #270 drew
 * the removed concept schematic for a marketing question a day after the
 * deploy, and the server admitted it as valid geometry).
 *
 * Checks the build identity read at build time, the stale decision and the
 * reload, and that the live code is wired: next.config inlines the identity,
 * /api/version reports it uncached, the full session shell watches it, and a
 * new lesson (never a doubt or a resume) reloads before anything else runs.
 * Synthetic text only.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBuildIdentity } from "../../lib/client/buildIdentity.mjs";
import {
  checkServerBuild, isClientBuildStale, noteServerBuild, reloadStaleTabForQuestion,
  resetStaleBuildStateForTests, staleBuildReloadInFlight, staleBuildReloadUrl, MAX_RELOAD_QUESTION_CHARS,
  MIN_CHECK_GAP_MS, RELOAD_IN_FLIGHT_MS,
} from "../../lib/client/staleBuild";

const app = fileURLToPath(new URL("../../", import.meta.url));
const OLD = "0123456789abcdef0123456789abcdef01234567";
const NEW = "fedcba9876543210fedcba9876543210fedcba98";
const cases: Array<[string, () => void | Promise<void>]> = [];
const check = (name: string, run: () => void | Promise<void>) => { cases.push([name, run]); };

check("build identity: the deploy's SENTRY_RELEASE, else .git read directly, else empty", () => {
  const root = mkdtempSync(path.join(tmpdir(), "build-identity-"));
  try {
    assert.equal(resolveBuildIdentity(root, { SENTRY_RELEASE: NEW.toUpperCase() }), NEW, "the deploy's commit wins");
    assert.equal(resolveBuildIdentity(root, {}), "", "no release and no .git: no identity, so no check");
    assert.equal(resolveBuildIdentity(root, { SENTRY_RELEASE: "unknown" }), "", "a malformed release is not an identity");
    mkdirSync(path.join(root, ".git/refs/heads"), { recursive: true });
    writeFileSync(path.join(root, ".git/HEAD"), "ref: refs/heads/main\n");
    writeFileSync(path.join(root, ".git/refs/heads/main"), `${OLD}\n`);
    assert.equal(resolveBuildIdentity(root, {}), OLD, "a loose branch ref is read without running git");
    rmSync(path.join(root, ".git/refs/heads/main"));
    writeFileSync(path.join(root, ".git/packed-refs"), `# pack-refs with: peeled\n${NEW} refs/heads/main\n`);
    assert.equal(resolveBuildIdentity(root, {}), NEW, "a packed branch ref is read too");
    writeFileSync(path.join(root, ".git/HEAD"), `${OLD}\n`);
    assert.equal(resolveBuildIdentity(root, {}), OLD, "a detached HEAD names its commit");
    // A worktree: .git is a file pointing at its git dir, branch refs live in the common dir.
    const tree = mkdtempSync(path.join(tmpdir(), "build-identity-tree-"));
    const gitDir = path.join(root, ".git/worktrees/tree");
    mkdirSync(gitDir, { recursive: true });
    writeFileSync(path.join(tree, ".git"), `gitdir: ${gitDir}\n`);
    writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(path.join(gitDir, "commondir"), "../..\n");
    assert.equal(resolveBuildIdentity(tree, {}), NEW, "a worktree reads its branch from the common directory");
    rmSync(tree, { recursive: true, force: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

check("stale only when both builds are known and differ", async () => {
  resetStaleBuildStateForTests();
  assert.equal(isClientBuildStale(OLD), false, "an unknown server build never counts as stale");
  noteServerBuild("not a commit");
  assert.equal(isClientBuildStale(OLD), false, "a malformed server answer is ignored");
  let t = 1_000_000;
  await checkServerBuild((async () => Response.json({ build: NEW })) as typeof fetch, t);
  assert.equal(isClientBuildStale(OLD), true, "an older bundle is stale");
  assert.equal(isClientBuildStale(NEW), false, "the current bundle is not");
  assert.equal(isClientBuildStale(""), false, "a bundle without an identity never reloads");
  t += MIN_CHECK_GAP_MS;
  await checkServerBuild((async () => { throw new Error("offline"); }) as typeof fetch, t);
  assert.equal(isClientBuildStale(OLD), true, "a failed check keeps the last known answer");
  t += MIN_CHECK_GAP_MS;
  await checkServerBuild((async () => new Response("down", { status: 503 })) as typeof fetch, t);
  assert.equal(isClientBuildStale(OLD), true);
  // Focus and visibility both fire when a student returns: one request, not two.
  let requests = 0;
  const counted = (async () => { requests++; return Response.json({ build: OLD }); }) as typeof fetch;
  t += MIN_CHECK_GAP_MS;
  await checkServerBuild(counted, t);
  await checkServerBuild(counted, t + 10);
  await checkServerBuild(counted, t + MIN_CHECK_GAP_MS - 1);
  assert.equal(requests, 1, "checks closer than the minimum gap are skipped");
  await checkServerBuild(counted, t + MIN_CHECK_GAP_MS);
  assert.equal(requests, 2);
});

check("reload carries the question once per server build, only where it can", () => {
  resetStaleBuildStateForTests();
  noteServerBuild(NEW);
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
  const assigned: string[] = [];
  const at = (pathname: string, search = "") => ({ pathname, search, assign: (url: string) => { assigned.push(url); } });
  const question = "Why does a ball thrown upward slow down?";

  assert.equal(reloadStaleTabForQuestion(question, { clientBuildId: NEW, location: at("/c/b1"), storage }), false, "a current tab teaches here");
  assert.equal(reloadStaleTabForQuestion(question, { clientBuildId: OLD, location: at("/c/b1"), storage }), true, "a stale tab reloads");
  assert.deepEqual(assigned, [`/c/b1?q=${encodeURIComponent(question)}`], "the same board, with the question");
  const newDocument = () => { resetStaleBuildStateForTests(); noteServerBuild(NEW); };
  newDocument();
  assert.equal(reloadStaleTabForQuestion(question, { clientBuildId: OLD, location: at("/c/b1"), storage }), false,
    "a build that still differs after one reload teaches here instead of looping");
  assert.equal(assigned.length, 1);

  newDocument();
  const fresh = new Map<string, string>();
  const freshStorage = { getItem: (key: string) => fresh.get(key) ?? null, setItem: (key: string, value: string) => { fresh.set(key, value); } };
  assert.equal(reloadStaleTabForQuestion(question, { clientBuildId: OLD, location: at("/"), storage: freshStorage }), true, "the home board reloads too");
  assert.equal(assigned.at(-1), `/?q=${encodeURIComponent(question)}`);

  newDocument();
  const none = { getItem: () => null, setItem: () => { throw new Error("storage refused"); } };
  assert.equal(reloadStaleTabForQuestion(question, { clientBuildId: OLD, location: at("/c/b2"), storage: none }), false,
    "without a place to remember the attempt, it teaches here");

  assert.equal(staleBuildReloadUrl(at("/c/b1", "?embed=1"), question), null, "an embedded lesson never reloads");
  assert.equal(staleBuildReloadUrl(at("/admin/playground"), question), null, "admin pages never reload");
  assert.equal(staleBuildReloadUrl(at("/c/b1"), "   "), null);
  const long = "x".repeat(MAX_RELOAD_QUESTION_CHARS + 1);
  assert.equal(staleBuildReloadUrl(at("/c/b1"), long), null, "a question too long for the address bar teaches here");
});

check("while the reload is in flight, every later ask on the page rides with it", () => {
  resetStaleBuildStateForTests();
  noteServerBuild(NEW);
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
  const assigned: string[] = [];
  const location = { pathname: "/", search: "", assign: (url: string) => { assigned.push(url); } };
  const question = "What is the work done by friction on a sliding block?";
  assert.equal(reloadStaleTabForQuestion(question, { clientBuildId: OLD, location, storage }), true, "the first ask reloads");
  assert.equal(staleBuildReloadInFlight(), true);
  // The ?q= effect's retry or the pending flush asks again before the page is replaced.
  assert.equal(reloadStaleTabForQuestion(question, { clientBuildId: OLD, location, storage }), true,
    "a second ask on the same page must not fall through to a lesson on the old bundle");
  assert.equal(reloadStaleTabForQuestion("another question", { clientBuildId: OLD, location, storage }), true);
  assert.equal(assigned.length, 1, "the page navigates once");
  // The new document starts with fresh module state; the mark stops a loop there.
  resetStaleBuildStateForTests();
  noteServerBuild(NEW);
  assert.equal(reloadStaleTabForQuestion(question, { clientBuildId: OLD, location, storage }), false,
    "after the reload, a build that still differs teaches instead of reloading again");
  assert.equal(assigned.length, 1);
});

check("a cancelled reload stops refusing lessons after a bounded wait", async () => {
  resetStaleBuildStateForTests();
  noteServerBuild(NEW);
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
  const location = { pathname: "/c/b9", search: "", assign: () => {} };
  const realSetTimeout = globalThis.setTimeout;
  let fire: (() => void) | null = null;
  let delay = -1;
  globalThis.setTimeout = ((fn: () => void, ms: number) => { fire = fn; delay = ms; return 1 as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout;
  try {
    assert.equal(reloadStaleTabForQuestion("Why is the sky blue?", { clientBuildId: OLD, location, storage }), true);
  } finally { globalThis.setTimeout = realSetTimeout; }
  assert.equal(delay, RELOAD_IN_FLIGHT_MS, "the in flight hold is bounded");
  assert(fire, "a timer clears the hold");
  (fire as () => void)();
  assert.equal(staleBuildReloadInFlight(), false, "a navigation that never replaced the page releases it");
  assert.equal(reloadStaleTabForQuestion("Why is the sky blue?", { clientBuildId: OLD, location, storage }), false,
    "and the next ask teaches here (the mark already says this build was tried)");
});

check("wiring: build inlines the identity, the server reports it, the shell watches, a new lesson reloads first", () => {
  const config = readFileSync(path.join(app, "next.config.ts"), "utf8");
  assert.match(config, /NEXT_PUBLIC_HEYTUTOR_BUILD_ID:\s*resolveBuildIdentity\(/, "next.config inlines the identity");
  const route = readFileSync(path.join(app, "app/api/version/route.ts"), "utf8");
  assert.match(route, /build:\s*process\.env\.NEXT_PUBLIC_HEYTUTOR_BUILD_ID/, "the server reports its own inlined build");
  assert.match(route, /no-store/, "the answer is never cached");
  const shell = readFileSync(path.join(app, "features/tutor-session/TutorSessionShell.tsx"), "utf8");
  assert.match(shell, /variant === "full" \? watchServerBuild\(\) : undefined/, "only the student page watches");
  const handler = readFileSync(path.join(app, "features/tutor-session/hooks/turn/useQuestionHandler.ts"), "utf8");
  const start = handler.indexOf("const handleQuestion = useCallback(");
  const unlock = handler.indexOf("ensureTTSClient().unlockAudio?.();", start);
  assert(start > 0 && unlock > start, "handleQuestion anchors");
  const head = handler.slice(start, unlock);
  assert.match(head, /if \(!options\?\.doubt && !options\?\.resume && reloadStaleTabForQuestion\(rawQuestion\)\) \{/,
    "a new lesson reloads a stale tab before anything else; doubts and resumes stay");
  assert.match(head, /reloadStaleTabForQuestion\(rawQuestion\)\) \{[\s\S]*?pendingQuestionRef\.current = null;[\s\S]*?options\?\.onAdmission\?\.\(true\);\s*return;/,
    "the stale return clears the pending question and does not report a failed start");
  const watcher = readFileSync(path.join(app, "lib/client/staleBuild.ts"), "utf8");
  assert.match(watcher, /addEventListener\("pageshow", onPageShow\)/, "a page restored from the back forward cache may teach again");
});

let finished = false;
process.on("beforeExit", () => { if (!finished) { console.error("stale tab gate never finished"); process.exitCode = 1; } });
(async () => {
  let failures = 0;
  for (const [name, run] of cases) {
    try { await run(); console.log(`ok   ${name}`); } catch (error) { failures++; console.error(`FAIL ${name}`); console.error(error); }
  }
  finished = true;
  if (failures > 0) { console.error(`${failures} stale tab check(s) failed`); process.exitCode = 1; }
  else console.log(`stale tab reload: ${cases.length} checks passed`);
})();
