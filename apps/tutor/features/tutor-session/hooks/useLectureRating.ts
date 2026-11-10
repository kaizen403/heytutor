"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { LectureRatingMoment } from "@/lib/lecture-rating/ratingInput";
import { submitLectureRating } from "@/lib/lecture-rating/ratingClient";
import { liveTurnSave } from "../lib/turn/liveTurnSave";
import {
  DURING_PROMPT_AFTER_MS,
  DURING_PROMPT_VISIBLE_MS,
  RATING_RETRY_DELAYS_MS,
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

export type LectureRatingSendResult = "sent" | "failed";

interface RatingContent {
  boardId: string;
  turnId: string;
  moment: LectureRatingMoment;
  stars: number;
  feedback: string | null;
}

/** The newest content for one turn and moment, held until the server took it. */
interface QueuedRating {
  rating: RatingContent;
  /** Callers waiting on `rating`, or on an older content it replaced. */
  waiters: Array<(result: LectureRatingSendResult) => void>;
  inflight: boolean;
  attempts: number;
  retryTimer: number | null;
}

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
   * Resolves once the server holds it, after the turn's own first save.
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

  // Every rating waits for its own turn's first save, whichever turn the board
  // shows now. One request per turn and moment at a time, so the star saved on
  // click lands before the note that rewrites it.
  const queueRef = useRef(new Map<string, QueuedRating>());
  const pumpRef = useRef<() => void>(() => {});
  const pump = useCallback(() => {
    for (const [key, queued] of queueRef.current) {
      if (queued.inflight || queued.retryTimer !== null) continue;
      const state = liveTurnSave().turnSaveState(queued.rating.turnId);
      if (state === "waiting") continue;
      if (state === "stalled") {
        // Kept queued: a manual retry of the lecture's save still sends it.
        for (const resolve of queued.waiters.splice(0)) resolve("failed");
        continue;
      }
      if (state === "lost") {
        queueRef.current.delete(key);
        for (const resolve of queued.waiters) resolve("failed");
        continue;
      }
      const sent = queued.rating;
      const waiters = queued.waiters.splice(0);
      queued.inflight = true;
      const current = liveTurnSave().ratableTurnFor(owner, sent.boardId);
      void submitLectureRating(sent.boardId, sent.turnId, {
        moment: sent.moment,
        stars: sent.stars,
        feedback: sent.feedback,
        stepsTaught: current?.turnId === sent.turnId ? current.steps : 0,
      }).then((result) => {
        queued.inflight = false;
        if (!result.ok && result.retry && queued.attempts < RATING_RETRY_DELAYS_MS.length) {
          queued.waiters.unshift(...waiters);
          const delay = RATING_RETRY_DELAYS_MS[queued.attempts]!;
          queued.attempts += 1;
          queued.retryTimer = window.setTimeout(() => {
            queued.retryTimer = null;
            pumpRef.current();
          }, delay);
          return;
        }
        for (const resolve of waiters) resolve(result.ok ? "sent" : "failed");
        if (queued.rating === sent) {
          queueRef.current.delete(key);
        } else {
          queued.attempts = 0;
          pumpRef.current();
        }
      });
    }
  }, [owner]);
  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);
  useEffect(() => liveTurnSave().subscribe(() => pumpRef.current()), []);

  const rate = useCallback((stars: number, feedback: string | null = null): Promise<LectureRatingSendResult> => {
    if (!turn || !moment || !sessionId) return Promise.resolve("failed");
    if (moment === "during") {
      setDuringStars((current) => new Map(current).set(turn.turnId, stars));
    }
    const rating: RatingContent = { boardId: sessionId, turnId: turn.turnId, moment, stars, feedback };
    const key = ratingPromptKey(turn.turnId, moment);
    return new Promise<LectureRatingSendResult>((resolve) => {
      const queued = queueRef.current.get(key);
      if (queued) {
        queued.rating = rating;
        queued.waiters.push(resolve);
      } else {
        queueRef.current.set(key, { rating, waiters: [resolve], inflight: false, attempts: 0, retryTimer: null });
      }
      pumpRef.current();
    });
  }, [turn, moment, sessionId]);

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
