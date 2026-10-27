/**
 * Fixture for verify-graceful-shutdown: a plain HTTP server with the real
 * shutdown handler. `/stream` writes one chunk, then the rest after
 * STREAM_MS; `/hang` never ends. The port is printed once listening. BUSY_MS
 * blocks the event loop at the signal. FLUSH_MS makes `beforeExit` (the Sentry
 * flush in production) take that long; FLUSH_MS=hang never settles.
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { installGracefulShutdown } from "../../../lib/http/gracefulShutdown";

const streamMs = Number(process.env.STREAM_MS ?? "1500");
const server = createServer((request, response) => {
  if (request.url === "/stream") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.write("first|");
    setTimeout(() => response.end("last", () => process.stderr.write("STREAM END\n")), streamMs);
    return;
  }
  if (request.url === "/hang") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.write("open|");
    return;
  }
  response.end("ok");
});
const wss = new WebSocketServer({ noServer: true });
let speechUntil = 0;
// BUSY_MS: the event loop is blocked when SIGTERM arrives, as during a scene
// compile, a server render or a GC pause.
const busyMs = Number(process.env.BUSY_MS ?? "0");
if (busyMs > 0) {
  process.on("SIGTERM", () => {
    const until = Date.now() + busyMs;
    while (Date.now() < until) { /* busy */ }
  });
}
installGracefulShutdown({
  server,
  wss,
  capMs: Number(process.env.CAP_MS ?? "60000"),
  log: (message) => process.stderr.write(`${message}\n`),
  // SPEECH_MS: a sentence is still being synthesised for that long after the
  // signal (SPEECH_MS=hang: it never finishes).
  ...(process.env.SPEECH_MS
    ? {
        speech: {
          inFlight: () => (speechUntil === 0 || Date.now() < speechUntil ? 1 : 0),
          beginDrain: () => {
            process.stderr.write("SPEECH DRAIN\n");
            speechUntil = process.env.SPEECH_MS === "hang" ? Number.POSITIVE_INFINITY : Date.now() + Number(process.env.SPEECH_MS);
          },
        },
      }
    : {}),
  ...(process.env.FLUSH_MS
    ? {
        flushCapMs: Number(process.env.FLUSH_CAP_MS ?? "1500"),
        beforeExit: () => new Promise<void>((done) => {
          process.stderr.write("FLUSH START\n");
          if (process.env.FLUSH_MS === "hang") return;
          setTimeout(() => {
            process.stderr.write("FLUSHED\n");
            done();
          }, Number(process.env.FLUSH_MS));
        }),
      }
    : {}),
});
// Another SIGTERM listener, as the Sentry client registers in production.
process.once("SIGTERM", () => undefined);
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object") process.stdout.write(`PORT ${address.port}\n`);
});
