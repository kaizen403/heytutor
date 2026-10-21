import * as Sentry from "@sentry/nextjs";
import {
  sentryClientDsn,
  sentryDataCollection,
  sentryLogPrivacyIntegration,
} from "@/lib/obs/sentryPrivacy";

import { sentryBrowserRuntimeEnabled, sentryBrowserRuntimeOptions } from "@/lib/obs/sentryRuntime";

const dsn = sentryClientDsn({ NODE_ENV: process.env.NODE_ENV, NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN });

if (dsn && sentryBrowserRuntimeEnabled()) {
  Sentry.init({
    dsn,
    ...sentryBrowserRuntimeOptions(),
    dataCollection: sentryDataCollection(),
    integrations: (defaults) => [
      ...defaults,
      sentryLogPrivacyIntegration(),
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

export const onRouterTransitionStart: typeof Sentry.captureRouterTransitionStart = (...args) => {
  if (dsn && sentryBrowserRuntimeEnabled()) return Sentry.captureRouterTransitionStart(...args);
};
