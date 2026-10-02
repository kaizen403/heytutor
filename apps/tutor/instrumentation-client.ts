import * as Sentry from "@sentry/nextjs";
import {
  sentryBeforeBreadcrumb,
  sentryBeforeSend,
  sentryBeforeSendLog,
  sentryClientDsn,
  sentryDataCollection,
  sentryTracesSampler,
} from "@/lib/obs/sentryPrivacy";

const dsn = sentryClientDsn();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    dataCollection: sentryDataCollection(),
    tracesSampler: sentryTracesSampler,
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
