"use client";

import { useCallback, useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onStoreChange: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", onStoreChange);
    return () => media.removeEventListener("change", onStoreChange);
  }, [query]);

  const getSnapshot = useCallback(
    () => window.matchMedia(query).matches,
    [query],
  );
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Phone-only overlay chrome (notes sheet). Tablets keep the persistent notes rail. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

/** Persistent board-history sidebar only from large screens up; tablets use the drawer. */
export function useIsCompactNav(): boolean {
  return useMediaQuery("(max-width: 1023px)");
}
