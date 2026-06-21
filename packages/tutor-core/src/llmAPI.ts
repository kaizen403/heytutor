import { tutorDebug } from "./tutorDebug";

export interface ConversationExchange {
  user: string;
  assistant: string;
}

export interface StreamLLMResponseParams {
  systemPrompt: string;
  userPrompt: string;
  conversationHistory: ConversationExchange[];
  proxyUrl: string;
  sessionId?: string;
  onTraceId?: (traceId: string) => void;
  signal?: AbortSignal;
}

export interface StreamLLMResult {
  text: string;
  traceId: string | null;
  streamStats?: {
    durationMs: number;
    contentChars: number;
    reasoningChars: number;
    ttftContentMs: number | null;
    ttftReasoningMs: number | null;
  };
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAISSSEChoice {
  delta?: { content?: unknown; reasoning_content?: unknown };
}

interface OpenAISSSEPayload {
  choices?: OpenAISSSEChoice[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readContentChunk(eventPayload: unknown): string | null {
  if (!isRecord(eventPayload)) {
    return null;
  }

  const payload = eventPayload as OpenAISSSEPayload;
  const choice = payload.choices?.[0];

  if (!choice || !isRecord(choice.delta)) {
    return null;
  }

  const content = choice.delta.content;

  if (typeof content === "string" && content.length > 0) {
    return content;
  }

  return null;
}

function readReasoningChunk(eventPayload: unknown): string | null {
  if (!isRecord(eventPayload)) {
    return null;
  }

  const payload = eventPayload as OpenAISSSEPayload;
  const choice = payload.choices?.[0];

  if (!choice || !isRecord(choice.delta)) {
    return null;
  }

  const reasoning = choice.delta.reasoning_content;

  if (typeof reasoning === "string" && reasoning.length > 0) {
    return reasoning;
  }

  return null;
}

function buildMessages(
  systemPrompt: string,
  conversationHistory: ConversationExchange[],
  userPrompt: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  for (const exchange of conversationHistory) {
    messages.push({ role: "user", content: exchange.user });
    messages.push({ role: "assistant", content: exchange.assistant });
  }

  messages.push({ role: "user", content: userPrompt });

  return messages;
}

function buildRequestHeaders(sessionId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (sessionId) {
    headers["x-session-id"] = sessionId;
  }

  return headers;
}

export async function streamLLMResponse(
  {
    systemPrompt,
    userPrompt,
    conversationHistory,
    proxyUrl,
    sessionId,
    onTraceId,
    signal,
  }: StreamLLMResponseParams,
  onDelta?: (chunk: string) => void,
): Promise<StreamLLMResult> {
  const model = "accounts/fireworks/models/kimi-k2p6";
  const streamStart = performance.now();

  tutorDebug("llm", "fetch start", {
    model,
    user_chars: userPrompt.length,
    history_turns: conversationHistory.length,
  });

  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: buildRequestHeaders(sessionId),
    signal,
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      temperature: 0.3,
      stream: true,
      reasoning_effort: "none",
      perf_metrics_in_response: true,
      messages: buildMessages(systemPrompt, conversationHistory, userPrompt),
    }),
  });

  tutorDebug("llm", "fetch headers received", {
    status: response.status,
    elapsed_ms: Math.round(performance.now() - streamStart),
  });

  const traceId = response.headers.get("x-heytutor-trace-id");

  if (traceId) {
    onTraceId?.(traceId);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LLM proxy error (${response.status}): ${errorBody}`);
  }

  if (!response.body) {
    throw new Error("LLM proxy returned no response body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bufferedText = "";
  let accumulatedResponseText = "";
  let reasoningChars = 0;
  let contentChars = 0;
  let ttftContentMs: number | null = null;
  let ttftReasoningMs: number | null = null;

  const processLine = (line: string): boolean => {
    if (!line.startsWith("data: ")) {
      return false;
    }

    const jsonString = line.slice(6).trim();

    if (jsonString === "[DONE]") {
      return true;
    }

    try {
      const eventPayload: unknown = JSON.parse(jsonString);
      const reasoningChunk = readReasoningChunk(eventPayload);

      if (reasoningChunk !== null) {
        reasoningChars += reasoningChunk.length;

        if (ttftReasoningMs === null) {
          ttftReasoningMs = Math.round(performance.now() - streamStart);
          tutorDebug("llm", "first reasoning token (ignored for teaching)", {
            ttft_ms: ttftReasoningMs,
            preview: reasoningChunk.slice(0, 80),
          });
        }
      }

      const textChunk = readContentChunk(eventPayload);

      if (textChunk !== null) {
        if (ttftContentMs === null) {
          ttftContentMs = Math.round(performance.now() - streamStart);
          tutorDebug("llm", "first content token", {
            ttft_ms: ttftContentMs,
            preview: textChunk.slice(0, 80),
          });
        }

        contentChars += textChunk.length;
        accumulatedResponseText += textChunk;
        onDelta?.(textChunk);
      }
    } catch (error: unknown) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
    }

    return false;
  };

  const finishResult = (): StreamLLMResult => {
    const durationMs = Math.round(performance.now() - streamStart);
    const streamStats = {
      durationMs,
      contentChars,
      reasoningChars,
      ttftContentMs,
      ttftReasoningMs,
    };

    tutorDebug("llm", "stream complete", streamStats);

    if (accumulatedResponseText.length === 0) {
      tutorDebug("llm", "empty content output", {
        reasoning_chars: reasoningChars,
        hint:
          reasoningChars > 0
            ? "model sent reasoning_content only — check reasoning_effort"
            : "no content or reasoning received",
      });
    }

    return { text: accumulatedResponseText, traceId, streamStats };
  };

  while (true) {
    let readResult: ReadableStreamReadResult<Uint8Array>;

    try {
      readResult = await reader.read();
    } catch (error: unknown) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        return finishResult();
      }

      throw error;
    }

    const { value, done } = readResult;

    if (done) {
      break;
    }

    bufferedText += decoder.decode(value, { stream: true });
    const lines = bufferedText.split(/\r?\n/);
    bufferedText = lines.pop() ?? "";

    for (const line of lines) {
      if (processLine(line)) {
        await reader.cancel();
        return finishResult();
      }
    }
  }

  bufferedText += decoder.decode();

  if (bufferedText.length > 0) {
    for (const line of bufferedText.split(/\r?\n/)) {
      if (processLine(line)) {
        break;
      }
    }
  }

  return finishResult();
}
