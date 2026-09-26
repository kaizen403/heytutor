/** Hard cap so a stolen ticket cannot stream unbounded speech-provider spend. */
const TTS_WS_MAX_CHARS_PER_CONNECTION = 48_000;
export const TTS_WS_IDLE_MS = 120_000;
export const TTS_WS_MAX_CONNECTIONS_PER_USER = 3;
export const TTS_WS_MAX_MESSAGE_CHARS = 8_000;

const connectionsByUser = new Map<string, number>();

export function resetTtsWsConnectionsForTests(): void {
  connectionsByUser.clear();
}

export function tryAcquireTtsWsConnection(userId: string): boolean {
  const current = connectionsByUser.get(userId) ?? 0;
  if (current >= TTS_WS_MAX_CONNECTIONS_PER_USER) return false;
  connectionsByUser.set(userId, current + 1);
  return true;
}

export function releaseTtsWsConnection(userId: string): void {
  const current = connectionsByUser.get(userId) ?? 0;
  if (current <= 1) {
    connectionsByUser.delete(userId);
    return;
  }
  connectionsByUser.set(userId, current - 1);
}

export function ttsWsCharsWithinCeiling(used: number, incoming: number): boolean {
  if (incoming < 0 || used < 0) return false;
  return used + incoming <= TTS_WS_MAX_CHARS_PER_CONNECTION;
}
