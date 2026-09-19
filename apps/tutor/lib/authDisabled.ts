/**
 * Login, onboarding, and the staff gate are on unless this process is an
 * explicit local testing hatch. AUTH_DISABLED=1 (and NEXT_PUBLIC_AUTH_DISABLED=1
 * so the client matches) turns the gate off. Production never honors the hatch.
 */
export function isAuthDisabled(
  env: NodeJS.ProcessEnv = process.env,
  nodeEnv = env.NODE_ENV,
): boolean {
  if (nodeEnv === "production") return false;
  return env.AUTH_DISABLED === "1" || env.NEXT_PUBLIC_AUTH_DISABLED === "1";
}
