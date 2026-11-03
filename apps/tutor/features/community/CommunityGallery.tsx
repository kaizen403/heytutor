"use client";

import { useEffect, useRef, useState } from "react";
import { AccountCard, AccountPageFrame } from "@/features/account/AccountPageFrame";
import { SiteButton } from "@/components/ui/site-button";
import { SUBJECT_LABELS, type SubjectId } from "@/lib/account/types";
import { fetchCommunityPage } from "@/lib/community/communityClient";
import type { CommunityCard as CommunityCardData, CommunitySort } from "@/lib/community/publicBoard";
import { CommunityCard } from "./CommunityCard";

const SORTS: Array<{ id: CommunitySort; label: string }> = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "featured", label: "Featured" },
];

const SUBJECTS = Object.keys(SUBJECT_LABELS) as SubjectId[];

type SubjectFilter = "all" | SubjectId;

/** Every public board on Accelute: watch any lesson, remix it into your own. */
export function CommunityGallery() {
  const [sort, setSort] = useState<CommunitySort>("trending");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [subject, setSubject] = useState<SubjectFilter>("all");
  const [boards, setBoards] = useState<CommunityCardData[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(0);
  /** The sort and search the cards on screen answer. Differs from the current one while loading. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const requestRef = useRef(0);
  const key = `${sort}|${subject}|${debouncedQuery}|${retry}`;
  const loading = loadedKey !== key || loadingMore;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const request = ++requestRef.current;
    void fetchCommunityPage({ sort, page: 0, query: debouncedQuery, subject: subject === "all" ? null : subject }).then((result) => {
      if (request !== requestRef.current) return;
      // A Load more this request superseded never reports back; clear it here.
      setLoadingMore(false);
      setFailed(!result);
      setBoards(result?.boards ?? []);
      setNextPage(result?.nextPage ?? null);
      setLoadedKey(key);
    });
  }, [sort, subject, debouncedQuery, key]);

  const loadMore = () => {
    if (nextPage == null) return;
    const request = ++requestRef.current;
    setLoadingMore(true);
    void fetchCommunityPage({ sort, page: nextPage, query: debouncedQuery, subject: subject === "all" ? null : subject }).then((result) => {
      if (request !== requestRef.current) return;
      setLoadingMore(false);
      if (!result) return;
      setBoards((current) => [...current, ...result.boards.filter((board) => !current.some((entry) => entry.id === board.id))]);
      setNextPage(result.nextPage);
    });
  };

  const shown = boards;

  return (
    <AccountPageFrame
      title="Community"
      subtitle="Lessons other students asked Accelute to teach. Watch any board, then remix it to ask your own doubts on it."
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl border border-[rgba(255,255,255,0.1)] p-1" role="tablist" aria-label="Sort">
          {SORTS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={sort === item.id}
              onClick={() => setSort(item.id)}
              className={`rounded-lg px-3 py-1.5 text-xs ${sort === item.id ? "bg-[rgba(255,255,255,0.1)] text-frost" : "text-[rgba(237,237,235,0.6)]"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search lessons"
          aria-label="Search lessons"
          className="min-w-[14rem] flex-1 rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.22)] px-3 py-2 text-sm text-frost outline-none focus:border-sky-500"
        />
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {(["all", ...SUBJECTS] as SubjectFilter[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setSubject(item)}
            className={`rounded-lg border px-3 py-1.5 text-xs ${
              subject === item ? "border-sky-500 bg-sky-500/12 text-sky-200" : "border-[rgba(255,255,255,0.1)] text-frost"
            }`}
          >
            {item === "all" ? "All subjects" : SUBJECT_LABELS[item]}
          </button>
        ))}
      </div>

      {failed && boards.length === 0 ? (
        <AccountCard>
          <p className="text-sm text-[rgba(237,237,235,0.62)]">Community did not load.</p>
          <SiteButton className="mt-3" size="sm" onClick={() => setRetry((count) => count + 1)}>
            Try again
          </SiteButton>
        </AccountCard>
      ) : !loading && shown.length === 0 ? (
        <AccountCard>
          <p className="text-sm text-[rgba(237,237,235,0.62)]">
            {debouncedQuery.trim() ? "No lessons match that search." : sort === "featured" ? "Nothing featured yet." : "No lessons here yet."}
          </p>
        </AccountCard>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {shown.map((board) => (
            <CommunityCard key={board.id} board={board} />
          ))}
        </div>
      )}

      {nextPage != null && boards.length > 0 ? (
        <div className="mt-6 flex justify-center">
          <SiteButton size="sm" disabled={loading} onClick={loadMore}>
            {loading ? "Loading" : "Load more"}
          </SiteButton>
        </div>
      ) : null}
    </AccountPageFrame>
  );
}
