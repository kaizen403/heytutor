import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
Object.assign(process.env, { NODE_ENV: "production" });
process.env.LANGFUSE_ENABLED = "false";
globalThis.fetch = async () => { throw new Error("Network is prohibited in transport verification"); };
const createdSocketOptions: Array<{ maxPayload?: number; noServer?: boolean }> = [];
let nextStarted = false;
let readyCalled = false;
let httpCreated = false;
const fakeServer = new EventEmitter() as EventEmitter & { listen: () => void };
fakeServer.listen = () => undefined;
mock.module("http", { namedExports: { createServer: () => { httpCreated = true; return fakeServer; } } });
mock.module("next", { defaultExport: () => { nextStarted = true; return { prepare: () => ({ then: (ready: () => void) => { readyCalled = true; ready(); } }), getRequestHandler: () => () => undefined }; } });
mock.module(load.resolve("ws"), { namedExports: {
  WebSocket: class { static OPEN = 1; static CONNECTING = 0; },
  WebSocketServer: class { constructor(options: { maxPayload?: number; noServer?: boolean }) { createdSocketOptions.push(options); } },
} });
mock.module(resolve(root, "lib/obs/sentryNode.ts"), { namedExports: { captureTtsRelayFailure: () => undefined } });
mock.module(resolve(root, "lib/obs/langfuse.ts"), { namedExports: { flushInBackground: () => undefined, recordTtsSpan: () => undefined } });
mock.module(resolve(root, "lib/billing/track.ts"), { namedExports: { recordTtsSpend: () => undefined } });
mock.module(resolve(root, "lib/object-store/deletionJobs.ts"), { namedExports: { startObjectDeletionWorker: () => () => undefined } });
mock.module(resolve(root, "lib/db/prisma.ts"), { namedExports: { prisma: {
  objectDeletionJob: { findMany: async () => [] },
  ownedTrace: { deleteMany: async () => ({ count: 0 }) },
  abuseIdentity: { deleteMany: async () => ({ count: 0 }) },
} } });

load(resolve(root, "server.ts"));
void new Promise<void>((resolveTick) => setImmediate(resolveTick)).then(() => {
  assert(nextStarted, "custom server must use the safe fake Next application");
  assert(readyCalled, "custom server startup callback must be exercised");
  assert(httpCreated, "custom server must create its safe fake HTTP transport");
  const socketOptions = createdSocketOptions.find((options) => options?.noServer);
  assert(socketOptions?.noServer, `the real custom server must create its WebSocket transport: ${JSON.stringify(createdSocketOptions)}`);
  assert(typeof socketOptions.maxPayload === "number" && socketOptions.maxPayload <= 64 * 1024,
    `transport maxPayload must be <= 64 KiB, got ${socketOptions.maxPayload ?? "ws 100 MiB default"}`);
  console.log("WebSocket transport cap verification passed");
}).catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => mock.restoreAll());
