/** Only text messages cross the paid chat boundary. Vendor options are owned
 * by the server; clients cannot select tools, fan-out, or response modes. */
export function serverChatBody(value: unknown): Record<string, unknown> {
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
  return { messages, n: 1, temperature: 0.3 };
}
