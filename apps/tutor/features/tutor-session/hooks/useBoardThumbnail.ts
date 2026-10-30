import { useEffect, type RefObject } from "react";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import { uploadBoardThumbnail } from "@/lib/community/communityClient";

/** Card picture size: the board's 12:7 page, small enough to stay well under the upload cap. */
const THUMB_WIDTH = 600;
const THUMB_HEIGHT = 350;
/** Let the restored page or the last stroke settle before the picture is taken. */
const SETTLE_MS = 2_500;
const STORAGE_PREFIX = "accelute:community-thumb:";

function lastUploadedTurnCount(boardId: string): number {
  try {
    return Number(window.localStorage.getItem(`${STORAGE_PREFIX}${boardId}`) ?? "0") || 0;
  } catch {
    return 0;
  }
}

function rememberUpload(boardId: string, turnCount: number): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${boardId}`, String(turnCount));
  } catch {
    /* private mode: the next visit uploads again, which is harmless */
  }
}

/**
 * The owner's finished board becomes its Community card picture. Taken from
 * the board itself, so the card shows exactly what the student saw: the
 * handwriting and the figure. Runs only on the owner's own public board, once
 * per new turn, when nothing is being drawn.
 */
export function useBoardThumbnail(input: {
  enabled: boolean;
  boardId: string;
  turnCount: number;
  whiteboardRef: RefObject<WhiteboardHandle | null>;
  /**
   * Asked when the picture is about to be taken: whether every saved turn on
   * the board is one Community may show. A turn still marked live is drawn on
   * the owner's restored page but hidden from Community, so it must not reach
   * the public card either.
   */
  publishable: () => boolean;
}): void {
  const { enabled, boardId, turnCount, whiteboardRef, publishable } = input;
  useEffect(() => {
    if (!enabled || !boardId || turnCount < 1) return;
    if (lastUploadedTurnCount(boardId) >= turnCount) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!publishable()) return;
      const frame = whiteboardRef.current?.captureFrame({ pixelRatio: 1, hideCursor: true });
      if (!frame || cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = THUMB_WIDTH;
      canvas.height = THUMB_HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(frame, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
      // A cross origin reference picture taints the canvas and toBlob throws:
      // that board keeps its text card rather than breaking the lesson.
      try {
        canvas.toBlob((blob) => {
        // A browser that cannot encode WebP hands back PNG; skip rather than upload it.
        if (cancelled || !blob || blob.type !== "image/webp") return;
        void uploadBoardThumbnail(boardId, blob).then((ok) => {
          if (ok) rememberUpload(boardId, turnCount);
        });
        }, "image/webp", 0.82);
      } catch {
        rememberUpload(boardId, turnCount);
      }
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, boardId, turnCount, whiteboardRef, publishable]);
}
