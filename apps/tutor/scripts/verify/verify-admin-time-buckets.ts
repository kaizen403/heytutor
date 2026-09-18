/**
 * UTC day buckets for the admin charts: keys are stable, ranges are
 * zero-filled, and out-of-range timestamps are dropped rather than smearing
 * into an edge bucket.
 */
import { bucketCountsByDay, recentDayRange, utcDayKey } from "../../lib/admin/timeBuckets";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// --- utcDayKey ----------------------------------------------------------------
{
  // 2026-09-19T23:30Z and 2026-09-20T00:30Z are different UTC days even
  // though a +05:30 clock would call both September 20.
  assert(utcDayKey(Date.UTC(2026, 8, 19, 23, 30)) === "2026-09-19", "UTC keys are YYYY-MM-DD");
  assert(utcDayKey(Date.UTC(2026, 8, 20, 0, 30)) === "2026-09-20", "the day flips at UTC midnight");
  assert(utcDayKey(Date.UTC(2026, 0, 1)) === "2026-01-01", "single digits are zero-padded");
}

// --- recentDayRange -----------------------------------------------------------
{
  const now = Date.UTC(2026, 8, 19, 12);
  const range = recentDayRange(14, now);
  assert(range.length === 14, "a 14-day range has 14 keys");
  assert(range[0] === "2026-09-06", "the oldest key is 13 days before today");
  assert(range[13] === "2026-09-19", "the newest key is today");
  assert(
    range.every((day, i) => i === 0 || day > range[i - 1]),
    "range keys are strictly ascending",
  );
  assert(new Set(range).size === 14, "range keys are unique");
  assert(recentDayRange(1, now).length === 1, "a 1-day range is just today");
  assert(recentDayRange(0, now).length === 1, "days clamp to at least one day");
}

// --- bucketCountsByDay --------------------------------------------------------
{
  const now = Date.UTC(2026, 8, 19, 12);
  const counts = bucketCountsByDay(
    [
      Date.UTC(2026, 8, 19, 1), // today
      Date.UTC(2026, 8, 19, 22), // today again
      new Date(Date.UTC(2026, 8, 17, 9)), // three days ago, as a Date
      Date.UTC(2026, 8, 4), // 15 days ago — outside the range
    ],
    14,
    now,
  );
  assert(counts.length === 14, "the bucket list is always the full range");
  const byDay = new Map(counts.map((entry) => [entry.day, entry.count]));
  assert(byDay.get("2026-09-19") === 2, "two today timestamps count into today");
  assert(byDay.get("2026-09-17") === 1, "a Date instance counts like a number");
  assert(byDay.get("2026-09-06") === 0, "an empty day is zero-filled");
  assert(
    !byDay.has("2026-09-05"),
    "an out-of-range timestamp is dropped, not smeared into the oldest bucket",
  );
  assert(
    counts.reduce((sum, entry) => sum + entry.count, 0) === 3,
    "every in-range timestamp is counted exactly once",
  );
  assert(
    bucketCountsByDay([], 14, now).every((entry) => entry.count === 0),
    "no timestamps means an all-zero series",
  );
}

console.log("✓ admin UTC day buckets");
