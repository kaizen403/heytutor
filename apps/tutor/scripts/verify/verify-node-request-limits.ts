import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { protectNodeRequest } from "../../lib/http/nodeRequest";

async function main() {
let largestParsed = 0;
let handled = 0;
const server = createServer((req, res) => {
  if (!protectNodeRequest(req, res, { maxBytes: 4096 })) return;
  handled++;
  let parsed = 0;
  req.on("data", chunk => { parsed += chunk.length; largestParsed = Math.max(largestParsed, parsed); });
  req.on("end", () => { if (!res.headersSent) res.end(String(parsed)); });
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address === "object");
const url = `http://127.0.0.1:${address.port}/api/chat`;
const rawGet = (target: string): Promise<string> => new Promise((resolve, reject) => {
  const socket = createConnection({ host: "127.0.0.1", port: address.port });
  let reply = "";
  socket.setTimeout(2000, () => socket.destroy(new Error("raw request timed out")));
  socket.on("error", reject);
  socket.on("data", chunk => { reply += chunk.toString(); });
  socket.on("end", () => resolve(reply));
  socket.on("connect", () => socket.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`));
});
try {
  for (const target of ["//", "///", "http://", "http://[bad"]) {
    const prior = handled;
    const reply = await rawGet(target);
    assert.match(reply, /^HTTP\/1\.1 400 /, `malformed target ${target} gets a bounded client error`);
    assert.equal(handled, prior, "a malformed target never reaches Next or consumes a request slot");
    assert.match(reply, /connection: close/i);
  }
  const normal = await fetch(url, { method: "POST", body: "hello" });
  assert.equal(await normal.text(), "5");
  const prior = handled;
  const declared = await fetch(url, { method: "POST", body: "x".repeat(5000) });
  assert.equal(declared.status, 413);
  assert.equal(handled, prior, "declared oversized input never reaches the handler");
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (sent++ < 4) controller.enqueue(new Uint8Array(2048)); else controller.close(); } });
  const chunked = await fetch(url, { method: "POST", body: stream, duplex: "half" } as RequestInit);
  assert.equal(chunked.status, 413);
  assert(largestParsed <= 4096, "the parser never receives bytes beyond its cap");
  console.log("Node transport byte limits passed for declared and chunked requests");
} finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
