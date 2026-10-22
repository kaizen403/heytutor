import { failedTurnDeliveryEnabled, failedTurnRuntimeEnvironment } from "./failedTurnRuntime";
import {
  isSentryDisabled,
  sentryBeforeBreadcrumb,
  sentryBeforeSend,
  sentryBeforeSendLog,
  sentryTracesSampler,
} from "./sentryPrivacy";

/** NODE_ENV=production is also used by local builds; deployment must opt in. */
export function sentryServerRuntimeEnabled(): boolean {
  return failedTurnDeliveryEnabled() && !isSentryDisabled();
}

/** Static public access is required for Next to bake the deployment marker in. */
export function sentryBrowserRuntimeEnabled(): boolean {
  return process.env.NODE_ENV === "production"
    && process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT === "production"
    && typeof location !== "undefined" && location.hostname === "app.accelute.co";
}

/** Recheck at the last SDK boundary too, including logs and sampled traces. */
function guardedOptions(enabled: () => boolean, environment: string) {
  return {
    environment,
    beforeSend: (event: Parameters<typeof sentryBeforeSend>[0]) => enabled() ? { ...sentryBeforeSend(event), environment } : null,
    beforeSendLog: <T extends Parameters<typeof sentryBeforeSendLog>[0]>(log: T) => enabled() ? sentryBeforeSendLog(log) : null,
    beforeBreadcrumb: (breadcrumb: Parameters<typeof sentryBeforeBreadcrumb>[0]) => enabled() ? sentryBeforeBreadcrumb(breadcrumb) : null,
    tracesSampler: (context: { name?: string }) => enabled() ? sentryTracesSampler(context, { NODE_ENV: process.env.NODE_ENV }) : 0,
  };
}

export function sentryServerRuntimeOptions() {
  return guardedOptions(sentryServerRuntimeEnabled, failedTurnRuntimeEnvironment());
}

export function sentryBrowserRuntimeOptions() {
  return guardedOptions(sentryBrowserRuntimeEnabled, "production");
}
