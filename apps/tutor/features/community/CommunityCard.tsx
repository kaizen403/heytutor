"use client";

import Link from "next/link";
import { SUBJECT_LABELS } from "@/lib/account/types";
import type { CommunityCard as CommunityCardData } from "@/lib/community/publicBoard";

function compactCount(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function communityBoardPath(boardId: string): string {
  return `/community/${encodeURIComponent(boardId)}`;
}

/** One board in the gallery: the finished board, its title, and who asked it. */
export function CommunityCard({ board }: { board: CommunityCardData }) {
  const subject = board.subject === "other" ? null : SUBJECT_LABELS[board.subject];
  return (
    <Link
      href={communityBoardPath(board.id)}
      className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(23,23,22,0.72)] transition-colors hover:border-[rgba(255,255,255,0.18)]"
    >
      <div className="relative aspect-[12/7] w-full overflow-hidden bg-ink-950">
        {board.thumbnailUrl ? (
          // A plain img: card pictures come from our own API with their own cache headers.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={board.thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center px-5">
            <p className="line-clamp-4 text-lg leading-snug text-[rgba(237,237,235,0.78)]" style={{ fontFamily: "var(--font-hand)" }}>
              {board.question || board.title}
            </p>
          </div>
        )}
        {board.featured ? (
          <span className="absolute left-2 top-2 rounded-md bg-[rgba(0,0,0,0.55)] px-2 py-0.5 text-[0.6875rem] font-medium text-sky-200">
            Featured
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3.5">
        <h3 className="line-clamp-2 text-sm font-medium text-frost">{board.title}</h3>
        <div className="mt-auto flex min-w-0 items-center gap-2 text-[0.75rem] text-[rgba(237,237,235,0.55)]">
          <span
            aria-hidden
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(255,255,255,0.1)] text-[0.625rem] font-semibold text-frost"
          >
            {board.author.initial}
          </span>
          <span className="min-w-0 truncate">{board.author.name}</span>
          {subject ? <span className="shrink-0 text-[rgba(237,237,235,0.4)]">· {subject}</span> : null}
          <span className="ml-auto shrink-0 tabular-nums text-[rgba(237,237,235,0.4)]" title={`${board.viewCount} views, ${board.remixCount} remixes`}>
            {compactCount(board.viewCount)} views
            {board.remixCount > 0 ? ` · ${compactCount(board.remixCount)} remixes` : ""}
          </span>
        </div>
      </div>
    </Link>
  );
}
