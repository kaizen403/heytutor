export type WorkerName = "failed_turn_recovery" | "failed_turn_delivery" | "object_cleanup";
export type WorkerErrorCode = "database_unavailable" | "database_auth" | "database_schema"
  | "database_timeout" | "database_conflict" | "object_store_unavailable" | "delivery_unacknowledged" | "unknown";

const MESSAGES: Record<WorkerName, string> = {
  failed_turn_recovery: "[sentry] failed-turn recovery unavailable; events remain queued",
  failed_turn_delivery: "[sentry] failed-turn delivery unavailable; events remain queued",
  object_cleanup: "[objects] cleanup worker failed; durable jobs remain queued",
};
const CODES: Record<string, WorkerErrorCode> = {
  P1001: "database_unavailable", P1017: "database_unavailable", ECONNREFUSED: "database_unavailable", ECONNRESET: "database_unavailable",
  P1000: "database_auth", P1010: "database_auth",
  P2021: "database_schema", P2022: "database_schema",
  P1002: "database_timeout", P1008: "database_timeout", P2024: "database_timeout", ETIMEDOUT: "database_timeout",
  P2034: "database_conflict", NoSuchBucket: "object_store_unavailable",
};
/** Read only fixed SDK codes: exception prose, endpoints, SQL and identities stay local. */
export function workerErrorCode(error: unknown): WorkerErrorCode {
  for (let depth = 0; depth < 4 && error !== null && typeof error === "object"; depth++) {
    const fields = error as Record<string, unknown>;
    for (const key of ["code", "errorCode", "name"]) {
      const value = fields[key];
      if (typeof value === "string" && Object.hasOwn(CODES, value)) return CODES[value]!;
    }
    error = fields.cause;
  }
  return "unknown";
}

const COOLDOWN_MS = 5 * 60_000;
const recent = new Map<string, { at: number; suppressed: number }>();

/** Bound outage log volume without changing work, durable leases or retry schedules. */
export function logWorkerFailure(worker: WorkerName, error: unknown, code = workerErrorCode(error)): void {
  const key = `${worker}:${code}`;
  const now = Date.now();
  const prior = recent.get(key);
  if (prior && now >= prior.at && now - prior.at < COOLDOWN_MS) {
    prior.suppressed = Math.min(1_000_000, prior.suppressed + 1);
    return;
  }
  console.error(MESSAGES[worker], { worker, error_code: code, suppressed: prior?.suppressed ?? 0 });
  recent.set(key, { at: now, suppressed: 0 });
}
