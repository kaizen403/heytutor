import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { Langfuse } from "langfuse";

const load = createRequire(import.meta.url);
const CommonJsLangfuse = (load("langfuse") as typeof import("langfuse")).Langfuse;
const realFetch = globalThis.fetch;
const realError = console.error;
const errors: unknown[][] = [];
console.error = (...args: unknown[]) => { errors.push(args); };

async function verify(Client: typeof Langfuse, format: string): Promise<void> {
  const batches: Array<{ body: { input?: unknown; metadata?: unknown } }> = [];
  let uploads = 0;
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/public/media") {
      uploads++;
      return Response.json({ mediaId: "synthetic-media", uploadUrl: null });
    }
    assert.equal(path, "/api/public/ingestion", "all requests terminate in the local fixture");
    batches.push(...JSON.parse(String(init?.body)).batch);
    return Response.json({ successes: [], errors: [] });
  };
  const client = new Client({ publicKey: "pk-lf-synthetic", secretKey: "sk-lf-synthetic",
    baseUrl: "https://synthetic.invalid", flushInterval: 0, flushAt: 1000, fetchRetryCount: 0 });
  try {
    // Let the SDK's own asynchronous crypto import settle for the media control.
    await new Promise<void>(resolve => setImmediate(resolve));
    const input = { label: "data: the stored value", commands: [{ text: "data: tea, milk, water" }],
      ordinary: "data structures", example: "data:text/plain,ordinary unencoded text",
      code: "data:notes;base64,words" };
    client.trace({ id: `literal-data-${format}`, input, metadata: { client_telemetry: input } });
    await client.flushAsync();
    const literal = batches.find(item => item.body.input !== undefined);
    assert(literal);
    assert.deepEqual(literal.body.input, input, `${format}: plain lesson text must arrive unchanged`);
    assert.deepEqual(literal.body.metadata, { client_telemetry: input }, "nested telemetry keeps the same command text");
    assert.equal(uploads, 0, "plain lesson text cannot initiate a media upload");
    assert.equal(errors.length, 0, "plain text cannot invoke the data-URI parser");

    client.trace({ id: `valid-media-${format}`, input: { image: "data:image/png;base64,iVBORw0KGgo=" } });
    await client.flushAsync();
    assert.equal(uploads, 1, "a real base64 media data URI retains the documented upload path");
    const media = batches.at(-1)!.body.input as { image: unknown };
    assert.equal(media.image, "@@@langfuseMedia:type=image/png|id=synthetic-media|source=base64_data_uri@@@");
    assert.equal(errors.length, 0);
    console.log(`Langfuse ${format}: literal data: text and nested metadata preserved; media upload retained`);
  } finally { await client.shutdownAsync(); }
}

async function main(): Promise<void> {
  try {
    const EsmLangfuse = (await import("langfuse")).Langfuse;
    assert.notEqual(EsmLangfuse, CommonJsLangfuse, "exercise both published module entry points");
    await verify(EsmLangfuse, "esm");
    await verify(CommonJsLangfuse, "cjs");
  }
  finally { globalThis.fetch = realFetch; console.error = realError; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
