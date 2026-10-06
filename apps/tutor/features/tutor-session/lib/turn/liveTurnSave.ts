/**
 * Progressive lesson saving: a lesson is stored while it is taught, so Stop,
 * a board switch, an error, a 402 or a closed tab never loses what the
 * student already saw.
 *
 * One registry per tab (module state, not hook state), so a save keeps going
 * across a board switch and an unmount. Each billed turn gets a handle with a
 * client minted turn id. The handle checkpoints (`PUT /turns/{turnId}`) after
 * every recorded segment with at most one request in flight, and at once on
 * Stop, figure commit, completion and the tab going hidden. On `pagehide` it
 * sends a small keepalive close (`PATCH`) with the unsent tail, words and ink
 * only.
 *
 * Rules the server relies on (see `lib/boards/turnCheckpoint.ts`):
 * - Submitted rows only grow. A sent row is final, so the rows of a figure
 *   intro are held until the figure commits, and dropped if it never does.
 * - A turn's first request waits for every earlier turn on the same board to
 *   exist on the server (or fail for good), so a doubt is ordered after the
 *   lesson it stopped. If that lesson never reached the server, the doubt
 *   opens its own page instead of continuing a page that does not exist.
 * - `seq` strictly increases; a stale answer changes nothing; a 409 resends
 *   from the server's count; a complete turn is final.
 *
 * Everything that touches the network, the clock or the page is injected, so
 * `scripts/verify/verify-live-turn-save.ts` drives the real logic.
 */
import {
  checkpointTurn,
  closeTurnKeepalive,
  type RecordedSegmentPayload,
  type SaveFailure,
  type SaveTurnResult,
  type StoredSegment,
  type StoredTurn,
  type TurnCheckpointInput,
  type TurnCheckpointResult,
  type TurnCloseInput,
  type TurnKind,
  type TurnStatus,
} from "@/lib/boards/boardsClient";
import type { DrawCommand } from "@heytutor/drawing";
import {
  doubtTurnScene,
  partialTurnScene,
  partialTurnSegments,
  textOnlyTurnScene,
  type BoardPageRecord,
  type PersistedTurnScene,
} from "./doubtTurn";
import { IDLE_SAVE, type SaveStatus } from "./saveStatus";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LiveTurnSaveTransport {
  checkpoint(boardId: string, turnId: string, input: TurnCheckpointInput): Promise<TurnCheckpointResult>;
  close(boardId: string, turnId: string, input: TurnCloseInput): Promise<TurnCheckpointResult>;
}

export interface LiveTurnSaveEnv {
  transport: LiveTurnSaveTransport;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
  now(): number;
  isOnline(): boolean;
  mintId(): string;
}

/** Waits between retries of a retryable failure. After the last, the save is failed. */
export const SAVE_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
/** 409 resends in a row before a conflict is treated like any other retryable failure. */
const MAX_CONFLICT_RESENDS = 3;
/**
 * How long a stopped turn with nothing saved waits for the segment Stop cut
 * off. Stop closes the turn at once; the cut segment records its row from its
 * own async cleanup a moment later. Only then may an empty doubt or resume be
 * dropped.
 */
export const CUT_ROW_GRACE_MS = 5_000;
/**
 * A checkpoint that has not answered by then is aborted and retried, so a hung
 * connection never holds up Stop, completion or Try again. Clips add time at
 * a slow upload rate.
 */
export const CHECKPOINT_TIMEOUT_MS = 30_000;
const CHECKPOINT_TIMEOUT_MAX_MS = 120_000;
const CHECKPOINT_SLOW_UPLOAD_BYTES_PER_S = 50_000;

/** The timeout for one checkpoint carrying `audioBytes` bytes of clips. */
export function checkpointTimeoutMs(audioBytes: number): number {
  const upload = Math.ceil(Math.max(0, audioBytes) / CHECKPOINT_SLOW_UPLOAD_BYTES_PER_S) * 1_000;
  return Math.min(CHECKPOINT_TIMEOUT_MAX_MS, CHECKPOINT_TIMEOUT_MS + upload);
}

export interface LiveTurnBeginInput {
  /** The session that owns the turn (one per shell; the shell's cancel ref). */
  owner: object;
  /** The shell's turn generation; segment hooks address the turn by it. */
  generation: number;
  boardId: string;
  /** The billed trace. In production a turn saves only under its owned trace. */
  traceId: string | null;
  kind: TurnKind;
  /** What the turn is saved as (a doubt's title for a doubt). */
  question: string;
  /** The page's lesson question, for the board list. */
  preview: string;
  speedMultiplier: number;
  /** The page plan says this turn continues the page a saved turn left. */
  continuesBoard: boolean;
  /** The live page record; may be attached later with `setPage`. */
  page?: BoardPageRecord | null;
}

/** What a mirror receives: the turn as this tab knows it, for `storedTurnsRef`. */
export type LiveTurnMirrorEvent =
  | {
      source: "local";
      boardId: string;
      turnId: string;
      preview: string;
      /** A turn shaped like a saved one, with in-memory rows (audio as bytes). */
      turn: Omit<StoredTurn, "segments">;
      rows: RecordedSegmentPayload[];
    }
  | {
      source: "server";
      boardId: string;
      turnId: string;
      preview: string;
      turn: StoredTurn;
      /** The submitted rows, so local clips can stand in for server URLs. */
      rows: RecordedSegmentPayload[];
    };

