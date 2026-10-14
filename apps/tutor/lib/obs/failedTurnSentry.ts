import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "../db/prisma";
import { sentryBeforeSend, sentryDataCollection, sentryServerDsn } from "./sentryPrivacy";
import { buildFailedTurnSentryEvent, type FailedTurnInput, type FailedTurnSentryEvent } from "./failedTurnTelemetry";
import { LIVE_TURN_IDLE_MS } from "../boards/turnStatus";
import { failedTurnWhere } from "../admin/turnFilters";
import { failedTurnDeliveryEnabled } from "./failedTurnRuntime";

const POLL_MS = 10_000;
const LEASE_MS = 60_000;
const RECENT_ABANDONED_MS = 60 * 60_000;
const WORKER_STARTED_AT = new Date();
/** One production process: five sends per tick bounds a bad deployment to 30/minute. */
export const FAILED_TURN_SENTRY_BATCH_LIMIT = 5;

/** Queue with the turn commit. A stopped turn can still receive a late scene/teaching checkpoint. */
export async function queueFailedTurnSentry(
  tx: Pick<Prisma.TransactionClient, "turn">,
  turn: FailedTurnInput & {
    id: string;
    sentryEventId?: string | null;
    sentryFailureEvent?: unknown;
    sentryReportedAt?: Date | null;
    updatedAt?: Date;
  },
  options: { env?: Record<string, string | undefined>; eventId?: string; now?: Date; historical?: boolean; staleLive?: boolean } = {},
): Promise<string | null> {
  if (!failedTurnDeliveryEnabled(options.env)) return null;
  const now = options.now ?? new Date();
  const event = buildFailedTurnSentryEvent(turn, options.env, { ...options, now });
  // Legacy PostgreSQL defaults retain microseconds while JS Date truncates.
  const matchingTurn = { id: turn.id, status: turn.status, visualStatus: turn.visualStatus,
    ...(turn.updatedAt ? { updatedAt: { gte: turn.updatedAt, lt: new Date(turn.updatedAt.getTime() + 1) } } : {}) };
  if (turn.sentryEventId) {
    // Already-delivered events are immutable. Pending ones can settle to more
    // complete teaching or recover a verified scene without minting another id.
    const receipt = turn.sentryFailureEvent === undefined || turn.sentryReportedAt === undefined
      ? await tx.turn.findFirst({ where: { id: turn.id, sentryEventId: turn.sentryEventId },
        select: { sentryFailureEvent: true, sentryReportedAt: true } }) : turn;
    if (receipt?.sentryReportedAt) return turn.sentryEventId;
    const previous = receipt?.sentryFailureEvent;
    if (event && previous !== null && typeof previous === "object" && "timestamp" in previous &&
      typeof previous.timestamp === "number" && Number.isFinite(previous.timestamp)) {
      event.timestamp = previous.timestamp;
    }
    await tx.turn.updateMany({
      where: { ...matchingTurn, sentryEventId: turn.sentryEventId, sentryReportedAt: null },
      data: {
        // Cancellation keeps only the timestamp for a future resume. A null
        // next attempt prevents sending and hides the cancelled admin link.
        sentryFailureEvent: event ? event as unknown as Prisma.InputJsonValue
          : previous !== null && typeof previous === "object" && "timestamp" in previous && typeof previous.timestamp === "number" && Number.isFinite(previous.timestamp)
            ? { timestamp: previous.timestamp } : Prisma.DbNull,
        sentryNextAttemptAt: event ? nextFailedTurnAttempt(turn.status, now) : null,
        updatedAt: turn.updatedAt,
      },
    });
    return turn.sentryEventId;
  }
  if (!event) return null;
  const eventId = options.eventId ?? randomUUID().replaceAll("-", "");
  if (!/^[a-f0-9]{32}$/.test(eventId)) throw new Error("invalid Sentry event id");
  const queued = await tx.turn.updateMany({
    where: { ...matchingTurn, sentryEventId: null },
    data: {
      sentryEventId: eventId,
      sentryFailureEvent: event as unknown as Prisma.InputJsonValue,
      sentryNextAttemptAt: nextFailedTurnAttempt(turn.status, now),
      // Telemetry must not extend a live/stopped turn's activity or retention clock.
      updatedAt: turn.updatedAt,
    },
  });
  return queued.count ? eventId : null;
}

