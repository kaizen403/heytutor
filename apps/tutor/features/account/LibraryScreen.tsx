"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AccountCard, AccountPageFrame } from "./AccountPageFrame";
import { SiteButton } from "@/components/ui/site-button";
import { fetchBoards, updateBoard, deleteBoardApi } from "@/lib/boards/boardsClient";
import { sortBoards, type BoardEntry } from "@/lib/boards/types";
import { boardPath } from "@/features/tutor-session/lib/board/boardRoute";
import { inferBoardSubject } from "@/lib/account/progress";
import { SUBJECT_LABELS, parseSubjects, type SubjectId } from "@/lib/account/types";
import { useAccountMe } from "@/features/app-shell/useAccountMe";

type Filter = "all" | "pinned" | "archived" | SubjectId;

export function LibraryScreen() {
  const router = useRouter();
  const me = useAccountMe();
  const [boards, setBoards] = useState<BoardEntry[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    void fetchBoards().then((list) => setBoards(sortBoards(list)));
  }, []);

  const onboarded = parseSubjects(me?.profile.subjects);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return boards.filter((board) => {
      if (needle && !`${board.title} ${board.preview}`.toLowerCase().includes(needle)) {
        return false;
      }
      if (filter === "pinned") return board.pinnedAt != null;
      if (filter === "archived") return board.archivedAt != null;
      if (filter !== "all") {
        return inferBoardSubject(board.title, board.preview, onboarded) === filter;
      }
      return board.archivedAt == null;
    });
  }, [boards, filter, onboarded, query]);

  return (
    <AccountPageFrame
      title="Library"
      subtitle="Every board on this account. Search, pin, archive, or delete. Exports you already made stay on the device that downloaded them."
      actions={
        <SiteButton variant="ice" size="sm" onClick={() => router.push("/")}>
          New board
        </SiteButton>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search boards"
          className="min-w-[16rem] flex-1 rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.22)] px-3 py-2 text-sm text-frost outline-none focus:border-sky-500"
        />
        {(["all", "pinned", "archived", ...onboarded] as Filter[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={`rounded-lg border px-3 py-1.5 text-xs ${
              filter === item ? "border-sky-500 bg-sky-500/12 text-sky-200" : "border-[rgba(255,255,255,0.1)] text-frost"
            }`}
          >
            {item === "all" || item === "pinned" || item === "archived" ? item : SUBJECT_LABELS[item]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <AccountCard>
          <p className="text-sm text-[rgba(237,237,235,0.62)]">
            No boards here. Start one in {onboarded[0] ? SUBJECT_LABELS[onboarded[0]] : "your subject"}.
          </p>
          <SiteButton className="mt-3" variant="sky" size="sm" onClick={() => router.push("/")}>
            Ask a question
          </SiteButton>
        </AccountCard>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((board) => (
            <AccountCard key={board.id}>
              <button
                type="button"
                className="w-full text-left"
                onClick={() => router.push(boardPath(board.id))}
              >
                <h3 className="text-sm font-medium text-frost">{board.title}</h3>
                <p className="mt-1 line-clamp-2 text-xs text-[rgba(237,237,235,0.55)]">
                  {board.preview || "No preview yet"}
                </p>
                <p className="mt-2 text-[0.6875rem] text-[rgba(237,237,235,0.4)]">
                  {new Date(board.createdAt).toLocaleDateString()}
                  {board.pinnedAt ? " · Pinned" : ""}
                  {board.archivedAt ? " · Archived" : ""}
                </p>
              </button>
              <div className="mt-3 flex flex-wrap gap-2">
                <SiteButton size="xs" onClick={() => router.push(`${boardPath(board.id)}?replay=1`)}>
                  Continue
                </SiteButton>
                <SiteButton
                  size="xs"
                  onClick={() => {
                    const next = board.pinnedAt == null;
                    setBoards((current) =>
                      sortBoards(current.map((entry) => (entry.id === board.id ? { ...entry, pinnedAt: next ? Date.now() : null } : entry))),
                    );
                    void updateBoard(board.id, { pinned: next });
                  }}
                >
                  {board.pinnedAt ? "Unpin" : "Pin"}
                </SiteButton>
                <SiteButton
                  size="xs"
                  onClick={() => {
                    const next = board.archivedAt == null;
                    setBoards((current) =>
                      current.map((entry) => (entry.id === board.id ? { ...entry, archivedAt: next ? Date.now() : null } : entry)),
                    );
                    void updateBoard(board.id, { archived: next });
                  }}
                >
                  {board.archivedAt ? "Unarchive" : "Archive"}
                </SiteButton>
                <SiteButton
                  size="xs"
                  variant="danger"
                  onClick={() => {
                    if (!window.confirm("Delete this board and its lessons?")) return;
                    void deleteBoardApi(board.id).then((ok) => {
                      if (ok) setBoards((current) => current.filter((entry) => entry.id !== board.id));
                    });
                  }}
                >
                  Delete
                </SiteButton>
              </div>
            </AccountCard>
          ))}
        </div>
      )}

      <AccountCard title="Exports shelf" className="mt-4">
        <p className="text-sm text-[rgba(237,237,235,0.62)]">
          Notes PDFs and lecture MP4s are downloaded to this device. Accelute does not keep a cloud copy of those files yet.
        </p>
      </AccountCard>
    </AccountPageFrame>
  );
}
