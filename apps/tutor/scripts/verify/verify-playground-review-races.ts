/** Actual route with deterministic transaction contention; no paid services or database. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";
import type { PlaygroundLecture } from "../../lib/admin/playgroundLecture";

const root = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
const initial: PlaygroundLecture = { topicId: "physics|1|work", difficulty: "easy", state: "complete" };
let metadata = structuredClone(initial);
let lockTail = Promise.resolve();
let turnRead: ReturnType<typeof deferred> | undefined;
let releaseTurns: ReturnType<typeof deferred> | undefined;
let updateEntered: ReturnType<typeof deferred> | undefined;
let releaseUpdate: ReturnType<typeof deferred> | undefined;
const prisma = {
  async $transaction<T>(run: (tx: unknown) => Promise<T>) {
    let locked = false;
    let unlock: (() => void) | undefined;
    const tx = {
      async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
        assert.match(strings.join("?"), /WHERE id = \? AND user_id = \? FOR UPDATE/);
        assert.deepEqual(values, ["board", "owner"]);
        const previous = lockTail;
        const next = deferred();
        lockTail = next.promise;
        await previous;
        locked = true;
        unlock = next.resolve;
        return [{ id: "board" }];
      },
      board: {
        async findFirst() {
          assert(locked, "the row must be locked before reading metadata");
          return { id: "board", userId: "owner", createdAt: new Date(0), updatedAt: new Date(1), playground: structuredClone(metadata) };
        },
        async update({ data }: { data: { playground: PlaygroundLecture } }) {
          assert(locked);
          updateEntered?.resolve();
          await releaseUpdate?.promise;
          metadata = structuredClone(data.playground);
          return {};
        },
      },
      turn: {
        async findMany() {
          assert(locked);
          turnRead?.resolve();
          await releaseTurns?.promise;
          return [{ status: "complete", kind: "lesson", rawResponse: "A full explanation", visualStatus: "text_only", updatedAt: new Date(1), segments: [
            { narration: "Work is force times distance", spokenText: "Work is force times distance", audioUrl: "/audio/clip", durationMs: 1000,
              command: { type: "WRITE", text: "W = Fd", params: [], charPosition: 0, narrationBefore: "" } },
          ] }];
        },
      },
    };
    try { return await run(tx); } finally { unlock?.(); }
  },
};
mock.module(resolve(root, "lib/auth/requireAdmin.ts"), { namedExports: { requireAdminRequest: async () => null } });
mock.module(resolve(root, "lib/auth.ts"), { namedExports: { getUserId: async () => "owner" } });
mock.module(resolve(root, "lib/db/prisma.ts"), { namedExports: { prisma } });
const { PATCH } = load(resolve(root, "app/api/admin/playground/[boardId]/route.ts")) as typeof import("../../app/api/admin/playground/[boardId]/route");
const review = { stars: 4, figure: "drawn", tags: [], feedback: "Keep this feedback", skipped: false };
const request = (action: string) => PATCH(new Request("https://test.invalid/api/admin/playground/board", {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, review }),
}), { params: Promise.resolve({ boardId: "board" }) });

async function verify() {
// Inspection is paused after reading the old metadata; a concurrent review must survive.
turnRead = deferred(); releaseTurns = deferred();
const inspecting = request("inspect");
await turnRead.promise;
const saving = request("review");
releaseTurns.resolve();
assert.equal((await inspecting).status, 200);
assert.equal((await saving).status, 200);
assert.deepEqual(metadata.review, review);
turnRead = undefined; releaseTurns = undefined;

// A review that owns the lock first must be visible to the inspection queued behind it.
metadata = structuredClone(initial);
updateEntered = deferred(); releaseUpdate = deferred();
const firstReview = request("review");
await updateEntered.promise;
const nextInspection = request("inspect");
releaseUpdate.resolve();
await Promise.all([firstReview, nextInspection]);
assert.deepEqual(metadata.review, review);
updateEntered = undefined; releaseUpdate = undefined;

// Discard and review cannot race a complete state back into existence.
const discarding = request("discard");
const lateReview = request("review");
assert.equal((await discarding).status, 200);
assert.equal((await lateReview).status, 400);
assert.equal(metadata.state, "discarded");
assert.equal(metadata.review, undefined);
console.log("verify-playground-review-races: concurrent inspection/review and discard serialization passed");

}
void verify().catch(error => { console.error(error); process.exitCode = 1; });
