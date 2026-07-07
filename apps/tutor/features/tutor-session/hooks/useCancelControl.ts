import { useCallback, useRef } from "react";

export function useCancelControl(cancelRef: React.RefObject<boolean>) {
  const delayTimersRef = useRef<number[]>([]);
  const cancelWatchIntervalRef = useRef<number | null>(null);

  const waitForCancel = useCallback((): Promise<void> => {
    if (cancelRef.current) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      if (cancelWatchIntervalRef.current !== null) {
        window.clearInterval(cancelWatchIntervalRef.current);
      }

      cancelWatchIntervalRef.current = window.setInterval(() => {
        if (!cancelRef.current) {
          return;
        }

        if (cancelWatchIntervalRef.current !== null) {
          window.clearInterval(cancelWatchIntervalRef.current);
          cancelWatchIntervalRef.current = null;
        }

        resolve();
      }, 32);
    });
  }, [cancelRef]);

  const cancellableDelay = useCallback(
    (duration: number): Promise<void> => {
      if (cancelRef.current) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        const timeoutId = window.setTimeout(() => {
          delayTimersRef.current = delayTimersRef.current.filter((id) => id !== timeoutId);
          resolve();
        }, duration);
        delayTimersRef.current.push(timeoutId);
      });
    },
    [cancelRef],
  );

  const raceWithCancel = useCallback(
    async <T,>(promise: Promise<T>): Promise<T | undefined> => {
      if (cancelRef.current) {
        return undefined;
      }

      const result = await Promise.race([
        promise.then((value) => ({ kind: "value" as const, value })),
        waitForCancel().then(() => ({ kind: "cancelled" as const })),
      ]);

      if (result.kind === "cancelled" || cancelRef.current) {
        return undefined;
      }

      return result.value;
    },
    [cancelRef, waitForCancel],
  );

  const clearCancelTimers = useCallback(() => {
    if (cancelWatchIntervalRef.current !== null) {
      window.clearInterval(cancelWatchIntervalRef.current);
      cancelWatchIntervalRef.current = null;
    }

    for (const timerId of delayTimersRef.current) {
      window.clearTimeout(timerId);
    }
    delayTimersRef.current = [];
  }, []);

  return {
    waitForCancel,
    cancellableDelay,
    raceWithCancel,
    clearCancelTimers,
  };
}