function nextFailedTurnAttempt(status: string, now: Date): Date {
  // The save pipeline accepts late scene/row repair after Stop or pagehide.
  return status === "stopped" ? new Date(now.getTime() + LIVE_TURN_IDLE_MS) : now;
}

export interface PendingFailedTurnSentry {
  id: string;
  sentryEventId: string;
  sentryFailureEvent: FailedTurnSentryEvent;
  sentryNextAttemptAt: Date;
}

export interface FailedTurnSentryDelivery {
  configured: boolean;
  claim(now: Date): Promise<PendingFailedTurnSentry | null>;
  capture(event: FailedTurnSentryEvent & { event_id: string }): string;
  flush(timeoutMs: number): Promise<boolean>;
  acknowledged(eventId: string): boolean;
  complete(job: PendingFailedTurnSentry, now: Date): Promise<void>;
}

async function claimFailedTurn(now: Date): Promise<PendingFailedTurnSentry | null> {
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const settledBefore = new Date(now.getTime() - LIVE_TURN_IDLE_MS);
  const rows = await prisma.$queryRaw<PendingFailedTurnSentry[]>`
    WITH due AS (
      SELECT id FROM turns
      WHERE sentry_failure_event IS NOT NULL AND sentry_reported_at IS NULL
        AND sentry_next_attempt_at <= ${now}
        AND (status = 'complete' OR updated_at <= ${settledBefore})
        AND (visual_status IS DISTINCT FROM 'validated'
          OR scene_artifacts->'failureTelemetry'->'failed' = 'true'::jsonb
          OR (status = 'complete' AND NOT EXISTS (SELECT 1 FROM segments WHERE turn_id = turns.id)))
      ORDER BY sentry_next_attempt_at, id
      LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    UPDATE turns AS turn SET sentry_next_attempt_at = ${leaseUntil}
    FROM due WHERE turn.id = due.id
    RETURNING turn.id, turn.sentry_event_id AS "sentryEventId",
      turn.sentry_failure_event AS "sentryFailureEvent", turn.sentry_next_attempt_at AS "sentryNextAttemptAt"
  `;
  return rows[0] ?? null;
}

let reporter: { client: InstanceType<typeof Sentry.NodeClient>; acknowledgements: Set<string> } | undefined;

function failedTurnReporter(dsn: string) {
  if (reporter) return reporter;
  const acknowledgements = new Set<string>();
  const client = new Sentry.NodeClient({
    dsn,
    stackParser: Sentry.defaultStackParser,
    integrations: [],
    enableOpenTelemetrySetup: false,
    sendClientReports: false,
    dataCollection: sentryDataCollection(),
    beforeSend: sentryBeforeSend,
    transport: options => {
      const transport = Sentry.makeNodeTransport(options);
      return {
        send: async envelope => {
          const eventId = envelope[0].event_id;
          const response = await transport.send(envelope);
          if (typeof eventId === "string" && response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300) {
            acknowledgements.add(eventId);
          }
          return response;
        },
        flush: timeout => transport.flush(timeout),
      };
    },
  });
  client.init();
  reporter = { client, acknowledgements };
  return reporter;
}

