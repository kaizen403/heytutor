/** Browser side of Community. Safe to import from client components. */
import { resolveApiUrl } from "@heytutor/tutor-core";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { sourceCheckedStoredTurn } from "@/lib/scene/storedSceneSource";
import type { SubjectId } from "@/lib/account/types";
import type { CommunityCard, CommunitySort } from "./publicBoard";

export interface CommunityBoardHeader extends CommunityCard {
  preview: string;
  isOwner: boolean;
  /** An admin is looking at a board hidden from everyone else. */
  adminPreview?: boolean;
}

export interface CommunityPage {
  boards: CommunityCard[];
  nextPage: number | null;
}

export async function fetchCommunityPage(input: { sort: CommunitySort; page: number; query?: string; subject?: SubjectId | null; signal?: AbortSignal }): Promise<CommunityPage | null> {
  const params = new URLSearchParams({ sort: input.sort, page: String(input.page) });
  if (input.query?.trim()) params.set("q", input.query.trim());
  if (input.subject) params.set("subject", input.subject);
  try {
    const res = await fetch(resolveApiUrl(`/api/community?${params}`), input.signal ? { signal: input.signal } : undefined);
    if (!res.ok) return null;
    return (await res.json()) as CommunityPage;
  } catch {
    return null;
  }
}

/** Every page of a Community board, checked the same way as the owner's own read. */
export async function fetchCommunityBoard(boardId: string, options?: { signal?: AbortSignal }): Promise<{ board: CommunityBoardHeader; turns: StoredTurn[] } | null> {
  let result: { board: CommunityBoardHeader; turns: StoredTurn[] } | null = null;
  let page = 0;
  for (let attempt = 0; attempt < 200; attempt++) {
    const res = await fetch(resolveApiUrl(`/api/community/${encodeURIComponent(boardId)}?page=${page}`), options?.signal ? { signal: options.signal } : undefined);
    if (!res.ok) return null;
    const data = (await res.json()) as { board: CommunityBoardHeader; turns: StoredTurn[]; nextPage?: number | null };
    if (!result) result = { board: data.board, turns: [] };
    result.turns.push(...data.turns.map(sourceCheckedStoredTurn));
    if (typeof data.nextPage !== "number" || data.nextPage <= page) break;
    page = data.nextPage;
  }
  return result;
}

export type RemixResult = { ok: true; boardId: string } | { ok: false; status: number; error: string };

export async function remixCommunityBoardApi(boardId: string): Promise<RemixResult> {
  try {
    const res = await fetch(resolveApiUrl(`/api/community/${encodeURIComponent(boardId)}/remix`), { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { boardId?: string; error?: string };
    if (res.ok && data.boardId) return { ok: true, boardId: data.boardId };
    return { ok: false, status: res.status, error: data.error ?? "remix failed" };
  } catch {
    return { ok: false, status: 0, error: "network error" };
  }
}

/** Count this visit once per tab session. Never throws; a lost count is fine. */
export function recordCommunityVisit(boardId: string): void {
  const key = `accelute:community-view:${boardId}`;
  try {
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
  } catch {
    /* storage blocked: count it anyway */
  }
  void fetch(resolveApiUrl(`/api/community/${encodeURIComponent(boardId)}/view`), { method: "POST" }).catch(() => {});
}

export type CommunityReportReason = "wrong" | "inappropriate" | "personal_info" | "spam" | "other";

export async function reportCommunityBoardApi(boardId: string, reason: CommunityReportReason): Promise<boolean> {
  try {
    const res = await fetch(resolveApiUrl(`/api/community/${encodeURIComponent(boardId)}/report`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function uploadBoardThumbnail(boardId: string, blob: Blob): Promise<boolean> {
  try {
    const res = await fetch(resolveApiUrl(`/api/boards/${encodeURIComponent(boardId)}/thumbnail`), {
      method: "PUT",
      headers: { "content-type": "image/webp" },
      body: blob,
    });
    return res.ok;
  } catch {
    return false;
  }
}
