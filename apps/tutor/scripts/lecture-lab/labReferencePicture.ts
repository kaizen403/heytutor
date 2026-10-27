/**
 * The live reference picture tier, replayed by the lab behind `--reference-picture`.
 *
 * `useQuestionHandler` asks `POST /api/reference-picture` in one of two places:
 * early, while the scene still plans, for any subject outside the chemistry
 * lane whose turn wants a figure; otherwise at the text only point (no
 * verified figure, requirement not `none`). It then waits at most
 * REFERENCE_PICTURE_TEXT_ONLY_WAIT_MS past scene planning, preloads the assets
 * before it commits, and stops paying when a verified figure wins. This is
 * that step for a lab turn: the same client, the same presentation and the
 * same outcome words, plus what the lab records (latency, wait, spend, PNG).
 *
 * The route bills its own reservation server side and returns no usage, so
 * the lab reserves a fixed ceiling per request and settles to it.
 */
import { parseReferencePicturePlan, type ReferencePictureRecord } from "@heytutor/drawing";
import type { DiagramSubject, NarrationLanguage } from "@heytutor/tutor-core";
import {
  REFERENCE_PICTURE_CLIENT_TIMEOUT_MS,
  requestReferencePicture,
  type ReferencePictureResult,
} from "../../features/tutor-session/lib/scene/referencePictureClient";
import {
  buildReferencePicturePresentation,
  type ReferencePictureOutcome,
  type ReferencePicturePresentation,
} from "../../features/tutor-session/lib/scene/referencePicturePresentation";
import { resolveImageProvider } from "../../lib/reference-picture/pictureGenerator";
import type { LabSpendMode, LabUsageObservation } from "./labSpend";

/**
 * Copies of two live constants whose modules import the browser board. The
 * lab gate reads both sources and fails when either drifts.
 */
export const LAB_REFERENCE_PICTURE_TEXT_ONLY_WAIT_MS = 25_000;
export const LAB_REFERENCE_PICTURE_PRELOAD_TIMEOUT_MS = 8_000;

/**
 * The route funds the query and three candidates, then three more if the
 * first round rejects all; each candidate is judged and fact checked, so one
 * cheap call plus twelve Ember-1 calls at the route's own ceilings (6,000 in,
 * 3,000 out: $0.063 each) is about $0.76. A generated picture adds an image, a
 * judge and a fact check. The gate recomputes this from the route.
 */
export const LAB_REFERENCE_PICTURE_BASE_RESERVATION_USD = 0.80;
export const LAB_REFERENCE_PICTURE_GENERATION_RESERVATION_USD = 0.20;
export const LAB_REFERENCE_PICTURE_ROUTE_MODEL = "server:/api/reference-picture";

export function labReferencePictureReservationUsd(env: NodeJS.ProcessEnv = process.env): number {
  return LAB_REFERENCE_PICTURE_BASE_RESERVATION_USD + (resolveImageProvider(env) ? LAB_REFERENCE_PICTURE_GENERATION_RESERVATION_USD : 0);
}

/** Recorded in the execution identity, so a resume cannot change the step. */
export function labReferencePicturePolicy(env: NodeJS.ProcessEnv = process.env) {
  return {
    version: "lab-reference-picture/v1",
    textOnlyWaitMs: LAB_REFERENCE_PICTURE_TEXT_ONLY_WAIT_MS,
    preloadTimeoutMs: LAB_REFERENCE_PICTURE_PRELOAD_TIMEOUT_MS,
    clientTimeoutMs: REFERENCE_PICTURE_CLIENT_TIMEOUT_MS,
    reservationUsd: labReferencePictureReservationUsd(env),
  } as const;
}

/** What one request cost the ledger. The route reports no usage, so it is never measured. */
export interface ReferencePictureCallAccounting {
  traceId: string | null;
  httpStatus: number | null;
  reservedUsd: number;
  chargedUsd: number;
  /** A refusal before the route reserved anything (a 4xx, or a missing key). */
  provedNoDispatch: boolean;
  unresolvedAllowanceUsd: number;
  reason: string | null;
}

