"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * How many CSS pixels of the layout viewport sit below the visual viewport.
 *
 * On a phone that is the on-screen keyboard (and sometimes the browser chrome
 * after a scroll). The board's layout viewport must not resize with that —
 * rescaling Konva mid-lecture looks like a reload — so the composer uses this
 * inset to sit above the keyboard instead.
 */
function readInset(): number {
  const visual = window.visualViewport;
  if (!visual) return 0;
  const visualBottom = visual.offsetTop + visual.height;
  return Math.max(0, Math.round(window.innerHeight - visualBottom));
}

const subscribeToNothing = () => () => {};

export function useVisualViewportInset(): number {
  const subscribe = useCallback((onStoreChange: () => void) => {
    const visual = window.visualViewport;
    if (!visual) return subscribeToNothing();
    visual.addEventListener("resize", onStoreChange);
    visual.addEventListener("scroll", onStoreChange);
    window.addEventListener("orientationchange", onStoreChange);
    return () => {
      visual.removeEventListener("resize", onStoreChange);
      visual.removeEventListener("scroll", onStoreChange);
      window.removeEventListener("orientationchange", onStoreChange);
    };
  }, []);

  return useSyncExternalStore(subscribe, readInset, () => 0);
}
