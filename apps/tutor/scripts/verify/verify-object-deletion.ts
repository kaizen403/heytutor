import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock, test } from "node:test";

const load = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
let configured = true;
let mode: "empty" | "partial-error" | "truncated" = "empty";
const calls: Array<{ input: Record<string, unknown>; options?: { abortSignal?: AbortSignal } }> = [];
const prefix = "lectures/deletion-test-board/";
class Command { constructor(readonly input: Record<string, unknown>) {} }
mock.module(load.resolve("@aws-sdk/client-s3"), { namedExports: {
  ListObjectsV2Command: Command, DeleteObjectsCommand: Command, PutObjectCommand: Command, GetObjectCommand: Command,
  S3Client: class {
    async send(command: Command, options?: { abortSignal?: AbortSignal }) {
      calls.push({ input: command.input, options });
      if (mode === "truncated" && calls.length > 110) throw new Error("fake driver stopped a runaway call");
      if ("Prefix" in command.input) {
        return mode === "empty" ? { Contents: [], IsTruncated: false } : {
          Contents: [{ Key: `${prefix}turn/0.mp3` }], IsTruncated: mode === "truncated", NextContinuationToken: "next-page",
        };
      }
      return mode === "partial-error" ? { Errors: [{ Key: `${prefix}turn/0.mp3`, Code: "AccessDenied" }] } : {};
    }
  },
} });
mock.module(resolve(root, "lib/object-store/config.ts"), { namedExports: {
  getObjectStoreConfig: () => configured ? { bucket: "fake-bucket", region: "test-region", publicBaseUrl: null } : null,
} });
globalThis.fetch = async () => { throw new Error("No external requests in object deletion verification"); };
const objectStore = load(resolve(root, "lib/object-store/s3.ts")) as typeof import("../../lib/object-store/s3");
const { deletePrefix } = objectStore;

test("successful prefix deletion has a bounded abort signal on every provider request", async () => {
  calls.length = 0;
  mode = "empty";
  await deletePrefix(prefix);
  assert.equal(calls.length, 1);
  assert(calls.every((call) => call.options?.abortSignal instanceof AbortSignal), "cleanup must have a provider deadline");
});
test("a broad or unsafe prefix cannot delete a media namespace", async () => {
  mode = "empty";
  for (const invalid of ["lectures/", "images/", "lectures/../", "backups/", "lectures/board", "lectures/board/../../"]) {
    const before = calls.length;
    await assert.rejects(() => deletePrefix(invalid), /prefix/i);
    assert.equal(calls.length, before, "invalid scope must be denied before provider contact");
  }
});
test("a partially rejected DeleteObjects response is not confirmed deletion", async () => {
  mode = "partial-error";
  await assert.rejects(() => deletePrefix(prefix), /delet|reject|error/i);
});
test("a broken endless pagination response cannot run cleanup without a bound", async () => {
  mode = "truncated";
  await assert.rejects(() => deletePrefix(prefix), /pagination|limit|page/i);
});
test("a failed image upload can delete only its exact server-created key", async () => {
  mode = "empty";
  calls.length = 0;
  const key = "images/deletion-user/deletion-image.png";
  await deletePrefix(key);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.input.Delete, { Objects: [{ Key: key }], Quiet: true });
  assert(!("Prefix" in calls[0]!.input), "an individual failed upload must not erase other account images");
});
test("uploads are bounded and honor cancellation during account cleanup races", async () => {
  mode = "empty";
  calls.length = 0;
  const abort = new AbortController();
  await objectStore.uploadImage("images/deletion-user/deletion-image.png", new Uint8Array([1]), "image/png", abort.signal);
  const signal = calls[0]?.options?.abortSignal;
  assert(signal instanceof AbortSignal, "an upload must have a provider deadline");
  abort.abort();
  assert(signal.aborted, "caller cancellation must reach the storage request");
});
test("missing object storage configuration leaves cleanup unconfirmed", async () => {
  configured = false;
  mode = "empty";
  await assert.rejects(() => deletePrefix(prefix), /configur/i);
});
