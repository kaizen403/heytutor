import { execFileSync, spawnSync } from "node:child_process";

export { lectureAudioKey } from "@/lib/r2Keys";

/**
 * Cloudflare R2 helpers for lecture audio — Wrangler CLI only (no S3 API keys).
 *
 * Requires: `wrangler login`, plus `R2_BUCKET` + `R2_PUBLIC_BASE_URL` from `pnpm r2:setup`.
 * Uploads/deletes via `wrangler r2 object put|delete --remote`.
 */

type R2Config = {
  bucket: string;
  publicBaseUrl: string;
};

function getR2Config(): R2Config | null {
  const bucket = process.env.R2_BUCKET?.trim();
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim();
  if (!bucket || !publicBaseUrl) return null;
  return { bucket, publicBaseUrl };
}

let wranglerAvailable: boolean | null = null;

function isWranglerAuthenticated(): boolean {
  if (wranglerAvailable !== null) return wranglerAvailable;

  try {
    execFileSync("wrangler", ["whoami"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "true" },
    });
    wranglerAvailable = true;
  } catch {
    wranglerAvailable = false;
  }

  return wranglerAvailable;
}

function publicUrlForKey(key: string): string | null {
  const config = getR2Config();
  if (!config) return null;
  const base = config.publicBaseUrl.replace(/\/$/, "");
  return `${base}/${key}`;
}

function uploadViaWrangler(
  bucket: string,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): void {
  const result = spawnSync(
    "wrangler",
    [
      "r2",
      "object",
      "put",
      `${bucket}/${key}`,
      "--pipe",
      "--content-type",
      contentType,
      "--remote",
    ],
    {
      input: Buffer.from(bytes),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CI: "true" },
    },
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? "";
    throw new Error(`wrangler r2 object put failed:\n${stderr}`);
  }
}

function deleteViaWrangler(bucket: string, key: string): void {
  execFileSync(
    "wrangler",
    ["r2", "object", "delete", `${bucket}/${key}`, "--remote"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "true" },
    },
  );
}

/** True when bucket env vars are set and `wrangler login` is active. */
export function isR2Configured(): boolean {
  return getR2Config() !== null && isWranglerAuthenticated();
}

export async function uploadAudio(
  key: string,
  bytes: Uint8Array,
  contentType = "audio/mpeg",
): Promise<string | null> {
  const config = getR2Config();
  if (!config || !isWranglerAuthenticated()) {
    return null;
  }

  uploadViaWrangler(config.bucket, key, bytes, contentType);
  return publicUrlForKey(key);
}

/** Best-effort delete; returns false when R2 is not configured or delete fails. */
export async function deleteAudio(key: string): Promise<boolean> {
  const config = getR2Config();
  if (!config || !isWranglerAuthenticated()) {
    return false;
  }

  try {
    deleteViaWrangler(config.bucket, key);
    return true;
  } catch {
    return false;
  }
}
