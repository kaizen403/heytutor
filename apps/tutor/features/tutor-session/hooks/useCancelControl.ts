import { useCallback, useRef } from "react";

type CancelWait = {
  promise: Promise<void>;
  dispose: () => void;
};

export function useCancelControl(cancelRef: React.RefObject<boolean>) {
  const delayTimersRef = useRef<number[]>([]);
  const cancelWaitDisposersRef = useRef<Set<() => void>>(new Set());

  const waitForCancel = useCallback((): CancelWait => {
    if (cancelRef.current) {
      return { promise: Promise.resolve(), dispose: () => undefined };
    }

    let intervalId: number | null = null;
    let settled = false;

    const promise = new Promise<void>((resolve) => {
      intervalId = window.setInterval(() => {
        if (!cancelRef.current) {
          return;
        }

        if (intervalId !== null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }

        if (!settled) {
          settled = true;
          resolve();
        }
      }, 32);
    });

    const dispose = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
      cancelWaitDisposersRef.current.delete(dispose);
    };

    cancelWaitDisposersRef.current.add(dispose);
    return { promise, dispose };
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

      const cancelWait = waitForCancel();

      try {
        const result = await Promise.race([
          promise.then((value) => ({ kind: "value" as const, value })),
          cancelWait.promise.then(() => ({ kind: "cancelled" as const })),
        ]);

        if (result.kind === "cancelled" || cancelRef.current) {
          return undefined;
        }

        return result.value;
      } finally {
        // Always dispose the watcher when the race settles — whether the
        // source promise won or cancel did — so intervals cannot leak or
        // clear each other across concurrent races.
        cancelWait.dispose();
      }
    },
    [cancelRef, waitForCancel],
  );

  const clearCancelTimers = useCallback(() => {
    for (const dispose of cancelWaitDisposersRef.current) {
      dispose();
    }
    cancelWaitDisposersRef.current.clear();

    for (const timerId of delayTimersRef.current) {
      window.clearTimeout(timerId);
    }
    delayTimersRef.current = [];
  }, []);

  return {
    waitForCancel: () => waitForCancel().promise,
    cancellableDelay,
    raceWithCancel,
    clearCancelTimers,
  };
}
