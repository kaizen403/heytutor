export type SaveStatus = "saving" | "saved" | "retrying" | "error";

function isRetryable(error: unknown): boolean {
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  return typeof status !== "number" || status >= 500;
}

/** Serializes account PATCHes; transient failures retry even after the screen unmounts. */
export function createSettingsPatchQueue<T extends object>({
  send,
  schedule = (callback, delay) => window.setTimeout(callback, delay),
  cancel = (timer) => window.clearTimeout(timer),
  onStatus,
}: {
  send: (patch: Partial<T>) => Promise<void>;
  schedule?: (callback: () => void, delay: number) => number;
  cancel?: (timer: number) => void;
  onStatus?: (status: SaveStatus) => void;
}) {
  let pending: Partial<T> = {};
  let saving = false;
  let disposed = false;
  let terminal = false;
  let timer: number | null = null;
  let failures = 0;

  const run = async () => {
    if (saving || Object.keys(pending).length === 0) return;
    saving = true;
    const batch = pending;
    pending = {};
    onStatus?.("saving");
    try {
      await send(batch);
      failures = 0;
      if (!disposed && Object.keys(pending).length === 0) onStatus?.("saved");
    } catch (error) {
      // Later edits take precedence over an in-flight failed value.
      pending = { ...batch, ...pending };
      if (isRetryable(error)) {
        failures += 1;
        if (!disposed) onStatus?.("retrying");
        timer = schedule(() => {
          timer = null;
          void run();
        }, Math.min(1_000 * 2 ** (failures - 1), 30_000));
      } else {
        failures = 0;
        terminal = true;
        if (!disposed) onStatus?.("error");
      }
    } finally {
      saving = false;
      if (!terminal && timer === null && Object.keys(pending).length > 0) void run();
    }
  };

  return {
    enqueue(patch: Partial<T>) {
      if (disposed) return;
      pending = { ...pending, ...patch };
      terminal = false;
      if (timer !== null) {
        cancel(timer);
        timer = null;
      }
      void run();
    },
    retry() {
      if (timer !== null) cancel(timer);
      timer = null;
      terminal = false;
      void run();
    },
    dispose() {
      disposed = true;
    },
  };
}