export interface LiveTurnOwnerHooks {
  /** The board the owner shows now. A turn is mirrored only onto its own open board. */
  openBoardId(): string | null;
  mirror(event: LiveTurnMirrorEvent): void;
}

export interface LiveTurnHandle {
  readonly turnId: string;
  readonly boardId: string;
  setPage(page: BoardPageRecord): void;
  /** Save as stopped. Idempotent, and a no-op once completion was asked for. */
  close(): void;
  /** Save as complete. Resolves when the server holds it, or the save failed for good. */
  complete(input: { rawResponse: string }): Promise<SaveTurnResult>;
  /** The rows as submitted (submitted index as orderIndex), audio included. */
  submittedRows(): RecordedSegmentPayload[];
}

/** A finished step of the live turn with its clip in memory (the export contract). */
export type LiveTurnSegment = StoredSegment & { audioBytes?: Uint8Array | null };
export type LiveTurnSnapshot = Omit<StoredTurn, "segments"> & { segments: LiveTurnSegment[] };

interface RecordedEntry {
  row: RecordedSegmentPayload;
  /** Recorded inside a figure intro transaction: held until the figure commits. */
  intro: boolean;
}

interface LiveTurn {
  readonly turnId: string;
  readonly owner: object;
  readonly generation: number;
  readonly boardId: string;
  readonly traceId: string | null;
  readonly kind: TurnKind;
  readonly question: string;
  readonly preview: string;
  readonly speedMultiplier: number;
  readonly continuesBoard: boolean;
  readonly order: number;
  page: BoardPageRecord | null;
  recorded: RecordedEntry[];
  /** Entries of `recorded` already moved to `frozen` or dropped. */
  taken: number;
  cutRow: RecordedSegmentPayload | null;
  /** Index of the cut row in `frozen`, or -1. */
  cutFrozenIndex: number;
  /** Decided at the first request; null until then. */
  opensPage: boolean | null;
  /** Submitted rows, final once here. orderIndex = submitted index. */
  frozen: RecordedSegmentPayload[];
  /** Per submitted index: the server holds this row's clip (or it has none). */
  audioAcked: boolean[];
  ackedCount: number;
  ackedStatus: TurnStatus | null;
  seq: number;
  status: TurnStatus;
  rawResponse: string;
  textOnly: boolean;
  resumeState: Record<string, unknown> | null | undefined;
  resumeDirty: boolean;
  inflight: Promise<void> | null;
  /** Submitted rows covered by the last keepalive close, or -1. */
  keepaliveCovered: number;
  retryTimer: unknown;
  hasRetryTimer: boolean;
  /** Stopped with nothing to save yet: waiting for the cut segment's row. */
  cutGraceTimer: unknown;
  hasCutGrace: boolean;
  waitingOnline: boolean;
  attempt: number;
  conflicts: number;
  failure: SaveFailure | null;
  final: boolean;
  /** Ended with nothing worth a turn: never sent, never blocks the board's queue. */
  abandoned: boolean;
  lastAckAt: number | null;
  completeWaiters: Array<(result: SaveTurnResult) => void>;
  completeResult: SaveTurnResult | null;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const CLEAR_COMMAND: DrawCommand = { type: "CLEAR", params: [], charPosition: 0, narrationBefore: "" };

/** The runtime's page turn, as `withBoardEpochSegment` persists it. */
function epochRow(): RecordedSegmentPayload {
  return {
    orderIndex: 0,
    narration: "",
    spokenText: "",
    command: CLEAR_COMMAND,
    audioBytes: null,
    durationMs: 50,
    timings: null,
  };
}

/** What the turn said so far, in order. Empty is allowed until complete. */
export function liveTurnNarration(rows: readonly Pick<RecordedSegmentPayload, "narration">[]): string {
  return rows.map((row) => row.narration.trim()).filter(Boolean).join(" ");
}

/**
 * The scene a checkpoint states for the rows so far.
 * - A doubt is text on the page it continues (the marker keeps it there), or
 *   text on a page of its own when that page never reached the server.
 * - A lesson states its figure only once the figure is drawn; until then, and
 *   for a stopped turn whose figure never committed, it is text with its plan.
 * - Completion keeps today's final save: the page's scene as planned.
 * - The text only fallback (decision 7) drops the figure and keeps the plan.
 */
export function liveTurnScene(input: {
  page: BoardPageRecord | null;
  kind: TurnKind;
  preview: string;
  opensPage: boolean;
  status: TurnStatus;
  textOnly: boolean;
}): PersistedTurnScene {
  const { page } = input;
  if (input.kind === "doubt" || page?.turn.kind === "doubt") {
    return doubtTurnScene(page?.lessonQuestion ?? input.preview, !input.opensPage);
  }
  if (!page) return textOnlyTurnScene();
  if (input.textOnly) {
    return page.turn.scene?.visualStatus === "validated"
      ? partialTurnScene({ ...page, figureDrawn: false })
      : textOnlyTurnScene();
  }
  if (input.status === "complete") return page.turn.scene ?? textOnlyTurnScene();
  return partialTurnScene(page);
}

/** Copy for a save that stopped retrying. No dashes (owner rule). */
export function saveFailureMessage(failure: Pick<SaveFailure, "reason">): string {
  switch (failure.reason) {
    case "quota":
      return "Your storage is full, so this lesson was not saved.";
    case "signed_out":
      return "You are signed out, so this lesson was not saved.";
    case "not_found":
    case "forbidden":
      return "This board is no longer yours to save to.";
    default:
      return "This lesson did not save.";
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class LiveTurnSaveRegistry {
  private readonly env: LiveTurnSaveEnv;
  private readonly turns: LiveTurn[] = [];
  private readonly owners = new Map<object, LiveTurnOwnerHooks>();
  private readonly listeners = new Set<() => void>();
  private readonly statusCache = new Map<string, { key: string; status: SaveStatus }>();
  private order = 0;

  constructor(env: LiveTurnSaveEnv) {
    this.env = env;
  }

  // --- Lifecycle of one turn -------------------------------------------------

  /** Called once billing passed: mints the turn id. Nothing is sent yet. */
  begin(input: LiveTurnBeginInput): LiveTurnHandle {
    const turn: LiveTurn = {
      turnId: this.env.mintId(),
      owner: input.owner,
      generation: input.generation,
      boardId: input.boardId,
      traceId: input.traceId,
      kind: input.kind,
      question: input.question,
      preview: input.preview,
      speedMultiplier: input.speedMultiplier,
      continuesBoard: input.continuesBoard,
      order: ++this.order,
      page: input.page ?? null,
      recorded: [],
      taken: 0,
      cutRow: null,
      cutFrozenIndex: -1,
      opensPage: null,
      frozen: [],
      audioAcked: [],
      ackedCount: 0,
      ackedStatus: null,
      seq: 0,
      status: "live",
      rawResponse: "",
      textOnly: false,
      resumeState: undefined,
      resumeDirty: false,
      inflight: null,
      keepaliveCovered: -1,
      retryTimer: null,
      hasRetryTimer: false,
      cutGraceTimer: null,
      hasCutGrace: false,
      waitingOnline: false,
      attempt: 0,
      conflicts: 0,
      failure: null,
      final: false,
      abandoned: false,
      lastAckAt: null,
      completeWaiters: [],
      completeResult: null,
    };
    this.turns.push(turn);
    this.prune(turn.boardId);
    this.emit();
    return {
      turnId: turn.turnId,
      boardId: turn.boardId,
      setPage: (page) => {
        turn.page = page;
      },
      close: () => this.closeTurn(turn, { stopped: false }),
      complete: (completion) => this.completeTurn(turn, completion.rawResponse),
      submittedRows: () => this.previewRows(turn, { includeCut: true }),
    };
  }

  /** A finished segment of the owner's turn `generation`. */
  recordRow(owner: object, generation: number, row: RecordedSegmentPayload, options: { intro: boolean }): void {
    const turn = this.find(owner, generation);
    if (!turn || turn.status !== "live") return;
    turn.recorded.push({ row, intro: options.intro });
    this.emit();
    this.pump(turn);
  }

  /**
   * The segment Stop cut off (decision 12): its ink and words, no audio. Kept
   * apart from the finished rows and saved after them once the turn closed.
   */
  recordCutRow(owner: object, generation: number, row: RecordedSegmentPayload): void {
    const turn = this.find(owner, generation);
    if (!turn || turn.status === "complete" || turn.cutRow || turn.final) return;
    turn.cutRow = { ...row, audioBytes: null, timings: null };
    this.endCutGrace(turn);
    if (turn.status === "stopped") {
      this.mirrorLocal(turn);
      this.emit();
      this.pump(turn);
    }
  }

  /** The figure intro committed: its held rows are ink now and go out at once. */
  figureCommitted(owner: object, generation: number): void {
    const turn = this.find(owner, generation);
    if (!turn) return;
    this.emit();
    this.pump(turn);
  }

  /** The figure intro rolled back: its held rows never reach the server. */
  dropIntroRows(owner: object, generation: number): void {
    const turn = this.find(owner, generation);
    if (!turn) return;
    const kept = turn.recorded.slice(0, turn.taken);
    for (const entry of turn.recorded.slice(turn.taken)) {
      if (!entry.intro) kept.push(entry);
    }
    turn.recorded = kept;
    this.emit();
    this.pump(turn);
  }

  /** Close every open turn of `owner` as stopped (Stop, board switch). */
  closeOwner(owner: object): void {
    for (const turn of [...this.turns]) {
      if (turn.owner === owner && turn.status === "live") this.closeTurn(turn, { stopped: true });
    }
  }

  /** What a later Continue needs; sent with the next checkpoint. */
  setResumeState(owner: object, generation: number, state: Record<string, unknown> | null): void {
    const turn = this.find(owner, generation);
    if (!turn || turn.final) return;
    turn.resumeState = state;
    turn.resumeDirty = true;
    this.pump(turn);
  }

  // --- Page events -----------------------------------------------------------

  /** The tab went hidden: send what is pending now, the page may not come back. */
  flushAll(): void {
    for (const turn of [...this.turns]) this.pump(turn);
  }

  /** The browser is back online: resume the saves that waited for it. */
  online(): void {
    for (const turn of [...this.turns]) {
      if (!turn.waitingOnline) continue;
      turn.waitingOnline = false;
      this.pump(turn);
    }
    this.emit();
  }

  /**
   * `pagehide`: one small keepalive close per turn with unsent data, words and
   * ink only. Call it before the telemetry flush; the bodies share one 64 KiB
   * keepalive budget.
   */
  pageHideClose(): void {
    for (const turn of [...this.turns]) {
      if (turn.final) continue;
      if (turn.status === "live") turn.status = "stopped";
      if (turn.opensPage === null) turn.opensPage = this.decideOpensPage(turn);
      this.freeze(turn);
      if (this.abandonIfEmpty(turn)) continue;
      const statusSent = turn.ackedStatus === turn.status ||
        (turn.ackedStatus === "stopped" && turn.status === "complete");
      if (turn.frozen.length <= turn.ackedCount && statusSent && !turn.inflight) continue;
      // Another shell of this tab already sent this close.
      if (turn.keepaliveCovered === turn.frozen.length) continue;
      turn.keepaliveCovered = turn.frozen.length;
      const seq = Math.max(turn.seq, 0) + 1;
      turn.seq = seq;
      const scene = this.sceneFor(turn);
      void this.env.transport.close(turn.boardId, turn.turnId, {
        seq,
        status: "stopped",
        traceId: turn.traceId,
        baseCount: turn.ackedCount,
        segments: turn.frozen.slice(turn.ackedCount),
        rawResponse: liveTurnNarration(turn.frozen),
        question: turn.question,
        preview: turn.preview,
        kind: turn.kind,
        speedMultiplier: turn.speedMultiplier,
        sceneArtifacts: turn.ackedStatus === null ? scene.sceneArtifacts : undefined,
        ...(turn.resumeDirty ? { resumeState: turn.resumeState ?? null } : {}),
      }).then((result) => this.onCloseResult(turn, result), () => undefined);
    }
    this.emit();
  }

  // --- Reads -------------------------------------------------------------------

  /** Unsent lesson data in this tab: the only time a `beforeunload` prompt is shown. */
  hasUnsentData(): boolean {
    return this.turns.some((turn) => this.hasUnsent(turn));
  }

  /** Resolves true once the board's saves settled, false after `timeoutMs`. */
  drained(boardId: string, timeoutMs: number): Promise<boolean> {
    const settled = () => !this.turns.some((turn) => turn.boardId === boardId && this.busy(turn));
    if (settled()) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (value: boolean) => {
        if (done) return;
        done = true;
        unsubscribe();
        this.env.clearTimer(timer);
        resolve(value);
      };
      const unsubscribe = this.subscribe(() => {
        if (settled()) finish(true);
      });
      const timer = this.env.setTimer(() => finish(settled()), timeoutMs);
    });
  }

  /** The save state of one board, for the header chip and banner. Stable identity while unchanged. */
  statusFor(boardId: string | null | undefined): SaveStatus {
    if (!boardId) return IDLE_SAVE;
    const turns = this.turns.filter((turn) => turn.boardId === boardId);
    let status: SaveStatus = IDLE_SAVE;
    const failed = turns.find((turn) => turn.failure);
    if (failed?.failure) {
      status = { kind: "failed", message: saveFailureMessage(failed.failure) };
    } else if (turns.some((turn) => this.busy(turn))) {
      status = turns.some((turn) => turn.waitingOnline) ? { kind: "offline" } : { kind: "saving" };
    } else {
      const at = Math.max(0, ...turns.map((turn) => turn.lastAckAt ?? 0));
      if (at > 0) status = { kind: "saved", at };
    }
    const key = JSON.stringify(status);
    const cached = this.statusCache.get(boardId);
    if (cached && cached.key === key) return cached.status;
    this.statusCache.set(boardId, { key, status });
    return status;
  }

  /** Try a failed save again without teaching again. */
  retry(boardId: string | null | undefined): void {
    if (!boardId) return;
    for (const turn of [...this.turns]) {
      if (turn.boardId !== boardId) continue;
      if (turn.failure) {
        turn.failure = null;
        turn.attempt = 0;
        turn.conflicts = 0;
      }
      if (turn.hasRetryTimer) {
        this.env.clearTimer(turn.retryTimer);
        turn.hasRetryTimer = false;
      }
      turn.waitingOnline = false;
      this.pump(turn);
    }
    this.emit();
  }

  /**
   * The owner's live or just stopped turn on `boardId`, finished steps only,
   * clips in memory, under its checkpoint turn id (so a stored copy with the
   * same id is replaced, never doubled). Null once it completed (the finished
   * turn is in `storedTurnsRef`) or while it has no finished step.
   */
  liveTurnFor(owner: object, boardId: string | null | undefined): LiveTurnSnapshot | null {
    const turn = this.latestFor(owner, boardId);
    if (!turn || turn.status === "complete") return null;
    const rows = this.previewRows(turn, { includeCut: false });
    if (!rows.some((row) => !isEpochRow(row))) return null;
    const scene = this.sceneFor(turn);
    const kept = scene.visualStatus === "validated" ? rows : partialTurnSegments(rows, scene);
    return {
      ...this.turnHeader(turn, scene),
      segments: kept.map((row, orderIndex) => ({
        id: `${turn.turnId}:live:${orderIndex}`,
        orderIndex,
        narration: row.narration,
        spokenText: row.spokenText,
        command: row.command,
        audioUrl: null,
        durationMs: row.durationMs,
        timings: row.timings,
        audioBytes: row.audioBytes,
      })),
    };
  }

  /**
   * The board is being reopened from the server. Returns the local copies of
   * its ended turns the server does not hold in full yet (a failed or slow
   * save), so the restore keeps them over the older server copy, and sends
   * again the saves that gave up on a failure a retry can fix.
   */
  reopen(boardId: string): LiveTurnMirrorEvent[] {
    const events: LiveTurnMirrorEvent[] = [];
    for (const turn of [...this.turns]) {
      if (turn.boardId !== boardId || turn.status === "live" || turn.abandoned) continue;
      if (!this.hasUnsent(turn)) continue;
      events.push(this.localEvent(turn));
      if (turn.failure?.retryable) {
        turn.failure = null;
        turn.attempt = 0;
        turn.conflicts = 0;
        this.pump(turn);
      }
    }
    this.emit();
    return events;
  }

  /**
   * This tab is still teaching the turn `turnId`. A saved turn that reads
   * `live` but is not live here was left by a tab that died or lost its
   * keepalive close: it is stopped, whatever its age.
   */
  isLiveHere(turnId: string): boolean {
    return this.turns.some((turn) => turn.turnId === turnId && turn.status === "live");
  }

  hasLiveTurn(owner: object, boardId: string | null | undefined): boolean {
    const turn = this.latestFor(owner, boardId);
    if (!turn || turn.status === "complete") return false;
    return this.previewRows(turn, { includeCut: false }).some((row) => !isEpochRow(row));
  }

  // --- Subscriptions -----------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The owner's board and local mirror. Returns a detach function. */
  attach(owner: object, hooks: LiveTurnOwnerHooks): () => void {
    this.owners.set(owner, hooks);
    return () => {
      if (this.owners.get(owner) === hooks) this.owners.delete(owner);
    };
  }

  // --- Internals -----------------------------------------------------------------

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A listener never breaks a save.
      }
    }
  }

  private find(owner: object, generation: number): LiveTurn | null {
    for (let i = this.turns.length - 1; i >= 0; i -= 1) {
      const turn = this.turns[i]!;
      if (turn.owner === owner && turn.generation === generation) return turn;
    }
    return null;
  }

  private latestFor(owner: object, boardId: string | null | undefined): LiveTurn | null {
    if (!boardId) return null;
    for (let i = this.turns.length - 1; i >= 0; i -= 1) {
      const turn = this.turns[i]!;
      if (turn.owner === owner && turn.boardId === boardId) return turn;
    }
    return null;
  }

  /** Keep failed and busy turns; of the settled ones keep only the newest two per board. */
  private prune(boardId: string): void {
    const settled = this.turns.filter((turn) => turn.boardId === boardId && !turn.failure && !this.busy(turn) &&
      turn.status !== "live");
    for (const turn of settled.slice(0, Math.max(0, settled.length - 2))) {
      const index = this.turns.indexOf(turn);
      if (index >= 0) this.turns.splice(index, 1);
    }
  }

  private figureDrawn(turn: LiveTurn): boolean {
    return turn.page?.figureDrawn === true;
  }

  /** Move releasable rows into the submitted list (never reorders what was sent). */
  private freeze(turn: LiveTurn): void {
    if (turn.opensPage === null) return;
    if (turn.frozen.length === 0 && turn.opensPage) this.pushFrozen(turn, epochRow());
    const settling = turn.status !== "live";
    while (turn.taken < turn.recorded.length) {
      const entry = turn.recorded[turn.taken]!;
      if (entry.intro && !this.figureDrawn(turn)) {
        // Held: a sent row is final, and an intro row sent before its figure
        // commits would be stored without the figure or lost with it.
        if (!settling) break;
        turn.taken += 1;
        continue;
      }
      this.pushFrozen(turn, entry.row);
      turn.taken += 1;
    }
    if (settling && turn.cutRow && turn.cutFrozenIndex < 0 && turn.taken === turn.recorded.length) {
      turn.cutFrozenIndex = turn.frozen.length;
      this.pushFrozen(turn, turn.cutRow);
    }
  }

  private pushFrozen(turn: LiveTurn, row: RecordedSegmentPayload): void {
    turn.frozen.push({ ...row, orderIndex: turn.frozen.length });
    turn.audioAcked.push(!(row.audioBytes && row.audioBytes.length > 0));
  }

  /** The rows a save would hold now, without changing what was sent. */
  private previewRows(turn: LiveTurn, options: { includeCut: boolean }): RecordedSegmentPayload[] {
    const opensPage = turn.opensPage ?? !turn.continuesBoard;
    const rows: RecordedSegmentPayload[] = turn.opensPage === null
      ? (opensPage ? [epochRow()] : [])
      : turn.frozen.filter((_, index) => options.includeCut || index !== turn.cutFrozenIndex);
    const settling = turn.status !== "live";
    for (const entry of turn.recorded.slice(turn.taken)) {
      if (entry.intro && !this.figureDrawn(turn)) {
        if (!settling) break;
        continue;
      }
      rows.push(entry.row);
    }
    if (options.includeCut && settling && turn.cutRow && turn.cutFrozenIndex < 0) rows.push(turn.cutRow);
    return rows.map((row, orderIndex) => ({ ...row, orderIndex }));
  }

  private sceneFor(turn: LiveTurn): PersistedTurnScene {
    return liveTurnScene({
      page: turn.page,
      kind: turn.kind,
      preview: turn.preview,
      opensPage: turn.opensPage ?? !turn.continuesBoard,
      status: turn.status,
      textOnly: turn.textOnly,
    });
  }

  private turnHeader(turn: LiveTurn, scene: PersistedTurnScene): Omit<StoredTurn, "segments"> {
    return {
      id: turn.turnId,
      orderIndex: Number.MAX_SAFE_INTEGER,
      question: turn.question,
      rawResponse: turn.status === "complete" ? turn.rawResponse : liveTurnNarration(this.previewRows(turn, { includeCut: true })),
      speedMultiplier: turn.speedMultiplier,
      traceId: turn.traceId,
      sceneDocument: scene.sceneDocument,
      sceneEngineVersion: scene.sceneEngineVersion,
      validationReport: scene.validationReport,
      visualStatus: scene.visualStatus,
      sceneArtifacts: scene.sceneArtifacts,
      status: turn.status,
      kind: turn.kind,
    };
  }

  /** Earlier turns on the board exist on the server, or failed for good. */
  private queueAllows(turn: LiveTurn): boolean {
    return this.turns.every((other) =>
      other.boardId !== turn.boardId ||
      other.order >= turn.order ||
      other.ackedStatus !== null ||
      other.failure !== null ||
      other.final,
    );
  }

  /** A continuing turn opens its own page when the page it continues never reached the server. */
  private decideOpensPage(turn: LiveTurn): boolean {
    if (!turn.continuesBoard) return true;
    let previous: LiveTurn | null = null;
    for (const other of this.turns) {
      if (other.boardId === turn.boardId && other.order < turn.order && !other.abandoned) previous = other;
    }
    return previous !== null && previous.ackedStatus === null && previous.failure !== null;
  }

  private hasUnsent(turn: LiveTurn): boolean {
    if (turn.final) return false;
    if (turn.inflight) return true;
    const rows = this.previewRows(turn, { includeCut: true });
    if (this.notWorthCreating(turn, rows)) return false;
    if (rows.length > turn.ackedCount) return true;
    if (turn.status !== "live" && turn.ackedStatus !== turn.status) return true;
    return turn.audioAcked.some((acked) => !acked);
  }

  /** Work is pending or under way (sending, waiting to retry, waiting in the board queue or offline). */
  private busy(turn: LiveTurn): boolean {
    if (turn.failure || turn.final) return false;
    return this.hasUnsent(turn) || turn.hasRetryTimer || turn.waitingOnline;
  }

  /**
   * A turn with nothing taught is not created while it runs. Once it ends, a
   * lesson is kept anyway, with its question (decision 6), so the board can
   * offer it again; an empty doubt or resume is not worth a turn.
   */
  private notWorthCreating(turn: LiveTurn, rows: readonly RecordedSegmentPayload[]): boolean {
    if (turn.ackedStatus !== null || rows.some((row) => !isEpochRow(row))) return false;
    return turn.status === "live" || turn.kind !== "lesson";
  }

  /** An ended turn with nothing worth saving is dropped, so it never holds up the board. */
  private abandonIfEmpty(turn: LiveTurn): boolean {
    if (turn.status === "live" || !this.notWorthCreating(turn, this.previewRows(turn, { includeCut: true }))) return false;
    this.endCutGrace(turn);
    turn.abandoned = true;
    turn.final = true;
    this.releaseQueue(turn);
    this.emit();
    return true;
  }

  private needsSend(turn: LiveTurn): boolean {
    if (this.notWorthCreating(turn, turn.frozen)) return false;
    if (turn.frozen.length > turn.ackedCount) return true;
    if (turn.status !== "live" && turn.ackedStatus !== turn.status) return true;
    if (turn.resumeDirty) return true;
    return turn.audioAcked.some((acked, index) => !acked && index < turn.ackedCount);
  }

  /**
   * `stopped`: Stop or a board switch closed the turn, so a segment may have
   * been cut off. A turn that ended on its own has no cut row to wait for.
   */
  private closeTurn(turn: LiveTurn, options: { stopped: boolean }): void {
    if (turn.status !== "live") return;
    turn.status = "stopped";
    if (!options.stopped && this.abandonIfEmpty(turn)) return;
    if (this.notWorthCreating(turn, this.previewRows(turn, { includeCut: true }))) {
      // Nothing to save yet, but the segment Stop cut off records its row from
      // its own cleanup, after this close (the handler returns without waiting
      // for it). Keep the turn open for it; drop the turn only if no row came.
      turn.hasCutGrace = true;
      turn.cutGraceTimer = this.env.setTimer(() => {
        turn.hasCutGrace = false;
        turn.cutGraceTimer = null;
        if (this.abandonIfEmpty(turn)) return;
        this.mirrorLocal(turn);
        this.emit();
        this.pump(turn);
      }, CUT_ROW_GRACE_MS);
      return;
    }
    this.mirrorLocal(turn);
    this.emit();
    this.pump(turn);
  }

  private endCutGrace(turn: LiveTurn): void {
    if (!turn.hasCutGrace) return;
    this.env.clearTimer(turn.cutGraceTimer);
    turn.hasCutGrace = false;
    turn.cutGraceTimer = null;
  }

  private completeTurn(turn: LiveTurn, rawResponse: string): Promise<SaveTurnResult> {
    if (turn.status === "complete") {
      if (turn.completeResult) return Promise.resolve(turn.completeResult);
      return new Promise((resolve) => turn.completeWaiters.push(resolve));
    }
    turn.status = "complete";
    turn.rawResponse = rawResponse;
    const result = new Promise<SaveTurnResult>((resolve) => turn.completeWaiters.push(resolve));
    if (this.abandonIfEmpty(turn)) {
      this.settleComplete(turn, { ok: false, status: 0, error: "nothing was taught", reason: "refused", retryable: false });
      return result;
    }
    this.mirrorLocal(turn);
    this.emit();
    if (turn.failure) this.settleComplete(turn, turn.failure);
    else this.pump(turn);
    return result;
  }

  private settleComplete(turn: LiveTurn, result: SaveTurnResult): void {
    if (turn.status !== "complete") return;
    turn.completeResult = result;
    const waiters = turn.completeWaiters.splice(0);
    for (const resolve of waiters) resolve(result);
  }

  private pump(turn: LiveTurn): void {
    if (turn.inflight || turn.final || turn.failure || turn.hasRetryTimer || turn.waitingOnline) return;
    if (turn.ackedStatus === null && !this.queueAllows(turn)) return;
    if (turn.opensPage === null) turn.opensPage = this.decideOpensPage(turn);
    this.freeze(turn);
    if (!this.needsSend(turn)) return;
    this.send(turn);
  }

  private send(turn: LiveTurn): void {
    const base = turn.ackedCount;
    const seq = turn.seq + 1;
    turn.seq = seq;
    const status = turn.status;
    const rows = turn.frozen.slice(base);
    const sentCount = turn.frozen.length;
    const late: number[] = [];
    turn.frozen.slice(0, base).forEach((row, index) => {
      if (!turn.audioAcked[index] && row.audioBytes && row.audioBytes.length > 0) late.push(index);
    });
    const resumeDirty = turn.resumeDirty;
    turn.resumeDirty = false;
    const input: TurnCheckpointInput = {
      seq,
      status,
      kind: turn.kind,
      baseCount: base,
      question: turn.question,
      preview: turn.preview,
      rawResponse: status === "complete" ? turn.rawResponse : liveTurnNarration(turn.frozen),
      speedMultiplier: turn.speedMultiplier,
      traceId: turn.traceId,
      scene: this.sceneFor(turn),
      segments: rows,
      lateAudio: late.map((orderIndex) => ({ orderIndex, audioBytes: turn.frozen[orderIndex]!.audioBytes! })),
      ...(resumeDirty ? { resumeState: turn.resumeState ?? null } : {}),
    };
    const textOnly = turn.textOnly;
    // A hung connection must not hold the turn: abort it after a bounded wait
    // and take the retry path, so later rows, Stop, completion and Try again
    // can always send. A late answer from the aborted request is ignored.
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const audioBytes = [...rows.map((row) => row.audioBytes), ...(input.lateAudio ?? []).map((late) => late.audioBytes)]
      .reduce((sum, bytes) => sum + (bytes?.length ?? 0), 0);
    let timeoutTimer: unknown = null;
    const timedOut = new Promise<TurnCheckpointResult>((resolve) => {
      timeoutTimer = this.env.setTimer(() => {
        controller?.abort();
        resolve({ ok: false, status: 0, error: "the save timed out", reason: "network", retryable: true });
      }, checkpointTimeoutMs(audioBytes));
    });
    const answered = this.env.transport
      .checkpoint(turn.boardId, turn.turnId, controller ? { ...input, signal: controller.signal } : input)
      .catch((error: unknown): TurnCheckpointResult => ({
        ok: false as const,
        status: 0,
        error: error instanceof Error ? error.message : String(error),
        reason: "network" as const,
        retryable: true,
      }));
    const request = Promise.race([answered, timedOut]).then((result) => {
      this.env.clearTimer(timeoutTimer);
      return result;
    });
    turn.inflight = request.then((result) => {
      turn.inflight = null;
      if (!result.ok && resumeDirty) turn.resumeDirty = true;
      this.onResult(turn, { base, sentCount, status, late, textOnly }, result);
    });
    this.emit();
  }

  private onResult(
    turn: LiveTurn,
    sent: { base: number; sentCount: number; status: TurnStatus; late: number[]; textOnly: boolean },
    result: TurnCheckpointResult,
  ): void {
    if (result.ok) {
      turn.seq = Math.max(turn.seq, result.serverSeq);
      turn.attempt = 0;
      turn.conflicts = 0;
      turn.lastAckAt = this.env.now();
      if (!result.stale) {
        for (let index = sent.base; index < sent.sentCount; index += 1) turn.audioAcked[index] = true;
        for (const index of sent.late) turn.audioAcked[index] = true;
      }
      if (result.final) {
        turn.final = true;
        turn.ackedStatus = "complete";
        turn.ackedCount = turn.frozen.length;
        turn.audioAcked = turn.audioAcked.map(() => true);
      } else {
        const serverCount = result.serverCount ?? sent.sentCount;
        turn.ackedCount = Math.min(Math.max(serverCount, 0), turn.frozen.length);
        turn.ackedStatus = result.turn.status ?? (result.stale ? turn.ackedStatus ?? sent.status : sent.status);
      }
      const page = turn.page;
      if (page && page.boardId === turn.boardId) page.turn.saved = true;
      if (turn.final) this.settleComplete(turn, { ok: true, turn: result.turn });
      // The local mirror is replaced only by an answer that covers everything.
      if (turn.status !== "live" && sent.status === turn.status && sent.sentCount === this.previewRows(turn, { includeCut: true }).length) {
        this.mirrorServer(turn, result.turn);
      }
      this.releaseQueue(turn);
      this.emit();
      this.pump(turn);
      return;
    }

    if (result.reason === "conflict" && typeof result.serverCount === "number" && turn.conflicts < MAX_CONFLICT_RESENDS) {
      turn.conflicts += 1;
      turn.ackedCount = Math.min(Math.max(result.serverCount, 0), turn.frozen.length);
      turn.seq = Math.max(turn.seq, result.serverSeq ?? turn.seq);
      if (turn.ackedStatus === null) turn.ackedStatus = "live";
      this.emit();
      this.pump(turn);
      return;
    }
    if (result.reason === "trace_saved") {
      // This lesson is already saved as another turn: stop sending for this one.
      turn.final = true;
      this.settleComplete(turn, result.turn ? { ok: true, turn: result.turn } : result);
      this.releaseQueue(turn);
      this.emit();
      return;
    }
    if (result.reason === "refused" && result.status === 400 && !sent.textOnly && !turn.textOnly) {
      // Decision 7: a refused figure is saved once more as text only.
      turn.textOnly = true;
      this.emit();
      this.pump(turn);
      return;
    }
    if (result.retryable) {
      if (result.reason === "network" && !this.env.isOnline()) {
        turn.waitingOnline = true;
        this.emit();
        return;
      }
      const delay = SAVE_RETRY_DELAYS_MS[turn.attempt];
      if (delay !== undefined) {
        turn.attempt += 1;
        turn.hasRetryTimer = true;
        turn.retryTimer = this.env.setTimer(() => {
          turn.hasRetryTimer = false;
          turn.retryTimer = null;
          this.pump(turn);
          this.emit();
        }, delay);
        this.emit();
        return;
      }
    }
    turn.failure = result;
    this.settleComplete(turn, result);
    this.releaseQueue(turn);
    this.emit();
  }

  private onCloseResult(turn: LiveTurn, result: TurnCheckpointResult): void {
    if (!result.ok) return;
    turn.seq = Math.max(turn.seq, result.serverSeq);
    turn.lastAckAt = this.env.now();
    if (result.final) {
      turn.final = true;
      turn.ackedStatus = "complete";
      this.settleComplete(turn, { ok: true, turn: result.turn });
    } else {
      if (typeof result.serverCount === "number") {
        turn.ackedCount = Math.min(Math.max(turn.ackedCount, result.serverCount), turn.frozen.length);
      }
      turn.ackedStatus = result.turn.status ?? "stopped";
    }
    const page = turn.page;
    if (page && page.boardId === turn.boardId) page.turn.saved = true;
    this.releaseQueue(turn);
    this.emit();
    // The page lived on (bfcache): send the clips the close could not carry.
    this.pump(turn);
  }

  private releaseQueue(turn: LiveTurn): void {
    for (const other of [...this.turns]) {
      if (other !== turn && other.boardId === turn.boardId && other.order > turn.order && other.ackedStatus === null) {
        this.pump(other);
      }
    }
  }

  private localEvent(turn: LiveTurn): LiveTurnMirrorEvent {
    const scene = this.sceneFor(turn);
    const rows = this.previewRows(turn, { includeCut: true });
    return {
      source: "local",
      boardId: turn.boardId,
      turnId: turn.turnId,
      preview: turn.preview,
      turn: this.turnHeader(turn, scene),
      rows: (scene.visualStatus === "validated" ? rows : partialTurnSegments(rows, scene))
        .map((row, orderIndex) => ({ ...row, orderIndex })),
    };
  }

  private mirrorLocal(turn: LiveTurn): void {
    const hooks = this.owners.get(turn.owner);
    if (!hooks || hooks.openBoardId() !== turn.boardId) return;
    try {
      hooks.mirror(this.localEvent(turn));
    } catch {
      // The mirror is a convenience; the save goes on.
    }
  }

  private mirrorServer(turn: LiveTurn, stored: StoredTurn): void {
    const hooks = this.owners.get(turn.owner);
    if (!hooks || hooks.openBoardId() !== turn.boardId) return;
    try {
      hooks.mirror({
        source: "server",
        boardId: turn.boardId,
        turnId: turn.turnId,
        preview: turn.preview,
        turn: stored,
        rows: [...turn.frozen],
      });
    } catch {
      // As above.
    }
  }
}

function isEpochRow(row: Pick<RecordedSegmentPayload, "command" | "narration">): boolean {
  if (row.narration.trim()) return false;
  const command = row.command as { type?: unknown } | null;
  return command !== null && typeof command === "object" && command.type === "CLEAR";
}

// ---------------------------------------------------------------------------
// The tab's registry
// ---------------------------------------------------------------------------

function browserEnv(): LiveTurnSaveEnv {
  return {
    transport: { checkpoint: checkpointTurn, close: closeTurnKeepalive },
    setTimer: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimer: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
    isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
    mintId: () => crypto.randomUUID(),
  };
}

let tabRegistry: LiveTurnSaveRegistry | null = null;

/**
 * The tab's one registry. The first call also listens for the tab going
 * hidden (send now) and coming back online (resume waiting saves). The
 * `pagehide` close is sent by `useLecturePageHalt`, which registers before
 * any turn's telemetry listener so the close goes first.
 */
export function liveTurnSave(): LiveTurnSaveRegistry {
  if (tabRegistry) return tabRegistry;
  const registry = new LiveTurnSaveRegistry(browserEnv());
  tabRegistry = registry;
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") registry.flushAll();
    });
    window.addEventListener("online", () => registry.online());
  }
  return registry;
}
