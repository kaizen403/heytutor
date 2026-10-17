import { lstatSync, readFileSync, writeFileSync, chmodSync, chownSync, renameSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Stamp deployment telemetry settings; credentials never leave the env file. */
export function setSentryRelease(envFile, release) {
  if (!/^[a-f0-9]{40}$/.test(release)) throw new Error("A full Git release SHA is required");
  const stat = lstatSync(envFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("A regular deployment environment file is required");
  const original = readFileSync(envFile, "utf8");
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const assignment = `SENTRY_RELEASE=${release}`;
  let replaced = false;
  const updated = original.split(/\r?\n/).map(line => {
    if (!/^\s*(?:export\s+)?SENTRY_RELEASE\s*=/.test(line)) return line;
    if (replaced) return "";
    replaced = true;
    return assignment;
  }).join(newline);
  const next = replaced ? updated : `${original}${original.endsWith("\n") || !original ? "" : newline}${assignment}${newline}`;
  const environment = "SENTRY_ENVIRONMENT=production";
  let environmentReplaced = false;
  let production = next.split(/\r?\n/).map(line => {
    if (!/^\s*(?:export\s+)?SENTRY_ENVIRONMENT\s*=/.test(line)) return line;
    if (environmentReplaced) return "";
    environmentReplaced = true;
    return environment;
  }).join(newline);
  if (!environmentReplaced) production += `${production.endsWith("\n") || !production ? "" : newline}${environment}${newline}`;
  if (production === original) return;
  const temporary = `${envFile}.release-${process.pid}`;
  try {
    writeFileSync(temporary, production, { mode: stat.mode & 0o777, flag: "wx" });
    chownSync(temporary, stat.uid, stat.gid);
    chmodSync(temporary, stat.mode & 0o777);
    const current = lstatSync(envFile);
    if (current.ino !== stat.ino || current.mtimeMs !== stat.mtimeMs || readFileSync(envFile, "utf8") !== original) {
      throw new Error("Deployment environment changed during release update");
    }
    renameSync(temporary, envFile);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) throw new Error("Expected environment file and release SHA");
  setSentryRelease(process.argv[2], process.argv[3]);
  console.log("SENTRY_RELEASE updated");
}
