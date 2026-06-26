/** R2 object keys for lecture audio — safe to import from Next.js route handlers. */
export function lectureAudioKey(
  boardId: string,
  turnId: string,
  segmentIndex: number,
): string {
  return `lectures/${boardId}/${turnId}/${segmentIndex}.mp3`;
}

export function boardAudioPrefix(boardId: string): string {
  return `lectures/${boardId}/`;
}
