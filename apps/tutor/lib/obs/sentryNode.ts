import * as Sentry from "@sentry/nextjs";
import {
  scrubSecrets,
  sentryDataCollection,
  sentryLogPrivacyIntegration,
  sentryServerDsn,
} from "./sentryPrivacy";

import { sentryServerRuntimeEnabled, sentryServerRuntimeOptions } from "./sentryRuntime";

const dsn = sentryServerDsn();

if (dsn && sentryServerRuntimeEnabled()) {
  Sentry.init({
    dsn,
    ...sentryServerRuntimeOptions(),
    dataCollection: sentryDataCollection(),
    // Next's instrumentation owns tracing and HTTP patching in this process.
    // This client reports crashes, speech-relay failures, and console logs.
    enableOpenTelemetrySetup: false,
    tracesSampler: () => 0,
    integrations: (defaults) => [
      ...defaults.filter(
        (integration) =>
          integration.name === "OnUncaughtException" || integration.name === "OnUnhandledRejection",
      ),
      sentryLogPrivacyIntegration(),
      Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
    ],
  });

  process.once("SIGTERM", () => {
    void Sentry.flush(2000);
  });
}

/** Speech-relay failures. The student text and provider credentials stay out of the event. */
export function captureTtsRelayFailure(error: unknown): void {
  if (!dsn || !sentryServerRuntimeEnabled()) return;
  const message = error instanceof Error ? error.message : "upstream speech relay failed";
  const scrubbed = new Error(scrubSecrets(message));
  scrubbed.name = error instanceof Error ? error.name : "Error";
  Sentry.captureException(scrubbed, { tags: { area: "tts-relay" } });
}
