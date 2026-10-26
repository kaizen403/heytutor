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
  resetStaleBuildStateForTests, staleBuildReloadUrl, MAX_RELOAD_QUESTION_CHARS,
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
  await checkServerBuild((async () => Response.json({ build: NEW })) as typeof fetch);
  assert.equal(isClientBuildStale(OLD), true, "an older bundle is stale");
  assert.equal(isClientBuildStale(NEW), false, "the current bundle is not");
  assert.equal(isClientBuildStale(""), false, "a bundle without an identity never reloads");
  await checkServerBuild((async () => { throw new Error("offline"); }) as typeof fetch);
  assert.equal(isClientBuildStale(OLD), true, "a failed check keeps the last known answer");
  await checkServerBuild((async () => new Response("down", { status: 503 })) as typeof fetch);
  assert.equal(isClientBuildStale(OLD), true);
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
  assert.equal(reloadStaleTabForQuestion(question, { clientBuildId: OLD, location: at("/c/b1"), storage }), false,
    "a build that still differs after one reload teaches here instead of looping");
  assert.equal(assigned.length, 1);

  const fresh = new Map<string, string>();
  const freshStorage = { getItem: (key: string) => fresh.get(key) ?? null, setItem: (key: string, value: string) => { fresh.set(key, value); } };
  assert.equal(reloadStaleTabForQuestion(question, { clientBuildId: OLD, location: at("/"), storage: freshStorage }), true, "the home board reloads too");
  assert.equal(assigned.at(-1), `/?q=${encodeURIComponent(question)}`);

  const none = { getItem: () => null, setItem: () => { throw new Error("storage refused"); } };
  assert.equal(reloadStaleTabForQuestion(question, { clientBuildId: OLD, location: at("/c/b2"), storage: none }), false,
    "without a place to remember the attempt, it teaches here");

  assert.equal(staleBuildReloadUrl(at("/c/b1", "?embed=1"), question), null, "an embedded lesson never reloads");
  assert.equal(staleBuildReloadUrl(at("/admin/playground"), question), null, "admin pages never reload");
  assert.equal(staleBuildReloadUrl(at("/c/b1"), "   "), null);
  const long = "x".repeat(MAX_RELOAD_QUESTION_CHARS + 1);
  assert.equal(staleBuildReloadUrl(at("/c/b1"), long), null, "a question too long for the address bar teaches here");
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
  assert.match(head, /if \(!options\?\.doubt && !options\?\.resume && reloadStaleTabForQuestion\(rawQuestion\)\) \{\s*options\?\.onAdmission\?\.\(false\);\s*return;/,
    "a new lesson reloads a stale tab before anything else; doubts and resumes stay");
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
