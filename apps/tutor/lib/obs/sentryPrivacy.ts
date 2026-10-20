import type { Breadcrumb, ErrorEvent, NodeClient, consoleLoggingIntegration } from "@sentry/nextjs";
import { FAILED_TURN_BILLING_CODES, FAILED_TURN_CODES, FAILED_TURN_DEPLOYMENTS, FAILED_TURN_ISSUE_CODES, FAILED_TURN_REPORTING_ORIGINS, FAILED_TURN_STAGES } from "./failedTurnTelemetry";
import { SENTRY_TUNNEL_PATH } from "./sentryTunnel";

type LogEnvelope = Parameters<NodeClient["sendEnvelope"]>[0];
type LogPrivacyIntegration = Omit<ReturnType<typeof consoleLoggingIntegration>, "name"> & { name: string };

const SENSITIVE_HEADER = /^(?:cookie|set-cookie|authorization|proxy-authorization|x-api-key)$/i;
const SENSITIVE_QUERY_KEY = /^(?:ticket|token|code|secret|password|api_key|key|auth)$/i;

type QueryValue = string | Record<string, string> | Array<[string, string]>;

export interface SentryScrubEvent {
  message?: string;
  level?: unknown;
  platform?: string;
  event_id?: string;
  timestamp?: number;
  tags?: Record<string, unknown>;
  fingerprint?: string[];
  extra?: Record<string, unknown>;
  contexts?: unknown;
  release?: string;
  environment?: string;
  request?: {
    url?: string;
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, string>;
    query_string?: QueryValue;
  };
  user?: {
    id?: string | number;
    email?: string;
    ip_address?: string | null;
    username?: string;
  };
  exception?: {
    values?: Array<{ value?: string }>;
  };
  breadcrumbs?: Array<{ category?: string; message?: string; data?: Record<string, unknown> }>;
}

export function isSentryDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.SENTRY_ENABLED;
  return flag === "0" || flag === "false";
}

/** Server and the custom speech process. Falls back to the public DSN. */
export function sentryServerDsn(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (isSentryDisabled(env)) return undefined;
  const value = (env.SENTRY_DSN || env.NEXT_PUBLIC_SENTRY_DSN || "").trim();
  return value || undefined;
}

/** Browser bundle. Only the public DSN is available there, and it is fixed at build time. */
export function sentryClientDsn(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (isSentryDisabled(env)) return undefined;
  const value = (env.NEXT_PUBLIC_SENTRY_DSN || "").trim();
  return value || undefined;
}

/**
 * v11 collects request bodies, cookies, query strings, database parameters, and
 * model inputs unless each category is turned off. Lessons must not leave the process.
 */
export function sentryDataCollection() {
  return {
    userInfo: false,
    cookies: false as const,
    httpHeaders: {
      request: {
        deny: ["cookie", "set-cookie", "authorization", "proxy-authorization", "x-api-key"],
      },
      response: { deny: ["set-cookie"] },
    },
    httpBodies: [] as Array<
      "incomingRequest" | "outgoingRequest" | "incomingResponse" | "outgoingResponse"
    >,
    urlQueryParams: false as const,
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    graphQL: { document: false, variables: false },
    queues: false,
    stackFrameVariables: false as const,
  };
}

/** Production traces are a sample. Health checks and the tunnel are never traces. */
export function sentryTracesSampler(
  context: { name?: string },
  env: NodeJS.ProcessEnv = process.env,
): number {
  const name = context.name ?? "";
  if (name.includes("/api/health") || name.includes(SENTRY_TUNNEL_PATH)) return 0;
  if (env.NODE_ENV !== "production") return 0;
  return 0.1;
}

