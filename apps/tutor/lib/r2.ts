import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

export { lectureAudioKey } from "@/lib/r2Keys";

/**
 * Cloudflare R2 helpers for lecture audio — Wrangler CLI only (no S3 API keys).
 *
 * Requires: `wrangler login`, plus `R2_BUCKET` + `R2_PUBLIC_BASE_URL` from `pnpm r2:setup`.
 * Uploads/deletes via `wrangler r2 object put|delete --remote`.
 *
 * All operations use async child_process APIs so the Node event loop is not
 * blocked while wrangler runs.
 */

const execFileAsync = promisify(execFile);

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
let wranglerCheckPromise: Promise<boolean> | null = null;

async function isWranglerAuthenticated(): Promise<boolean> {
  if (wranglerAvailable !== null) return wranglerAvailable;
  if (wranglerCheckPromise) return wranglerCheckPromise;

  wranglerCheckPromise = (async () => {
    try {
      await execFileAsync("wrangler", ["whoami"], {
        encoding: "utf8",
        env: { ...process.env, CI: "true" },
      });
      wranglerAvailable = true;
    } catch {
      wranglerAvailable = false;
    }
    wranglerCheckPromise = null;
    return wranglerAvailable;
  })();

  return wranglerCheckPromise;
}

function publicUrlForKey(key: string): string | null {
  const config = getR2Config();
  if (!config) return null;
  const base = config.publicBaseUrl.replace(/\/$/, "");
  return `${base}/${key}`;
}

async function uploadViaWrangler(
  bucket: string,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
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
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, CI: "true" },
      },
    );

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (status) => {
      if (status !== 0) {
        reject(new Error(`wrangler r2 object put failed:\n${stderr}`));
      } else {
        resolve();
      }
    });

    child.stdin.end(Buffer.from(bytes));
  });
}

async function deleteViaWrangler(bucket: string, key: string): Promise<void> {
  await execFileAsync(
    "wrangler",
    ["r2", "object", "delete", `${bucket}/${key}`, "--remote"],
    {
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
    },
  );
}

/** True when bucket env vars are set and `wrangler login` is active. */
export async function isR2Configured(): Promise<boolean> {
  return getR2Config() !== null && (await isWranglerAuthenticated());
}

export async function uploadAudio(
  key: string,
  bytes: Uint8Array,
  contentType = "audio/mpeg",
): Promise<string | null> {
  const config = getR2Config();
  if (!config || !(await isWranglerAuthenticated())) {
    return null;
  }

  await uploadViaWrangler(config.bucket, key, bytes, contentType);
  return publicUrlForKey(key);
}

/** Best-effort delete; returns false when R2 is not configured or delete fails. */
export async function deleteAudio(key: string): Promise<boolean> {
  const config = getR2Config();
  if (!config || !(await isWranglerAuthenticated())) {
    return false;
  }

  try {
    await deleteViaWrangler(config.bucket, key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort bulk delete of multiple R2 keys. Intended for background cleanup
 * (e.g. after a board is deleted). Never throws — partial failures are logged.
 */
export async function deleteAudioBulk(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map((key) =>
      deleteAudio(key).then((ok) => {
        if (!ok) {
          // Best-effort — no throw, just skip.
        }
      }),
    ),
  );
}
