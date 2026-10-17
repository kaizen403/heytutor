import * as Sentry from "@sentry/nextjs";
import {
  sentryBeforeBreadcrumb,
  sentryBeforeSend,
  sentryBeforeSendLog,
  sentryDataCollection,
  sentryServerDsn,
  sentryRelease,
  sentryTracesSampler,
} from "@/lib/obs/sentryPrivacy";

const dsn = sentryServerDsn();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT,
    release: sentryRelease(),
    dataCollection: sentryDataCollection(),
    tracesSampler: sentryTracesSampler,
    beforeSend: sentryBeforeSend,
    beforeSendLog: sentryBeforeSendLog,
    beforeBreadcrumb: sentryBeforeBreadcrumb,
    integrations: (defaults) => [
      ...defaults,
      Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
    ],
  });
}
