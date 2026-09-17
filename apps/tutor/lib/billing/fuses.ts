import { MAX_NEW_QUESTIONS_PER_HOUR } from "./catalog";

const HOUR_MS = 60 * 60 * 1000;

interface HourlyBucket {
  starts: number[];
}

const hourly = new Map<string, HourlyBucket>();
let nowFn: () => number = Date.now;

export function setBillingNowForTests(now: () => number): void {
  nowFn = now;
}

export function resetBillingFusesForTests(): void {
  hourly.clear();
  nowFn = Date.now;
}

export function recordNewQuestion(userId: string): { ok: true } | { ok: false; remaining: number } {
  const now = nowFn();
  const bucket = hourly.get(userId) ?? { starts: [] };
  const cutoff = now - HOUR_MS;
  bucket.starts = bucket.starts.filter((start) => start > cutoff);
  if (bucket.starts.length >= MAX_NEW_QUESTIONS_PER_HOUR) {
    hourly.set(userId, bucket);
    return { ok: false, remaining: 0 };
  }
  bucket.starts.push(now);
  hourly.set(userId, bucket);
  return { ok: true };
}

export function questionsRemainingThisHour(userId: string): number {
  const now = nowFn();
  const bucket = hourly.get(userId);
  if (!bucket) return MAX_NEW_QUESTIONS_PER_HOUR;
  const cutoff = now - HOUR_MS;
  const used = bucket.starts.filter((start) => start > cutoff).length;
  return Math.max(0, MAX_NEW_QUESTIONS_PER_HOUR - used);
}
