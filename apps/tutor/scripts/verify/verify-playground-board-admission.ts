/** Real board route and account-lock consumer; deterministic offline DB/auth ports. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";
import { Prisma } from "@prisma/client";

const app = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
type Board = {
  id: string; userId: string; title: string; preview: string; playground: unknown;
  createdAt: Date; updatedAt: Date; pinnedAt: null; archivedAt: null; visibility: string;
};
const boards = new Map<string, Board>();
let userId: string | null = "owner";
let admin = false;
let blockedDeletion = false;
let transactions = 0;
let lockTail = Promise.resolve();
const playground = { topicId: "physics|12|ohms-law-and-resistance", difficulty: "easy", state: "running" };
const row = (id: string, meta: unknown = null): Board => ({
  id, userId: "owner", title: id, preview: "", playground: meta, createdAt: new Date(0), updatedAt: new Date(0),
  pinnedAt: null, archivedAt: null, visibility: "private",
});
const prisma = {
  user: { findUnique: async () => ({ email: admin ? "admin@example.test" : "student@example.test" }) },
  async $transaction<T>(run: (tx: unknown) => Promise<T>): Promise<T> {
    transactions++;
    const previous = lockTail;
    let unlock!: () => void;
    lockTail = new Promise<void>(resolve => { unlock = resolve; });
    await previous;
    let locked = false;
    const tx = {
      async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
        assert.match(strings.join("?"), /SELECT id FROM users WHERE id = \? FOR UPDATE/);
        assert.deepEqual(values, ["owner"]);
        locked = true;
        return [{ id: "owner" }];
      },
      board: {
        async findFirst({ where }: { where: { id: string; userId: string } }) {
          assert(locked, "board admission must own the real account-lock consumer");
          const value = boards.get(where.id);
          return value?.userId === where.userId ? value : null;
        },
        async count({ where }: { where: { userId: string; playground?: { equals: unknown } } }) {
          assert(locked);
          return [...boards.values()].filter(board => board.userId === where.userId &&
            (!where.playground || (where.playground.equals === Prisma.DbNull && board.playground === null))).length;
        },
        async create({ data }: { data: { id: string; userId: string; title: string; preview: string; playground?: unknown; visibility: string } }) {
          assert(locked);
          const value = { ...row(data.id), ...data };
          boards.set(value.id, value);
          return value;
        },
      },
      objectDeletionJob: { findUnique: async () => blockedDeletion ? { id: "pending-deletion" } : null },
    };
    try { return await run(tx); } finally { unlock(); }
  },
};

Object.assign(process.env, { NODE_ENV: "production", AUTH_DISABLED: "1", NEXT_PUBLIC_AUTH_DISABLED: "1" });
globalThis.fetch = async () => { throw new Error("External network prohibited in board admission verification"); };
mock.module(resolve(app, "auth.ts"), { namedExports: { auth: async () => userId ? { user: { id: userId, email: admin ? "admin@example.test" : "student@example.test" } } : null } });
mock.module(resolve(app, "lib/auth.ts"), { namedExports: { getUserId: async () => userId, ensureUser: async () => {} } });
mock.module(resolve(app, "lib/auth/admins.ts"), { namedExports: { isAdminEmail: async (email: unknown) => email === "admin@example.test" } });
mock.module(resolve(app, "lib/db/prisma.ts"), { namedExports: { prisma } });
const { POST } = load(resolve(app, "app/api/boards/route.ts")) as typeof import("../../app/api/boards/route");
const { MAX_ACCOUNT_BOARDS } = load(resolve(app, "lib/boards/storageQuota.ts")) as typeof import("../../lib/boards/storageQuota");
assert.equal(MAX_ACCOUNT_BOARDS, 200, "the ordinary student board limit must stay at 200");

const request = (id: string, meta?: unknown, title = "Test board") => POST(new Request("https://example.test/api/boards", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, title, ...(meta === undefined ? {} : { playground: meta }) }),
}));
function seed(count: number) {
  boards.clear();
  for (let index = 0; index < count; index++) boards.set(`ordinary-${index}`, row(`ordinary-${index}`));
  userId = "owner"; admin = false; blockedDeletion = false; transactions = 0;
}

async function main() {
  let failures = 0;
  const check = async (name: string, run: () => Promise<void>) => {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failures++; console.error(`FAIL ${name}`, error); }
  };
  await check("nine authenticated admin recordings can start at the ordinary board limit", async () => {
    seed(MAX_ACCOUNT_BOARDS); admin = true;
    for (let index = 0; index < 9; index++) {
      const response = await request(`recording-${index}`, playground);
      assert.equal(response.status, 200, "the production 429 must no longer block an authenticated recording");
      const saved = await response.json();
      assert.equal(saved.board.visibility, "private");
      assert.equal(saved.board.playground.state, "running");
    }
    assert.equal(boards.size, MAX_ACCOUNT_BOARDS + 9);
  });
  await check("student cannot claim the exception with metadata or a playground title", async () => {
    seed(MAX_ACCOUNT_BOARDS);
    assert.equal((await request("spoofed-metadata", playground)).status, 401);
    assert.equal(transactions, 0, "the real admin gate rejects before storage admission, even with production auth hatches set");
    const titled = await request("spoofed-title", undefined, "[Playground] physics|12|ohms-law-and-resistance · easy");
    assert.equal(titled.status, 429);
    assert.equal((await titled.json()).error, "board storage quota exceeded");
    assert.equal(boards.size, MAX_ACCOUNT_BOARDS);
  });
  await check("ordinary admin boards retain the account limit and invalid metadata is rejected", async () => {
    seed(MAX_ACCOUNT_BOARDS); admin = true;
    assert.equal((await request("ordinary-admin")).status, 429);
    const before = transactions;
    assert.equal((await request("invalid-recording", {})).status, 400);
    assert.equal(transactions, before);
    assert.equal(boards.size, MAX_ACCOUNT_BOARDS);
  });
  await check("recorded playground boards do not consume ordinary board slots", async () => {
    seed(MAX_ACCOUNT_BOARDS - 1);
    for (let index = 0; index < 9; index++) boards.set(`saved-recording-${index}`, row(`saved-recording-${index}`, playground));
    assert.equal((await request("last-ordinary-slot")).status, 200);
    assert.equal((await request("over-ordinary-limit")).status, 429);
  });
  await check("concurrent ordinary creates retain a single final slot and idempotent retries", async () => {
    seed(MAX_ACCOUNT_BOARDS - 1);
    const responses = await Promise.all([request("parallel-a"), request("parallel-b")]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 429]);
    assert.equal(boards.size, MAX_ACCOUNT_BOARDS);
    const winner = responses[0]!.status === 200 ? "parallel-a" : "parallel-b";
    assert.equal((await request(winner)).status, 200, "an existing owned board remains retryable at the cap");
  });
  await check("admin exception retains pending deletion fences and authentication", async () => {
    seed(MAX_ACCOUNT_BOARDS); admin = true; blockedDeletion = true;
    assert.equal((await request("pending-cleanup", playground)).status, 409);
    assert.equal(boards.size, MAX_ACCOUNT_BOARDS);
    userId = null;
    assert.equal((await request("logged-out", playground)).status, 401);
  });
  assert.equal(failures, 0, `playground board admission: ${failures} groups failed`);
  console.log("verify-playground-board-admission: six actual route groups; no external services");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
