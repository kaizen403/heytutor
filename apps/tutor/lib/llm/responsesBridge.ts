/**
 * Chat Completions over the OpenAI Responses API, for a relay whose
 * `/v1/responses` route is faster than its `/v1/chat/completions` route
 * (`OPENAI_COMPAT_API=responses`). Every caller still builds a chat body and
 * reads a chat reply; this module translates both ways, so planners, teaching,
 * notes chat, suggestions, photo reading and the lab need no other change.
 *
 * Measured on tokens-flow (28 Oct 2026, gpt-6.1-sol, 12 interleaved rounds):
 * chat requests reach a 34 tok/s pool half the time; Responses requests never
 * do (median 142 against 80 tok/s while writing). One Responses upstream wraps
 * JSON replies in `<escape>…</escape>` and sends the whole reply as one delta;
 * the wrapper is stripped here, in plain and streamed replies alike.
 */

type Json = Record<string, unknown>;

const ESCAPE_OPEN = "<escape>";
const ESCAPE_CLOSE = "</escape>";

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `<base>/chat/completions` to `<base>/responses`. */
export function responsesUrl(chatUrl: string): string {
  return chatUrl.replace(/\/chat\/completions$/, "/responses");
}

function contentPart(part: unknown): unknown {
  if (!isRecord(part)) return part;
  if (part.type === "text") return { type: "input_text", text: part.text };
  if (part.type === "image_url") {
    const image = part.image_url;
    // `detail` is required by the Responses schema; chat callers may omit it.
    return { type: "input_image", image_url: isRecord(image) ? image.url : image, detail: isRecord(image) && typeof image.detail === "string" ? image.detail : "auto" };
  }
  return part;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : "")).join("");
}

/**
 * A chat body (already through `providerChatBody`) as a Responses body. System
 * and developer messages become `instructions`; the rest become `input`.
 */
export function chatBodyToResponses(body: Json): Json {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const instructions = messages
    .filter((message) => isRecord(message) && (message.role === "system" || message.role === "developer"))
    .map((message) => textOf((message as Json).content))
    .filter(Boolean)
    .join("\n\n");
  const input = messages
    .filter((message) => isRecord(message) && message.role !== "system" && message.role !== "developer")
    .map((message) => {
      const { role, content } = message as Json;
      if (role === "assistant") return { role, content: textOf(content) };
      return { role, content: Array.isArray(content) ? content.map(contentPart) : content };
    });
  const translated: Json = { model: body.model, input, store: false };
  if (instructions) translated.instructions = instructions;
  if (body.stream === true) translated.stream = true;
  if (typeof body.reasoning_effort === "string") translated.reasoning = { effort: body.reasoning_effort };
  const cap = body.max_completion_tokens ?? body.max_tokens;
  if (typeof cap === "number" && Number.isFinite(cap)) translated.max_output_tokens = cap;
  if (typeof body.service_tier === "string") translated.service_tier = body.service_tier;
  if (typeof body.temperature === "number") translated.temperature = body.temperature;
  const format = body.response_format;
  if (isRecord(format)) {
    if (format.type === "json_object") translated.text = { format: { type: "json_object" } };
    else if (format.type === "json_schema" && isRecord(format.json_schema)) {
      translated.text = { format: { type: "json_schema", ...format.json_schema } };
    }
  }
  return translated;
}

/** Strip a whole-reply `<escape>…</escape>` wrapper. */
export function unwrapEscape(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith(ESCAPE_OPEN) && trimmed.endsWith(ESCAPE_CLOSE)
    ? trimmed.slice(ESCAPE_OPEN.length, trimmed.length - ESCAPE_CLOSE.length)
    : text;
}

/** Responses usage (or the chat-shaped usage one upstream sends) as chat usage. */
export function responsesUsageToChat(usage: unknown): Json | undefined {
  if (!isRecord(usage)) return undefined;
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const outputDetails = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details : {};
  const prompt = number(usage.input_tokens) ?? number(usage.prompt_tokens);
  const completion = number(usage.output_tokens) ?? number(usage.completion_tokens);
  const total = number(usage.total_tokens) ?? (prompt !== undefined && completion !== undefined ? prompt + completion : undefined);
  const cached = number(inputDetails.cached_tokens);
  const reasoning = number(outputDetails.reasoning_tokens);
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    ...(cached !== undefined ? { prompt_tokens_details: { cached_tokens: cached } } : {}),
    ...(reasoning !== undefined ? { completion_tokens_details: { reasoning_tokens: reasoning } } : {}),
  };
}

