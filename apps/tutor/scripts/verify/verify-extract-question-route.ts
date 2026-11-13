/**
 * `POST /api/extract-question` against stubbed billing, storage, Langfuse and
 * upstream. Synthetic replies only; no network, database or provider key.
 *
 * Covers: one call when the first reading finds a question; a second look,
 * funded and at higher effort, when it declines; an honest 422 that says how
 * to recover when both decline; refusals in `message.refusal`; an unfunded or
 * failed second look keeping the first decline; high image detail on the relay
 * only; and the decline reply, image size and attempts on the trace.
 *
 * node --experimental-test-module-mocks --import tsx scripts/verify/verify-extract-question-route.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";
import { crc32, deflateSync } from "node:zlib";

const load = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
assert.equal(typeof mock.module, "function", "run with --experimental-test-module-mocks");

type Json = Record<string, unknown>;
const generations: Json[] = [];
const reservations: { ensured: number[]; settled: (number | undefined)[] }[] = [];
let denySecondLook = false;

mock.module(resolve(root, "lib/billing/gate.ts"), {
  namedExports: {
    requireLessonCredits: async () => ({ actor: { userId: "synthetic-user" }, grant: null }),
  },
});
mock.module(resolve(root, "lib/billing/paidUsage.ts"), {
  namedExports: {
    maximumLlmCost: () => 0.01,
    actualLlmCost: (usage: { input?: number; output?: number } | undefined) =>
      usage?.input === undefined || usage.output === undefined
        ? undefined
        : (usage.input + usage.output) / 1_000_000,
    reservePaidUsage: async () => {
      const record = { ensured: [] as number[], settled: [] as (number | undefined)[] };
      reservations.push(record);
      let finished = false;
      return {
        ensureReserved: async (usd: number) => {
          record.ensured.push(usd);
          return denySecondLook ? Response.json({ error: "denied" }, { status: 402 }) : null;
        },
        settle: async (usd?: number) => {
          if (finished) return;
          finished = true;
          record.settled.push(usd);
        },
        finish: async () => {
          if (!finished) record.settled.push(undefined);
          finished = true;
        },
        cancelBeforeDispatch: async () => {},
      };
    },
  },
});
mock.module(resolve(root, "lib/boards/storageQuota.ts"), {
  namedExports: { reserveStorageBytes: async () => {}, StorageQuotaError: class extends Error { status = 413; } },
});
mock.module(resolve(root, "lib/db/prisma.ts"), {
  namedExports: { prisma: { user: { findUnique: async () => ({ id: "synthetic-user" }) } } },
});
mock.module(resolve(root, "lib/obs/langfuse.ts"), {
  namedExports: {
    genTraceId: () => "synthetic-trace",
    startTurnTrace: () => ({ generation: true }),
    endLlmGeneration: (_turn: unknown, params: Json) => { generations.push(params); },
    flushInBackground: () => {},
  },
});
mock.module(resolve(root, "lib/object-store/deletionJobs.ts"), {
  namedExports: { enqueueObjectDeletion: async () => {} },
});
mock.module(resolve(root, "lib/object-store/s3.ts"), {
  namedExports: { uploadImage: async (key: string) => `https://synthetic.invalid/${key}` },
});

const { POST } = load(resolve(root, "app/api/extract-question/route.ts")) as typeof import("../../app/api/extract-question/route");
const { EXTRACT_QUESTION_PROMPT, EXTRACT_QUESTION_SECOND_LOOK_PROMPT } =
  load(resolve(root, "lib/llm/extractQuestion.ts")) as typeof import("../../lib/llm/extractQuestion");
const { DEFAULT_FIREWORKS_VISION_MODEL } =
  load(resolve(root, "lib/llm/fireworksModels.ts")) as typeof import("../../lib/llm/fireworksModels");

// A real 2x1 white PNG: the route reads its size from the header.
function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(2, 0);
header.writeUInt32BE(1, 4);
header[8] = 8;
header[9] = 2;
const PNG = `data:image/png;base64,${Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk("IHDR", header),
  pngChunk("IDAT", deflateSync(Buffer.from([0, 255, 255, 255, 255, 255, 255]))),
  pngChunk("IEND", Buffer.alloc(0)),
]).toString("base64")}`;

type Reply =
  | { content: unknown; refusal?: string; finish?: string; usage?: Json }
  | { status: number };
let queue: Reply[] = [];
let calls: Json[] = [];
globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  calls.push(JSON.parse(String(init?.body)) as Json);
  const next = queue.shift();
  if (!next) throw new Error("unexpected upstream call");
  if ("status" in next) return new Response("synthetic failure", { status: next.status });
  return Response.json({
    id: "chatcmpl-synthetic",
    choices: [{
      message: { role: "assistant", content: next.content, ...(next.refusal ? { refusal: next.refusal } : {}) },
      finish_reason: next.finish ?? "stop",
    }],
    usage: next.usage ?? { prompt_tokens: 900, completion_tokens: 20, total_tokens: 920 },
  });
}) as typeof fetch;

function selectRelay(): void {
  for (const key of Object.keys(process.env)) {
    if (/^(LLM_PROVIDER|OPENAI_COMPAT_|AZURE_OPENAI_|FIREWORKS_)/.test(key)) delete process.env[key];
  }
  Object.assign(process.env, {
    LLM_PROVIDER: "openai_compat",
    OPENAI_COMPAT_BASE_URL: "https://relay.invalid/v1",
    OPENAI_COMPAT_API_KEY: "synthetic-key",
    OPENAI_COMPAT_MODEL: "synthetic-sol",
    OPENAI_COMPAT_FALLBACK: "off",
  });
}

function selectFireworks(): void {
  for (const key of Object.keys(process.env)) {
    if (/^(LLM_PROVIDER|OPENAI_COMPAT_|AZURE_OPENAI_|FIREWORKS_)/.test(key)) delete process.env[key];
  }
  Object.assign(process.env, { LLM_PROVIDER: "fireworks", FIREWORKS_API_KEY: "synthetic-key" });
}

async function run(replies: Reply[]): Promise<{ status: number; body: Json; trace: Json; reservation: (typeof reservations)[number] }> {
  queue = [...replies];
  calls = [];
  generations.length = 0;
  const response = await POST(new Request("http://localhost/api/extract-question", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image: PNG }),
  }));
  assert.equal(queue.length, 0, "every queued upstream reply is used");
  assert.equal(generations.length, 1, "one vision-ocr generation per photo");
  return {
    status: response.status,
    body: (await response.json()) as Json,
    trace: generations[0]!,
    reservation: reservations[reservations.length - 1]!,
  };
}

function prompt(body: Json): string {
  const content = (body.messages as { content: { type: string; text?: string }[] }[])[0]!.content;
  return content.find((part) => part.type === "text")!.text!;
}

function imageUrl(body: Json): Json {
  const content = (body.messages as { content: { type: string; image_url?: Json }[] }[])[0]!.content;
  return content.find((part) => part.type === "image_url")!.image_url!;
}

const QUESTION = "A synthetic block slides 3 m down a ramp. Find its speed.";

async function main(): Promise<void> {
  selectRelay();

  let result = await run([{ content: QUESTION }]);
  assert.equal(result.status, 200);
  assert.equal(result.body.question, QUESTION);
  assert.equal(calls.length, 1, "a found question costs one call");
  assert.equal(prompt(calls[0]!), EXTRACT_QUESTION_PROMPT);
  assert.equal(imageUrl(calls[0]!).detail, "high", "the relay reads the photo at high detail");
  assert.equal(calls[0]!.reasoning_effort, "low", "the first reading stays at the floor effort");
  const meta = result.trace.metadata as Json;
  assert.equal(meta.image_width, 2);
  assert.equal(meta.image_height, 1);
  assert.equal(meta.attempts, 1);
  assert.equal(meta.second_look, undefined);
  assert.deepEqual(result.reservation.ensured, [], "no extra reservation without a second look");

  result = await run([
    { content: "NO_QUESTION", usage: { prompt_tokens: 1730, completion_tokens: 6, total_tokens: 1736 } },
    { content: `Question: ${QUESTION}`, usage: { prompt_tokens: 1800, completion_tokens: 140, total_tokens: 1940 } },
  ]);
  assert.equal(result.status, 200, "a second look can recover a declined photo");
  assert.equal(result.body.question, QUESTION);
  assert.equal(calls.length, 2);
  assert.equal(prompt(calls[1]!), EXTRACT_QUESTION_SECOND_LOOK_PROMPT);
  assert.equal(calls[1]!.reasoning_effort, "medium", "the second look buys more reasoning");
  assert.equal(calls[1]!.model, calls[0]!.model);
  assert.equal(result.reservation.ensured.length, 1, "the second look is funded before dispatch");
  assert.deepEqual(result.reservation.settled, [(1736 + 1940) / 1_000_000], "both calls are settled together");
  const recovered = result.trace.metadata as Json;
  assert.equal(recovered.attempts, 2);
  assert.equal(recovered.second_look, "found");
  assert.equal(recovered.first_decline, "no_question");
  assert.deepEqual(result.trace.usageDetails, { input: 3530, output: 146, total: 3676, cachedInput: undefined });

  result = await run([{ content: "NO_QUESTION" }, { content: "`NO_QUESTION`" }]);
  assert.equal(result.status, 422, "a photo with nothing to work on stays a decline");
  assert.match(String(result.body.error), /No question found/);
  assert.match(String(result.body.error), /crop/i, "the message says how to retake");
  assert.match(String(result.body.error), /type it/i, "the message offers typing");
  assert.equal(result.trace.level, "WARNING");
  assert.equal(result.trace.output, "`NO_QUESTION`", "the decline reply is on the trace");
  const declined = result.trace.metadata as Json;
  assert.equal(declined.reason, "no_question");
  assert.equal(declined.decline, "no_question");
  assert.equal(declined.second_look, "declined");

  result = await run([
    { content: null, refusal: "Synthetic refusal text." },
    { content: QUESTION },
  ]);
  assert.equal(result.status, 200, "a structured refusal gets a second look");
  assert.equal((result.trace.metadata as Json).first_decline, "refusal");

  result = await run([{ content: "", finish: "length" }, { content: "", finish: "length" }]);
  assert.equal(result.status, 422);
  assert.equal((result.trace.metadata as Json).decline, "empty");
  assert.equal((result.trace.metadata as Json).finish_reason, "length", "a truncated reply is visible on the trace");

  result = await run([{ content: "NO_QUESTION" }, { status: 500 }]);
  assert.equal(result.status, 422, "a failed second look keeps the first decline rather than a 502");
  assert.equal((result.trace.metadata as Json).second_look, "failed");
  assert.equal((result.trace.metadata as Json).attempts, 2, "a dispatched second look counts even when its reply fails");
  assert.deepEqual(result.reservation.settled, [undefined], "unknown second-look spend keeps the reserved cap");
  assert.equal(result.trace.usageDetails, undefined, "unknown second-look usage must not report the first call as the total");

  denySecondLook = true;
  result = await run([{ content: "NO_QUESTION" }]);
  denySecondLook = false;
  assert.equal(result.status, 422);
  assert.equal(calls.length, 1, "an unfunded second look is not sent");
  assert.equal((result.trace.metadata as Json).second_look, "unfunded");

  selectFireworks();
  result = await run([{ content: "NO_QUESTION" }, { content: QUESTION }]);
  assert.equal(result.status, 200);
  assert.equal(calls[0]!.model, DEFAULT_FIREWORKS_VISION_MODEL);
  assert.equal(imageUrl(calls[0]!).detail, undefined, "Fireworks gets the plain image part");
  assert.equal(calls[1]!.reasoning_effort, "none", "Fireworks keeps thinking off on the second look");
  assert.equal((result.trace.metadata as Json).image_detail, "default");

  console.log("extract question route verification passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