export interface LabReferencePictureRecord {
  /** False when the turn never asked: a verified figure drew first, the requirement was none, a DSA turn. */
  attempted: boolean;
  speculative: boolean;
  status: ReferencePictureOutcome["status"] | "not_attempted";
  reason: string | null;
  subject: DiagramSubject | null;
  /** Request start, in ms after the turn started. */
  startedAtMs: number | null;
  /** Request start to the route's answer, or to the abort that ended it. */
  requestMs: number | null;
  /** Time the turn spent at the text only point waiting for it (preload included); 0 when it never waited. */
  waitMs: number;
  /** The live outcome's ms: request start to the turn's decision. */
  ms: number | null;
  /** The route's own answer, even when the turn did not use it (a figure won after a ready picture). */
  answer: { status: ReferencePictureResult["status"]; reason: string | null; cached: boolean | null } | null;
  pictureId: string | null;
  title: string | null;
  source: ReferencePictureRecord["source"] | null;
  license: string | null;
  artist: string | null;
  pageUrl: string | null;
  shows: string | null;
  labels: string[];
  /** A numbered picture's key (mark to name), written beside the card. */
  legend?: { mark: string; label: string }[];
  /** The route's search and judge trail, on ready and declined answers alike. */
  steps?: string[];
  /** Saved picture, relative to the round folder. */
  image: string | null;
  accounting?: ReferencePictureCallAccounting;
}

export interface LabReferencePictureImage {
  id: string;
  bytes: Uint8Array;
  contentType: string;
}

/** Live early start: every subject except the chemistry lane, whenever the turn wants a figure. */
export function startsReferencePictureEarly(input: { chemistryLane: boolean; visualRequirement: string }): boolean {
  return !input.chemistryLane && input.visualRequirement !== "none";
}

/** Live text only point: abandon for a verified figure, wait when a figure was wanted, else stop paying. */
export function referencePictureTextOnlyAction(input: {
  solverContradiction: boolean;
  figureDrawn: boolean;
  visualRequirement: string;
}): { action: "abandon"; reason: "solver_contradiction" | "verified_figure" | "not_waited" } | { action: "wait" } {
  if (input.solverContradiction) return { action: "abandon", reason: "solver_contradiction" };
  if (input.figureDrawn) return { action: "abandon", reason: "verified_figure" };
  return input.visualRequirement !== "none" ? { action: "wait" } : { action: "abandon", reason: "not_waited" };
}

function contentExtension(contentType: string): string {
  return contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
}

export function referencePictureImageFile(slug: string, contentType: string): string {
  return `pictures/${slug}.${contentExtension(contentType)}`;
}

interface PendingPicture {
  promise: Promise<ReferencePictureResult>;
  controller: AbortController;
  startedAt: number;
  speculative: boolean;
}

/**
 * One turn's picture step. `start`, `abandon` and `atTextOnlyPoint` are the
 * live hook's three moves in the same order; `finish` drains the request so
 * the row's spend is settled before it is saved.
 */
export class LabReferencePictureStep {
  private pending: PendingPicture | null = null;
  private outcome: ReferencePictureOutcome | null = null;
  private notAttemptedReason: string | null = null;
  private subject: DiagramSubject | null = null;
  private answer: LabReferencePictureRecord["answer"] = null;
  private requestMs: number | null = null;
  private waitMs = 0;
  private cached: boolean | null = null;
  private steps: string[] | null = null;
  private shown: ReferencePicturePresentation | null = null;
  private image: LabReferencePictureImage | null = null;
  private excluded = false;
  private readonly now: () => number;

  constructor(private readonly input: {
    origin: string;
    question: string;
    traceId: string;
    turnStartedAt: number;
    narrationLanguage?: NarrationLanguage;
    /** Defaults to the global fetch at call time, so the runner's budget wrapper sees every request. */
    fetchImpl?: typeof fetch;
    waitMs?: number;
    preloadTimeoutMs?: number;
    now?: () => number;
  }) {
    this.now = input.now ?? Date.now;
  }

