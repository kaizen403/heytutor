import * as Sentry from "@sentry/nextjs";
import {
  sentryBeforeBreadcrumb,
  sentryBeforeSend,
  sentryBeforeSendLog,
  sentryDataCollection,
  sentryServerDsn,
  sentryTracesSampler,
} from "@/lib/obs/sentryPrivacy";

const dsn = sentryServerDsn();

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
      Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
    ],
  });
}
