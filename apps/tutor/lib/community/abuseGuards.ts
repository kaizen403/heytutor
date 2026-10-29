/**
 * In-process guards for Community's public writes. Production is one
 * process (AGENTS.md rule 10), so a bounded map is the whole truth; a restart
 * forgets them, which only ever lets one extra view or report through.
 */

const MAX_ENTRIES = 20_000;

/** Remembers a key for a while, oldest first out. */
class ExpiringKeys {
  private readonly seen = new Map<string, number>();
  constructor(private readonly ttlMs: number) {}

  /** True the first time a key is seen within its window; false while it is fresh. */
  claim(key: string, now = Date.now()): boolean {
    const until = this.seen.get(key);
    if (until !== undefined && until > now) return false;
    this.seen.delete(key);
    this.seen.set(key, now + this.ttlMs);
    while (this.seen.size > MAX_ENTRIES) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
    return true;
  }

  clear(): void {
    this.seen.clear();
  }
}

/** One counted view per visitor and board every 30 minutes. */
export const communityViews = new ExpiringKeys(30 * 60_000);
/** One report per reporter and board a day; a signed in reporter is also deduplicated in the database. */
export const communityReports = new ExpiringKeys(24 * 60 * 60_000);

/** Accounts with a remix in flight. One at a time, so parallel requests cannot each copy a whole board. */
const remixing = new Set<string>();

export function claimRemixSlot(userId: string): boolean {
  if (remixing.has(userId)) return false;
  remixing.add(userId);
  return true;
}

export function releaseRemixSlot(userId: string): void {
  remixing.delete(userId);
}

export function resetCommunityGuardsForTests(): void {
  communityViews.clear();
  communityReports.clear();
  remixing.clear();
}

/** The visitor key: the account when signed in, else the client address. */
export function visitorKey(userId: string | null, request: Request, clientIp: (forwarded?: string, real?: string) => string): string {
  if (userId) return `u:${userId}`;
  return `ip:${clientIp(request.headers.get("x-forwarded-for") ?? undefined, request.headers.get("x-real-ip") ?? undefined)}`;
}