  private fetch(url: URL | string, init?: RequestInit): Promise<Response> {
    return (this.input.fetchImpl ?? globalThis.fetch)(url, init);
  }

  get started(): boolean {
    return this.pending !== null;
  }

  /** This turn may never ask (a DSA question): later starts and waits do nothing. */
  exclude(reason: string): void {
    if (this.pending) return;
    this.excluded = true;
    this.notAttemptedReason ??= reason;
  }

  start(subject: DiagramSubject, speculative: boolean): void {
    if (this.pending || this.excluded) return;
    const controller = new AbortController();
    const startedAt = this.now();
    this.subject = subject;
    // The live client resolves a relative URL; the lab pins the request to
    // its own origin so authentication and the spend wrapper always apply.
    const routeUrl = new URL("/api/reference-picture", this.input.origin);
    const promise = requestReferencePicture({
      question: this.input.question,
      subject,
      traceId: this.input.traceId,
      signal: controller.signal,
      fetchImpl: async (_url, init) => {
        const response = await this.fetch(routeUrl, init);
        if (response.ok) {
          try {
            const body = await response.clone().json() as { cached?: unknown; steps?: unknown };
            this.cached = body.cached === true;
            if (Array.isArray(body.steps)) this.steps = body.steps.filter((step): step is string => typeof step === "string").slice(0, 40);
          } catch { /* the client reports a malformed body itself */ }
        }
        return response;
      },
    }).then((result) => {
      this.requestMs = this.now() - startedAt;
      this.answer = { status: result.status, reason: result.status === "ready" ? null : result.reason, cached: this.cached };
      return result;
    });
    this.pending = { promise, controller, startedAt, speculative };
  }

  abandon(reason: string): void {
    const pending = this.pending;
    if (!pending) {
      this.notAttemptedReason ??= reason;
      return;
    }
    if (this.outcome) return;
    pending.controller.abort();
    this.outcome = { attempted: true, status: "skipped", reason, ms: this.now() - pending.startedAt, speculative: pending.speculative };
  }

  /** The image and stroke plan, fetched as the board would before it commits; the image is kept for the round. */
  private async preload(record: ReferencePictureRecord, timeoutMs: number): Promise<boolean> {
    const signal = AbortSignal.timeout(Math.max(0, timeoutMs));
    try {
      const [imageResponse, planResponse] = await Promise.all([
        this.fetch(new URL(record.imageUrl, this.input.origin), { signal }),
        this.fetch(new URL(record.planUrl, this.input.origin), { signal }),
      ]);
      const contentType = imageResponse.headers.get("content-type") ?? "";
      if (!imageResponse.ok || !planResponse.ok || !/^image\/(png|jpeg|webp)$/.test(contentType)) return false;
      const [bytes, plan] = await Promise.all([imageResponse.arrayBuffer(), planResponse.json()]);
      if (bytes.byteLength === 0 || !parseReferencePicturePlan(plan)) return false;
      this.image = { id: record.id, bytes: new Uint8Array(bytes), contentType };
      return true;
    } catch {
      return false;
    }
  }

