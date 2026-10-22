import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { Prisma } from "@prisma/client";
import * as accountTypes from "../../lib/account/types";
import * as homeSuggestions from "../../lib/account/homeSuggestions";
import * as personalized from "../../lib/account/personalizedSuggestions";

// Execute the actual GET route. Only auth/database/provider boundaries are fake;
// both callers overlap, and the losing insert returns the observed Prisma P2002.
const source = readFileSync(new URL("../../app/api/home-suggestions/route.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const uniqueError = () => new Prisma.PrismaClientKnownRequestError("Synthetic simultaneous cache creation", { code: "P2002", clientVersion: "synthetic" });
const userId = "synthetic-suggestion-user";
function route(mode: "race" | "other-error" | "missing-winner") {
  let cache: { userId: string; packs: unknown[]; cursor: number; sourceTurnId: null; generatedAt: null } | null = null;
  let writes = 0, calls = 0;
  let release: () => void = () => undefined;
  const started = new Promise<void>((resolve) => { release = resolve; });
  const error = mode === "other-error" ? new Error("Synthetic database unavailable") : uniqueError();
  const db = {
    user: { findUnique: async () => ({ subjects: ["physics"], settings: { showHomeSuggestions: true } }) },
    turn: { findMany: async () => [] },
    homeSuggestionCache: {
      async upsert() {
        if (mode !== "race") throw error;
        const first = ++calls === 1;
        if (first) await started; else release();
        if (cache) throw uniqueError();
        cache = { userId, packs: [], cursor: 0, sourceTurnId: null, generatedAt: null }; writes++;
        return { ...cache };
      },
      async findUnique({ where }: { where: { userId: string } }) {
        assert.equal(where.userId, userId, "a race may only recover the authenticated user's cache");
        return cache ? { ...cache } : null;
      },
      async update() {
        assert.ok(cache); cache.cursor++;
        return { cursor: cache.cursor };
      },
    },
  };
  const stubs: Record<string, unknown> = {
    "@/lib/auth": { requireSessionUserId: async () => userId, ensureUser: async () => undefined, isAuthFailure: () => false },
    "@prisma/client": { Prisma }, "@/lib/db/prisma": { prisma: db },
    "@/lib/account/types": accountTypes, "@/lib/account/homeSuggestions": homeSuggestions,
    "@/lib/account/personalizedSuggestions": personalized,
  };
  const compiledModule = { exports: {} };
  const context = vm.createContext({ module: compiledModule, exports: compiledModule.exports, Response, Request, Headers, Date,
    require(id: string) { if (id in stubs) return stubs[id]; if (id.startsWith("@/lib/")) return {}; throw new Error(`Unexpected test import: ${id}`); },
    console, process: { env: {} }, fetch: () => { throw new Error("No network in suggestion race gate"); },
  });
  vm.runInContext(javascript, context, { filename: "home-suggestions-route.js" });
  return { GET: (compiledModule.exports as { GET: () => Promise<Response> }).GET, state: () => ({ writes, cursor: cache?.cursor }), error };
}
async function main() {
  const concurrent = route("race");
  const responses = await Promise.all([concurrent.GET(), concurrent.GET()]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200], "both first-load requests must receive suggestions after the cache insert race");
  assert.deepEqual(concurrent.state(), { writes: 1, cursor: 2 }, "preserve the winning cache and advance both successful readers");
  for (const response of responses) {
    const body = await response.json();
    assert.ok(body.suggestions.length > 0); assert.equal(body.source, "fallback");
  }
  for (const mode of ["other-error", "missing-winner"] as const) {
    const failed = route(mode);
    await assert.rejects(failed.GET, (error) => error === failed.error, "only a confirmed same-user unique race can recover; real database failures still propagate");
  }
  console.log("Home suggestions: concurrent first loads succeed; non-race and missing-winner failures preserved");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
