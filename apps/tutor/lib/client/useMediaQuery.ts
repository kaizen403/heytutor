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

/** Phone-only overlay chrome (nav drawer + notes sheet). Tablets keep persistent rails. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

/** Compact header actions below large screens. Sidebar visibility is md+, independent of this. */
export function useIsCompactNav(): boolean {
  return useMediaQuery("(max-width: 1023px)");
}
