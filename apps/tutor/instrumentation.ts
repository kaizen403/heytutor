import * as Sentry from "@sentry/nextjs";
import { sentryServerRuntimeEnabled } from "./lib/obs/sentryRuntime";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError: typeof Sentry.captureRequestError = (...args) => {
  if (sentryServerRuntimeEnabled()) return Sentry.captureRequestError(...args);
};
