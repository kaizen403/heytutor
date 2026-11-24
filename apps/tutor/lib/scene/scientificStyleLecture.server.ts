import { createHash } from "node:crypto";
import { openSync, closeSync, fstatSync, readSync } from "node:fs";
import { sampleScientificSceneStyle } from "../reference-picture/generatedSceneStyleSample";
import { SCIENTIFIC_STYLE_LECTURE_POLICY, type ScientificStyleLecture } from "./scientificStyleLecture";

const MAX_SAMPLE_BYTES = 8 * 1024 * 1024;
type StyleEnv = Record<string, string | undefined>;
function configuredSample(env: StyleEnv): Buffer | null {
  if (env.SCIENTIFIC_STYLE_LECTURES !== "on" || !env.SCIENTIFIC_STYLE_SAMPLE_PATH) return null;
  let fd: number | undefined;
  try {
    fd = openSync(env.SCIENTIFIC_STYLE_SAMPLE_PATH, "r");
    const info = fstatSync(fd);
    if (!info.isFile() || info.size < 8 || info.size > MAX_SAMPLE_BYTES) return null;
    const bytes = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) break;
      offset += count;
    }
    return offset === info.size ? bytes.subarray(0, offset) : null;
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}

/** Non-secret execution identity: changing bytes or mode invalidates lab resumes. */
export function scientificStyleLectureIdentity(env: StyleEnv = process.env) {
  const bytes = configuredSample(env);
  return { policy: SCIENTIFIC_STYLE_LECTURE_POLICY, enabled: env.SCIENTIFIC_STYLE_LECTURES === "on",
    sampleHash: bytes ? createHash("sha256").update(bytes).digest("hex") : null };
}

let cached: { hash: string; value: Promise<ScientificStyleLecture | null> } | null = null;
export async function resolveScientificStyleLecture(env: StyleEnv = process.env): Promise<ScientificStyleLecture | null> {
  const bytes = configuredSample(env);
  if (!bytes) return null;
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (cached?.hash === hash) return cached.value;
  const value = sampleScientificSceneStyle(bytes).then(sample => ({
    schema: "scientific-style-lecture/v1" as const, paletteId: sample.style.paletteId, sampleHash: sample.receipt.rawImageHash,
  })).catch(() => null);
  cached = { hash, value };
  return value;
}
