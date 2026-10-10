"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { haltAllLectureAudio } from "@heytutor/tutor-core";
import { liveTurnSave } from "../lib/turn/liveTurnSave";

/**
 * Firefox often skips React unmount when the tab or window goes away
 * (pagehide + bfcache). The lecture AudioContext and speechSynthesis keep
 * talking on the machine even after the window is gone.
 *
 * pagehide / beforeunload run in that teardown. Do not halt from the effect
 * cleanup — React Strict Mode remounts would silence a live lecture.
 *
 * The page going away also saves the lesson. `pagehide` sends the small
 * keepalive close first (the unsent tail, words and ink), before the halt and
 * before any turn's telemetry flush: keepalive bodies share one 64 KiB budget.
 * It is registered at mount and in the capture phase, so it runs ahead of the
 * telemetry listener each turn adds later.
 *
 * `beforeunload` asks the student to stay only while lesson data is still
 * unsent (decision 8), and then does not halt: if the student stays, the
 * lesson goes on; if they leave, `pagehide` closes and halts.
 */
export function useLecturePageHalt(haltSession: () => void): void {
  const haltSessionRef = useRef(haltSession);
  useLayoutEffect(() => {
    haltSessionRef.current = haltSession;
  }, [haltSession]);

  useEffect(() => {
    const halt = () => {
      haltSessionRef.current();
      haltAllLectureAudio();
    };
    const onPageHide = () => {
      try {
        liveTurnSave().pageHideClose();
      } finally {
        halt();
      }
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (liveTurnSave().hasUnsentData()) {
        event.preventDefault();
        // Older browsers show the prompt only when returnValue is set.
        event.returnValue = "";
        return;
      }
      // A cancelled navigation must leave runtime and ownership intact.
      // Actual pagehide is the only unload event that closes and halts.
    };
    window.addEventListener("pagehide", onPageHide, { capture: true });
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onPageHide, { capture: true });
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);
}
