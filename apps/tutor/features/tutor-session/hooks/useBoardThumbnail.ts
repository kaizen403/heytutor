import { useEffect } from "react";
import { uploadBoardThumbnail } from "@/lib/community/communityClient";

/** Let the restored page or the last stroke settle before the picture is taken. */
const SETTLE_MS = 2_500;
const STORAGE_PREFIX = "accelute:community-thumb:finished-page:";

function lastUploadedRevision(boardId: string): string | null {
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${boardId}`);
  } catch {
    return null;
  }
}

function rememberUpload(boardId: string, revision: string): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${boardId}`, revision);
  } catch {
    /* private mode: the next visit uploads again, which is harmless */
  }
}

/**
 * The owner's finished board becomes its Community card picture. Taken from
 * the board itself, so the card shows exactly what the student saw: the
 * handwriting and the figure. Runs only on the owner's own public board, once
 * per saved revision, when nothing is being drawn.
 */
export function useBoardThumbnail(input: {
  enabled: boolean;
  boardId: string;
  turnCount: number;
  /** Changes on local/server replacements even when the turn count is unchanged. */
  revision: number;
  getRevision: () => string;
  captureThumbnail: () => Promise<Blob | null>;
  /**
   * Asked when the picture is about to be taken: whether every saved turn on
   * the board is one Community may show. A turn still marked live is drawn on
   * the owner's restored page but hidden from Community, so it must not reach
   * the public card either.
   */
  publishable: () => boolean;
}): void {
  const { enabled, boardId, turnCount, revision, getRevision, captureThumbnail, publishable } = input;
  useEffect(() => {
    if (!enabled || !boardId || turnCount < 1) return;
    const revisionKey = getRevision();
    if (lastUploadedRevision(boardId) === revisionKey) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (!publishable()) return;
      try {
        const blob = await captureThumbnail();
        if (cancelled || !blob || !publishable() || getRevision() !== revisionKey) return;
        if (await uploadBoardThumbnail(boardId, blob)) rememberUpload(boardId, revisionKey);
      } catch {
        // A failed capture must not suppress a later visit's upload.
      }
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, boardId, turnCount, revision, getRevision, captureThumbnail, publishable]);
}
