/**
 * Node only, evaluated by next.config at build time: the commit this build was
 * made from, so the browser bundle and the server it talks to can tell when
 * they come from different deploys.
 *
 * The deploy exports SENTRY_RELEASE (the commit) before building. The build
 * runs as root over an ubuntu-owned checkout, where `git` refuses to read the
 * repository, so the fallback reads `.git` directly. Nothing found means an
 * empty identity, and an empty identity turns the stale tab check off.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const COMMIT = /^[0-9a-f]{7,64}$/i;

function readGitHead(root) {
  let gitDir = path.join(root, ".git");
  if (!existsSync(gitDir)) return "";
  try {
    // A worktree's .git is a file naming its real git directory.
    const pointer = readFileSync(gitDir, "utf8").match(/^gitdir:\s*(.+)\s*$/m);
    if (pointer) gitDir = path.resolve(root, pointer[1]);
  } catch {
    // .git is a directory: read it in place.
  }
  try {
    const head = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (COMMIT.test(head)) return head.toLowerCase();
    const ref = head.match(/^ref:\s*(\S+)$/)?.[1];
    if (!ref) return "";
    // Branch refs of a worktree live in the shared common directory.
    const common = existsSync(path.join(gitDir, "commondir"))
      ? path.resolve(gitDir, readFileSync(path.join(gitDir, "commondir"), "utf8").trim())
      : gitDir;
    for (const dir of [gitDir, common]) {
      const loose = path.join(dir, ref);
      if (existsSync(loose)) {
        const value = readFileSync(loose, "utf8").trim();
        if (COMMIT.test(value)) return value.toLowerCase();
      }
    }
    const packed = path.join(common, "packed-refs");
    if (existsSync(packed)) {
      for (const line of readFileSync(packed, "utf8").split("\n")) {
        const [sha, name] = line.trim().split(/\s+/);
        if (name === ref && COMMIT.test(sha ?? "")) return sha.toLowerCase();
      }
    }
  } catch {
    return "";
  }
  return "";
}

/** The deployed commit, or "" when this build cannot name one. */
export function resolveBuildIdentity(root, env = process.env) {
  const release = (env.SENTRY_RELEASE ?? "").trim();
  if (COMMIT.test(release)) return release.toLowerCase();
  return readGitHead(root);
}
