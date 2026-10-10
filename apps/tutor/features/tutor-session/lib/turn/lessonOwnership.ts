/** Same-browser exclusivity. A held Web Lock never expires during a long pause. */
export type LessonOwnerState = "active" | "inactive" | "unknown";
export interface LessonClaim {
  release(): void;
}
export interface LessonOwnershipTransport {
  acquire(
    boardId: string,
    signal: AbortSignal,
  ): Promise<LessonClaim | "busy" | "unknown">;
  probe(boardId: string): Promise<LessonOwnerState>;
}
export interface LessonAdmissionReceipt {
  admitted: Promise<boolean>;
  finished: Promise<void>;
}
interface Attempt {
  controller: AbortController;
  claim: LessonClaim | null;
}

/** One synchronous attempt per shell, before acquisition or any provider work. */
export class LessonAdmission {
  private readonly attempts = new Map<object, Attempt>();
  constructor(private readonly transport: LessonOwnershipTransport) {}
  probe(boardId: string): Promise<LessonOwnerState> {
    return this.transport.probe(boardId).catch(() => "unknown");
  }
  hasAttempt(owner: object): boolean {
    return this.attempts.has(owner);
  }
  start(
    owner: object,
    boardId: string,
    options: {
      current(): boolean;
      /** Fresh saved last-page chain, checked under the exclusive claim. */
      validate(): Promise<boolean>;
      run(): Promise<void>;
    },
  ): LessonAdmissionReceipt {
    if (this.attempts.has(owner))
      return { admitted: Promise.resolve(false), finished: Promise.resolve() };
    const attempt: Attempt = { controller: new AbortController(), claim: null };
    this.attempts.set(owner, attempt);
    let acknowledge!: (value: boolean) => void;
    const admitted = new Promise<boolean>((resolve) => {
      acknowledge = resolve;
    });
    const current = () =>
      this.attempts.get(owner) === attempt &&
      !attempt.controller.signal.aborted &&
      options.current();
    const finished = (async () => {
      try {
        const claim = await this.transport
          .acquire(boardId, attempt.controller.signal)
          .catch(() => "unknown" as const);
        if (typeof claim === "string") {
          acknowledge(false);
          return;
        }
        attempt.claim = claim;
        if (
          !current() ||
          !(await options.validate().catch(() => false)) ||
          !current()
        ) {
          acknowledge(false);
          return;
        }
        acknowledge(true);
        await options.run();
      } finally {
        acknowledge(false);
        const held = attempt.claim;
        attempt.claim = null;
        held?.release();
        if (this.attempts.get(owner) === attempt) this.attempts.delete(owner);
      }
    })();
    return { admitted, finished };
  }
  /** Caller captures and halts the matching runtime before cancellation. */
  cancel(owner: object): void {
    const attempt = this.attempts.get(owner);
    if (!attempt) return;
    this.attempts.delete(owner);
    attempt.controller.abort();
    const held = attempt.claim;
    attempt.claim = null;
    held?.release();
  }
}

const lockName = (boardId: string) => `heytutor-lesson:${boardId}`;
export function browserLessonTransport(): LessonOwnershipTransport {
  return {
    acquire: async (boardId, signal) => {
      if (signal.aborted) return "busy";
      if (typeof navigator === "undefined" || !navigator.locks?.request)
        return "unknown";
      return new Promise((resolve) => {
        void navigator.locks
          .request(
            lockName(boardId),
            { mode: "exclusive", ifAvailable: true },
            async (lock) => {
              if (!lock) {
                resolve("busy");
                return;
              }
              let unlock!: () => void;
              const held = new Promise<void>((done) => {
                unlock = done;
              });
              let released = false;
              const claim = {
                release: () => {
                  if (!released) {
                    released = true;
                    unlock();
                  }
                },
              };
              if (signal.aborted) claim.release();
              resolve(claim);
              await held;
            },
          )
          .catch(() => resolve("unknown"));
      });
    },
    probe: async (boardId) => {
      if (typeof navigator === "undefined" || !navigator.locks?.query)
        return "unknown";
      const snapshot = await navigator.locks.query();
      return snapshot.held?.some((lock) => lock.name === lockName(boardId))
        ? "active"
        : "inactive";
    },
  };
}
let browserAdmission: LessonAdmission | null = null;
export const lessonAdmission = (): LessonAdmission =>
  (browserAdmission ??= new LessonAdmission(browserLessonTransport()));
