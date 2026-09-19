import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LECTURE_LAB_HEADER } from "../../lib/billing/flags";

function tokenFromLocalEnvFile(): string | undefined {
  const envPath = resolve(import.meta.dirname, "../../.env.local");
  if (!existsSync(envPath)) return undefined;
  const match = readFileSync(envPath, "utf8").match(/^LECTURE_LAB_TOKEN=(.+)$/m);
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") || undefined;
}

export function lectureLabToken(env: NodeJS.ProcessEnv = process.env): string {
  const token = env.LECTURE_LAB_TOKEN?.trim() || tokenFromLocalEnvFile();
  if (!token) {
    throw new Error("LECTURE_LAB_TOKEN is required so the lab can skip billing gates");
  }
  return token;
}

export function applyLectureLabHeaders(headers: Headers, env: NodeJS.ProcessEnv = process.env): void {
  headers.set(LECTURE_LAB_HEADER, lectureLabToken(env));
}
