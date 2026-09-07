"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  boardIdFromPathname,
  createDraftBoardId,
  draftBoardPath,
} from "./lib/board/boardRoute";
import { TutorSessionShell } from "./TutorSessionShell";

export function TutorSessionPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // `/` is a working board with no database row and no URL of its own. It gets
  // its id up front so a lesson can start on it instantly; the row and the
  // `/c/{id}` address are claimed by the first question (see `commitDraftBoard`).
  const [draftBoardId, setDraftBoardId] = useState(createDraftBoardId);
  const routeBoardId = boardIdFromPathname(pathname);
  const sessionId = routeBoardId ?? draftBoardId;
  // Claiming the URL turns `routeBoardId` into this same id, so the board keeps
  // teaching across the switch instead of remounting on a "new" session.
  const isDraft = routeBoardId === null;

  const startDraftBoard = useCallback(
    (question = "") => {
      setDraftBoardId(createDraftBoardId());
      router.push(draftBoardPath(question));
    },
    [router],
  );

  const autoQuestion = searchParams.get("q") ?? undefined;
  const autoReplay = searchParams.get("replay") === "1";
  const embed = searchParams.get("embed") === "1";

  return (
    <TutorSessionShell
      sessionId={sessionId}
      isDraft={isDraft}
      onStartDraftBoard={startDraftBoard}
      variant={embed ? "embed" : "full"}
      autoQuestion={autoQuestion}
      autoReplay={autoReplay}
    />
  );
}
