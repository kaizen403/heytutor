import * as Sentry from "@sentry/nextjs";
import {
  sentryBeforeBreadcrumb,
  sentryBeforeSend,
  sentryBeforeSendLog,
  sentryClientDsn,
  sentryDataCollection,
  sentryTracesSampler,
} from "@/lib/obs/sentryPrivacy";

// Public values must be referenced literally for Next to inline them. A copied
// production build on localhost or a lab host must not emit production events.
const deployment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
const release = process.env.NEXT_PUBLIC_SENTRY_RELEASE;
const dsn = typeof window !== "undefined" && window.location.hostname === "app.accelute.co" && deployment === "production"
  ? sentryClientDsn({ NODE_ENV: process.env.NODE_ENV, NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN })
  : undefined;

if (dsn) {
  Sentry.init({
    dsn,
    environment: deployment,
    release: /^[0-9a-f]{40}$/.test(release ?? "") ? release : undefined,
    dataCollection: sentryDataCollection(),
    tracesSampler: context => sentryTracesSampler(context, { NODE_ENV: process.env.NODE_ENV, SENTRY_ENVIRONMENT: deployment }),
    beforeSend: sentryBeforeSend,
    beforeSendLog: sentryBeforeSendLog,
    beforeBreadcrumb: sentryBeforeBreadcrumb,
    integrations: (defaults) => [
      ...defaults,
      Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
    ],
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications.",
      /^AbortError/,
    ],
    denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-extension:\/\//],
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
