"use client";

import { useEffect, useRef } from "react";
import { haltAllLectureAudio } from "@heytutor/tutor-core";

/**
 * Firefox often skips React unmount when the tab or window goes away
 * (pagehide + bfcache). The lecture AudioContext and speechSynthesis keep
 * talking on the machine even after the window is gone.
 *
 * pagehide / beforeunload run in that teardown. Do not halt from the effect
 * cleanup — React Strict Mode remounts would silence a live lecture.
 */
export function useLecturePageHalt(haltSession: () => void): void {
  const haltSessionRef = useRef(haltSession);
  haltSessionRef.current = haltSession;

  useEffect(() => {
    const halt = () => {
      haltSessionRef.current();
      haltAllLectureAudio();
    };
    window.addEventListener("pagehide", halt);
    window.addEventListener("beforeunload", halt);
    return () => {
      window.removeEventListener("pagehide", halt);
      window.removeEventListener("beforeunload", halt);
    };
  }, []);
}