  /** The live wait, preload and commitment, in that order. Returns the presentation when a picture is shown. */
  async atTextOnlyPoint(subject: DiagramSubject): Promise<ReferencePicturePresentation | null> {
    if (this.outcome || this.excluded) return null;
    const waitMs = this.input.waitMs ?? LAB_REFERENCE_PICTURE_TEXT_ONLY_WAIT_MS;
    const waitStartedAt = this.now();
    if (!this.pending) this.start(subject, false);
    const pending = this.pending!;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const answer = await Promise.race([
      pending.promise,
      new Promise<ReferencePictureResult>((resolve) => {
        deadline = setTimeout(() => resolve({ status: "unavailable", reason: "wait_deadline" }), waitMs);
      }),
    ]).finally(() => clearTimeout(deadline));
    let picture: ReferencePicturePresentation | null = null;
    let failure: { status: "declined" | "unavailable"; reason: string } | null =
      answer.status === "ready" ? null : { status: answer.status, reason: answer.reason };
    if (answer.status === "ready") {
      const left = Math.max(1_000, waitMs - (this.now() - waitStartedAt));
      const loaded = await this.preload(answer.picture, Math.min(left, this.input.preloadTimeoutMs ?? LAB_REFERENCE_PICTURE_PRELOAD_TIMEOUT_MS));
      if (!loaded) failure = { status: "unavailable", reason: "preload_failed" };
      else {
        try {
          picture = buildReferencePicturePresentation(answer.picture, { narrationLanguage: this.input.narrationLanguage });
        } catch {
          failure = { status: "unavailable", reason: "presentation_failed" };
        }
      }
    } else {
      pending.controller.abort();
    }
    this.waitMs = this.now() - waitStartedAt;
    this.outcome = {
      attempted: true,
      status: picture ? "shown" : failure!.status,
      reason: picture ? null : failure!.reason,
      ms: this.now() - pending.startedAt,
      speculative: pending.speculative,
    };
    if (!picture) this.image = null;
    this.shown = picture;
    return picture;
  }

  /** Drain the request (an abandoned one ends at its abort) and describe the step for the run record. */
  async finish(reasonIfOpen = "turn_ended"): Promise<{ record: LabReferencePictureRecord; image: LabReferencePictureImage | null }> {
    if (this.pending && !this.outcome) this.abandon(reasonIfOpen);
    const settled = this.pending ? await this.pending.promise : null;
    const picture = this.shown?.stored ?? null;
    const ready = settled?.status === "ready" ? settled.picture : null;
    const described = picture ?? ready;
    const record: LabReferencePictureRecord = {
      attempted: this.pending !== null,
      speculative: this.pending?.speculative ?? false,
      status: this.outcome?.status ?? "not_attempted",
      reason: this.outcome ? this.outcome.reason : this.notAttemptedReason,
      subject: this.subject,
      startedAtMs: this.pending ? this.pending.startedAt - this.input.turnStartedAt : null,
      requestMs: this.requestMs,
      waitMs: this.waitMs,
      ms: this.outcome?.ms ?? null,
      answer: this.answer,
      pictureId: described?.id ?? null,
      title: described?.title ?? null,
      source: described?.source ?? null,
      license: described?.license ?? null,
      artist: described?.artist ?? null,
      pageUrl: described?.pageUrl ?? null,
      shows: described?.shows ?? null,
      labels: described ? [...described.labels] : [],
      ...(described?.legend?.length ? { legend: described.legend.map(({ mark, label }) => ({ mark, label })) } : {}),
      ...(this.steps ? { steps: [...this.steps] } : {}),
      image: null,
    };
    return { record, image: picture ? this.image : null };
  }
}

export interface ReferencePictureBudgetHooks {
  reserve: (usd: number) => boolean | Promise<boolean>;
  spendMode: LabSpendMode;
  beforeDispatch: () => void;
  settle: (reservedUsd: number, chargedUsd: number, observation: LabUsageObservation) => void;
  onAccounting: (record: ReferencePictureCallAccounting) => void;
  onDenied: () => void;
  reservationUsd?: number;
  traceId?: string | null;
}

/**
 * Reserve before dispatch, settle to the ceiling. Unknown usage (a ready or
 * declined answer, a 5xx, a transport failure or an abort after dispatch)
 * consumes the reservation in conservative mode and stays an unresolved
 * allowance in response_usage mode. Only a refusal the route makes before
 * reserving (any 4xx, a missing key) is a proved zero.
 */
