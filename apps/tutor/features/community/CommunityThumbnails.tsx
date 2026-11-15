"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";

const Renderer = dynamic(() => import("./CommunityThumbnailRenderer"), { ssr: false });
const ThumbnailContext = createContext<{
  images: Record<string, string | null>;
  request: (boardId: string) => void;
} | null>(null);

/** One offscreen board at a time; gallery cards never mount 24 tutor sessions. */
export function CommunityThumbnails({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<string[]>([]);
  const [images, setImages] = useState<Record<string, string | null>>({});
  const requested = useRef(new Set<string>());
  const urls = useRef<string[]>([]);
  const request = useCallback((boardId: string) => {
    if (requested.current.has(boardId)) return;
    requested.current.add(boardId);
    setQueue((current) => [...current, boardId]);
  }, []);
  const complete = useCallback((boardId: string, blob: Blob | null) => {
    const url = blob ? URL.createObjectURL(blob) : null;
    if (url) urls.current.push(url);
    setImages((current) => ({ ...current, [boardId]: url }));
    setQueue((current) => current.filter((id) => id !== boardId));
  }, []);
  useEffect(() => {
    const owned = urls.current;
    return () => owned.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  return (
    <ThumbnailContext.Provider value={{ images, request }}>
      {children}
      {queue[0] ? <Renderer key={queue[0]} boardId={queue[0]} onComplete={complete} /> : null}
    </ThumbnailContext.Provider>
  );
}

/** Missing or broken saved images are rebuilt from Community's public turns. */
export function CommunityThumbnail({ boardId, thumbnailUrl }: { boardId: string; thumbnailUrl: string | null }) {
  const context = useContext(ThumbnailContext);
  const [imageFailed, setImageFailed] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const request = context?.request;
  const saved = imageFailed ? null : thumbnailUrl;
  const generated = context?.images[boardId];
  const src = saved ?? generated;

  useEffect(() => {
    const element = container.current;
    if (saved || !element || !request) return;
    if (typeof IntersectionObserver === "undefined") {
      request(boardId);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      request(boardId);
      observer.disconnect();
    }, { rootMargin: "100px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [saved, request, boardId]);

  return (
    <div ref={container} className="h-full w-full">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setImageFailed(true)}
          className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.02]" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-[rgba(237,237,235,0.4)]">
          {generated === null ? "Board preview unavailable" : "Loading board…"}
        </div>
      )}
    </div>
  );
}
