export function canStartStoredLectureReplay(input: {
  autoReplay: boolean;
  isHeadless: boolean;
  boardLoaded: boolean;
  storedTurnsCount: number;
  isReplaying: boolean;
  alreadyStarted: boolean;
  viewportMeasured: boolean;
}): boolean {
  return (
    input.autoReplay &&
    !input.isHeadless &&
    input.boardLoaded &&
    input.storedTurnsCount > 0 &&
    !input.isReplaying &&
    !input.alreadyStarted &&
    input.viewportMeasured
  );
}
