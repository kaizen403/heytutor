import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";

// Header validation never contacts vendors or expands uploaded compressed data.
// Real local encoders produce the browser-supported positive fixtures.
const load = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
mock.module(resolve(root, "../../packages/tutor-core/src/index.ts"), {
  namedExports: { normalizeTutorQuestion: (value: string) => value.trim() },
});
const { readQuestionImage } = load(
  resolve(root, "lib/object-store/questionImage.ts"),
) as typeof import("../../lib/object-store/questionImage");

function image(codec: string, frames = 1): Buffer {
  // A real Sharp/libwebp encoding of a 32x16 white image. Some system ffmpeg
  // distributions decode WebP but omit its optional encoder.
  if (codec === "libwebp")
    return Buffer.from(
      "UklGRjAAAABXRUJQVlA4ICQAAACwAgCdASogABAAPm0skUWkIqGYBABABsS0gAA9kAAA/vshgAA=",
      "base64",
    );
  return execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=white:s=32x16:r=2",
      "-frames:v",
      String(frames),
      "-threads",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      codec,
      "pipe:1",
    ],
    {
      timeout: 5_000,
      maxBuffer: 2 * 1024 * 1024,
      env: { PATH: process.env.PATH, LANG: "C", NODE_ENV: "production" },
    },
  );
}

function dataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

try {
  const fixtures = [
    ["image/png", "png"],
    ["image/jpeg", "mjpeg"],
    ["image/webp", "libwebp"],
    ["image/gif", "gif"],
  ] as const;
  for (const [mime, codec] of fixtures) {
    const bytes = image(codec);
    const parsed = readQuestionImage(dataUrl(mime, bytes));
    assert(parsed, `${mime} produced by a real encoder remains supported`);
    assert.equal(parsed.mimeType, mime);
    assert.deepEqual(Buffer.from(parsed.bytes), bytes);
    assert.equal(
      readQuestionImage(
        dataUrl(mime === "image/png" ? "image/jpeg" : "image/png", bytes),
      ),
      null,
      "claimed MIME must match encoded content",
    );
    assert.equal(
      readQuestionImage(
        dataUrl(mime, bytes.subarray(0, Math.min(bytes.length - 2, 12))),
      ),
      null,
      "truncated headers are rejected",
    );
    console.log(`✓ bounded static ${mime} remains supported`);
  }
  const webpVariants = [
    "UklGRhwAAABXRUJQVlA4TA8AAAAvH8ADEAcQ/Y8CBiKi/wEA",
    "UklGRmwAAABXRUJQVlA4WAoAAAAQAAAAHwAADwAAQUxQSAoAAAABB1DAiAhERP8DVlA4IDwAAAAwAwCdASogABAAPm0skUWkIqGYBABABsSgC7LoB+AACEUAAP7wm0P/kFywuuRr/8gP+QH/ID/+PguzAAA=",
  ]; // Real Sharp encodings: lossless and extended-alpha, both 32x16.
  for (const base64 of webpVariants)
    assert(
      readQuestionImage(`data:image/webp;base64,${base64}`),
      "static lossless and alpha WebP remain supported",
    );
  const animatedWebp = Buffer.from(webpVariants[1]!, "base64");
  animatedWebp[20] = animatedWebp[20]! | 2;
  assert.equal(
    readQuestionImage(dataUrl("image/webp", animatedWebp)),
    null,
    "animated WebP containers cannot multiply image work",
  );
  const oversized = image("png");
  oversized.writeUInt32BE(100_000, 16);
  assert.equal(
    readQuestionImage(dataUrl("image/png", oversized)),
    null,
    "small compressed images cannot claim unbounded decoded dimensions",
  );
  assert.equal(
    readQuestionImage(dataUrl("image/gif", image("gif", 2))),
    null,
    "animated image frame counts cannot multiply provider work",
  );
  assert.equal(readQuestionImage("data:image/png;base64,not-an-image"), null);
  console.log(
    "✓ oversized, animated, malformed, and MIME-mismatched photos are rejected",
  );
} finally {
  mock.restoreAll();
}
