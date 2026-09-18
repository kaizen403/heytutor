const POOL_DEFAULTS: Record<string, string> = {
  connection_limit: "5",
  pool_timeout: "10",
  connect_timeout: "10",
};

/**
 * Neon kills idle Prisma connections (E57P01). Without a pool timeout those
 * queries wait until the TCP stack gives up, which is how a lecture's
 * begin-turn / board write never returns and the pen spins forever.
 */
export function withPrismaPoolLimits(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  const missing = Object.entries(POOL_DEFAULTS).filter(
    ([key]) => !new RegExp(`[?&]${key}=`).test(trimmed),
  );
  if (missing.length === 0) return trimmed;
  const join = trimmed.includes("?") ? "&" : "?";
  return `${trimmed}${join}${missing.map(([key, value]) => `${key}=${value}`).join("&")}`;
}
