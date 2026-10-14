type Environment = "production" | "development" | "test" | "lab" | "unknown";

/** NODE_ENV alone cannot distinguish a local production build from EC2. */
export function failedTurnRuntimeEnvironment(env: Record<string, string | undefined> = process.env): Environment {
  const declared = env.SENTRY_ENVIRONMENT?.trim();
  if (declared === "lab" || declared === "development" || declared === "test") return declared;
  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") return env.NODE_ENV;
  return env.NODE_ENV === "production" && declared === "production" ? "production" : "unknown";
}

export function failedTurnDeliveryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return failedTurnRuntimeEnvironment(env) === "production";
}
