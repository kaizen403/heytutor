/**
 * Long sessions used to send the last ten full lessons into the next teaching
 * call. The model then mixed earlier numbers into the new question, or filled
 * a long explain with a recap of the previous one.
 *
 * Keep a short window of compact exchanges: the current question still sees
 * what this board has been about, without a wall of spoken text.
 */
import type { ConversationExchange } from "./llmAPI";

export const MAX_CONVERSATION_TURNS = 6;
export const LAST_ASSISTANT_CHARS = 900;
export const OLDER_ASSISTANT_CHARS = 280;
export const HISTORY_USER_CHARS = 360;

export interface CompactHistoryOptions {
  maxTurns?: number;
  lastAssistantChars?: number;
  olderAssistantChars?: number;
  userChars?: number;
}

function clip(text: string, maxChars: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd();
  return `${cut}…`;
}

export function compactConversationHistory(
  history: readonly ConversationExchange[],
  options: CompactHistoryOptions = {},
): ConversationExchange[] {
  const maxTurns = options.maxTurns ?? MAX_CONVERSATION_TURNS;
  const lastAssistantChars = options.lastAssistantChars ?? LAST_ASSISTANT_CHARS;
  const olderAssistantChars = options.olderAssistantChars ?? OLDER_ASSISTANT_CHARS;
  const userChars = options.userChars ?? HISTORY_USER_CHARS;
  if (history.length === 0 || maxTurns <= 0) return [];
  const window = history.slice(-maxTurns);
  return window.map((exchange, index) => {
    const isLast = index === window.length - 1;
    return {
      user: clip(exchange.user, userChars),
      assistant: clip(
        exchange.assistant,
        isLast ? lastAssistantChars : olderAssistantChars,
      ),
    };
  });
}
