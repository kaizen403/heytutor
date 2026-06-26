/**
 * Provision / validate Cloudflare R2 for lecture audio using Wrangler CLI.
 *
 * Usage: pnpm r2:setup [--bucket heytutor-lectures] [--env apps/tutor/.env.local]
 *
 * Wrangler handles: auth check, account id, bucket create/list, r2.dev public URL.
 * Runtime uploads use `wrangler r2 object put` (requires `wrangler login` — no S3 API keys).
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BUCKET = "heytutor-lectures";
const __dirname = dirname(fileURLToPath(import.meta.url));
const tutorRoot = resolve(__dirname, "..");

function parseArgs(): { bucket: string; envFile: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  let bucket = DEFAULT_BUCKET;
  let envFile = resolve(tutorRoot, ".env.local");
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--bucket" && args[i + 1]) {
      bucket = args[++i];
    } else if (args[i] === "--env" && args[i + 1]) {
      envFile = resolve(process.cwd(), args[++i]);
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  return { bucket, envFile, dryRun };
}

function runWrangler(args: string): string {
  try {
    return execSync(`wrangler ${args}`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CI: "true" },
    }).trim();
  } catch (error) {
    const message =
      error instanceof Error && "stderr" in error
        ? String((error as { stderr?: Buffer }).stderr ?? error.message)
        : String(error);
    throw new Error(`wrangler ${args} failed:\n${message}`);
  }
}

function assertWranglerInstalled(): void {
  try {
    execSync("which wrangler", { encoding: "utf8", stdio: "pipe" });
  } catch {
    throw new Error(
      "wrangler CLI not found. Install: npm i -g wrangler (or pnpm add -g wrangler), then wrangler login",
    );
  }
}

function parseAccountId(whoamiOutput: string): string {
  const match = whoamiOutput.match(/[0-9a-f]{32}/i);
  if (!match) {
    throw new Error(
      `Could not parse account id from wrangler whoami. Run wrangler login.\n${whoamiOutput}`,
    );
  }
  return match[0];
}

function bucketExists(listOutput: string, bucket: string): boolean {
  return new RegExp(`^name:\\s*${bucket}\\s*$`, "m").test(listOutput);
}

function parsePublicBaseUrl(devUrlOutput: string): string | null {
  const match = devUrlOutput.match(/https:\/\/pub-[a-f0-9]+\.r2\.dev/i);
  return match ? match[0].replace(/\/$/, "") : null;
}

function upsertEnvVar(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }
  const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  return `${content}${separator}${line}\n`;
}

function removeEnvVar(content: string, key: string): string {
  return content
    .split("\n")
    .filter((line) => !new RegExp(`^${key}=`).test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function ensureR2CommentBlock(content: string): string {
  const marker = "# Cloudflare R2 (lecture audio)";
  if (content.includes(marker)) return content;
  const block = [
    "",
    marker,
    "# Provision: pnpm r2:setup  |  Auth: wrangler login  |  Uploads: wrangler r2 object put",
    "",
  ].join("\n");
  return content + block;
}

function mergeEnvFile(
  envFile: string,
  vars: Record<string, string>,
  dryRun: boolean,
  stripS3Keys = false,
): void {
  let content = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  content = ensureR2CommentBlock(content);

  if (stripS3Keys) {
    content = removeEnvVar(content, "R2_ACCESS_KEY_ID");
    content = removeEnvVar(content, "R2_SECRET_ACCESS_KEY");
  }

  for (const [key, value] of Object.entries(vars)) {
    content = upsertEnvVar(content, key, value);
  }

  if (dryRun) {
    console.log("--- dry run: would write to", envFile, "---");
    return;
  }

  writeFileSync(envFile, content, "utf8");
  console.log(`Updated ${envFile}`);
}

function main(): void {
  const { bucket, envFile, dryRun } = parseArgs();

  console.log("Checking Wrangler…");
  assertWranglerInstalled();

  const version = runWrangler("--version");
  console.log(`  ${version}`);

  const whoami = runWrangler("whoami");
  if (/not logged in/i.test(whoami)) {
    throw new Error("Wrangler is not authenticated. Run: wrangler login");
  }
  const accountId = parseAccountId(whoami);
  console.log(`  Account id: ${accountId}`);

  const bucketList = runWrangler("r2 bucket list");
  if (!bucketExists(bucketList, bucket)) {
    console.log(`Creating bucket '${bucket}'…`);
    runWrangler(`r2 bucket create ${bucket}`);
  } else {
    console.log(`Bucket '${bucket}' already exists`);
  }

  let devUrlOutput = runWrangler(`r2 bucket dev-url get ${bucket}`);
  let publicBaseUrl = parsePublicBaseUrl(devUrlOutput);

  if (!publicBaseUrl) {
    console.log(`Enabling r2.dev public access for '${bucket}'…`);
    runWrangler(`r2 bucket dev-url enable ${bucket}`);
    devUrlOutput = runWrangler(`r2 bucket dev-url get ${bucket}`);
    publicBaseUrl = parsePublicBaseUrl(devUrlOutput);
  }

  if (!publicBaseUrl) {
    throw new Error(
      `Could not resolve public r2.dev URL for '${bucket}'. Output:\n${devUrlOutput}`,
    );
  }

  console.log(`  Public base URL: ${publicBaseUrl}`);

  const vars = {
    R2_ACCOUNT_ID: accountId,
    R2_BUCKET: bucket,
    R2_PUBLIC_BASE_URL: publicBaseUrl,
  };

  mergeEnvFile(envFile, vars, dryRun, true);

  const exampleFile = resolve(tutorRoot, ".env.example");
  if (existsSync(exampleFile) || !dryRun) {
    mergeEnvFile(exampleFile, vars, dryRun, true);
  }

  let uploadOk = false;
  const pingPath = join(tmpdir(), `heytutor-r2-setup-${Date.now()}.txt`);
  try {
    writeFileSync(pingPath, "ping");
    runWrangler(
      `r2 object put ${bucket}/lectures/_setup/ping.txt --file=${pingPath} --content-type=text/plain --remote`,
    );
    uploadOk = true;
    console.log("  Wrangler upload test: OK");
  } catch {
    console.log("  Wrangler upload test: failed — run wrangler login");
  } finally {
    try {
      unlinkSync(pingPath);
    } catch {
      /* ignore */
    }
  }

  console.log(`
R2 provisioning complete.

Upload path: wrangler r2 object put (requires wrangler login)
Upload test: ${uploadOk ? "passed" : "failed"}

Re-run anytime: pnpm r2:setup
`);
}

main();