export async function budgetedReferencePictureFetch(input: RequestInfo | URL, init: RequestInit | undefined,
  fetchImpl: typeof fetch, hooks: ReferencePictureBudgetHooks): Promise<Response> {
  const reservedUsd = hooks.reservationUsd ?? labReferencePictureReservationUsd();
  let admitted: boolean;
  try {
    const admission = hooks.reserve(reservedUsd);
    admitted = typeof admission === "boolean" ? admission : await admission;
  } catch (error) {
    hooks.onDenied();
    throw error;
  }
  if (!admitted) {
    hooks.onDenied();
    throw new Error("reference picture denied before sending: --max-usd reservation exhausted");
  }
  let settled = false;
  const account = (httpStatus: number | null, provedNoDispatch: boolean, reason: string | null) => {
    settled = true;
    const chargedUsd = provedNoDispatch || hooks.spendMode === "response_usage" ? 0 : reservedUsd;
    const unresolvedAllowanceUsd = provedNoDispatch ? 0 : reservedUsd;
    hooks.settle(reservedUsd, chargedUsd, {
      model: LAB_REFERENCE_PICTURE_ROUTE_MODEL, measuredUsd: provedNoDispatch ? 0 : null,
      unresolvedAttempts: provedNoDispatch ? 0 : 1, unresolvedAllowanceUsd,
      reason: provedNoDispatch ? null : reason ?? "reference_picture_usage_unreported",
    });
    hooks.onAccounting({ traceId: hooks.traceId ?? null, httpStatus, reservedUsd, chargedUsd, provedNoDispatch, unresolvedAllowanceUsd, reason });
  };
  try {
    hooks.beforeDispatch();
    const response = await fetchImpl(input, init);
    let reason: string | null = null;
    if (response.ok) {
      try {
        const body = await response.clone().json() as { status?: unknown; reason?: unknown };
        reason = body.status === "declined" && typeof body.reason === "string" ? body.reason : null;
      } catch { /* unknown body: unknown usage */ }
    }
    const provedNoDispatch = (response.status >= 400 && response.status < 500) || reason === "missing_key";
    account(response.status, provedNoDispatch, response.ok ? reason : `http_${response.status}`);
    return response;
  } catch (error) {
    if (!settled) account(null, false, "reference_picture_transport_failed_or_aborted");
    throw error;
  }
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)]!;
}

/** Round totals for summary.json; null when no row ran the step, so default summaries keep their shape. */
export function summarizeReferencePictures(runs: readonly { referencePicture?: LabReferencePictureRecord; diagram: { committed: boolean } }[]) {
  const records = runs.flatMap((run) => run.referencePicture ? [{ record: run.referencePicture, committed: run.diagram.committed }] : []);
  if (records.length === 0) return null;
  const statusCounts: Record<string, number> = {};
  const reasonCounts: Record<string, number> = {};
  for (const { record } of records) {
    statusCounts[record.status] = (statusCounts[record.status] ?? 0) + 1;
    if (record.reason) reasonCounts[record.reason] = (reasonCounts[record.reason] ?? 0) + 1;
  }
  const attempted = records.filter(({ record }) => record.attempted);
  // Only these three come from the text only wait: no verified figure, a figure wanted.
  const waited = records.filter(({ record }) => record.status === "shown" || record.status === "declined" || record.status === "unavailable");
  const requestMs = attempted.flatMap(({ record }) => record.requestMs === null ? [] : [record.requestMs]);
  const waitMs = waited.map(({ record }) => record.waitMs);
  return {
    rows: records.length,
    verifiedFigures: records.filter(({ committed }) => committed).length,
    attempted: attempted.length,
    speculative: attempted.filter(({ record }) => record.speculative).length,
    shown: records.filter(({ record }) => record.status === "shown").length,
    statusCounts,
    reasonCounts,
    /** Rows with no verified figure that waited at the text only point. */
    engineFailures: waited.length,
    shownOnEngineFailures: waited.filter(({ record }) => record.status === "shown").length,
    requestMs: { median: percentile(requestMs, 0.5), p90: percentile(requestMs, 0.9), max: percentile(requestMs, 1) },
    waitMs: { median: percentile(waitMs, 0.5), p90: percentile(waitMs, 0.9), max: percentile(waitMs, 1) },
    chargedUsd: Math.round(records.reduce((sum, { record }) => sum + (record.accounting?.chargedUsd ?? 0), 0) * 1_000_000) / 1_000_000,
  };
}