function defaultDelivery(): FailedTurnSentryDelivery {
  const dsn = failedTurnDeliveryEnabled() ? sentryServerDsn() : undefined;
  const sdk = dsn ? failedTurnReporter(dsn) : undefined;
  return {
    configured: Boolean(sdk),
    claim: claimFailedTurn,
    capture: event => sdk?.client.captureEvent(event, { event_id: event.event_id }, new Sentry.Scope()) ?? "",
    flush: async timeoutMs => await sdk?.client.flush(timeoutMs) ?? false,
    acknowledged: eventId => {
      const acknowledged = sdk?.acknowledgements.has(eventId) ?? false;
      sdk?.acknowledgements.delete(eventId);
      return acknowledged;
    },
    complete: async (job, now) => {
      await prisma.$executeRaw`
        UPDATE turns SET sentry_reported_at = ${now}, sentry_failure_event = NULL, sentry_next_attempt_at = NULL
        WHERE id = ${job.id}::uuid AND sentry_event_id = ${job.sentryEventId}
          AND sentry_reported_at IS NULL AND sentry_next_attempt_at = ${job.sentryNextAttemptAt}
      `;
    },
  };
}

/** Failed sends keep their durable lease and retry with the same event id after a minute. */
export async function runFailedTurnSentryBatch(
  options: { limit?: number; now?: Date } = {},
  delivery: FailedTurnSentryDelivery = defaultDelivery(),
): Promise<{ reported: number; pending: number }> {
  const result = { reported: 0, pending: 0 };
  if (!delivery.configured) return result;
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(FAILED_TURN_SENTRY_BATCH_LIMIT, Math.trunc(options.limit ?? FAILED_TURN_SENTRY_BATCH_LIMIT)));
  for (let index = 0; index < limit; index++) {
    const job = await delivery.claim(now);
    if (!job) break;
    try {
      // The SDK's beforeSend rebuilds this allowlisted event and drops all inherited scope data.
      const eventId = delivery.capture({ ...job.sentryFailureEvent, event_id: job.sentryEventId });
      if (eventId !== job.sentryEventId || !await delivery.flush(2_000) || !delivery.acknowledged(eventId)) {
        result.pending++;
        continue;
      }
      await delivery.complete(job, now);
      result.reported++;
    } catch {
      // No exception body or turn identifier leaves this process.
      result.pending++;
    }
  }
  return result;
}

export function startFailedTurnSentryWorker(): () => void {
  if (!failedTurnDeliveryEnabled() || !sentryServerDsn()) return () => {};
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      try { await queueAbandonedFailedTurns(); } catch {
        console.error("[sentry] failed-turn recovery unavailable; events remain queued");
      }
      await runFailedTurnSentryBatch();
    } catch {
      console.error("[sentry] failed-turn delivery unavailable; events remain queued");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, POLL_MS);
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}

/** Recover a tab that disappeared without its terminal checkpoint; never rewrite its lesson status. */
export async function queueAbandonedFailedTurns(now = new Date(), options: {
  env?: Record<string, string | undefined>; startedAt?: Date;
} = {}): Promise<number> {
  if (!failedTurnDeliveryEnabled(options.env)) return 0;
  const recentAfter = new Date(Math.max((options.startedAt ?? WORKER_STARTED_AT).getTime(), now.getTime() - RECENT_ABANDONED_MS));
  const rows = await prisma.turn.findMany({
    where: {
      status: "live", sentryReportedAt: null,
      updatedAt: { gte: recentAfter, lt: new Date(now.getTime() - LIVE_TURN_IDLE_MS) },
      AND: [failedTurnWhere(), { OR: [{ sentryEventId: null }, { sentryNextAttemptAt: null }] }],
    },
    orderBy: { updatedAt: "asc" }, take: FAILED_TURN_SENTRY_BATCH_LIMIT,
    select: { id: true, status: true, visualStatus: true, sceneArtifacts: true, updatedAt: true, resumeState: true,
      sentryEventId: true, sentryFailureEvent: true, sentryReportedAt: true,
      segments: { select: { narration: true, spokenText: true, command: true } } },
  });
  let queued = 0;
  for (const row of rows) {
    const id = await prisma.$transaction(tx => queueFailedTurnSentry(tx, row, { env: options.env, now, staleLive: true }));
    if (id) queued++;
  }
  return queued;
}