function finishReason(response: Json): string {
  if (response.status !== "incomplete") return "stop";
  const details = isRecord(response.incomplete_details) ? response.incomplete_details : {};
  return details.reason === "content_filter" ? "content_filter" : "length";
}

/** A finished Responses object as a chat completion. */
export function responsesJsonToChat(response: Json, model: unknown): Json {
  const output = Array.isArray(response.output) ? response.output : [];
  const text = output
    .filter((item) => isRecord(item) && item.type === "message")
    .flatMap((item) => (Array.isArray((item as Json).content) ? (item as Json).content as unknown[] : []))
    .map((part) => (isRecord(part) && part.type === "output_text" && typeof part.text === "string" ? part.text : ""))
    .join("");
  return {
    id: response.id,
    object: "chat.completion",
    model: response.model ?? model,
    choices: [{ index: 0, message: { role: "assistant", content: unwrapEscape(text) }, finish_reason: finishReason(response) }],
    usage: responsesUsageToChat(response.usage),
    ...(typeof response.service_tier === "string" ? { service_tier: response.service_tier } : {}),
  };
}

/**
 * A Responses event stream as a chat completion stream: text deltas become
 * `choices[0].delta.content`, completion becomes a finish chunk, a usage chunk
 * and `[DONE]`. A failed response errors the stream.
 */
