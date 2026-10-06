import type { IncomingMessage, ServerResponse } from "node:http";
import { requestBodyLimitForPath, MAX_JSON_BODY_BYTES } from "./resourceLimits";

let requests = 0;
let uploads = 0;

/** Intercept native data delivery before Next/Auth.js attach parsers. Node's
 * socket reader remains intact, including backpressure and aborted signals. */
export function protectNodeRequest(req: IncomingMessage, res: ServerResponse, options: { maxBytes?: number } = {}): boolean {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const maxBytes = options.maxBytes ?? requestBodyLimitForPath(path);
  const large = !["GET", "HEAD"].includes(req.method ?? "GET") && maxBytes > MAX_JSON_BODY_BYTES;
  let rejected = false;
  const reject = (status: number, message: string) => {
    if (rejected) return;
    rejected = true;
    req.pause();
    if (res.headersSent) { req.destroy(); res.destroy(); return; }
    res.once("finish", () => req.destroy());
    if (!res.headersSent) {
      res.writeHead(status, { "content-type": "application/json", "connection": "close", "cache-control": "no-store", ...(status === 429 ? { "retry-after": "5" } : {}) });
      res.end(JSON.stringify({ error: message }));
    }
  };
  const declared = req.headers["content-length"];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) { reject(413, "Request body exceeds the size limit."); return false; }
  if (requests >= 128 || (large && uploads >= 8)) { reject(429, "The service is busy. Please retry."); return false; }
  requests++; if (large) uploads++;
  let released = false;
  const release = () => { if (released) return; released = true; requests--; if (large) uploads--; };
  res.once("finish", release); res.once("close", release);
  let bytes = 0;
  const emit = req.emit.bind(req);
  req.emit = (event: string | symbol, ...args: unknown[]) => {
    if (event === "data") {
      const chunk = args[0];
      bytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk instanceof Uint8Array ? chunk.byteLength : maxBytes + 1;
      if (bytes > maxBytes) reject(413, "Request body exceeds the size limit.");
      if (rejected) return false;
    }
    return emit(event, ...args);
  };
  req.on("error", () => {});
  // Next's middleware body clone copies a PassThrough's fields onto this
  // request, `_events` included, which drops the listener above. A client
  // that disconnects before the route has read the body then destroys the
  // request with `Error: aborted` (ECONNRESET) and no listener: an
  // uncaughtException. Node emits that error on a later tick, so listening
  // again when the socket closes still catches it.
  const socket = req.socket;
  const guardDisconnect = () => { req.on("error", () => {}); };
  socket.once("close", guardDisconnect);
  res.once("finish", () => socket.off("close", guardDisconnect));
  return true;
}
