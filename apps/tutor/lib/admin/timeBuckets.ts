/**
 * UTC day buckets for the admin charts. Day keys are `YYYY-MM-DD` so a chart
 * label is the key verbatim; the admin UI states that buckets are UTC.
 */

const DAY_MS = 86_400_000;

export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The last `days` UTC day keys, oldest first, ending today. */
export function recentDayRange(days: number, nowMs: number = Date.now()): string[] {
  const count = Math.max(1, Math.floor(days));
  const range: string[] = [utcDayKey(nowMs)];
  for (let i = 1; i < count; i += 1) {
    range.unshift(utcDayKey(nowMs - i * DAY_MS));
  }
  return range;
}

export interface DayCount {
  day: string;
  count: number;
}

/**
 * Count timestamps per UTC day over the last `days` days, zero-filled.
 * Timestamps outside the range are dropped, not counted into an edge bucket.
 */
export function bucketCountsByDay(
  timestamps: ReadonlyArray<Date | number>,
  days: number,
  nowMs: number = Date.now(),
): DayCount[] {
  const range = recentDayRange(days, nowMs);
  const counts = new Map<string, number>(range.map((day) => [day, 0]));
  for (const timestamp of timestamps) {
    const key = utcDayKey(typeof timestamp === "number" ? timestamp : timestamp.getTime());
    const current = counts.get(key);
    if (current !== undefined) counts.set(key, current + 1);
  }
  return range.map((day) => ({ day, count: counts.get(day) ?? 0 }));
}
