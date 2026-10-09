/** Bounded process-local server tag memory. Unknown remote tags are never replaced. */
export class TraceTagRegistry {
  private readonly entries = new Map<string, { tags: string[]; at: number }>();
  constructor(private readonly maximum = 5000, private readonly ttlMs = 3_600_000) {}

  private current(key: string, now: number): string[] | undefined {
    const entry = this.entries.get(key);
    if (entry && now - entry.at <= this.ttlMs) return entry.tags;
    this.entries.delete(key);
    return undefined;
  }

  remember(key: string, tags: readonly string[], now = Date.now()): string[] {
    const merged = [...new Set([...(this.current(key, now) ?? []), ...tags])];
    this.entries.delete(key);
    this.entries.set(key, { tags: merged, at: now });
    while (this.entries.size > this.maximum) this.entries.delete(this.entries.keys().next().value!);
    return merged;
  }

  appendKnown(key: string, tags: readonly string[], now = Date.now()): string[] | undefined {
    // A restarted worker cannot know every tag already on the remote trace.
    // In that case metadata may update, but omitting tags preserves that trace.
    return this.current(key, now) ? this.remember(key, tags, now) : undefined;
  }
}
