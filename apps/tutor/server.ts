import "./patch-localstorage";
import { createServer, type IncomingMessage } from "http";
import { parse as parseUrl } from "node:url";
import next from "next";
import { WebSocket, WebSocketServer } from "ws";
import { flushInBackground, recordTtsSpan } from "./lib/langfuse";

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
  xi_api_key?: string;
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
    `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input` +
    `?model_id=${encodeURIComponent(modelId)}&sync_alignment=true&optimize_streaming_latency=0`;

  const upstream = new WebSocket(upstreamUrl, {
    headers: {
      "xi-api-key": apiKey,
    },
  });

  let upstreamReady = false;
  let pendingSegmentText = "";
  const segmentStartedAt = { value: 0 };
  let segmentFlushPending = false;
  let upstreamIdleTimer: ReturnType<typeof setTimeout> | null = null;
  const UPSTREAM_IDLE_FINALIZE_MS = 650;

  const clearUpstreamIdleTimer = (): void => {
    if (upstreamIdleTimer !== null) {
      clearTimeout(upstreamIdleTimer);
      upstreamIdleTimer = null;
    }
  };

  const scheduleUpstreamIdleFinalize = (): void => {
    clearUpstreamIdleTimer();
    upstreamIdleTimer = setTimeout(() => {
      upstreamIdleTimer = null;
      if (!segmentFlushPending || clientWs.readyState !== WebSocket.OPEN) {
        return;
      }

      segmentFlushPending = false;
      clientWs.send(JSON.stringify({ isFinal: true }));
    }, UPSTREAM_IDLE_FINALIZE_MS);
  };

  upstream.on("open", () => {
    const initMessage: ElevenLabsWsMessage = {
      text: " ",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        ...(context.speed && context.speed !== 1 ? { speed: context.speed } : {}),
      },
      generation_config: {
        // Default schedule — [50] caused mid-sentence prosody breaks in live tutoring.
        chunk_length_schedule: [120, 160, 250, 290],
      },
    };

    upstream.send(JSON.stringify(initMessage));
    upstreamReady = true;
    clientWs.send(JSON.stringify({ type: "ready" }));
  });

  upstream.on("message", (data, isBinary) => {
    if (clientWs.readyState !== WebSocket.OPEN) {
      return;
    }

    if (isBinary) {
      clientWs.send(data, { binary: true });
      if (segmentFlushPending) {
        scheduleUpstreamIdleFinalize();
      }
      return;
    }

    const payload = data.toString();
    clientWs.send(payload);

    try {
      const message = JSON.parse(payload) as { isFinal?: boolean; is_final?: boolean };
      if (message.isFinal === true || message.is_final === true) {
        segmentFlushPending = false;
        clearUpstreamIdleTimer();
      }
    } catch {
      // non-json upstream payloads are forwarded as-is
    }

    if (segmentFlushPending) {
      scheduleUpstreamIdleFinalize();
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

      if (typeof message.text === "string" && message.text.length > 0) {
        if (pendingSegmentText.length === 0) {
          segmentStartedAt.value = Date.now();
        }

        pendingSegmentText += message.text;
      }

      if (message.flush) {
        const characters = pendingSegmentText.trim().length;

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

        pendingSegmentText = "";
        segmentStartedAt.value = 0;
        segmentFlushPending = true;
        scheduleUpstreamIdleFinalize();
      }
    } catch {
      // non-json payloads are forwarded as-is
    }

    upstream.send(raw);
  });

  clientWs.on("close", () => {
    clearUpstreamIdleTimer();
    if (upstream.readyState === WebSocket.OPEN) {
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
