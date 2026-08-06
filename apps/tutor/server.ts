import "./patch-localstorage";
import { createServer, type IncomingMessage } from "http";
import { parse as parseUrl } from "node:url";
import next from "next";
import { WebSocket, WebSocketServer } from "ws";
import { HTUTOR_UID_COOKIE } from "./lib/cookies";
import { flushInBackground, recordTtsSpan } from "./lib/langfuse";
import {
  buildMultiContextSegmentMessages,
  normalizeMultiContextServerPayload,
} from "./lib/ttsRelayProtocol";
import { verifyWsTicket } from "./lib/wsTicket";

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
    "/api/chat",
  ];

  for (const routePath of routes) {
    try {
      await fetch(`${baseUrl}${routePath}`);
    } catch {
      /* warm compile only */
    }
  }
}

interface ElevenLabsWsMessage {
  text?: string;
  flush?: boolean;
  voice_settings?: {
    stability: number;
    similarity_boost: number;
    speed?: number;
  };
  generation_config?: {
    chunk_length_schedule: number[];
  };
}

interface TtsRelayContext {
  traceId?: string;
  sessionId?: string;
  /** ElevenLabs natural voice speed, 0.7–1.2. Pitch-preserving. */
  speed?: number;
}

function relayTtsWebSocket(clientWs: WebSocket, context: TtsRelayContext): void {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL ?? "eleven_flash_v2_5";

  if (!apiKey || !voiceId) {
    clientWs.send(JSON.stringify({ type: "error", message: "TTS not configured" }));
    clientWs.close(1011, "TTS not configured");
    return;
  }

  const upstreamUrl =
    `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/multi-stream-input` +
    `?model_id=${encodeURIComponent(modelId)}&sync_alignment=true&auto_mode=true`;

  const upstream = new WebSocket(upstreamUrl, {
    headers: {
      "xi-api-key": apiKey,
    },
  });

  let upstreamReady = false;
  let pendingSegmentText = "";
  let pendingVoiceSettings: ElevenLabsWsMessage["voice_settings"] | undefined;
  let segmentSequence = 0;
  const segmentStartedAt = { value: 0 };

  upstream.on("open", () => {
    upstreamReady = true;
    clientWs.send(JSON.stringify({ type: "ready" }));
  });

  upstream.on("message", (data, isBinary) => {
    if (clientWs.readyState !== WebSocket.OPEN) {
      return;
    }

    if (isBinary) {
      clientWs.send(data, { binary: true });
      return;
    }

    const payload = data.toString();

    try {
      const normalized = normalizeMultiContextServerPayload(payload);
      clientWs.send(normalized.forwardPayload);
      if (normalized.finalContextId) {
        upstream.send(JSON.stringify({ context_id: normalized.finalContextId, close_context: true }));
      }
    } catch {
      clientWs.send(payload);
    }
  });

  upstream.on("error", (error) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(
        JSON.stringify({
          type: "error",
          message: error instanceof Error ? error.message : "upstream tts error",
        }),
      );
    }
  });

  upstream.on("close", () => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close();
    }
  });

  clientWs.on("message", (data) => {
    if (!upstreamReady || upstream.readyState !== WebSocket.OPEN) {
      return;
    }

    const raw = data.toString();
    try {
      const message = JSON.parse(raw) as ElevenLabsWsMessage;

      if (typeof message.text === "string") {
        if (message.text.length > 0) {
          if (pendingSegmentText.length === 0) {
            segmentStartedAt.value = Date.now();
          }
          pendingSegmentText += message.text;
        }
      }

      if (message.voice_settings && typeof message.voice_settings === "object") {
        const filtered: ElevenLabsWsMessage["voice_settings"] = {
          stability: typeof message.voice_settings.stability === "number"
            ? message.voice_settings.stability
            : 0.5,
          similarity_boost: typeof message.voice_settings.similarity_boost === "number"
            ? message.voice_settings.similarity_boost
            : 0.75,
          ...(typeof message.voice_settings.speed === "number"
            ? { speed: message.voice_settings.speed }
            : {}),
        };
        pendingVoiceSettings = filtered;
      }

      if (message.flush) {
        const segmentText = pendingSegmentText.trim();
        const characters = segmentText.length;

        if (characters > 0 && context.traceId) {
          recordTtsSpan({
            traceId: context.traceId,
            sessionId: context.sessionId,
            characters,
            model: modelId,
            voiceId,
            transport: "ws",
            latencyMs: segmentStartedAt.value > 0 ? Date.now() - segmentStartedAt.value : undefined,
          });
          flushInBackground();
        }

        if (characters > 0) {
          segmentSequence += 1;
          const contextId = `segment_${segmentSequence}`;
          const messages = buildMultiContextSegmentMessages(
            contextId,
            segmentText,
            pendingVoiceSettings ?? {
              stability: 0.5,
              similarity_boost: 0.75,
              ...(context.speed && context.speed !== 1 ? { speed: context.speed } : {}),
            },
          );
          messages.forEach((upstreamMessage) => upstream.send(JSON.stringify(upstreamMessage)));
        }
        pendingSegmentText = "";
        pendingVoiceSettings = undefined;
        segmentStartedAt.value = 0;
      }
    } catch {
      // non-json payloads are dropped — only structured TTS messages are forwarded
    }
  });

  clientWs.on("close", () => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(JSON.stringify({ close_socket: true }));
      upstream.close();
    }
  });

  clientWs.on("error", () => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.close();
    }
  });
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parseUrl(req.url ?? "", true);
    void handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const { pathname, query } = parseUrl(request.url ?? "", true);

    if (pathname === "/api/tts/ws") {
      const cookieHeader = request.headers.cookie ?? "";
      const hasUidCookie = cookieHeader
        .split(";")
        .map((c) => c.trim())
        .some((c) => c.startsWith(`${HTUTOR_UID_COOKIE}=`));

      const ticket = typeof query.ticket === "string" ? query.ticket : "";
      const hasValidTicket = ticket.length > 0 && verifyWsTicket(ticket);

      // Split deploy: host-only htutor_uid on Vercel is not sent to Azure WS.
      // Accept either the cookie (same-origin) or a short-lived ticket query param.
      if (!hasUidCookie && !hasValidTicket) {
        socket.destroy();
        return;
      }

      const traceId = typeof query.traceId === "string" ? query.traceId : undefined;
      const sessionId = typeof query.sessionId === "string" ? query.sessionId : undefined;
      const rawSpeed = typeof query.speed === "string" ? Number(query.speed) : NaN;
      const speed = Number.isFinite(rawSpeed)
        ? Math.min(Math.max(rawSpeed, 0.7), 1.2)
        : undefined;

      wss.handleUpgrade(request, socket, head, (ws) => {
        relayTtsWebSocket(ws, { traceId, sessionId, speed });
      });
      return;
    }

    socket.destroy();
  });

  server.listen(port, () => {
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
