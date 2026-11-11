"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { LectureRatingMoment } from "@/lib/lecture-rating/ratingInput";
import { liveTurnSave } from "../lib/turn/liveTurnSave";
import { lectureRatingQueue, type LectureRatingSendResult } from "../lib/turn/lectureRatingQueue";
import {
  DURING_PROMPT_AFTER_MS,
  DURING_PROMPT_VISIBLE_MS,
  duringClockRuns,
  lectureRatingPrompt,
  parseRatingTurnSnapshot,
  ratingPromptKey,
  ratingTurnSnapshot,
} from "../lib/turn/lectureRatingPrompt";

export interface LectureRatingPrompt {
  turnId: string;
  moment: LectureRatingMoment;
  /** Stars the student gave midway, for the card shown at the end. */
  duringStars: number | null;
}

export type { LectureRatingSendResult };

export interface UseLectureRatingParams {
  enabled: boolean;
  sessionId: string | null;
  /** The shell's live save owner (its cancel ref). */
  owner: object;
  /** A lesson is playing in this tab, not a replay. */
  lecturing: boolean;
  /** The student paused it: the midway clock and the card's timeout stop. */
  paused: boolean;
}

export interface UseLectureRatingResult {
  prompt: LectureRatingPrompt | null;
  /**
   * Save stars (and the note, when there is one) for the prompt's turn.
   * Resolves once the server holds it, after the turn's own first save. The
   * tab's queue keeps sending it after this board unmounts.
   */
  rate: (stars: number, feedback?: string | null) => Promise<LectureRatingSendResult>;
  /** The student is using the card: the midway card stops timing out. */
  hold: () => void;
  /** Close the card for this turn and moment. */
  close: () => void;
}

const subscribe = (listener: () => void) => liveTurnSave().subscribe(listener);

export function useLectureRating({ enabled, sessionId, owner, lecturing, paused }: UseLectureRatingParams): UseLectureRatingResult {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (enabled ? ratingTurnSnapshot(liveTurnSave().ratableTurnFor(owner, sessionId)) : ""),
    () => "",
  );
  const turn = useMemo(() => parseRatingTurnSnapshot(snapshot), [snapshot]);

  const [asked, setAsked] = useState<ReadonlySet<string>>(() => new Set());
  const [dueTurns, setDueTurns] = useState<ReadonlySet<string>>(() => new Set());
  const [heldKey, setHeldKey] = useState<string | null>(null);
  const [duringStars, setDuringStars] = useState<ReadonlyMap<string, number>>(() => new Map());

  const markAsked = useCallback((key: string) => {
    setAsked((current) => (current.has(key) ? current : new Set(current).add(key)));
  }, []);

  // The midway clock counts teaching time only: it stops while paused and
  // carries what it had counted into the next run.
  const clockTurnId = duringClockRuns(turn, lecturing) && !paused ? turn?.turnId ?? null : null;
  const taughtMsRef = useRef(new Map<string, number>());
  useEffect(() => {
    if (!clockTurnId) return undefined;
    const taught = taughtMsRef.current;
    const startedAt = Date.now();
    const counted = taught.get(clockTurnId) ?? 0;
    const timer = window.setTimeout(() => {
      setDueTurns((current) => new Set(current).add(clockTurnId));
    }, Math.max(0, DURING_PROMPT_AFTER_MS - counted));
    return () => {
      window.clearTimeout(timer);
      taught.set(clockTurnId, counted + (Date.now() - startedAt));
    };
  }, [clockTurnId]);

  const moment = enabled
    ? lectureRatingPrompt({ turn, lecturing, duringDue: Boolean(turn && dueTurns.has(turn.turnId)), asked })
    : null;
  const promptKey = turn && moment ? ratingPromptKey(turn.turnId, moment) : null;

  // An untouched midway card leaves on its own, but not while the lesson is paused.
  useEffect(() => {
    if (moment !== "during" || !promptKey || paused || heldKey === promptKey) return undefined;
    const timer = window.setTimeout(() => markAsked(promptKey), DURING_PROMPT_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [moment, promptKey, paused, heldKey, markAsked]);

  // The step count is the one when the student first rated this turn and
  // moment; a note sent later keeps it.
  const stepsRatedRef = useRef(new Map<string, number>());
  const rate = useCallback((stars: number, feedback: string | null = null): Promise<LectureRatingSendResult> => {
    if (!turn || !moment || !sessionId) return Promise.resolve("failed");
    if (moment === "during") {
      setDuringStars((current) => new Map(current).set(turn.turnId, stars));
    }
    const key = ratingPromptKey(turn.turnId, moment);
    let stepsTaught = stepsRatedRef.current.get(key);
    if (stepsTaught === undefined) {
      const current = liveTurnSave().ratableTurnFor(owner, sessionId);
      stepsTaught = current?.turnId === turn.turnId ? current.steps : 0;
      stepsRatedRef.current.set(key, stepsTaught);
    }
    return lectureRatingQueue().enqueue({ boardId: sessionId, turnId: turn.turnId, moment, stars, feedback, stepsTaught });
  }, [turn, moment, sessionId, owner]);

  const hold = useCallback(() => {
    if (promptKey) setHeldKey(promptKey);
  }, [promptKey]);

  const close = useCallback(() => {
    if (promptKey) markAsked(promptKey);
  }, [promptKey, markAsked]);

  const prompt = useMemo<LectureRatingPrompt | null>(() => {
    if (!turn || !moment) return null;
    return {
      turnId: turn.turnId,
      moment,
      duringStars: moment === "after" ? duringStars.get(turn.turnId) ?? null : null,
    };
  }, [turn, moment, duringStars]);

  return { prompt, rate, hold, close };
}
