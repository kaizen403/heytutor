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
