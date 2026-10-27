/**
 * Fixture for verify-graceful-shutdown: a plain HTTP server with the real
 * shutdown handler. `/stream` writes one chunk, then the rest after
 * STREAM_MS; `/hang` never ends. The port is printed once listening. BUSY_MS
 * blocks the event loop at the signal.
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { installGracefulShutdown } from "../../../lib/http/gracefulShutdown";

const streamMs = Number(process.env.STREAM_MS ?? "1500");
const server = createServer((request, response) => {
  if (request.url === "/stream") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.write("first|");
    setTimeout(() => response.end("last"), streamMs);
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
});
// Another SIGTERM listener, as the Sentry client registers in production.
process.once("SIGTERM", () => undefined);
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object") process.stdout.write(`PORT ${address.port}\n`);
});
