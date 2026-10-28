/**
 * The provider answered with an error status: nothing was generated, so the
 * call is not billed. Every other failure after dispatch (a timeout, a
 * dropped connection, an unreadable reply) may have been billed and keeps its
 * ceiling charge.
 */
export class ProviderRefusedError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ProviderRefusedError";
  }
}

/**
 * Connect-phase failures: DNS or the TCP connect failed, so the request never
 * reached the provider and cannot have been billed. A reset or socket error
 * mid-request can come after the body was sent and stays charged.
 */
const NEVER_REACHED_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

export function neverReachedProvider(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return error instanceof TypeError && typeof cause?.code === "string" && NEVER_REACHED_CODES.has(cause.code);
}
