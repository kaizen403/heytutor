export type ServerChatKind = "planner" | "teaching";

/** The narration voice. Clients cannot move it; every teaching call runs here. */
export const TEACHING_TEMPERATURE = 0.3;
/** Planners emit audited JSON; extra sampling variance only buys repair rounds. */
export const PLANNER_DEFAULT_TEMPERATURE = 0;
export const PLANNER_MAX_TEMPERATURE = 1;

/**
 * A planner may ask for any temperature inside [0, 1]. A finite value outside
 * that range is clamped into it; a missing or non-numeric value falls back to
 * deterministic decoding.
 */
export function plannerTemperature(requested: unknown): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) return PLANNER_DEFAULT_TEMPERATURE;
  return Math.min(PLANNER_MAX_TEMPERATURE, Math.max(0, requested));
}

/** Only text messages cross the paid chat boundary. Vendor options are owned
 * by the server; clients cannot select tools, fan-out, or response modes. The
 * one client option that survives is a planner's bounded temperature. */
export function serverChatBody(value: unknown, kind: ServerChatKind = "teaching"): Record<string, unknown> {
  if (!value || typeof value !== "object" || !("messages" in value) || !Array.isArray(value.messages) || value.messages.length === 0 || value.messages.length > 64) throw new Error("Invalid messages");
  const messages = value.messages.map((message: unknown) => {
    if (!message || typeof message !== "object" || !("role" in message) || !["system", "user", "assistant"].includes(String(message.role)) || !("content" in message)) throw new Error("Invalid message");
    let content: string;
    if (typeof message.content === "string") content = message.content;
    else if (Array.isArray(message.content)) {
      content = message.content.map((part: unknown) => {
        if (!part || typeof part !== "object" || !("type" in part) || part.type !== "text" || !("text" in part) || typeof part.text !== "string") throw new Error("Only text messages are supported");
        return part.text;
      }).join("\n");
    } else throw new Error("Invalid message content");
    return { role: message.role, content };
  });
  const temperature = kind === "planner"
    ? plannerTemperature("temperature" in value ? value.temperature : undefined)
    : TEACHING_TEMPERATURE;
  // Fireworks returns server TTFT and processing time in the body (the final
  // chunk when streamed). Requested on every call so traces can separate
  // provider latency from our own setup work.
  return { messages, n: 1, temperature, perf_metrics_in_response: true };
}

/** Set by the client on a second, concurrent teaching request for the same
 * turn, opened when the first has produced no content yet. The client later
 * aborts exactly one of the pair. */
export const TEACHING_HEDGE_HEADER = "x-heytutor-teaching-hedge";

export function isTeachingHedge(headers: Headers): boolean {
  return headers.get(TEACHING_HEDGE_HEADER) === "1";
}
