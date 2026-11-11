/**
 * The tab's lecture ratings on their way to the server. Each waits for its own
 * turn's first save, then is sent with what it held when the student rated.
 * It outlives the board: a student who opens the library while a rating waits
 * still has it sent once the lecture saves.
 */
import type { LectureRatingMoment } from "@/lib/lecture-rating/ratingInput";
import { submitLectureRating, type LectureRatingResult, type LectureRatingSubmission } from "@/lib/lecture-rating/ratingClient";
import { RATING_RETRY_DELAYS_MS, ratingPromptKey } from "./lectureRatingPrompt";
import { liveTurnSave, type LiveTurnSaveRegistry } from "./liveTurnSave";

export type LectureRatingSendResult = "sent" | "failed";

export interface LectureRatingContent {
  boardId: string;
  turnId: string;
  moment: LectureRatingMoment;
  stars: number;
  feedback: string | null;
  /** Finished steps when the student rated, kept through every send. */
  stepsTaught: number;
}

export interface LectureRatingQueueEnv {
  saveState: LiveTurnSaveRegistry["turnSaveState"];
  /** Called on every change to the lecture saves. */
  subscribe: (listener: () => void) => () => void;
  submit: (boardId: string, turnId: string, submission: LectureRatingSubmission) => Promise<LectureRatingResult>;
  setTimer: (callback: () => void, ms: number) => unknown;
}

/** The newest content for one turn and moment, held until the server took it. */
interface QueuedRating {
  rating: LectureRatingContent;
  /** Callers waiting on `rating`, or on an older content it replaced. */
  waiters: Array<(result: LectureRatingSendResult) => void>;
  inflight: boolean;
  attempts: number;
  retrying: boolean;
}

export class LectureRatingQueue {
  private readonly queued = new Map<string, QueuedRating>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly env: LectureRatingQueueEnv) {}

  /**
   * Resolves once the server holds `rating`, or when it cannot be sent. One
   * request per turn and moment at a time, so the star saved on click lands
   * before the note that rewrites it.
   */
  enqueue(rating: LectureRatingContent): Promise<LectureRatingSendResult> {
    const key = ratingPromptKey(rating.turnId, rating.moment);
    return new Promise((resolve) => {
      const queued = this.queued.get(key);
      if (queued) {
        queued.rating = rating;
        queued.waiters.push(resolve);
      } else {
        this.queued.set(key, { rating, waiters: [resolve], inflight: false, attempts: 0, retrying: false });
      }
      this.listen();
      this.pump();
    });
  }

  /** Ratings not yet held by the server. */
  get size(): number {
    return this.queued.size;
  }

  private listen(): void {
    if (this.unsubscribe || this.queued.size === 0) return;
    this.unsubscribe = this.env.subscribe(() => this.pump());
  }

  private remove(key: string): void {
    this.queued.delete(key);
    if (this.queued.size === 0 && this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private pump(): void {
    for (const [key, queued] of [...this.queued]) {
      if (queued.inflight || queued.retrying) continue;
      const state = this.env.saveState(queued.rating.turnId);
      if (state === "waiting") continue;
      if (state === "stalled") {
        // Kept queued: a manual retry of the lecture's save still sends it.
        for (const resolve of queued.waiters.splice(0)) resolve("failed");
        continue;
      }
      if (state === "lost") {
        this.remove(key);
        for (const resolve of queued.waiters) resolve("failed");
        continue;
      }
      this.send(key, queued);
    }
  }

  private send(key: string, queued: QueuedRating): void {
    const sent = queued.rating;
    const waiters = queued.waiters.splice(0);
    queued.inflight = true;
    void this.env.submit(sent.boardId, sent.turnId, {
      moment: sent.moment,
      stars: sent.stars,
      feedback: sent.feedback,
      stepsTaught: sent.stepsTaught,
    }).then((result) => {
      queued.inflight = false;
      if (!result.ok && result.retry && queued.attempts < RATING_RETRY_DELAYS_MS.length) {
        queued.waiters.unshift(...waiters);
        const delay = RATING_RETRY_DELAYS_MS[queued.attempts]!;
        queued.attempts += 1;
        queued.retrying = true;
        this.env.setTimer(() => {
          queued.retrying = false;
          this.pump();
        }, delay);
        return;
      }
      for (const resolve of waiters) resolve(result.ok ? "sent" : "failed");
      if (queued.rating === sent) {
        this.remove(key);
      } else {
        queued.attempts = 0;
        this.pump();
      }
    });
  }
}

let tabQueue: LectureRatingQueue | null = null;

/** The tab's one rating queue, beside the tab's one lecture save registry. */
export function lectureRatingQueue(): LectureRatingQueue {
  if (tabQueue) return tabQueue;
  tabQueue = new LectureRatingQueue({
    saveState: (turnId) => liveTurnSave().turnSaveState(turnId),
    subscribe: (listener) => liveTurnSave().subscribe(listener),
    submit: submitLectureRating,
    setTimer: (callback, ms) => globalThis.setTimeout(callback, ms),
  });
  return tabQueue;
}
