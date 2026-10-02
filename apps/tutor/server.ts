import "./patch-localstorage";

import { createServer, type IncomingMessage } from "http";
import { Socket } from "node:net";
import { parse as parseUrl } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";
import { HTUTOR_UID_COOKIE } from "./lib/cookies";
import { relayTtsWebSocket } from "./lib/tts/wsRelay";
import { protectNodeRequest } from "./lib/http/nodeRequest";
import { startObjectDeletionWorker } from "./lib/object-store/deletionJobs";
import { prisma } from "./lib/db/prisma";
import { assertOwnedTrace } from "./lib/obs/traceOwnership";
import { readTraceIdHeader } from "@heytutor/tutor-core";
import { readWsTicket } from "./lib/tts/wsTicket";
import { isAuthDisabled } from "./lib/authDisabled";
import { getTurnGrant } from "./lib/billing/grant";
import {
  tryAcquireTtsWsConnection,
  releaseTtsWsConnection,
} from "./lib/tts/wsRelayLimits";
import { normalizeVoiceKey } from "@heytutor/tutor-core";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "localhost";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

/** Pre-compile hot API routes so the first browser load does not race webpack. */
async function warmDevRoutes(baseUrl: string): Promise<void> {
  const warmupBoardId = "00000000-0000-4000-8000-000000000000";
  const routes = [
    "/api/boards",
    `/api/boards/${warmupBoardId}`,
    `/api/boards/${warmupBoardId}/turns`,
    "/api/chat",
    "/api/tts/ws-ticket",
    "/api/tts/stream",
  ];

  for (const routePath of routes) {
    try {
      await fetch(`${baseUrl}${routePath}`);
    } catch {
      /* warm compile only */
    }
  }
}

app.prepare().then(() => {
  startObjectDeletionWorker();
  const server = createServer({ maxHeaderSize: 16 * 1024 }, (req, res) => {
    if (!protectNodeRequest(req, res)) return;
    const parsedUrl = parseUrl(req.url ?? "", true);
    const startedAt = Date.now();
    res.on("finish", () => {
      const path = parsedUrl.pathname ?? "";
      if (
        path.startsWith("/api/chat") ||
        path.startsWith("/api/billing") ||
        path.startsWith("/api/tts") ||
        path.startsWith("/api/boards")
      ) {
        console.log(`[http] ${req.method ?? "GET"} ${path} ${res.statusCode} ${Date.now() - startedAt}ms`);
      }
    });
    void handle(req, res, parsedUrl);
  });

  server.headersTimeout = 15_000;
  server.requestTimeout = 120_000;
  server.keepAliveTimeout = 5_000;
  server.maxConnections = 256;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    if (socket instanceof Socket) socket.setTimeout(10_000, () => socket.destroy());
    void (async () => {
    const { pathname, query } = parseUrl(request.url ?? "", true);

    if (pathname === "/api/tts/ws") {
      const cookieHeader = request.headers.cookie ?? "";
      const cookieUserId = cookieHeader
        .split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${HTUTOR_UID_COOKIE}=`))
        ?.slice(`${HTUTOR_UID_COOKIE}=`.length);

      const ticket = typeof query.ticket === "string" ? query.ticket : "";
      const ticketUser = ticket.length > 0 ? readWsTicket(ticket) : null;

      // Auth-on: session-minted ticket only. Cookie identity must not spend.
      const userId = isAuthDisabled()
        ? (ticketUser?.userId ?? cookieUserId)
        : ticketUser?.userId;
      if (!userId) {
        socket.destroy();
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) { socket.destroy(); return; }
      const origin = request.headers.origin;
      if (!origin || new URL(origin).host !== request.headers.host) { socket.destroy(); return; }
      const grant = getTurnGrant(userId);
      if (!grant) {
        socket.destroy();
        return;
      }
      const traceId = readTraceIdHeader(typeof query.traceId === "string" ? query.traceId : null) ?? grant.lessonTraceId;
      const sessionId = typeof query.sessionId === "string" ? query.sessionId : undefined;
      if (!grant.allowedTraceIds.has(traceId) || !await assertOwnedTrace(userId, traceId, sessionId)) { socket.destroy(); return; }
      // Only a signed, session-minted ticket plus a server-side bypass grant
      // may open the extra staff sockets; anonymous dev cookies keep the base cap.
      const authenticatedSkipGates = !isAuthDisabled() && ticketUser?.userId === userId && grant.skipGates;
      if (!tryAcquireTtsWsConnection(userId, authenticatedSkipGates)) {
        socket.destroy();
        return;
      }

      const rawSpeed = typeof query.speed === "string" ? Number(query.speed) : NaN;
      const speed = Number.isFinite(rawSpeed)
        ? Math.min(Math.max(rawSpeed, 0.7), 1.2)
        : undefined;
      const voiceKey = normalizeVoiceKey(
        typeof query.lang === "string" ? query.lang : undefined,
      );
      const lowLatency = query.model === "flash";

      let released = false;
      const releaseConnection = () => {
        if (released) return;
        released = true;
        releaseTtsWsConnection(userId);
      };
      socket.once("close", releaseConnection);
      try {
        if (socket instanceof Socket) socket.setTimeout(0);
        wss.handleUpgrade(request, socket, head, (ws) => {
          ws.once("close", releaseConnection);
          relayTtsWebSocket(ws, { userId, grant, traceId, sessionId, speed, voiceKey, lowLatency, releaseConnection });
        });
      } catch {
        releaseConnection();
        socket.destroy();
      }
      return;
    }

    socket.destroy();
    })().catch(() => socket.destroy());
  });

  server.listen(port, process.env.LISTEN_HOST ?? "127.0.0.1", () => {
    const baseUrl = `http://${hostname}:${port}`;
    console.log(`> accelute ready on ${baseUrl}`);
    console.log(`> TTS WebSocket relay on ws://${hostname}:${port}/api/tts/ws`);

    if (dev) {
      void warmDevRoutes(baseUrl).then(() => {
        console.log("> dev routes precompiled");
      });
    }
  });
});
