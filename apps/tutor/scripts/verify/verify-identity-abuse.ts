import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock, test } from "node:test";

// Authentication and the database are fakes. The shared authorization helper
// executes unchanged, and an accidental external request fails the test.
Object.assign(process.env, { NODE_ENV: "production" });
process.env.AUTH_DISABLED = "0";
process.env.NEXT_PUBLIC_AUTH_DISABLED = "0";
globalThis.fetch = async () => { throw new Error("Security verification prohibits network requests"); };

const load = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
type User = { id: string; email: string | null };
const users = new Map<string, User>();
let sessionUserId: string | null = null;

mock.module(resolve(root, "auth.ts"), {
  namedExports: { auth: async () => sessionUserId ? { user: { id: sessionUserId } } : null },
});
mock.module(resolve(root, "lib/db/prisma.ts"), {
  namedExports: {
    prisma: {
      user: {
        findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null,
        upsert: async ({ where, create }: { where: { id: string }; create: User }) => {
          if (!users.has(where.id)) users.set(where.id, create);
          return users.get(where.id);
        },
      },
      userSettings: { upsert: async () => undefined },
    },
  },
});

const authorization = load(resolve(root, "lib/auth.ts")) as typeof import("../../lib/auth");

test("a valid JWT for a deleted account does not authenticate", async () => {
  users.clear();
  sessionUserId = "deleted-user";
  assert.equal(await authorization.getUserId(), null);
});

test("a deleted account is rejected by the shared authenticated route guard", async () => {
  users.clear();
  sessionUserId = "deleted-user";
  const result = await authorization.requireSessionUserId();
  assert.notEqual(typeof result, "string");
  if (typeof result !== "string") assert.equal(result.status, 401);
});

test("ensureUser cannot recreate a deleted account from an old production session", async () => {
  users.clear();
  sessionUserId = "deleted-user";
  await assert.rejects(() => authorization.ensureUser("deleted-user"));
  assert.equal(users.size, 0);
});

test("a current account still authenticates and can initialize its settings", async () => {
  users.clear();
  users.set("current-user", { id: "current-user", email: "student@example.edu" });
  sessionUserId = "current-user";
  assert.equal(await authorization.getUserId(), "current-user");
  assert.equal(await authorization.requireSessionUserId(), "current-user");
  await authorization.ensureUser("current-user");
  assert.equal(users.size, 1);
});
