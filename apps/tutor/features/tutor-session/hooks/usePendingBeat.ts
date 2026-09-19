"use client";

import { useEffect, useState } from "react";
import { LESSON_PENDING_BEATS, PENDING_BEAT_MS } from "../lib/board/pendingBeats";

/** Cycles the line under the pending clicker. Reduced motion keeps the first. */
export function usePendingBeat(periodMs = PENDING_BEAT_MS) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % LESSON_PENDING_BEATS.length);
    }, periodMs);

    return () => window.clearInterval(id);
  }, [periodMs]);

  return LESSON_PENDING_BEATS[index] ?? LESSON_PENDING_BEATS[0];
}
