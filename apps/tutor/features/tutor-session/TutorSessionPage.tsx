"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  boardIdFromPathname,
  createDraftBoardId,
  draftBoardPath,
  resolveSessionBoard,
} from "./lib/board/boardRoute";
import { TutorSessionShell } from "./TutorSessionShell";

export function TutorSessionPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // `/` is a working board with no database row and no URL of its own. It gets
  // its id up front so a lesson can start on it instantly; the row and the
  // `/c/{id}` address are claimed by the first question (see `commitDraftBoard`).
  //
  // This component lives in the shared session layout, not the page, so the
  // `/` → `/c/{id}` claim must not remount it. Do not key this tree on
  // pathname: a remount would mint a new draft id, restore an empty board, and
  // look like the lecture refreshed.
  const [draftBoardId, setDraftBoardId] = useState(createDraftBoardId);
  const routeBoardId = boardIdFromPathname(pathname);
  // The lecture New board just left. Next keeps reporting it: a draft claims
  // `/c/{id}` with replaceState and leaves the router there, and a later
  // reconcile snaps the route back. Until the student opens another board,
  // that id must not take the screen again.
  const [abandonedRouteId, setAbandonedRouteId] = useState<string | null>(null);
  const [chosenBoardId, setChosenBoardId] = useState<string | null>(null);
  const { sessionId: activeSessionId, isDraft: activeIsDraft } = resolveSessionBoard({
    routeBoardId,
    draftBoardId,
    abandonedRouteId,
    chosenBoardId,
  });

  useEffect(() => {
    if (chosenBoardId && routeBoardId === chosenBoardId) {
      setChosenBoardId(null);
    }
  }, [chosenBoardId, routeBoardId]);

  const startDraftBoard = useCallback(
    (question = "") => {
      const id = createDraftBoardId();
      const left =
        boardIdFromPathname(pathname) ??
        (typeof window !== "undefined" ? boardIdFromPathname(window.location.pathname) : null);
      setChosenBoardId(null);
      setAbandonedRouteId(left);
      setDraftBoardId(id);
      const path = draftBoardPath(question);
      // The address bar can already say `/c/{id}` while Next's router is still
      // on `/`. Pushing `/` then does nothing, so put the bar back on the home
      // board in the same click. Keeping Next's history state avoids a remount.
      if (typeof window !== "undefined" && window.location.pathname.startsWith("/c/")) {
        window.history.replaceState(window.history.state ?? {}, "", path);
      }
      router.push(path);
    },
    [pathname, router],
  );

  const chooseBoard = useCallback((id: string) => {
    setAbandonedRouteId(null);
    setChosenBoardId(id);
  }, []);

  const autoQuestion = searchParams.get("q") ?? undefined;
  const autoReplay = searchParams.get("replay") === "1";
  const embed = searchParams.get("embed") === "1";

  return (
    <TutorSessionShell
      sessionId={activeSessionId}
      isDraft={activeIsDraft}
      onStartDraftBoard={startDraftBoard}
      onChooseBoard={chooseBoard}
      variant={embed ? "embed" : "full"}
      autoQuestion={autoQuestion}
      autoReplay={autoReplay}
    />
  );
}