export function scrubSecrets(text: string): string {
  return text
    .replace(/((?:api[_-]?key|token|secret|password|ticket|code)=)[^&\s#]+/gi, "$1[redacted]")
    .replace(/\b(?:am_sk|whsec|sk)_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

export function redactUrl(url: string): string {
  const hash = url.indexOf("#");
  const withoutHash = hash === -1 ? url : url.slice(0, hash);
  const queryAt = withoutHash.indexOf("?");
  if (queryAt === -1) return scrubSecrets(withoutHash);
  const path = withoutHash.slice(0, queryAt);
  const kept = withoutHash
    .slice(queryAt + 1)
    .split("&")
    .filter((part) => {
      const key = decodeURIComponent(part.split("=")[0] ?? "");
      return !SENSITIVE_QUERY_KEY.test(key);
    });
  const next = kept.length > 0 ? `${path}?${kept.join("&")}` : path;
  return scrubSecrets(next);
}

function redactQuery(value: QueryValue): QueryValue | undefined {
  if (typeof value === "string") {
    const kept = value
      .split("&")
      .filter((part) => {
        const key = decodeURIComponent(part.split("=")[0] ?? "");
        return !SENSITIVE_QUERY_KEY.test(key);
      });
    return kept.length > 0 ? kept.join("&") : undefined;
  }
  if (Array.isArray(value)) {
    const kept = value.filter(([key]) => !SENSITIVE_QUERY_KEY.test(key));
    return kept.length > 0 ? kept : undefined;
  }
  const next: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!SENSITIVE_QUERY_KEY.test(key)) next[key] = item;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function scrubSentryEvent<T extends SentryScrubEvent>(event: T): T {
  if (event.tags?.area === "turn-failure") return scrubFailedTurnEvent(event);
  if (event.message) event.message = scrubSecrets(event.message);
  for (const item of event.exception?.values ?? []) {
    if (item.value) item.value = scrubSecrets(item.value);
  }

  const request = event.request;
  if (request) {
    delete request.data;
    delete request.cookies;
    if (request.headers) {
      for (const key of Object.keys(request.headers)) {
        if (SENSITIVE_HEADER.test(key)) {
          delete request.headers[key];
          continue;
        }
        const value = request.headers[key];
        if (value) request.headers[key] = scrubSecrets(value);
      }
    }
    if (request.query_string != null) {
      const redacted = redactQuery(request.query_string);
      if (redacted == null) delete request.query_string;
      else request.query_string = redacted;
    }
    if (request.url) request.url = redactUrl(request.url);
  }

  // Persistent user ids are personal data too; reporting never needs identity.
  delete event.user;

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.flatMap((breadcrumb) => {
      const kept = scrubSentryBreadcrumb(breadcrumb);
      return kept ? [kept] : [];
    });
  }

  return event;
}

const FAILURE_SUBJECTS = ["physics", "chemistry", "maths", "biology", "dsa", "other", "unknown"];
const FAILURE_PROVIDERS = ["azure", "fireworks", "mock", "unknown"];
const FAILURE_ENVIRONMENTS = ["production", "development", "test", "lab", "unknown"];

function allowedValue(value: unknown, allowed: readonly string[]): string {
  return typeof value === "string" && allowed.includes(value) ? value : "unknown";
}

/** Failed-turn events carry counts and vocabulary, even when captured in a dirty request scope. */
function scrubFailedTurnEvent<T extends SentryScrubEvent>(event: T): T {
  const supplied = event.tags ?? {};
  const strictSubjects = typeof supplied.strict_subjects === "string"
    ? supplied.strict_subjects.split(",") : [];
  const release = typeof supplied.release === "string" && /^[a-f0-9]{7,64}$/i.test(supplied.release)
    ? supplied.release : "unknown";
  const tags = {
    area: "turn-failure",
    reporting_origin: allowedValue(supplied.reporting_origin, FAILED_TURN_REPORTING_ORIGINS),
    subject: allowedValue(supplied.subject, FAILURE_SUBJECTS),
    stage: allowedValue(supplied.stage, FAILED_TURN_STAGES),
    code: allowedValue(supplied.code, FAILED_TURN_CODES),
    billing_code: allowedValue(supplied.billing_code, ["none", ...FAILED_TURN_BILLING_CODES]),
    figure_need: allowedValue(supplied.figure_need, ["required", "optional", "none", "unknown"]),
    strict_subjects: supplied.strict_subjects === "none" ? "none"
      : strictSubjects.length > 0 && strictSubjects.length <= FAILURE_SUBJECTS.length &&
        strictSubjects.every((subject) => FAILURE_SUBJECTS.includes(subject))
        ? Array.from(new Set(strictSubjects)).join(",") : "unknown",
    provider: allowedValue(supplied.provider, FAILURE_PROVIDERS),
    deployment: allowedValue(supplied.deployment, FAILED_TURN_DEPLOYMENTS),
    release,
    environment: allowedValue(supplied.environment, FAILURE_ENVIRONMENTS),
  };
  const extra: Record<string, unknown> = {};
  for (const key of ["candidate_count", "validation_issue_count", "segment_count", "unknown_issue_count", "request_count"]) {
    const value = event.extra?.[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000) extra[key] = value;
  }
  if (Array.isArray(event.extra?.issue_codes)) {
    extra.issue_codes = Array.from(new Set(event.extra.issue_codes.slice(0, 32).map((code) =>
      typeof code === "string" && (FAILED_TURN_ISSUE_CODES as readonly string[]).includes(code)
        ? code : "unknown_issue")));
  }

  // SDK scopes can add arbitrary identity, path, breadcrumb and model context.
  // Allowlist the complete event rather than guessing every sensitive field name.
  const kept = new Set(["event_id", "timestamp", "platform", "level", "message", "tags", "fingerprint", "extra", "release", "environment"]);
  for (const key of Object.keys(event)) {
    if (!kept.has(key)) Reflect.deleteProperty(event, key);
  }
  event.message = "Tutor turn failed";
  event.level = event.level === "error" ? "error" : "warning";
  event.platform = "node";
  if (event.event_id !== undefined && !/^[a-f0-9]{32}$/i.test(event.event_id)) delete event.event_id;
  if (event.timestamp !== undefined && !Number.isFinite(event.timestamp)) delete event.timestamp;
  event.tags = tags;
  event.fingerprint = ["turn-failure", tags.stage, tags.code, tags.subject];
  event.extra = extra;
  event.release = release;
  event.environment = tags.environment;
  return event;
}

export function scrubSentryBreadcrumb<
  T extends { category?: string; message?: string; data?: Record<string, unknown> },
>(breadcrumb: T): T | null {
  if (breadcrumb.category === "console") return null;
  if (typeof breadcrumb.message === "string") {
    breadcrumb.message = scrubSecrets(breadcrumb.message);
  }
  const data = breadcrumb.data;
  if (data) {
    delete data["url.query"];
    delete data.request_body;
    delete data.response_body;
    if (typeof data.url === "string") data.url = redactUrl(data.url);
  }
  return breadcrumb;
}

export interface SentryLogEvent {
  message: string;
  attributes?: Record<string, unknown>;
}

const SAVE_LOG_CODES = new Set([
  "audio_format_mismatch", "audio_segment_missing", "board_not_found",
  "checkpoint_rows_conflict", "close_body_invalid", "idempotency_key_invalid",
  "metadata_json_invalid", "metadata_missing", "multipart_invalid",
  "save_allowance_required", "save_allowance_used", "scene_admission_failed",
  "scene_artifacts_missing", "scene_artifacts_schema_invalid", "scene_code_lesson_invalid",
  "scene_compile_failed", "scene_document_invalid", "scene_document_tier_mismatch",
  "scene_metric_geometry_outside_exact", "scene_non_metric_mismatch", "scene_persistence_rejected",
  "scene_point_line_annotation_invalid", "scene_point_line_quantity_invalid", "scene_point_line_solver_binding_required",
  "scene_point_line_solver_evidence_invalid", "scene_point_line_solver_quantity_mismatch", "scene_problem_ir_invalid",
  "scene_proof_failed", "scene_question_required", "scene_representation_not_scene",
  "scene_representation_tier_invalid", "scene_result_not_ready", "scene_resume_authority_mismatch",
  "scene_segment_order_invalid", "scene_segments_invalid", "scene_solver_artifacts_incomplete",
  "scene_solver_plan_contradiction", "scene_solver_recomputation_failed", "scene_solver_result_invalid",
  "scene_solver_values_mismatch", "scene_source_question_mismatch", "scene_teaching_command_not_allowed",
  "scene_teaching_envelope_invalid", "scene_teaching_type_plan_required", "scene_turn_plan_invalid",
  "scene_unvalidated_trusted_geometry", "scene_validation_report_invalid", "segment_fields_invalid",
  "storage_accounting_changed", "storage_admission_rejected", "storage_commit_rejected",
  "storage_verification_failed", "trace_mismatch", "trace_saved",
  "turn_audio_oversized", "turn_fields_invalid", "turn_id_invalid",
  "turn_metadata_oversized", "turn_not_found", "turn_not_persistable",
  "turn_segments_oversized", "turn_storage_limit_reached", "unauthorized",
  "upload_headers_invalid", "upload_parts_invalid",
]);
const WORKER_ERROR_CODES = new Set(["database_unavailable", "database_auth", "database_schema", "database_timeout", "database_conflict", "object_store_unavailable", "delivery_unacknowledged", "unknown"]);
const WORKER_MESSAGES: Record<string, string> = {
  "[sentry] failed-turn recovery unavailable; events remain queued": "failed_turn_recovery",
  "[sentry] failed-turn delivery unavailable; events remain queued": "failed_turn_delivery",
  "[objects] cleanup worker failed; durable jobs remain queued": "object_cleanup",
};
const LOG_LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal"]);
const OPERATIONAL_LOGS = [
  "[sentry] failed-turn recovery unavailable; events remain queued",
  "[sentry] failed-turn delivery unavailable; events remain queued",
  "[objects] cleanup worker failed; durable jobs remain queued",
  "[billing] cache update failed", "[billing] paid reservation failed",
  "[billing] payment operation failed", "[billing] period spend failed",
  "[billing] llm_tokens track failed", "[billing] tts_chars track failed",
  "[billing] notes_messages track failed", "[billing] planner reconciliation failed",
  "[billing] teaching reconciliation failed", "[notes] storage settlement failed",
  "[home-suggestions] generation failed", "[boards] DELETE failed:",
  "[admin] coverage_query_failed", "[admin] user detail query failed",
  "[admin] turns query failed", "[admin] overview query failed", "[admin] users query failed",
  "[langfuse] trace-cost query failed", "[langfuse] window-cost query failed", "[langfuse] run-cost query failed",
];
const STATIC_HTTP_ROUTES = new Set([
  "/api/chat", "/api/tts", "/api/tts/stream", "/api/tts/ws-ticket", "/api/tts/ws", "/api/boards",
  ...["begin-turn", "catalog", "checkout", "entitlement", "portal", "top-up", "webhook",
    "razorpay/history", "razorpay/status", "razorpay/verify", "razorpay/webhook"].map(route => `/api/billing/${route}`),
]);
function logObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function normalizedLogRoute(value: string): string | undefined {
  const path = value.split(/[?#]/, 1)[0]!;
  if (STATIC_HTTP_ROUTES.has(path)) return path;
  if (/^\/api\/boards\/[^/]+$/.test(path)) return "/api/boards/:boardId";
  if (/^\/api\/boards\/[^/]+\/notes-chat$/.test(path)) return "/api/boards/:boardId/notes-chat";
  if (/^\/api\/boards\/[^/]+\/turns$/.test(path)) return "/api/boards/:boardId/turns";
  if (/^\/api\/boards\/[^/]+\/turns\/[^/]+$/.test(path)) return "/api/boards/:boardId/turns/:turnId";
  return undefined;
}
function approvedLog(message: string, attributes: Record<string, unknown>) {
  const worker = OPERATIONAL_LOGS.find(known => message === known || message.startsWith(`${known} `));
  if (worker) {
    const kind = WORKER_MESSAGES[worker];
    if (!kind) return { message: worker, attributes: {} };
    const fields = { ...attributes, ...logObject(attributes["sentry.message.parameter.0"]) };
    return { message: worker, attributes: { worker: kind,
      error_code: typeof fields.error_code === "string" && WORKER_ERROR_CODES.has(fields.error_code) ? fields.error_code : "unknown",
      suppressed: typeof fields.suppressed === "number" && Number.isInteger(fields.suppressed) && fields.suppressed >= 0 && fields.suppressed <= 1000000 ? fields.suppressed : 0,
    } };
  }
  if (message === "[turn-save-rejected]" || message.startsWith("[turn-save-rejected] ")) {
    const fields = { ...attributes, ...logObject(attributes["sentry.message.parameter.0"]) };
    return { message: "[turn-save-rejected]", attributes: {
      event: "turn_save_rejected",
      code: typeof fields.code === "string" && SAVE_LOG_CODES.has(fields.code) ? fields.code : "unknown",
      status: typeof fields.status === "number" && Number.isInteger(fields.status) && fields.status >= 100 && fields.status <= 599 ? fields.status : "unknown",
      entryPoint: typeof fields.entryPoint === "string" && ["legacy_post", "checkpoint_put", "checkpoint_close"].includes(fields.entryPoint) ? fields.entryPoint : "unknown",
    } };
  }
  const http = /^\[http\] (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\/\S{1,2048}) ([1-5]\d{2}) (\d{1,10})ms(?: .*|$)/.exec(message);
  const route = http && normalizedLogRoute(http[2]!);
  if (!http || !route) return null;
  const status = Number(http[3]), duration = Math.min(Number(http[4]), 86400000);
  return { message: `[http] ${http[1]} ${route} ${status} ${duration}ms`, attributes: {
    "http.method": http[1]!, "http.route": route, "http.status_code": status, duration_ms: duration,
  } };
}

/** Rebuild known operational logs; arbitrary console prose/objects never leave the process. */
export function sentryBeforeSendLog<T extends SentryLogEvent>(log: T): T | null {
  if (typeof log.message !== "string") return null;
  const approved = approvedLog(log.message, logObject(log.attributes));
  if (!approved) return null;
  const input = log as T & { level?: unknown; severityNumber?: unknown };
  return {
    ...approved,
    ...(typeof input.level === "string" && LOG_LEVELS.has(input.level) ? { level: input.level } : {}),
    ...(typeof input.severityNumber === "number" && Number.isInteger(input.severityNumber) && input.severityNumber >= 1 && input.severityNumber <= 24 ? { severityNumber: input.severityNumber } : {}),
  } as T;
}

/** SDK scope attributes are merged after beforeSendLog; reapply at the wire boundary. */
export function scrubSentryLogEnvelope(envelope: LogEnvelope): void {
  const items = envelope[1] as Array<[{ type: string; [key: string]: unknown }, unknown]>;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item[0].type !== "log") continue;
    const payload = logObject(item[1]);
    const logs = Array.isArray(payload.items) ? payload.items : [];
    const clean = logs.flatMap(raw => {
      const log = logObject(raw);
      if (typeof log.body !== "string" || typeof log.level !== "string" || !LOG_LEVELS.has(log.level)
        || typeof log.timestamp !== "number" || !Number.isFinite(log.timestamp) || log.timestamp < 0) return [];
      const attributes = Object.fromEntries(Object.entries(logObject(log.attributes)).map(([key, value]) => [key, logObject(value).value]));
      const approved = approvedLog(log.body, attributes);
      if (!approved) return [];
      return [{ timestamp: log.timestamp, level: log.level, body: approved.message,
        ...(typeof log.trace_id === "string" && /^[a-f0-9]{32}$/.test(log.trace_id) ? { trace_id: log.trace_id } : {}),
        ...(typeof log.severity_number === "number" && Number.isInteger(log.severity_number) && log.severity_number >= 1 && log.severity_number <= 24 ? { severity_number: log.severity_number } : {}),
        attributes: Object.fromEntries(Object.entries(approved.attributes).map(([key, value]) => [key, { type: typeof value === "number" ? "integer" : "string", value }])),
      }];
    });
    if (!clean.length) { items.splice(i, 1); continue; }
    item[0] = { type: "log", item_count: clean.length, content_type: "application/vnd.sentry.items.log+json" };
    item[1] = { version: 2, ingest_settings: { infer_ip: "never", infer_user_agent: "never" }, items: clean };
  }
}
export function sentryLogPrivacyIntegration(): LogPrivacyIntegration {
  return { name: "TutorLogPrivacy", setup(client) { client.on("beforeEnvelope", scrubSentryLogEnvelope); } };
}

export function sentryBeforeSend(event: ErrorEvent): ErrorEvent {
  return scrubSentryEvent(event);
}

export function sentryBeforeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  return scrubSentryBreadcrumb(breadcrumb);
}
