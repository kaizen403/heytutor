import { timingSafeEqual } from "node:crypto";

/** Length-checked compare so a shorter secret cannot throw or short-circuit. */
export function timingSafeEqualText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}
