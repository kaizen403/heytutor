import type { Server, ServerResponse } from "node:http";
import type { WebSocketServer } from "ws";

/**
 * Longest a restart waits for requests already in flight. systemd's default
 * TimeoutStopSec is 90 s, after which it sends SIGKILL; staying well under it
 * means the process always exits on its own.
 */
export const SHUTDOWN_DRAIN_CAP_MS = 60_000;

/** WebSocket close code 1012: the service is restarting. */
const WS_SERVICE_RESTART = 1012;

export interface GracefulShutdownOptions {
  server: Server;
  /** Speech relays stay open while the HTTP drain runs, then close as a restart. */
  wss?: WebSocketServer;
  capMs?: number;
  exit?: (code: number) => void;
  log?: (message: string) => void;
}

/**
 * Production, 24 Oct 2026: a deploy restart landed between a lesson's turn plan
 * and its teaching request, and the lesson taught nothing. The process had no
 * SIGTERM handler, so every restart cut every lesson in flight.
 *
 * On SIGTERM the server stops accepting connections, lets the requests it has
 * already started (teaching streams, speech streams, saves) finish, closes the
 * speech relays, and exits. The wait is capped, so a hung stream cannot hold
 * the restart. Repeated signals are ignored: the process tree delivers the
 * same SIGTERM more than once (systemd signals the whole unit, and tsx relays
 * it again).
 */
export function installGracefulShutdown(options: GracefulShutdownOptions): { drain: () => void; activeRequests: () => number } {
  const { server, wss } = options;
  const capMs = options.capMs ?? SHUTDOWN_DRAIN_CAP_MS;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const log = options.log ?? ((message: string) => console.log(message));
  const active = new Set<ServerResponse>();
  let draining = false;
  let exited = false;

  const finish = (reason: "drained" | "cap") => {
    if (exited) return;
    exited = true;
    for (const client of wss?.clients ?? []) client.close(WS_SERVICE_RESTART, "server restarting");
    log(`[shutdown] ${reason}, ${active.size} request(s) still open`);
    exit(0);
  };
  const exitWhenDrained = () => {
    if (draining && active.size === 0) finish("drained");
  };

  server.on("request", (_request, response) => {
    active.add(response);
    // A request on a kept-alive connection after the signal is still served,
    // and its connection is not kept for another.
    if (draining && !response.headersSent) response.setHeader("Connection", "close");
    response.once("close", () => {
      active.delete(response);
      exitWhenDrained();
    });
  });

  const drain = () => {
    if (draining) return;
    draining = true;
    log(`[shutdown] SIGTERM: draining ${active.size} request(s), cap ${capMs} ms`);
    server.close();
    server.closeIdleConnections();
    setTimeout(() => finish("cap"), capMs);
    exitWhenDrained();
  };
  process.on("SIGTERM", drain);
  return { drain, activeRequests: () => active.size };
}
