export interface RelayVoiceSettings {
  stability: number;
  similarity_boost: number;
  style?: number;
  speed?: number;
}

export function buildMultiContextSegmentMessages(
  contextId: string,
  text: string,
  voiceSettings: RelayVoiceSettings,
): [Record<string, unknown>, Record<string, unknown>] {
  if (!/^segment_[1-9]\d*$/.test(contextId)) throw new Error("invalid relay context id");
  const normalizedText = text.trim();
  if (!normalizedText) throw new Error("relay segment text must be non-empty");
  return [
    {
      context_id: contextId,
      text: " ",
      voice_settings: voiceSettings,
    },
    {
      context_id: contextId,
      text: `${normalizedText} `,
      flush: true,
    },
  ];
}

export function normalizeMultiContextServerPayload(raw: string): {
  forwardPayload: string;
  finalContextId?: string;
} {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("invalid multi-context server payload");
  }
  const message = parsed as Record<string, unknown>;
  const contextId = typeof message.contextId === "string"
    ? message.contextId
    : typeof message.context_id === "string"
      ? message.context_id
      : undefined;
  const final = message.isFinal === true || message.is_final === true;
  if (message.is_final === true) message.isFinal = true;
  return {
    forwardPayload: JSON.stringify(message),
    ...(final && contextId ? { finalContextId: contextId } : {}),
  };
}
