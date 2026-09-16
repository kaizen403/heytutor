"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchBoards, updateBoard, deleteBoardApi } from "@/lib/boards/boardsClient";
import { sortBoards, withArchived, withPinned, type BoardEntry } from "@/lib/boards/types";
import { boardPath } from "@/features/tutor-session/lib/board/boardRoute";
import { AppShell } from "./AppShell";
import { toShellProfile, useAccountMe } from "./useAccountMe";

export function AccountAppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useAccountMe();
  const [boards, setBoards] = useState<BoardEntry[]>([]);

  useEffect(() => {
    void fetchBoards().then(setBoards);
  }, []);

  const activeBoardId = pathname.startsWith("/c/")
    ? decodeURIComponent(pathname.slice(3).split("/")[0] ?? "")
    : null;

  const onSelect = useCallback(
    (id: string) => {
      router.push(boardPath(id));
    },
    [router],
  );

  const onNew = useCallback(() => {
    router.push("/");
  }, [router]);

  const onDelete = useCallback((id: string) => {
    void deleteBoardApi(id).then((ok) => {
      if (ok) setBoards((current) => current.filter((board) => board.id !== id));
    });
  }, []);

  const onTogglePin = useCallback((id: string) => {
    const board = boards.find((entry) => entry.id === id);
    if (!board) return;
    const next = board.pinnedAt == null;
    setBoards((current) => sortBoards(current.map((entry) => (entry.id === id ? withPinned(entry, next) : entry))));
    void updateBoard(id, { pinned: next });
  }, [boards]);

  const onToggleArchive = useCallback((id: string) => {
    const board = boards.find((entry) => entry.id === id);
    if (!board) return;
    const next = board.archivedAt == null;
    setBoards((current) => current.map((entry) => (entry.id === id ? withArchived(entry, next) : entry)));
    void updateBoard(id, { archived: next });
  }, [boards]);

  const onRename = useCallback((id: string, title: string) => {
    setBoards((current) => current.map((entry) => (entry.id === id ? { ...entry, title } : entry)));
    void updateBoard(id, { title });
  }, []);

  return (
    <AppShell
      variant="account"
      boards={boards}
      activeBoardId={activeBoardId}
      onSelect={onSelect}
      onNew={onNew}
      onDelete={onDelete}
      onTogglePin={onTogglePin}
      onToggleArchive={onToggleArchive}
      onRename={onRename}
      profile={toShellProfile(me?.profile)}
    >
      {children}
    </AppShell>
  );
}
