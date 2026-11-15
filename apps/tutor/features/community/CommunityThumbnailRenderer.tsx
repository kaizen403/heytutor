"use client";

import { useCallback, useEffect, useRef } from "react";
import { TutorSessionShell, type TutorSessionExportApi } from "@/features/tutor-session/TutorSessionShell";
import { fetchCommunityBoard } from "@/lib/community/communityClient";
import { pageTurnsEndingAt } from "@/lib/boards/boardContinuation";

/** Use the same restore/authority path as opening a public board, then unmount. */
export default function CommunityThumbnailRenderer({ boardId, onComplete }: {
  boardId: string;
  onComplete: (boardId: string, blob: Blob | null) => void;
}) {
  const started = useRef(false);
  const finished = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const complete = useCallback((blob: Blob | null) => {
    if (finished.current) return;
    finished.current = true;
    onComplete(boardId, blob);
  }, [boardId, onComplete]);
  const readBoard = useCallback(async (id: string) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    // This endpoint applies the public whitelist; never use the owner's API.
    const result = await fetchCommunityBoard(id, { signal: controller.signal }).catch(() => null);
    // Admins may open hidden boards through the detail endpoint, but those
    // previews must never become gallery pictures after a moderation change.
    if (!result || result.board.adminPreview) return null;
    return { turns: pageTurnsEndingAt(result.turns) };
  }, []);
  const capture = useCallback((api: TutorSessionExportApi | null) => {
    if (!api?.boardReady || started.current || finished.current) return;
    started.current = true;
    if (!api.hasSavedTurns || !api.captureThumbnail) {
      complete(null);
      return;
    }
    void api.captureThumbnail().then(complete, () => complete(null));
  }, [complete]);

  useEffect(() => {
    finished.current = false;
    // A bad stored picture or failed read must not hold up every later card.
    const timer = window.setTimeout(() => complete(null), 45_000);
    return () => {
      finished.current = true;
      abort.current?.abort();
      window.clearTimeout(timer);
    };
  }, [complete]);

  return (
    <div aria-hidden="true" inert className="pointer-events-none fixed left-[-10000px] top-0 h-[700px] w-[1200px] overflow-hidden">
      <TutorSessionShell sessionId={boardId} variant="headless" readBoard={readBoard}
        muteAudio lecturePlayback={false} onExportApi={capture} />
    </div>
  );
}
