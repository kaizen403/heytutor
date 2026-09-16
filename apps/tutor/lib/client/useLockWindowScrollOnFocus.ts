"use client";

import { useEffect } from "react";

/**
 * iOS Safari pans the document when a field focuses, even inside an
 * overflow-hidden app shell. That pan looks like the lecture reloaded.
 * Snap the window back; the composer lifts via visual-viewport inset instead.
 */
export function useLockWindowScrollOnFocus(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const snap = () => {
      if (window.scrollX === 0 && window.scrollY === 0) return;
      window.scrollTo(0, 0);
    };
    window.addEventListener("focusin", snap);
    window.addEventListener("focusout", snap);
    window.visualViewport?.addEventListener("scroll", snap);
    window.visualViewport?.addEventListener("resize", snap);
    return () => {
      window.removeEventListener("focusin", snap);
      window.removeEventListener("focusout", snap);
      window.visualViewport?.removeEventListener("scroll", snap);
      window.visualViewport?.removeEventListener("resize", snap);
    };
  }, [enabled]);
}
