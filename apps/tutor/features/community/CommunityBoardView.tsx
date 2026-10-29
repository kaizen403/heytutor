"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TutorSessionShell } from "@/features/tutor-session/TutorSessionShell";
import { boardPath } from "@/features/tutor-session/lib/board/boardRoute";
import { SiteButton } from "@/components/ui/site-button";
import { updateBoard } from "@/lib/boards/boardsClient";
import {
  fetchCommunityBoard,
  recordCommunityVisit,
  remixCommunityBoardApi,
  reportCommunityBoardApi,
  type CommunityBoardHeader,
  type CommunityReportReason,
} from "@/lib/community/communityClient";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { communityBoardPath } from "./CommunityCard";

const REPORT_REASONS: Array<{ id: CommunityReportReason; label: string }> = [
  { id: "wrong", label: "The lesson is wrong" },
  { id: "inappropriate", label: "Inappropriate" },
  { id: "personal_info", label: "Shows personal information" },
  { id: "spam", label: "Spam" },
  { id: "other", label: "Something else" },
];

type Notice = { tone: "info" | "error"; text: string } | null;

/**
 * Someone else's lesson, played back read only on the same board the owner
 * saw. Watching needs no account; remixing copies it into the viewer's own
 * boards, where they can ask doubts on it.
 */
export function CommunityBoardView({ boardId }: { boardId: string }) {
  const router = useRouter();
  const [header, setHeader] = useState<CommunityBoardHeader | null>(null);
  const [missing, setMissing] = useState(false);
  const [remixing, setRemixing] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [madePrivate, setMadePrivate] = useState(false);

  // One read serves both the header and the player, so the board is fetched
  // once. Started lazily, in the browser only: during the server render there
  // is no origin for the relative API URL.
  const readRef = useRef<{ boardId: string; promise: ReturnType<typeof fetchCommunityBoard> } | null>(null);
  const read = useCallback(() => {
    if (readRef.current?.boardId !== boardId) {
      readRef.current = { boardId, promise: fetchCommunityBoard(boardId).catch(() => null) };
    }
    return readRef.current.promise;
  }, [boardId]);
  useEffect(() => {
    let cancelled = false;
    void read().then((result) => {
      if (cancelled) return;
      if (result) {
        setHeader(result.board);
        if (!result.board.isOwner) recordCommunityVisit(boardId);
      } else setMissing(true);
    });
    return () => {
      cancelled = true;
    };
  }, [read, boardId]);
  const readBoard = useCallback(
    async (id: string): Promise<{ turns: StoredTurn[] } | null> => (id === boardId ? read() : fetchCommunityBoard(id).catch(() => null)),
    [boardId, read],
  );

  const remix = async () => {
    setRemixing(true);
    setNotice(null);
    const result = await remixCommunityBoardApi(boardId);
    if (result.ok) {
      router.push(boardPath(result.boardId));
      return;
    }
    setRemixing(false);
    if (result.status === 401) {
      router.push(`/login?next=${encodeURIComponent(communityBoardPath(boardId))}`);
      return;
    }
    setNotice({
      tone: "error",
      text: result.status === 429 ? "Your account is full. Delete a board to remix this one." : "Could not remix this lesson. Try again.",
    });
  };

  const share = async () => {
    const url = `${window.location.origin}${communityBoardPath(boardId)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: header?.title ?? "Accelute lesson", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNotice({ tone: "info", text: "Link copied." });
    } catch {
      /* the share sheet was dismissed */
    }
  };

  const report = async (reason: CommunityReportReason) => {
    setReportOpen(false);
    const ok = await reportCommunityBoardApi(boardId, reason);
    setNotice(ok ? { tone: "info", text: "Thanks. We will look at this lesson." } : { tone: "error", text: "The report did not send." });
  };

  const makePrivate = async () => {
    const updated = await updateBoard(boardId, { visibility: "private" });
    if (updated) setMadePrivate(true);
    else setNotice({ tone: "error", text: "Could not make this board private." });
  };

  if (missing || madePrivate) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-[rgba(237,237,235,0.7)]">
          {madePrivate ? "This board is private now. It has left Community." : "This lesson is not on Community."}
        </p>
        <SiteButton size="sm" onClick={() => router.push("/community")}>
          Back to Community
        </SiteButton>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-3 pt-4 sm:px-6">
        <Link href="/community" className="text-xs text-[rgba(237,237,235,0.55)] hover:text-frost">
          ← Community
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-[-0.02em] text-frost">{header?.title ?? " "}</h1>
          {header ? (
            <p className="mt-0.5 truncate text-xs text-[rgba(237,237,235,0.55)]">
              {header.author.name} · {header.viewCount} views
              {header.remixCount > 0 ? ` · ${header.remixCount} remixes` : ""}
            </p>
          ) : null}
        </div>
        <div className="relative flex flex-wrap items-center gap-2">
          {header?.isOwner ? (
            <>
              <SiteButton size="sm" onClick={() => router.push(boardPath(boardId))}>
                Open my board
              </SiteButton>
              <SiteButton size="sm" variant="ghost" onClick={makePrivate}>
                Make private
              </SiteButton>
            </>
          ) : (
            <SiteButton size="sm" variant="ice" disabled={remixing || !header} onClick={remix}>
              {remixing ? "Remixing" : "Remix"}
            </SiteButton>
          )}
          <SiteButton size="sm" variant="ghost" onClick={share}>
            Share
          </SiteButton>
          {header?.isOwner ? null : (
            <SiteButton size="sm" variant="ghost" aria-expanded={reportOpen} onClick={() => setReportOpen((open) => !open)}>
              Report
            </SiteButton>
          )}
          {reportOpen ? (
            <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-60 rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(23,23,22,0.98)] p-1 shadow-xl">
              {REPORT_REASONS.map((reason) => (
                <button
                  key={reason.id}
                  type="button"
                  role="menuitem"
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-frost hover:bg-[rgba(255,255,255,0.06)]"
                  onClick={() => void report(reason.id)}
                >
                  {reason.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {notice ? (
          <p className={`w-full text-xs ${notice.tone === "error" ? "text-red-300" : "text-sky-200"}`} role="status">
            {notice.text}
          </p>
        ) : null}
      </header>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <TutorSessionShell key={boardId} sessionId={boardId} variant="community" readBoard={readBoard} />
      </div>
    </div>
  );
}
