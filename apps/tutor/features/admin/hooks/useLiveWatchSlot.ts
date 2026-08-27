"use client";

import { useEffect, useState } from "react";
import { type LiveWatchSlotRect, readLiveWatchSlotRect } from "../lib/headlessRuntime";

export function useLiveWatchSlot(active: boolean, boardId?: string | null): LiveWatchSlotRect | null {
  const [rect, setRect] = useState<LiveWatchSlotRect | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }

    let observer: ResizeObserver | null = null;
    let observed: Element | null = null;

    const update = () => {
      setRect(readLiveWatchSlotRect());
      const el = document.querySelector("[data-live-watch-slot]");
      if (el && el !== observed) {
        observer?.disconnect();
        observer = new ResizeObserver(update);
        observer.observe(el);
        observed = el;
      }
    };

    window.addEventListener("resize", update);
    const frame = window.requestAnimationFrame(update);
    const timer = window.setTimeout(update, 50);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [active, boardId]);

  return active ? rect : null;
}
