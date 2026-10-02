import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { SENTRY_TUNNEL_PATH } from "./sentryTunnel";

const SENSITIVE_HEADER = /^(?:cookie|set-cookie|authorization|proxy-authorization|x-api-key)$/i;
const SENSITIVE_QUERY_KEY = /^(?:ticket|token|code|secret|password|api_key|key|auth)$/i;

type QueryValue = string | Record<string, string> | Array<[string, string]>;

export interface SentryScrubEvent {
  message?: string;
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

  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
    delete event.user.username;
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.flatMap((breadcrumb) => {
      const kept = scrubSentryBreadcrumb(breadcrumb);
      return kept ? [kept] : [];
    });
  }

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

/**
 * Server console lines are logs. Tutor debug lines carry the question, so
 * they never leave the process. Warn and error still do.
 */
export function sentryBeforeSendLog<T extends SentryLogEvent>(log: T): T | null {
  if (log.message.includes("[tutor:")) return null;
  log.message = scrubSecrets(log.message).slice(0, 2_000);
  const attributes = log.attributes;
  if (attributes) {
    for (const key of Object.keys(attributes)) {
      const value = attributes[key];
      if (typeof value !== "string") continue;
      attributes[key] = scrubSecrets(value).slice(0, 500);
    }
  }
  return log;
}

export function sentryBeforeSend(event: ErrorEvent): ErrorEvent {
  return scrubSentryEvent(event);
}

export function sentryBeforeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  return scrubSentryBreadcrumb(breadcrumb);
}
