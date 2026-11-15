import { captureException } from "@sentry/nextjs";
import { fetchBoards } from "./boardsClient";
import type { BoardEntry } from "./types";

/** One bounded read; the returned cleanup releases its authority to publish. */
export function startBoardListRead(onBoards: (boards: BoardEntry[]) => void, onError: (message: string) => void): () => void {
  let cancelled = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  void fetchBoards({ signal: controller.signal }).then((list) => {
    if (!cancelled) onBoards(list);
  }).catch((error: unknown) => {
    if (cancelled) return;
    onError("Could not load your boards. Try again.");
    captureException(error, { tags: { area: "board-list-read" } });
  }).finally(() => clearTimeout(timer));
  return () => {
    cancelled = true;
    clearTimeout(timer);
    controller.abort();
  };
}
