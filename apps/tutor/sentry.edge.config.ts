import * as Sentry from "@sentry/nextjs";
import {
  sentryDataCollection,
  sentryLogPrivacyIntegration,
  sentryServerDsn,
} from "@/lib/obs/sentryPrivacy";

import { sentryServerRuntimeEnabled, sentryServerRuntimeOptions } from "@/lib/obs/sentryRuntime";

const dsn = sentryServerDsn();

if (dsn && sentryServerRuntimeEnabled()) {
  Sentry.init({
    dsn,
    ...sentryServerRuntimeOptions(),
    dataCollection: sentryDataCollection(),
    integrations: (defaults) => [
      ...defaults,
      sentryLogPrivacyIntegration(),
      Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
    ],
  });
}