export function responsesStreamToChat(body: ReadableStream<Uint8Array>, model: unknown): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let id: unknown = null;
  // Escape handling: decide once the opening is known, then hold back a tail
  // long enough to drop a closing tag at the end.
  let decided = false;
  let wrapped = false;
  let pending = "";
  let finished = false;
  let sent = 0;
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, payload: unknown) => {
    sent += 1;
    controller.enqueue(encoder.encode(`data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`));
  };
  const chunk = (delta: Json, finish: string | null = null) => ({
    id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: finish }],
  });
  const emitText = (controller: ReadableStreamDefaultController<Uint8Array>, text: string) => {
    if (text) send(controller, chunk({ content: text }));
  };
  const pushText = (controller: ReadableStreamDefaultController<Uint8Array>, piece: string) => {
    pending += piece;
    if (!decided) {
      const head = pending.trimStart();
      if (head.length < ESCAPE_OPEN.length && ESCAPE_OPEN.startsWith(head)) return;
      decided = true;
      wrapped = head.startsWith(ESCAPE_OPEN);
      if (wrapped) pending = head.slice(ESCAPE_OPEN.length);
    }
    if (!wrapped) {
      emitText(controller, pending);
      pending = "";
      return;
    }
    // Hold back enough for a closing tag plus any whitespace after it.
    const keep = ESCAPE_CLOSE.length + (pending.length - pending.trimEnd().length);
    if (pending.length > keep) {
      emitText(controller, pending.slice(0, pending.length - keep));
      pending = pending.slice(pending.length - keep);
    }
  };
  const flushText = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    let rest = pending;
    if (wrapped && rest.trimEnd().endsWith(ESCAPE_CLOSE)) rest = rest.trimEnd().slice(0, -ESCAPE_CLOSE.length);
    emitText(controller, rest);
    pending = "";
  };
  const handle = (controller: ReadableStreamDefaultController<Uint8Array>, data: string) => {
    let event: Json;
    try { event = JSON.parse(data) as Json; } catch { return; }
    const response = isRecord(event.response) ? event.response : null;
    if (response && id === null) id = response.id ?? null;
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") pushText(controller, event.delta);
    else if (event.type === "response.completed" || event.type === "response.incomplete") {
      flushText(controller);
      send(controller, chunk({}, response ? finishReason(response) : "stop"));
      const usage = responsesUsageToChat(response?.usage);
      if (usage) send(controller, { id, object: "chat.completion.chunk", model, choices: [], usage });
      send(controller, "[DONE]");
      finished = true;
    } else if (event.type === "response.failed" || event.type === "error") {
      throw new Error(`relay responses stream failed: ${JSON.stringify(response?.error ?? event.error ?? event.message ?? "unknown").slice(0, 200)}`);
    }
  };
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            for (const line of buffer.split("\n")) if (line.startsWith("data:")) handle(controller, line.slice(5).trim());
            if (!finished) {
              // The stream ended without a completion event: deliver what arrived.
              flushText(controller);
              send(controller, "[DONE]");
            }
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          const before = sent;
          for (const line of lines) if (line.startsWith("data:")) handle(controller, line.slice(5).trim());
          if (sent !== before) return;
        }
      } catch (error) {
        controller.error(error);
        await reader.cancel().catch(() => undefined);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

/**
 * A failure the relay reported inside a 200, as the status a Chat Completions
 * provider would have answered with: 429 for rate limits, otherwise 502. The
 * callers' retry, alternate-model and circuit logic all key on the status.
 */
function upstreamFailure(detail: unknown): Response {
  const text = JSON.stringify(detail ?? "unknown").slice(0, 500);
  const status = /rate.?limit|429|quota|too many/i.test(text) ? 429 : 502;
  return Response.json({ error: { message: `relay responses failure: ${text}`, type: "relay_responses_error" } }, { status });
}

function failureOf(event: Json): unknown {
  if (event.type === "error") return event.error ?? event.message ?? event;
  if (event.type === "response.failed") return isRecord(event.response) ? event.response.error ?? event.response : event;
  return null;
}

/**
 * Read a Responses stream until its first text, completion or failure. A
 * failure before any text becomes an error status; otherwise the bytes read so
 * far are replayed ahead of the rest of the stream.
 */
async function openStream(body: ReadableStream<Uint8Array>): Promise<ReadableStream<Uint8Array> | Response> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const seen: Uint8Array[] = [];
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      if (seen.length === 0) return upstreamFailure("empty stream");
      break;
    }
    seen.push(value);
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    let decided = false;
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      let event: Json;
      try { event = JSON.parse(line.slice(5).trim()) as Json; } catch { continue; }
      const failure = failureOf(event);
      if (failure !== null) {
        await reader.cancel().catch(() => undefined);
        return upstreamFailure(failure);
      }
      if (event.type === "response.output_text.delta" || event.type === "response.completed" || event.type === "response.incomplete") decided = true;
    }
    if (decided) break;
  }
  let replay = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (replay < seen.length) {
        controller.enqueue(seen[replay]!);
        replay += 1;
        return;
      }
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

/**
 * `fetch` for a chat request, sent to the Responses route and answered in chat
 * shape. Error statuses pass through untouched so retry and failure handling
 * see exactly what the relay said; a failure the relay reports inside a 200
 * (an error event before any text, a failed or non-Responses body, a body that
 * does not parse) becomes 429 or 502 so it is retried and counted like one.
 */
export async function chatViaResponses(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (typeof init?.body !== "string") throw new TypeError("chatViaResponses needs a JSON string body");
  const body = JSON.parse(init.body) as Json;
  const translated = chatBodyToResponses(body);
  const response = await fetchImpl(responsesUrl(url), { ...init, body: JSON.stringify(translated) });
  if (!response.ok) return response;
  if (translated.stream === true) {
    if (!response.body) return upstreamFailure("no stream body");
    const opened = await openStream(response.body);
    if (opened instanceof Response) return opened;
    return new Response(responsesStreamToChat(opened, body.model), {
      status: response.status,
      headers: { "content-type": "text/event-stream" },
    });
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    return upstreamFailure(`unparseable body: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(json) || !Array.isArray(json.output)) return upstreamFailure(isRecord(json) ? json.error ?? "not a Responses object" : "not a Responses object");
  if (json.status === "failed" || json.status === "cancelled") return upstreamFailure(json.error ?? json.status);
  return Response.json(responsesJsonToChat(json, body.model), { status: response.status });
}
