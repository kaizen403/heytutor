/** The existing production project is personal-9bo/heytutor (see the deploy runbook). */
export function sentryEventUrl(
  eventId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!eventId || !/^[a-f0-9]{32}$/i.test(eventId)) return null;
  const organization = env.SENTRY_ORG?.trim() || "personal-9bo";
  if (!/^[a-z0-9_-]+$/i.test(organization)) return null;
  const query = new URLSearchParams({ query: eventId, statsPeriod: "90d" });
  return `https://sentry.io/organizations/${organization}/issues/?${query}`;
}
