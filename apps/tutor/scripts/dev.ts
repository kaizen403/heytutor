/**
 * Dev entrypoint: ensure local Postgres is running, apply migrations, start server.
 *
 * Only auto-starts Docker when DATABASE_URL points at localhost (see docker-compose.yml).
 */

import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tutorRoot = resolve(__dirname, "..");
const repoRoot = resolve(tutorRoot, "../..");
const envFile = join(tutorRoot, ".env.local");

function loadDatabaseUrl(): string | undefined {
  if (existsSync(envFile)) {
    const match = readFileSync(envFile, "utf8").match(/^DATABASE_URL=(.+)$/m);
    if (match?.[1]) return match[1].trim();
  }
  return process.env.DATABASE_URL;
}

function isLocalDatabase(url: string): boolean {
  try {
    const parsed = new URL(url.replace(/^postgresql:/, "postgres:"));
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function run(cmd: string, cwd = repoRoot): void {
  execSync(cmd, { cwd, stdio: "inherit" });
}

function isPostgresReady(): boolean {
  try {
    execSync("docker compose exec -T postgres pg_isready -U heytutor -d heytutor", {
      cwd: repoRoot,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

function waitForPostgres(maxAttempts = 30): void {
  for (let i = 0; i < maxAttempts; i++) {
    if (isPostgresReady()) return;
    execSync("sleep 1");
  }
  throw new Error("Timed out waiting for local Postgres (heytutor-postgres)");
}

function ensureLocalDb(): void {
  const databaseUrl = loadDatabaseUrl();
  if (!databaseUrl || !isLocalDatabase(databaseUrl)) return;

  try {
    execSync("docker compose version", { stdio: "pipe" });
  } catch {
    console.warn("[dev] Docker not available — skipping local Postgres startup");
    return;
  }

  if (!isPostgresReady()) {
    console.log("[dev] Starting local Postgres (docker compose up -d postgres)…");
    run("docker compose up -d postgres");
    waitForPostgres();
    console.log("[dev] Postgres ready");
  }

  console.log("[dev] Applying migrations…");
  run("pnpm db:migrate", tutorRoot);
}

function startServer(): void {
  const child = spawn("tsx", ["server.ts"], {
    cwd: tutorRoot,
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

ensureLocalDb();
startServer();
