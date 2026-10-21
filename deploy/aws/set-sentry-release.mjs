import { lstatSync, readFileSync, writeFileSync, chmodSync, chownSync, renameSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Stamp deployment telemetry settings; credentials never leave the env file. */
export function setSentryRelease(envFile, release) {
  if (!/^[a-f0-9]{40}$/.test(release)) throw new Error("A full Git release SHA is required");
  const stat = lstatSync(envFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("A regular deployment environment file is required");
  const original = readFileSync(envFile, "utf8");
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  let production = original;
  for (const [name, value] of [
    ["SENTRY_RELEASE", release],
    ["SENTRY_ENVIRONMENT", "production"],
    ["NEXT_PUBLIC_SENTRY_ENVIRONMENT", "production"],
  ]) {
    const assignment = `${name}=${value}`;
    const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);
    let replaced = false;
    production = production.split(/\r?\n/).map(line => {
      if (!pattern.test(line)) return line;
      if (replaced) return "";
      replaced = true;
      return assignment;
    }).join(newline);
    if (!replaced) production += `${production.endsWith("\n") || !production ? "" : newline}${assignment}${newline}`;
  }
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
