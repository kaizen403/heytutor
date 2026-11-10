"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { LectureRatingMoment } from "@/lib/lecture-rating/ratingInput";
import { submitLectureRating } from "@/lib/lecture-rating/ratingClient";
import { liveTurnSave } from "../lib/turn/liveTurnSave";
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

/** `queued`: the turn is not saved yet; the rating goes out when it is. */
export type LectureRatingSendResult = "sent" | "queued" | "failed";

interface PendingRating {
  boardId: string;
  turnId: string;
  moment: LectureRatingMoment;
  stars: number;
  feedback: string | null;
}

export interface UseLectureRatingParams {
  enabled: boolean;
  sessionId: string | null;
  /** The shell's live save owner (its cancel ref). */
  owner: object;
  /** A lesson is playing in this tab, not a replay. */
  lecturing: boolean;
}

export interface UseLectureRatingResult {
  prompt: LectureRatingPrompt | null;
  /** Save stars (and the note, when there is one) for the prompt's turn. */
  rate: (stars: number, feedback?: string | null) => Promise<LectureRatingSendResult>;
  /** The student is using the card: the midway card stops timing out. */
  hold: () => void;
  /** Close the card for this turn and moment. */
  close: () => void;
}

const subscribe = (listener: () => void) => liveTurnSave().subscribe(listener);

export function useLectureRating({ enabled, sessionId, owner, lecturing }: UseLectureRatingParams): UseLectureRatingResult {
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
  const pendingRef = useRef(new Map<string, PendingRating>());

  const markAsked = useCallback((key: string) => {
    setAsked((current) => (current.has(key) ? current : new Set(current).add(key)));
  }, []);

  // The midway clock: a playing lesson becomes due after it has taught a while.
  const clockRuns = duringClockRuns(turn, lecturing);
  const clockTurnId = clockRuns ? turn?.turnId ?? null : null;
  useEffect(() => {
    if (!clockTurnId) return undefined;
    const timer = window.setTimeout(() => {
      setDueTurns((current) => new Set(current).add(clockTurnId));
    }, DURING_PROMPT_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [clockTurnId]);

  const moment = enabled
    ? lectureRatingPrompt({ turn, lecturing, duringDue: Boolean(turn && dueTurns.has(turn.turnId)), asked })
    : null;
  const promptKey = turn && moment ? ratingPromptKey(turn.turnId, moment) : null;

  // An untouched midway card leaves on its own.
  useEffect(() => {
    if (moment !== "during" || !promptKey || heldKey === promptKey) return undefined;
    const timer = window.setTimeout(() => markAsked(promptKey), DURING_PROMPT_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [moment, promptKey, heldKey, markAsked]);

  // One request at a time per turn and moment: the star saved on click must
  // land before the note that rewrites it.
  const chainsRef = useRef(new Map<string, Promise<unknown>>());
  const send = useCallback((rating: PendingRating): Promise<LectureRatingSendResult> => {
    const key = ratingPromptKey(rating.turnId, rating.moment);
    const run = async (): Promise<LectureRatingSendResult> => {
      const current = liveTurnSave().ratableTurnFor(owner, rating.boardId);
      const steps = current?.turnId === rating.turnId ? current.steps : 0;
      const result = await submitLectureRating(rating.boardId, rating.turnId, {
        moment: rating.moment,
        stars: rating.stars,
        feedback: rating.feedback,
        stepsTaught: steps,
      });
      return result.ok ? "sent" : "failed";
    };
    const next = (chainsRef.current.get(key) ?? Promise.resolve()).then(run, run);
    chainsRef.current.set(key, next);
    return next;
  }, [owner]);

  // Ratings picked before the turn's first save go out once it lands.
  useEffect(() => {
    if (!turn?.saved) return;
    for (const [key, rating] of pendingRef.current) {
      if (rating.turnId !== turn.turnId) continue;
      pendingRef.current.delete(key);
      void send(rating);
    }
  }, [turn?.saved, turn?.turnId, send]);

  const rate = useCallback(async (stars: number, feedback: string | null = null): Promise<LectureRatingSendResult> => {
    if (!turn || !moment || !sessionId) return "failed";
    const rating: PendingRating = { boardId: sessionId, turnId: turn.turnId, moment, stars, feedback };
    if (moment === "during") {
      setDuringStars((current) => new Map(current).set(turn.turnId, stars));
    }
    if (!turn.saved) {
      pendingRef.current.set(ratingPromptKey(turn.turnId, moment), rating);
      return "queued";
    }
    return send(rating);
  }, [turn, moment, sessionId, send]);

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
